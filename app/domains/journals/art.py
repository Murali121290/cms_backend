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
