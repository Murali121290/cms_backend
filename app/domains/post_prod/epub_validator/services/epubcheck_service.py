"""W3C EPUBCheck Service.

Runs W3C EpubCheck (via CLI) against an EPUB and normalises the output
into a UI report. Caches the resulting report on disk.
"""

from __future__ import annotations

import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import HTTPException

from .upload_service import UPLOAD_DIR, find_epub_file_path
from ..validators.epubcheck import _find_epubcheck, _run_epubcheck, _severity_to_category



def _cache_dir(folder_name: str) -> Path:
    return Path(UPLOAD_DIR) / folder_name / "epubcheck"


def _cache_path(folder_name: str) -> Path:
    return _cache_dir(folder_name) / "report.json"


def get_cached_epubcheck_report(folder_name: str) -> dict[str, Any] | None:
    cache = _cache_path(folder_name)
    if not cache.is_file():
        return None
    try:
        return json.loads(cache.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def run_epubcheck_report(folder_name: str, db: Any = None) -> dict[str, Any]:
    finder = _find_epubcheck()
    if finder is None:
        raise HTTPException(
            status_code=503,
            detail=(
                "W3C EPUBCheck is not installed on this server. "
                "Install with `npm install -g epubchecker` or `brew install epubcheck`."
            ),
        )

    kind, cmd_prefix = finder
    epub_file_path = find_epub_file_path(folder_name)
    if not epub_file_path.is_file():
        raise HTTPException(
            status_code=404,
            detail=f"EPUB file not found for project '{folder_name}'.",
        )

    started = time.monotonic()
    messages, err = _run_epubcheck(cmd_prefix, kind, str(epub_file_path))
    duration = round(time.monotonic() - started, 2)

    if err:
        cache_path = _cache_path(folder_name)
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        cache_path.write_text(json.dumps({
            "status": "fatal",
            "message": f"EPUBCheck failed: {err}"
        }), encoding="utf-8")
        raise HTTPException(status_code=500, detail=f"EPUBCheck failed: {err}")

    errors = 0
    warnings = 0
    infos = 0
    formatted_messages = []

    for m in messages:
        sev_cat = _severity_to_category(m.get("severity"))
        if sev_cat == "Error":
            errors += 1
        elif sev_cat == "Warning":
            warnings += 1
        else:
            infos += 1

        loc = (m.get("locations") or [{}])[0] if isinstance(m.get("locations"), list) else {}
        formatted_messages.append({
            "id": m.get("ID") or "EpubCheck",
            "message": m.get("message") or "",
            "category": sev_cat,
            "severity": (m.get("severity") or "info").lower(),
            "file_path": loc.get("path") if isinstance(loc, dict) else None,
            "line_number": loc.get("line") if isinstance(loc, dict) else None,
            "column_number": loc.get("column") if isinstance(loc, dict) else None,
        })

    report = {
        "status": "pass" if errors == 0 else "fail",
        "ran_at": datetime.now(timezone.utc).isoformat(),
        "duration_seconds": duration,
        "totals": {
            "error": errors,
            "warning": warnings,
            "info": infos,
            "total": len(formatted_messages),
        },
        "messages": formatted_messages,
    }

    cache_dir = _cache_dir(folder_name)
    cache_dir.mkdir(parents=True, exist_ok=True)
    _cache_path(folder_name).write_text(json.dumps(report, indent=2), encoding="utf-8")

    # Automatically save .txt log file alongside report.json on disk
    try:
        generate_epubcheck_txt_report(folder_name, db=db, report=report)
    except Exception:
        pass

    return report


def generate_epubcheck_txt_report(
    folder_name: str, db: Any = None, report: dict[str, Any] = None
) -> tuple[str, str, Path]:
    """Generate official EPUBCheck text output log format and save to disk in docker.

    Returns:
        (txt_content, download_filename, txt_file_path)
        filename format: <eisbn>_log.txt or <project_name>_log.txt or <folder_name>_log.txt
    """
    eisbn = None
    project_name = None
    if db is not None:
        try:
            from . import ev_projects_db
            project = ev_projects_db.get_project_by_folder(db, folder_name)
            if project:
                eisbn = getattr(project, "eisbn", None)
                project_name = getattr(project, "project_name", None)
        except Exception:
            pass

    if eisbn and eisbn.strip():
        filename = f"{eisbn.strip()}_log.txt"
    elif project_name and project_name.strip():
        filename = f"{project_name.strip()}_log.txt"
    else:
        filename = f"{folder_name}_log.txt"

    if report is None:
        report = get_cached_epubcheck_report(folder_name)
    if report is None or report.get("status") == "fatal":
        try:
            report = run_epubcheck_report(folder_name, db=db)
        except Exception as e:
            report = {
                "status": "fatal",
                "ran_at": datetime.now(timezone.utc).isoformat(),
                "duration_seconds": 0,
                "totals": {"error": 1, "warning": 0, "info": 0, "total": 1},
                "messages": [{
                    "id": "EPUBCheckError",
                    "category": "Error",
                    "message": str(e),
                    "file_path": None,
                    "line_number": None,
                    "column_number": None
                }]
            }

    ran_at_str = report.get("ran_at")
    if ran_at_str:
        try:
            dt = datetime.fromisoformat(ran_at_str.replace("Z", "+00:00"))
            formatted_date = dt.strftime("%d %B, %Y %I:%M:%S %p IST")
        except Exception:
            formatted_date = datetime.now(timezone.utc).strftime("%d %B, %Y %I:%M:%S %p IST")
    else:
        formatted_date = datetime.now(timezone.utc).strftime("%d %B, %Y %I:%M:%S %p IST")

    header = (
        "Validating using EPUB version 3.3 rules.\n"
        "(https://github.com/w3c/epubcheck)\n\n"
        f"{formatted_date}\n\n\n"
        "---------------------------------------------------\n\n\n\n"
    )

    messages = report.get("messages", [])
    totals = report.get("totals", {})
    errors_count = totals.get("error", 0)
    warnings_count = totals.get("warning", 0)

    if not messages or (errors_count == 0 and warnings_count == 0):
        body = "No errors or warnings detected. EPUB is valid!\n"
    else:
        lines = []
        for m in messages:
            cat = (m.get("category") or "Info").upper()
            rule_id = m.get("id") or "EpubCheck"
            file_path = m.get("file_path")
            line_num = m.get("line_number")
            col_num = m.get("column_number")
            msg_text = m.get("message") or ""

            loc_str = ""
            if file_path:
                loc_str = f": {file_path}"
                if line_num is not None:
                    loc_str += f"({line_num}"
                    if col_num is not None:
                        loc_str += f",{col_num}"
                    loc_str += ")"
            elif line_num is not None:
                loc_str = f"({line_num})"

            lines.append(f"{cat}({rule_id}){loc_str}: {msg_text}")

        lines.append("\n---------------------------------------------------\n")
        lines.append(f"Check finished with {errors_count} error(s) and {warnings_count} warning(s).\n")
        body = "\n".join(lines)

    full_content = header + body

    # Save .txt log file in docker disk folder alongside report.json
    cache_dir = _cache_dir(folder_name)
    cache_dir.mkdir(parents=True, exist_ok=True)
    txt_file_path = cache_dir / filename
    txt_file_path.write_text(full_content, encoding="utf-8")

    return full_content, filename, txt_file_path
