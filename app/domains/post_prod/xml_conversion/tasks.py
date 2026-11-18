import logging
import os
import io
import zipfile
import time
import json
import requests
from datetime import datetime, timezone

import redis
from app.database import SessionLocal
from app.core.config import get_settings
from app.models import ProcessingJob
from app.domains.post_prod.xml_conversion.models import (
    PostProdXMLConversionProject,
    PostProdXMLConversionHistory,
)
from app.domains.post_prod.xml_conversion.engine.format_mapper import convert_s4c_to_target
from app.domains.post_prod.xml_conversion.validators.dtd_validator import validate_xml
from app.domains.post_prod.xml_conversion.validators.customer_rules import run_customer_checks

logger = logging.getLogger("app.post_prod.xml_conversion")


def extract_and_save_pdf2xml_zip(zip_bytes: bytes, out_dir: str, base_name: str, target_format: str = "XML") -> dict:
    """
    Extracts ZIP returned by PDF2XML API (return_xml=all) containing:
      - 30_canonical.xml (raw S4C XML)
      - 41_jats.xml
      - 40_bits.xml
    Saves them as:
      - {base_name}_raw.xml (canonical rawxml)
      - {base_name}_jats.xml
      - {base_name}_bits.xml
      - {base_name}_final.xml (copy of target_format: JATS, BITS, or rawxml)
    Returns dict mapping keys to filepaths and contents.
    """
    raw_xml = ""
    jats_xml = ""
    bits_xml = ""

    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as z:
        for name in z.namelist():
            lower_name = name.lower()
            content = z.read(name).decode("utf-8", errors="replace")
            if "canonical" in lower_name or "raw" in lower_name:
                raw_xml = content
            elif "jats" in lower_name:
                jats_xml = content
            elif "bits" in lower_name:
                bits_xml = content
            elif lower_name.endswith(".xml") and not raw_xml:
                raw_xml = content

    raw_filepath = os.path.join(out_dir, f"{base_name}_raw.xml")
    jats_filepath = os.path.join(out_dir, f"{base_name}_jats.xml")
    bits_filepath = os.path.join(out_dir, f"{base_name}_bits.xml")

    if raw_xml:
        with open(raw_filepath, "w", encoding="utf-8") as f:
            f.write(raw_xml)
    if jats_xml:
        with open(jats_filepath, "w", encoding="utf-8") as f:
            f.write(jats_xml)
    if bits_xml:
        with open(bits_filepath, "w", encoding="utf-8") as f:
            f.write(bits_xml)

    # Determine final XML based on target_format
    fmt = (target_format or "XML").upper()
    if fmt == "BITS" and bits_xml:
        final_xml = bits_xml
    elif fmt == "JATS" and jats_xml:
        final_xml = jats_xml
    else:
        final_xml = jats_xml or bits_xml or raw_xml

    final_filepath = os.path.join(out_dir, f"{base_name}_final.xml")
    if final_xml:
        with open(final_filepath, "w", encoding="utf-8") as f:
            f.write(final_xml)

    return {
        "raw_xml": raw_xml,
        "raw_filepath": raw_filepath,
        "jats_xml": jats_xml,
        "jats_filepath": jats_filepath,
        "bits_xml": bits_xml,
        "bits_filepath": bits_filepath,
        "final_xml": final_xml,
        "final_filepath": final_filepath,
    }


