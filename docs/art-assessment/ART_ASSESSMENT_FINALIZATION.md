# Art Assessment — Finalization Based on Live Test Evidence

Status: **Investigation and plan update. No code changes made yet.**
Date: 2026-11-25
Branch: `dev-priya` (working tree, Phase 1–6 landed uncommitted)
Trigger: live smoke test of chapter 63 against the rebuilt backend containers (Phase 6 code deployed).

> This document finalizes the Art Assessment plan against **what actually
> happened in a real test**, not what was expected. It supersedes
> `ART_ASSESSMENT_IMPLEMENTATION_PLAN.md` wherever they disagree.

---

## 1. What the live test produced

User uploaded `Ankit Pathak Author Photo BDC.tif` into the chapter's Art folder,
selected that row, clicked **Generate Assessment**. Output:

```
Ankit Pathak Author Photo BDC_ArtAssessment.xlsx
  Sheet: "1. Chapter 01 Art"  (2 × 15)
  R1: ART NAME, FIGURE NO., PART NO., TYPE, ART CLASSIFICATION,
      SUPPLIED IMAGE COLOR, SUPPLIED IMAGE MODE, SUPPLIED IMAGE TYPE,
      SUPPLIED SIZE, FINAL SIZE, SPECIAL INSTRUCTION , FINAL ART COLOR,
      COMPLEXITY, RESOLUTION (HALFTONE ONLY), STATUS
  R2: 'Ankit Pathak Author Photo BDC.tif', None, None, 'Figure', None,
      'Grayscale', 'L', 'TIFF', '1 MB', None, None, None, None, '600 DPI', None
```

That is the **legacy 15-column images-only template** with a single row — the
assessment-Excel-driven path never ran.

---

## 2. Why — verified by inspecting the live DB

Query against `cms_db` at test time:

```
chapter_id = 63, category = 'Art'

id  | filename                                          | is_original
----|---------------------------------------------------|------------
438 | Artproof_Chapter 01.pdf                           | true
439 | Artproof_Chapter 02.pdf                           | true
440 | Pathak_190442.pdf                                 | true
441 | Ankit Pathak Author Photo BDC.tif                 | true
442 | Ankit Pathak Author Photo BDC_ArtProof.pdf        | false   ← generator output
443 | Ankit Pathak Author Photo BDC_ArtAssessment.xlsx  | false   ← generator output
444 | Murphy_F01-01.eps                                 | true
445 | Murphy_F01-01_ArtProof.pdf                        | false   ← generator output
446 | Murphy_F01-01_ArtAssessment.xlsx                  | false   ← generator output
```

**The chapter contains zero uploaded assessment Excel files.** The three PDFs,
one TIF and one EPS are all that was uploaded. The two xlsx files are
generator output, flagged `is_original=false` with the `_ArtAssessment.xlsx`
suffix — correctly excluded as source candidates by
`_is_excel_assessment_source`.

So the dispatcher, running the code at
`app/domains/post_prod/figure_pdf/service.py:generate_figure_assessment`:

1. `source_file_id` = TIF id (frontend passed it because the TIF matches the
   scope-regex at `ChapterFilePage.tsx:1448`).
2. Looked up the file; `_is_excel_assessment_source(tif)` → `False`.
3. Set `source_imagefile = TIF`, `source_xlsx = None`.
4. Called `_generate_from_images(source_file=TIF)` → 15-column template with
   one row.

**Behavior is correct per the current code. The gap is between the code and
the user's expectation.**

---

## 3. Does the system read the assessment Excel at all?

**Yes — but only on specific dispatcher paths.** Verified in
`app/domains/post_prod/figure_pdf/service.py`:

| User action in Art folder | Dispatcher routes to |
|---|---|
| `file_id` = uploaded `.xlsx` (is_original=True, no `_ArtAssessment` suffix) | `_generate_from_excel` — parses the xlsx |
| `file_id` = DOCX / image file | `_generate_from_images` — ignores any xlsx |
| No `file_id`, 1 uploaded xlsx in chapter | `_generate_from_excel` — parses that xlsx |
| No `file_id`, 0 uploaded xlsx | `_generate_from_images` — chapter-wide image scan |
| No `file_id`, 2+ uploaded xlsx | 400 — "Pass file_id to pick one" |

The Excel-path parser (`assessment_parser.parse_assessment_workbook`) exists,
is covered by 43 passing tests, and does exactly what the finalization
requirements ask. It:

- Reads project-info sheet verbatim.
- Autodetects the data sheet and header row.
- Maps 18 canonical fields via the alias registry.
- Preserves every unmapped column in per-row `extras_json` + sheet-level
  `unmapped_columns`.
