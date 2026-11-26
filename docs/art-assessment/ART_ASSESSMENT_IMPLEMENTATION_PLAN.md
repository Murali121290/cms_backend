# Art Assessment — Implementation Plan

Status: **Implemented through Phase 6. See Appendix C (Implementation Status) for the per-item landing log.**
Branch audited: `dev-priya` @ commit `fee8c92` (2026-11-24).
Branch implemented against: `dev-priya` (working tree; not yet committed).
Author: audit prepared via Claude Code; owner review pending.

> **Legend used throughout this document**
>
> - **[VERIFIED]** — stated behavior was confirmed by reading the current code on `dev-priya`. File path and line numbers are given.
> - **[PROPOSED]** — behavior that does not exist today. Introduced in this plan and requires owner approval before implementation.
> - **[OPEN QUESTION]** — the available code and the three sample Excel files do not give enough signal to decide. Owner input required.

---

## 1. Project Objective

Make the client-supplied **Art Assessment Excel** the single source of truth for figure-level and project-level assessment data in the chapter's Art track, while preserving the current end-user workflow:

> Project → Chapter → Art folder → Upload Art Assessment Excel → click **Generate Assessment**.

The uploaded Excel must be parsed, mapped to canonical fields where possible, and all remaining columns must be retained verbatim. Image-derived metadata must never silently overwrite Excel-provided values. Missing cells must stay empty — the system must not invent defaults such as `RGB` or `CMYK`.

The deliverable of the follow-up implementation will be a schema-flexible parser, a normalized persistence layer, a review UI, and a regenerated output workbook that preserves every column the client sent.

---

## 2. Current Workflow and Existing Implementation Findings

### 2.1 End-user workflow today **[VERIFIED]**

1. User navigates to a chapter's **Art** folder in `ChapterFilePage.tsx`.
2. User uploads the client's Art Assessment Excel via the generic multipart upload.
3. User selects (optionally) a single DOCX / image row and clicks **Generate Assessment** (`frontend/src/pages/ChapterFilePage.tsx:1616-1627`).
4. The backend produces a new `.xlsx` file, registers it under `category="Art"`, and the browser auto-downloads it (`frontend/src/pages/ChapterFilePage.tsx:1358-1392`).

### 2.2 Upload path **[VERIFIED]**

- Route: `POST /projects/{project_id}/chapters/{chapter_id}/files/upload`  (`app/routers/api_v2.py:3858-3899`).
- Multipart form: `category: str` + `files: list[UploadFile]`.
- Handler: `app/services/file_service.py: upload_chapter_files` (lines 243-504).
- Storage: `${UPLOAD_DIR}/{project.client_name}/{project.code}/{chapter.number}/Art/<filename>` on disk; row inserted in `files` table (`app/models/__init__.py:25-62`) with `category="Art"`, `is_original=True`.
- **The uploaded Excel is treated as an opaque binary. There is no code path that opens it.**

### 2.3 Generate Assessment path **[VERIFIED]**

- Route: `POST /projects/{project_id}/chapters/{chapter_id}/generate-figure-assessment?file_id={id}`  (`app/routers/api_v2.py:3961-4017`).
- Response shape: `{status, file: FileRecord, figures_included: int}` — defined in `app/schemas_v2.py` and surfaced to the frontend as `GenerateFigureAssessmentResponse` (`frontend/src/api/files.ts:16-20`, call site `files.ts:124-131`).
- Service: `app/domains/post_prod/figure_pdf/service.py: generate_figure_assessment` (lines 1183-1277).
- **Inputs actually read**: image bytes embedded in a DOCX or image files in the Art folder.
- **Inputs NOT read**: any `.xlsx` the user has previously uploaded. There is no code in the service, router, or any helper that opens an uploaded Excel.
- **Output**: a freshly-created openpyxl workbook with a single sheet named `{chapter.number}. {chapter.title}` (sanitized, truncated to 31 chars). Saved as `{source_stem}_ArtAssessment.xlsx` (file-scoped) or `{chapter.number}_ArtAssessment.xlsx` (chapter-wide) in the Art folder, registered as a new `files` row with `category="Art"`, `file_type="xlsx"`, `is_original=False`, `source_file_id=…`.

### 2.4 Hardcoded output columns **[VERIFIED]**

`_ASSESSMENT_COLUMNS` tuple in `app/domains/post_prod/figure_pdf/service.py:1059-1075`:

```
ART NAME, FIGURE NO., PART NO., TYPE, ART CLASSIFICATION,
SUPPLIED IMAGE COLOR, SUPPLIED IMAGE MODE, SUPPLIED IMAGE TYPE, SUPPLIED SIZE,
FINAL SIZE, SPECIAL INSTRUCTION , FINAL ART COLOR, COMPLEXITY,
RESOLUTION (HALFTONE ONLY), STATUS
```

`SPECIAL INSTRUCTION ` has a trailing space in the header, intentionally kept to match the legacy template.

### 2.5 Image metadata extraction and color coercion **[VERIFIED]**

`_assessment_row_values()` at `service.py:1125-1180` populates each row from PIL. The following columns are auto-filled: `ART NAME` (filename), `FIGURE NO.` (regex on filename), `TYPE` ("Figure" when image), `SUPPLIED IMAGE COLOR`, `SUPPLIED IMAGE MODE`, `SUPPLIED IMAGE TYPE`, `SUPPLIED SIZE`, `RESOLUTION (HALFTONE ONLY)`. Remaining columns are left as empty strings.

`_COLOR_SPACE_ONLY` (`service.py:1110-1122`) **forcibly maps** every PIL mode into one of five bucket values:

| PIL mode           | Coerced to |
|--------------------|------------|
| `1`                | `B&W`      |
| `L`, `LA`, `I`, `F`| `Grayscale`|
| `P`, `PA`          | `Indexed`  |
| `RGB`, `RGBA`, `YCbCr` | `RGB`  |
| `CMYK`             | `CMYK`     |

**Consequence for the new requirement**: if a client Excel says `Output color = "4 Color Halftone"` or `"b/w halftone"`, today's code would discard it and write `RGB` or `CMYK` instead.

### 2.6 Persistence model **[VERIFIED]**

Only the `files` table (`app/models/__init__.py:25-62`) is used. The generated Excel's bytes are the only record of assessment data — per-figure rows are **not** persisted anywhere. There is no `assessments`, `assessment_rows`, `figure_assessment`, or similar table in `app/models/` or `alembic/versions/`.

### 2.7 Frontend surface **[VERIFIED]**

- Button rendering: `frontend/src/pages/ChapterFilePage.tsx:1590-1630` — only when `activeFolder === 'art'`.
- Handler: `handleGenerateAssessment` at `ChapterFilePage.tsx:1358-1392`. Calls the API, toasts the figure count, auto-downloads the blob.
- API client: `generateFigureAssessment()` at `frontend/src/api/files.ts:124-131`.
- Response type: `GenerateFigureAssessmentResponse` at `frontend/src/api/files.ts:16-20`.
- **There is no dedicated Assessment viewer, preview grid, or row-level UI** — the artifact is a downloadable file, nothing more.

### 2.8 Validation today **[VERIFIED]**

Essentially none, because no Excel is parsed:

