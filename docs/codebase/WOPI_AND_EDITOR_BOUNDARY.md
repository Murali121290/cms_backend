# WOPI And Editor Boundary

The editor boundary remains backend-owned. The frontend stops at handoff, review metadata, save/export, and navigation.

Related docs:
- [PROCESSING_AND_REVIEW.md](./PROCESSING_AND_REVIEW.md)
- [AUTH_AND_SESSION.md](./AUTH_AND_SESSION.md)

## Current Boundary Decision

Current recommended boundary:
- frontend owns review shell and navigation
- backend owns editor launch wrappers, WOPI path resolution, byte-serving, and byte-writing

The frontend does not embed the WOPI editor iframe as a first-class owned subsystem.

## Current Routes

### Editor launch wrapper
- `GET /files/{file_id}/edit`

### Original-file WOPI routes
- `GET /wopi/files/{file_id}`
- `GET /wopi/files/{file_id}/contents`
- `POST /wopi/files/{file_id}/contents`

### Structuring-file WOPI routes
- `GET /wopi/files/{file_id}/structuring`
- `GET /wopi/files/{file_id}/structuring/contents`
- `POST /wopi/files/{file_id}/structuring/contents`

These routes are implemented under `app/integrations/wopi`.

## Current Backend Responsibilities

### Path resolution
The backend resolves:
- original target path
- structuring processed-file target path
- file existence and metadata for CheckFileInfo

### Byte operations
The backend handles:
- reading original or processed bytes
- writing updated bytes back from Collabora/WOPI
- version/hash metadata in current CheckFileInfo responses

### Launch URL construction
The backend builds the editor-facing Collabora/WOPI URL used by:
- SSR `editor.html`
- `/api/v2/files/{file_id}/structuring-review`

## Current Frontend Responsibilities

The frontend currently does only this:
- read backend-provided structuring review metadata
- show the provided editor URL if present
- call backend save/export actions
- follow backend-provided return target information

The frontend does not:
- create WOPI URLs
- choose between original and processed file targets
- host WOPI callback behavior
- own editor save lifecycle

## Why The Boundary Stays Backend-Owned

- WOPI behavior is integration-heavy and callback-driven
- original vs processed target selection is backend-specific
- file byte persistence must remain backend-owned
- current save/export semantics for structuring review are backend-specific
- internal release hardening explicitly stopped at WOPI handoff only

## Retained SSR/Backend Surface

Still intentionally retained:
- `editor.html`
- `error.html`
- all `/wopi/...` routes

These are not cleanup candidates until a separate, deliberate editor-boundary migration happens.
