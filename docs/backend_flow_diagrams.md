# Backend Flow Diagrams

Related docs:

- [Backend Architecture](architecture/backend_architecture.md)
- [File Workflow](architecture/file_workflow.md)
- [Processing Pipeline](architecture/processing_pipeline.md)
- [Structuring Workflow](architecture/structuring_workflow.md)
- [WOPI Integration](architecture/wopi_integration.md)

## Request Lifecycle

```mermaid
flowchart TD
    A[Browser or API client] --> B[FastAPI router]
    B --> C{Response mode}
    C -->|SSR| D[Jinja template render]
    C -->|JSON/File| E[Response payload]
    B --> F[Service layer]
    F --> G[SQLAlchemy models and Session]
    F --> H[Filesystem under CMS_RUNTIME_ROOT]
    F --> I[Processing engines]
    F --> J[External integrations]
    I --> H
    J --> E
    G --> E
    H --> E
```

## File Upload Workflow

```mermaid
flowchart TD
    A[POST chapter upload] --> B[web.py upload route]
    B --> C[file_service.upload_chapter_files]
    C --> D[Lookup project and chapter]
    D --> E{Existing file with same name?}
    E -->|No| F[Write file to project/code/chapter.number/category]
    F --> G[Create File row version 1]
    E -->|Yes| H{Locked by other user?}
    H -->|Yes| I[Skip file silently]
    H -->|No| J[version_service.archive_existing_file]
    J --> K[Copy prior file into Archive]
    K --> L[Create FileVersion row]
    L --> M[Overwrite original bytes in place]
    M --> N[Increment File.version]
    N --> O[checkout_service.reset_checkout_after_overwrite]
    O --> P[Commit]
```

## Processing Pipeline

```mermaid
flowchart TD
    A[POST /api/v1/processing/files/{id}/process/{type}] --> B[processing.py]
    B --> C[processing_service.start_process]
    C --> D[Auth and role permission check]
    D --> E[Lookup File and disk path]
    E --> F[Lock file for current user]
    F --> G[Create Archive backup and FileVersion row]
    G --> H[Schedule BackgroundTasks callback]
    H --> I[background_processing_task]
    I --> J{Select engine by process_type}
    J --> K[Run engine and gather generated paths]
    K --> L[Register each output as a new File row]
    L --> M[Unlock source file on success]
    J --> N[On exception]
    N --> O[Unlock source file on failure]
```

## Structuring Workflow

```mermaid
flowchart TD
    A[User starts structuring from chapter detail] --> B[Processing route]
    B --> C[StructuringEngine]
    C --> D[Create originalname_Processed.docx]
    D --> E[Register processed File row]
    E --> F[Client polls structuring_status]
    F --> G[processing_service.get_structuring_status]
    G --> H{Processed File row exists?}
    H -->|No| I[Return status processing]
    H -->|Yes| J[Return status completed and new_file_id]
    J --> K[GET /api/v1/files/{id}/structuring/review]
    K --> L[structuring_review_service.build_review_page_state]
    L --> M[Render structuring_review.html with Collabora URL]
    M --> N[Save uses update_document_structure on processed file]
    M --> O[Export returns processed DOCX]
```

## WOPI Interaction

```mermaid
sequenceDiagram
    participant U as Authenticated user
    participant CMS as FastAPI CMS
    participant C as Collabora
    participant FS as Filesystem

    U->>CMS: GET /files/{file_id}/edit
    CMS-->>U: editor.html with iframe src=Collabora cool.html?WOPISrc=...
    U->>C: Open iframe URL
    C->>CMS: GET /wopi/files/{file_id}
    CMS-->>C: CheckFileInfo JSON
    C->>CMS: GET /wopi/files/{file_id}/contents
    CMS->>FS: Read target file bytes
    CMS-->>C: DOCX bytes
    C->>CMS: POST /wopi/files/{file_id}/contents
    CMS->>FS: Write updated bytes directly
    CMS-->>C: 200 OK
```
