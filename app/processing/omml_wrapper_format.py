"""Inject "wrapper" formatting (bold / italic / color / size / font) into the
`<m:rPr>` of every `<m:r>` inside an already-built OMML tree.

Word encodes bold/italic on math runs via `<m:sty m:val="b|i|bi|p"/>` inside
`<m:rPr>`, and encodes text-like properties (color, size, font) via a nested
`<w:rPr>` inside the same `<m:rPr>`. We apply both.

This runs after mathml2omml (or the raw-OMML injection) so both edited and
unedited equations pick up the formatting the user set via the outer toolbar.
"""

from __future__ import annotations

from lxml import etree

_M_NS_URI = "http://schemas.openxmlformats.org/officeDocument/2006/math"
_W_NS_URI = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"

_M = "{%s}" % _M_NS_URI
_W = "{%s}" % _W_NS_URI


def _ensure_child(parent, tag_qualified: str, insert_first: bool = True):
    """Return the first child with `tag_qualified`, creating one if missing.

    `insert_first=True` puts a newly-created element at position 0 so that
    property elements land before content siblings (OOXML convention).
    """
    existing = parent.find(tag_qualified)
    if existing is not None:
        return existing
    child = etree.SubElement(parent, tag_qualified)
    if insert_first and len(parent) > 1:
        # SubElement appends; move to front.
        parent.remove(child)
        parent.insert(0, child)
    return child


def _merge_math_style(m_rpr, bold: bool, italic: bool) -> None:
    """Set `<m:sty m:val="…"/>` — b / i / bi / p — on an `<m:rPr>`."""
    if not (bold or italic):
        return
    if bold and italic:
        val = "bi"
    elif bold:
        val = "b"
    else:
        val = "i"
    sty = m_rpr.find(f"{_M}sty")
    if sty is None:
        sty = etree.SubElement(m_rpr, f"{_M}sty")
    sty.set(f"{_M}val", val)


def _merge_text_props(m_rpr, *, bold: bool, italic: bool, color: str,
                      bg_color: str, size_pt: str, font_family: str) -> None:
    """Inject a `<w:rPr>` inside `<m:rPr>` with text-level formatting."""
    if not (bold or italic or color or bg_color or size_pt or font_family):
        return

    w_rpr = m_rpr.find(f"{_W}rPr")
    if w_rpr is None:
        w_rpr = etree.SubElement(m_rpr, f"{_W}rPr")

    def _set(tag: str, attrs: dict) -> None:
        # Overwrite (or add) a property element.
        for existing in w_rpr.findall(f"{_W}{tag}"):
            w_rpr.remove(existing)
        el = etree.SubElement(w_rpr, f"{_W}{tag}")
        for k, v in attrs.items():
            el.set(f"{_W}{k}", v)

    if bold:
        _set("b", {"val": "true"})
        _set("bCs", {"val": "true"})
    if italic:
        _set("i", {"val": "true"})
        _set("iCs", {"val": "true"})
    if color:
        _set("color", {"val": color})
    if bg_color:
        _set("highlight", {"val": bg_color})  # highlight expects a name, but
        # some readers accept hex; also emit shd for reliable coloring
        for existing in w_rpr.findall(f"{_W}shd"):
            w_rpr.remove(existing)
        shd = etree.SubElement(w_rpr, f"{_W}shd")
        shd.set(f"{_W}val", "clear")
        shd.set(f"{_W}color", "auto")
        shd.set(f"{_W}fill", bg_color)
    if size_pt:
        # Word stores size in half-points.
        try:
            half_pts = str(int(float(size_pt) * 2))
        except ValueError:
            half_pts = size_pt
        _set("sz", {"val": half_pts})
        _set("szCs", {"val": half_pts})
    if font_family:
        for existing in w_rpr.findall(f"{_W}rFonts"):
            w_rpr.remove(existing)
        rFonts = etree.SubElement(w_rpr, f"{_W}rFonts")
        rFonts.set(f"{_W}ascii", font_family)
        rFonts.set(f"{_W}hAnsi", font_family)
        rFonts.set(f"{_W}cs", font_family)


