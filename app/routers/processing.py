from app.utils.timezone import now_ist_naive
from app.services.file_service import UPLOAD_DIR
from app.utils.inject_styles import inject_publisher_styles
from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session
from typing import Optional, List, Dict, Any
import os
import shutil
import logging
import traceback
from datetime import datetime

from app import models, database
from app.auth import get_current_user_from_cookie
from app.services import processing_service, technical_editor_service
from app.processing.ppd_engine import PPDEngine
from app.processing.permissions_engine import PermissionsEngine
from app.processing.technical_engine import TechnicalEngine
from app.processing.legacy.highlighter.technical_editor import TechnicalEditor
from app.processing.references_engine import ReferencesEngine
from app.processing.structuring_engine import StructuringEngine
from app.processing.bias_engine import BiasEngine
from app.processing.ai_extractor_engine import AIExtractorEngine
from app.processing.xml_engine import XMLEngine

# Configure specialized logger for processing
logger = logging.getLogger("app.processing")
logger.setLevel(logging.INFO)

router = APIRouter()

PROCESS_PERMISSIONS = processing_service.PROCESS_PERMISSIONS

def check_permission(user, process_type: str):
    return processing_service.check_permission(user, process_type, logger=logger)

def background_processing_task(
    file_id: int,
    process_type: str,
    user_id: int,
    user_username: str,
    mode: str = "style" 
):
    return processing_service.background_processing_task(
        file_id=file_id,
        process_type=process_type,
        user_id=user_id,
        user_username=user_username,
        mode=mode,
        logger=logger,
        inject_publisher_styles_func=inject_publisher_styles,
        permissions_engine_cls=PermissionsEngine,
        ppd_engine_cls=PPDEngine,
        technical_engine_cls=TechnicalEngine,
        references_engine_cls=ReferencesEngine,
        structuring_engine_cls=StructuringEngine,
        bias_engine_cls=BiasEngine,
        ai_extractor_engine_cls=AIExtractorEngine,
        xml_engine_cls=XMLEngine,
    )

@router.post("/files/{file_id}/process/{process_type}")
async def run_file_process(
    file_id: int, 
    process_type: str,
    background_tasks: BackgroundTasks,
    item: Optional[Dict[str, Any]] = None, # Accept JSON body if sent (for mode etc)
    mode: str = "style", # or query param
    user=Depends(get_current_user_from_cookie), 
    db: Session = Depends(database.get_db)
):
    return processing_service.start_process(
        db,
        file_id=file_id,
        process_type=process_type,
        background_tasks=background_tasks,
        mode=mode,
        user=user,
        upload_dir=UPLOAD_DIR,
        logger=logger,
        background_task_callable=background_processing_task,
    )

@router.get("/files/{file_id}/structuring_status")
def check_structuring_status(
    file_id: int,
    user=Depends(get_current_user_from_cookie),
    db: Session = Depends(database.get_db)
):
    return processing_service.get_structuring_status(db, file_id=file_id, user=user)

# ---------------------------
# Technical Editing Endpoints
# ---------------------------

@router.get("/files/{file_id}/technical/scan")
def scan_technical_errors(
    file_id: int,
    user=Depends(get_current_user_from_cookie), 
    db: Session = Depends(database.get_db)
):
    """
    Scans the document for technical editing patterns and returns found items.
    """
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
        
    check_permission(user, 'technical')
    return technical_editor_service.scan_errors(
        db,
        file_id=file_id,
        logger=logger,
        technical_editor_cls=TechnicalEditor,
    )

@router.post("/files/{file_id}/technical/apply")
def apply_technical_edits(
    file_id: int,
    replacements: Dict[str, str],
    user=Depends(get_current_user_from_cookie), 
    db: Session = Depends(database.get_db)
):
    """
    Applies selected technical edits with Track Changes.
    replacements: {'xray': 'X-ray', 'percent': '%'}
    """
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
        
    check_permission(user, 'technical')
    return technical_editor_service.apply_edits(
        db,
        file_id=file_id,
        replacements=replacements,
        username=user.username,
        logger=logger,
        technical_editor_cls=TechnicalEditor,
    )

