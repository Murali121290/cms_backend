"""Pre-Editing step 3: the IA rules selected in Journal settings → IA rules.

Runs the same manuscript_core analyzer as the book Technical Review page on the article's
working copy, keeps only the findings covered by the journal's selected IA rows (the shared
ia_selection matcher, so book and journal agree), and applies the selection's preferred forms
to the suggested replacements. Findings carry para_idx + surface, so the editor highlights them
and "Apply fix" works as for the other checks.
"""
import os
from typing import List

from app.domains.journals.checks.base import CheckResult, IssueDraft, JournalCheck, register
from app.domains.journals.manuscript import load_blocks, resolve_manuscript_path

SEVERITY = {"error": "error", "warn": "warning", "warning": "warning", "info": "info"}


def analyze_docx(path: str) -> List[dict]:
    """manuscript_core findings for one DOCX (tests replace this to avoid running the full analyzer)."""
    from app.processing.manuscript_core.analyzer import analyze_manuscript
    chapters = [{"index": 1, "filename": os.path.basename(path), "path": path, "client_name": "Journal",
                 "project_name": "Journal", "role": "PM", "ia_mapping_path": ""}]
    return analyze_manuscript(chapters).get("findings", [])


def selected_elements(db, article) -> set:
    """IA elements the journal selected (e.g. {"Ranges", "Units"}); used to avoid duplicate technical findings."""
    from app.domains.journals.book_review import selected_ia_rows
    return {r.get("element") for r in selected_ia_rows(db, article.journal) if r.get("element")}


def _snippet(context: str) -> str:
    return (context or "").replace("⟪", "").replace("⟫", "")[:300]


@register
class IaRulesCheck(JournalCheck):
    key = "ia_rules"
    name = "IA rules"

    def run(self, article, db) -> CheckResult:
        from app.domains.journals.book_review import selected_ia_rows
        from app.processing.manuscript_core.ia_selection import annotate_with_stylesheet

        rows = selected_ia_rows(db, article.journal)
        if not rows:
            return CheckResult(issues=[IssueDraft(
                rule_id="IA-00", severity="error", title="No IA rules selected for this journal",
                message="Choose the rules in Journal settings → IA rules, then run this step again. "
                        "Mark this fixed if the journal uses no IA rules.",
                suggestion={"type": "signoff"}, fingerprint="IA-00",
            )], rules_total=1, rule_set_version="IA template")

        path = resolve_manuscript_path(db, article)
        if not path:
            raise FileNotFoundError("No manuscript DOCX is attached to this article")
        findings = annotate_with_stylesheet(analyze_docx(path), rows)
        texts = {b.idx: b.text for b in load_blocks(path)}

        issues: List[IssueDraft] = []
        for f in findings:
            if not f.get("in_stylesheet"):
                continue
            para = f.get("para_index")
            surface = f.get("surface") or ""
            start = f.get("match_start")
            body = (f.get("source") or "body") == "body" and para is not None
            text = texts.get(para, "") if body else ""
            if body and surface and (start is None or text[start:start + len(surface)] != surface):
                # Some rules report match_start 0; find the surface in the paragraph instead.
                start = text.find(surface) if surface in text else None
            location = {"para_idx": para, "block_id": f"p{para}", "surface": surface} if body else {"surface": surface}
            if body and start is not None:
                location.update(start=start, end=start + len(surface))
            replacement = f.get("replacement")
            issues.append(IssueDraft(
                rule_id=f"IA:{f.get('rule_id')}",
                severity=SEVERITY.get((f.get("severity") or "info").lower(), "info"),
                title=f.get("rule_label") or f.get("rule_id") or "IA rule",
                message=(f"Journal style: {replacement}" if replacement else None),
                location=location,
                context_snippet=_snippet(f.get("context")),
                suggestion={"type": "replace", "from": surface, "to": replacement} if replacement and replacement != surface else None,
                fingerprint=f"IA:{f.get('rule_id')}:{para}:{start}:{surface}"[:255],
            ))
        return CheckResult(issues=issues, rules_total=len(rows), rule_set_version="IA template")