- Writes the generator output as `{stem}_ArtAssessment_generated.xlsx`
  (note the `_generated` suffix — different from the images-only path's
  `{stem}_ArtAssessment.xlsx`).

**In the live test, this path never ran because no `.xlsx` was ever uploaded
to the chapter.** The user tested the fallback path and reported it as a bug.

---

## 4. Gaps between current code and finalized acceptance criteria

The new acceptance criteria (from the latest finalization message) tighten the
spec. Below is a gap-by-gap list.

### G1 — Dispatcher must prefer the assessment Excel even when an image row is selected

**Spec**: when both an assessment Excel and images exist in the Art folder, the
Excel is the source of truth regardless of which row the user clicked.

**Current**: selecting any non-xlsx row with `file_id` forces the images-only
path, ignoring any uploaded xlsx in the same folder.

**Fix required**: the dispatcher's selection rule becomes:
1. If `file_id` points at an uploaded xlsx → Excel path on that xlsx.
2. Else if the chapter contains exactly one uploaded xlsx → Excel path on it
   (the clicked image, if any, becomes just another enrichment candidate).
3. Else if the chapter contains 2+ uploaded xlsx → error.
4. Else → images-only path (scoped to `file_id` if given).

**Code to change**: `service.py: generate_figure_assessment` dispatcher
block. ~15 lines.

**Test coverage change**: add a test — upload Pathak xlsx + TIF, select the
TIF, expect `source == "excel"` and all 3 Pathak rows in the output.

### G2 — Unmatched images must become their own rows, not disappear

**Spec**: "If an image cannot be matched confidently to an assessment row,
retain it as a separate unmatched image record. Do not discard it or attach it
to an unrelated figure."

**Current**: `_generate_from_excel` iterates parsed Excel rows only; images in
the Art folder whose filename doesn't match any row's `art_name` or
`figure_no` are silently excluded from the output.

**Fix required**:
- After matching, compute the leftover images (those not consumed by any
  parsed row).
- Append them to the output xlsx as additional rows below the last parsed
  row. Keep the client's canonical columns empty for those rows; fill only
  the image-metadata columns and a dedicated `Match Status` column with the
  value `Unmatched image`.
- Persist them as `ArtAssessmentRow` records with `row_index` continuing
  past the Excel's last row, canonical fields `NULL`, `extras_json = {}`,
  `image_meta_json` set, and a flag — simplest: reuse `extras_json` with a
  stable key like `__match_status__ = "unmatched"`, or add a new
  `match_status` column to `art_assessment_rows`.

**Code to change**: `service.py: _generate_from_excel` + output writer; new
migration if we add a dedicated column.

**Test coverage**: add a fixture test — Pathak xlsx + 1 unmatched image
→ 3 Excel rows + 1 unmatched row.

### G3 — Frontend must open the preview even when an image row is selected

**Spec**: user should see the Excel's project info and rows *before* Generate
runs, regardless of which row is clicked.

**Current**: `handleGenerateAssessment` only opens the preview when the
selected row is itself an xlsx, or when nothing is selected and there's
exactly one xlsx in the folder.

**Fix required**: change the detection rule in
`frontend/src/pages/ChapterFilePage.tsx:isUploadedAssessmentXlsx` and
`handleGenerateAssessment` so the preview opens whenever the chapter's Art
folder contains exactly one uploaded xlsx, *irrespective of what row is
selected*. The selected image row is still passed to the backend so the
image-metadata enrichment can prioritize it, but the preview always shows
the Excel.

**Code to change**: ~10 lines in `ChapterFilePage.tsx`.

### G4 — UX hint when no assessment Excel is present

**Spec**: user expects to be told "upload the assessment Excel first" if they
try Generate without one.

