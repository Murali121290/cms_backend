"""One-off data migration: unify stylesheets to single source of truth in ce_rules.

Usage:
    python scripts/migrate_stylesheets_ce_only.py [--dry-run]

For every ProjectStylesheet and disk JSON file:
1. Migrates selected_ia_rows into ce_rules using migrate_ia_rows_to_ce_rules.
2. Derives selected_ia_rows projection using project_ia_rows.
3. Rewrites the stylesheet with updated content_hash.
"""
from __future__ import annotations

import argparse
import glob
import json
import logging
import os
import sys

# Ensure backend root is on sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.services.stylesheet_service import (
    migrate_ia_rows_to_ce_rules,
    project_ia_rows,
    _clean_ce_rules,
    content_hash,
)

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger("migrate_stylesheets")


def migrate_disk_json_files(dry_run: bool = False) -> int:
    search_pattern = os.path.join("data", "**", "Style sheet template", "*stylesheet*.json")
    json_files = glob.glob(search_pattern, recursive=True)
    logger.info("Found %d disk stylesheet JSON files matching pattern", len(json_files))
    migrated = 0

    for file_path in json_files:
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                data = json.load(f)
        except Exception as exc:
            logger.warning("Failed to read %s: %s", file_path, exc)
            continue

        name = data.get("name", "Unnamed")
        existing_ce = data.get("ce_rules") or {}
        existing_ia = data.get("selected_ia_rows") or []
        style_profile = data.get("style_profile") or {}

        merged_ce, warnings = migrate_ia_rows_to_ce_rules(existing_ia, existing_ce)
        clean_ce = _clean_ce_rules(merged_ce)
        projected_ia = project_ia_rows(clean_ce)

        logger.info(
            "[%s] %s: ce_rules %d -> %d keys, projected IA rows: %d (warnings: %d)",
            "DRY-RUN" if dry_run else "MIGRATE",
            os.path.basename(file_path),
            len(existing_ce),
            len(clean_ce),
            len(projected_ia),
            len(warnings),
        )
        if warnings:
            for w in warnings:
                logger.warning("  %s", w)

        if not dry_run:
            data["ce_rules"] = clean_ce
            data["selected_ia_rows"] = projected_ia
            data["content_hash"] = content_hash(name, clean_ce, style_profile=style_profile)
            with open(file_path, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2, ensure_ascii=False)

        migrated += 1

    return migrated


def main():
    parser = argparse.ArgumentParser(description="Migrate stylesheets to CE-only single source of truth.")
    parser.add_argument("--dry-run", action="store_true", help="Print changes without modifying files or database.")
    args = parser.parse_args()

    logger.info("Starting stylesheet migration (dry_run=%s)", args.dry_run)
    count = migrate_disk_json_files(dry_run=args.dry_run)
    logger.info("Migration complete: %d stylesheet files processed.", count)


if __name__ == "__main__":
    main()
