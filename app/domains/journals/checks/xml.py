"""Stage 3 (XML Conversion): JATS 1.3 DTD validation and publisher rules on the article's current JATS XML."""
import os
import re

from app.domains.journals.checks.base import CheckResult, IssueDraft, JournalCheck, register
from app.domains.journals.files import art_file_paths
from app.domains.journals.jats.validator import validate_jats
from app.domains.journals.models import JournalIssue

RULES = ("XML-WF", "DTD-IDREF", "DTD-ID", "DTD-ELEM", "DTD-ATTR", "DTD-CONTENT", "DTD-CHILD", "DTD-OTHER",
         "JATS-X03", "JATS-X04", "JATS-M01", "PKG-A01")


@register
class XmlCheck(JournalCheck):
    key = "xml"
    name = "XML & DTD validation"

    def run(self, article, db) -> CheckResult:
        if not article.jats_xml_path or not os.path.exists(article.jats_xml_path):
            raise FileNotFoundError("No JATS XML exists for this article yet. Convert it first")
        with open(article.jats_xml_path, "rb") as fh:
            xml = fh.read()
        lines = xml.decode("utf-8", errors="replace").splitlines()
        assets = [os.path.basename(p) for p in art_file_paths(db, article.id)]
        findings = validate_jats(xml, assets=assets)

        # Upstream causes: a dangling bibN IDREF comes from a citation with no matching reference.
        missing_refs = {}
        for issue in db.query(JournalIssue).filter(JournalIssue.article_id == article.id, JournalIssue.module == "references",
                                                   JournalIssue.rule_id == "REF-X01", JournalIssue.status == "open").all():
            m = re.search(r"[\[(](\d+)[\])]", issue.title)
            if m:
                missing_refs.setdefault(f"bib{m.group(1)}", issue.id)

        issues = []
        for f in findings:
            context = lines[f.line - 1].strip() if f.line and 0 < f.line <= len(lines) else None
            source = missing_refs.get(f.detail) if f.rule_id == "DTD-IDREF" else None
            issues.append(IssueDraft(
                rule_id=f.rule_id, severity=f.severity, title=f.title, message=f.message,
                location={"xml_line": f.line} if f.line else None, context_snippet=context,
                fingerprint=f"{f.rule_id}:{f.detail or re.sub(r'article.xml:[0-9]+: ', '', f.message)}"[:255],
                source_issue_id=source,
            ))
        return CheckResult(issues=issues, rules_total=len(RULES), rule_set_version="JATS 1.3 Journal Publishing (MathML 3)")
