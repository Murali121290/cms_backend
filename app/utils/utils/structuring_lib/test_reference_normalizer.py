"""Gap #7: numbered reference entries must be renumbered sequentially from 1
within each contiguous run, rewriting only the leading number, leaving the
rest of the entry's text untouched."""

from app.utils.utils.structuring_lib.reference_normalizer import normalize_reference_numbers


class _StubRun:
    def __init__(self, text):
        self.text = text


class _StubPara:
    def __init__(self, text):
        self.runs = [_StubRun(text)]

    @property
    def text(self):
        return "".join(r.text for r in self.runs)


def _ann(tag, text):
    return {"tag": tag, "para": _StubPara(text)}


def test_renumbers_sequentially_from_one_despite_author_sloppiness():
    annotations = [
        _ann("REF-N", "3. Smith J. Title A. Journal. 2019."),
        _ann("REF-N", "7. Jones K. Title B. Journal. 2020."),
        _ann("REF-N", "7. Lee M. Title C. Journal. 2021."),
    ]
    normalize_reference_numbers(annotations)
    texts = [a["para"].text for a in annotations]
    assert texts == [
        "1. Smith J. Title A. Journal. 2019.",
        "2. Jones K. Title B. Journal. 2020.",
        "3. Lee M. Title C. Journal. 2021.",
    ]


def test_idempotent_when_already_correctly_numbered():
    annotations = [
        _ann("REF-N", "1. Smith J. Title A."),
        _ann("REF-N", "2. Jones K. Title B."),
    ]
    normalize_reference_numbers(annotations)
    texts = [a["para"].text for a in annotations]
    assert texts == ["1. Smith J. Title A.", "2. Jones K. Title B."]


def test_run_resets_across_a_non_reference_break():
    annotations = [
        _ann("REF-N", "5. First entry."),
        _ann("H2", "Some Heading"),
        _ann("REF-N", "9. Second run entry."),
    ]
    normalize_reference_numbers(annotations)
    texts = [a["para"].text for a in annotations]
    assert texts[0] == "1. First entry."
    assert texts[2] == "1. Second run entry."
