# API V2 Reference

`/api/v2` is the stable frontend-facing backend surface.

Related docs:
- [AUTH_AND_SESSION.md](./AUTH_AND_SESSION.md)
- [PROJECT_AND_FILE_WORKFLOWS.md](./PROJECT_AND_FILE_WORKFLOWS.md)
- [PROCESSING_AND_REVIEW.md](./PROCESSING_AND_REVIEW.md)

## Session

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/v2/session/login` | login and set cookie |
| `POST` | `/api/v2/session/register` | register without auto-login |
| `GET` | `/api/v2/session` | session bootstrap |
| `DELETE` | `/api/v2/session` | clear cookie session |

## Dashboard, Projects, Chapters, Files Read Side

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/v2/dashboard` | dashboard read model |
| `GET` | `/api/v2/projects` | projects list |
| `GET` | `/api/v2/projects/{project_id}` | project detail with chapters |
| `GET` | `/api/v2/projects/{project_id}/chapters` | chapter list |
| `GET` | `/api/v2/projects/{project_id}/chapters/{chapter_id}` | chapter detail |
| `GET` | `/api/v2/projects/{project_id}/chapters/{chapter_id}/files` | chapter files |
| `GET` | `/api/v2/notifications` | notification feed |
| `GET` | `/api/v2/activities` | activity feed |

## Project, Chapter, And File Mutations

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/v2/projects/bootstrap` | project bootstrap |
| `DELETE` | `/api/v2/projects/{project_id}` | project delete |
| `POST` | `/api/v2/projects/{project_id}/chapters` | chapter create |
| `PATCH` | `/api/v2/projects/{project_id}/chapters/{chapter_id}` | chapter rename |
| `DELETE` | `/api/v2/projects/{project_id}/chapters/{chapter_id}` | chapter delete |
| `GET` | `/api/v2/projects/{project_id}/chapters/{chapter_id}/package` | chapter ZIP/package download |
| `GET` | `/api/v2/files/{file_id}/download` | file download |
| `DELETE` | `/api/v2/files/{file_id}` | file delete |
| `POST` | `/api/v2/files/{file_id}/checkout` | checkout/lock |
| `DELETE` | `/api/v2/files/{file_id}/checkout` | cancel checkout |

## Upload And Versioning

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/v2/projects/{project_id}/chapters/{chapter_id}/files/upload` | category-aware upload and overwrite |
| `GET` | `/api/v2/files/{file_id}/versions` | version-history read |
| `GET` | `/api/v2/files/{file_id}/versions/{version_id}/download` | archived version download |

## Processing And Technical Review

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/v2/files/{file_id}/processing-jobs` | start processing |
| `GET` | `/api/v2/files/{file_id}/processing-status` | current compatibility processing status |
| `GET` | `/api/v2/files/{file_id}/technical-review` | technical scan |
| `POST` | `/api/v2/files/{file_id}/technical-review/apply` | technical apply |

## Structuring Review

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/v2/files/{file_id}/structuring-review` | structuring review metadata |
| `POST` | `/api/v2/files/{file_id}/structuring-review/save` | save structuring changes |
| `GET` | `/api/v2/files/{file_id}/structuring-review/export` | export processed DOCX |

## Admin

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/v2/admin/dashboard` | admin dashboard read model |
| `GET` | `/api/v2/admin/users` | admin users list |
| `GET` | `/api/v2/admin/roles` | role list |
| `POST` | `/api/v2/admin/users` | create user |
| `PUT` | `/api/v2/admin/users/{user_id}/role` | replace role |
| `PUT` | `/api/v2/admin/users/{user_id}/status` | toggle active state |
| `PATCH` | `/api/v2/admin/users/{user_id}` | edit email |
| `PUT` | `/api/v2/admin/users/{user_id}/password` | update password |
| `DELETE` | `/api/v2/admin/users/{user_id}` | delete user |

## Notes

### Current frontend consumption
The frontend actively uses most of the surface above, including:
- session
- dashboard
- projects, chapters, files
- upload/versioning upload contract
- processing
- technical review
- structuring review
- admin

Not currently exposed in the frontend UI:
- project bootstrap
- project delete
- activities page
- version-history browsing UI

### Error contract
Most `/api/v2` errors use the stable JSON shape from `app/schemas_v2.py`:
- `status`
- `code`
- `message`
- `field_errors`
- `details`

### Editor boundary
WOPI callbacks are intentionally not part of `/api/v2`. See [WOPI_AND_EDITOR_BOUNDARY.md](./WOPI_AND_EDITOR_BOUNDARY.md).
