# File Workflow

Related docs:

- [Project Bootstrap](project_bootstrap.md)
- [Processing Pipeline](processing_pipeline.md)
- [Security Model](security_model.md)
- [Known Constraints](known_constraints.md)

This document covers the current non-WOPI file workflows owned by:

- [`file_service.py`](../../app/services/file_service.py)
- [`version_service.py`](../../app/services/version_service.py)
- [`checkout_service.py`](../../app/services/checkout_service.py)

## File Creation Paths

There are three distinct ways `File` rows are created today:

| Workflow | Service | Path convention | Notes |
| --- | --- | --- | --- |
| Project bootstrap | `project_service.create_project_with_initial_files` | `{upload_dir}/{project.code}/Chapter <index> - <stem>/Manuscript/{filename}` | One file per created chapter |
| Later chapter upload | `file_service.upload_chapter_files` | `{upload_dir}/{project.code}/{chapter.number}/{category}/{filename}` | Category-based upload path |
| Compatibility flat upload | `file_service.create_file_record` | `{UPLOAD_DIR}/{project_id}_{timestamp}_{original_name}` | Does not use chapter/category layout |

## Chapter Upload Workflow

Route:

- [`POST /projects/{project_id}/chapter/{chapter_id}/upload`](../../app/routers/web.py)

Service:

- [`file_service.upload_chapter_files`](../../app/services/file_service.py)

### Category path resolution

The service converts spaces in category names to underscores:

`safe_cat = category.replace(" ", "_")`

The target directory becomes:

`{upload_dir}/{project.code}/{chapter.number}/{safe_cat}`

## New Upload Behavior

If there is no existing file with the same `chapter_id`, `category`, and `filename`:

1. the service writes the upload to the target path
2. creates a new `File` row
3. stores:
   - `project_id`
   - `chapter_id`
   - `filename`
   - `file_type` as the file extension string
   - `category`
   - `path`
   - `version=1`

## Overwrite Behavior

If an existing file matches:

1. if the file is locked by another user, the overwrite is silently skipped
2. otherwise:
   - `version_service.archive_existing_file(...)` creates an archive copy
   - a `FileVersion` row is added with the old version number
   - the original file bytes are overwritten in place
   - `File.version` is incremented
   - `File.uploaded_at` is updated
   - `checkout_service.reset_checkout_after_overwrite(...)` clears lock ownership flags

### Archive naming

Archive path:

`{base_path}/Archive/{name_only}_v{old_version}.{ext}`

Example:

- original path: `.../BOOK100/01/Manuscript/existing.docx`
- original version before overwrite: `3`
- archive path: `.../BOOK100/01/Manuscript/Archive/existing_v3.docx`
- `FileVersion.version_num`: `3`
- `File.version` after overwrite: `4`

## Lock State Model

The current file-lock logic supports these states:

| State | Representation |
| --- | --- |
| Unlocked | `is_checked_out=False`, `checked_out_by_id=None` |
| Locked by current user | `is_checked_out=True`, `checked_out_by_id == actor_user_id` |
| Locked by other user | `is_checked_out=True`, `checked_out_by_id != actor_user_id` |
| Unlocked by overwrite upload | `reset_checkout_after_overwrite` clears `is_checked_out` and `checked_out_by_id` only |
| Unlocked by processing success | `processing_service.background_processing_task` clears `is_checked_out`, `checked_out_by_id`, and `checked_out_at` |
| Unlocked by processing failure | same method clears `is_checked_out` and `checked_out_by_id`, but does not clear `checked_out_at` |

## Checkout and Cancel Checkout

Routes:

- [`POST /projects/files/{file_id}/checkout`](../../app/routers/web.py)
- [`POST /projects/files/{file_id}/cancel_checkout`](../../app/routers/web.py)

Service:

- [`checkout_service.py`](../../app/services/checkout_service.py)

### Checkout behavior

- If the file is locked by another user, checkout returns `"locked_by_other"` and the route redirects with `File+Locked+By+Other`.
- Otherwise the file is marked checked out and `checked_out_at` is set to current IST-naive time.
- Same-user checkout is effectively idempotent because the route still redirects to `File+Checked+Out`.

### Cancel checkout behavior

- Unlock only occurs if the actor owns the lock.
- The route always redirects with `Checkout+Cancelled`, even if nothing changed.

## Delete and Download

### Download

Route:

- [`GET /projects/files/{file_id}/download`](../../app/routers/web.py)

Behavior:

- `file_service.get_file_for_download` verifies the `File` row exists, has a path, and the path exists on disk.
- The route returns `FileResponse` with:
  - `filename=file_record.filename`
  - `media_type="application/octet-stream"`

### Delete

Route:

- [`POST /projects/files/{file_id}/delete`](../../app/routers/web.py)

Behavior:

1. the service captures redirect context from the `File` row
2. if the file exists on disk, it attempts `os.remove(...)`
3. disk delete failures are printed and ignored
4. the `File` row is deleted
5. the route redirects to the original chapter tab

## File-Version Persistence

`FileVersion` rows are created by:

- overwrite uploads via `version_service.archive_existing_file`
- processing start via `processing_service.start_process`

The two code paths are separate and intentionally preserved as separate implementations.

## Important Current Constraints

- Bootstrap file paths do not match later chapter upload paths.
- `File.file_type` is not normalized across workflows:
  - bootstrap stores extension
  - later chapter upload stores extension
  - flat upload stores MIME type
  - processing derivatives store MIME type guesses
- The flat `/api/v1/files/` compatibility endpoint does not populate the same fields as the chapter workflow.
