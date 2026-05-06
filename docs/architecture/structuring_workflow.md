# Structuring Workflow

Related docs:

- [Processing Pipeline](processing_pipeline.md)
- [WOPI Integration](wopi_integration.md)
- [Known Constraints](known_constraints.md)

The structuring review workflow is implemented by:

- router: [`app/routers/structuring.py`](../../app/routers/structuring.py)
- service: [`app/services/structuring_review_service.py`](../../app/services/structuring_review_service.py)

## Review Entry Route

Route:

- `GET /api/v1/files/{file_id}/structuring/review`

Behavior:

1. requires cookie-authenticated user
2. resolves the processed target path from the input `file_id`
3. verifies the processed file exists
4. extracts document structure as a validation side effect
5. loads rule styles and additional review styles
6. builds a Collabora launch URL using the structuring WOPI endpoint
7. renders:
   - `structuring_review.html` when ready
   - `error.html` when the processed file is missing or state building fails

## Processed-File Resolution Rules

`structuring_review_service.resolve_processed_target(...)` works as follows:

- If `file_record.path` already ends with `_Processed.docx`, it uses that path directly.
- Otherwise it replaces the basename with:
  - `{original_name_without_ext}_Processed.docx`

This lookup is filesystem-based. It does not search for the latest processed `File` row by ID first.

## Review Page State

`build_review_page_state(...)` returns:

- `status`
- `file`
- `filename`
- `collabora_url`
- `styles`

When the processed file is missing, it returns:

```json
{
  "status": "error",
  "error_message": "Processed file not found. Please run Structuring process first."
}
```

### Collabora launch contract

The review shell uses:

- `COLLABORA_PUBLIC_URL`
- `WOPI_BASE_URL`
- `WOPISrc=<encoded /wopi/files/{file_id}/structuring>`

The rendered shell therefore depends on:

- the processed file existing on disk
- the structuring WOPI routes being reachable
- Collabora being able to load `cool.html`

## Save Behavior

Route:

- `POST /api/v1/files/{file_id}/structuring/save`

Behavior:

1. requires cookie-authenticated user
2. resolves the processed target path
3. expects JSON payload with `changes`
4. calls `update_document_structure(processed_path, processed_path, modifications)`
5. updates the processed DOCX in place
6. returns:

```json
{"status": "success"}
```

If the processed file is missing, the route returns `404`.

If the update utility raises, the service returns `500` with `Failed to save changes: ...`.

## Export Behavior

Route:

- `GET /api/v1/files/{file_id}/structuring/review/export`

Behavior:

1. requires cookie-authenticated user
2. resolves the processed target path
3. verifies the file exists
4. returns a `FileResponse` with:
   - `filename=<processed_filename>`
   - DOCX media type

## Browser Flow

The current browser flow is:

1. chapter detail page starts processing
2. chapter detail page polls `/structuring_status`
3. browser redirects to `/api/v1/files/{new_file_id}/structuring/review`
4. `structuring_review.html` hosts Collabora
5. Save and export actions target the processed file

The `Save & Exit` button in `structuring_review.html` does not call the save API. It assumes Collabora auto-save through WOPI and only navigates back to the chapter page.
