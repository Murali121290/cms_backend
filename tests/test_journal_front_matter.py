"""Front matter from the tagged paragraphs (ArticleAuthor, ArticleAffiliation, CorrespondingAuthor) -> JATS."""
from lxml import etree

from app.domains.journals.jats import front_matter as fm
from app.domains.journals.jats.converter import ArticleMeta, convert_xhtml_to_jats
from app.domains.journals.jats.validator import validate_jats

S, E = fm.SUP_OPEN, fm.SUP_CLOSE


def test_jmir_author_line_with_degrees_and_marks():
    line = (f"Afaf Sulaiman Alblooshi{S}1*{E}, MD, PhD; Falah Mohammed Almarzooqi{S}2*{E}, MBchB, CCFP; "
            f"Taleb M Almansoori{S}3{E}, MBBS, FRCPC; Faten Abdullah AlRadini{S}4{E}, MD")
    authors = fm.parse_authors(line)
    assert [(a.given, a.surname) for a in authors] == [("Afaf Sulaiman", "Alblooshi"), ("Falah Mohammed", "Almarzooqi"),
                                                       ("Taleb M", "Almansoori"), ("Faten Abdullah", "AlRadini")]
    assert authors[0].degrees == ["MD", "PhD"] and authors[0].aff_labels == ["1"] and authors[0].note_symbols == ["*"]
    assert authors[3].aff_labels == ["4"] and authors[3].note_symbols == []


def test_comma_and_author_line():
    authors = fm.parse_authors(f"A. Smith{S}1,2{E}, B. Jones{S}2{E}, MD and C. Lee{S}1{E}")
    assert [(a.surname, a.aff_labels, a.degrees) for a in authors] == [("Smith", ["1", "2"], []), ("Jones", ["2"], ["MD"]), ("Lee", ["1"], [])]


def test_affiliations_and_equal_contribution_note():
    aff, note = fm.parse_affiliation(f"{S}1{E} Department of Medical Education, UAE University")
    assert aff.label == "1" and aff.text == "Department of Medical Education, UAE University" and note is None
    aff, note = fm.parse_affiliation("*these authors contributed equally")
    assert aff is None and note.symbol == "*" and note.text == "these authors contributed equally"
    name, lines, email = fm.parse_corresp(["Corresponding Author:", "Taleb M Almansoori, MBBS", "Department of Radiology",
                                           "Email: taleb@uaeu.ac.ae"])
    assert name == "Taleb M Almansoori" and email == "taleb@uaeu.ac.ae" and "Department of Radiology" in lines


def _p(style, html):
    return f'<p class="{style}" data-style-label="{style}">{html}</p>'


def test_tagged_front_matter_wins_over_metadata_and_is_dtd_valid():
    xhtml = "<html><body>" + "".join([
        _p("ArticleType", "Original Paper"),
        _p("ArticleTitle", "Refining the ITEM: Qualitative Study"),
        _p("ArticleAuthor", "Afaf Alblooshi<sup>1*</sup>, MD; Taleb M Almansoori<sup>2</sup>, MBBS"),
        _p("ArticleAffiliation", "<sup>1</sup> Department of Medical Education, UAE University"),
        _p("ArticleAffiliation", "<sup>2</sup> Department of Radiology, UAE University"),
        _p("ArticleAffiliation", "*these authors contributed equally"),
        _p("CorrespondingAuthor", "Corresponding Author:"),
        _p("CorrespondingAuthor", "Taleb M Almansoori, MBBS"),
        _p("CorrespondingAuthor", "Email: taleb@uaeu.ac.ae"),
        _p("AbstractHeading", "Abstract"),
        _p("Abstract", "Background: text."),
        _p("Keywords", "Keywords: a; b"),
        '<h1 class="Head1" data-style-label="Head1">Introduction</h1>',
        _p("TXT", "Body text."),
    ]) + "</body></html>"
    meta = ArticleMeta(journal_code="JR", journal_title="JR", issn_print="1234-5678", doi="10.1/x",
                       authors=["Refining the ITEM Qualitative Study"], affiliations=["guessed"])
    xml = convert_xhtml_to_jats(xhtml, meta)
    assert not [f for f in validate_jats(xml) if f.severity == "error"], [f.message for f in validate_jats(xml)]
    doc = etree.fromstring(xml)
    am = doc.find("front/article-meta")
    assert am.findtext("article-categories/subj-group/subject") == "Original Paper"
    names = [(c.findtext("name/given-names"), c.findtext("name/surname")) for c in am.iter("contrib")]
    assert names == [("Afaf", "Alblooshi"), ("Taleb M", "Almansoori")]  # not the title from the metadata guess
    first, second = list(am.iter("contrib"))
    assert first.get("equal-contrib") == "yes" and first.find("xref[@ref-type='aff']").get("rid") == "aff1"
    assert second.get("corresp") == "yes" and second.find("xref[@ref-type='corresp']") is not None
    assert [a.findtext("label") for a in am.iter("aff")] == ["1", "2"]
    assert am.findtext("author-notes/corresp/email") == "taleb@uaeu.ac.ae"
    assert am.findtext("author-notes/fn/p") == "these authors contributed equally"
    body = etree.tostring(doc.find("body"), encoding="unicode")
    assert "Corresponding Author" not in body and "contributed equally" not in body