- Image file open failures are swallowed (`service.py:1147`).
- When no images exist: returns `FIGURE_ASSESSMENT_EMPTY` error with a user-facing message (`api_v2.py:4005-4011`).
- Nothing enforces column presence because columns are not read.

### 2.9 Gap summary

| Requirement | Status today |
|-------------|--------------|
| Excel as source of truth | **Not met** — Excel is not read. |
| Dynamic column detection | **Not met** — only hardcoded write-side columns. |
| Preserve non-RGB color strings | **Not met** — `_COLOR_SPACE_ONLY` would coerce. |
| Preserve Original File Name / Editorial / Sizing / Billing / Query Replies / Batch / Remarks | **Not met** — those columns do not exist. |
| Retain unknown columns | **Not met** — nothing is read. |
| No invented defaults | Partially — blanks are written as empty string, which is fine, but `_COLOR_SPACE_ONLY` invents values. |
| Preserve existing workflow | **Met** — URL/button/download unchanged, we must keep it that way. |

---

## 3. Analysis of All Sample Excel Formats

Samples analyzed (openpyxl, `data_only=True`):

- `Lancaster_190294_Art assessment.xlsx` — Artech House (`Sheet2`, 8 cols × 201 real rows)
- `Pathak_190442_Art assessment.xlsx` — Business Expert Press (`de Bruin_190366`, 8 cols × 3 real rows)
- `Murphy_7e_189382_Art assessment.xlsx` — Elsevier-style detailed (`_Art assessment`, 13 cols × 311 real rows, padded with 22 empty trailing columns)
- The **existing system-generated format** — described in §2.4 above (the 15-column "Information Management" template)

### 3.1 Workbook structure variance

| Property                        | Lancaster              | Pathak                  | Murphy                      | Existing format        |
|---------------------------------|------------------------|-------------------------|-----------------------------|------------------------|
| Project-info sheet present      | Yes — `PROJECT INFO`   | Yes — `Project Info`    | **No**                      | No                     |
| Project-info layout             | 3 cols × 16 rows (`label, ":", value`) | Same | — | — |
| Data sheet name                 | `Sheet2`               | `de Bruin_190366` (project code) | `_Art assessment` (leading underscore) | sanitized chapter title |
| Data sheet header row           | Row 1                  | Row 1                   | Row 1                       | Row 1                  |
| Data column count               | 8                      | 8                       | 13 effective (+22 blank)    | 15                     |
| Trailing blank rows             | ~232                   | ~133                    | ~730                        | None                   |
| Secondary sheets                | None                   | None                    | `Sheet1` (empty)            | None                   |

### 3.2 Project-level fields observed **[VERIFIED]** (Lancaster, Pathak)

Both project-info sheets use the shape `[label, ":", value]` per row. Labels encountered:

- `Incoming Art Assessment` (acts as a header/title)
- `Projects & Authors`
- `Book Title`
- `ISBN-13`
- `Color` (project-level — e.g., `full color`, `1 color`)
- `Edition`
- `Planner`
- `Projected Printer Date` (free text, may include "(Tentative)")
- `Total chapters` (free text, e.g., `14 Chapters`, `FM, 18 Chapters, BM, Index`)
- `Art Process by`
- `Previous Edition ` (trailing space)

Values are free-text; several contain leading whitespace (e.g., `  978-1-68569-081-6`). Rows 9-13 are present but empty in the sampled files (reserved rows in the template).

### 3.3 Figure-level column variance

| Concept               | Lancaster header                 | Pathak header   | Murphy header                        | Existing format header       |
|-----------------------|----------------------------------|-----------------|--------------------------------------|------------------------------|
| Chapter identifier    | `Chapter NO.`                    | `Chapter Name`  | `Chapter Name`                       | — (sheet-scoped)             |
| Figure identifier     | `Figure No.`                     | `Figure No.`    | `Output Figure no.`                  | `FIGURE NO.`                 |
| Art name / filename   | (figure no. carries filename)    | (figure no. is a label) | `Original File Name`         | `ART NAME`                   |
| Output color          | `Output color`                   | `Output color`  | `Output color`                       | `FINAL ART COLOR` (blank today) / `SUPPLIED IMAGE COLOR` (coerced) |
| Source / status       | `Source`                         | `Source`        | `Source Status`                      | —                            |
| Classification        | `Re-lable (or) Re-Key Category`  | `Category`      | — (not present)                      | `ART CLASSIFICATION`         |
| Editorial comments    | —                                | —               | `Comments/Instructions from Editorial` | `SPECIAL INSTRUCTION `     |
| Sizing                | —                                | —               | `Suggested Sizing`                   | `FINAL SIZE`                 |
| Billing / complexity  | —                                | —               | `S4 Billing status`                  | `COMPLEXITY`                 |
| Queries               | `Queries`                        | `Queries`       | `Queries`                            | —                            |
| Query details         | `Queries Details`                | `Queries Details` | `Queries Details`                  | —                            |
| Query replies         | —                                | —               | `Querie replies` (sic, misspelled)   | —                            |
| Batch number          | —                                | —               | `Batch No`                           | —                            |
| Remarks               | `Remarks`                        | `Remarks`       | `Remarks`                            | —                            |
| Image-derived         | —                                | —               | —                                    | `SUPPLIED IMAGE MODE`, `SUPPLIED IMAGE TYPE`, `SUPPLIED SIZE`, `RESOLUTION (HALFTONE ONLY)`, `PART NO.`, `TYPE`, `STATUS` |

### 3.4 Distinct cell values observed (verbatim, non-normalized)

| Column         | Values observed across the three files |
|----------------|-----------------------------------------|
| `Output color` | `1 Color Halftone`, `1 Color Lineart`, `4 Color Halftone`, `4 Color Lineart`, `1 color Lineart` (lowercase), `b/w halftone` (lowercase, with slash), `1 Color Linetone` (apparent typo of "Lineart") |
| `Source` / `Source Status` | `New`, `SPU` |
| `Category` / `Re-lable (or) Re-Key Category` | `Simple` (Pathak), `Yes`, `No` (Lancaster, used as a flag) |
| `Suggested Sizing` | `1 column`, `1-COLUMN`, `1-column`, `1-column width`, `2-column`, `full page width`, `full-page width`, `half page width`, `half-page width`, `single column width`, `two-third page width`, `two-thirds page`, `two-thirds page width`, `two-thirds pg width` (14 distinct spellings for essentially 4-5 physical sizes) |
| `S4 Billing status` | `Pickup`, `Pickup Modify`, `Redraw`, `Redraw Medium`, `Redraw Simple`, `Redraw complex`, `Redraw more complex` |
| `Queries`, `Re-lable…` | `Yes`, `No` |

**Important observations:**

