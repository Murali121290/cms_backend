"""ACE (DAISY Accessibility Checker) integration.

Runs the `ace` Node CLI against an uploaded EPUB and normalises the
EARL-based report.json into a UI-friendly shape. Results are cached on
disk so revisits don't require a rerun.

Contract with the frontend:

    {
      "status": "pass" | "fail",
      "ran_at": ISO-8601 UTC,
      "duration_seconds": float,
      "conformance_level": "A" | "AA" | "AAA" | "none",
      "totals": {"critical": n, "serious": n, "moderate": n, "minor": n},
      "metadata": {
        "title": str | None,
        "language": str | None,
        "identifier": str | None,
        "accessibility_features": [str],
        "accessibility_summary": str | None,
        "conforms_to": [str],
      },
      "violations": [
        {
          "rule_id": str,
          "rule_title": str,
          "impact": "critical" | "serious" | "moderate" | "minor" | "",
          "wcag": [str],
          "help_url": str | None,
          "message": str,
          "file_path": str | None,       # relative path inside the EPUB
          "snippet": str | None,
        }
      ]
    }
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import HTTPException

from .upload_service import EXTRACT_DIR, UPLOAD_DIR


ACE_MISSING_MESSAGE = (
    "The DAISY ACE accessibility checker is not installed on this server. "
    "Install it with `npm install -g @daisy/ace` and try again."
)


def _find_ace_binary() -> str | None:
    """Return an absolute path to the `ace` binary.

    Checks PATH first, then a project-local install at
    `backend/node_modules/.bin/ace` so developers who can't `npm install -g`
    without sudo can still run the check.
    """
    on_path = shutil.which("ace")
    if on_path:
        return on_path
    local = Path(__file__).resolve().parent.parent / "node_modules" / ".bin" / "ace"
    if local.is_file():
        return str(local)
    return None


def _epub_path(folder_name: str) -> Path:
    """Path to the .epub file that was uploaded for this folder."""
    return Path(UPLOAD_DIR) / folder_name / EXTRACT_DIR / f"{folder_name}.epub"


def _cache_dir(folder_name: str) -> Path:
    return Path(UPLOAD_DIR) / folder_name / "ace"


def _cache_path(folder_name: str) -> Path:
    return _cache_dir(folder_name) / "report.json"


def _raw_cache_path(folder_name: str) -> Path:
    return _cache_dir(folder_name) / "report.raw.json"


def html_report_dir(folder_name: str) -> Path:
    """Directory holding the full ACE HTML report (report.html + assets)."""
    return _cache_dir(folder_name) / "html"


def get_cached_report(folder_name: str) -> dict[str, Any] | None:
    """Return the last normalised report for this book, or None if never run."""
    cache = _cache_path(folder_name)
    if not cache.is_file():
        return None
    try:
        return json.loads(cache.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def run_ace(folder_name: str) -> dict[str, Any]:
    """Run ACE on the EPUB and return the normalised report.

    Raises HTTPException with a clear message when the binary is missing
    or the run fails — the route hands these back to the frontend as-is.
    """
    ace_bin = _find_ace_binary()
    if ace_bin is None:
        raise HTTPException(status_code=503, detail=ACE_MISSING_MESSAGE)

    epub = _epub_path(folder_name)
    if not epub.is_file():
        raise HTTPException(
            status_code=404,
            detail=f"EPUB file not found for '{folder_name}'.",
        )

    cache_dir = _cache_dir(folder_name)
    html_dir = cache_dir / "html"
    # Clear any previous run so ACE writes into a clean tree.
    if html_dir.exists():
        shutil.rmtree(html_dir)
    cache_dir.mkdir(parents=True, exist_ok=True)

    # ACE spawns Electron/Chromium, which needs a display. In headless
    # environments (Docker, CI) wrap the call with xvfb-run when it's
    # available so a virtual display gets spun up automatically.
    cmd = [ace_bin, "--outdir", str(html_dir), "--force", str(epub)]
    xvfb = shutil.which("xvfb-run")
    if xvfb and not os.environ.get("DISPLAY"):
        cmd = [xvfb, "-a", "--server-args=-screen 0 1024x768x24", *cmd]

    started = time.monotonic()
    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=300,
            check=False,
        )
    except FileNotFoundError:
        raise HTTPException(status_code=503, detail=ACE_MISSING_MESSAGE)
    except subprocess.TimeoutExpired:
        raise HTTPException(
            status_code=504,
            detail="ACE timed out after 5 minutes.",
        )

    report_file = html_dir / "report.json"
    if not report_file.is_file():
        # ACE exits non-zero when the EPUB has violations, so we can't
        # trust the returncode alone — but a missing report is fatal.
        stderr_tail = (proc.stderr or "").strip().splitlines()[-5:]
        detail = "ACE did not produce a report."
        if stderr_tail:
            detail += " " + " | ".join(stderr_tail)
        raise HTTPException(status_code=500, detail=detail)

    raw = json.loads(report_file.read_text(encoding="utf-8"))
    duration = round(time.monotonic() - started, 2)
    normalised = _normalise(raw, duration_seconds=duration)

    _cache_path(folder_name).write_text(
        json.dumps(normalised, indent=2), encoding="utf-8"
    )
    _raw_cache_path(folder_name).write_text(
        json.dumps(raw, indent=2), encoding="utf-8"
    )
    return normalised


# ── Report normalisation ─────────────────────────────────────────────────────
# ACE's report follows the EARL vocabulary, which is verbose and evolves
# between releases. We stay defensive: read what we recognise, ignore the
# rest, and never crash on a missing key.


def _normalise(raw: dict[str, Any], *, duration_seconds: float) -> dict[str, Any]:
    outcome = _dig(raw, "earl:result", "earl:outcome") or "fail"
    conformance = _conformance_level(raw)
    subject_meta = _dig(raw, "earl:testSubject", "metadata") or {}

    metadata = {
        "title": _first_scalar(subject_meta.get("dc:title")),
        "language": _first_scalar(subject_meta.get("dc:language")),
        "identifier": _first_scalar(subject_meta.get("dc:identifier")),
        "accessibility_features": _as_list(
            subject_meta.get("schema:accessibilityFeature")
        ),
        "accessibility_summary": _first_scalar(
            subject_meta.get("schema:accessibilitySummary")
        ),
        "conforms_to": _as_list(subject_meta.get("dcterms:conformsTo")),
    }

    violations = list(_iter_violations(raw))
    totals = {"critical": 0, "serious": 0, "moderate": 0, "minor": 0}
    for v in violations:
        impact = v.get("impact") or ""
        if impact in totals:
            totals[impact] += 1

    return {
        "status": "pass" if outcome == "pass" else "fail",
        "ran_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "duration_seconds": duration_seconds,
        "conformance_level": conformance,
        "totals": totals,
        "metadata": metadata,
        "violations": violations,
    }


def _conformance_level(raw: dict[str, Any]) -> str:
    """Best-effort read of the WCAG conformance level from the report."""
    subject_meta = _dig(raw, "earl:testSubject", "metadata") or {}
    conforms_to = _as_list(subject_meta.get("dcterms:conformsTo"))
    for entry in conforms_to:
        text = entry.upper()
        for level in ("AAA", "AA", "A"):
            # Match "WCAG 2.1 Level AA", "EPUB Accessibility 1.1 - WCAG 2.0 Level AA", etc.
            if f"LEVEL {level}" in text or text.endswith(f" {level}"):
                return level
    return "none"


def _iter_violations(raw: dict[str, Any]):
    """Yield normalised violation dicts from every failing assertion."""
    for group in raw.get("assertions", []) or []:
        subject_url = _dig(group, "earl:testSubject", "url")
        file_path = _strip_epub_prefix(subject_url) if subject_url else None
        for a in group.get("assertions", []) or []:
            outcome = _dig(a, "earl:result", "earl:outcome")
            if outcome not in ("fail", "cantTell"):
                continue
            test = a.get("earl:test") or {}
            result = a.get("earl:result") or {}
            help_field = test.get("help") or {}
            help_url = help_field.get("url") if isinstance(help_field, dict) else None
            pointer = result.get("earl:pointer") or {}
            snippet = pointer.get("cfi") or pointer.get("css") if isinstance(pointer, dict) else None

            yield {
                "rule_id": test.get("@id") or test.get("dct:title") or "unknown",
                "rule_title": test.get("dct:title") or test.get("@id") or "Unnamed rule",
                "impact": (test.get("earl:impact") or "").lower(),
                "wcag": _as_list(test.get("help", {}).get("dct:title"))
                or _wcag_from_test(test),
                "help_url": help_url,
                "message": (
                    result.get("dct:description")
                    or result.get("dct:title")
                    or test.get("dct:description")
                    or ""
                ),
                "file_path": file_path,
                "snippet": snippet if isinstance(snippet, str) else None,
            }


def _wcag_from_test(test: dict[str, Any]) -> list[str]:
    """Pull WCAG SC identifiers from whatever shape the test object uses."""
    tags = test.get("wcag2a") or test.get("wcag2aa") or test.get("wcagLevel")
    return _as_list(tags)


def _strip_epub_prefix(url: str) -> str:
    """Turn an ACE file URL into a clean relative path inside the EPUB."""
    # Formats seen: "OEBPS/chapter01.xhtml", "file:///…/epub/OEBPS/chapter01.xhtml"
    if url.startswith("file://"):
        # Take everything after the last "/epub/" if we can find it
        marker = "/epub/"
        idx = url.rfind(marker)
        if idx != -1:
            return url[idx + len(marker):]
        return url.split("/")[-1]
    return url


# ── Small helpers ────────────────────────────────────────────────────────────


def _dig(obj: Any, *keys: str) -> Any:
    cur = obj
    for k in keys:
        if not isinstance(cur, dict):
            return None
        cur = cur.get(k)
    return cur


def _as_list(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list):
        return [str(v) for v in value if v is not None]
    return [str(value)]


def _first_scalar(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, list):
        return str(value[0]) if value else None
    return str(value)