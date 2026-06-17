# Processing And Review

Processing, technical review, and structuring review remain backend-owned workflows exposed through `/api/v2`.

Related docs:
- [PROJECT_AND_FILE_WORKFLOWS.md](./PROJECT_AND_FILE_WORKFLOWS.md)
- [WOPI_AND_EDITOR_BOUNDARY.md](./WOPI_AND_EDITOR_BOUNDARY.md)

## Processing Start And Status

### Contracts
- `POST /api/v2/files/{file_id}/processing-jobs`
- `GET /api/v2/files/{file_id}/processing-status`

### Current model
- no durable job id is exposed
- processing start returns immediate status plus source file/version data
- status polling currently reflects the existing compatibility model, especially for structuring

### Current backend behavior preserved
- permission checks stay backend-owned
- version/archive side effects occur as currently implemented
- file lock behavior remains backend-owned
- unlock-on-success and unlock-on-failure remain unchanged
- derivative file registration remains backend-owned

## Technical Review

### Contracts
- `GET /api/v2/files/{file_id}/technical-review`
- `POST /api/v2/files/{file_id}/technical-review/apply`

### Current behavior
- scan uses the current legacy technical editor implementation under backend orchestration
- scan response includes:
  - normalized `issues`
  - backend `raw_scan`
- apply creates a `_TechEdited` derivative file
- apply registers a new `File` row for that derivative

### Current frontend ownership
- the `/ui` technical review page renders normalized issues and replacement choices
- backend still owns the actual scan/apply logic

## Structuring Review

### Contracts
- `GET /api/v2/files/{file_id}/structuring-review`
- `POST /api/v2/files/{file_id}/structuring-review/save`
- `GET /api/v2/files/{file_id}/structuring-review/export`

### Current behavior
- review metadata resolves the processed `_Processed.docx` target through backend rules
- save applies JSON `changes` to the processed document in place
- export returns the processed DOCX
- editor launch data is returned as metadata, not owned by the frontend

### Current frontend ownership
- frontend owns the review shell page
- backend owns:
  - processed-file resolution
  - save behavior
  - export behavior
  - Collabora launch URL generation
  - return target semantics

## Legacy `/api/v1` Surfaces Still Present

Retained for compatibility:
- `/api/v1/processing/files/{file_id}/process/{process_type}`
- `/api/v1/processing/files/{file_id}/structuring_status`
- `/api/v1/processing/files/{file_id}/technical/scan`
- `/api/v1/processing/files/{file_id}/technical/apply`
- `/api/v1/files/{file_id}/structuring/review`
- `/api/v1/files/{file_id}/structuring/save`
- `/api/v1/files/{file_id}/structuring/review/export`

The primary UI should use `/api/v2`. The legacy routes remain for compatibility and fallback.

## Current Boundaries

### Frontend-owned
- rendering review pages
- displaying processing state
- starting processing
- surfacing errors and success states

### Backend-owned
- permissions
- file mutations
- derivatives
- status semantics
- review save/export
- processed file resolution

The frontend does not own job lifecycle semantics beyond what `/api/v2` already exposes.
