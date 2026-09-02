import io
import logging
import os
import zipfile
from pathlib import Path

from app.core.config import get_settings
from app.integrations.pph.client import PPHClient, PPHClientError
from app.processing.local_reference_fallback import (
    apply_local_bookmarks,
    split_compound_bib_bookmarks,
    strip_citation_semicolon_styling,
)
from app.processing.reference_char_style_applicator import apply_reference_char_styles

# Legacy imports
try:
    from app.processing.legacy import ReferencesStructing
    from app.processing.legacy import Referencenumvalidation
    LEGACY_AVAILABLE = True
except Exception as e:
    logging.getLogger(__name__).warning(f"Legacy reference modules unavailable: {e}")
    LEGACY_AVAILABLE = False

engine_logger = logging.getLogger("app.processing.references_engine")


class ReferencesEngine:
    def process_document(self, file_path: str,
                         run_structuring: bool = False,
                         run_conversion: bool = True,
                         run_num_validation: bool = True,
                         run_apa_validation: bool = True,
                         report_only: bool = False,
                         target_style: str = "Auto",
                         citation_format: str = "auto") -> list[str]:
        """
        Runs the Reference processing pipeline via PPH, with a local fallback
        that applies bib_/ref_ bookmarks when PPH is unreachable or disabled.

        run_structuring: Run ReferencesStructing.py (re-formats reference list structure).
        run_conversion:  Run ReferenceConversion.py via Gemini AI (converts APA ↔ AMA).
                         These two are now independent — conversion runs on the original
                         input file regardless of whether structuring is enabled.
        """
        settings = get_settings()

        pph_configured = bool(getattr(settings, "PPH_BASE_URL", None))
        pph_enabled = bool(getattr(settings, "PPH_ENABLED", False))

        if not pph_configured or not pph_enabled:
            reason = "PPH_BASE_URL not configured" if not pph_configured else "PPH_ENABLED=false"
            engine_logger.warning(
                "PPH unavailable (%s); using local bookmark fallback for %s",
                reason, os.path.basename(file_path),
            )
            return self._run_local_fallback(file_path, reason)

        try:
            return self._run_pph(
                file_path,
                run_structuring=run_structuring,
                run_conversion=run_conversion,
                run_num_validation=run_num_validation,
                run_apa_validation=run_apa_validation,
                report_only=report_only,
                target_style=target_style,
                citation_format=citation_format,
            )
        except PPHClientError as e:
            engine_logger.warning(
                "PPH request failed (%s); using local bookmark fallback for %s",
                e, os.path.basename(file_path),
            )
            return self._run_local_fallback(file_path, f"PPH error: {e}")

    # ------------------------------------------------------------------
    # PPH path
    # ------------------------------------------------------------------

    def _run_pph(self, file_path: str, *,
                 run_structuring: bool, run_conversion: bool,
                 run_num_validation: bool, run_apa_validation: bool,
                 report_only: bool, target_style: str, citation_format: str) -> list[str]:
        client = PPHClient()
        with open(file_path, "rb") as f:
            files = {
                "files": (
                    os.path.basename(file_path),
                    f.read(),
                    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                )
            }

        payload = {
            "report_only":              "true" if report_only else "false",
            "run_validation":           "true" if run_num_validation else "false",
            "run_name_year_validation": "true" if run_apa_validation else "false",
            "run_structuring":          "true" if run_structuring else "false",
            "run_gemini":               "true" if run_conversion else "false",
            "target_style":             target_style,
            "citation_format":          citation_format,
        }

        engine_logger.info(f"Submitting reference job to PPH for: {os.path.basename(file_path)}")
        engine_logger.info(f"Payload: {payload}")

        zip_bytes = client.submit_and_wait(
            endpoint="/validate",
            files=files,
            data=payload,
        )

        folder = os.path.dirname(file_path)
        generated_files: list[str] = []
        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as z:
            z.extractall(folder)
            for name in z.namelist():
                full_path = os.path.join(folder, name)
                if os.path.isfile(full_path):
                    generated_files.append(full_path)
                    if full_path.endswith("_Processed.docx"):
                        apply_reference_char_styles(full_path)
                        try:
                            split_compound_bib_bookmarks(full_path)
                        except Exception as split_err:
                            engine_logger.warning(
                                "split_compound_bib_bookmarks failed on PPH output %s: %s",
                                os.path.basename(full_path), split_err,
                            )
                        try:
                            strip_citation_semicolon_styling(full_path)
                        except Exception as strip_err:
                            engine_logger.warning(
                                "strip_citation_semicolon_styling failed on PPH output %s: %s",
                                os.path.basename(full_path), strip_err,
                            )
        return generated_files

    # ------------------------------------------------------------------
    # Local fallback
    # ------------------------------------------------------------------

    def _run_local_fallback(self, file_path: str, reason: str) -> list[str]:
        """Produce the same file shape PPH would (`*_Processed.docx` + `*_log.txt`)
        but with bookmarks generated locally by `apply_local_bookmarks`."""
        folder = os.path.dirname(file_path)
        base = os.path.splitext(os.path.basename(file_path))[0]
        processed_path = os.path.join(folder, f"{base}_Processed.docx")
        log_path = os.path.join(folder, f"{base}_log.txt")

        stats = apply_local_bookmarks(file_path, processed_path)

        try:
            apply_reference_char_styles(processed_path)
        except Exception as style_err:
            engine_logger.warning(
                "apply_reference_char_styles failed on local fallback output: %s", style_err,
            )

        split_stats = {"split_bookmarks": 0, "new_bookmarks": 0, "unmatched_parts": 0}
        try:
            split_stats = split_compound_bib_bookmarks(processed_path)
        except Exception as split_err:
            engine_logger.warning(
                "split_compound_bib_bookmarks failed on local fallback output: %s", split_err,
            )

        semicolons_cleaned = 0
        try:
            semicolons_cleaned = strip_citation_semicolon_styling(processed_path)
        except Exception as strip_err:
            engine_logger.warning(
                "strip_citation_semicolon_styling failed on local fallback output: %s", strip_err,
            )

        with open(log_path, "w", encoding="utf-8") as f:
            f.write(
                "Local reference-bookmark fallback\n"
                f"reason: {reason}\n"
                f"input: {os.path.basename(file_path)}\n"
                f"output: {os.path.basename(processed_path)}\n"
                f"ref_bookmarks_added: {stats['ref_count']}\n"
                f"bib_bookmarks_added: {stats['bib_matched']}\n"
                f"citations_unmatched: {stats['bib_unmatched']}\n"
                f"compound_bookmarks_split: {split_stats['split_bookmarks']}\n"
                f"sub_bookmarks_created: {split_stats['new_bookmarks']}\n"
                f"unmatched_sub_citations: {split_stats['unmatched_parts']}\n"
                f"semicolons_stripped: {semicolons_cleaned}\n"
            )

        engine_logger.info(
            "Local fallback wrote %s (ref=%d, bib=%d, unmatched=%d)",
            os.path.basename(processed_path),
            stats["ref_count"], stats["bib_matched"], stats["bib_unmatched"],
        )
        return [processed_path, log_path]
