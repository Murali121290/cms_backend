# Project And File Workflows

This document covers the current backend-owned project, chapter, file, upload, versioning, and lock workflows exposed through `/api/v2` and still mirrored by retained SSR fallback routes.

Related docs:
- [API_V2_REFERENCE.md](./API_V2_REFERENCE.md)
- [PROCESSING_AND_REVIEW.md](./PROCESSING_AND_REVIEW.md)

## Project Bootstrap

Current frontend-facing project creation contract exists at:
- `POST /api/v2/projects/bootstrap`

Current SSR fallback remains:
- `GET /projects/create`
- `POST /projects/create_with_files`

### Current bootstrap rules
- `chapter_count` must equal uploaded file count
- duplicate derived filename stems are rejected before any rows or folders are created
- one uploaded file creates exactly one chapter
- chapter order follows upload order
- chapter title is derived from the sanitized filename stem
- chapter number is sequential (`01`, `02`, ...)

### Bootstrap folder rule
- `Chapter <index> - <stem>`

Example:
- `edawards12345.docx` -> `Chapter 1 - edawards12345`

### Bootstrap directory layout
- project root under uploads
- per-chapter folder using `Chapter <index> - <stem>`
- standard category subfolders created under each chapter
- uploaded bootstrap file stored only in that chapter’s `Manuscript` folder

## Chapter Workflows

### Read
- `GET /api/v2/projects/{project_id}`
- `GET /api/v2/projects/{project_id}/chapters`
- `GET /api/v2/projects/{project_id}/chapters/{chapter_id}`

### Mutations
- `POST /api/v2/projects/{project_id}/chapters`
- `PATCH /api/v2/projects/{project_id}/chapters/{chapter_id}`
- `DELETE /api/v2/projects/{project_id}/chapters/{chapter_id}`
- `GET /api/v2/projects/{project_id}/chapters/{chapter_id}/package`

### Current semantics
- create bootstraps chapter directories
- rename updates chapter metadata and renames chapter folder where applicable
- delete removes DB state and chapter filesystem state
- package download returns a ZIP of chapter contents

## Chapter File Read Workflow

### Read contracts
- `GET /api/v2/projects/{project_id}/chapters/{chapter_id}`
- `GET /api/v2/projects/{project_id}/chapters/{chapter_id}/files`

Returned file records include:
- filename
- category
- version
- lock state
- available actions

## Upload And Versioning

### Frontend-facing upload contract
- `POST /api/v2/projects/{project_id}/chapters/{chapter_id}/files/upload`

### Current behavior
- uploads are category-aware
- new uploads create new `File` rows and write files into current category paths
- overwrite uploads:
  - create archive copies on disk
  - create `FileVersion` rows
  - increment `File.version`
  - preserve naming/path conventions
  - clear current checkout state in the same way the backend already does
- overwrite of a file locked by another user is skipped, not partially applied

### Upload result contract
- `uploaded[]` for created or replaced files
- `skipped[]` for foreign-lock or other non-applied items

## Version History

Current backend contracts:
- `GET /api/v2/files/{file_id}/versions`
- `GET /api/v2/files/{file_id}/versions/{version_id}/download`

Current state:
- backend contract exists
- frontend does not yet expose a dedicated version-history page

## Checkout And Cancel Checkout

### Contracts
- `POST /api/v2/files/{file_id}/checkout`
- `DELETE /api/v2/files/{file_id}/checkout`

### Current lock semantics
- checkout of an unlocked file succeeds
- repeated checkout by the same user remains compatible with current backend behavior
- checkout of a file locked by another user returns the current conflict contract
- cancel-checkout unlocks only when current backend ownership rules allow it
- non-owner cancel-checkout preserves current backend no-op/owner-only behavior

## File Delete And Download

### Contracts
- `GET /api/v2/files/{file_id}/download`
- `DELETE /api/v2/files/{file_id}`

### Current behavior
- download streams the current file bytes
- delete removes DB state and attempts disk cleanup
- redirect hints still exist in the API responses for compatibility, but `/ui` handles state refresh directly

## Current Frontend Coverage

The React frontend currently uses these workflows for:
- chapter create/rename/delete
- package download link
- chapter file list
- upload
- overwrite/version result display
- download
- checkout
- cancel checkout
- delete

Project bootstrap still remains backend-owned with SSR fallback and an `/api/v2` contract available for future frontend use.
