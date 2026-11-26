# Alias Registry Maintenance Guide

The Art Assessment parser maps every client-supplied Excel header into one of a
fixed set of **canonical fields**. The mapping lives in a single Python
constant:

```
app/domains/post_prod/figure_pdf/assessment_parser.py :: ALIAS_REGISTRY
```

This document explains the shape of that registry, how header-matching works,
and the workflow for extending it when a new client format arrives.

---

## 1. What the registry does

`ALIAS_REGISTRY` is a `dict[str, tuple[str, ...]]`:

```python
ALIAS_REGISTRY = {
    "chapter_label":        ("Chapter NO.", "Chapter Name", "Chapter No", "Chapter"),
    "figure_no":            ("Figure No.", "Output Figure no.", "Figure Number", "Fig No", "FIGURE NO."),
    "art_name":             ("Original File Name", "Original Filename", "File Name", "Art Name", "ART NAME"),
    ...
}
```

The key (`chapter_label`, `figure_no`, …) is the **canonical field name**. It
is the stable identifier used in:

- `ArtAssessmentRow` columns (`app/domains/post_prod/figure_pdf/models.py`)
- `ParsedAssessmentRow.canonical` dict keys returned by the parser
- `ParseAssessmentExcelResponse.canonical_columns` sent to the UI
- `CANONICAL_LABELS` user-visible map in
  `frontend/src/features/artAssessment/AssessmentPreview.tsx`

The value is a tuple of **raw client headers** that should map to that field.
Order matters only for readability — the matcher collapses them all into the
same canonical key.

---

## 2. How matching works

The matcher is implemented by `_canon()` in `assessment_parser.py`:

```python
_CANON_STRIP_RE = re.compile(r"[\s\._\-/()\[\]]+")

def _canon(s: str) -> str:
    return _CANON_STRIP_RE.sub("", s.strip().casefold())
```

Both the client's header *and* every alias are canonicalised through this
function before comparison. The following are all equivalent at match time:

| Raw client header            | Canonicalised form |
| ---                          | --- |
| `Chapter NO.`                | `chapterno` |
| `Chapter Name`               | `chaptername` |
| `chapter_no`                 | `chapterno` |
| `CHAPTER NO`                 | `chapterno` |
| `Output color`               | `outputcolor` |
| `OUTPUT COLOR`               | `outputcolor` |
| `Comments/Instructions from Editorial` | `commentsinstructionsfromeditorial` |
| `Querie replies`             | `queriereplies` (note: typo preserved) |

Consequences:

- **You never need to add case / punctuation variants** of an alias. Add one
  canonical spelling and the matcher handles everything else.
- **Typos must be added as their own entry** — the matcher cannot know that
  `Querie replies` is meant to be `Query Replies`. See the live example in the
  `query_replies` entry.
- **Different canonical fields must have *different* canonicalised forms.**
  The `test_alias_registry_has_no_cross_field_collisions` test enforces this.

---

## 3. First-wins collision handling

If two columns in the same workbook canonicalise to the same alias *group*
(e.g., the client has both `Final Size` and `Suggested Sizing`), the parser:

1. Keeps the first one as the canonical mapping.
2. Records the rest as `unmapped_columns` so their data still reaches the
   output xlsx and the row's `extras_json`.
3. Emits a warning: `"Columns 'Final Size' and 'Suggested Sizing' both map to
   'suggested_sizing'; using 'Final Size' and preserving 'Suggested Sizing'
   as an unmapped column."`

The unit test `test_duplicate_alias_match_keeps_first_and_preserves_second`
locks this behavior.

---

## 4. Adding a new alias to an existing field

**Scenario**: a new client sends a workbook with column `Figure Identifier`.
It means the same as `figure_no`.

Steps:

1. **Add the raw spelling** to `ALIAS_REGISTRY["figure_no"]` in
   `app/domains/post_prod/figure_pdf/assessment_parser.py`.
2. **Add a fixture + test** mirroring the new client's workbook. Copy the
   file to `tests/fixtures/art_assessment/<client>_<project>.xlsx` and
   add an assertion in `tests/test_art_assessment_parser.py`:
   ```python
   def test_parse_newclient_newformat():
       parsed = parse_assessment_workbook(FIXTURES / "newclient_123.xlsx")
       assert parsed.canonical_columns["figure_no"] == "Figure Identifier"
   ```
3. **Run the full suite**:
   ```
   python -m pytest tests/test_art_assessment_*.py -q
   ```
   All 43 tests should remain green.
