# Data Model

Related docs:

- [Backend Architecture](backend_architecture.md)
- [File Workflow](file_workflow.md)
- [Known Constraints](known_constraints.md)

The primary persistent model is defined in [`app/models.py`](../../app/models.py).

## Core Entities

### `Role`

Fields:

- `id`
- `name`
- `description`

Relationships:

- many-to-many with `User` through `user_roles`

### `Team`

Fields:

- `id`
- `name`

Relationships:

- one-to-many with `User`
- one-to-many with `Project`

Note: the current `Team` model does not define `description` or `owner_id`, even though `schemas.TeamCreate` and `team_service.create_team(...)` assume them.

### `User`

Fields:

- `id`
- `username`
- `email`
- `password_hash`
- `is_active`
- `team_id`

Relationships:

- many-to-one with `Team`
- many-to-many with `Role`

### `UserRole`

Join table fields:

- `user_id`
- `role_id`

### `Project`

Fields:

- `id`
- `title`
- `code`
- `client_name`
- `xml_standard`
- `status`
- `team_id`

Relationships:

- many-to-one with `Team`
- one-to-many with `Chapter`
- one-to-many with `File`

Notes:

- `status` is stored as `String`, even though `WorkflowStatus` enum exists in the same module.
- SSR bootstrap uses `client_name`, but `schemas.ProjectCreate` does not define it.

### `Chapter`

Fields:

- `id`
- `project_id`
- `number`
- `title`

Relationships:

- many-to-one with `Project`
- one-to-many with `File`

### `File`

Fields:

- `id`
- `project_id`
- `chapter_id`
- `filename`
- `file_type`
- `category`
- `path`
- `uploaded_at`
- `version`
- `is_checked_out`
- `checked_out_by_id`
- `checked_out_at`

Relationships:

- many-to-one with `Project`
- many-to-one with `Chapter`
- many-to-one with `User` as `checked_out_by`
- one-to-many with `FileVersion`

### `FileVersion`

Fields:

- `id`
- `file_id`
- `version_num`
- `path`
- `uploaded_at`
- `uploaded_by_id`

Relationships:

- many-to-one with `File`
- many-to-one with `User` as `uploaded_by`

## Relationship Summary

```text
Team
  -> Users
  -> Projects

User
  <-> Roles (via UserRole)
  -> checked_out File rows
  -> uploaded FileVersion rows

Project
  -> Chapters
  -> Files

Chapter
  -> Files

File
  -> FileVersions
```

## Logical Read Models Without Tables

The following concepts are active in the application but are not stored as separate tables:

| Logical concept | Actual storage source |
| --- | --- |
| Notifications | latest `File` rows |
| Activities | merged `File` and `FileVersion` rows |
| Dashboard stats | project count plus hardcoded summary values |
| Admin dashboard stats | counts of `User` and `File` plus hardcoded zeros |

## Filesystem As Part Of The Model

`File.path` and `FileVersion.path` are core parts of the runtime state. Many workflows depend on the filesystem layout as strongly as they depend on database rows.

Examples:

- chapter uploads overwrite physical paths in place
- archive/version history stores snapshot paths
- processing outputs are registered from physical output paths
- WOPI reads and writes directly to the stored path

## Current Schema/Service Inconsistencies

These are part of the actual codebase and should be understood before further refactoring:

- `Team` model lacks `description` and `owner_id`, but `team_service` writes them
- `ProjectCreate` schema lacks `client_name`, but SSR bootstrap uses it
- the compatibility flat upload endpoint does not populate the same `File` fields as chapter uploads
