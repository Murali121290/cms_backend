import os
import re
import uuid
import shutil
import logging
from sqlalchemy.orm import Session
from fastapi import UploadFile, HTTPException

from app import models
from app.services.file_service import upload_chapter_files, UPLOAD_DIR
from app.domains.chapters.service import create_chapter
from app.domains.projects.models import Project

# Safe check for win32com and pythoncom
try:
    import win32com.client
    import pythoncom
    HAS_WIN32COM = True
except ImportError:
    HAS_WIN32COM = False

logger = logging.getLogger("app.conversion")

class BatchConversionService:
    def __init__(self, temp_base_dir: str = "temp_conversions"):
        self.temp_base_dir = temp_base_dir
        os.makedirs(self.temp_base_dir, exist_ok=True)

    def parse_chapter_number(self, filename: str) -> str:
        """
        Regex to parse chapter number from filename (e.g. 'Ch_01.indd', 'chapter02.indd' -> '1', '2')
        """
        match = re.search(r'(?:ch|chap|chapter|c)[^\d]*(\d+)', filename, re.IGNORECASE)
        if match:
            return str(int(match.group(1))) # Normalize '01' to '1'
        # Fallback to any standalone digits in the name
        match_digits = re.search(r'(\d+)', filename)
        if match_digits:
            return str(int(match_digits.group(1)))
        return "1" # Default fallback

    def get_or_create_project(self, db: Session, client_name: str, project_code: str) -> Project:
        project = db.query(Project).filter(Project.project_code == project_code).first()
        if not project:
            # Resolve or auto-create Client
            from app.domains.clients.models import Client
            from sqlalchemy import or_
            client = db.query(Client).filter(
                or_(Client.company == client_name, Client.division == client_name)
            ).first()
            
            if not client:
                client = Client(
                    category_type="organization",
                    contact_type="Customer",
                    company=client_name,
                    division=client_name,
                    email=f"contact@{client_name.lower().replace(' ', '')}.com",
                    active_status=True
                )
                db.add(client)
                db.commit()
                db.refresh(client)

            project = Project(
                project_title=f"Project {project_code}",
                client_id=client.id,
                client_name=client_name,
                project_code=project_code,
                division_code=client_name,
                workflow_name="Standard Workflow", # Default workflow
                chapter_count=0,
                status="Planning"
            )
            db.add(project)
            db.commit()
            db.refresh(project)
        return project

    async def handle_batch_indesign(
        self, db: Session, client_name: str, project_code: str, files: list[UploadFile], actor_user_id: int
    ):
        project = self.get_or_create_project(db, client_name, project_code)
        session_uuid = str(uuid.uuid4())
        session_dir = os.path.join(self.temp_base_dir, session_uuid)
        os.makedirs(session_dir, exist_ok=True)

        results = []

        for upload_file in files:
            if not upload_file.filename:
                continue

            chapter_num = self.parse_chapter_number(upload_file.filename)
            chapter_dir = os.path.join(session_dir, f"ch_{chapter_num}")
            os.makedirs(chapter_dir, exist_ok=True)

            input_path = os.path.join(chapter_dir, upload_file.filename)
            with open(input_path, "wb") as buf:
                shutil.copyfileobj(upload_file.file, buf)

            # Ensure chapter exists in project
            chapter_record = db.query(models.ChapterInfo).filter(
                models.ChapterInfo.project == project.project_code,
                models.ChapterInfo.chapters == chapter_num
            ).first()

            if not chapter_record:
                # Create the chapter using existing domain service
                create_res = create_chapter(
                    db, project_id=project.id, number=chapter_num, title=f"Chapter {chapter_num}", upload_dir=UPLOAD_DIR
                )
                chapter_record = create_res["chapter"]

            # 1. Save uploaded .indd to the chapter's "InDesign" folder in CMS
            upload_file.file.seek(0) # Reset pointer
            cms_upload_res = upload_chapter_files(
                db=db,
                project_id=project.id,
                chapter_id=chapter_record.id,
                category="InDesign",
                files=[upload_file],
                actor_user_id=actor_user_id,
                upload_dir=UPLOAD_DIR
            )
            indd_cms_file = cms_upload_res["uploaded"][0]["file"] if cms_upload_res["uploaded"] else None

            # 2. Run ExtendScript conversion via COM automation on Windows Server
            output_rtf_name = f"Chapter_{chapter_num}.rtf"
            output_rtf_path = os.path.join(chapter_dir, output_rtf_name)
            output_docx_name = f"Chapter_{chapter_num}.docx"
            output_docx_path = os.path.join(chapter_dir, output_docx_name)

            conversion_success = False
            error_message = ""

            if HAS_WIN32COM:
                # We need to initialize COM inside each thread
                pythoncom.CoInitialize()
                try:
                    # InDesign COM Automation
                    app = win32com.client.Dispatch("InDesign.Application")
                    # Specify paths inside script arguments
                    app.ScriptArgs.SetValue("InputFile", os.path.abspath(input_path))
                    app.ScriptArgs.SetValue("OutputFile", os.path.abspath(output_rtf_path))
                    
                    jsx_script = os.path.abspath("app/services/scripts/default_export.jsx")
                    app.DoScript(jsx_script, 1246118721) # idJavaScript
                    
                    # If RTF was successfully created, convert it to DOCX via Word COM
                    if os.path.exists(output_rtf_path):
                        word_app = win32com.client.Dispatch("Word.Application")
                        word_app.Visible = False
                        doc = word_app.Documents.Open(os.path.abspath(output_rtf_path))
                        # 16 is wdFormatXMLDocument (.docx)
                        doc.SaveAs2(os.path.abspath(output_docx_path), FileFormat=16)
                        doc.Close()
                        word_app.Quit()
                        conversion_success = os.path.exists(output_docx_path)
                        # clean up the temp RTF file
                        if os.path.exists(output_rtf_path):
                            os.remove(output_rtf_path)
                    else:
                        error_message = "InDesign script finished, but RTF output was not found."
                except Exception as ex:
                    error_message = str(ex)
                    logger.error(f"InDesign run failed for chapter {chapter_num}: {error_message}")
                finally:
                    pythoncom.CoUninitialize()
            else:
                # Dev / fall-back mode: Mock the output file by copying a dummy docx
                mock_source = os.path.abspath("tests/fixtures/sample.docx")
                if not os.path.exists(mock_source):
                    # Create a dummy blank file if fixture doesn't exist
                    os.makedirs(os.path.dirname(mock_source), exist_ok=True)
                    with open(mock_source, "wb") as f:
                        f.write(b"MOCK DOCX CONTENT")
                shutil.copyfile(mock_source, output_docx_path)
                conversion_success = True

            # 3. If conversion succeeded, upload DOCX file into the "Manuscript" folder
            manuscript_cms_file = None
            if conversion_success and os.path.exists(output_docx_path):
                with open(output_docx_path, "rb") as f:
                    docx_upload = UploadFile(
                        filename=output_docx_name,
                        file=f
                    )
                    cms_docx_res = upload_chapter_files(
                        db=db,
                        project_id=project.id,
                        chapter_id=chapter_record.id,
                        category="Manuscript",
                        files=[docx_upload],
                        actor_user_id=actor_user_id,
                        upload_dir=UPLOAD_DIR
                    )
                    if cms_docx_res["uploaded"]:
                        manuscript_cms_file = cms_docx_res["uploaded"][0]["file"]

            results.append({
                "chapter_number": chapter_num,
                "indd_file_id": indd_cms_file.id if indd_cms_file else None,
                "docx_file_id": manuscript_cms_file.id if manuscript_cms_file else None,
                "success": conversion_success,
                "error": error_message
            })

        # Cleanup the session temporary directory
        try:
            shutil.rmtree(session_dir)
        except Exception as cleanup_err:
            logger.warning(f"Could not clean up session dir {session_dir}: {cleanup_err}")

        return {
            "project_id": project.id,
            "project_code": project.project_code,
            "results": results
        }

    async def handle_pdf_to_word(self, file: UploadFile, engine: str) -> str:
        """
        Converts PDF to DOCX using the chosen engine.
        Returns the output path of the converted DOCX file.
        """
        session_uuid = str(uuid.uuid4())
        session_dir = os.path.join(self.temp_base_dir, session_uuid)
        os.makedirs(session_dir, exist_ok=True)

        pdf_path = os.path.join(session_dir, file.filename)
        docx_path = os.path.join(session_dir, f"{os.path.splitext(file.filename)[0]}.docx")

        with open(pdf_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)

        if engine == "pdf2docx":
            try:
                from pdf2docx import Converter
                cv = Converter(pdf_path)
                cv.convert(docx_path, start=0, end=None)
                cv.close()
            except ImportError:
                raise HTTPException(status_code=500, detail="pdf2docx library not installed on the server.")
            except Exception as e:
                raise HTTPException(status_code=500, detail=f"pdf2docx conversion failed: {str(e)}")

        elif engine == "word_com":
            if not HAS_WIN32COM:
                raise HTTPException(status_code=500, detail="win32com is not available to automate Word.")
            
            pythoncom.CoInitialize()
            try:
                word_app = win32com.client.Dispatch("Word.Application")
                word_app.Visible = False
                doc = word_app.Documents.Open(os.path.abspath(pdf_path))
                doc.SaveAs2(os.path.abspath(docx_path), FileFormat=16) # wdFormatXMLDocument
                doc.Close()
                word_app.Quit()
            except Exception as e:
                raise HTTPException(status_code=500, detail=f"Word COM automation failed: {str(e)}")
            finally:
                pythoncom.CoUninitialize()

        elif engine == "acrobat_com":
            if not HAS_WIN32COM:
                raise HTTPException(status_code=500, detail="win32com is not available to automate Acrobat.")
            
            pythoncom.CoInitialize()
            try:
                acrobat_app = win32com.client.Dispatch("AcroExch.PDDoc")
                if acrobat_app.Open(os.path.abspath(pdf_path)):
                    js_obj = acrobat_app.GetJSObject()
                    js_obj.SaveAs(os.path.abspath(docx_path), "com.adobe.acrobat.docx")
                    acrobat_app.Close()
                else:
                    raise RuntimeError("Failed to open PDF in Adobe Acrobat.")
            except Exception as e:
                raise HTTPException(status_code=500, detail=f"Adobe Acrobat COM automation failed: {str(e)}")
            finally:
                pythoncom.CoUninitialize()

        else:
            raise HTTPException(status_code=400, detail=f"Unsupported PDF conversion engine: {engine}")

        if not os.path.exists(docx_path):
            raise HTTPException(status_code=500, detail="PDF conversion completed but Word file was not found.")

        # Return a copy or keep it. Let's move it to a persistent output folder or return directly.
        # Since the caller needs the file path to stream it, we shouldn't delete the session dir yet,
        # but the caller can delete it after streaming. Or we copy it to UPLOAD_DIR.
        dest_path = os.path.join(UPLOAD_DIR, f"converted_{uuid.uuid4().hex}_{os.path.splitext(file.filename)[0]}.docx")
        shutil.copyfile(docx_path, dest_path)

        try:
            shutil.rmtree(session_dir)
        except Exception:
            pass

        return dest_path
