"""Article art files: which figure a file belongs to, its measurements, and the style-sheet checks."""
import os
import re
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from app.domains.journals.models import JournalArticle

VECTOR_FORMATS = {"EPS", "PDF", "SVG", "AI"}
DEFAULT_ART_RULES = {"formats": ["TIFF", "EPS", "PDF", "PNG", "JPG"], "min_ppi": 300, "naming": "fig{n}.tif", "placed_width_mm": 84}
_FIG_NAME = re.compile(r"(?:^|[^a-z])(?:fig(?:ure)?|f)[\s_.-]*0*(\d{1,3})(?:\D|$)", re.I)


def figure_from_name(filename: str) -> Optional[int]:
    """'fig2.tif', 'Figure 02 final.jpg', 'F3.eps' -> 2 / 2 / 3."""
    m = _FIG_NAME.search(os.path.splitext(os.path.basename(filename))[0])
    return int(m.group(1)) if m else None


def file_format(filename: str) -> str:
    ext = os.path.splitext(filename)[1].lstrip(".").upper()
    return {"TIF": "TIFF", "JPEG": "JPG"}.get(ext, ext)


def measure(path: str) -> Dict[str, Any]:
    """Pixel size and embedded dpi for raster images (Pillow); vector formats have no pixel size."""
    fmt = file_format(path)
    out: Dict[str, Any] = {"format": fmt, "width": None, "height": None, "dpi": None, "vector": fmt in VECTOR_FORMATS}
    if out["vector"] or not os.path.exists(path):
        return out
    try:
        from PIL import Image
        with Image.open(path) as im:
            out["width"], out["height"] = im.size
            dpi = im.info.get("dpi")
            if dpi:
                out["dpi"] = round(float(dpi[0]))
    except Exception:
        out["unreadable"] = True
    return out


def art_rules(style_rules: Optional[dict]) -> Dict[str, Any]:
    rules = dict(DEFAULT_ART_RULES)
    rules.update(((style_rules or {}).get("art") or {}))
    rules["formats"] = [f.upper() for f in rules.get("formats") or DEFAULT_ART_RULES["formats"]]
    return rules


def check_art(filename: str, figure: Optional[int], m: Dict[str, Any], rules: Dict[str, Any]) -> List[Dict[str, str]]:
    """[{status: ok|warning|error, text}] for one art file."""
    checks = []
    fmt = m["format"]
    checks.append({"status": "ok", "text": fmt} if fmt in rules["formats"]
                  else {"status": "error", "text": f"{fmt} is not accepted ({', '.join(rules['formats'])})"})
    if m.get("vector"):
        checks.append({"status": "ok", "text": "Vector"})
    elif m.get("unreadable"):
        checks.append({"status": "warning", "text": "Could not read the image"})
    elif m.get("width"):
        ppi = effective_ppi(m, rules)
        checks.append({"status": "ok", "text": f"{ppi} ppi"} if ppi >= rules["min_ppi"]
                      else {"status": "error", "text": f"{ppi} ppi at {rules['placed_width_mm']} mm (minimum {rules['min_ppi']})"})
    if figure is not None:
        want = rules["naming"].replace("{n}", str(figure))
        stem = lambda s: re.sub(r"_v\d+$", "", os.path.splitext(s)[0]).lower()  # noqa: E731  ignore our _vN suffix
        checks.append({"status": "ok", "text": "Name OK"} if stem(filename) == stem(want)
                      else {"status": "warning", "text": f"Rename to {os.path.splitext(want)[0]}"})
    else:
        checks.append({"status": "warning", "text": "Not linked to a figure"})
    return checks


def effective_ppi(m: Dict[str, Any], rules: Dict[str, Any]) -> Optional[int]:
    """Resolution when the image is placed at the template's column width."""
    if not m.get("width"):
        return None
    return round(m["width"] / (float(rules["placed_width_mm"]) / 25.4))