**Current**: the backend returns the clearer post-Phase-6 message ("No Art
Assessment source found. Upload an Art Assessment Excel (.xlsx) to this
chapter's Art folder…"). The frontend displays it via toast.

**Partial fix in place**. Could be strengthened by showing a persistent
banner on the Art folder view: "No Art Assessment Excel detected — the
Generate Assessment button will fall back to image-scan mode until you
upload one."

**Priority: low** (banner is nice-to-have; the toast is already clear).

### G5 — Per-project single-source rule (already correct)

**Spec**: "Each file represents a separate project. Do not combine data from
different projects into one assessment."

**Current**: assessments are scoped per chapter; chapters belong to one
project. A chapter can hold at most one assessment Excel (per G1 fix:
multi-xlsx → error). No cross-project data mixing is possible.

**No change needed.** Document this as a confirmed invariant.

### G6 — Legacy images-only output must remain untouched

**Spec**: nothing in the finalization message changes legacy behavior when no
Excel is present.

**Current**: `_generate_from_images` is byte-identical to pre-Phase-4 code
and is locked by `test_images_path_still_produces_legacy_15_column_output`.

**No change needed.**

---

## 5. Three-fixture acceptance verification — mapped to tests

Each new acceptance check should be enforced by an automated test. The table
below maps the finalization checks to concrete test IDs (existing or to be
added).

### 5.1 Lancaster

| Finalization check | Existing test | Status |
|---|---|---|
| 201 rows preserved | `test_lancaster_row_count_after_blank_trim`, `test_excel_path_lancaster_persists_and_preserves_columns` | ✅ |
| Original output-color categories preserved | `test_lancaster_output_color_values_preserved_verbatim` | ✅ |
| Re-label / Re-key column preserved | `test_lancaster_data_sheet_and_mapping` (maps `Re-lable (or) Re-Key Category` → `classification`) | ✅ |
| Queries + Queries Details preserved | same | ✅ |
| CDR-related `Remarks` values preserved (e.g. `Use .cdr file`) | — | **Add** assertion in parser test checking a Remarks value on a row |

### 5.2 Pathak

| Finalization check | Existing test | Status |
|---|---|---|
| `Figure 2.1` row present | `test_pathak_data_sheet_detected_despite_unusual_name` (asserts len == 3) | ✅ (implicit) |
| `Figure 2.2` row present | same | ✅ (implicit) |
| `Ankit Pathak Author Photo` row present | same | ✅ (implicit) |
| Author-photo query text preserved verbatim | — | **Add** assertion: find the row where `figure_no == "Ankit Pathak Author Photo"` and assert `queries_detail` equals `"The author photo has been received, but it is not mentioned in the MS (manuscript)."` |
| Output must not contain only the author photo's image metadata | needs new test for G1 fix | **Add** |

### 5.3 Murphy

| Finalization check | Existing test | Status |
|---|---|---|
| All 312 artwork rows preserved | `test_murphy_row_count_after_blank_trim`, `test_excel_path_murphy_preserves_all_extras` | ✅ |
| Pickup / SPU / Redraw billing statuses preserved | `test_murphy_preserves_free_text_variants` | ✅ |
| Suggested Sizing values preserved verbatim | implicit via row-count; make explicit | **Add** |
| Editorial instructions preserved | `test_murphy_batch_and_editorial_round_trip` covers one row; extend to assert the 91 distinct values are all present | **Extend** |
| Query details / replies / batch preserved | `test_murphy_data_sheet_and_mapping_including_typo_alias` + batch assertion in the batch test | ✅ |
| Rows without a matching image are not dropped | needs G2 fix | **Add after G2** |

---

## 6. Client-format diversity handling — current design confirmed

The alias registry at
`app/domains/post_prod/figure_pdf/assessment_parser.py: ALIAS_REGISTRY`
already supports the three sample formats and is documented in
[`ALIAS_REGISTRY_MAINTENANCE.md`](./ALIAS_REGISTRY_MAINTENANCE.md). Key
properties relevant to the finalization:

1. **Headers match case-insensitively, ignoring whitespace / punctuation**
   (`_canon` function). No per-client branching.
2. **Known-but-differently-named headers** map to the same canonical field
   (e.g., `Chapter NO.`, `Chapter Name`, `Chapter No`, `Chapter` → `chapter_label`).
3. **Unknown columns survive verbatim** — captured in
   `ParsedAssessment.unmapped_columns` + `ParsedAssessmentRow.unmapped` and
   re-emitted into the output xlsx at the end of the client's columns.
4. **Client typos survive** (e.g., Murphy's `Querie replies` has an explicit
   alias entry so the data reaches the `query_replies` canonical column
   without "correction").

No change is required to add a new client format unless its headers are both
different *and* unknown to the registry. In that case the operator sees the
column in the preview's "unmapped" section and can file a one-line PR to add
an alias — see §4 and §5 of the maintenance guide.

---

## 7. Image / Excel data must stay separate — current design confirmed

The finalization explicitly calls out:

> Assessment Output Color: `1 Color Lineart` — Image metadata: `Grayscale`,
> Image mode: `L` — these are separate pieces of information and both must
> be preserved.

Current implementation already enforces this separation:

- Excel's `Output color` → `art_assessment_rows.output_color` (text, nullable,
  verbatim).
- Image's PIL mode / color space → `art_assessment_rows.image_meta_json`
  (JSONB) and the output xlsx's appended "Supplied Image Mode" /
  "Supplied Image Color" columns.