def run_xml_conversion_pipeline(project_id: int, job_id: int | None = None) -> dict:
    """
    Core pipeline function that serializes PDF-to-XML conversion via Redis,
    dispatches to the remote PDF2XML microservice, extracts outputs, validates XML,
    and updates database / Redis state for UI tracking.
    """
    settings = get_settings()
    db = SessionLocal()
    redis_client = redis.from_url(settings.REDIS_URL)

    progress_key = f"pdf2xml_progress:{project_id}"

    def set_progress(status: str, step: str, progress_pct: int, error: str | None = None):
        """Write real-time progress state to Redis (TTL 1 hour) and ProcessingJob table."""
        try:
            info = {
                "project_id": project_id,
                "job_id": job_id,
                "status": status,
                "step": step,
                "progress_pct": progress_pct,
                "error": error,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
            redis_client.setex(progress_key, 3600, json.dumps(info))
        except Exception as r_err:
            logger.warning(f"[PDF2XML] Failed to write progress to Redis: {r_err}")

        if job_id:
            try:
                j = db.query(ProcessingJob).filter(ProcessingJob.id == job_id).first()
                if j:
                    j.status = status
                    j.current_step = step
                    j.progress_pct = progress_pct
                    if error:
                        j.error_message = error
                    if status in ("completed", "failed", "cancelled"):
                        j.completed_at = datetime.now(timezone.utc)
                    db.commit()
            except Exception as j_err:
                logger.warning(f"[PDF2XML] Failed to update ProcessingJob {job_id}: {j_err}")

    lock = redis_client.lock("pdf2xml_conversion_lock", timeout=settings.PDF2XML_TIMEOUT_SECONDS)

    try:
        # 1. Fetch project record
        project = db.query(PostProdXMLConversionProject).filter(PostProdXMLConversionProject.id == project_id).first()
        if not project:
            # Fallback check if project_id was accidentally a history_id
            history_rec = db.query(PostProdXMLConversionHistory).filter(PostProdXMLConversionHistory.id == project_id).first()
            if history_rec and history_rec.project:
                project = history_rec.project
            else:
                err_msg = f"Project with ID {project_id} not found."
                logger.error(f"[PDF2XML] {err_msg}")
                set_progress("failed", err_msg, 100, error=err_msg)
                return {"status": "failed", "error": err_msg}

        project.conversion_status = "Processing"
        db.commit()

        set_progress("pending", "Waiting in conversion queue for server lock...", 5)
        logger.info(f"[PDF2XML] Project #{project.id} ('{project.project_name}') queued. Waiting for 'pdf2xml_conversion_lock'...")

        # 2. Acquire Redis distributed lock
        while True:
            if job_id:
                curr_job = db.query(ProcessingJob).filter(ProcessingJob.id == job_id).first()
                if curr_job and curr_job.status == "cancelled":
                    logger.info(f"[PDF2XML] Job {job_id} was cancelled by user. Aborting.")
                    set_progress("cancelled", "Cancelled by user", 100)
                    project.conversion_status = "Cancelled"
                    db.commit()
                    return {"status": "cancelled", "project_id": project.id}

            acquired = lock.acquire(blocking=False)
            if acquired:
                break
            time.sleep(2)

        logger.info(f"[PDF2XML] Project #{project.id}: acquired 'pdf2xml_conversion_lock'. Beginning conversion.")

        if not os.path.exists(project.filepath):
            raise FileNotFoundError(f"Source PDF file not found at: {project.filepath}")

        file_size_mb = os.path.getsize(project.filepath) / (1024 * 1024)
        api_url = (getattr(settings, "PDF2XML_API_URL", None) or os.environ.get("PDF2XML_API_URL") or "").strip()
        if not api_url:
            raise ValueError("PDF2XML_API_URL is not configured in settings or environment.")

        set_progress("processing", f"Uploading PDF ({file_size_mb:.2f} MB) to conversion server...", 15)
        logger.info(
            f"[PDF2XML] Project #{project.id} ('{project.project_name}', {file_size_mb:.2f} MB): "
            f"calling {api_url} with timeout={settings.PDF2XML_TIMEOUT_SECONDS}s"
        )

        params = {
            "engine": "docling",
            "targets": "json,xml,jats,bits",
            "return_xml": "all",
        }
        headers = {
            "X-Project-ID": str(project.id),
            "X-Project-Name": str(project.project_name),
            "X-Client-Code": str(project.client_code),
        }

        # 3. HTTP Call to remote machine with proper timeout
        start_time = time.perf_counter()
        set_progress("processing", "Conversion server analyzing layout and running Docling pipeline...", 30)

        with open(project.filepath, "rb") as f:
            files = {"file": (os.path.basename(project.filepath), f, "application/pdf")}
            response = requests.post(
                api_url,
                params=params,
                files=files,
                headers=headers,
                timeout=(settings.PDF2XML_CONNECT_TIMEOUT_SECONDS, settings.PDF2XML_TIMEOUT_SECONDS),
            )

        elapsed = time.perf_counter() - start_time
        logger.info(
            f"[PDF2XML] Project #{project.id}: remote server responded HTTP {response.status_code} "
            f"in {elapsed:.2f}s (content-length: {len(response.content)} bytes)"
        )

        if response.status_code != 200:
            err_text = response.text[:1000] if response.text else "No error details returned"
            raise RuntimeError(f"PDF2XML server returned HTTP {response.status_code}: {err_text}")

        # 4. Extract and save XML outputs
        set_progress("processing", "Unpacking XML outputs (Canonical, JATS, BITS)...", 70)
        out_dir = os.path.dirname(project.filepath)
        base_name = os.path.splitext(os.path.basename(project.filepath))[0]
        target_format = project.target_format or "XML"

        content_type = response.headers.get("Content-Type", "")
        if "zip" in content_type or response.content[:4] == b"PK\x03\x04":
            saved = extract_and_save_pdf2xml_zip(
                response.content,
                out_dir,
                base_name,
                target_format=target_format,
            )
            out_path = saved["final_filepath"]
            project.raw_xml_status = "Completed"
            project.final_xml_status = "Completed"
        else:
            final_xml = convert_s4c_to_target(response.text, target_format)
            out_path = os.path.join(out_dir, f"{base_name}_final.xml")
            with open(out_path, "w", encoding="utf-8") as f:
                f.write(final_xml)
            raw_path = os.path.join(out_dir, f"{base_name}_raw.xml")
            with open(raw_path, "w", encoding="utf-8") as f:
                f.write(response.text)
            project.raw_xml_status = "Completed"
            project.final_xml_status = "Completed"

        project.result_filepath = out_path

        # 5. Validate XML
        set_progress("processing", "Validating generated XML against DTD and customer rules...", 85)
        dtd_errors = []
        custom_errors = []
        try:
            dtd_errors = validate_xml(out_path, target_format)
            custom_errors = run_customer_checks(out_path, project.client_code)
        except Exception as v_err:
            logger.warning(f"[PDF2XML] Project #{project.id}: validation error: {v_err}")

        all_errors = dtd_errors + custom_errors
        if all_errors:
            logger.warning(f"[PDF2XML] Project #{project.id}: found {len(all_errors)} validation warnings/errors")

        project.conversion_status = "Completed"
        db.commit()

        # Log to history table
        history = PostProdXMLConversionHistory(
            project_id=project.id,
            action="Conversion Completed",
            details={
                "message": f"Successfully converted PDF in {elapsed:.2f}s",
                "elapsed_seconds": round(elapsed, 2),
                "target_format": target_format,
                "result_file": os.path.basename(out_path),
                "validation_errors_count": len(all_errors),
                "completed_at": datetime.now(timezone.utc).isoformat(),
            },
        )
        db.add(history)
        db.commit()

        set_progress("completed", "Conversion completed successfully", 100)
        logger.info(f"[PDF2XML] Project #{project.id} conversion completed successfully.")
        return {"status": "completed", "project_id": project.id, "result_filepath": out_path}

    except Exception as e:
        logger.exception(f"[PDF2XML] Error in conversion task for project #{project_id}")
        err_msg = str(e)
        set_progress("failed", f"Conversion failed: {err_msg}", 100, error=err_msg)
        try:
            proj = db.query(PostProdXMLConversionProject).filter(PostProdXMLConversionProject.id == project_id).first()
            if proj:
                proj.conversion_status = "Failed"
                hist = PostProdXMLConversionHistory(
                    project_id=proj.id,
                    action="Conversion Failed",
                    details={
                        "error": err_msg,
                        "time": datetime.now(timezone.utc).isoformat(),
                    },
                )
                db.add(hist)
                db.commit()
        except Exception:
            pass
        return {"status": "failed", "error": err_msg}

    finally:
        db.close()
        try:
            lock.release()
            logger.info(f"[PDF2XML] Released 'pdf2xml_conversion_lock' for project #{project_id}")
        except Exception:
            pass
