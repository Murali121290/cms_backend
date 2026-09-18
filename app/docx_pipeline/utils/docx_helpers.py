"""
utils/docx_helpers.py â€” Shared helpers for python-docx and lxml operations.
"""

from lxml import etree
from docx.oxml.ns import qn
from docx.oxml import OxmlElement, parse_xml
from docx.opc.constants import RELATIONSHIP_TYPE as RT
from docx.opc.constants import CONTENT_TYPE as CT
from docx.opc.packuri import PackURI
from docx.opc.part import XmlPart
import datetime


W  = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
W_ = "{%s}" % W


# â”€â”€ Paragraph helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

def para_style_name(para) -> str:
    """Return paragraph style name (python-docx Paragraph object)."""
    try:
        return para.style.name or ""
    except Exception:
        return ""


def para_text(para) -> str:
    """Full text of a python-docx Paragraph."""
    return para.text or ""


def is_empty_para(para) -> bool:
    """True if paragraph has no visible text."""
    return not para.text.strip()


# â”€â”€ XML element helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

def xml_style_name(el: etree._Element) -> str | None:
    """Return paragraph style name from a raw w:p lxml element."""
    pStyle = el.find(f".//{W_}pStyle")
    if pStyle is not None:
        return pStyle.get(W_ + "val")
    return None


def xml_para_text(el: etree._Element) -> str:
    """Concatenate all w:t text nodes in a w:p lxml element."""
    return "".join(t.text or "" for t in el.iter(W_ + "t"))


def iter_body_children(body: etree._Element):
    """Yield (index, element) for direct children of w:body."""
    for i, child in enumerate(body):
        yield i, child


def get_run_formatting(run) -> tuple[bool, bool]:
    """
    Return (is_bold, is_italic) for a python-docx Run,
    considering both direct formatting and character style.
    """
    bold   = run.bold   if run.bold   is not None else False
    italic = run.italic if run.italic is not None else False
    # Also check character style
    if run.style:
        sname = run.style.name.lower()
        if "bold italic" in sname or "bolditalic" in sname:
            bold, italic = True, True
        elif "bold" in sname:
            bold = True
        elif "italic" in sname:
            italic = True
    return bool(bold), bool(italic)


# â”€â”€ Office Document Comment Injection â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

def add_comment_to_paragraph(
    doc,
    para,
    text: str,
    author: str = "Pipeline Validation",
    *,
    anchor_runs=None,
    range_mode: str = "paragraph",
):
    """Add a native Word comment to `para`.

    ``anchor_runs`` — optional list of `<w:r>` lxml elements (already inside
    `para`) that the comment range should wrap. When supplied, the range spans
    from just before the first anchor run to just after the last, so Word only
    shades the specific text those runs contain. This matches the golden DOCX
    behaviour where citation/reference AQs anchor to the citation text itself,
    never to the whole paragraph.

    ``range_mode`` — how to place the range when ``anchor_runs`` is not given:

    * ``"paragraph"`` (default, back-compat) — wraps the entire paragraph. Kept
      for the heading-validation callers that intentionally comment on the
      whole heading.
    * ``"point"`` — inserts a zero-length range right after `<w:pPr>`. Word
      shows a marker but does not shade the paragraph. Use for AQs that should
      not visually highlight anything (e.g. "unused reference" when we can't
      pinpoint a specific run).
    """
    # 1. Acquire or build the comments.xml package relationship
    comments_part = None
    for rel in doc.part.rels.values():
        if rel.reltype == RT.COMMENTS:
            comments_part = rel.target_part
            break
            
    if not comments_part:
        # Create brand new comments.xml structural part if file has no comments yet
        comments_xml = f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:comments xmlns:w="{W}"></w:comments>'.encode('utf-8')
        comments_part = XmlPart(
            partname=PackURI('/word/comments.xml'),
            content_type=CT.WML_COMMENTS,
            element=parse_xml(comments_xml),
            package=doc.part.package
        )
        doc.part.relate_to(comments_part, RT.COMMENTS)
        
    comments_el = comments_part.element
    
    # 2. Derive unique comment tracking ID
    existing_ids = [int(c.get(qn('w:id'))) for c in comments_el.findall(qn('w:comment')) if c.get(qn('w:id')) and c.get(qn('w:id')).isdigit()]
    comment_id = str(max(existing_ids + [0]) + 1)
    
    # 3. Create actual <w:comment> XML footprint
    date_str = datetime.datetime.now().strftime("%Y-%m-%dT%H:%M:%SZ")
    comment_node = OxmlElement('w:comment')
    comment_node.set(qn('w:id'), comment_id)
    comment_node.set(qn('w:author'), author)
    comment_node.set(qn('w:date'), date_str)
    comment_node.set(qn('w:initials'), "Auto")
    
    # Text run inside the comment
    cp = OxmlElement('w:p')
    cr = OxmlElement('w:r')
    ct = OxmlElement('w:t')
    ct.text = text
    cr.append(ct)
    cp.append(cr)
    comment_node.append(cp)
    
    comments_el.append(comment_node)
    
    # 4. Bind the comment marker to the user's paragraph.
    #    OOXML requires <w:pPr> to be the first child of <w:p> when present, so
    #    commentRangeStart must come AFTER pPr — inserting at index 0 produces
    #    a document Word will flag as needing repair.
    p_el = para._element

    pPr_el = p_el.find(qn('w:pPr'))
    after_pPr_idx = (list(p_el).index(pPr_el) + 1) if pPr_el is not None else 0

    c_start = OxmlElement('w:commentRangeStart')
    c_start.set(qn('w:id'), comment_id)
    c_end = OxmlElement('w:commentRangeEnd')
    c_end.set(qn('w:id'), comment_id)

    r_node = OxmlElement('w:r')
    c_ref = OxmlElement('w:commentReference')
    c_ref.set(qn('w:id'), comment_id)
    r_node.append(c_ref)

    valid_anchor_runs = [r for r in (anchor_runs or []) if r is not None and r.getparent() is p_el]

    if valid_anchor_runs:
        # Anchor the range around the specific runs. Insert commentRangeStart
        # immediately before the first anchor and commentRangeEnd immediately
        # after the last — Word will highlight exactly that text and nothing
        # else, matching the golden DOCX's behaviour.
        first = valid_anchor_runs[0]
        last = valid_anchor_runs[-1]
        first_idx = list(p_el).index(first)
        p_el.insert(first_idx, c_start)
        # Re-lookup last's index because the insert above shifted positions.
        last_idx = list(p_el).index(last)
        p_el.insert(last_idx + 1, c_end)
        # commentReference sits at end of paragraph so all Word clients pick
        # it up regardless of whether they render range or reference markers.
        p_el.append(r_node)
    elif range_mode == "point":
        # Zero-length range: start and end are adjacent, so Word shows a
        # marker but does not shade any text. Used when we know the paragraph
        # the AQ belongs to but not the specific target text.
        p_el.insert(after_pPr_idx, c_start)
        p_el.insert(after_pPr_idx + 1, c_end)
        p_el.append(r_node)
    else:
        # Legacy "paragraph" mode — wraps the whole paragraph. Kept for
        # heading-validation callers that intentionally comment on the entire
        # heading. Word renders this as a full-paragraph shade, which is
        # exactly what the citation/reference workflow must NOT do.
        p_el.insert(after_pPr_idx, c_start)
        p_el.append(c_end)
        p_el.append(r_node)

