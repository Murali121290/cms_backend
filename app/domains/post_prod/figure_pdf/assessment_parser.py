"""Art Assessment Excel parser.

Pure, dependency-light parsing of client-supplied Art Assessment workbooks.
Nothing here touches the database, the filesystem (beyond opening the input
path), or any FastAPI machinery — the output is a plain dataclass tree that
the caller can persist, serialize, or render as it sees fit.

Contract summary (see docs/art-assessment/ART_ASSESSMENT_IMPLEMENTATION_PLAN.md):

* The uploaded Excel is the source of truth. We never coerce cell values and
  never substitute defaults for blanks.
* Sheet name, header row, and column order are all detected dynamically.
* Known headers are mapped to canonical field names via an alias registry;
  everything else is retained verbatim in ``ParsedAssessmentRow.unmapped`` and
  in ``ParsedAssessment.unmapped_columns``.
* Outer whitespace is trimmed; internal punctuation, case, and typos survive.
"""

from __future__ import annotations

import datetime as _dt
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable

from openpyxl import load_workbook
from openpyxl.worksheet.worksheet import Worksheet


# ---------------------------------------------------------------------------
# Public dataclasses
# ---------------------------------------------------------------------------


@dataclass
class ParsedAssessmentRow:
    """One figure row from the client workbook.

    ``canonical`` holds mapped field values (``None`` where blank).
    ``unmapped`` holds every column whose header did not match the alias
    registry, keyed by the raw header string exactly as it appeared in the
    workbook.
    """

    row_index: int  # 1-based row number within the data region (not the sheet)
    canonical: dict[str, str | None] = field(default_factory=dict)
    unmapped: dict[str, str | None] = field(default_factory=dict)


@dataclass
class ParsedAssessment:
    """Full workbook parse result."""

    project_info: dict[str, str | None] = field(default_factory=dict)
    project_info_sheet: str | None = None
    data_sheet_name: str | None = None
    header_row_index: int | None = None  # 1-based
    canonical_columns: dict[str, str] = field(default_factory=dict)  # field_name -> raw header
    unmapped_columns: list[str] = field(default_factory=list)       # raw headers, in source order
    # (raw_header, canonical_field_or_None) in the client's column order.
    # Lets the output writer reproduce the client's exact header layout.
    source_columns: list[tuple[str, str | None]] = field(default_factory=list)
    rows: list[ParsedAssessmentRow] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


class AssessmentParseError(ValueError):
    """Fatal parser error — the workbook cannot be interpreted as an Art Assessment."""


# ---------------------------------------------------------------------------
# Alias registry
# ---------------------------------------------------------------------------
#
# Mapping from canonical field name -> list of acceptable header spellings.
# Matching is done on a canonicalized form of both sides (see ``_canon``),
# so case, whitespace, trailing punctuation, and parenthetical groups do not
# matter. When adding a new alias, keep the original spelling verbatim so the
# intent stays readable.

ALIAS_REGISTRY: dict[str, tuple[str, ...]] = {
    "chapter_label": (
        "Chapter NO.",
        "Chapter Name",
        "Chapter No",
        "Chapter",
    ),
    "figure_no": (
        "Figure No.",
        "Output Figure no.",
        "Figure Number",
        "Fig No",
        "FIGURE NO.",
    ),
    "art_name": (
        "Original File Name",
        "Original Filename",
        "File Name",
        "Art Name",
        "ART NAME",
    ),
    "source_status": (
        "Source",
        "Source Status",
    ),
    "output_color": (
        "Output color",
        "Output Color",
        "Final Art Color",
        "FINAL ART COLOR",
    ),
    "classification": (
        "Re-lable (or) Re-Key Category",
        "Category",
        "Art Classification",
        "ART CLASSIFICATION",
        "Classification",
    ),
    "editorial_instructions": (
        "Comments/Instructions from Editorial",
        "Editorial Instructions",
        "Special Instruction",
        "SPECIAL INSTRUCTION",
        "Special Instructions",
    ),
    "suggested_sizing": (
        "Suggested Sizing",
        "Final Size",
        "FINAL SIZE",
        "Size",
    ),
    "billing_status": (
        "S4 Billing status",
        "Billing Status",
        "Billing",
    ),
    "complexity": (
        "Complexity",
        "COMPLEXITY",
    ),
    "queries": (
        "Queries",
    ),
    "queries_detail": (
        "Queries Details",
        "Query Details",
        "Query Detail",
    ),
    "query_replies": (
        "Querie replies",   # observed misspelling (Murphy workbook)
        "Query Replies",
    ),
    "batch_no": (
        "Batch No",
        "Batch Number",
        "Batch",
    ),
    "remarks": (
        "Remarks",
        "Notes",
        "Comments",
    ),
    "status": (
        "Status",
        "STATUS",
    ),
    "part_no": (
        "Part No.",
        "PART NO.",
        "Part Number",
    ),
    "type": (
        "Type",
        "TYPE",
    ),
}


