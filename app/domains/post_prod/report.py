"""
report.py
---------
Turns the raw diff + checks into (a) a JSON structure the React UI renders,
(b) a self-contained HTML report for sharing/archiving, and (c) a flat CSV log
for QA tracking. All three are derived from the same ``build_report`` result so
they never disagree.
"""

from __future__ import annotations

import csv
import datetime as _dt
import html
import io

from .css_diff import (
    ADDITIONAL_MARKER_RE,
    VERSION_BANNER_RE,
    compare,
    parse_css,
)
from .epub_utils import EpubInfo, check_sidecars
from .epub_validate import summarize_validation, validate_epub


SEVERITY = {
    "encoding": "error",
    "missing": "warning",
    "modified": "warning",
    "additional_marked": "info",
    "additional_unmarked": "warning",
    "sidecar_missing": "error",
    "version_mismatch": "info",
    "undefined_class": "info",
}


def build_report(
    epub: EpubInfo,
    master_text: str,
    package_filenames=None,
    expected_sidecars=None,
    epub_bytes=None,
) -> dict:
    package_filenames = package_filenames or []

    master_rules = parse_css(master_text)
    master_version = _banner_version(master_text)

    # Choose the primary stylesheet (largest .css in the EPUB).
    sheets = sorted(epub.stylesheets, key=lambda s: len(s.text), reverse=True)
    primary = sheets[0] if sheets else None

    report = {
        "generated_at": _dt.datetime.now().isoformat(timespec="seconds"),
        "epub": {
            "title": epub.title,
            "identifier": epub.identifier,
            "file_count": len(epub.filenames),
            "stylesheet_count": len(epub.stylesheets),
            "primary_stylesheet": primary.path if primary else None,
        },
        "master": {"version": master_version},
        "summary": {},
        "sidecar_checks": [],
        "encoding_checks": [],
        "version_check": {},
        "rule_diffs": [],
        "undefined_classes": [],
        "validation": {"issues": [], "summary": {}},
    }

    # --- EPUB spec/accessibility validation --------------------------------
    if epub_bytes is not None:
        v_issues = validate_epub(epub_bytes)
        report["validation"] = {
            "issues": v_issues,
            "summary": summarize_validation(v_issues),
        }

    # --- internal find #1: sidecar / delivery manifest checks ---------------
    for c in check_sidecars(package_filenames, expected_sidecars):
        report["sidecar_checks"].append(
            {
                "name": c.name,
                "found": c.found,
                "location": c.location,
                "severity": "ok" if c.found else SEVERITY["sidecar_missing"],
                "note": (
                    f"{c.name} present in delivery package."
                    if c.found
                    else f"{c.name} not found in the delivery package (queried and missing)."
                ),
            }
        )

    # --- encoding check (bonus real defect) --------------------------------
    for s in epub.stylesheets:
        report["encoding_checks"].append(
            {
                "path": s.path,
                "encoding": s.encoding,
                "is_utf8": s.is_utf8,
                "bad_byte_offset": s.bad_byte_offset,
                "severity": "ok" if s.is_utf8 else SEVERITY["encoding"],
                "note": (
                    "Valid UTF-8."
                    if s.is_utf8
                    else f"Not UTF-8 (decoded as {s.encoding}); first invalid "
                    f"byte at offset {s.bad_byte_offset}. Re-save as UTF-8."
                ),
            }
        )

    # --- version banner check ----------------------------------------------
    epub_version = _banner_version(primary.text) if primary else None
    report["version_check"] = {
        "master_version": master_version,
        "epub_version": epub_version,
        "match": (epub_version == master_version) if epub_version else False,
        "severity": "ok"
        if epub_version == master_version
        else SEVERITY["version_mismatch"],
        "note": (
            "Stylesheet version banner matches master."
            if epub_version == master_version
            else f"Version banner differs (master {master_version!r} vs epub {epub_version!r})."
        ),
    }

    # --- internal finds #2 and #3: rule-level diff -------------------------
    diffs = compare(master_rules, parse_css(primary.text), primary.text) if primary else []
    has_marker = bool(ADDITIONAL_MARKER_RE.search(primary.text)) if primary else False

    for d in diffs:
        entry = {
            "media": d.media,
            "selector": d.selector,
            "status": d.status,
        }
        if d.status == "modified":
            entry["severity"] = SEVERITY["modified"]
            entry["changes"] = [
                {
                    "property": dd.prop,
                    "master": dd.master_value,
                    "epub": dd.epub_value,
                    "kind": dd.kind,
                }
                for dd in d.decl_diffs
            ]
        elif d.status == "additional":
            entry["after_marker"] = d.after_marker
            entry["severity"] = (
                SEVERITY["additional_marked"]
                if d.after_marker
                else SEVERITY["additional_unmarked"]
            )
            entry["declarations"] = [
                {"property": p, "value": v} for p, v in d.epub_declarations
            ]
            entry["note"] = (
                "Declared below the '/* additional css */' marker (documented custom style)."
                if d.after_marker
                else "Extra selector not in master and NOT under the '/* additional css */' marker."
            )
        elif d.status == "missing":
            entry["severity"] = SEVERITY["missing"]
            entry["declarations"] = [
                {"property": p, "value": v} for p, v in d.master_declarations
            ]
        report["rule_diffs"].append(entry)

    report["has_additional_marker"] = has_marker

    # --- undefined class usage (bonus) -------------------------------------
    defined = _defined_class_names(master_rules + (parse_css(primary.text) if primary else []))
    for cls in sorted(epub.used_classes):
        if cls and cls not in defined:
            report["undefined_classes"].append(
                {"class": cls, "severity": SEVERITY["undefined_class"]}
            )

    # --- summary counts -----------------------------------------------------
    report["summary"] = _summarize(report)
    return report


