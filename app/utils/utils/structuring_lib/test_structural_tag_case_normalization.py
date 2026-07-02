"""normalize_structural_tag_case() must canonicalize the case of recognized
structural tags (e.g. "h1" -> "H1") while leaving built-in Word styles and
unrelated custom publisher styles untouched. This guards the docx/xhtml
round-trip save paths (manual style picker in Structuring Review), where a
style name read back from an existing document or HTML attribute may have
drifted in case from however it was originally authored."""

from app.utils.utils.structuring_lib.annotator import normalize_structural_tag_case


def test_lowercase_recognized_tag_is_canonicalized():
    assert normalize_structural_tag_case("h1") == "H1"
    assert normalize_structural_tag_case("H1") == "H1"


def test_lowercase_prefixed_tag_is_canonicalized():
    assert normalize_structural_tag_case("bl-first") == "BL-FIRST"


def test_builtin_word_styles_are_left_unchanged():
    assert normalize_structural_tag_case("Normal") == "Normal"
    assert normalize_structural_tag_case("Table Grid") == "Table Grid"


def test_unrecognized_custom_style_is_left_unchanged():
    assert normalize_structural_tag_case("MyCustomStyle") == "MyCustomStyle"


def test_empty_or_none_is_passed_through():
    assert normalize_structural_tag_case("") == ""
    assert normalize_structural_tag_case(None) is None
