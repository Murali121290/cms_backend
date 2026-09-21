import os
import zipfile
import shutil
from typing import Optional
from fastapi import UploadFile

UPLOAD_BASE_DIR = "/opt/cms_runtime/data/uploads/post_prod/web_pdf"


async def process_upload(
    file: UploadFile,
    client_code: str,
    project_name: str,
) -> dict:
    """Upload and extract a ZIP package containing PDFs."""
    if not file.filename.endswith(".zip"):
        return {"status": False, "message": "Only ZIP files are allowed"}

    # Sanitize client code and project name for directory structure
    c_code = client_code.strip() if client_code else "default"
    p_name = project_name.strip()

    project_dir = os.path.join(UPLOAD_BASE_DIR, c_code, p_name)
    os.makedirs(project_dir, exist_ok=True)

    zip_path = os.path.join(project_dir, file.filename)

    # Save ZIP to disk
    with open(zip_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    extract_folder = os.path.join(project_dir, "extract")

    # If folder already exists, clear it
    if os.path.exists(extract_folder):
        shutil.rmtree(extract_folder, ignore_errors=True)

    try:
        os.makedirs(extract_folder, exist_ok=True)
        with zipfile.ZipFile(zip_path, "r") as zip_ref:
            # Filter out macOS metadata files
            members = [m for m in zip_ref.namelist() if not os.path.basename(m).startswith("._")]
            zip_ref.extractall(extract_folder, members=members)

        # Count total files extracted (or specifically PDF files)
        pdf_files = []
        for root, _, files in os.walk(extract_folder):
            for f in files:
                if f.lower().endswith(".pdf") and not f.startswith("._"):
                    pdf_files.append(f)

        total_files = len(pdf_files)

        return {
            "status": True,
            "message": "Upload and extraction successful",
            "pdf_path": zip_path,
            "extract_folder": extract_folder,
            "total_files": total_files,
            "folder_name": project_dir,
        }

    except zipfile.BadZipFile:
        return {"status": False, "message": "Invalid ZIP file"}
    except Exception as e:
        return {"status": False, "message": str(e)}
