"""Stage 1 structuring check: paragraph and character style tagging of the manuscript."""
import re

from app.domains.journals.checks.base import CheckResult, IssueDraft, JournalCheck, register
from app.domains.journals.manuscript import heading_level, load_blocks, resolve_manuscript_path, snippet
from app.domains.journals.models import JournalStylesheet

# Character styles that map to JATS without configuration. Journals add more via
# style_rules["character_styles"] = {"Italics": "italic", ...}.
MAPPED_CHAR_STYLES = {
    "Default Paragraph Font", "Emphasis", "Strong", "Hyperlink", "FollowedHyperlink",
    "Subtle Emphasis", "Intense Emphasis", "Footnote Reference", "Endnote Reference",
    "Comment Reference", "annotation reference", "Placeholder Text",
}
HEADING_PATTERN = re.compile(r"^(\d+(?:\.\d+)*)\.?\s+[A-Z]")
TABLE_CAPTION = re.compile(r"^Table\s+\d+", re.I)
FIGURE_CAPTION = re.compile(r"^(Figure|Fig\.)\s*\d+", re.I)
CAPTION_CATEGORIES = {"Table Title", "Figure Caption", "Caption"}
RULES = ("STR-H02", "STR-UNTAG", "STR-HSEQ", "STR-CS-09", "STR-CAP-03", "STR-CAP-04", "STR-ABS")


def active_stylesheet(db, article):
    return db.query(JournalStylesheet).filter(
        JournalStylesheet.journal_id == article.journal_id, JournalStylesheet.is_active == True  # noqa: E712
    ).order_by(JournalStylesheet.id.desc()).first()


@register
class StructuringCheck(JournalCheck):
    key = "structuring"
    name = "Structuring"

    def run(self, article, db) -> CheckResult:
        path = resolve_manuscript_path(db, article)
        if not path:
            raise FileNotFoundError("No manuscript DOCX is attached to this article")
        sheet = active_stylesheet(db, article)
        rules = (sheet.style_rules if sheet else None) or {}
        allowed_char = MAPPED_CHAR_STYLES | set((rules.get("character_styles") or {}).keys())
        abstract_limit = int(rules.get("abstract_word_limit", 250))

        blocks = load_blocks(path)
        issues = []
        flagged = set()
        prev_level = None
        abstract_blocks = []

        for i, b in enumerate(blocks):
            if not b.text:
                continue
            loc = {"block_id": b.block_id, "para_idx": b.idx}
            whole = {**loc, "start": 0, "end": len(b.text), "surface": b.text}  # highlights the paragraph in the editor
            level = heading_level(b.category)
            m = HEADING_PATTERN.match(b.text)

            if not b.in_table and level is None and b.category in ("Un-structured", "Body Text") and m \
                    and b.words <= 12 and not b.text.endswith("."):
                target = min(m.group(1).count(".") + 1, 6)
                issues.append(IssueDraft(
                    rule_id="STR-H02", severity="error", title="Heading tagged as body text",
                    message=f"“{b.text}” matches the numbered heading pattern but is styled {b.style}. It would be converted to a paragraph instead of a section.",
                    location=whole, context_snippet=b.text, suggestion={"type": "retag", "to": f"Heading {target}"},
                ))
                flagged.add(b.idx)
                level = target  # count it for the hierarchy check below

            if level is not None:
                if prev_level is not None and level > prev_level + 1:
                    issues.append(IssueDraft(
                        rule_id="STR-HSEQ", severity="error", title=f"Heading level jumps from {prev_level} to {level}",
                        message=f"“{b.text}” is a level-{level} heading directly under a level-{prev_level} heading. Headings must not skip levels.",
                        location=whole, context_snippet=b.text, suggestion={"type": "retag", "to": f"Heading {prev_level + 1}"},
                    ))
                prev_level = level

            caption_rule = None
            if TABLE_CAPTION.match(b.text) and (b.before_table or b.after_table) and b.category not in CAPTION_CATEGORIES:
                caption_rule = ("STR-CAP-03", "Table caption not tagged as a caption", "Table Title")
            elif FIGURE_CAPTION.match(b.text) and b.category not in CAPTION_CATEGORIES and (
                    b.has_drawing or (i > 0 and blocks[i - 1].has_drawing)):
                caption_rule = ("STR-CAP-04", "Figure caption not tagged as a caption", "Figure Caption")
            if caption_rule:
                rule, title, target = caption_rule
                issues.append(IssueDraft(
                    rule_id=rule, severity="warning", title=title,
                    message=f"“{b.text[:60]}” sits next to a {'table' if rule == 'STR-CAP-03' else 'figure'} but is styled {b.style}, so it will not become the caption.",
                    location=whole, context_snippet=snippet(b.text, 0, 0, 80), suggestion={"type": "retag", "to": target},
                ))
                flagged.add(b.idx)

            if b.category == "Un-structured" and not b.in_table and b.idx not in flagged:
                issues.append(IssueDraft(
                    rule_id="STR-UNTAG", severity="warning", title="Paragraph is not tagged",
                    message=f"This paragraph uses the {b.style} style. Tag it with a journal style so it converts to the right JATS element.",
                    location=loc, context_snippet=snippet(b.text, 0, 0, 80),
                ))

            for cs in sorted(b.char_styles - allowed_char):
                if cs.endswith(" Char") or cs.startswith(("bib_", "cite_", "ref_")):
                    continue  # linked paragraph styles ("Heading 1 Char"); reference structuring styles map to JATS citations
                issues.append(IssueDraft(
                    rule_id="STR-CS-09", severity="error", title=f"Unmapped character style “{cs}”",
                    message=f"The Word character style “{cs}” has no JATS mapping. Map it in the journal style sheet or replace it with Emphasis/Strong.",
                    location={**loc, "char_style": cs}, context_snippet=snippet(b.text, 0, 0, 80),
                    fingerprint=f"STR-CS-09:{b.block_id}:{cs}",
                ))

            if b.category == "Abstract" or re.match(r"^abstract\b", b.text, re.I):
                abstract_blocks.append(b)

        if not abstract_blocks:
            issues.append(IssueDraft(
                rule_id="STR-ABS", severity="warning", title="No abstract found",
                message="No paragraph is tagged as the abstract or starts with “Abstract”.",
                fingerprint="STR-ABS:missing",
            ))
        else:
            words = sum(b.words for b in abstract_blocks)
            if words > abstract_limit:
                issues.append(IssueDraft(
                    rule_id="STR-ABS", severity="warning", title=f"Abstract is {words} words (limit {abstract_limit})",
                    message="Shorten the abstract or query the author.",
                    location={"block_id": abstract_blocks[0].block_id, "para_idx": abstract_blocks[0].idx},
                    fingerprint="STR-ABS:length",
                ))

        return CheckResult(issues=issues, rules_total=len(RULES), rule_set_version=sheet.name if sheet else None)