def detect_wrapper_formatting(omml_root) -> dict:
    """Read the formatting from the first `<m:r>` and return wrapper attrs.

    Returned dict is suitable for direct html.escape+embed as data-wrapper-*
    attributes on the math span emitted by the runs engine. Keys:
    bold (bool), italic (bool), color (hex, no leading '#'), bg_color (same),
    size_pt (str), font_family (str). Missing values return "" or False.
    """
    result = {
        "bold": False,
        "italic": False,
        "color": "",
        "bg_color": "",
        "size_pt": "",
        "font_family": "",
    }
    first_r = omml_root.find(f".//{_M}r")
    if first_r is None:
        return result

    m_rpr = first_r.find(f"{_M}rPr")
    if m_rpr is None:
        return result

    sty = m_rpr.find(f"{_M}sty")
    if sty is not None:
        val = sty.get(f"{_M}val", "")
        if val == "b":
            result["bold"] = True
        elif val == "i":
            result["italic"] = True
        elif val == "bi":
            result["bold"] = True
            result["italic"] = True

    w_rpr = m_rpr.find(f"{_W}rPr")
    if w_rpr is not None:
        # bold / italic (Word encodes on/off as either <w:b/> alone or
        # <w:b w:val="true|1|on"/> — we treat any presence as bold).
        if w_rpr.find(f"{_W}b") is not None:
            v = w_rpr.find(f"{_W}b").get(f"{_W}val", "true")
            if v.lower() not in ("false", "0", "off"):
                result["bold"] = True
        if w_rpr.find(f"{_W}i") is not None:
            v = w_rpr.find(f"{_W}i").get(f"{_W}val", "true")
            if v.lower() not in ("false", "0", "off"):
                result["italic"] = True
        color_el = w_rpr.find(f"{_W}color")
        if color_el is not None:
            val = color_el.get(f"{_W}val", "")
            if val and val.lower() != "auto":
                result["color"] = val
        shd = w_rpr.find(f"{_W}shd")
        if shd is not None:
            fill = shd.get(f"{_W}fill", "")
            if fill and fill.lower() != "auto":
                result["bg_color"] = fill
        sz = w_rpr.find(f"{_W}sz")
        if sz is not None:
            val = sz.get(f"{_W}val", "")
            if val:
                try:
                    result["size_pt"] = str(int(val) // 2)  # half-points → points
                except ValueError:
                    result["size_pt"] = val
        rFonts = w_rpr.find(f"{_W}rFonts")
        if rFonts is not None:
            fam = (
                rFonts.get(f"{_W}ascii")
                or rFonts.get(f"{_W}hAnsi")
                or rFonts.get(f"{_W}cs")
                or ""
            )
            # Cambria Math is the default math font; not a user-intended wrapper.
            if fam and fam.lower() != "cambria math":
                result["font_family"] = fam

    return result


def apply_wrapper_formatting(
    omml_root,
    *,
    bold: bool = False,
    italic: bool = False,
    color: str = "",
    bg_color: str = "",
    size_pt: str = "",
    font_family: str = "",
) -> None:
    """Apply wrapper formatting to every `<m:r>` under `omml_root`.

    `omml_root` may be `<m:oMath>` or `<m:oMathPara>`; both are walked
    recursively. Existing formatting on individual runs is preserved and
    merged with the wrapper values.
    """
    if not (bold or italic or color or bg_color or size_pt or font_family):
        return

    for r in omml_root.iter(f"{_M}r"):
        m_rpr = r.find(f"{_M}rPr")
        if m_rpr is None:
            m_rpr = etree.Element(f"{_M}rPr")
            r.insert(0, m_rpr)

        _merge_math_style(m_rpr, bold=bold, italic=italic)
        _merge_text_props(
            m_rpr,
            bold=bold,
            italic=italic,
            color=color,
            bg_color=bg_color,
            size_pt=size_pt,
            font_family=font_family,
        )
