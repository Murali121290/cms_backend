# WOPI Integration

Related docs:

- [Structuring Workflow](structuring_workflow.md)
- [Security Model](security_model.md)
- [Known Constraints](known_constraints.md)

The WOPI integration is implemented by:

- router: [`app/routers/wopi.py`](../../app/routers/wopi.py)
- service: [`app/services/wopi_service.py`](../../app/services/wopi_service.py)

## Purpose

The CMS embeds Collabora Online for in-browser editing of:

- original files via `/files/{file_id}/edit`
- structuring review files via `/api/v1/files/{file_id}/structuring/review`

The browser-facing shell routes are authenticated, but the WOPI callback routes themselves are intentionally unauthenticated.

## Target Path Resolution

`wopi_service.get_target_path(file_record, mode=...)` has two modes:

### Original mode

- target path: `file_record.path`
- target filename: basename of `file_record.path`

### Structuring mode

- if `file_record.path` already ends with `_Processed.docx`, use it directly
- otherwise derive:
  - `{dir}/{name_without_ext}_Processed.docx`

## Editor Shell

Route:

- `GET /files/{file_id}/edit`

Behavior:

1. requires cookie-authenticated user
2. loads the `File` row
3. builds:
   - `filename`
   - `collabora_url`
4. renders `editor.html`

The launch URL format is:

`{COLLABORA_PUBLIC_URL}/browser/dist/cool.html?WOPISrc={encoded WOPI URL}&lang=en`

## CheckFileInfo

Routes:

- `GET /wopi/files/{file_id}`
- `GET /wopi/files/{file_id}/structuring`

### Shared payload fields

Both modes return:

- `BaseFileName`
- `Size`
- `LastModifiedTime`
- `Version`
- `OwnerId`
- `UserId`
- `UserFriendlyName`
- `UserCanWrite`
- `SupportsUpdate`

### Original-only extra fields

Original mode also includes:

- `UserCanNotWriteRelative`
- `SupportsLocks` = `False`
- `DisableExport` = `False`
- `DisablePrint` = `False`
- `HideSaveOption` = `False`

### Version field

`Version` is derived from:

- SHA-256 of the target file bytes
- truncated to the first 16 hex characters

## GetFile

Routes:

- `GET /wopi/files/{file_id}/contents`
- `GET /wopi/files/{file_id}/structuring/contents`

Behavior:

- resolves the target path for the chosen mode
- returns `FileResponse` with DOCX media type

Preserved quirk:

- original-mode `build_file_response_payload(...)` intentionally performs the database lookup twice

## PutFile

Routes:

- `POST /wopi/files/{file_id}/contents`
- `POST /wopi/files/{file_id}/structuring/contents`

Behavior:

1. reads raw request body
2. resolves the target path for the chosen mode
3. if the body is empty, returns `200` without writing
4. otherwise writes bytes directly to the resolved file path
5. returns empty `200`

No database versioning, locking, or `FileVersion` row creation happens during WOPI writes.

## Auth Boundary

### Authenticated

- `GET /files/{file_id}/edit`

### Unauthenticated

- all `/wopi/...` callbacks

This is intentional in the current integration design so Collabora can call back without browser session handling.

## Runtime Dependencies

The WOPI layer depends on:

- `COLLABORA_URL` / `COLLABORA_PUBLIC_URL`
- `WOPI_BASE_URL`
- reverse proxy support for `/browser/`, `/cool/`, `/coolws/`, and `/hosting/` in [`nginx/nginx.conf`](../../nginx/nginx.conf)

## Structuring Mode Relationship

The structuring review page does not serve the processed bytes directly. It embeds an iframe whose `WOPISrc` points to:

`/wopi/files/{file_id}/structuring`

Those structuring WOPI endpoints then target the processed `_Processed.docx` path derived from the original record.
