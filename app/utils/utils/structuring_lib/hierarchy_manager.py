"""
Hierarchy Manager module.
Implements Stage 2 (Validate) and Stage 3 (Standardize) of the STM styling workflow.
"""

import logging
from typing import List, Dict, Any
from .rules_loader import get_rules_loader

logger = logging.getLogger(__name__)

class HierarchyManager:
    def __init__(self):
        self.rules_loader = get_rules_loader()
        self.config = self.rules_loader.get_heading_hierarchy()
        
    def refine_annotations(self, annotations: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """
        Refine annotations based on STM hierarchy rules.
        - Normalizes synonyms
        - Enforces mandatory levels
        - Validates and fixes hierarchy (no skipping levels)
        """
        if not self.config:
            logger.warning("No heading hierarchy configuration found")
            return annotations
            
        synonyms = self.config.get("synonym_normalization", {})
        mandatory_h1 = set(self.config.get("mandatory_h1_sections", []))
        constraints = self.config.get("constraints", {})
        
        current_level = 0  # 0 indicates no heading seen yet
        prev_heading_level = None  # level of the last heading seen, None if last content was non-heading
        
        # Map style names to levels
        style_levels = {
            "CT": 0,
            "Title": 0,
            "H1": 1,
            "Heading 1": 1,
            "H2": 2,
            "Heading 2": 2,
            "H3": 3,
            "Heading 3": 3,
            "H4": 4,
            "Heading 4": 4,
            "H5": 5,
            "Heading 5": 5,
            "H6": 6,
            "Heading 6": 6,
            "Normal": 99,
            "TXT": 99,
            "BODY_TEXT": 99
        }

        # Reverse map for level -> style
        level_styles = {
            1: "H1",
            2: "H2",
            3: "H3",
            4: "H4",
            5: "H5",
            6: "H6"
        }

        refined_annotations = []
        
        for idx, item in enumerate(annotations):
            para = item["para"]
            tag = item["tag"]
            style = item["style"]
            text = para.text.strip()

            if item.get("locked"):
                # Author-provided tag (explicit <TAG> or carried over from a
                # standalone tag line) is authoritative - never rewritten by
                # synonym normalization, mandatory-H1 enforcement, or the
                # hierarchy auto-fix below. Still feed its level into
                # current_level so later, non-locked paragraphs are checked
                # against accurate context.
                level = style_levels.get(style, 99)
                if level <= 6:
                    current_level = level
                    prev_heading_level = level
                elif para.text.strip():
                    prev_heading_level = None
                refined_annotations.append(item)
                continue

            # Skip empty or non-heading items mostly, but we need to track context
            # Actually, we process all, modify if needed.

            # 1. Synonym Normalization
            if text in synonyms:
                new_text = synonyms[text]
                logger.info(f"Normalizing '{text}' to '{new_text}'")
                if para.runs:
                    # Only safe to rewrite when the full text lives in one run;
                    # multi-run paragraphs may have mixed formatting — leave them.
                    if len(para.runs) == 1 or para.runs[0].text.strip() == text:
                        para.runs[0].text = new_text
                    else:
                        logger.warning(f"Skipping synonym rewrite for multi-run paragraph '{text}' to avoid formatting loss")
                else:
                    para.add_run(new_text)
                text = new_text
            
            # 2. Mandatory H1 Enforcement
            if text in mandatory_h1:
                if style != "H1":
                    logger.info(f"Enforcing H1 for mandatory section '{text}'")
                    style = "H1"
                    tag = "H1"
            
            # 3. Hierarchy Validation (Auto-fix)
            # Check if this item determines a level
            level = style_levels.get(style, 99)
            
            if level <= 6: # It is a heading
                # Check constraints
                if constraints.get("require_h1_first", False):
                    # Only enforce if skipping level 1 AND it's not a root element like Title (level 0)
                    if level > 1 and current_level == 0:
                        logger.warning(f"Heading '{text}' (H{level}) appears before first H1. Promoting to H1.")
                        level = 1
                        style = "H1"
                        tag = style

                if constraints.get("no_skipping_levels", False):
                    # valid: current=1, next=2. invalid: current=1, next=3
                    if level > current_level + 1:
                        # Auto-fix: Reduce level to be sequential
                        new_level = current_level + 1
                        # But ensure we don't go deeper than max_depth or stay 0 if current is 0?
                        # If current is 0 (Title/Start), next can be 1.
                        # If current is 1 (H1), next can be 2.
                        # If current is 1, next cannot be 3.

                        # However, sometimes we jump back up (H3 -> H1). That is allowed.
                        # Skipping is only forbidden downwards (H1 -> H3).

                        logger.warning(f"Hierarchy violation: H{current_level} -> H{level}. Auto-fixing to H{new_level}.")
                        level = new_level
                        style = level_styles.get(level, style)
                        tag = style

                # 4. Consecutive Heading Demotion (only when same level repeats)
                if prev_heading_level is not None and level == prev_heading_level:
                    new_level = min(level + 1, 6)
                    logger.info(f"Demoting consecutive same-level heading '{text}' from H{level} to H{new_level}")
                    level = new_level
                    style = level_styles.get(level, style)
                    tag = style

                # Update current level context
                current_level = level
                prev_heading_level = level

            else:
                if text:
                    prev_heading_level = None

            item["style"] = style
            item["tag"] = tag
            refined_annotations.append(item)
            
        return refined_annotations

def enforce_hierarchy(annotations: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    manager = HierarchyManager()
    return manager.refine_annotations(annotations)


_HEADING_MAX_WORDS = 20

_ALL_HEADINGS = {
    "H1", "H2", "H3", "H4", "H5", "H6",
    "Heading 1", "Heading 2", "Heading 3", "Heading 4", "Heading 5", "Heading 6",
}


def demote_long_headings(annotations: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Demote headings whose text exceeds _HEADING_MAX_WORDS words to body text,
    unless the paragraph carries an author-provided tag (locked=True).
    TXT-FLUSH if a heading appears immediately above; TXT otherwise.
    If the demoted heading itself was immediately followed by a TXT-FLUSH
    paragraph, that paragraph is no longer flush against a heading (the
    paragraph above it is now text too), so it is downgraded to plain TXT."""
    prev_was_heading = False
    prev_was_demoted = False
    for item in annotations:
        style = item.get("style", "")
        is_heading = style in _ALL_HEADINGS

        if not is_heading:
            if prev_was_demoted and style == "TXT-FLUSH" and not item.get("locked"):
                logger.info("Downgrading TXT-FLUSH -> TXT: preceding heading was demoted to text")
                item["style"] = "TXT"
                item["tag"] = "TXT"
            prev_was_heading = False
            prev_was_demoted = False
            continue

        if item.get("locked"):
            prev_was_heading = True
            prev_was_demoted = False
            continue

        para = item.get("para")
        text = para.text.strip() if para is not None else ""
        if len(text.split()) <= _HEADING_MAX_WORDS:
            prev_was_heading = True
            prev_was_demoted = False
            continue

        new_style = "TXT-FLUSH" if prev_was_heading else "TXT"
        logger.info(
            "Demoting long heading (%d words) %s -> %s: %r",
            len(text.split()), style, new_style, text[:60],
        )
        item["style"] = new_style
        item["tag"] = new_style
        prev_was_heading = False
        prev_was_demoted = True
    return annotations
