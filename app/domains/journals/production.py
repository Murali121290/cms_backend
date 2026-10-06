"""Stage 3-6 pipeline steps: JATS conversion and InDesign/proof generation."""
import logging
import os
import re
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from app.domains.journals.checks import run_check
from app.domains.journals.checks.runner import stage_number
from app.domains.journals.checks.structuring import active_stylesheet
from app.domains.journals.files import art_file_paths, figure_files, latest_file, save_version
from app.domains.journals.jats.converter import ArticleMeta, convert_xhtml_to_jats
from app.domains.journals.jats.servers import JatsXsltClient, JournalInDesignClient, JournalServerError
from app.domains.journals.manuscript import heading_level, load_blocks, resolve_manuscript_path
from app.domains.journals.models import Journal, JournalArticle, JournalClient, JournalStageDetail

logger = logging.getLogger(__name__)

ARTICLE_TYPES = {
    "research article": "research-article", "review article": "review-article", "short communication": "brief-report",
    "editorial": "editorial", "letter": "letter", "case report": "case-report", "commentary": "article-commentary",
}


def _clean_name(name: str) -> str:
    return re.sub(r"[\d*†‡§¶,]+$", "", re.sub(r"\s+", " ", name)).strip()


def _authors(meta: Dict[str, Any], lead: Optional[str]) -> List[str]:
    names = []
    if meta.get("lead_author"):
        names.append(meta["lead_author"])
    names.extend(meta.get("co_authors") or [])
    if not names and lead:
        names = [lead]
    # A single line listing everyone ("A. Author1, B. Author2 and C. Author3")
    if len(names) == 1 and re.search(r",| and ", names[0]):
        names = re.split(r",\s*|\s+and\s+", names[0])
    return [n for n in (_clean_name(x) for x in names) if n]


def article_meta(db: Session, article: JournalArticle) -> ArticleMeta:
    journal = db.query(Journal).filter(Journal.id == article.journal_id).first()
    client = db.query(JournalClient).filter(JournalClient.id == journal.client_id).first() if journal else None
    extracted = article.extracted_metadata or {}
    return ArticleMeta(
        journal_code=journal.journal_code if journal else "",
        journal_title=journal.journal_title if journal else "",
        publisher_name=client.publisher_name if client else "",
        issn_print=journal.issn_print if journal else None,
        issn_online=journal.issn_online if journal else None,
        doi=article.article_doi,
        title=article.article_title,
        authors=_authors(extracted, article.lead_author),
        affiliations=[a for a in (extracted.get("affiliations") or []) if a],
        abstract=article.abstract,
        keywords=list(article.keywords or []),
        volume=journal.volume if journal else None,
        issue=journal.issue if journal else None,
        article_type=ARTICLE_TYPES.get((article.article_type or "").lower(), "research-article"),
    )


