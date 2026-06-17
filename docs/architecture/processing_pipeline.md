# Processing Pipeline

Related docs:

- [Service Layer](service_layer.md)
- [Structuring Workflow](structuring_workflow.md)
- [Known Constraints](known_constraints.md)

The processing pipeline is driven by:

- route module: [`app/routers/processing.py`](../../app/routers/processing.py)
- orchestration service: [`app/services/processing_service.py`](../../app/services/processing_service.py)
- technical editor service: [`app/services/technical_editor_service.py`](../../app/services/technical_editor_service.py)
- engine adapters: [`app/processing/`](../../app/processing)

## Start Route

Route:

- `POST /api/v1/processing/files/{file_id}/process/{process_type}`

Behavior:

1. requires cookie-authenticated user
2. checks process permissions from `PROCESS_PERMISSIONS`
3. loads the source `File` row
4. verifies the physical file exists
5. acquires a processing lock if the file is not already checked out
6. creates a backup copy and `FileVersion` row
7. increments `File.version`
8. schedules `background_processing_task` through FastAPI `BackgroundTasks`
9. returns:

```json
{
  "message": "<Process> started in background. The file is locked and will be updated shortly.",
  "status": "processing"
}
```

## Permission Model

`PROCESS_PERMISSIONS` currently maps process types to allowed roles:

| Process type | Allowed roles |
| --- | --- |
| `language` | `Editor`, `CopyEditor`, `Admin` |
| `technical` | `Editor`, `CopyEditor`, `Admin` |
| `macro_processing` | `Editor`, `CopyEditor`, `Admin` |
| `ppd` | `PPD`, `ProjectManager`, `Admin` |
| `permissions` | `PermissionsManager`, `ProjectManager`, `Admin` |
| `reference_validation` | `Editor`, `CopyEditor`, `Admin` |
| `structuring` | `Editor`, `CopyEditor`, `Admin` |
| `bias_scan` | `Editor`, `CopyEditor`, `Admin`, `ProjectManager` |
| `credit_extractor_ai` | `PermissionsManager`, `ProjectManager`, `Admin` |
| `word_to_xml` | `PPD`, `ProjectManager`, `Admin` |

Unknown process types fall back to `Admin` only.

## Processing Backup Behavior

Before background work begins, `processing_service.start_process(...)` creates an archive snapshot:

- archive directory:
  - `{upload_dir}/{project.code}/{chapter.number}/{file.category}/Archive`
  - or `dirname(file.path)/Archive` if project/chapter lookup fails
- backup filename:
  - `{name_only}_v{current_version}.{ext}`

It then inserts a `FileVersion` row and increments `File.version`.

This backup code path is independent from `version_service.archive_existing_file`.

## Background Processing Task

`background_processing_task(...)` opens a fresh `database.SessionLocal()` and then dispatches by `process_type`.

### Engine dispatch

| `process_type` | Engine | Typical outputs |
| --- | --- | --- |
| `permissions` | `PermissionsEngine` | `{base}_PermissionsLog.xlsx` |
| `ppd` | `PPDEngine` | `{base}_MSS_Anaylsis_Dashboard.html`, `{base}_MSS_Anaylsis_Dashboard.xls` |
| `technical` | `TechnicalEngine` | `{base}_TechnicallyEdited.docx` |
| `macro_processing` | `ReferencesEngine` | reference outputs depending on enabled steps |
| `reference_validation` | `ReferencesEngine` | structuring + number + APA outputs |
| `reference_number_validation` | `ReferencesEngine` | `_Val.docx`, report text |
| `reference_apa_chicago_validation` | `ReferencesEngine` | `_NY.docx`, report text |
| `reference_report_only` | `ReferencesEngine` | report-only text plus some validation outputs |
| `reference_structuring` | `ReferencesEngine` | structuring-fixed DOCX and optional log file |
| `structuring` | `StructuringEngine` | `{base}_Processed.docx` |
| `bias_scan` | `BiasEngine` | highlighted DOCX, `{base}_BiasReport.xlsx`, `{base}_BiasScan.zip` |
| `credit_extractor_ai` | `AIExtractorEngine` | `{base}_AIPermissionsLog.xlsx` |
| `word_to_xml` | `XMLEngine` | `html/{base}.xml` |

### Derivative registration

For each generated path:

1. the service infers a MIME type from extension
2. injects publisher styles for generated `.docx` outputs
3. creates a new `File` row with:
   - `filename`
   - `path`
   - `file_type`
   - `project_id`
   - `chapter_id`
   - `version=1`
   - `category` copied from the source file

No source `File` row is replaced. Derivatives are registered as additional `File` rows.

## Success and Failure Lock Handling

### Success

On success the service clears:

- `is_checked_out`
- `checked_out_by_id`
- `checked_out_at`

### Failure

On exception the service clears:

- `is_checked_out`
- `checked_out_by_id`

It does not clear `checked_out_at` in the failure path.

## Structuring Status Polling

Route:

- `GET /api/v1/processing/files/{file_id}/structuring_status`

Behavior:

1. requires cookie auth
2. loads the original file
3. derives the expected processed filename as:
   - `{name_only}_Processed.{ext}`
4. searches for a `File` row in the same project/chapter with that filename
5. returns:

If not found:

```json
{"status": "processing"}
```

If found:

```json
{"status": "completed", "new_file_id": <processed_file_id>}
```

The status endpoint does not inspect background job state directly. It infers completion from the presence of a processed `File` row.

## Technical Editor Endpoints

These live in the same router but use [`technical_editor_service.py`](../../app/services/technical_editor_service.py).

### Scan

- route: `GET /api/v1/processing/files/{file_id}/technical/scan`
- permission: same `technical` permission check
- implementation: `TechnicalEditor.scan(file_path)`
- response: legacy dictionary shape returned as-is

### Apply

- route: `POST /api/v1/processing/files/{file_id}/technical/apply`
- implementation: `TechnicalEditor.process(...)`
- output file naming:
  - `{base}_TechEdited{ext}`
- response on success:

```json
{"status": "completed", "new_file_id": <id>}
```

This `_TechEdited` flow is separate from the background `process/technical` flow, which produces `_TechnicallyEdited.docx`.

## External Processing Dependencies

The pipeline depends on engine wrappers in [`app/processing/`](../../app/processing), which in turn depend on:

- local DOCX processing utilities
- legacy reference-processing modules
- LibreOffice for bias scanning
- Perl and Java for Word-to-XML
- the optional AI structuring backend when `AI_STRUCTURING_BASE_URL` is configured