def _summarize(report: dict) -> dict:
    rd = report["rule_diffs"]
    vsum = report.get("validation", {}).get("summary", {})
    counts = {
        "modified": sum(1 for r in rd if r["status"] == "modified"),
        "missing": sum(1 for r in rd if r["status"] == "missing"),
        "additional_marked": sum(
            1 for r in rd if r["status"] == "additional" and r.get("after_marker")
        ),
        "additional_unmarked": sum(
            1 for r in rd if r["status"] == "additional" and not r.get("after_marker")
        ),
        "sidecar_missing": sum(
            1 for c in report["sidecar_checks"] if not c["found"]
        ),
        "encoding_errors": sum(
            1 for c in report["encoding_checks"] if not c["is_utf8"]
        ),
        "undefined_classes": len(report["undefined_classes"]),
        "validation_errors": vsum.get("errors", 0),
        "validation_warnings": vsum.get("warnings", 0),
    }
    errors = (
        counts["sidecar_missing"]
        + counts["encoding_errors"]
        + counts["validation_errors"]
    )
    warnings = (
        counts["modified"]
        + counts["missing"]
        + counts["additional_unmarked"]
        + counts["validation_warnings"]
    )
    counts["errors"] = errors
    counts["warnings"] = warnings
    counts["infos"] = counts["additional_marked"] + counts["undefined_classes"]
    counts["verdict"] = (
        "FAIL" if errors else ("REVIEW" if warnings else "PASS")
    )
    return counts


def _banner_version(text: str):
    m = VERSION_BANNER_RE.search(text or "")
    return m.group(2) if m else None


def _defined_class_names(rules) -> set:
    names = set()
    import re as _re

    for r in rules:
        for cls in _re.findall(r"\.([A-Za-z_][\w-]*)", r.selector):
            names.add(cls)
    return names


# --------------------------------------------------------------------------- #
# Renderers
# --------------------------------------------------------------------------- #

def to_csv(report: dict) -> str:
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["category", "severity", "selector/name", "media", "detail"])

    for c in report["sidecar_checks"]:
        w.writerow(["sidecar", c["severity"], c["name"], "", c["note"]])
    for c in report["encoding_checks"]:
        w.writerow(["encoding", c["severity"], c["path"], "", c["note"]])

    vc = report["version_check"]
    w.writerow(["version", vc["severity"], "stylesheet banner", "", vc["note"]])

    for r in report["rule_diffs"]:
        media = r.get("media") or ""
        if r["status"] == "modified":
            for ch in r["changes"]:
                detail = f"{ch['property']}: master={ch['master']} | epub={ch['epub']} ({ch['kind']})"
                w.writerow(["modified", r["severity"], r["selector"], media, detail])
        elif r["status"] == "additional":
            decls = "; ".join(f"{d['property']}: {d['value']}" for d in r["declarations"])
            w.writerow(["additional", r["severity"], r["selector"], media,
                        f"{'[under marker] ' if r.get('after_marker') else '[unmarked] '}{decls}"])
        elif r["status"] == "missing":
            w.writerow(["missing", r["severity"], r["selector"], media,
                        "selector absent from EPUB stylesheet"])

    for u in report["undefined_classes"]:
        w.writerow(["undefined-class", u["severity"], u["class"], "",
                    "class used in XHTML but not defined in any stylesheet"])

    for i in report.get("validation", {}).get("issues", []):
        w.writerow(["validation:" + i["category"], i["level"], i["code"],
                    i["location"], i["message"]])
    return buf.getvalue()


_SEV_COLOR = {
    "error": "#b3261e",
    "warning": "#8a5a00",
    "info": "#3b5ba5",
    "ok": "#1b7a43",
}