def convert_to_jats(db: Session, article: JournalArticle, user_id: Optional[int] = None) -> Dict[str, Any]:
    """Stage 3: produce a new JATS XML version, then run the XML & DTD check."""
    docx_path = article.edited_docx_path if article.edited_docx_path and os.path.exists(article.edited_docx_path) \
        else resolve_manuscript_path(db, article)
    xml, converter, fallback_reason = None, "local", None

    xslt = JatsXsltClient()
    if xslt.configured and docx_path:
        try:
            xml = xslt.convert(docx_path)
            converter = "xslt-server"
        except JournalServerError as e:
            fallback_reason = str(e)
            logger.warning("JATS XSLT server failed for article %s, using local converter: %s", article.id, e)
    elif xslt.configured:
        fallback_reason = "No DOCX available for the XSLT server"

    if xml is None and docx_path and os.path.exists(docx_path):
        try:
            from app.domains.journals.jats.manuscript_to_jats import convert_docx_to_jats
            profile_path = os.path.join(os.path.dirname(__file__), "jats", "profiles", "jmir_mededu_profile.json")
            if os.path.exists(profile_path):
                xml = convert_docx_to_jats(docx_path, profile_path)
                converter = "manuscript-to-jats"
        except Exception as py_err:
            logger.warning("manuscript_to_jats converter failed for article %s, using fallback: %s", article.id, py_err)

    if xml is None:
        if article.xhtml_path and os.path.exists(article.xhtml_path):
            with open(article.xhtml_path, encoding="utf-8") as fh:
                xhtml = fh.read()
        elif docx_path:
            from app.processing.docx_to_xhtml_runs import DocxToXhtmlRunsEngine
            xhtml = DocxToXhtmlRunsEngine().convert(docx_path)
        else:
            raise FileNotFoundError("No manuscript DOCX or XHTML is attached to this article")
        sheet = active_stylesheet(db, article)
        char_styles = ((sheet.style_rules if sheet else None) or {}).get("character_styles") or {}
        xml = convert_xhtml_to_jats(
            xhtml, article_meta(db, article),
            blocks=load_blocks(docx_path) if docx_path else None,
            art_files=[os.path.basename(p) for p in art_file_paths(db, article.id)],
            figure_files=figure_files(db, article.id),
            char_styles=char_styles,
        )

    if isinstance(xml, str):
        xml = xml.encode("utf-8")

    base = re.sub(r"[^\w.-]+", "_", article.article_doi or f"article_{article.id}")
    row = save_version(db, article, "JATS_XML", f"{base}.xml", xml, "xml")
    article.jats_xml_path = row.path
    db.commit()
    run = run_check(db, article, "xml", user_id)
    return {"converter": converter, "fallback_reason": fallback_reason, "file": row, "check_run": run}


def indesign_template(db: Session, article: JournalArticle) -> Optional[str]:
    """The journal's active design-pack template; falls back to style_rules.indesign_template (a path)."""
    from app.domains.journals.files import active_assets
    templates = [a for a in active_assets(db, article.journal_id, "template") if os.path.exists(a.path)]
    if templates:
        return templates[0].path
    sheet = active_stylesheet(db, article)
    path = ((sheet.style_rules if sheet else None) or {}).get("indesign_template")
    return path if path and os.path.exists(path) else None


def design_extras(db: Session, article: JournalArticle) -> List[str]:
    """Active fonts and library from the journal's design pack, sent with the template."""
    from app.domains.journals.files import active_assets
    return [a.path for kind in ("font", "library") for a in active_assets(db, article.journal_id, kind) if os.path.exists(a.path)]


def _stage(db: Session, article_id: int, number: int) -> Optional[JournalStageDetail]:
    return db.query(JournalStageDetail).filter(JournalStageDetail.article_id == article_id,
                                               JournalStageDetail.stage_number == number).first()


def preflight_indesign(db: Session, article: JournalArticle) -> Optional[str]:
    """Why the Generate InDesign stage cannot start, or None."""
    from app.domains.journals.service import INDESIGN, STAGE_PIPELINE, XML_CONVERSION
    if stage_number(article.current_stage) < INDESIGN:
        return f"The article is at {article.current_stage}. InDesign is generated at {STAGE_PIPELINE[INDESIGN - 1]}."
    if not article.jats_xml_path or not os.path.exists(article.jats_xml_path):
        return f"The article has no JATS XML. Convert it at {STAGE_PIPELINE[XML_CONVERSION - 1]} first."
    if not indesign_template(db, article):
        return "The journal style sheet has no InDesign template. Set style_rules.indesign_template to the .indt path."
    return None


