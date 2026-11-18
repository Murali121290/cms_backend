import os
import re
import zipfile
import requests
import redis
import shutil
import tempfile
import logging
import time
from sqlalchemy.orm import Session
from datetime import datetime, timezone

from app import models
from app.core.config import get_settings
from app.domains.projects.models import Project

logger = logging.getLogger("app.processing")


class XHTMLToInDesignEngine:
    """
    Part 3: XHTML -> InDesign + PDF Engine
    Applies the author's reviewed XHTML back into a copy of the previous stage's
    InDesign document via Windows Conversion Server (d2id xhtml-to-indd).
    Promotes revised <filename>.indd, <filename>.idml, <filename>.pdf, and fresh <filename>.xhtml
    with strict filename consistency matching word-to-indd.
    """

    def process_document(
        self,
        db: Session,
        file_path: str,
        file_record: models.File,
        user_id: int | None = None,
        upload_dir: str | None = None,
        logger=logger,
        job_id: int | None = None,
    ) -> list[str]:
        settings = get_settings()

        from app.domains.processing.service import resolve_physical_file_path
        from app.services.file_service import UPLOAD_DIR
        target_upload_dir = upload_dir or UPLOAD_DIR

        # 1. Resolve project and chapter
        project = db.query(Project).filter(Project.id == file_record.project_id).first()
        chapter = db.query(models.ChapterInfo).filter(models.ChapterInfo.id == file_record.chapter_id).first()
        if not project or not chapter:
            raise ValueError("Associated project or chapter details are missing.")

        # 2. Resolve verified physical path of input XHTML
        if not os.path.exists(file_path):
            file_path = resolve_physical_file_path(file_path, str(target_upload_dir))
            if not os.path.exists(file_path) and file_record and file_record.path:
                file_path = resolve_physical_file_path(file_record.path, str(target_upload_dir))

        if not os.path.exists(file_path) or not (file_path.lower().endswith(".xhtml") or file_path.lower().endswith(".html")):
            raise FileNotFoundError(f"Valid physical XHTML file not found: {file_path}")

        chapter_code = chapter.chapters or chapter.number
        base_name = os.path.splitext(os.path.basename(file_path))[0].replace("_reviewed", "")

        # 3. Locate latest Stage baseline folder
        project_dir = os.path.abspath(os.path.join(str(target_upload_dir), project.client_name or "unknown", project.code))
        chapter_dir = os.path.abspath(os.path.join(project_dir, chapter_code))
        stages_root = os.path.join(chapter_dir, "Stages")
        os.makedirs(stages_root, exist_ok=True)

        current_round_num = 1
        latest_stage_dir = None

        if os.path.exists(stages_root):
            existing_rounds = []
            for item in os.listdir(stages_root):
                m = re.match(r"^R(\d+)$", item, re.IGNORECASE)
                if m:
                    r_dir = os.path.join(stages_root, item)
                    if os.path.isdir(r_dir):
                        r_files = [f for f in os.listdir(r_dir) if not f.startswith(".")]
                        # Only consider rounds that actually contain files (e.g. .indd, revision.json, or .xhtml)
                        if r_files and any(f.endswith(".indd") or f.endswith("revision.json") for f in r_files):
                            existing_rounds.append((int(m.group(1)), r_dir))
                        else:
                            # Clean up abandoned empty round directory from earlier failed attempts
                            try:
                                os.rmdir(r_dir)
                                logger.info(f"Cleaned up empty/abandoned stage directory: {r_dir}")
                            except Exception:
                                pass
            if existing_rounds:
                existing_rounds.sort(key=lambda x: x[0])
                current_round_num = existing_rounds[-1][0]
                latest_stage_dir = existing_rounds[-1][1]
                logger.info(f"Discovered baseline Stage: R{current_round_num} at {latest_stage_dir}")

        # Next round directory
        next_round_num = current_round_num + 1
        next_stage_dir = os.path.join(stages_root, f"R{next_round_num}")

        # 4. Discover linked artwork
        from app.services.file_service import resolve_chapter_art_folder, resolve_project_common_art_files
        common_art_files = resolve_project_common_art_files(project_dir=project_dir, db=db, project_id=project.id)
        art_folder = resolve_chapter_art_folder(
            project_dir=project_dir,
            chapter_dir=chapter_dir,
            chapter_number=chapter_code,
        )

        # 5. Package stage files, reviewed XHTML, and artwork into temporary ZIP
        temp_zip_fd, temp_zip_path = tempfile.mkstemp(suffix=".zip")
        os.close(temp_zip_fd)

        try:
            logger.info(f"Packaging XHTML-to-InDesign assets into ZIP: {temp_zip_path}")
            with zipfile.ZipFile(temp_zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
                written_in_zip = set()

                def safe_zf_write(src_path: str, arc_name: str):
                    norm_arc = arc_name.replace("\\", "/")
                    if norm_arc not in written_in_zip and os.path.exists(src_path):
                        zf.write(src_path, norm_arc)
                        written_in_zip.add(norm_arc)

                # Write stage folder contents
                if latest_stage_dir and os.path.exists(latest_stage_dir):
                    for root_s, _, files_s in os.walk(latest_stage_dir):
                        for f in files_s:
                            full_sp = os.path.join(root_s, f)
                            rel_sp = os.path.relpath(full_sp, latest_stage_dir).replace("\\", "/")
                            safe_zf_write(full_sp, f"stage/{rel_sp}")
                else:
                    # Fallback: look for <base_name>.indd in InDesign folder
                    indd_fallback = os.path.join(chapter_dir, "InDesign", f"{base_name}.indd")
                    if os.path.exists(indd_fallback):
                        safe_zf_write(indd_fallback, f"stage/{base_name}.indd")
                        safe_zf_write(indd_fallback, "stage/layout.indd")

                # Write the reviewed XHTML file (sanitized for d2id compatibility)
                sanitized_xhtml_to_write = file_path
                temp_sanitized_to_cleanup = None
                try:
                    import xml.etree.ElementTree as ET
                    with open(file_path, "r", encoding="utf-8", errors="ignore") as xf:
                        raw_x = xf.read()
                    x_root = ET.fromstring(raw_x)
                    x_head = x_root.find("{http://www.w3.org/1999/xhtml}head")
                    if x_head is None:
                        x_head = x_root.find("head")
                    if x_head is not None:
                        for child in list(x_head):
                            ctag = child.tag.split("}")[-1] if "}" in child.tag else child.tag
                            if ctag.lower() in ["link", "script", "style"]:
                                x_head.remove(child)

                    if latest_stage_dir and os.path.exists(latest_stage_dir):
                        for s_cand in [os.path.join(latest_stage_dir, "book.xhtml"), os.path.join(latest_stage_dir, f"{base_name}.xhtml")]:
                            if os.path.exists(s_cand):
                                try:
                                    with open(s_cand, "r", encoding="utf-8", errors="ignore") as sc_f:
                                        sc_root = ET.fromstring(sc_f.read())
                                    if "data-revision" in sc_root.attrib and "data-revision" not in x_root.attrib:
                                        x_root.attrib["data-revision"] = sc_root.attrib["data-revision"]
                                    sc_head = sc_root.find("{http://www.w3.org/1999/xhtml}head")
                                    if sc_head is None:
                                        sc_head = sc_root.find("head")
                                    if sc_head is not None and x_head is not None:
                                        existing_meta_names = {m.attrib.get("name") for m in x_head.findall("{http://www.w3.org/1999/xhtml}meta")}
                                        for sc_meta in sc_head:
                                            mtag = sc_meta.tag.split("}")[-1] if "}" in sc_meta.tag else sc_meta.tag
                                            if mtag.lower() == "meta" and sc_meta.attrib.get("name") not in existing_meta_names:
                                                x_head.append(sc_meta)
                                            elif mtag.lower() == "title" and x_head.find("{http://www.w3.org/1999/xhtml}title") is None:
                                                x_head.insert(0, sc_meta)

                                    # Restore protected markers from stage baseline (web editors often strip BOM \ufeff or special chars)
                                    stage_prot_map = {}
                                    for sc_p in sc_root.iter("{http://www.w3.org/1999/xhtml}p"):
                                        pid = sc_p.attrib.get("data-paragraph")
                                        if pid:
                                            for sc_c in sc_p.iter():
                                                if sc_c.attrib.get("data-protected") == "true":
                                                    stage_prot_map[(pid, sc_c.attrib.get("data-run", "0"))] = (sc_c.text, sc_c.tail)
                                    
                                    restored_markers = 0
                                    for xp in x_root.iter("{http://www.w3.org/1999/xhtml}p"):
                                        pid = xp.attrib.get("data-paragraph")
                                        if pid:
                                            for xc in xp.iter():
                                                if xc.attrib.get("data-protected") == "true":
                                                    key = (pid, xc.attrib.get("data-run", "0"))
                                                    if key in stage_prot_map:
                                                        orig_t, orig_tail = stage_prot_map[key]
                                                        if xc.text != orig_t or xc.tail != orig_tail:
                                                            xc.text = orig_t
                                                            xc.tail = orig_tail
                                                            restored_markers += 1

                                    # Sequential fallback if counts match
                                    sc_all_prot = [c for c in sc_root.iter() if c.attrib.get("data-protected") == "true"]
                                    x_all_prot = [c for c in x_root.iter() if c.attrib.get("data-protected") == "true"]
                                    if len(sc_all_prot) == len(x_all_prot):
                                        for s_el, x_el in zip(sc_all_prot, x_all_prot):
                                            if x_el.text != s_el.text or x_el.tail != s_el.tail:
                                                x_el.text = s_el.text
                                                x_el.tail = s_el.tail
                                                restored_markers += 1

                                    if restored_markers > 0:
                                        logger.info(f"Restored {restored_markers} protected markers from stage baseline")
                                    break
                                except Exception:
                                    pass

                    ET.register_namespace("", "http://www.w3.org/1999/xhtml")
                    ET.register_namespace("xlink", "http://www.w3.org/1999/xlink")
                    temp_san_fd, temp_sanitized_to_cleanup = tempfile.mkstemp(suffix=".xhtml")
                    os.close(temp_san_fd)
                    ET.ElementTree(x_root).write(temp_sanitized_to_cleanup, encoding="utf-8", xml_declaration=True)
                    sanitized_xhtml_to_write = temp_sanitized_to_cleanup
                except Exception as san_err:
                    logger.warning(f"Failed to pre-sanitize reviewed XHTML: {san_err}")

                safe_zf_write(sanitized_xhtml_to_write, f"{base_name}_reviewed.xhtml")
                if temp_sanitized_to_cleanup and os.path.exists(temp_sanitized_to_cleanup):
                    try:
                        os.unlink(temp_sanitized_to_cleanup)
                    except Exception:
                        pass

                # Write common art
                if common_art_files:
                    for ca_file in common_art_files:
                        safe_zf_write(ca_file, f"artfile/{os.path.basename(ca_file)}")

                # Write chapter artwork
                if art_folder and os.path.exists(art_folder):
                    for root_a, _, files_a in os.walk(art_folder):
                        for f in files_a:
                            full_p = os.path.join(root_a, f)
                            rel_p = os.path.relpath(full_p, art_folder).replace("\\", "/")
                            safe_zf_write(full_p, f"artfile/{rel_p}")

            # 6. Call Windows Conversion Server using Redis Lock
            if not settings.INDESIGN_SERVER_URL:
                raise ValueError("Windows InDesign Conversion Server is not configured. Please set INDESIGN_SERVER_URL.")

            url = f"{settings.INDESIGN_SERVER_URL.rstrip('/')}/convert-xhtml-to-indesign"
            redis_client = redis.from_url(settings.REDIS_URL)
            lock = redis_client.lock("indesign_conversion_lock", timeout=1200)

            job = db.query(models.ProcessingJob).filter(models.ProcessingJob.id == job_id).first() if job_id else None

            logger.info(f"Job {job_id} entering XHTML-to-InDesign lock loop...")
            while True:
                if job:
                    db.refresh(job)
                    if job.status == "cancelled":
                        logger.info(f"Job {job_id} was cancelled by user. Exiting.")
                        return []

                higher_job = None
                if job:
                    higher_job = db.query(models.ProcessingJob).filter(
                        models.ProcessingJob.status.in_(["pending", "processing"]),
                        models.ProcessingJob.id != job.id,
                        models.ProcessingJob.process_type.in_([
                            "word_to_indesign",
                            "indesign_to_xhtml",
                            "xhtml_to_indesign",
                            "xml_to_indesign",
                        ])
                    ).filter(
                        (models.ProcessingJob.priority > job.priority) |
                        ((models.ProcessingJob.priority == job.priority) & (models.ProcessingJob.id < job.id))
                    ).first()

                if higher_job:
                    time.sleep(2)
                    continue

                acquired = lock.acquire(blocking=False)
                if acquired:
                    break
                time.sleep(2)

            try:
                logger.info(f"Lock acquired. Sending XHTML-to-InDesign request to: {url}")
                client_name = project.client_name or ""
                with open(temp_zip_path, "rb") as zf_in:
                    response = requests.post(
                        url,
                        params={"client": client_name},
                        files={"file": (os.path.basename(temp_zip_path), zf_in.read(), "application/octet-stream")},
                        timeout=(30.0, 1200)
                    )
                if response.status_code != 200:
                    raise RuntimeError(f"Windows server returned {response.status_code}: {response.text}")
            finally:
                try:
                    lock.release()
                except Exception:
                    pass

            if job:
                db.refresh(job)
                if job.status == "cancelled":
                    logger.info(f"Job {job_id} cancelled during conversion. Discarding output.")
                    return []

            # 7. Extract artifacts into Stages/R<N+1>/ and promote to active chapter folders
            import io
            output_files = []
            indesign_dir = os.path.join(chapter_dir, "InDesign")
            proof_dir = os.path.join(chapter_dir, "Proof")
            xml_dir = os.path.join(chapter_dir, "XML")

            os.makedirs(indesign_dir, exist_ok=True)
            os.makedirs(proof_dir, exist_ok=True)
            os.makedirs(xml_dir, exist_ok=True)

            with zipfile.ZipFile(io.BytesIO(response.content)) as z:
                file_list = z.namelist()
                logger.info(f"Received files from Windows Server xhtml-to-indd: {file_list}")

                # Save all files to next stage directory
                os.makedirs(next_stage_dir, exist_ok=True)
                for f in file_list:
                    dest_path = os.path.join(next_stage_dir, os.path.basename(f))
                    with open(dest_path, "wb") as out_f:
                        out_f.write(z.read(f))

                # Promote revised <base_name>.indd & <base_name>.idml to InDesign/
                for f in file_list:
                    f_lower = f.lower()
                    if f_lower.endswith(".indd") or f_lower.endswith(".idml"):
                        clean_ext = os.path.splitext(f)[1]
                        clean_name = f"{base_name}{clean_ext}"
                        dest_path = os.path.join(indesign_dir, clean_name)
                        with open(dest_path, "wb") as out_f:
                            out_f.write(z.read(f))
                        logger.info(f"Updated active InDesign file: {dest_path}")
                        output_files.append(dest_path)

                        self._register_file(
                            db, project_id=project.id, chapter_id=chapter.id,
                            category="InDesign", filename=clean_name, file_path=dest_path,
                            file_type="application/x-indesign" if clean_name.endswith(".indd") else "application/vnd.adobe.indesign-idml-package",
                            user_id=user_id
                        )

                # Promote revised <base_name>.pdf to Proof/
                pdf_file = next((f for f in file_list if f.lower().endswith(".pdf")), None)
                if pdf_file:
                    clean_pdf_name = f"{base_name}.pdf"
                    dest_pdf_path = os.path.join(proof_dir, clean_pdf_name)
                    with open(dest_pdf_path, "wb") as out_f:
                        out_f.write(z.read(pdf_file))
                    logger.info(f"Updated active proof PDF: {dest_pdf_path}")
                    output_files.append(dest_pdf_path)

                    self._register_file(
                        db, project_id=project.id, chapter_id=chapter.id,
                        category="Proof", filename=clean_pdf_name, file_path=dest_pdf_path,
                        file_type="application/pdf", user_id=user_id
                    )

                # Promote new <base_name>.xhtml to Proof/ for next review cycle
                xhtml_file = next((f for f in file_list if f.lower().endswith(".xhtml") and not f.lower().endswith("_reviewed.xhtml")), None)
                if xhtml_file:
                    clean_xhtml_name = f"{base_name}.xhtml"
                    dest_xhtml_path = os.path.join(proof_dir, clean_xhtml_name)
                    with open(dest_xhtml_path, "wb") as out_f:
                        out_f.write(z.read(xhtml_file))
                    logger.info(f"Updated active editorial XHTML in Proof folder: {dest_xhtml_path}")
                    output_files.append(dest_xhtml_path)

                    self._register_file(
                        db, project_id=project.id, chapter_id=chapter.id,
                        category="Proof", filename=clean_xhtml_name, file_path=dest_xhtml_path,
                        file_type="application/xhtml+xml", user_id=user_id
                    )

            db.commit()
            return output_files

        finally:
            if os.path.exists(temp_zip_path):
                try:
                    os.remove(temp_zip_path)
                except Exception:
                    pass

    def _register_file(
        self,
        db: Session,
        *,
        project_id: int,
        chapter_id: int,
        category: str,
        filename: str,
        file_path: str,
        file_type: str,
        user_id: int | None
    ):
        from app.domains.files.version_service import archive_existing_file

        existing = db.query(models.File).filter(
            models.File.chapter_id == chapter_id,
            models.File.category == category,
            models.File.filename == filename
        ).first()

        if existing:
            archive_dir = os.path.join(os.path.dirname(existing.path or file_path), "archive")
            archive_existing_file(
                db,
                existing_file=existing,
                base_path=archive_dir,
                uploaded_by_id=user_id,
            )
            existing.path = file_path
            existing.version = (existing.version or 1) + 1
            existing.uploaded_by_id = user_id
            existing.uploaded_at = datetime.now(timezone.utc)
            existing.file_type = file_type
            logger.info(f"Updated file version: {existing.filename} (v{existing.version})")
        else:
            new_file = models.File(
                filename=filename,
                path=file_path,
                category=category,
                file_type=file_type,
                version=1,
                is_original=False,
                project_id=project_id,
                chapter_id=chapter_id,
                uploaded_by_id=user_id,
                uploaded_at=datetime.now(timezone.utc),
            )
            db.add(new_file)
            logger.info(f"Created new file record: {filename}")