4. **No migration or UI change is needed** — the canonical field already
   exists, so both DB and frontend rendering paths are already wired.

---

## 5. Adding a new canonical field

**Scenario**: a new client sends a column called `Approval Status` that doesn't
semantically belong to any existing canonical field.

This is a larger change because the canonical field must be added in four
places (listed in dependency order):

### 5.1 Database — add a column to `art_assessment_rows`

Edit `app/domains/post_prod/figure_pdf/models.py`:

```python
class ArtAssessmentRow(Base):
    ...
    approval_status = Column(Text, nullable=True)
    ...
```

Create a new Alembic migration:

```
alembic/versions/00NN_add_approval_status_to_art_assessment_rows.py
```

Follow the pattern in `0069_art_assessment_rows_table.py`. Keep the migration
idempotent (check `inspector.get_columns(...)` before adding).

### 5.2 Parser — add to the alias registry

In `assessment_parser.py`:

```python
ALIAS_REGISTRY = {
    ...
    "approval_status": ("Approval Status", "Approval"),
    ...
}
```

### 5.3 Frontend labels

In `frontend/src/features/artAssessment/AssessmentPreview.tsx`:

```typescript
const CANONICAL_LABELS: Record<string, string> = {
    ...
    approval_status: "Approval Status",
    ...
};
```

Without this, the preview will fall back to the raw canonical key
(`approval_status`), which works but is ugly.

### 5.4 Tests

Add coverage to `tests/test_art_assessment_parser.py`:

- A positive test: a workbook containing the new column round-trips into the
  expected canonical field.
- Update `test_alias_registry_has_no_cross_field_collisions` — it reads the
  registry dynamically so no code change is required; just confirm it still
  passes.

### 5.5 Service — automatic

The dispatcher in `service.py` uses

```python
row_cols = {c.name for c in ArtAssessmentRow.__table__.columns}
```

to filter canonical keys before passing them to the ORM. As long as the model
column exists, no service change is needed.

---

## 6. Handling unmappable columns intentionally

When a client column is truly one-off or ambiguous (e.g., `Internal Scratchpad`
from a single project) — **do not** add it to `ALIAS_REGISTRY`. The parser
will keep it in each row's `extras_json` and in
`ParsedAssessment.unmapped_columns`, and the output xlsx will emit it as a
trailing column with the raw header. This is the intended path for one-off
data.

The warnings pane in the preview UI makes this visible to the operator:

> Unmapped columns preserved verbatim: 'Internal Scratchpad'

---

## 7. Local testing workflow

Quick commands assuming you're in the repo root with the venv active:

```bash
# All art-assessment tests
python -m pytest tests/test_art_assessment_parser.py \
                 tests/test_parse_assessment_excel_endpoint.py \
                 tests/test_generate_assessment_dispatcher.py \
                 tests/test_art_assessment_phase6.py -q

# Just the parser (fastest; no DB / HTTP overhead)
python -m pytest tests/test_art_assessment_parser.py -q

# One targeted test
python -m pytest tests/test_art_assessment_parser.py::test_lancaster_project_info_detected -v

# Rebuild the legacy-format fixture if you change the generator's header list
python tests/fixtures/art_assessment/_build_legacy_fixture.py
```

---

## 8. Common pitfalls

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| New client column shows under "Additional data" expander even though you added an alias | Alias string has a leading/trailing character that stripping removed → canonicalises to something else | Compare `_canon("Your Header")` with `_canon(client_value)` in a REPL; adjust the alias or add the exact variant |
| Two aliases collide at test time | You added a new field whose canonical form matches an existing alias | Either the two concepts are the same (fold them) or rename one more specifically |
| Output xlsx drops a column | You are checking `unmapped_columns` on an outdated parse — re-run against the real workbook | Open the generated xlsx; the trailing columns after the canonical block are the preserved unmapped ones |
| Cell value looks numeric but should be text | openpyxl returned an int/float; we stringify it, but Excel's own type coercion can surprise you | Confirm by opening the source xlsx and checking the cell's raw type |

---

## 9. Related docs

- [ART_ASSESSMENT_IMPLEMENTATION_PLAN.md](./ART_ASSESSMENT_IMPLEMENTATION_PLAN.md) — overall design, open questions, phased roadmap.
- `app/domains/post_prod/figure_pdf/assessment_parser.py` — the registry itself and the matcher.
- `app/domains/post_prod/figure_pdf/models.py` — the DB columns that must mirror the registry.
- `tests/test_art_assessment_parser.py` — the regression tests you'll extend each time a new alias arrives.

---

*Last updated during Phase 6 hardening.*