def run_indesign_job(article_id: int, user_id: Optional[int] = None) -> None:
    """Generate InDesign (stage 4) background job: JATS + template -> INDD/IDML/proof PDF, then create the QC and proof sign-offs."""
    from app import database

    db = database.SessionLocal()
    try:
        article = db.query(JournalArticle).filter(JournalArticle.id == article_id).first()
        if not article:
            return
        from app.domains.journals.service import INDESIGN
        stage5 = _stage(db, article_id, INDESIGN)
        journal = db.query(Journal).filter(Journal.id == article.journal_id).first()
        client = db.query(JournalClient).filter(JournalClient.id == journal.client_id).first()
        try:
            outputs = JournalInDesignClient().generate(
                article.jats_xml_path, indesign_template(db, article), art_file_paths(db, article_id), client.client_code,
                design_files=design_extras(db, article))
        except (JournalServerError, OSError, TypeError) as e:
            if stage5:
                stage5.remarks = f"InDesign generation failed: {e}"
            db.commit()
            logger.error("InDesign generation failed for article %s: %s", article_id, e)
            return

        base = re.sub(r"[^\w.-]+", "_", article.article_doi or f"article_{article_id}")
        saved = []
        for name, data in outputs.items():
            ext = os.path.splitext(name)[1].lower()
            if ext == ".indd":
                row = save_version(db, article, "INDD", f"{base}.indd", data, "indesign")
                article.indesign_path = row.path
            elif ext == ".idml":
                row = save_version(db, article, "IDML", f"{base}.idml", data, "indesign")
                article.indesign_path = article.indesign_path or row.path
            elif ext == ".pdf":
                row = save_version(db, article, "Proof_PDF", f"{base}_proof.pdf", data, "proof")
                article.proof_pdf_path = row.path
            elif name.lower() == "preflight.json":
                row = save_version(db, article, "Preflight", "preflight.json", data, "indesign")
            else:
                continue
            saved.append(row.filename)
        if stage5:
            stage5.remarks = ("InDesign generated: " + ", ".join(saved)) if saved else "InDesign server returned no INDD, IDML or PDF"
        db.commit()
        if article.indesign_path:
            run_check(db, article, "indesign_qc", user_id)
        run_check(db, article, "proof", user_id)
    finally:
        db.close()


# --- Stage 1: reference processing (ReferencesEngine: PPH, or local bookmark fallback) ---
REF_JOB_PREFIX = "References: "


def snapshot_working_copy(db: Session, article: JournalArticle, reason: str) -> None:
    """Keep the current working copy as a numbered version before it is replaced or patched."""
    path = article.edited_docx_path
    if path and os.path.exists(path):
        with open(path, "rb") as fh:
            row = save_version(db, article, "Working_Copy", os.path.basename(path), fh.read(), "edited/history")
        logger.info("Snapshot of working copy for article %s (%s): %s", article.id, reason, row.path)


def reference_options(db: Session, article: JournalArticle) -> Dict[str, Any]:
    sheet = active_stylesheet(db, article)
    refs = ((sheet.style_rules if sheet else None) or {}).get("references") or {}
    style = (refs.get("style") or "Vancouver").upper()
    return {
        "engine": refs.get("engine", "local"),                        # "local" (default) or "pph"
        "run_structuring": bool(refs.get("structure", True)),        # bib_* character styles
        "run_conversion": bool(refs.get("convert_to")),               # only when the sheet asks for a style conversion
        "run_num_validation": style in ("VANCOUVER", "AMA"),
        "run_apa_validation": style == "APA",
        "target_style": refs.get("convert_to") or ("APA" if style == "APA" else "AMA" if style in ("AMA", "VANCOUVER") else "Auto"),
        "citation_format": "auto",
    }


def apply_local_reference_styles(docx_path: str, citation_form: str = "auto") -> Dict[str, int]:
    """Without PPH, in place: bib_* character styles on the reference-list paragraphs of docx_path
    and cite_bib on the numbered in-text citations ([n] or (n), per the style sheet's citation_form)."""
    from app.domains.journals.checks.references import CITATION, PAREN_CITATION, citation_pattern, find_reference_blocks
    from app.processing.local_reference_styler import style_citations, style_reference_paragraphs
    blocks = load_blocks(docx_path)
    refs = find_reference_blocks(blocks)
    result = style_reference_paragraphs(docx_path, [b.idx for b in refs])
    if refs:
        ref_ids = {b.idx for b in refs}
        body = [b for b in blocks if b.idx not in ref_ids and b.text and not heading_level(b.category)]
        pattern = (CITATION if citation_form == "brackets" else PAREN_CITATION if citation_form == "parens"
                   else citation_pattern(b.text for b in body))
        result.update(style_citations(docx_path, [b.idx for b in body], pattern))
    return result


