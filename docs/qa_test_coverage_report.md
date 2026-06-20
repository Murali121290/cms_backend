# QA Test Coverage & Automation Report

This document outlines the test cases covered in the automated test suite of the CMS backend. It lists the coverage grouped by feature domains, specifying what is tested and which test files contain the logic.

---

## 1. Authentication & Session Management
**Test File**: [test_auth_regression.py](file:///c:/Hema/git/cms_backend/tests/test_auth_regression.py) & [test_api_v2_contracts.py](file:///c:/Hema/git/cms_backend/tests/test_api_v2_contracts.py)
* **Login Scenarios**:
  - Valid Credentials → Cookie set successfully & viewer payload returned.
  - Invalid Credentials / Non-existent User → Returns `401 Unauthorized`.
* **Session Verification & Endpoint Protection**:
  - `GET /api/v2/session` supports both Cookie authentication and Bearer token headers.
  - Expired / Invalid Cookie checks.
* **Logout Scenarios**:
  - Session clearing and cookie invalidation.

---

## 2. User & Team Management (Admin Panel)
**Test File**: [test_api_v2_admin_contracts.py](file:///c:/Hema/git/cms_backend/tests/test_api_v2_admin_contracts.py)
* **Users**:
  - Listing all users (`GET /api/v2/admin/users`).
  - Creating new users with role and team assignments (`POST /api/v2/admin/users`).
  - Editing existing user profiles (`PUT /api/v2/admin/users/{user_id}`).
* **Roles & Teams**:
  - Listing available roles (`GET /api/v2/admin/roles`).
  - Listing available teams (`GET /api/v2/admin/teams`).

---

## 3. Customer & Client Management
**Test File**: [test_admin_and_api_compat.py](file:///c:/Hema/git/cms_backend/tests/test_admin_and_api_compat.py)
* **Client CRUD**:
  - Creating a client/customer (`POST /api/v2/admin/clients`).
  - Viewing all clients (`GET /api/v2/admin/clients`).
  - Editing client information such as company name, contact person, email, and location (`PUT /api/v2/admin/clients/{client_id}`).

---

## 4. Project Creation & File Bootstrapping
**Test Files**: [test_api_v2_project_file_mutations.py](file:///c:/Hema/git/cms_backend/tests/test_api_v2_project_file_mutations.py) & [test_project_and_file_workflows.py](file:///c:/Hema/git/cms_backend/tests/test_project_and_file_workflows.py)
* **Dynamic Initializations**:
  - Auto-generating directory folders (e.g. `Chapter 1 - intro/Manuscript/`) based on uploaded files.
  - Mapping multiple files to corresponding chapters with safe URL/path-friendly name stems.
  - Verification of fallback behaviors when files do not match expected naming conventions.
  - File-to-chapter index alignment.
* **ZIP Archive Uploads**:
  - Bootstrapping a project with an empty set of files and later uploading a `.zip` file.
  - Extracting docx, pdf, images, and configuration XML files from the zip into corresponding chapter paths and DB tables.
* **Validation & Error Handling**:
  - Rejects project boot if the chapter count does not match the uploaded file count.
  - Rejects uploads containing duplicate filename stems.

---

## 5. Project Information & Metadata Edit
**Test File**: [test_admin_and_api_compat.py](file:///c:/Hema/git/cms_backend/tests/test_admin_and_api_compat.py)
* **Project Profile Details**:
  - Fetching metadata (`GET /api/v2/projects/{project_id}`).
  - Updating metadata parameters (`PUT /api/v2/projects/{project_id}`) including client company, priority, trim size, ISBN, due date, category, composition, project manager, and sales person.

---

## 6. File Locking, Versioning, Checkout, and Download
**Test Files**: [test_api_v2_project_file_mutations.py](file:///c:/Hema/git/cms_backend/tests/test_api_v2_project_file_mutations.py) & [test_api_v2_upload_versioning_contracts.py](file:///c:/Hema/git/cms_backend/tests/test_api_v2_upload_versioning_contracts.py)
* **File Checkout/Locking**:
  - Single checkout locking to prevent simultaneous edits by multiple users.
  - Releasing checkout locks (normal check-in, or admin release/cancel).
* **Versioning**:
  - Inplace file version updates.
  - Retention of document history when newer versions are uploaded.

---

## 7. Math & XML Conversions
**Test File**: [test_math_conversion.py](file:///c:/Hema/git/cms_backend/tests/test_math_conversion.py)
* **Equation Conversions**:
  - MathML to OMML.
  - LaTeX to MathML conversions for professional math rendering.

---

## 8. Editor Opening & WOPI Integration (Word Online Integration)
**Test File**: [test_structuring_and_wopi.py](file:///c:/Hema/git/cms_backend/tests/test_structuring_and_wopi.py)
* **Editor Iframe Shell Rendering**:
  - Accessing the editor page launcher (`GET /wopi/editor/original/{file_id}` and `GET /wopi/editor/processed/{file_id}`).
  - Verification that the viewer template loads with the correct WOPI iframe source.
* **WOPI Protocol (Office Online Integration)**:
  - `CheckFileInfo` endpoint (`GET /wopi/files/{file_id}`): returns JSON metadata containing file details, permissions (`UserCanWrite`), and user identification details.
  - `GetFile` endpoint (`GET /wopi/files/{file_id}/contents`): retrieves file contents for editing.
  - `PutFile` endpoint (`POST /wopi/files/{file_id}/contents`): saves modified content back to the CMS backend storage.

---

## 9. Database Schema & Table Column Integrity
**Test File**: Dynamic setup in [conftest.py](file:///c:/Hema/git/cms_backend/tests/conftest.py) & model verification throughout all tests.
* **SQL DDL Generation & Metadata Validation**:
  - Automatic DDL generation via SQLAlchemy's `Base.metadata.create_all` using an in-memory SQLite database on every test session startup. This catches any syntax issues, invalid types, foreign key definition errors, or mismatching column schemas.
  - Verification of SQLAlchemy models (e.g. `User`, `Project`, `File`, `ChapterInfo`, `WorkflowMaster`, `RolesMaster`) maps correctly to DB columns.