_CANON_STRIP_RE = re.compile(r"[\s\._\-/()\[\]]+")


def _canon(s: str) -> str:
    """Normalize a header for matching.

    Case-folded, outer whitespace removed, internal punctuation / whitespace
    stripped. Note that we strip ``/`` too so ``b/w`` or ``Querie replies``
    don't accidentally collide on inner slashes.
    """
    return _CANON_STRIP_RE.sub("", s.strip().casefold())


# Pre-compute canonical -> field_name lookup. Order matters for first-wins
# collision reporting, so we build it from ALIAS_REGISTRY in declaration order.
_CANON_INDEX: dict[str, str] = {}
for _field, _aliases in ALIAS_REGISTRY.items():
    for _alias in _aliases:
        _CANON_INDEX.setdefault(_canon(_alias), _field)


# ---------------------------------------------------------------------------
# Cell helpers
# ---------------------------------------------------------------------------


def _cell_text(value: Any) -> str | None:
    """Convert an openpyxl cell value to a trimmed string, or ``None`` if blank.

    * ``None`` -> ``None``
    * str -> stripped; empty string becomes ``None``
    * datetime with midnight time -> ISO date (``2027-01-29``) so a pure
      calendar date doesn't surface as ``2027-01-29 00:00:00`` in the UI.
    * datetime with a non-midnight time -> ISO string preserving the time.
    * everything else (int, float, bool) -> ``str(value)`` trimmed.

    We intentionally keep numbers as their ``str()`` representation so that
    a client-typed ``"Fig 1.1"`` doesn't suddenly get rendered as ``1.1``
    when the cell happens to be a numeric type. Trim only outer whitespace.
    """

    if value is None:
        return None
    if isinstance(value, str):
        stripped = value.strip()
        return stripped or None
    if isinstance(value, _dt.datetime):
        if value.time() == _dt.time(0, 0):
            return value.date().isoformat()
        return value.isoformat(sep=" ")
    if isinstance(value, _dt.date):
        return value.isoformat()
    text = str(value).strip()
    return text or None


def _row_is_blank(cells: Iterable[Any]) -> bool:
    return all(_cell_text(c) is None for c in cells)


# ---------------------------------------------------------------------------
# Project-info detection
# ---------------------------------------------------------------------------


def _detect_project_info_sheet(wb) -> str | None:
    """Return the name of the first sheet that looks like a project-info block.

    Heuristic: a sheet whose non-empty rows match the ``[label, ":", value]``
    shape for at least 60% of inspected rows, and whose width is <= 4 columns.
    """

    for name in wb.sheetnames:
        ws = wb[name]
        if ws.max_column > 4:
            continue
        rows_seen = 0
        rows_matching = 0
        for row in ws.iter_rows(min_row=1, max_row=min(ws.max_row, 30), values_only=True):
            cells = list(row) + [None] * (3 - len(row)) if len(row) < 3 else list(row)
            if _row_is_blank(cells):
                continue
            rows_seen += 1
            label = _cell_text(cells[0]) if len(cells) > 0 else None
            sep = _cell_text(cells[1]) if len(cells) > 1 else None
            if label and sep == ":":
                rows_matching += 1
        if rows_seen >= 3 and rows_matching / rows_seen >= 0.6:
            return name
    return None


