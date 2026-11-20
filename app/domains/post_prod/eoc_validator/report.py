"""Build the EOC validation report (JSON summary, Excel, CSV)."""

from __future__ import annotations

import csv
import io
from collections import Counter
from datetime import datetime

from .parser import ChapterFile
from .rules import ERROR, INFO, RULE_TITLES, WARNING, Issue

SEVERITY_ORDER = {ERROR: 0, WARNING: 1, INFO: 2}

NOT_CHECKED_NOTE = (
    "Choices that are all numbers in mixed order (e.g. 8′ | 12′ | 10′ | 15′). "
    "Numbers listed by size (e.g. 200 lb | 225 lb | 250 lb) only get a warning to confirm Shuffle and are never changed; "
    "years in chronological order (e.g. 1681 | 1781 | 1870 | 1981) must not shuffle and are fixed."
)


def build_report(files: list[ChapterFile], issues: list[Issue], reference_prefix: str) -> dict:
    by_file: dict[str, Counter] = {}
    for i in issues:
        by_file.setdefault(i.file, Counter())[i.severity] += 1

    summary = []
    for cf in sorted(files, key=lambda f: (f.chapter_no is None, f.chapter_no or 0, f.filename)):
        c = by_file.get(cf.filename, Counter())
        kinds = Counter(q.kind for q in cf.questions)
        summary.append({
            "file": cf.filename,
            "chapter": cf.chapter_no,
            "questions": len(cf.questions),
            "mc": kinds.get("MC", 0),
            "tf": kinds.get("TF", 0),
            "shuffle_lines": sum(1 for q in cf.questions if q.shuffle_line is not None),
            "images": cf.image_count,
            "errors": c.get(ERROR, 0),
            "warnings": c.get(WARNING, 0),
            "info": c.get(INFO, 0),
            "status": "fail" if c.get(ERROR) else ("review" if c.get(WARNING) else "pass"),
        })

    sorted_issues = sorted(
        issues,
        key=lambda i: (i.file == "(run)", i.chapter or 0, i.file, i.question or 0, SEVERITY_ORDER.get(i.severity, 9), i.rule),
    )
    totals = Counter(i.severity for i in issues)
    by_rule = Counter(i.rule for i in issues)
    return {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "reference_prefix": reference_prefix,
        "totals": {
            "files": len(files),
            "questions": sum(len(f.questions) for f in files),
            "errors": totals.get(ERROR, 0),
            "warnings": totals.get(WARNING, 0),
            "info": totals.get(INFO, 0),
        },
        "rules": [{"rule": r, "title": RULE_TITLES.get(r, r), "count": n} for r, n in sorted(by_rule.items())],
        "not_checked": [NOT_CHECKED_NOTE],
        "files": summary,
        "issues": [i.to_dict() for i in sorted_issues],
    }


ISSUE_COLUMNS = [
    ("file", "File"), ("chapter", "Chapter"), ("question", "Question"), ("severity", "Severity"),
    ("rule", "Rule"), ("rule_title", "Rule name"), ("message", "Message"), ("text", "Line text"), ("line", "Paragraph #"),
]


def to_csv(report: dict) -> str:
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow([h for _, h in ISSUE_COLUMNS])
    for i in report["issues"]:
        w.writerow(["" if i.get(k) is None else i.get(k) for k, _ in ISSUE_COLUMNS])
    return buf.getvalue()


