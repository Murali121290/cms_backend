import os
import shutil
from pydantic import BaseModel
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from fastapi.responses import FileResponse
from lxml import etree
from sqlalchemy.orm import Session
from datetime import datetime

from app import database
from app.domains.auth.security import get_current_user_from_cookie
from app.domains.auth.rbac_config import has_post_prod_access
from app.core.config import get_settings
from app.domains.post_prod.xml_conversion.models import PostProdXMLConversionProject, PostProdXMLConversionHistory
from app.core.worker import run_xml_conversion_celery_task

def check_post_prod_access(user=Depends(get_current_user_from_cookie)):
    if not user or not has_post_prod_access(user):
        raise HTTPException(status_code=403, detail="Access denied to Post Production / XML Conversion.")
    return user

router = APIRouter(prefix="/xml-conversion", tags=["XML Conversion"], dependencies=[Depends(check_post_prod_access)])

@router.post("/projects")
async def create_xml_conversion_project(
    client_code: str = Form(...),
    project_name: str = Form(...),
    target_format: str = Form("JATS"),
    file: UploadFile = File(...),
    db: Session = Depends(database.get_db),
    current_user: dict = Depends(get_current_user_from_cookie)
):
    """
    Creates a new XML conversion project and uploads the source PDF file.
    """
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported for XML conversion.")
        
    existing_project = db.query(PostProdXMLConversionProject).filter(PostProdXMLConversionProject.project_name == project_name).first()
    if existing_project:
        raise HTTPException(status_code=400, detail="Project name already exists. Please choose a different project name.")
        
    # Save uploaded file
    settings = get_settings()
    project_dir = os.path.join(settings.UPLOAD_FOLDER, "post_prod", "xml_conversion", client_code, project_name)
    os.makedirs(project_dir, exist_ok=True)
    
    filepath = os.path.join(project_dir, file.filename)
    with open(filepath, "wb") as f:
        shutil.copyfileobj(file.file, f)

    project = PostProdXMLConversionProject(
        client_code=client_code,
        project_name=project_name,
        target_format=target_format,
        status="Active",
        filename=file.filename,
        filepath=filepath,
        conversion_status="YTS"
    )
    db.add(project)
    db.commit()
    db.refresh(project)
    
    history = PostProdXMLConversionHistory(
        project_id=project.id,
        action="Project Created",
        details={
            "assigned_by": current_user.username if current_user else "System",
            "file": file.filename,
            "message": f"Project initialized with file {file.filename}"
        }
    )
    db.add(history)
    db.commit()
    
    return {"message": "Project created successfully", "project_id": project.id}

@router.get("/projects")
def list_projects(db: Session = Depends(database.get_db)):
    projects = db.query(PostProdXMLConversionProject).all()
    return projects

