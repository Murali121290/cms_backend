# Project Bootstrap Workflow

Related docs:

- [Service Layer](service_layer.md)
- [File Workflow](file_workflow.md)
- [Known Constraints](known_constraints.md)

The project bootstrap workflow is implemented by:

- route: [`POST /projects/create_with_files`](../../app/routers/web.py)
- service: [`project_service.create_project_with_initial_files`](../../app/services/project_service.py)

## Inputs

The SSR form submits:

- `code`
- `title`
- `client_name`
- `xml_standard`
- `chapter_count`
- `files[]`

The route passes these values into `project_service.create_project_with_initial_files(...)` together with `UPLOAD_DIR`.

## Validation Rules

Bootstrap now validates the upload plan before creating any rows or folders.

### 1. Chapter count must match upload count

The service filters out uploads with empty filenames, then requires:

`chapter_count == len(valid_uploads)`

Failure raises `ProjectBootstrapValidationError("Number of chapters must exactly match the number of uploaded files.")`

### 2. Filename stems must be usable

Each upload filename is reduced to a safe stem by:

1. taking the basename stem
2. replacing non `[A-Za-z0-9._-]` characters with `_`
3. trimming leading and trailing ` ._-`

If the result is empty, bootstrap fails with:

`Each uploaded file must have a usable filename.`

### 3. Filename stems must be unique

The normalized safe stems are compared case-insensitively. Duplicate stems fail before any rows or folders are created:

`Uploaded files must have unique filename stems.`

## Bootstrap Algorithm

For each uploaded file, in upload order, the service:

1. creates one sequential chapter index starting at `1`
2. stores `chapter.number` as a zero-padded string such as `01`, `02`, `03`
3. stores `chapter.title` as the sanitized filename stem
4. creates one filesystem folder named:

`Chapter <index> - <safe_stem>`

5. creates category subfolders:
   - `Manuscript`
   - `Art`
   - `InDesign`
   - `Proof`
   - `XML`
6. saves only that upload into the `Manuscript` subfolder
7. creates exactly one `File` row for that upload

## Example

Input:

- `chapter_count = 2`
- uploads:
  - `edawards12345.docx`
  - `Spacing & Symbols!.docx`

Derived plan:

| Upload order | Safe stem | `chapter.number` | `chapter.title` | Folder name |
| --- | --- | --- | --- | --- |
| 1 | `edawards12345` | `01` | `edawards12345` | `Chapter 1 - edawards12345` |
| 2 | `Spacing_Symbols` | `02` | `Spacing_Symbols` | `Chapter 2 - Spacing_Symbols` |

Resulting layout:

```text
uploads/
  BOOK100/
    Chapter 1 - edawards12345/
      Manuscript/
        edawards12345.docx
      Art/
      InDesign/
      Proof/
      XML/
    Chapter 2 - Spacing_Symbols/
      Manuscript/
        Spacing & Symbols!.docx
      Art/
      InDesign/
      Proof/
      XML/
```

## Database Writes

On success the service writes:

- one `Project` row
- `chapter_count` `Chapter` rows
- one `File` row per uploaded file

If `client_name` is truthy, it is patched onto the created `Project` row after `create_project(...)` returns because `schemas.ProjectCreate` does not contain `client_name`.

## Failure Behavior

On validation failure:

- no `Project` row is created
- no `Chapter` row is created
- no `File` row is created
- no project directory is created on disk

The route catches `ProjectBootstrapValidationError` and re-renders `project_create.html` with:

- `request`
- `user`
- `error`

## Important Preserved Constraint

Bootstrap directory naming now differs from later chapter/file services.

- Bootstrap uses `Chapter <index> - <safe_stem>`
- Later chapter create, chapter rename, chapter delete, chapter ZIP download, and chapter uploads still use `{project.code}/{chapter.number}`

This means the bootstrap workflow is intentionally not normalized with later chapter filesystem workflows yet. See [Known Constraints](known_constraints.md).