def to_xlsx(report: dict, fixes: list[dict] | None = None) -> bytes:
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Font, PatternFill
    from openpyxl.utils import get_column_letter

    fills = {
        ERROR: PatternFill("solid", fgColor="FDE2E1"),
        WARNING: PatternFill("solid", fgColor="FEF3C7"),
        INFO: PatternFill("solid", fgColor="E0F2FE"),
        "pass": PatternFill("solid", fgColor="DCFCE7"),
        "review": PatternFill("solid", fgColor="FEF3C7"),
        "fail": PatternFill("solid", fgColor="FDE2E1"),
    }
    bold = Font(bold=True)
    head_fill = PatternFill("solid", fgColor="E2E8F0")

    wb = Workbook()
    ws = wb.active
    ws.title = "Summary"
    t = report["totals"]
    ws.append(["EOC/EOL Question Validation Report"])
    ws["A1"].font = Font(bold=True, size=13)
    ws.append(["Generated", report["generated_at"]])
    ws.append(["Reference prefix", report["reference_prefix"]])
    ws.append(["Files", t["files"], "Questions", t["questions"]])
    ws.append(["Errors", t["errors"], "Warnings", t["warnings"], "Info", t["info"]])
    ws.append(["Not checked", NOT_CHECKED_NOTE])
    ws.cell(ws.max_row, 1).font = bold
    ws.append([])
    cols = ["File", "Chapter", "Questions", "MC", "T/F", "Shuffle lines", "Images", "Errors", "Warnings", "Info", "Status"]
    ws.append(cols)
    hdr = ws.max_row
    for c in ws[hdr]:
        c.font, c.fill = bold, head_fill
    for f in report["files"]:
        ws.append([f["file"], f["chapter"], f["questions"], f["mc"], f["tf"], f["shuffle_lines"], f["images"], f["errors"], f["warnings"], f["info"], f["status"].upper()])
        ws.cell(ws.max_row, len(cols)).fill = fills[f["status"]]
    ws.auto_filter.ref = f"A{hdr}:{get_column_letter(len(cols))}{ws.max_row}"
    ws.freeze_panes = f"A{hdr + 1}"
    for i, w in enumerate([34, 9, 11, 7, 7, 13, 9, 9, 10, 7, 10], 1):
        ws.column_dimensions[get_column_letter(i)].width = w

    ws2 = wb.create_sheet("Issues")
    ws2.append([h for _, h in ISSUE_COLUMNS])
    for c in ws2[1]:
        c.font, c.fill = bold, head_fill
    for i in report["issues"]:
        ws2.append(["" if i.get(k) is None else i.get(k) for k, _ in ISSUE_COLUMNS])
        ws2.cell(ws2.max_row, 4).fill = fills.get(i["severity"], head_fill)
    ws2.auto_filter.ref = f"A1:{get_column_letter(len(ISSUE_COLUMNS))}{max(ws2.max_row, 1)}"
    ws2.freeze_panes = "A2"
    for i, w in enumerate([32, 9, 9, 10, 7, 30, 70, 60, 11], 1):
        ws2.column_dimensions[get_column_letter(i)].width = w
    for row in ws2.iter_rows(min_row=2):
        row[6].alignment = Alignment(wrap_text=True, vertical="top")
        row[7].alignment = Alignment(wrap_text=True, vertical="top")

    if fixes is not None:
        wsf = wb.create_sheet("Fixes", 1)
        wsf.append(["File", "Question", "Rule", "Change", "Before", "After"])
        for c in wsf[1]:
            c.font, c.fill = bold, head_fill
        for f in fixes:
            wsf.append([f["file"], f["question"] if f["question"] is not None else "", f["rule"], f["action"], f["before"], f["after"]])
        wsf.auto_filter.ref = f"A1:F{max(wsf.max_row, 1)}"
        wsf.freeze_panes = "A2"
        for i, w in enumerate([32, 9, 7, 44, 55, 55], 1):
            wsf.column_dimensions[get_column_letter(i)].width = w

    ws3 = wb.create_sheet("Rules")
    ws3.append(["Rule", "Name", "Issues"])
    for c in ws3[1]:
        c.font, c.fill = bold, head_fill
    for r in report["rules"]:
        ws3.append([r["rule"], r["title"], r["count"]])
    ws3.column_dimensions["B"].width = 40

    out = io.BytesIO()
    wb.save(out)
    return out.getvalue()