@router.put("/projects/{project_id}")
async def update_project(project_id: int, project_data: dict, db: Session = Depends(database.get_db), current_user: dict = Depends(get_current_user_from_cookie)):
    """Update project fields (e.g., assignee)."""
    project = db.query(PostProdXMLConversionProject).filter(PostProdXMLConversionProject.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
        
    if "assignee" in project_data:
        old_assignee = project.assignee
        project.assignee = project_data["assignee"]
        
        # Change status to In-progress if it was YTS
        if project.assignee and project.conversion_status == "YTS":
            project.conversion_status = "In-progress"
            
        history = PostProdXMLConversionHistory(
            project_id=project.id,
            action="Assignee Changed",
            details={
                "user_id": current_user.id if current_user else None,
                "assigned_by": current_user.username if current_user else "System",
                "old_assignee": old_assignee,
                "new_assignee": project.assignee,
                "time": datetime.utcnow().isoformat()
            }
        )
        db.add(history)
        
    db.commit()
    return {"message": "Project updated successfully"}

@router.post("/projects/{project_id}/convert")
def trigger_conversion(project_id: int, db: Session = Depends(database.get_db), current_user: dict = Depends(get_current_user_from_cookie)):
    """
    Triggers the Celery background task to process the PDF -> XML conversion.
    """
    project = db.query(PostProdXMLConversionProject).filter(PostProdXMLConversionProject.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
        
    project.conversion_status = "Pending"
    
    history = PostProdXMLConversionHistory(
        project_id=project.id,
        action="Conversion Started",
        details={
            "message": "XML Conversion background task triggered",
            "triggered_by": current_user.username if current_user else "System"
        }
    )
    db.add(history)
    db.commit()
    
    run_xml_conversion_celery_task.delay(project.id)
    return {"message": "Conversion started", "project_id": project.id}

@router.get("/projects/{project_id}/download")
def download_xml(project_id: int, db: Session = Depends(database.get_db)):
    project = db.query(PostProdXMLConversionProject).filter(PostProdXMLConversionProject.id == project_id).first()
    if not project or not project.result_filepath or not os.path.exists(project.result_filepath):
        raise HTTPException(status_code=404, detail="Converted file not found")
        
    return FileResponse(project.result_filepath, filename=os.path.basename(project.result_filepath))

@router.get("/projects/{project_id}/source-pdf")
def get_source_pdf(project_id: int, db: Session = Depends(database.get_db)):
    project = db.query(PostProdXMLConversionProject).filter(PostProdXMLConversionProject.id == project_id).first()
    if not project or not project.filepath or not os.path.exists(project.filepath):
        raise HTTPException(status_code=404, detail="Source PDF not found")
    return FileResponse(project.filepath, media_type="application/pdf")

@router.post("/projects/{project_id}/s4c-convert")
def s4c_convert(project_id: int, db: Session = Depends(database.get_db)):
    project = db.query(PostProdXMLConversionProject).filter(PostProdXMLConversionProject.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    import requests
    url = os.environ.get("PDF2XML_API_URL")
    if not url:
        raise HTTPException(status_code=500, detail="PDF2XML_API_URL environment variable is not set")
    params = {
        "engine": "heuristic",
        "targets": "json,xml,jats,bits",
        "return_xml": "rawxml"
    }
    
    with open(project.filepath, 'rb') as f:
        files = {'file': (os.path.basename(project.filepath), f, 'application/pdf')}
        response = requests.post(url, params=params, files=files)
        
    if response.status_code != 200:
        raise HTTPException(status_code=500, detail=f"PDF2XML API Error: {response.text}")
        
    xml_content = response.text
    
    out_dir = os.path.dirname(project.filepath)
    base_name = os.path.splitext(os.path.basename(project.filepath))[0]
    raw_filepath = os.path.join(out_dir, f"{base_name}_raw.xml")
    
    with open(raw_filepath, "w", encoding="utf-8") as f:
        f.write(xml_content)
        
    project.raw_xml_status = "Completed"
    if project.conversion_status == "YTS":
        project.conversion_status = "In-progress"
    db.commit()
    
    return {"xml": xml_content, "raw_filepath": raw_filepath}

@router.post("/projects/{project_id}/target-convert")
def target_convert(project_id: int, format: str = "JATS", db: Session = Depends(database.get_db)):
    project = db.query(PostProdXMLConversionProject).filter(PostProdXMLConversionProject.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
        
    project.target_format = format
        
    out_dir = os.path.dirname(project.filepath)
    base_name = os.path.splitext(os.path.basename(project.filepath))[0]
    import requests
    url = os.environ.get("PDF2XML_API_URL")
    if not url:
        raise HTTPException(status_code=500, detail="PDF2XML_API_URL environment variable is not set")
    params = {
        "engine": "heuristic",
        "targets": "json,xml,jats,bits",
        "return_xml": format.lower()
    }
    
    try:
        with open(project.filepath, 'rb') as f:
            files = {'file': (os.path.basename(project.filepath), f, 'application/pdf')}
            response = requests.post(url, params=params, files=files)
            
        if response.status_code != 200:
            raise HTTPException(status_code=500, detail=f"PDF2XML API Error: {response.text}")
            
        xml_content = response.text
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to convert to target format: {str(e)}")
    final_filepath = os.path.join(out_dir, f"{base_name}_final.xml")
    
    with open(final_filepath, "w", encoding="utf-8") as f:
        f.write(xml_content)
        
    project.final_xml_status = "Completed"
    project.result_filepath = final_filepath
    db.commit()
    
    return {"xml": xml_content, "final_filepath": final_filepath}



@router.get("/projects/{project_id}/xml")
def get_xml_content(project_id: int, db: Session = Depends(database.get_db)):
    project = db.query(PostProdXMLConversionProject).filter(PostProdXMLConversionProject.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
        
    # Check if final exists first
    out_dir = os.path.dirname(project.filepath) if project.filepath else ""
    if out_dir:
        base_name = os.path.splitext(os.path.basename(project.filepath))[0]
        final_filepath = os.path.join(out_dir, f"{base_name}_final.xml")
        raw_filepath = os.path.join(out_dir, f"{base_name}_raw.xml")
        
        if os.path.exists(final_filepath):
            with open(final_filepath, "r", encoding="utf-8") as f:
                return {"xml": f.read(), "type": "final"}
        elif os.path.exists(raw_filepath):
            with open(raw_filepath, "r", encoding="utf-8") as f:
                return {"xml": f.read(), "type": "s4c"}
                
    return {"xml": "", "type": ""}

class XMLUpdateRequest(BaseModel):
    xml: str
    type: str = "final"

@router.post("/projects/{project_id}/xml")
def save_xml_content(project_id: int, request: XMLUpdateRequest, db: Session = Depends(database.get_db)):
    project = db.query(PostProdXMLConversionProject).filter(PostProdXMLConversionProject.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
        
    out_dir = os.path.dirname(project.filepath) if project.filepath else ""
    if not out_dir:
        raise HTTPException(status_code=400, detail="Invalid project path")
        
    base_name = os.path.splitext(os.path.basename(project.filepath))[0]
    if request.type == "s4c":
        filepath = os.path.join(out_dir, f"{base_name}_raw.xml")
    else:
        filepath = os.path.join(out_dir, f"{base_name}_final.xml")
    
    with open(filepath, "w", encoding="utf-8") as f:
        f.write(request.xml)
        
    if request.type == "final":
        project.result_filepath = filepath
    
    db.commit()
    return {"message": "XML saved successfully"}

def _run_xslt_transform(xml_data_no_dtd: str, xslt_path: str) -> str:
    try:
        from saxonche import PySaxonProcessor
        with PySaxonProcessor(license=False) as proc:
            xsltproc = proc.new_xslt30_processor()
            executable = xsltproc.compile_stylesheet(stylesheet_file=xslt_path)
            builder = proc.new_document_builder()
            xdm_node = builder.parse_xml(xml_text=xml_data_no_dtd)
            return str(executable.transform_to_string(xdm_node=xdm_node))
    except Exception:
        try:
            from lxml import etree
            xml_doc = etree.fromstring(xml_data_no_dtd.encode("utf-8"))
            xslt_doc = etree.parse(xslt_path)
            transform = etree.XSLT(xslt_doc)
            return str(transform(xml_doc))
        except Exception:
            from xml.etree import ElementTree as ET
            root = ET.fromstring(xml_data_no_dtd.encode("utf-8"))
            html_parts = [
                "<!DOCTYPE html><html><head><meta charset='utf-8'/><style>",
                "body { font-family: system-ui, sans-serif; padding: 24px; line-height: 1.6; color: #1e293b; }",
                "p { margin: 0.6em 0; } h1,h2,h3,h4 { color: #0f172a; margin-top: 1.2em; }",
                "table { border-collapse: collapse; width: 100%; margin: 1em 0; }",
                "td, th { border: 1px solid #cbd5e1; padding: 8px 12px; }",
                "</style></head><body>"
            ]
            def render_node(node):
                tag = node.tag.split("}")[-1].lower() if "}" in node.tag else node.tag.lower()
                is_known = tag in ("h1", "h2", "h3", "h4", "p", "div", "table", "tr", "td", "th", "ul", "ol", "li", "span", "b", "i", "u", "article", "section", "header", "footer")
                if is_known:
                    html_parts.append(f"<{tag}>")
                elif tag not in ("document", "body"):
                    html_parts.append(f"<div class='xml-{tag}'>")
                if node.text:
                    html_parts.append(node.text)
                for child in node:
                    render_node(child)
                    if child.tail:
                        html_parts.append(child.tail)
                if is_known:
                    html_parts.append(f"</{tag}>")
                elif tag not in ("document", "body"):
                    html_parts.append("</div>")
            render_node(root)
            html_parts.append("</body></html>")
            return "".join(html_parts)


@router.get("/projects/{project_id}/html")
def get_html_preview(project_id: int, db: Session = Depends(database.get_db)):
    project = db.query(PostProdXMLConversionProject).filter(PostProdXMLConversionProject.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
        
    out_dir = os.path.dirname(project.filepath) if project.filepath else ""
    if out_dir:
        base_name = os.path.splitext(os.path.basename(project.filepath))[0]
        final_filepath = os.path.join(out_dir, f"{base_name}_final.xml")
        
        if os.path.exists(final_filepath):
            try:
                import re
                xslt_path = os.path.join(os.path.dirname(__file__), "xml_preview.xsl")
                
                # Strip DOCTYPE to bypass JAXP entity expansion limits
                with open(final_filepath, "r", encoding="utf-8") as f:
                    xml_data = f.read()
                xml_data_no_dtd = re.sub(r"<!DOCTYPE[^>]+>", "", xml_data, flags=re.IGNORECASE)
                
                html_str = _run_xslt_transform(xml_data_no_dtd, xslt_path)
                
                # Inline CSS
                css_path = os.path.join(os.path.dirname(__file__), "preview.css")
                if os.path.exists(css_path):
                    with open(css_path, "r") as css_f:
                        css_content = css_f.read()
                    
                    html_str = re.sub(r'<link[^>]*href=["\']?preview\.css["\']?[^>]*>', f'<style>{css_content}</style>', html_str)
                    
                return {"html": html_str}
            except Exception as e:
                return {"html": f"<div style='color:red; padding: 20px;'>Error generating preview: {str(e)}</div>"}
                
    return {"html": "<div style='color:gray; padding: 20px;'>No final XML available for preview.</div>"}

@router.get("/projects/{project_id}/s4c-html")
def get_s4c_html_preview(project_id: int, db: Session = Depends(database.get_db)):
    project = db.query(PostProdXMLConversionProject).filter(PostProdXMLConversionProject.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
        
    out_dir = os.path.dirname(project.filepath) if project.filepath else ""
    if out_dir:
        base_name = os.path.splitext(os.path.basename(project.filepath))[0]
        raw_filepath = os.path.join(out_dir, f"{base_name}_raw.xml")
        
        if os.path.exists(raw_filepath):
            try:
                import re
                xslt_path = os.path.join(os.path.dirname(__file__), "rawxml.xsl")
                
                with open(raw_filepath, "r", encoding="utf-8") as f:
                    xml_data = f.read()
                xml_data_no_dtd = re.sub(r"<!DOCTYPE[^>]+>", "", xml_data, flags=re.IGNORECASE)
                
                html_str = _run_xslt_transform(xml_data_no_dtd, xslt_path)
                    
                return {"html": html_str}
            except Exception as e:
                return {"html": f"<div style='color:red; padding: 20px;'>Error generating S4C preview: {str(e)}</div>"}
                
    return {"html": "<div style='color:gray; padding: 20px;'>No S4C XML available for preview.</div>"}

from pydantic import BaseModel

class ValidateRequest(BaseModel):
    xmlType: str

@router.post("/projects/{project_id}/validate")
def validate_xml_endpoint(project_id: int, req: ValidateRequest, db: Session = Depends(database.get_db)):
    project = db.query(PostProdXMLConversionProject).filter(PostProdXMLConversionProject.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
        
    out_dir = os.path.dirname(project.filepath) if project.filepath else ""
    base_name = os.path.splitext(os.path.basename(project.filepath))[0] if out_dir else ""
    
    if req.xmlType == "s4c":
        xml_filepath = os.path.join(out_dir, f"{base_name}_raw.xml")
    else:
        xml_filepath = os.path.join(out_dir, f"{base_name}_final.xml")
        
    if not os.path.exists(xml_filepath):
        raise HTTPException(status_code=404, detail=f"XML file not found: {xml_filepath}")
        
    # Well-formedness check using lxml
    from lxml import etree
    is_well_formed = True
    well_formed_errors = []
    
    try:
        doc = etree.parse(xml_filepath)
    except etree.XMLSyntaxError as e:
        is_well_formed = False
        well_formed_errors.append(f"Line {e.lineno or 0}: {str(e)}")
        
    is_dtd_valid = True
    dtd_errors = []
    
    # DTD Validation only for final XML for now
    if is_well_formed and req.xmlType == "final":
        from app.domains.post_prod.xml_conversion.validators.dtd_validator import validate_xml
        v_errors = validate_xml(xml_filepath, project.target_format or "JATS")
        for err in v_errors:
            if err["error_type"] == "DTD":
                is_dtd_valid = False
                dtd_errors.append(f"Line {err.get('line_number', 0)}: {err.get('message', '')}")
            elif err["error_type"] == "XMLSyntax":
                is_well_formed = False
                well_formed_errors.append(f"Line {err.get('line_number', 0)}: {err.get('message', '')}")
            elif err["error_type"] == "System":
                is_dtd_valid = False
                dtd_errors.append(err.get('message', ''))
                
    return {
        "isWellFormed": is_well_formed,
        "wellFormedErrors": well_formed_errors,
        "isDtdValid": is_dtd_valid if req.xmlType == "final" else True,
        "dtdErrors": dtd_errors
    }

@router.post("/projects/{project_id}/complete")
def complete_project(project_id: int, db: Session = Depends(database.get_db)):
    project = db.query(PostProdXMLConversionProject).filter(PostProdXMLConversionProject.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
        
    project.conversion_status = "Completed"
    project.qc_status = "Completed"
    project.completed_at = datetime.utcnow()
    db.commit()
    return {"message": "Project marked as Completed"}

@router.delete("/projects/{project_id}")
def delete_project(project_id: int, db: Session = Depends(database.get_db), current_user: dict = Depends(get_current_user_from_cookie)):
    """Delete an XML conversion project and its associated files/folders from disk."""
    project = db.query(PostProdXMLConversionProject).filter(PostProdXMLConversionProject.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # Delete the project folder from disk (contains PDF + any generated XMLs)
    if project.filepath:
        project_dir = os.path.dirname(project.filepath)
        if os.path.exists(project_dir):
            try:
                shutil.rmtree(project_dir)
            except Exception as e:
                # Log but don't block deletion of DB record
                print(f"Warning: Could not delete project folder {project_dir}: {e}")

    # Delete history records first (FK constraint)
    db.query(PostProdXMLConversionHistory).filter(PostProdXMLConversionHistory.project_id == project_id).delete()

    # Delete the project DB record
    db.delete(project)
    db.commit()

    return {"message": "Project deleted successfully"}