def _stage1(db: Session, article_id: int) -> Optional[JournalStageDetail]:
    return _stage(db, article_id, 1)


def run_reference_job(article_id: int, user_id: Optional[int] = None) -> None:
    """Background job: structure and validate the reference list, then make the result the working copy."""
    import shutil
    import time
    from app import database
    from app.domains.journals.files import article_dir
    from app.processing.docx_to_xhtml_runs import DocxToXhtmlRunsEngine
    from app.processing.references_engine import ReferencesEngine

    db = database.SessionLocal()
    try:
        article = db.query(JournalArticle).filter(JournalArticle.id == article_id).first()
        if not article:
            return
        stage1 = _stage1(db, article_id)
        source = resolve_manuscript_path(db, article)
        if not source:
            if stage1:
                stage1.remarks = REF_JOB_PREFIX + "failed: no manuscript DOCX"
            db.commit()
            return
        run_dir = article_dir(article, "references", time.strftime("run_%Y%m%d_%H%M%S"))
        work = os.path.join(run_dir, os.path.basename(source))
        shutil.copyfile(source, work)
        options = reference_options(db, article)
        use_pph = options.pop("engine", "local") == "pph"
        sheet = active_stylesheet(db, article)
        options_citation_form = (((sheet.style_rules if sheet else None) or {}).get("references") or {}).get("citation_form", "auto")
        styling = None
        try:
            if use_pph:
                outputs = ReferencesEngine().process_document(work, **options)
            else:
                # Local: bib_/ref_ bookmarks + citation links, then bib_* character styles on the reference list.
                outputs = ReferencesEngine()._run_local_fallback(work, "local mode (journal setting)")
                processed_local = next((p for p in outputs if p.lower().endswith(".docx")), None)
                if processed_local:
                    styling = apply_local_reference_styles(processed_local, options_citation_form)
        except Exception as e:  # noqa: BLE001 - report any engine failure on the stage
            if stage1:
                stage1.remarks = REF_JOB_PREFIX + f"failed: {e}"
            db.commit()
            logger.exception("Reference processing failed for article %s", article_id)
            return

        processed = next((p for p in outputs if p.lower().endswith(".docx") and os.path.exists(p)), None)
        saved = []
        for p in outputs:
            if p == processed or not os.path.exists(p):
                continue
            with open(p, "rb") as fh:
                saved.append(save_version(db, article, "Reference_Report", os.path.basename(p), fh.read(), "references").filename)
        if processed:
            snapshot_working_copy(db, article, "before reference processing")
            if not article.edited_docx_path:
                base = os.path.splitext(os.path.basename(source))[0]
                article.edited_docx_path = os.path.join(article_dir(article, "edited"), f"{base}_structured.docx")
            shutil.copyfile(processed, article.edited_docx_path)
            xhtml = DocxToXhtmlRunsEngine().convert(article.edited_docx_path)
            row = save_version(db, article, "XHTML", os.path.splitext(os.path.basename(article.edited_docx_path))[0] + ".xhtml",
                               xhtml.encode("utf-8"), "xhtml")
            article.xhtml_path = row.path
        mode = "PPH" if use_pph else (
            f"local: {styling['references_styled']} references structured, {styling['fields']} fields" if styling else "local")
        if stage1:
            stage1.remarks = REF_JOB_PREFIX + f"completed ({mode}); {len(saved)} report file(s)" + ("" if processed else "; no processed DOCX returned")
        db.commit()
        for key in ("structuring", "references"):
            try:
                run_check(db, article, key, user_id)
            except Exception:  # noqa: BLE001
                logger.exception("Re-running %s after reference processing failed", key)
    finally:
        db.close()