- `_COLOR_SPACE_ONLY` (the `B&W` / `Grayscale` / `RGB` / `CMYK` bucket dict)
  is only applied to image metadata, never to Excel values. Scoped to the
  images path in Phase 4, locked by
  `test_excel_path_murphy_preserves_all_extras`.

So for the author-photo row, after the G1 and G2 fixes land, the generated
output will contain:

| Chapter | Figure No. | Source | Output color | Category | Queries | Queries Details | Remarks | Supplied File | Supplied Image Mode | Supplied Image Color | ... |
|---|---|---|---|---|---|---|---|---|---|---|---|
| About the Author | Ankit Pathak Author Photo | New | **b/w halftone** | Simple | Yes | *(author-photo query text)* | | Ankit Pathak Author Photo BDC.tif | **L** | **Grayscale** | ... |

Note the two colors coexist. Neither is coerced into the other.

---

## 8. Finalized change list (to implement next)

In priority order; each change is scoped and testable in isolation.

### F1 (highest) — Dispatcher precedence (G1)

- Edit `service.py: generate_figure_assessment` so a chapter-level xlsx scan
  runs before the `source_file_id` check. If exactly one uploaded xlsx
  exists → Excel path wins regardless of what `file_id` was passed.
- Add test: upload Pathak xlsx + TIF, call Generate with file_id=TIF →
  assert `source == "excel"` and all 3 rows.

### F2 — Unmatched-image rows in Excel-path output (G2)

- Extend `_generate_from_excel` to detect unmatched images and append them
  as additional rows.
- Decide schema: either reuse `extras_json` with a `__match_status__` key,
  or add a nullable `match_status` text column to `art_assessment_rows`
  (new migration). Recommendation: new column — it keeps `extras_json`
  clean of system-added keys.
- Add fixture test: Pathak xlsx + 1 matched image (Figure_2.1 BDC.eps) +
  1 unmatched image (Ankit Pathak Author Photo BDC.tif, which is in the
  Excel so actually matched — pick a different unmatched one) → expect
  3 Excel rows (one with image meta, two without) + N unmatched rows.

### F3 — Frontend preview opens whenever an xlsx exists (G3)

- Simplify `isUploadedAssessmentXlsx` + `handleGenerateAssessment` so the
  preview opens whenever `rows.filter(isUploadedAssessmentXlsx).length === 1`
  — regardless of selection.
- Still pass the selected image's `file_id` to the backend if one is
  selected (so the enrichment can prefer it on ties).
- Add component test.

### F4 — Acceptance-check tests added

- Extend `test_art_assessment_parser.py` with:
  - Lancaster: assert a Remarks row equals `"Use .cdr file"`.
  - Pathak: find the Ankit Pathak Author Photo row, assert the long
    queries_detail text verbatim.
  - Murphy: snapshot assertions for pickup/SPU/Redraw/sizing/editorial
    representative values.

### F5 (lowest) — No-xlsx UX banner (G4)

- Optional: add a persistent banner on the Art folder view when no uploaded
  xlsx is detected.
- Low priority — the toast is already clear.

---

## 9. What is NOT changing

- Alias registry extension workflow: already working, documented.
- Images-only legacy path: byte-identical to pre-Phase-4 behavior.
- DB models and existing migrations.
- Parser contract (`ParsedAssessment`, `ParsedAssessmentRow`).
- Preview-modal visual design.

---

## 10. Required ops steps before the fix PR

Nothing — the containers are already running the Phase 1–6 code. When F1–F4
land they can be shipped by the same rebuild command (`docker compose up -d
--build backend celery_worker` + `alembic upgrade head`). The Phase 2
migrations are already applied.

---

## 11. Suggested smoke protocol after F1–F4 land

1. Clear chapter 63's generated files (keep original uploads).
2. Upload `~/Downloads/Pathak_190442_Art assessment.xlsx` to the Art folder.
3. Click Generate Assessment with no selection.
   → Expect: preview opens on the xlsx, shows 3 figure rows + project info.
   → Confirm: `Pathak_190442_Art assessment_ArtAssessment_generated.xlsx`
     downloads with 3 client rows + 7 image-meta columns for the row whose
     Figure No. matches the TIF.
4. Click Generate Assessment with the TIF row selected.
   → Expect: same preview (F3 fix), same output (F1 fix — xlsx still wins).
5. Upload a new image not referenced in the Excel.
   → Click Generate Assessment.
   → Expect: output contains the 3 Excel rows + 1 extra "Unmatched image"
     row (F2 fix).
6. Repeat with Lancaster and Murphy xlsx files (in separate chapters, per
   §G5).

---

*End of finalization document. No code was changed to produce this analysis.
Implementation of F1–F4 is pending owner approval.*
