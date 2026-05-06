# Testing Strategy

Related docs:

- [System Overview](../system_overview.md)
- [Developer Guide](../developer_guide.md)
- [Known Constraints](known_constraints.md)

The backend regression suite lives under [`tests/`](../../tests) and is designed to protect current behavior while the backend is extracted into services.

## Test Harness

[`tests/conftest.py`](../../tests/conftest.py) provides the regression foundation:

- isolated SQLite database per test
- foreign-key enforcement enabled for SQLite
- temporary upload root per test
- monkeypatched `UPLOAD_DIR` values in router modules that use filesystem paths
- generated DOCX fixtures using `python-docx`
- seeded roles
- user factories
- cookie-auth and bearer-auth clients
- project/chapter/file record factories

This keeps the suite CI-safe and independent of local runtime directories.

## Regression Suites

| Test file | Primary coverage |
| --- | --- |
| [`test_auth_regression.py`](../../tests/test_auth_regression.py) | login, logout, registration, first-user Admin bootstrap, cookie behavior |
| [`test_admin_and_api_compat.py`](../../tests/test_admin_and_api_compat.py) | admin mutations, duplicate route registration order, `/api/v1/projects`, `/api/v1/files` compatibility behavior |
| [`test_project_and_file_workflows.py`](../../tests/test_project_and_file_workflows.py) | project bootstrap, chapter create/rename/delete, uploads, overwrite/versioning, checkout, notifications, activities, project delete |
| [`test_processing_and_technical.py`](../../tests/test_processing_and_technical.py) | processing start, backup/versioning, structuring status polling, background success/failure unlock behavior, technical scan/apply |
| [`test_read_side_pages.py`](../../tests/test_read_side_pages.py) | dashboard, projects list, admin dashboard, admin users, project chapters, chapter detail SSR context contracts |
| [`test_structuring_and_wopi.py`](../../tests/test_structuring_and_wopi.py) | structuring review/save/export, editor shell, original WOPI, structuring WOPI |
| [`test_technical_editor.py`](../../tests/test_technical_editor.py) | compatibility placeholder pointing to the main technical-editor suite |

## What The Suite Protects

### Auth and session

- `/login` redirect target
- `access_token` cookie presence with a Bearer-prefixed JWT value
- surrounding quotes may appear in some test-client or HTTP cookie serialization views, but they are treated as serialization artifacts rather than the backend contract itself
- `/logout` cookie clearing
- `/register` first-user role bootstrap

### Admin behavior

- create user
- replace role
- last-admin protection
- self-disable protection
- email update
- current runtime password-handler ownership
- self-delete block
- duplicate route registration order

### Project and chapter workflows

- bootstrap validation
- zero partial creation on bootstrap failure
- one uploaded file per created chapter
- bootstrap folder naming `Chapter <index> - <stem>`
- chapter create/rename/delete redirect and storage behavior

### File workflows

- new upload path
- overwrite archive snapshot and `FileVersion`
- foreign-lock overwrite skip behavior
- checkout and cancel checkout
- download and delete behavior

### Processing

- processing start response
- lock acquisition
- backup/version creation before background execution
- background derivative registration
- unlock on success
- unlock on failure
- structuring status inference from processed `File` rows

### Technical editor

- technical scan permission boundary
- legacy scan dict pass-through
- `_TechEdited` derivative creation

### Structuring and WOPI

- `error.html` fallback when processed file is missing
- structuring review shell markers
- save targets processed DOCX
- export returns processed DOCX
- editor shell requires auth
- original and structuring WOPI read/write round-trips

## Stubbing Strategy

The suite stubs external or high-risk dependencies where direct execution would make tests brittle:

- `BackgroundTasks.add_task` is monkeypatched to capture scheduling
- processing engine classes are monkeypatched at router import paths
- publisher-style injection is stubbed in processing tests
- structuring helpers such as `extract_document_structure` are stubbed for shell tests
- `TechnicalEditor` methods are monkeypatched for scan/apply tests

This keeps the suite focused on CMS contract behavior instead of external tool availability.

## What The Suite Does Not Try To Validate End-To-End

- live Collabora availability
- real AI structuring backend execution
- real Word-to-XML subprocess execution
- real LibreOffice conversion behavior
- browser-side JavaScript rendering beyond SSR response content and API contracts

Those boundaries are documented and intentionally stubbed for regression safety.
