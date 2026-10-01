"""Stages 6-7: InDesign final QC checklist and proof approval.

Both run automatically when the InDesign server returns a new layout. Each
item is an open error until someone signs it off with the "accept" action,
so stage 6 cannot be left with unchecked QC items and stage 7 cannot be left
without an approved proof.
"""
import json

from app.domains.journals.checks.base import CheckResult, IssueDraft, JournalCheck, register
from app.domains.journals.files import latest_file

QC_CHECKLIST = [
    ("QC-OVERSET", "No overset text", "Every text frame fits; no red overset markers remain."),
    ("QC-FONTS", "All fonts present", "Preflight shows no missing or substituted fonts."),
    ("QC-IMAGES", "Images at print resolution", "Every placed image is 300 ppi or higher at its placed size."),
    ("QC-HEADS", "Running heads and folios correct", "Running heads, page numbers, DOI and citation line match the article."),
    ("QC-FIGTAB", "Figures and tables placed", "Each figure and table appears after its first callout, with its caption."),
    ("QC-BREAKS", "Clean breaks", "No widows, orphans, stacked hyphens or tables split without a continued header."),
    ("QC-MATH", "Equations render", "Display and inline equations match the manuscript."),
    ("QC-REFS", "References complete", "The reference list matches the XML, with nothing cut off."),
]


@register
class InDesignQcCheck(JournalCheck):
    key = "indesign_qc"
    name = "InDesign final QC"
    auto_only = True

    def run(self, article, db) -> CheckResult:
        indd = latest_file(db, article.id, "INDD")
        version = indd.version if indd else 0
        issues = []
        preflight = latest_file(db, article.id, "Preflight")
        if preflight:
            try:
                with open(preflight.path, encoding="utf-8") as fh:
                    report = json.load(fh)
            except (OSError, ValueError):
                report = {}
            if report.get("overset_frames"):
                issues.append(IssueDraft(rule_id="PF-OVERSET", severity="error", title=f"{report['overset_frames']} overset text frame(s)",
                                         message="The InDesign preflight found text that does not fit its frame.", fingerprint=f"PF-OVERSET:v{version}"))
            for font in report.get("missing_fonts") or []:
                issues.append(IssueDraft(rule_id="PF-FONT", severity="error", title=f"Missing font “{font}”",
                                         message="Install the font on the InDesign server or update the journal template.", fingerprint=f"PF-FONT:{font}:v{version}"))
            for img in report.get("low_res_images") or []:
                name = img.get("name") if isinstance(img, dict) else str(img)
                ppi = img.get("ppi") if isinstance(img, dict) else None
                issues.append(IssueDraft(rule_id="PF-IMAGE", severity="warning", title=f"Low-resolution image “{name}”" + (f" ({ppi} ppi)" if ppi else ""),
                                         message="Replace it with a 300 ppi or higher version.", fingerprint=f"PF-IMAGE:{name}:v{version}"))
        for rule, title, message in QC_CHECKLIST:
            issues.append(IssueDraft(rule_id=rule, severity="error", title=f"QC: {title}", message=message,
                                     suggestion={"type": "signoff"}, fingerprint=f"{rule}:v{version}"))
        return CheckResult(issues=issues, rules_total=len(QC_CHECKLIST) + 3, rule_set_version=f"InDesign v{version}")


@register
class ProofCheck(JournalCheck):
    key = "proof"
    name = "Proof approval"
    auto_only = True

    def run(self, article, db) -> CheckResult:
        pdf = latest_file(db, article.id, "Proof_PDF")
        if not pdf:
            return CheckResult(issues=[IssueDraft(rule_id="PROOF-00", severity="error", title="No proof PDF yet",
                                                  message="Generate the InDesign layout to produce a proof.", fingerprint="PROOF-00")], rules_total=1)
        return CheckResult(issues=[IssueDraft(
            rule_id="PROOF-01", severity="error", title=f"Proof v{pdf.version} awaiting approval",
            message="Review the proof PDF with the author and editor. Accept this item to record approval.",
            location={"file_id": pdf.id}, suggestion={"type": "signoff"}, fingerprint=f"PROOF-01:v{pdf.version}",
        )], rules_total=1, rule_set_version=f"Proof v{pdf.version}")