def _extract_project_info(ws: Worksheet) -> dict[str, str | None]:
    """Collect every ``label: value`` pair from the project-info sheet.

    Trailing whitespace in the label is preserved so the caller can see the
    client's original key exactly (e.g. ``"Previous Edition "``).
    """

    info: dict[str, str | None] = {}
    for row in ws.iter_rows(min_row=1, values_only=True):
        cells = list(row)
        if len(cells) < 3 or _row_is_blank(cells):
            continue
        label = cells[0]
        sep = _cell_text(cells[1])
        if sep != ":" or label is None:
            continue
        # Preserve the raw label verbatim (including trailing spaces) as the key.
        key = str(label) if not isinstance(label, str) else label
        value = _cell_text(cells[2])
        info[key] = value
    return info


# ---------------------------------------------------------------------------
# Data-sheet / header-row detection
# ---------------------------------------------------------------------------


# Header-row scoring: a row needs this many alias hits AND this many distinct
# canonical fields to be considered a header.
_MIN_HEADER_SCORE = 3
_MIN_DISTINCT_FIELDS = 2
_HEADER_SCAN_DEPTH = 15  # rows inspected per sheet


def _score_header_row(row: tuple[Any, ...]) -> tuple[int, set[str]]:
    """Return (hits, {fields}) for a candidate header row."""
    hits = 0
    fields: set[str] = set()
    for cell in row:
        text = _cell_text(cell)
        if not text:
            continue
        field = _CANON_INDEX.get(_canon(text))
        if field:
            hits += 1
            fields.add(field)
    return hits, fields


def _detect_data_sheet(wb, exclude: set[str]) -> tuple[str, int]:
    """Find the sheet + row index containing the figure data headers.

    Returns ``(sheet_name, header_row_1_based)``. Raises
    :class:`AssessmentParseError` when no sheet scores high enough.
    """

    best: tuple[int, str, int, set[str]] | None = None  # (score, name, row, fields)

    for name in wb.sheetnames:
        if name in exclude:
            continue
        ws = wb[name]
        if ws.max_row == 0:
            continue
        for r_idx, row in enumerate(
            ws.iter_rows(min_row=1, max_row=min(ws.max_row, _HEADER_SCAN_DEPTH), values_only=True),
            start=1,
        ):
            hits, fields = _score_header_row(row)
            if hits < _MIN_HEADER_SCORE or len(fields) < _MIN_DISTINCT_FIELDS:
                continue
            if best is None or hits > best[0]:
                best = (hits, name, r_idx, fields)

    if best is None:
        raise AssessmentParseError(
            "No recognizable Art Assessment header found in this workbook."
        )
    return best[1], best[2]


# ---------------------------------------------------------------------------
# Row extraction
# ---------------------------------------------------------------------------


_MAX_CONSECUTIVE_BLANKS = 10


def _extract_rows(
    ws: Worksheet,
    header_row: int,
    canonical_cols: dict[int, str],         # column_index -> canonical field
    unmapped_cols: dict[int, str],          # column_index -> raw header
) -> list[ParsedAssessmentRow]:
    """Yield ParsedAssessmentRow objects, stopping once blank rows dominate."""

    out: list[ParsedAssessmentRow] = []
    blank_streak = 0
    data_row_index = 0
    kept_col_indices = sorted(set(canonical_cols) | set(unmapped_cols))

    for row in ws.iter_rows(min_row=header_row + 1, values_only=True):
        # The whole row might be shorter than the widest header row; pad.
        row_padded: list[Any] = list(row)
        if kept_col_indices and len(row_padded) <= max(kept_col_indices):
            row_padded.extend([None] * (max(kept_col_indices) + 1 - len(row_padded)))

        kept_values = [row_padded[i] for i in kept_col_indices]
        if _row_is_blank(kept_values):
            blank_streak += 1
            if blank_streak >= _MAX_CONSECUTIVE_BLANKS:
                break
            continue
        blank_streak = 0
        data_row_index += 1

        canonical: dict[str, str | None] = {}
        for col_idx, fname in canonical_cols.items():
            canonical[fname] = _cell_text(row_padded[col_idx])

        unmapped: dict[str, str | None] = {}
        for col_idx, raw in unmapped_cols.items():
            unmapped[raw] = _cell_text(row_padded[col_idx])

        out.append(
            ParsedAssessmentRow(
                row_index=data_row_index,
                canonical=canonical,
                unmapped=unmapped,
            )
        )

    return out


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------


