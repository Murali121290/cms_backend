from lxml import etree
from app.domains.review.reference_edit_service import _apply_word_level_track_changes, W_NS, W

def test_apply_word_level_track_changes_preserves_common_prefix():
    p = etree.Element(W + "p", nsmap={"w": W_NS})
    r = etree.SubElement(p, W + "r")
    t = etree.SubElement(r, W + "t")
    old_text = "8. Becker R, Wegner RD. Detailed screening. 2006;27(6):613-618."
    t.text = old_text

    new_text = "8. Becker R, Wegner RD. Detailed screening. 2006;27(6):613-8. doi:10.1002/uog.2709"

    _apply_word_level_track_changes(
        p,
        old_text=old_text,
        new_text=new_text,
        sample_run=r,
        author="Reviewer",
        now="2026-09-18T12:00:00Z",
        rev_id=1,
    )

    xml_str = etree.tostring(p, encoding="utf-8").decode("utf-8")

    # The prefix "8. Becker R, Wegner RD." MUST be present in plain run (not inside del/ins)
    assert "8. Becker R, Wegner RD." in xml_str

    # Find del and ins elements in paragraph
    dels = p.findall(W + "del")
    inss = p.findall(W + "ins")

    assert len(dels) > 0
    assert len(inss) > 0

    # Ensure inserted text contains the DOI
    ins_texts = ["".join(el.itertext()) for el in inss]
    assert any("doi:10.1002/uog.2709" in text for text in ins_texts)
