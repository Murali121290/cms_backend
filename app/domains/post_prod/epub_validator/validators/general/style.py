from ...engine.registry import rule
from ...services import book_bundle_service as _bundle
from ._common import _cli_issue_to_web, _drop_pass_issues


@rule("PDF001")
def validate_pdf_style_parity(book_details):
    """Book-scope: StyleComparator — paragraph splitting, italic/case/colour
    parity, alignment, indentation, blockquote, images, page count, etc.
    """
    from ...vendor.pdf_epub_validator import StyleComparator

    folder = book_details["folder_name"]
    bundle = _bundle.get_epub_bundle(folder)
    pdf = _bundle.get_pdf_doc(folder)
    if not bundle or not pdf:
        return {"issues_count": 0, "issues": []}
    cli_issues = StyleComparator(bundle, pdf).run_all()
    issues = _drop_pass_issues([_cli_issue_to_web(i) for i in cli_issues])
    return {"issues_count": len(issues), "issues": issues}
