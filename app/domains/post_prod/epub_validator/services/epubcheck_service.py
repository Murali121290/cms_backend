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
from ..validators.general.epubcheck import _find_epubcheck, _run_epubcheck, _severity_to_category


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


def run_epubcheck_report(folder_name: str) -> dict[str, Any]:
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

    return report