def article_figures(db: Session, article: JournalArticle) -> List[int]:
    """Figure numbers of the article: from its current JATS XML, else from 'Figure N' captions in the manuscript."""
    numbers = set()
    if article.jats_xml_path and os.path.exists(article.jats_xml_path):
        with open(article.jats_xml_path, encoding="utf-8", errors="replace") as fh:
            numbers |= {int(n) for n in re.findall(r"<fig\b[^>]*>\s*<label>\s*(?:Figure|Fig\.)\s*(\d+)", fh.read(), re.I)}
    if not numbers:
        from app.domains.journals.manuscript import load_blocks, resolve_manuscript_path
        path = resolve_manuscript_path(db, article)
        if path:
            for b in load_blocks(path):
                m = re.match(r"^(?:Figure|Fig\.)\s*(\d+)[.:]", b.text, re.I)
                if m:
                    numbers.add(int(m.group(1)))
    return sorted(numbers)


def capture_images_from_docx(db: Session, article: JournalArticle) -> List[Any]:
    """Extracts embedded drawings/images from the manuscript DOCX and registers them as Art files."""
    import logging
    import zipfile
    from xml.etree import ElementTree as ET
    from app.domains.journals.files import save_version, art_files
    from app.domains.journals.manuscript import resolve_manuscript_path

    logger = logging.getLogger(__name__)
    path = resolve_manuscript_path(db, article)
    if not path or not os.path.exists(path):
        return []

    existing = {f.figure_number: f for f in art_files(db, article.id) if f.figure_number is not None}
    all_figs = article_figures(db, article)

    try:
        with zipfile.ZipFile(path, "r") as z:
            names = set(z.namelist())
            media_names = [n for n in names if n.startswith("word/media/")]
            if not media_names:
                return []

            rels = {}
            if "word/_rels/document.xml.rels" in names:
                tree = ET.fromstring(z.read("word/_rels/document.xml.rels"))
                for rel in tree:
                    rid = rel.get("Id")
                    target = rel.get("Target")
                    if rid and target:
                        if not target.startswith("word/"):
                            target = "word/" + target.lstrip("../").lstrip("/")
                        rels[rid] = target

            import docx
            from docx.oxml.ns import qn
            doc = docx.Document(path)
            body_ps = list(doc.element.body.iter(qn("w:p")))

            captured: Dict[int, Any] = {}
            unlinked_images: List[Any] = []

            for idx, p in enumerate(body_ps):
                xml = p.xml
                embed_rids = re.findall(r'embed="([^"]+)"', xml)
                if not embed_rids:
                    continue

                for rid in embed_rids:
                    target_media = rels.get(rid)
                    if not target_media or target_media not in names:
                        continue
                    data = z.read(target_media)
                    orig_name = os.path.basename(target_media)

                    fig_num = None
                    for offset in [1, -1, 2, -2, 3]:
                        chk_idx = idx + offset
                        if 0 <= chk_idx < len(body_ps):
                            txt = docx.text.paragraph.Paragraph(body_ps[chk_idx], doc).text.strip()
                            m = re.match(r"^(?:Figure|Fig\.)\s*(\d+)", txt, re.I)
                            if m:
                                fig_num = int(m.group(1))
                                break

                    if fig_num is not None:
                        captured[fig_num] = (orig_name, data)
                    else:
                        unlinked_images.append((orig_name, data))

            # If any unlinked images remain and we have unassigned figure numbers
            unassigned = [n for n in all_figs if n not in captured and n not in existing]
            for n, (orig_name, data) in zip(unassigned, unlinked_images):
                captured[n] = (orig_name, data)

            if not captured and unlinked_images:
                for idx, (orig_name, data) in enumerate(unlinked_images, start=1):
                    captured[idx] = (orig_name, data)

            saved_rows = []
            for fig_num, (orig_name, data) in captured.items():
                if fig_num in existing:
                    continue
                ext = os.path.splitext(orig_name)[1].lower()
                if ext in (".tiff", ".tif"):
                    ext = ".tif"
                save_name = f"fig{fig_num}{ext}"
                row = save_version(db, article, "Art", save_name, data, "art", figure_number=fig_num)
                saved_rows.append(row)

            if saved_rows:
                db.commit()
            return saved_rows
    except Exception as e:
        logger.warning("Error capturing images from docx: %s", e)
        return []