- Values are **free text**, not a closed enumeration. Case and punctuation vary within a single file.
- The user's requirement explicitly lists `RGB`, `CMYK`, `1 Color`, `4 Color`, `1 Color Lineart`, `4 Color Halftone`, `B/W Halftone`; the samples show additional variants (`1 Color Linetone`, `b/w halftone`) that must also survive.
- Several columns carry long free-text content (e.g., Murphy's `Comments/Instructions from Editorial` has 91 distinct values, including bracketed meta-comments like `<Prev Ed Figure 28.3>`, `<Note to Production: …>`).

### 3.5 Shape-level pitfalls to parse around

1. **Trailing blank rows** (Lancaster: 232 extra rows, Murphy: 730 extra rows). Stop scanning on sustained blanks; do not count them as figures.
2. **Trailing blank columns with blank headers** (Murphy: cols N through AI are all `''`). Must be dropped.
3. **Leading whitespace in values** (`  978-1-68569-081-6`). Trim on read.
4. **Header typos** (`Re-lable`, `Querie replies`). Must survive the alias registry (be mapped) without being "corrected" on the way out.
5. **Sheet name unpredictable** — must be detected by header-row content, not by name or index.
6. **Project-info sheet is optional** — Murphy ships without one.
7. **Figure identifier semantics differ**: Lancaster puts a filename-like token (`Fig 1.1.jpg`), Pathak puts a label (`Figure 2.1`), Murphy puts a slug (`Murphy_F01-01`) and uses `Original File Name` separately. The parser cannot assume Figure No. equals the image filename.

---

## 4. Field Comparison Matrix

Canonical fields proposed by this plan, mapped against each sample. `○` = present, `—` = absent, `(fill)` = would be filled by image metadata (not sourced from Excel).

| Canonical field (proposed)          | Lancaster | Pathak | Murphy | Existing format |
|-------------------------------------|:---------:|:------:|:------:|:---------------:|
| `chapter_label`                     | ○ (`Chapter NO.`) | ○ (`Chapter Name`) | ○ (`Chapter Name`) | — |
| `figure_no`                         | ○ (`Figure No.`) | ○ (`Figure No.`) | ○ (`Output Figure no.`) | ○ (`FIGURE NO.`) |
| `art_name`                          | (same as figure_no) | (same) | ○ (`Original File Name`) | ○ (`ART NAME`) |
| `part_no`                           | —         | —      | —      | ○ (`PART NO.`) |
| `type`                              | —         | —      | —      | ○ (`TYPE`) |
| `classification`                    | ○ (`Re-lable (or) Re-Key Category`) | ○ (`Category`) | — | ○ (`ART CLASSIFICATION`) |
| `source_status`                     | ○ (`Source`) | ○ (`Source`) | ○ (`Source Status`) | — |
| `output_color`                      | ○         | ○      | ○      | ○ (`FINAL ART COLOR`, currently empty) |
| `supplied_image_color` (image-derived) | (fill) | (fill) | (fill) | ○ (`SUPPLIED IMAGE COLOR`) |
| `supplied_image_mode` (image-derived)  | (fill) | (fill) | (fill) | ○ (`SUPPLIED IMAGE MODE`) |
| `supplied_image_type` (image-derived)  | (fill) | (fill) | (fill) | ○ (`SUPPLIED IMAGE TYPE`) |
| `supplied_size` (image-derived)        | (fill) | (fill) | (fill) | ○ (`SUPPLIED SIZE`) |
| `resolution_dpi` (image-derived)       | (fill) | (fill) | (fill) | ○ (`RESOLUTION (HALFTONE ONLY)`) |
| `suggested_sizing`                  | —         | —      | ○      | ○ (`FINAL SIZE`) |
| `editorial_instructions`            | —         | —      | ○ (`Comments/Instructions from Editorial`) | ○ (`SPECIAL INSTRUCTION `) |
| `billing_status`                    | —         | —      | ○ (`S4 Billing status`) | — |
| `complexity`                        | —         | —      | — (implicit in billing status) | ○ (`COMPLEXITY`) |
| `queries` (flag)                    | ○         | ○      | ○      | — |
| `queries_detail`                    | ○         | ○      | ○      | — |
| `query_replies`                     | —         | —      | ○ (`Querie replies`) | — |
| `batch_no`                          | —         | —      | ○      | — |
| `remarks`                           | ○         | ○      | ○      | — |
| `status`                            | —         | —      | —      | ○ (`STATUS`) |
| Project-level block                 | ○         | ○      | —      | — |

---

## 5. Common Fields and Client-Specific Fields

### 5.1 Core fields (present in ≥ 2 of 3 client samples)

- `chapter_label`
- `figure_no`
- `source_status`
- `output_color`
- `classification` (Lancaster + Pathak)
- `queries`, `queries_detail`
- `remarks`

### 5.2 Client-specific fields (present in only one sample today)

- `art_name` / `original_file_name` — Murphy
- `editorial_instructions` — Murphy
- `suggested_sizing` — Murphy
- `billing_status` — Murphy
- `query_replies` — Murphy
- `batch_no` — Murphy

The plan treats **all** of these as first-class canonical fields in the DB, because the user's requirement #6 explicitly lists them and they are likely to appear in future client formats.

### 5.3 Image-derived fields (never in client Excel, never overwrite Excel)

- `supplied_image_color`, `supplied_image_mode`, `supplied_image_type`, `supplied_size`, `resolution_dpi`

### 5.4 Unknown columns (preserve verbatim per row + per sheet)

Any header not in the alias registry is captured into `extras_json` on the row, and its raw header is appended to the assessment-level `unmapped_columns_json`. This is the mechanism for requirements #7 and #8.

---

## 6. Proposed System Behavior **[PROPOSED]**

### 6.1 Treatment of the uploaded Excel

1. On **Generate Assessment**, the backend first searches the chapter's Art folder for a user-uploaded `.xlsx` (criteria: `category="Art"`, `file_type="xlsx"`, `is_original=True`, uploaded by a user and not generated by the system — see §6.5 on how to tell them apart).
2. If exactly one candidate exists → use the **Excel path** (§6.2).
3. If zero candidates exist → use the **images-only path** (unchanged from today — regression safety).
4. If more than one candidate exists → return a specific error asking the user to pick one via the `file_id` query parameter.

### 6.2 Excel path

1. Parse the workbook (see §8).
2. Persist a new `art_assessments` row and N `art_assessment_rows` records (see §7).
3. Optionally enrich each parsed row with image metadata **only** by writing to `image_meta_json`. Never write into the canonical columns derived from Excel.
4. Regenerate an output `.xlsx` that preserves every client column in its original order, with original headers verbatim, then appends image-derived columns at the end.
5. Register the output in `files` table (same as today) and auto-download it (same UX as today).
6. Return response augmented with `{source: "excel", parsed_row_count, unmapped_columns, warnings}`.

### 6.3 Images-only path (fallback)

Byte-identical to today's behavior. No change, no risk.

### 6.4 Non-negotiable rules

| Rule | Enforcement |
|------|-------------|
| No value coercion for Excel cells | `_COLOR_SPACE_ONLY` is bypassed on the Excel path. Raw string stored. |
| No default fallbacks | DB columns are nullable; blank cell → `NULL`, never `""` or `"RGB"`. |
| No silent column drops | Any header not matched to a canonical field goes into `extras_json` + `unmapped_columns_json`. Warnings surface to UI. |
| Trimming is allowed | Outer whitespace only; internal punctuation and case preserved. |
| Excel wins over image metadata | Image enrichment lives in `image_meta_json`; display layer joins the two without overwriting. |

### 6.5 Distinguishing uploaded Excel from generated output

**[OPEN QUESTION #1]**  Today's generator sets `is_original=False` on the output file (`service.py:1270`). The uploaded file is `is_original=True`. We will rely on this flag to tell them apart. Confirm that no other workflow sets `is_original=False` for Art-track xlsx files; if so, we may additionally need to tag the output with a sentinel (e.g., filename suffix `_generated.xlsx` or a new `generator="art_assessment"` column on `files`).

### 6.6 Multiple uploaded Excels in one Art folder

**[OPEN QUESTION #2]**  What should happen if a user uploads two client Excels (say, a revised version)? Options:
(a) Use the most recently uploaded one as source of truth.
(b) Require the user to pick one explicitly via `file_id`.
(c) Merge them (likely out of scope).
The plan currently prefers (b) because it is the safest; owner to confirm.

### 6.7 Duplicate figures within one Excel

**[OPEN QUESTION #3]**  None of the three samples show literal duplicates of `figure_no` + `chapter_label`, but figure parts (`Fig 1.2a`, `Fig 1.2b`) are common. The parser will **never deduplicate** — every row becomes an `art_assessment_rows` record keyed by `(assessment_id, row_index)`. If the owner wants semantic dedup/merge, that is a separate feature on top.

---

## 7. Backend, Frontend, and Database Impact

### 7.1 Backend impact **[PROPOSED]**

| Area | Change |
|------|--------|
| `app/domains/post_prod/figure_pdf/service.py` | `generate_figure_assessment` becomes a dispatcher that branches on "Excel present?". New helper `generate_from_excel()` added; existing images-only code moves into `generate_from_images()` unchanged. `_COLOR_SPACE_ONLY` is used **only** inside the images-only helper. |
| `app/domains/post_prod/figure_pdf/` (new file) | `assessment_parser.py` — pure parsing, no DB. Exports `parse_assessment_workbook(path) -> ParsedAssessment`. |
| `app/routers/api_v2.py` | Add `POST /projects/{pid}/chapters/{cid}/parse-assessment-excel?file_id=…` for the preview UI (parse-only, no DB write). Extend response of existing `/generate-figure-assessment` with new fields (`source`, `parsed_row_count`, `unmapped_columns`, `warnings`) — additive only. |
| `app/schemas_v2.py` | New pydantic models: `ProjectInfoEntry`, `ParsedAssessmentRow`, `ParsedAssessment`, `AssessmentSummary`. Extend `GenerateFigureAssessmentResponse`. |
| `app/services/file_service.py` | No change required for the parser, but the serializer may need to expose a `generator` or `kind` discriminator — depends on resolution of [OPEN QUESTION #1]. |

### 7.2 Frontend impact **[PROPOSED]**

| Area | Change |
|------|--------|
| `frontend/src/api/files.ts` | Add `parseAssessmentExcel()`. Extend `GenerateFigureAssessmentResponse`. |
| `frontend/src/features/artAssessment/` (new) | `AssessmentPreview.tsx` — renders project-info block, column-mapping panel, row grid with per-row "Additional data" expander, warnings pane. `types.ts` — mirrors backend schemas. |
| `frontend/src/pages/ChapterFilePage.tsx` | Before firing Generate, if an uploaded Excel is in the Art folder, open `AssessmentPreview` first. User confirms, then the same POST is sent. Auto-download behavior unchanged. |
| `frontend/src/config/fileManagerConfig.ts` | Optionally add a row-level "Review Assessment" action on the uploaded xlsx entries. |

Nothing that renders today will be altered; everything is **additive**. If the owner declines the preview UI, the backend can still be shipped without the frontend changes and the existing flow works.

### 7.3 Database impact **[PROPOSED]**

The current `files` table is **sufficient** to continue tracking both the uploaded source and the generated output. We **do not reuse** it for per-row storage because per-figure data is natively relational and `JSONB` blob-on-file would make the review UI painful.

New tables (two forward-only Alembic migrations):

**`art_assessments`** — one row per generated/parsed artifact:

| column | type | notes |
|--------|------|-------|
| `id` | BigInt PK | |
| `project_id` | FK projects.id ON DELETE CASCADE | indexed |
| `chapter_id` | FK chapter_details.id ON DELETE CASCADE | indexed |
| `source_excel_file_id` | FK files.id NULL | the uploaded xlsx (NULL on images-only path) |
| `output_excel_file_id` | FK files.id NULL | the generated xlsx |
| `source_mode` | Text | `'excel'` or `'images'` |
| `data_sheet_name` | Text NULL | |
| `header_row_index` | Int NULL | 1-based |
| `project_info_json` | JSONB | verbatim block (see §3.2) |
| `canonical_columns_json` | JSONB | `{field_name: raw_header}` |
| `unmapped_columns_json` | JSONB | `[raw_header, ...]` |
| `warnings_json` | JSONB | parser warnings |
| `created_at` | timestamptz default now() | |
| `created_by_id` | FK users.id NULL | |

**`art_assessment_rows`** — one row per figure:

| column | type | notes |
|--------|------|-------|
| `id` | BigInt PK | |
| `assessment_id` | FK art_assessments.id ON DELETE CASCADE | indexed |
| `row_index` | Int | 1-based from the Excel data region |
| `chapter_label` | Text NULL | |
| `figure_no` | Text NULL | verbatim |
| `art_name` | Text NULL | from `Original File Name` or similar |
| `source_status` | Text NULL | |
| `output_color` | Text NULL | **verbatim** — `4 Color Halftone`, `b/w halftone`, `1 Color Linetone`, `RGB`, `CMYK`, … |
| `classification` | Text NULL | |
| `editorial_instructions` | Text NULL | |
| `suggested_sizing` | Text NULL | |
| `billing_status` | Text NULL | |
| `queries` | Text NULL | |
| `queries_detail` | Text NULL | |
| `query_replies` | Text NULL | |
| `batch_no` | Text NULL | |
| `remarks` | Text NULL | |
| `extras_json` | JSONB | `{raw_header: value}` for unmapped columns |
| `image_meta_json` | JSONB NULL | `{supplied_file_id, pil_mode, color_space, format, size_bytes, dpi_x, dpi_y}` |

**Indexes**: `(assessment_id, row_index)` unique, `(assessment_id, figure_no)`.

**Nullable policy**: every text field is nullable with no default. Blank Excel cell → `NULL`.

**Data migration**: none required. Legacy assessment xlsx files continue to live in the `files` table and can be opened/downloaded as before. **[OPEN QUESTION #4]**: do we want a one-shot backfill job that parses historical uploaded xlsx files into the new tables? Recommendation: no — complexity outweighs the value; parse-on-next-run.

---

## 8. Excel Parsing and Mapping Strategy **[PROPOSED]**

### 8.1 Library

Keep `openpyxl` (already in `requirements.txt`; already used by the generator). Read workbooks with `load_workbook(path, data_only=True, read_only=True)` for speed.

### 8.2 Supported formats

Native `.xlsx`. `.xls` and `.xlsm` are out of scope for v1 — if an uploaded file has a different extension, the parser returns a clear error.

### 8.3 Project-info sheet detection

A sheet is a project-info sheet if its non-empty rows look like `[label, ":", value]` for ≥ 60 % of rows and max column count ≤ 4.

Parsed output: `{raw_label: value_or_null}`. Labels with trailing spaces (`Previous Edition `) are preserved; a slugged lookup (`previous_edition`) is added alongside for canonical access. Values are trimmed of outer whitespace.

### 8.4 Data sheet detection

For each sheet that is **not** the project-info sheet:

1. Read the first 15 non-empty rows.
2. For each row, canonicalize each cell to a lookup key (casefold, strip, collapse spaces, strip trailing `.`, strip parenthetical groups).
3. Score the row by summing hits against the alias registry (§8.5). A row is a valid header row iff score ≥ 3 and ≥ 2 distinct canonical fields are hit.
4. Pick the sheet + row with the highest score. Ties resolved by sheet index.
5. If no candidate scores ≥ 3, raise `"No recognizable Art Assessment header found in this workbook."`

### 8.5 Alias registry

```text
chapter_label           : ["Chapter NO.", "Chapter Name", "Chapter No", "Chapter"]
figure_no               : ["Figure No.", "Output Figure no.", "Figure Number", "Fig No"]
art_name                : ["Original File Name", "Original Filename", "File Name", "Art Name", "ART NAME"]
source_status           : ["Source", "Source Status"]
output_color            : ["Output color", "Output Color", "Final Art Color", "FINAL ART COLOR"]
classification          : ["Re-lable (or) Re-Key Category", "Category", "Art Classification", "ART CLASSIFICATION", "Classification"]
editorial_instructions  : ["Comments/Instructions from Editorial", "Editorial Instructions", "Special Instruction", "SPECIAL INSTRUCTION", "Special Instructions"]
suggested_sizing        : ["Suggested Sizing", "Final Size", "FINAL SIZE", "Size"]
billing_status          : ["S4 Billing status", "Billing Status", "Billing"]
complexity              : ["Complexity", "COMPLEXITY"]
queries                 : ["Queries"]
queries_detail          : ["Queries Details", "Query Details", "Query Detail"]
query_replies           : ["Querie replies", "Query Replies"]
batch_no                : ["Batch No", "Batch Number", "Batch"]
remarks                 : ["Remarks", "Notes", "Comments"]
status                  : ["Status", "STATUS"]
part_no                 : ["Part No.", "PART NO.", "Part Number"]
type                    : ["Type", "TYPE"]
```

**Matching rule**: the input header and each alias are both canonicalized (`casefold` + strip non-alphanumeric). First alias group whose canonical form matches wins. Column header retained verbatim in `canonical_columns_json`.

**Collision detection**: if two source columns map to the same canonical field, the first wins and a warning is emitted (`"Columns 'Final Size' and 'Suggested Sizing' both map to suggested_sizing — using 'Final Size'"`). This stays tunable without redeploying code.

### 8.6 Data extraction

- Iterate from `header_row_index + 1` to `ws.max_row`.
- Drop columns where the header is empty/whitespace.
- A row is blank iff every cell in the non-dropped columns is `None` or empty after trim.
- Stop scanning after 10 consecutive blank rows. Drop any internal blank rows.
- For each cell: strip outer whitespace only; store raw string (or `None` when blank).
- Populate `canonical` dict for mapped columns, `unmapped` dict for everything else.

### 8.7 Validation performed

| Check | Severity | Action |
|-------|----------|--------|
| No data sheet detected | Fatal | 400 response with the specific message. |
| Header-row score < 3 | Fatal | Same. |
| Duplicate alias match | Warning | Warning in response; first column wins. |
| Row has all canonical fields blank but some unmapped data | Warning | Row still stored; flagged. |
| Non-ASCII in header | Allowed | Preserved verbatim. |
| Numeric figure_no auto-typed by Excel | Warning | Store as string; warning noted. |

### 8.8 Mapping strategy summary

Two-tier output per parsed row: `{canonical: {…}, unmapped: {…}}`. Canonical fields are what the UI shows prominently and what the generated output xlsx places in known columns; unmapped is what the UI shows in a per-row "Additional data" expander, and what the generated output xlsx appends after the canonical block in the client's original column order.

---

## 9. Proposed End-to-End Workflow **[PROPOSED]**

```
User                Frontend                     Backend                       DB
 │                    │                            │                             │
 │ upload xlsx ──────▶│ POST /files/upload ───────▶│ store on disk,              │
 │                    │                            │ insert files row            │
 │                    │                            │──────────────────── INSERT ▶│
 │                    │                            │                             │
 │ click Generate ───▶│                            │                             │
 │                    │  (if Art folder has xlsx)  │                             │
 │                    │ POST /parse-assessment-excel?file_id=…                   │
 │                    │────────────────────────────▶ parse_assessment_workbook() │
 │                    │                            │  → ParsedAssessment         │
 │                    │◀──────────────────── 200 ──│                             │
 │                    │                            │                             │
 │ review preview     │                            │                             │
 │ click Confirm ────▶│ POST /generate-figure-assessment?file_id=…               │
 │                    │────────────────────────────▶ dispatcher: excel path      │
 │                    │                            │   • parse again             │
 │                    │                            │   • persist assessment ────▶│ INSERT art_assessments
 │                    │                            │   • persist rows ──────────▶│ INSERT art_assessment_rows
 │                    │                            │   • enrich w/ image meta    │
 │                    │                            │   • write output xlsx        │
 │                    │                            │   • insert files row ──────▶│ INSERT files (is_original=False)
 │                    │◀───────────── 200 + file ──│                             │
 │ auto-download xlsx │                            │                             │
```

**No Excel present** → dispatcher falls through to the existing images-only helper and the diagram collapses to today's behavior.

---

## 10. Testing Strategy and Acceptance Criteria

### 10.1 Unit tests — parser (`tests/post_prod/test_assessment_parser.py`) **[PROPOSED]**

Fixtures copied under `tests/fixtures/art_assessment/`:
- `lancaster_190294.xlsx`
- `pathak_190442.xlsx`
- `murphy_7e_189382.xlsx`
- `legacy_generated.xlsx` (produced by running the current generator against a test chapter)

Per-fixture assertions:

1. **Lancaster**
   - Project-info sheet detected as `PROJECT INFO`.
   - Data sheet detected as `Sheet2`, header row = 1.
   - Canonical mapping includes `chapter_label`, `figure_no`, `source_status`, `output_color`, `classification`, `queries`, `queries_detail`, `remarks`.
   - `output_color` values preserved verbatim: snapshot test asserts `{"1 Color Halftone", "1 Color Lineart", "4 Color Halftone", "4 Color Lineart"}`.
   - Row count after blank-row trim = 201.
   - No warnings about unmapped columns (all 8 map).

2. **Pathak**
   - Data sheet detected as `de Bruin_190366`.
   - `output_color` preserves `"1 color Lineart"` and `"b/w halftone"` verbatim (lowercase, slash kept).
   - Row count after trim = 3.

3. **Murphy**
   - No project-info sheet (`project_info` is empty dict).
   - Data sheet = `_Art assessment`, 22 empty-header columns dropped.
   - Canonical mapping includes `art_name` (from `Original File Name`), `editorial_instructions`, `suggested_sizing`, `billing_status`, `query_replies` (via `Querie replies` alias), `batch_no`, `remarks`.
   - Row count after trim = 311.
   - `output_color` preserves `"1 Color Linetone"` typo verbatim.
   - `billing_status` preserves `"Pickup Modify"`, `"Redraw more complex"`, etc.

4. **Legacy generated format**
   - Data sheet = chapter title.
   - Canonical mapping includes `figure_no`, `art_name` (from `ART NAME`), `output_color` (from `FINAL ART COLOR`), `suggested_sizing` (from `FINAL SIZE`), `editorial_instructions` (from `SPECIAL INSTRUCTION ` with trailing space), `classification`, `complexity`, `status`, `part_no`, `type`.
   - All 15 columns map; no unmapped warnings.

5. **Negative tests**
   - Empty workbook → fatal parser error.
   - Workbook with only unrelated columns → fatal "no recognizable header".
   - Workbook with duplicate aliases (`Final Size` and `Suggested Sizing` in the same sheet) → warning, first wins.

### 10.2 Unit tests — color handling

Property test: for every `output_color` string observed across the four fixtures, `parse_assessment_workbook()` returns the exact same string (no coercion). Run with `RGB`, `CMYK`, `1 Color`, `4 Color`, `1 Color Lineart`, `4 Color Halftone`, `B/W Halftone` and the observed variants (`b/w halftone`, `1 Color Linetone`).

### 10.3 Unit tests — unknown columns

Inject a fake column `"Vendor Comments"` into the Lancaster fixture. Assert:
- `canonical_columns` does not contain it.
- `unmapped_columns` contains `"Vendor Comments"`.
- Each row's `extras` dict contains `"Vendor Comments"` with the verbatim value.
- Warning emitted.

### 10.4 Unit tests — missing values / duplicates

- Blank `Output color` in row 5 of Pathak fixture → stored as `None`; no "RGB" default.
- Two rows with identical `(chapter_label, figure_no)` → both persisted, no dedup, no error.

### 10.5 Integration tests — endpoints

- `POST /parse-assessment-excel` for each fixture → asserts the full `ParsedAssessment` shape.
- `POST /generate-figure-assessment` with an uploaded fixture Excel → asserts `source="excel"`, the output xlsx preserves the client's original headers in original order, and appends image-meta columns only at the end.
- `POST /generate-figure-assessment` against a chapter with no uploaded Excel but with embedded images → byte-identical output vs. the pre-change code (regression guard).

### 10.6 Frontend tests

- `AssessmentPreview` component test: mount with a fixture payload; assert that unmapped columns appear in the per-row "Additional data" expander with the raw header; `output_color` appears verbatim.

### 10.7 Manual smoke on dev-priya

- Upload each of the three sample Excels to a scratch chapter's Art folder.
- Click Generate Assessment; verify the preview, the toast, and the downloaded xlsx.
- Compare the downloaded xlsx's headers against the original xlsx headers — must be identical in content and order.

### 10.8 Acceptance criteria (ties back to the 10 original requirements)

1. Uploading any of the three sample Excels + clicking Generate yields output whose canonical columns come from the Excel, not from image metadata.
2. All seven requirement-listed color strings round-trip unchanged.
3. Original File Name, Editorial Instructions, Suggested Sizing, S4 Billing Status, Query Replies, Batch Number, Remarks appear in the output (Murphy test).
4. Any header not in the alias registry is retained (unit test for `extras_json`).
5. No blank cell is replaced by a filler value — DB column is `NULL`, output xlsx cell is empty.
6. With no Excel uploaded, generation is byte-identical to today (regression test).
7. The URL, button label, response schema's required fields, and auto-download behavior are unchanged for existing callers (additive response fields only).

---

## 11. Risks, Dependencies, and Open Questions

### 11.1 Risks

- **R1 — Legacy Excel misidentification.** If a user re-uploads a system-generated xlsx (round-trip), the dispatcher must not treat it as a client Excel. Mitigated by `is_original` flag + filename convention; see [OPEN QUESTION #1].
- **R2 — Alias registry drift.** Future client formats will arrive with new headers. The registry is a single Python constant; owners should budget for occasional PRs to add aliases rather than treating this as "done."
- **R3 — Excel formulas and merged cells.** `data_only=True` evaluates formulas, but if a client sends a workbook without pre-computed cached values, cells may be `None`. We will emit a warning rather than fail.
- **R4 — Figure matching for image enrichment.** Matching Excel rows to image files is best-effort (by `art_name`, then by `figure_no` stem). Mismatches leave `image_meta_json` null; parser does not fail.
- **R5 — Row count / performance.** Murphy's workbook has 311 real rows (1040 scanned). Parse latency is negligible; DB writes are a simple bulk insert. No concern expected under 5,000 rows per workbook.

### 11.2 Dependencies

- `openpyxl` (already present, `3.1.5` confirmed in the venv).
- Existing Alembic infrastructure. Two forward-only migrations will be added; no backfills.
- No new external services.

### 11.3 Open questions (owner input required)

| # | Question |
|---|----------|
| 1 | How to distinguish an uploaded client Excel from a system-generated Excel? `is_original=True` alone, or add a `generator` discriminator column on `files`? |
| 2 | If multiple client Excels exist in one Art folder, is the newest "source of truth", or must the user pick one via `file_id`? Plan currently defaults to "user picks". |
| 3 | Is semantic dedup of duplicate `figure_no` rows desired? Plan currently preserves every row. |
| 4 | One-shot backfill of historical uploaded xlsx files into the new tables? Plan currently says no. |
| 5 | Is a parser-level canonicalization of `Suggested Sizing` spellings (e.g., collapsing `1 column`, `1-column`, `1-COLUMN`) desired? Plan currently preserves every spelling. |
| 6 | Should the `AssessmentPreview` UI allow the user to override a column mapping before committing (admin-only)? Plan currently excludes this from v1. |
| 7 | Is `.xls` / `.xlsm` support required in v1? Plan currently says `.xlsx` only. |
| 8 | Who is the intended reviewer of parser warnings — the operator who clicked Generate, or an admin role? Determines whether warnings are a toast, a persistent banner, or a new "Issues" tab. |
| 9 | Should the output xlsx mirror the client's original filename pattern (e.g., `Lancaster_190294_Art assessment_generated.xlsx`), or keep today's `{stem}_ArtAssessment.xlsx`? |

---

## 12. Phased Implementation Roadmap **[PROPOSED]**

Each phase is independently releasable. Owner approval is requested between phases.

### Phase 0 — Alignment (now)

- Owner reviews this document.
- Owner answers the Open Questions in §11.3.
- Owner confirms the alias registry seed in §8.5 and the canonical field list in §7.3.

**Exit criteria**: this document checked in; all Open Questions have an answer.

### Phase 1 — Parser library + unit tests (backend-only, no routes, no DB)

- Add `app/domains/post_prod/figure_pdf/assessment_parser.py`.
- Add `tests/fixtures/art_assessment/{lancaster,pathak,murphy,legacy}.xlsx`.
- Add `tests/post_prod/test_assessment_parser.py`.
- No wiring, no UI. Parser is importable and exercised only by tests.

**Exit criteria**: all four fixtures parse per the assertions in §10.1; CI green.

### Phase 2 — Persistence

- Add models `ArtAssessment` and `ArtAssessmentRow` in `app/models/`.
- Two Alembic migrations.
- No endpoint changes yet.

**Exit criteria**: `alembic upgrade head` succeeds on a fresh DB and on the current staging DB (idempotent on empty data).

### Phase 3 — Parse endpoint (read-only)

- Add `POST /projects/{pid}/chapters/{cid}/parse-assessment-excel`.
- Add `parseAssessmentExcel()` in `frontend/src/api/files.ts`.
- No UI binding yet; endpoint is exercised by integration tests only.

**Exit criteria**: integration test green for all three client fixtures.

### Phase 4 — Generate dispatcher + Excel-path generator

- Refactor `generate_figure_assessment` into a dispatcher.
- Implement `generate_from_excel()` — persists rows, writes output xlsx preserving client columns, enriches with image meta.
- Keep `generate_from_images()` unchanged.
- Response schema extended additively.
- Backward-compat regression test (no-Excel path byte-identical).

**Exit criteria**: Generate Assessment works end-to-end against each fixture; no-Excel regression test green.

### Phase 5 — Preview UI

- Add `frontend/src/features/artAssessment/AssessmentPreview.tsx` + types.
- Wire `handleGenerateAssessment` in `ChapterFilePage.tsx` to open the preview first when an uploaded Excel is present.
- Add component test.

**Exit criteria**: manual smoke on dev-priya with all three fixtures.

### Phase 6 — Hardening

- Address warnings surfaced by real-world usage.
- Add any alias-registry entries requested after smoke testing.
- Documentation of the alias registry maintenance process.

---

## 13. List of Existing Files/Modules Likely to Be Affected

### 13.1 Backend — modified **[VERIFIED paths]**

- `app/routers/api_v2.py` — new route, extended response schema on existing route.
- `app/domains/post_prod/figure_pdf/service.py` — dispatcher refactor; `_COLOR_SPACE_ONLY` restricted to images-only helper.
- `app/schemas_v2.py` — new pydantic models; extend `GenerateFigureAssessmentResponse`.
- `app/services/file_service.py` — possibly add a `generator` discriminator (depends on OQ #1).

### 13.2 Backend — new **[PROPOSED paths]**

- `app/domains/post_prod/figure_pdf/assessment_parser.py`
- `app/models/art_assessment.py` (or additions to `app/models/__init__.py`)
- `alembic/versions/XXXX_create_art_assessments.py`
- `alembic/versions/XXXX_create_art_assessment_rows.py`
- `tests/post_prod/test_assessment_parser.py`
- `tests/fixtures/art_assessment/{lancaster,pathak,murphy,legacy}.xlsx`

### 13.3 Frontend — modified **[VERIFIED paths]**

- `frontend/src/api/files.ts`
- `frontend/src/pages/ChapterFilePage.tsx`
- `frontend/src/config/fileManagerConfig.ts` (optional, for row-level action)

### 13.4 Frontend — new **[PROPOSED paths]**

- `frontend/src/features/artAssessment/AssessmentPreview.tsx`
- `frontend/src/features/artAssessment/types.ts`

### 13.5 Unaffected (explicit non-list)

- `app/services/file_service.py: upload_chapter_files` — the upload path remains generic.
- The existing images-only branch of `generate_figure_assessment` — preserved as `generate_from_images()`, behavior unchanged.
- All other `files` table consumers.
- The `_COLOR_SPACE_ONLY` dict itself remains, but its usage is confined to the images-only path.

---

## Appendix A — Verified source references

| Statement | File:Line |
|-----------|-----------|
| Generic file upload route | `app/routers/api_v2.py:3858-3899` |
| Generate Assessment route | `app/routers/api_v2.py:3961-4017` |
| Upload handler | `app/services/file_service.py:243-504` |
| Generator service | `app/domains/post_prod/figure_pdf/service.py:1183-1277` |
| Hardcoded output columns | `app/domains/post_prod/figure_pdf/service.py:1059-1075` |
| Row builder + image metadata | `app/domains/post_prod/figure_pdf/service.py:1125-1180` |
| Color coercion dict | `app/domains/post_prod/figure_pdf/service.py:1110-1122` |
| Figure-number regex | `app/domains/post_prod/figure_pdf/service.py:1089-1107` |
| `File` model | `app/models/__init__.py:25-62` |
| Generate button | `frontend/src/pages/ChapterFilePage.tsx:1616-1627` |
| Generate handler | `frontend/src/pages/ChapterFilePage.tsx:1358-1392` |
| API client | `frontend/src/api/files.ts:124-131` |
| Response type | `frontend/src/api/files.ts:16-20` |

## Appendix B — Sample workbook column fingerprints

```
Lancaster  / Sheet2             : [Chapter NO., Figure No., Source, Output color, Re-lable (or) Re-Key Category, Queries, Queries Details, Remarks]
Pathak     / de Bruin_190366    : [Chapter Name, Figure No., Source, Output color, Category, Queries, Queries Details, Remarks]
Murphy     / _Art assessment    : [Chapter Name, Output Figure no., Output color, Original File Name, Comments/Instructions from Editorial, Source Status, Suggested Sizing, S4 Billing status, Queries, Queries Details, Querie replies, Batch No, Remarks]  +  22 empty-header columns
Legacy gen / <chapter title>    : [ART NAME, FIGURE NO., PART NO., TYPE, ART CLASSIFICATION, SUPPLIED IMAGE COLOR, SUPPLIED IMAGE MODE, SUPPLIED IMAGE TYPE, SUPPLIED SIZE, FINAL SIZE, SPECIAL INSTRUCTION , FINAL ART COLOR, COMPLEXITY, RESOLUTION (HALFTONE ONLY), STATUS]
```

---

## Appendix C — Implementation Status (post Phase 6)

All six phases from §12 have been implemented against the working tree on
`dev-priya`. Nothing is committed yet; the owner's manual smoke test is the
final gate before commit / PR / deploy.

### C.1 Test totals

```
tests/test_art_assessment_parser.py             20 tests   (Phase 1)
tests/test_parse_assessment_excel_endpoint.py    9 tests   (Phase 3)
tests/test_generate_assessment_dispatcher.py     8 tests   (Phase 4)
tests/test_art_assessment_phase6.py              6 tests   (Phase 6)
                                                ---
                                                 43 tests   all passing
```

### C.2 Files written or modified

| Phase | Path | Kind |
| --- | --- | --- |
| 1 | `app/domains/post_prod/figure_pdf/assessment_parser.py` | new |
| 1 | `tests/fixtures/art_assessment/lancaster_190294.xlsx` | new (copied) |
| 1 | `tests/fixtures/art_assessment/pathak_190442.xlsx` | new (copied) |
| 1 | `tests/fixtures/art_assessment/murphy_7e_189382.xlsx` | new (copied) |
| 1 | `tests/fixtures/art_assessment/legacy_generated.xlsx` | new (built) |
| 1 | `tests/fixtures/art_assessment/_build_legacy_fixture.py` | new |
| 1 | `tests/test_art_assessment_parser.py` | new |
| 2 | `app/domains/post_prod/figure_pdf/models.py` | new |
| 2 | `app/models/__init__.py` | +1 import line |
| 2 | `alembic/versions/0068_art_assessments_table.py` | new |
| 2 | `alembic/versions/0069_art_assessment_rows_table.py` | new |
| 3 | `app/schemas_v2.py` | 2 new models + GenerateFigureAssessmentResponse extended |
| 3 | `app/routers/api_v2.py` | new POST /parse-assessment-excel route |
| 3 | `frontend/src/api/files.ts` | parseAssessmentExcel() + types |
| 3 | `tests/test_parse_assessment_excel_endpoint.py` | new |
| 4 | `app/domains/post_prod/figure_pdf/assessment_parser.py` | +`source_columns` field |
| 4 | `app/domains/post_prod/figure_pdf/service.py` | dispatcher refactor + Excel-path generator |
| 4 | `app/routers/api_v2.py` | handler consumes `AssessmentGenerationResult` |
| 4 | `tests/test_generate_assessment_dispatcher.py` | new |
| 5 | `frontend/src/features/artAssessment/AssessmentPreview.tsx` | new |
| 5 | `frontend/src/pages/ChapterFilePage.tsx` | preview wired into handleGenerateAssessment |
| 6 | `app/domains/post_prod/figure_pdf/assessment_parser.py` | datetime polish + no-rows warning |
| 6 | `app/domains/post_prod/figure_pdf/service.py` | frozen header + column widths in output xlsx |
| 6 | `tests/test_art_assessment_phase6.py` | new |
| 6 | `docs/art-assessment/ALIAS_REGISTRY_MAINTENANCE.md` | new |
| 6 | `docs/art-assessment/ART_ASSESSMENT_IMPLEMENTATION_PLAN.md` | status update (this appendix) |

### C.3 Requirement coverage verification

| Plan requirement | Landed implementation | Lock-in test |
| --- | --- | --- |
| #1 Excel is source of truth | `_generate_from_excel` → parses, persists, writes output from parsed content | `test_excel_path_lancaster_persists_and_preserves_columns` |
| #2 Dynamic columns | Alias registry + `_canon` + header-row scoring | `test_lancaster_data_sheet_and_mapping`, `test_murphy_data_sheet_and_mapping_including_typo_alias` |
| #3 Color may not be RGB | `_COLOR_SPACE_ONLY` scoped to images-only helper | `test_excel_path_murphy_preserves_all_extras`, `test_images_path_still_produces_legacy_15_column_output` |
| #4 Preserve color variants verbatim | Parser never calls `_COLOR_SPACE_ONLY` on Excel path; DB column is nullable text | `test_lancaster_output_color_values_preserved_verbatim`, `test_pathak_preserves_lowercase_and_slash_color_variants`, `test_murphy_preserves_free_text_variants` |
| #5 Different client formats | Alias registry; sheet autodetection; three fixtures exercising Lancaster/Pathak/Murphy | all three per-fixture test sets |
| #6 Preserve additional fields | `art_assessment_rows` has nullable text columns for every requirement-listed field | `test_murphy_data_sheet_and_mapping_including_typo_alias`, `test_murphy_batch_and_editorial_round_trip` |
| #7 No silent discards | `extras_json` on every row + `unmapped_columns_json` + warnings; appended verbatim in output xlsx | `test_unknown_columns_are_preserved`, `test_excel_path_preserves_unmapped_columns_in_output` |
| #8 Map + retain unmapped | Two-tier `canonical` / `unmapped` dict in `ParsedAssessmentRow` | Same tests as #7 |
| #9 No invented defaults | Model columns nullable; parser returns `None`; output xlsx writes empty cells | `test_blank_cells_become_none_not_defaults`, Murphy / Pathak dispatcher tests |
| #10 Preserve workflow | Same URL, same button, response fields additive; auto-download preserved; images-only path byte-identical | `test_images_path_still_produces_legacy_15_column_output`, `test_previously_generated_output_is_not_treated_as_source` |

### C.4 Divergences from the original plan

- **Test directory structure**: the plan said `tests/post_prod/test_assessment_parser.py`. The repo convention is flat `tests/test_*.py` files, so tests live at `tests/test_art_assessment_*.py`.
- **Murphy row count**: the plan said 311 rows based on distinct figure-number values; the parser actually returns 312 non-blank data rows (one figure number repeats in the client workbook). Tests reflect the real count.
- **Output xlsx filename for the Excel path**: plan suggested a few options under Open Question #9; implementation uses `{client_stem}_ArtAssessment_generated.xlsx` so the generated file never collides with either the client's upload (`…_Art assessment.xlsx`) or the legacy images-only output (`…_ArtAssessment.xlsx`).
- **`_DialectJSONB` type**: the plan proposed importing the existing `DialectJSONB` from `app.domains.auth.models`. Implementation re-declares it locally in `models.py` to keep the figure_pdf domain self-contained.
- **Image-metadata columns in output xlsx**: the plan said they'd always append; implementation only appends them when at least one row has matching image metadata, so clean Excel-only runs don't gain 7 empty columns.
- **Phase 6 scope**: since no real-world smoke results were available, Phase 6 focused on pre-emptive hardening (datetime pretty-printing, zero-rows warning, header freeze + column widths) and documentation (alias registry maintenance guide) rather than reactive bug fixes.

### C.5 Open questions — decisions taken

The implementation proceeded with the plan's default stance where no explicit answer was given. Any of these can be revisited without touching the DB schema.

| OQ | Decision in current implementation |
| --- | --- |
| #1 upload-vs-generated distinction | `is_original=True` + filename-suffix guard (`_ArtAssessment.xlsx`, `_ArtAssessment_generated.xlsx`). Covered by `test_previously_generated_output_is_not_treated_as_source`. |
| #2 multiple uploaded Excels | 0 → images fallback; 1 → auto-use; 2+ → 400 "Pass file_id". Covered by `test_multiple_uploaded_xlsx_returns_pick_one_error`. |
| #3 duplicate `figure_no` rows | Preserved, not deduped. Covered by `test_duplicate_figures_are_preserved_not_deduped`. |
| #4 backfill of historical xlsx | Not done. Parse-on-next-run path only. |
| #5 canonicalise `Suggested Sizing` spellings | Not done. All 14 observed spellings round-trip verbatim. |
| #6 admin override of mapping in preview | Not in v1. Preview is read-only. |
| #7 `.xls` / `.xlsm` support | Not in v1. Parser returns `ASSESSMENT_PARSE_INVALID_FORMAT`. |
| #8 warnings audience | Operator-level: toast line + banner in preview. No separate Issues tab. |
| #9 output filename | `{stem}_ArtAssessment_generated.xlsx` (see Divergences above). |

### C.6 What is NOT done yet

- **No git commit.** All changes live in the working tree; the owner's smoke test is the gate before committing.
- **Containers not rebuilt.** The staging stack's `cms_backend` image predates these changes. Rebuilding is deferred until commit.
- **Alembic migrations not applied on staging.** Staging has an unrelated stamp mismatch from before this work; a one-off fix will be needed there. The migrations themselves are verified against a clean Postgres DB (Phase 2).

---

**End of implementation plan. Phase 6 complete; awaiting owner smoke test and commit go-ahead.**
