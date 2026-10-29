"""Round-trip test: Language Editor's `<ins>`/`<del>` HTML emitted when
Track Changes is ON must become `w:ins` / `w:del` revision markup in the
DOCX export. The backend side of the contract is handled by
`XhtmlToDocxEngine._rebuild_paragraph_runs`; this test locks it in so the
styled-tracked-changes feature doesn't silently stop producing real Word
revisions.
"""
import pytest

from docx import Document
from lxml import etree

from app.processing.xhtml_to_docx import XhtmlToDocxEngine


def _rebuild_from(html_fragment: str):
    """Parse `html_fragment` (a `<p>…</p>` string) and rebuild a fresh
    python-docx paragraph's runs from it. Returns the serialized paragraph XML."""
    doc = Document()
    para = doc.add_paragraph()
    html_el = etree.fromstring(html_fragment)
    engine = XhtmlToDocxEngine()
    engine._rebuild_paragraph_runs(para, html_el, username="Reviewer")
    return etree.tostring(para._element, encoding="unicode")


def test_tracked_insertion_becomes_wins_element():
    html = (
        '<p>'
        'The '
        '<del class="tc-delete" data-author="Reviewer" data-date="2026-10-22T00:00:00Z">'
        'anti-anxiety'
        '</del>'
        '<ins class="tc-insert" data-author="Reviewer" data-date="2026-10-22T00:00:00Z">'
        'ANTI-ANXIETY'
        '</ins>'
        ' protocol.'
        '</p>'
    )
    xml = _rebuild_from(html)
    assert "w:ins" in xml, "<ins> did not become <w:ins>:\n" + xml
    assert "w:del" in xml, "<del> did not become <w:del>:\n" + xml
    # Deletion content uses w:delText so Word recognises it as struck-through
    # revision content, not ordinary visible text.
    assert "w:delText" in xml, "<del> content must emit <w:delText>:\n" + xml
    # Hyphen preserved on both sides.
    assert "anti-anxiety" in xml
    assert "ANTI-ANXIETY" in xml


@pytest.mark.parametrize(
    "orig,repl",
    [
        ("non-nurturing", "NON-NURTURING"),
        ("pre-intervention", "PRE-INTERVENTION"),
        ("post-intervention", "POST-INTERVENTION"),
        ("anti-anxiety", "ANTI-ANXIETY"),
    ],
)
def test_hyphenated_tracked_replace_round_trips(orig, repl):
    html = (
        f'<p>a <del class="tc-delete" data-author="Reviewer" data-date="2026-10-22T00:00:00Z">'
        f'{orig}</del>'
        f'<ins class="tc-insert" data-author="Reviewer" data-date="2026-10-22T00:00:00Z">'
        f'{repl}</ins> word.</p>'
    )
    xml = _rebuild_from(html)
    assert "w:ins" in xml
    assert "w:del" in xml
    assert orig in xml
    assert repl in xml


def test_tracked_changes_carry_author_and_date():
    html = (
        '<p>'
        '<del class="tc-delete" data-author="Alice" data-date="2026-10-22T12:00:00Z">x</del>'
        '<ins class="tc-insert" data-author="Alice" data-date="2026-10-22T12:00:00Z">y</ins>'
        '</p>'
    )
    xml = _rebuild_from(html)
    assert 'w:author="Alice"' in xml
    assert 'w:date="2026-10-22T12:00:00Z"' in xml


def test_untracked_html_emits_plain_runs_only():
    """When TC is OFF the frontend emits plain text (no <ins>/<del>). That
    HTML must not produce w:ins or w:del in the DOCX output."""
    html = "<p>The ANTI-ANXIETY protocol.</p>"
    xml = _rebuild_from(html)
    assert "w:ins" not in xml
    assert "w:del" not in xml
    assert "ANTI-ANXIETY" in xml


def test_multiple_tracked_changes_each_get_unique_revision_id():
    """Repeated tracked changes in one paragraph must each carry their own
    w:id. If two insertions shared the same id Word would treat them as a
    single revision — rejecting one would silently reject the other."""
    html = (
        '<p>'
        '<ins class="tc-insert" data-author="Reviewer" data-date="2026-10-22T00:00:00Z">one</ins>'
        ' and '
        '<ins class="tc-insert" data-author="Reviewer" data-date="2026-10-22T00:00:00Z">two</ins>'
        '</p>'
    )
    xml = _rebuild_from(html)
    # Count unique w:id attribute values on w:ins elements.
    root = etree.fromstring(xml)
    ns = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
    ids = [el.get("{%s}id" % ns["w"]) for el in root.findall(".//w:ins", ns)]
    assert len(ids) == 2
    assert len(set(ids)) == 2, f"ins w:ids were not unique: {ids}"
