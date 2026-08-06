import os
import zipfile
from pathlib import Path
import shutil
from typing import Optional

from fastapi import UploadFile
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

# ---------------------------------------------------------------------------
# Upload root — can be overridden via env var for production deployments.
# Default matches the runtime path specified in docker-compose / .env.
# ---------------------------------------------------------------------------
UPLOAD_DIR: str = os.environ.get(
    "EPUB_VALIDATOR_UPLOAD_DIR",
    "/opt/cms_runtime/data/uploads/post_prod/epub_validator",
)
EXTRACT_DIR = "extract"

os.makedirs(UPLOAD_DIR, exist_ok=True)


async def process_upload(
    file: UploadFile,
    db: Optional[Session] = None,
    user_id: Optional[int] = None,
    client: Optional[str] = None,
    client_code: Optional[str] = None,
    project_name: Optional[str] = None,
) -> dict:
    """Upload and extract a ZIP that contains <stem>.epub + <stem>.pdf.

    Returns a plain dict (never JSONResponse) so the caller (router) can
    wrap it however it likes.  The router is responsible for DB writes via
    ev_projects_db.create_project().
    """
    if not file.filename.endswith(".zip"):
        return {"status": False, "message": "Only ZIP files are allowed"}

    folder_name = project_name.strip() if project_name and project_name.strip() else Path(file.filename).stem
    filename = Path(file.filename).stem  # e.g. "mybook" (for expected inner epub/pdf filenames if matching stem)

    upload_folder = os.path.join(UPLOAD_DIR, folder_name)
    zip_path = os.path.join(upload_folder, file.filename)

    os.makedirs(upload_folder, exist_ok=True)

    # Save ZIP to disk
    with open(zip_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    extract_folder = os.path.join(upload_folder, EXTRACT_DIR)

    # If re-uploading an existing or soft-deleted project folder, clear old extracted files
    if os.path.exists(extract_folder):
        shutil.rmtree(extract_folder, ignore_errors=True)

    try:
        with zipfile.ZipFile(zip_path, "r") as zip_ref:
            file_list = zip_ref.namelist()

            epub_names = [n for n in file_list if n.lower().endswith(".epub") and not os.path.basename(n).startswith("._")]
            pdf_names = [n for n in file_list if n.lower().endswith(".pdf") and not os.path.basename(n).startswith("._")]

            if not epub_names or not pdf_names:
                return {
                    "status": False,
                    "message": "ZIP must contain at least one .epub and one .pdf file",
                }

            epub_entry = epub_names[0]
            pdf_entry = pdf_names[0]

            os.makedirs(extract_folder)
            zip_ref.extractall(extract_folder)

        actual_epub_file = os.path.basename(epub_entry)
        actual_pdf_file = os.path.basename(pdf_entry)

        epub_path = os.path.join(extract_folder, actual_epub_file)
        pdf_path = os.path.join(extract_folder, actual_pdf_file)

        epub_extract_path = os.path.join(extract_folder, "epub")
        os.makedirs(epub_extract_path, exist_ok=True)

        with zipfile.ZipFile(epub_path, "r") as epub_ref:
            epub_ref.extractall(epub_extract_path)

        total_files = sum(len(files) for _, _, files in os.walk(epub_extract_path))

        return {
            "status": True,
            "message": "Upload successful",
            "folder_name": folder_name,
            "extract_folder": extract_folder,
            "epub_extract_path": epub_extract_path,
            "epub_file": epub_path,
            "pdf_file": pdf_path,
            "total_files": total_files,
        }

    except zipfile.BadZipFile:
        return {"status": False, "message": "Invalid ZIP file"}

    except Exception as e:
        return {"status": False, "message": str(e)}


def get_extract_files(folder_name: str) -> dict:
    extract_folder = os.path.join(UPLOAD_DIR, folder_name, EXTRACT_DIR, "epub")

    if not os.path.exists(extract_folder):
        return {"status": False, "message": "Folder not found"}

    files_data = []
    for root, _dirs, files in os.walk(extract_folder):
        for file in files:
            full_path = os.path.join(root, file)
            relative_path = os.path.relpath(full_path, extract_folder)
            files_data.append({"file_name": file, "path": relative_path})

    files_data.sort(key=lambda f: f["path"])

    return {
        "status": True,
        "folder": folder_name,
        "total_files": len(files_data),
        "files": files_data,
    }
