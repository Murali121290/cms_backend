import os
from fastapi import APIRouter, UploadFile, File, Form, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from app import database
from app.domains.auth.security import get_current_user_from_cookie
from app.services.conversion_service import BatchConversionService

router = APIRouter(prefix="/conversion", tags=["Conversion"])

@router.post("/batch-indesign-to-word")
async def batch_indesign_to_word(
    client_name: str = Form(...),
    project_code: str = Form(...),
    files: list[UploadFile] = File(...),
    user = Depends(get_current_user_from_cookie),
    db: Session = Depends(database.get_db)
):
    """
    Accepts client_name, project_code, and a list of InDesign files.
    Organizes them chapter-wise, runs the ExtendScript on Windows Server,
    saves the output .docx inside the Manuscript directory, and returns the result map.
    """
    if not files:
        raise HTTPException(status_code=400, detail="No files uploaded.")
        
    service = BatchConversionService()
    try:
        result = await service.handle_batch_indesign(
            db=db,
            client_name=client_name,
            project_code=project_code,
            files=files,
            actor_user_id=user.id
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/pdf-to-word")
async def pdf_to_word(
    file: UploadFile = File(...),
    engine: str = Form("pdf2docx"), # options: pdf2docx, word_com, acrobat_com
    user = Depends(get_current_user_from_cookie)
):
    """
    Upload a PDF file and convert it directly to a Word document (.docx).
    """
    if not file.filename.endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported.")
        
    service = BatchConversionService()
    try:
        docx_path = await service.handle_pdf_to_word(file, engine)
        
        # Determine the name of the file to return to the client
        return FileResponse(
            path=docx_path,
            media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            filename=f"converted_{os.path.splitext(file.filename)[0]}.docx"
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/indesign-to-word/{file_id}")
async def convert_indesign_file(
    file_id: int,
    user = Depends(get_current_user_from_cookie),
    db: Session = Depends(database.get_db)
):
    """
    Trigger InDesign-to-Word conversion for an existing InDesign file inside the CMS.
    """
    service = BatchConversionService()
    return await service.convert_file_indesign_to_word(db, file_id, user.id)