def parse_assessment_workbook(path: str | Path) -> ParsedAssessment:
    """Parse an Art Assessment workbook from disk.

    Raises :class:`AssessmentParseError` when the file cannot be interpreted
    as an Art Assessment (e.g. no recognizable headers). All other oddities —
    unmapped columns, duplicate alias matches, numeric figure numbers — are
    collected into :attr:`ParsedAssessment.warnings` and never raise.
    """

    path = Path(path)
    if path.suffix.lower() != ".xlsx":
        raise AssessmentParseError(
            f"Only .xlsx workbooks are supported; got {path.suffix!r}."
        )

    wb = load_workbook(path, data_only=True, read_only=True)
    try:
        result = ParsedAssessment()

        project_sheet = _detect_project_info_sheet(wb)
        if project_sheet:
            result.project_info_sheet = project_sheet
            result.project_info = _extract_project_info(wb[project_sheet])

        exclude: set[str] = set()
        if project_sheet:
            exclude.add(project_sheet)

        sheet_name, header_row = _detect_data_sheet(wb, exclude=exclude)
        result.data_sheet_name = sheet_name
        result.header_row_index = header_row

        ws = wb[sheet_name]
        header_cells = next(
            ws.iter_rows(min_row=header_row, max_row=header_row, values_only=True)
        )

        # Classify each column. Column indices are 0-based in our dicts; we
        # keep raw headers verbatim.
        canonical_cols: dict[int, str] = {}
        unmapped_cols: dict[int, str] = {}
        seen_fields: dict[str, str] = {}  # field -> raw header (first one wins)
        source_columns: list[tuple[str, str | None]] = []

        for col_idx, header_val in enumerate(header_cells):
            raw = _cell_text(header_val)
            if not raw:
                continue  # drop blank-header columns (Murphy padding)
            field = _CANON_INDEX.get(_canon(raw))
            if field is None:
                unmapped_cols[col_idx] = raw
                result.unmapped_columns.append(raw)
                source_columns.append((raw, None))
                continue
            if field in seen_fields:
                # Second column mapping to the same canonical field: keep the
                # first, treat the rest as unmapped so no data is lost.
                result.warnings.append(
                    f"Columns {seen_fields[field]!r} and {raw!r} both map to "
                    f"{field!r}; using {seen_fields[field]!r} and preserving "
                    f"{raw!r} as an unmapped column."
                )
                unmapped_cols[col_idx] = raw
                result.unmapped_columns.append(raw)
                source_columns.append((raw, None))
                continue
            canonical_cols[col_idx] = field
            seen_fields[field] = raw
            source_columns.append((raw, field))

        result.canonical_columns = {f: h for f, h in seen_fields.items()}
        result.source_columns = source_columns

        if result.unmapped_columns:
            result.warnings.append(
                "Unmapped columns preserved verbatim: "
                + ", ".join(repr(c) for c in result.unmapped_columns)
            )

        result.rows = _extract_rows(ws, header_row, canonical_cols, unmapped_cols)

        if not result.rows:
            # Non-fatal — the workbook is technically well-formed, there's just
            # nothing to generate from. The UI should surface this before the
            # user hits Generate.
            result.warnings.append(
                "The data sheet has recognizable headers but contains zero figure rows."
            )

        return result
    finally:
        wb.close()


__all__ = [
    "ALIAS_REGISTRY",
    "AssessmentParseError",
    "ParsedAssessment",
    "ParsedAssessmentRow",
    "parse_assessment_workbook",
]
