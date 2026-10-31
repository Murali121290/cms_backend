"""Pre-Editing step 3: the IA rules selected in Journal settings → IA rules.

Runs the same manuscript_core analyzer as the book Technical Review page on the article's
working copy, keeps only the findings covered by the journal's selected IA rows (the shared
ia_selection matcher, so book and journal agree), and applies the selection's preferred forms
to the suggested replacements. Findings carry para_idx + surface, so the editor highlights them
and "Apply fix" works as for the other checks.
"""
import os
import logging
from typing import List

from app.domains.journals.checks.base import CheckResult, IssueDraft, JournalCheck, register
from app.domains.journals.manuscript import load_blocks, resolve_manuscript_path

logger = logging.getLogger(__name__)

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
        from app.domains.journals.book_review import selected_ce_rules, selected_ia_rows
        from app.processing.manuscript_core.ia_selection import annotate_with_stylesheet

        rows = selected_ia_rows(db, article.journal)
        ce_rules = selected_ce_rules(db, article.journal)
        if not rows:
            from app.domains.journals.book_review import ia_catalog, save_journal_ia_rules
            rows = ia_catalog()
            try:
                save_journal_ia_rules(db, article.journal, rows)
            except Exception:
                pass

        path = resolve_manuscript_path(db, article)
        if not path:
            raise FileNotFoundError("No manuscript DOCX is attached to this article")
        findings = annotate_with_stylesheet(analyze_docx(path), rows, ce_rules=ce_rules)
        texts = {b.idx: b.text for b in load_blocks(path)}

        from app.domains.journals.pa_preediting import IA_TO_PA_MAPPING, PA_121_RULES_CATALOG
        catalog_by_id = {r["id"]: r for r in PA_121_RULES_CATALOG}

        issues: List[IssueDraft] = []
        for f in findings:
            if not f.get("in_stylesheet"):
                continue
            para = f.get("para_index")
            surface = f.get("surface") or ""
            start = f.get("match_start")
            source = f.get("source") or "body"
            text = texts.get(para, "") if para is not None else ""
            if para is not None and surface and (start is None or text[start:start + len(surface)] != surface):
                start = text.find(surface) if surface in text else None

            location = {"surface": surface, "source": source}
            if para is not None:
                location["para_idx"] = para
                location["block_id"] = f"p{para}"
            if start is not None and start >= 0:
                location["start"] = start
                location["end"] = start + len(surface)

            raw_rule = f.get("rule_id", "")
            pa_rule_id = IA_TO_PA_MAPPING.get(raw_rule)
            pa_rule = catalog_by_id.get(pa_rule_id) if pa_rule_id else None

            if pa_rule:
                rule_id_out = f"PA #{pa_rule['id']} ({raw_rule})"
                title_out = f"PA Point #{pa_rule['id']}: {pa_rule['name']}"
                location["pa_point"] = pa_rule["id"]
                location["pa_part"] = pa_rule["part"]
                location["pa_domain"] = pa_rule["domain"]
                location["source_type"] = "PA 121 Rules"
            else:
                rule_id_out = f"IA:{raw_rule}"
                title_out = f.get("rule_label") or raw_rule or "IA rule"
                location["source_type"] = "IA Baseline"

            replacement = f.get("replacement")
            issues.append(IssueDraft(
                rule_id=rule_id_out,
                severity=SEVERITY.get((f.get("severity") or "info").lower(), "info"),
                title=title_out,
                message=(f"Journal style: {replacement}" if replacement else None),
                location=location,
                context_snippet=_snippet(f.get("context")),
                suggestion={"type": "replace", "from": surface, "to": replacement} if replacement and replacement != surface else None,
                fingerprint=f"{rule_id_out}:{para}:{start}:{surface}"[:255],
            ))

        # Also run PA 121 Mechanical detectors (En-dash ranges, SI units, Grammar agreement, Abbreviations)
        try:
            from app.domains.journals.pa_preediting import PAPreEditingEngine
            pa_engine = PAPreEditingEngine(path)
            pa_analysis = pa_engine.run_ms_analysis()
            le_findings = pa_analysis.get("step_7_le_and_elog", {}).get("language_findings", [])
            for idx, lf in enumerate(le_findings):
                orig = lf.get("original", "")
                sugg = lf.get("suggested", "")
                rule_num = lf.get("rule_id", idx + 1)
                pa_meta = catalog_by_id.get(rule_num)

                pa_para_idx = None
                pa_start = None
                if orig:
                    for p_idx, p_txt in texts.items():
                        s_pos = p_txt.find(orig)
                        if s_pos >= 0:
                            pa_para_idx = p_idx
                            pa_start = s_pos
                            break
                pa_loc = {"surface": orig, "source": "body"}
                if pa_para_idx is not None:
                    pa_loc["para_idx"] = pa_para_idx
                    pa_loc["block_id"] = f"p{pa_para_idx}"
                if pa_start is not None and pa_start >= 0:
                    pa_loc["start"] = pa_start
                    pa_loc["end"] = pa_start + len(orig)
                
                pa_loc["pa_point"] = rule_num
                if pa_meta:
                    pa_loc["pa_part"] = pa_meta["part"]
                    pa_loc["pa_domain"] = pa_meta["domain"]
                pa_loc["source_type"] = "PA 121 Rules"

                rule_tag = f"PA #{rule_num}"
                rule_title = f"PA Point #{rule_num}: {pa_meta['name']}" if pa_meta else (lf.get("category") or "Mechanical Rule")

                issues.append(IssueDraft(
                    rule_id=rule_tag,
                    severity=SEVERITY.get(lf.get("severity", "minor").lower(), "warning"),
                    title=rule_title,
                    message=lf.get("message") or f"Standardize '{orig}' to '{sugg}'",
                    location=pa_loc,
                    context_snippet=f"{lf.get('location')}: {orig} -> {sugg}",
                    suggestion={"type": "replace", "from": orig, "to": sugg} if sugg else None,
                    fingerprint=f"PA:{rule_num}:{orig}:{idx}"[:255]
                ))
        except Exception as e:
            logger.warning("Error running PA mechanical rules detector: %s", e)

        return CheckResult(issues=issues, rules_total=len(rows) + len(issues), rule_set_version="PA Editorial / IA template")
