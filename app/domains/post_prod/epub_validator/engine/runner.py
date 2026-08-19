import fnmatch
import os

from . import detector, loader, registry
from ..services import book_bundle_service as _bundle
# Reuse the legacy asset-index/chapter-grouping helpers during migration.
# These get physically moved into engine/ when the legacy module is deleted.
from ..services.validate_service import (
    _build_asset_to_chapters_index,
    _group_chapter_issues,
)

# Register all v2 validators. Importing the package triggers @rule side effects.
from .. import validators as _validators  # noqa: F401
from ..validators import links as _links_validator  # for per-run cache reset


def validate_epub(
    epub_folder: str,
    folder_name: str,
    target_file: str | None = None,
    customer: str | None = None,
    progress_callback=None,
) -> dict:
    """Run general rules and (if a customer is detected/provided) the customer's
    rules against an extracted EPUB.

    Response shape matches Phase 1: a flat `files` list of entries. Two new
    optional fields on each entry — `origin` ("general"|"customer") and
    `customer` (the customer key or None) — support the Phase 3 UI without
    breaking older clients.
    """
    # Reset per-run caches so each validation starts fresh.
    # Within a single run, the same data is reused across all rules (no re-parsing).
    _links_validator._URL_RESULT_CACHE.clear()   # URL check results
    _bundle._EPUB_CACHE.clear()                  # EpubBundle (parsed EPUB)

    resolved_customer = customer if customer else detector.detect(epub_folder)


    report = {
        "folder": folder_name,
        "epub_path": epub_folder,
        "customer": resolved_customer,
        "files": [],
    }

    asset_index = _build_asset_to_chapters_index(_bundle.get_epub_bundle(folder_name))

    def _count_active(rules: list[dict]) -> int:
        return len([r for r in rules if r.get("enabled", True) and registry.get(r["id"])])

    customer_rules = loader.load_customer(resolved_customer) if resolved_customer else []
    
    if customer_rules:
        general_rules = []
    else:
        general_rules = loader.load_general()
        
    grand_total = _count_active(general_rules) + _count_active(customer_rules)
    global_index = [0]  # mutable counter shared across both _run calls

    def _run(rules: list[dict], origin: str, customer_tag: str | None) -> None:
        for rule in rules:
            if not rule.get("enabled", True):
                continue

            # Skip the rule entirely if the target_file is in the rule's exclude_files
            exclude_files = rule.get("exclude_files", [])
            if target_file and target_file in exclude_files:
                continue

            function = registry.get(rule["id"])
            if function is None:
                continue

            global_index[0] += 1
            if progress_callback:
                try:
                    progress_callback({
                        "rule_id": rule["id"],
                        "rule_name": rule.get("name", rule["id"]),
                        "index": global_index[0],
                        "total": grand_total,
                        "origin": origin,
                    })
                except Exception:
                    pass  # never let progress reporting crash the validation

            if rule.get("scope") == "book":
                _run_book_scope(rule, function, origin, customer_tag)
            else:
                _run_file_scope(rule, function, origin, customer_tag)

    def _entry(rule, function, target_path, file_pattern, file_details, result, origin, customer_tag):
        return {
            "rule_id": rule["id"],
            "rule_name": rule["name"],
            "function": function.__name__,
            "target_path": target_path,
            "file_pattern": file_pattern,
            "file_details": file_details,
            "result": result,
            "origin": origin,
            "customer": customer_tag,
        }

    def _run_book_scope(rule, function, origin, customer_tag):
        book_details = {
            "folder_name": folder_name,
            "epub_path": epub_folder,
            "chapter_filter": target_file,  # Pass chapter filter if validating single chapter
        }
        try:
            result = function(book_details)
        except Exception as e:  # noqa: BLE001
            result = {
                "issues_count": 1,
                "issues": [{
                    "type": "rule_error",
                    "message": f"{rule['id']} crashed: {e}",
                    "category": "Error",
                }],
            }
        if not target_file:
            report["files"].append(_entry(
                rule, function, "", "[book-scope]",
                {
                    "file_name": "[book-level]",
                    "full_path": epub_folder,
                    "relative_path": "",
                    "folder_name": folder_name,
                },
                result, origin, customer_tag,
            ))

        for rel_path, chapter_issues in _group_chapter_issues(
            result.get("issues", []), asset_index
        ).items():
            file_name = os.path.basename(rel_path)
            if target_file and file_name != target_file:
                continue
            report["files"].append(_entry(
                rule, function, os.path.dirname(rel_path), "[book-scope]",
                {
                    "file_name": file_name,
                    "full_path": os.path.join(epub_folder, rel_path),
                    "relative_path": rel_path,
                    "folder_name": folder_name,
                },
                {"issues_count": len(chapter_issues), "issues": chapter_issues},
                origin, customer_tag,
            ))

    def _run_file_scope(rule, function, origin, customer_tag):
        target_path = rule.get("target_path", "").strip("/")
        file_pattern = rule.get("file_name_pattern", "*")
        file_patterns = file_pattern if isinstance(file_pattern, list) else [file_pattern]

        search_folder = os.path.join(epub_folder, target_path)
        if not os.path.exists(search_folder):
            return

        for root, _dirs, files in os.walk(search_folder):
            for file in files:
                if target_file and file != target_file:
                    continue
                if not any(fnmatch.fnmatch(file, p) for p in file_patterns):
                    continue

                full_path = os.path.join(root, file)
                relative_path = os.path.relpath(full_path, epub_folder).replace("\\", "/")
                file_details = {
                    "file_name": file,
                    "full_path": full_path,
                    "relative_path": relative_path,
                    "folder_name": folder_name,
                    "epub_root": epub_folder,
                    "file_path": relative_path,
                }
                result = function(file_details, rule_config=rule)
                report["files"].append(_entry(
                    rule, function, target_path, file_pattern,
                    file_details, result, origin, customer_tag,
                ))

    if customer_rules:
        _run(customer_rules, origin="customer", customer_tag=resolved_customer)
    else:
        _run(general_rules, origin="general", customer_tag=None)

    return report