def to_html(report: dict) -> str:
    e = html.escape
    s = report["summary"]
    verdict = s["verdict"]
    verdict_color = {"PASS": "#1b7a43", "REVIEW": "#8a5a00", "FAIL": "#b3261e"}[verdict]

    def badge(sev):
        return (f'<span style="display:inline-block;padding:1px 8px;border-radius:10px;'
                f'font-size:11px;font-weight:700;color:#fff;background:{_SEV_COLOR.get(sev,"#666")}">'
                f'{e(sev.upper())}</span>')

    rows = []
    for c in report["sidecar_checks"]:
        rows.append(f"<tr><td>Sidecar</td><td>{badge(c['severity'])}</td>"
                    f"<td><code>{e(c['name'])}</code></td><td></td><td>{e(c['note'])}</td></tr>")
    for c in report["encoding_checks"]:
        rows.append(f"<tr><td>Encoding</td><td>{badge(c['severity'])}</td>"
                    f"<td><code>{e(c['path'])}</code></td><td></td><td>{e(c['note'])}</td></tr>")
    vc = report["version_check"]
    rows.append(f"<tr><td>Version</td><td>{badge(vc['severity'])}</td>"
                f"<td>stylesheet banner</td><td></td><td>{e(vc['note'])}</td></tr>")

    for r in report["rule_diffs"]:
        media = e(r.get("media") or "")
        sel = f"<code>{e(r['selector'])}</code>"
        if r["status"] == "modified":
            for ch in r["changes"]:
                detail = (f"<code>{e(ch['property'])}</code>: "
                          f"master <b>{e(str(ch['master']))}</b> &rarr; "
                          f"epub <b>{e(str(ch['epub']))}</b> "
                          f"<i>({e(ch['kind'])})</i>")
                rows.append(f"<tr><td>Modified</td><td>{badge(r['severity'])}</td>"
                            f"<td>{sel}</td><td>{media}</td><td>{detail}</td></tr>")
        elif r["status"] == "additional":
            decls = "; ".join(f"{e(d['property'])}: {e(d['value'])}" for d in r["declarations"])
            tag = "[under marker] " if r.get("after_marker") else "[UNMARKED] "
            rows.append(f"<tr><td>Additional</td><td>{badge(r['severity'])}</td>"
                        f"<td>{sel}</td><td>{media}</td><td>{e(tag)}{decls}</td></tr>")
        elif r["status"] == "missing":
            rows.append(f"<tr><td>Missing</td><td>{badge(r['severity'])}</td>"
                        f"<td>{sel}</td><td>{media}</td><td>selector absent from EPUB</td></tr>")

    for u in report["undefined_classes"]:
        rows.append(f"<tr><td>Undefined class</td><td>{badge(u['severity'])}</td>"
                    f"<td><code>.{e(u['class'])}</code></td><td></td>"
                    f"<td>used in XHTML, not defined in CSS</td></tr>")

    for i in report.get("validation", {}).get("issues", []):
        rows.append(f"<tr><td>Validation &middot; {e(i['category'])}</td>"
                    f"<td>{badge(i['level'])}</td>"
                    f"<td><code>{e(i['code'])}</code></td>"
                    f"<td>{e(i['location'])}</td><td>{e(i['message'])}</td></tr>")

    return f"""<!doctype html><html><head><meta charset="utf-8">
<title>EPUB CSS Match Report - {e(report['epub']['title'] or '')}</title>
<style>
 body{{font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;margin:24px;color:#1a1a1a}}
 h1{{font-size:20px;margin:0 0 4px}} .sub{{color:#666;font-size:13px;margin-bottom:16px}}
 .verdict{{display:inline-block;padding:6px 14px;border-radius:6px;color:#fff;font-weight:800;
   background:{verdict_color};font-size:14px}}
 .cards{{display:flex;gap:10px;flex-wrap:wrap;margin:16px 0}}
 .card{{border:1px solid #e2e2e2;border-radius:8px;padding:10px 14px;min-width:96px}}
 .card b{{font-size:22px;display:block}} .card span{{color:#666;font-size:12px}}
 table{{border-collapse:collapse;width:100%;font-size:13px;margin-top:12px}}
 th,td{{border:1px solid #e2e2e2;padding:6px 8px;text-align:left;vertical-align:top}}
 th{{background:#f6f6f6}} code{{background:#f4f4f4;padding:1px 4px;border-radius:3px}}
</style></head><body>
<h1>EPUB CSS Match Report</h1>
<div class="sub">{e(report['epub']['title'] or 'Untitled')} &middot; {e(report['epub']['identifier'] or '')}
 &middot; generated {e(report['generated_at'])} &middot; master v{e(str(report['master']['version']))}</div>
<div class="verdict">{verdict}</div>
<div class="cards">
 <div class="card"><b>{s['modified']}</b><span>value changes</span></div>
 <div class="card"><b>{s['additional_marked']}</b><span>additional (marked)</span></div>
 <div class="card"><b>{s['additional_unmarked']}</b><span>additional (unmarked)</span></div>
 <div class="card"><b>{s['missing']}</b><span>missing selectors</span></div>
 <div class="card"><b>{s['encoding_errors']}</b><span>encoding errors</span></div>
 <div class="card"><b>{s['sidecar_missing']}</b><span>sidecar missing</span></div>
 <div class="card"><b>{s.get('validation_errors',0)}</b><span>validation errors</span></div>
 <div class="card"><b>{s.get('validation_warnings',0)}</b><span>validation warnings</span></div>
</div>
<table><thead><tr><th>Category</th><th>Severity</th><th>Selector / Name</th><th>@media</th><th>Detail</th></tr></thead>
<tbody>{''.join(rows)}</tbody></table>
</body></html>"""
