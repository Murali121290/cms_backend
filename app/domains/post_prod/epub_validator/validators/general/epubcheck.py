"""EpubCheck CLI integration (IDPF's official EPUB 3 validator).

Runs the Java-based `epubcheck` against the uploaded .epub and normalises
its JSON output into our issue schema. Skips cleanly with an Info-level
issue when the binary/jar is not installed — no crashes if a validator
is missing.

Install:
  brew install epubcheck                 # macOS
  npm install -g epubchecker             # cross-platform wrapper
  # or drop epubcheck.jar into: ~/.epubcheck/epubcheck.jar

Environment overrides:
  EPUBCHECK_JAR   — absolute path to epubcheck.jar
  EPUBCHECK_BIN   — path to an `epubcheck` executable
"""

import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

from ...engine.registry import rule
from app.domains.post_prod.epub_validator.services.upload_service import (
    EXTRACT_DIR,
    UPLOAD_DIR,
    find_epub_file_path,
)


def _find_epubcheck() -> tuple[str, list[str]] | None:
    """Return (kind, cmd_prefix). kind ∈ {'bin', 'jar', 'npm'}."""
    if bin_override := os.environ.get("EPUBCHECK_BIN"):
        if os.path.isfile(bin_override):
            return "bin", [bin_override]

    on_path = shutil.which("epubcheck")
    if on_path:
        return "bin", [on_path]

    npm_wrapper = shutil.which("epubchecker")
    if npm_wrapper:
        return "npm", [npm_wrapper]

    jar_candidates = [os.environ.get("EPUBCHECK_JAR")] if os.environ.get("EPUBCHECK_JAR") else []
    jar_candidates += [
        os.path.expanduser("~/.epubcheck/epubcheck.jar"),
        "/usr/local/lib/epubcheck/epubcheck.jar",
        "/opt/homebrew/lib/epubcheck/epubcheck.jar",
    ]
    java = shutil.which("java")
    for jar in jar_candidates:
        if jar and os.path.isfile(jar) and java:
            return "jar", [java, "-jar", jar]
    return None


def _run_epubcheck(cmd_prefix: list[str], kind: str, epub: str) -> tuple[list[dict], str | None]:
    """Return (issues_from_epubcheck, error_message)."""
    with tempfile.NamedTemporaryFile("w+", suffix=".json", delete=False) as tmp:
        report_path = tmp.name

    if kind == "npm":
        cmd = [*cmd_prefix, epub, "-O", report_path]
    else:
        cmd = [*cmd_prefix, epub, "--json", report_path]

    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
    except subprocess.TimeoutExpired:
        return [], "epubcheck timed out after 3 minutes."
    except FileNotFoundError as e:
        return [], f"epubcheck failed to launch: {e}"

    if not os.path.isfile(report_path) or os.path.getsize(report_path) == 0:
        stderr_tail = " ".join((proc.stderr or "").strip().splitlines()[-3:])
        return [], f"epubcheck did not produce a report (rc={proc.returncode}). {stderr_tail}"

    try:
        with open(report_path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, json.JSONDecodeError) as e:
        return [], f"epubcheck report unreadable: {e}"
    finally:
        try:
            os.unlink(report_path)
        except OSError:
            pass

    return list(data.get("messages") or []), None


def _severity_to_category(sev: str) -> str:
    s = (sev or "").lower()
    if s in ("fatal", "error"):
        return "Error"
    if s in ("warning", "usage"):
        return "Warning"
    return "Info"


@rule("EXTEPUB001")
def validate_via_epubcheck(book_details):
    """Run IDPF EpubCheck and surface every message it reports."""
    finder = _find_epubcheck()
    if finder is None:
        return {"issues_count": 1, "issues": [{
            "type": "epubcheck_not_installed",
            "message": (
                "EpubCheck is not installed on this server; skipping IDPF validation. "
                "Install with `brew install epubcheck` or set EPUBCHECK_JAR to the jar path."
            ),
            "category": "Info",
        }]}

    kind, cmd_prefix = finder
    folder = book_details["folder_name"]
    epub_file_path = find_epub_file_path(folder)
    if not epub_file_path.is_file():
        return {"issues_count": 0, "issues": []}
    epub_file = str(epub_file_path)

    messages, err = _run_epubcheck(cmd_prefix, kind, epub_file)
    if err:
        return {"issues_count": 1, "issues": [{
            "type": "epubcheck_failed",
            "message": err,
            "category": "Warning",
        }]}

    issues = []
    for m in messages[:200]:
        loc = (m.get("locations") or [{}])[0]
        issues.append({
            "type": "epubcheck_" + (m.get("severity") or "info").lower(),
            "rule_name": m.get("ID") or "EpubCheck",
            "message": m.get("message") or "",
            "category": _severity_to_category(m.get("severity")),
            "file_path": loc.get("path") if isinstance(loc, dict) else None,
            "line_number": loc.get("line") if isinstance(loc, dict) else None,
        })
    if len(messages) > 200:
        issues.append({
            "type": "epubcheck_truncated",
            "message": f"...and {len(messages) - 200} more EpubCheck messages truncated.",
            "category": "Info",
        })
    return {"issues_count": len(issues), "issues": issues}
