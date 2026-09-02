import os
import sys
import uuid
import logging
import shutil
import time
import pythoncom
import win32com.client
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.responses import FileResponse
import uvicorn

# Setup logging
log_file = os.path.abspath("conversion_server.log")
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
    handlers=[
        logging.FileHandler(log_file),
        logging.StreamHandler(sys.stdout)
    ]
)
logger = logging.getLogger("WindowsConversionServer")

app = FastAPI(title="Windows InDesign to Word Conversion Server")

# Inline JSX script contents
JSX_CONTENT = r"""// Adobe InDesign ExtendScript to export .indd to RTF/PDF
// Reads arguments set via ScriptArgs or arguments array

app.scriptPreferences.userInteractionLevel = UserInteractionLevels.NEVER_INTERACT;

try {
    var inputFile = "";
    var outputFile = "";

    try {
        inputFile = app.scriptArgs.getValue("InputFile");
        outputFile = app.scriptArgs.getValue("OutputFile");
    } catch (e) {}

    if (!inputFile && typeof arguments !== "undefined" && arguments.length >= 2) {
        inputFile = arguments[0];
        outputFile = arguments[1];
    }

    if (!inputFile || !outputFile) {
        throw new Error("Missing InputFile or OutputFile argument.");
    }

    var inddFile = new File(inputFile);
    if (!inddFile.exists) {
        throw new Error("Input InDesign file does not exist: " + inputFile);
    }

    // Open InDesign document (headless / without window UI if possible)
    var doc = app.open(inddFile, false);

    // Determine export format based on output file extension
    var outLower = outputFile.toLowerCase();
    var format = ExportFormat.RTF; // Default to RTF (Rich Text Format)
    
    } else if (outLower.indexOf(".pdf") !== -1) {
        format = ExportFormat.PDF_TYPE;
    } else if (outLower.indexOf(".txt") !== -1) {
        format = ExportFormat.TEXT_TYPE;
    } else if (outLower.indexOf(".xml") !== -1) {
        format = ExportFormat.XML;
    }

    var outFile = new File(outputFile);

    if (format === ExportFormat.RTF || format === ExportFormat.TEXT_TYPE) {
        // Document does not support RTF/TXT directly, we merge and export stories
        var tempDoc = app.documents.add(false);
        try {
            var tempPage = tempDoc.pages.item(0);
            var tempTextFrame = tempPage.textFrames.add();
            tempTextFrame.geometricBounds = [0, 0, tempDoc.documentPreferences.pageHeight, tempDoc.documentPreferences.pageWidth];
            var mainStory = tempTextFrame.parentStory;

            var addedAny = false;
            for (var i = 0; i < doc.stories.length; i++) {
                var story = doc.stories.item(i);
                if (story.length > 0 && story.texts.length > 0) {
                    if (addedAny) {
                        mainStory.insertionPoints.item(-1).contents = "\r\r";
                    }
                    story.texts.item(0).duplicate(LocationOptions.AT_END, mainStory.insertionPoints.item(-1));
                    addedAny = true;
                }
            }

            if (!addedAny) {
                mainStory.contents = " ";
            }

            mainStory.exportFile(format, outFile);
        } finally {
            tempDoc.close(SaveOptions.NO);
        }
    } else {
        doc.exportFile(format, outFile, false);
    }

    doc.close(SaveOptions.NO);

} catch (err) {
    if (outputFile) {
        try {
            var logFile = new File(outputFile + ".log.txt");
            logFile.open("w");
            logFile.write("InDesign Export Error: " + err.message + "\nLine: " + err.line + "\nStack: " + err.stack);
            logFile.close();
        } catch (logErr) {}
    }
}
"""

XML_JSX_CONTENT = r"""// Adobe InDesign ExtendScript to import XML into a template and save as INDD
app.scriptPreferences.userInteractionLevel = UserInteractionLevels.NEVER_INTERACT;
try {
    var xmlFilePath = "";
    var templateFilePath = "";
    var outputFilePath = "";

    try {
        xmlFilePath = app.scriptArgs.getValue("XmlFile");
        templateFilePath = app.scriptArgs.getValue("TemplateFile");
        outputFilePath = app.scriptArgs.getValue("OutputFile");
    } catch (e) {}

    if (!xmlFilePath && typeof arguments !== "undefined" && arguments.length >= 3) {
        xmlFilePath = arguments[0];
        templateFilePath = arguments[1];
        outputFilePath = arguments[2];
    }

    if (!xmlFilePath || !templateFilePath || !outputFilePath) {
        throw new Error("Missing XmlFile, TemplateFile, or OutputFile arguments.");
    }

    var templateFile = new File(templateFilePath);
    if (!templateFile.exists) {
        throw new Error("Template file does not exist: " + templateFilePath);
    }
    
    var xmlFile = new File(xmlFilePath);
    if (!xmlFile.exists) {
        throw new Error("XML file does not exist: " + xmlFilePath);
    }

    var doc = app.open(templateFile, false);
    
    // Import XML
    doc.importXML(xmlFile);
    
    // Save as .indd document
    var outputFile = new File(outputFilePath);
    doc.save(outputFile);
    doc.close(SaveOptions.NO);

} catch (err) {
    if (outputFilePath) {
        try {
            var logFile = new File(outputFilePath + ".error.txt");
            logFile.open("w");
            logFile.write("InDesign XML Import Error: " + err.message + "\nLine: " + err.line + "\nStack: " + err.stack);
            logFile.close();
        } catch (logErr) {}
    }
    throw err;
}
"""

def update_slide_master(presentation, template_ppt):

    # Apply template
    presentation.ApplyTemplate(template_ppt)

    # Refresh all slides
    for i in range(1, presentation.Slides.Count + 1):
        slide = presentation.Slides(i)

        try:
            slide.FollowMasterBackground = True
        except:
            pass

        try:
            slide.DisplayMasterShapes = True
        except:
            pass
def apply_ppt_template(input_ppt, template_ppt, output_ppt, session_id):

    powerpoint = None
    presentation = None
    template_presentation = None

    try:
        logger.info(f"[{session_id}] Starting PowerPoint template processing")

        pythoncom.CoInitialize()

        powerpoint = win32com.client.Dispatch("PowerPoint.Application")
        powerpoint.Visible = True

        input_ppt = os.path.abspath(input_ppt)
        template_ppt = os.path.abspath(template_ppt)
        output_ppt = os.path.abspath(output_ppt)

        # Open target presentation
        presentation = powerpoint.Presentations.Open(
            input_ppt,
            WithWindow=False
        )

        # Open template presentation (read only)
        template_presentation = powerpoint.Presentations.Open(
            template_ppt,
            WithWindow=False,
            ReadOnly=True
        )

        # Apply template
        presentation.ApplyTemplate(template_ppt)

        # -------------------------------
        # Apply template slide size
        # -------------------------------
        presentation.PageSetup.SlideWidth = template_presentation.PageSetup.SlideWidth
        presentation.PageSetup.SlideHeight = template_presentation.PageSetup.SlideHeight

        logger.info(
            f"[{session_id}] Applied slide size: "
            f"{presentation.PageSetup.SlideWidth} x "
            f"{presentation.PageSetup.SlideHeight}"
        )
        # update_slide_master(presentation, template_ppt)

        # Save
        presentation.SaveAs(output_ppt)

        template_presentation.Close()
        presentation.Close()

        return output_ppt

    except Exception as e:
        logger.error(f"[{session_id}] PPT template error: {e}")
        raise

    finally:
        try:
            if template_presentation:
                template_presentation.Close()
        except:
            pass

        try:
            if presentation:
                presentation.Close()
        except:
            pass

        try:
            if powerpoint:
                powerpoint.Quit()
        except:
            pass

        pythoncom.CoUninitialize()
def get_jsx_script_path(client_name: str = None):
    # If client is Wolters Kluwer Health, use TextExtraction_WKH.jsx
    if client_name and client_name.strip() == "Wolters Kluwer Health":
        wkh_script = r"C:\Users\muraliba\Documents\TextExtraction_WKH.jsx"
        if os.path.exists(wkh_script):
            logger.info(f"Using Wolters Kluwer Health specific script: {wkh_script}")
            return os.path.abspath(wkh_script)

    # If the user has a custom script environment variable configured, use it!
    custom_script = os.environ.get("INDESIGN_SCRIPT_PATH", "").strip()
    if custom_script and os.path.exists(custom_script):
        return os.path.abspath(custom_script)
        
    # Auto-detect if user has the script in Documents or Downloads
    for auto_script in [
        r"C:\Users\muraliba\Documents\TextExtraction.jsx",
        r"C:\Users\Muraliba\Downloads\TextExtraction.jsxbin",
        r"C:\Users\muraliba\Downloads\TextExtraction.jsxbin",
    ]:
        if os.path.exists(auto_script):
            logger.info(f"Auto-detected custom InDesign script at: {auto_script}")
            return os.path.abspath(auto_script)

    jsx_path = os.path.abspath("default_export.jsx")
    with open(jsx_path, "w", encoding="utf-8") as f:
        f.write(JSX_CONTENT)
    return jsx_path

@app.post("/convert")
def convert_indd_to_docx(file: UploadFile = File(...), client: str = None):
    start_time = time.time()
    session_id = str(uuid.uuid4())
    
    # Terminate any zombie InDesign or Word processes to prevent COM dispatch hangs
    import subprocess
    logger.info(f"[{session_id}] Cleaning up zombie InDesign/Word processes before starting...")
    try:
        subprocess.run(["taskkill", "/F", "/IM", "InDesign.exe"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        subprocess.run(["taskkill", "/F", "/IM", "WINWORD.exe"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except Exception as tk_ex:
        logger.warning(f"[{session_id}] taskkill cleanup failed: {str(tk_ex)}")

    temp_dir = os.path.abspath(f"temp_conversions/{session_id}")
    os.makedirs(temp_dir, exist_ok=True)
    
    logger.info(f"[{session_id}] Received conversion request for file: {file.filename}")
    is_zip = file.filename.lower().endswith(".zip")
    
    # Save uploaded file locally
    uploaded_file_path = os.path.join(temp_dir, file.filename)
    try:
        with open(uploaded_file_path, "wb") as f:
            shutil.copyfileobj(file.file, f)
        logger.info(f"[{session_id}] Saved uploaded file locally at {uploaded_file_path}")
    except Exception as e:
        logger.error(f"[{session_id}] Failed to save uploaded file: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to save file: {str(e)}")
        
    input_path = None
    if is_zip:
        import zipfile
        try:
            logger.info(f"[{session_id}] Unzipping packaged archive...")
            with zipfile.ZipFile(uploaded_file_path, "r") as z:
                z.extractall(temp_dir)
            
            # Find the .indd file recursively
            for root, _, filenames in os.walk(temp_dir):
                for fname in filenames:
                    if fname.lower().endswith(".indd"):
                        input_path = os.path.abspath(os.path.join(root, fname))
                        break
                if input_path:
                    break
                    
            if not input_path:
                raise Exception("No .indd file found in the uploaded ZIP archive.")
            logger.info(f"[{session_id}] Located .indd file inside archive: {input_path}")
        except Exception as zip_ex:
            logger.error(f"[{session_id}] ZIP extraction/parsing failed: {str(zip_ex)}")
            raise HTTPException(status_code=400, detail=f"Failed to process ZIP archive: {str(zip_ex)}")
    else:
        input_path = os.path.abspath(uploaded_file_path)

    indd_basename = os.path.basename(input_path)
    indd_name_no_ext = os.path.splitext(indd_basename)[0]
    
    # We place output files adjacent to the .indd file so links and fonts are resolved relative to it
    output_rtf_path = os.path.join(os.path.dirname(input_path), f"{indd_name_no_ext}.rtf")
    output_docx_path = os.path.join(os.path.dirname(input_path), f"{indd_name_no_ext}.docx")
        
    try:
        import win32com.client
        import pythoncom
    except ImportError:
        logger.error(f"[{session_id}] pywin32 or pythoncom is not installed on this server.")
        raise HTTPException(status_code=500, detail="pywin32 is not installed on the Windows server")

    # 1. Initialize COM
    pythoncom.CoInitialize()
    try:
        # 2. Open Adobe InDesign via COM Automation
        logger.info(f"[{session_id}] Dispatching InDesign.Application...")
        indesign_app = win32com.client.Dispatch("InDesign.Application")
        
        # Disable dialog popups via ExtendScript snippet to ensure it succeeds regardless of COM version
        try:
            indesign_app.DoScript("app.scriptPreferences.userInteractionLevel = UserInteractionLevels.NEVER_INTERACT;", 1246973031)
            logger.info(f"[{session_id}] Successfully disabled user interaction in InDesign application.")
        except Exception as ui_ex:
            logger.warning(f"[{session_id}] Could not set UserInteractionLevel: {str(ui_ex)}")
        
        # Pass file parameters via ScriptArgs (both app.ScriptArgs and arguments array)
        # Pass file parameters via ScriptArgs (both app.ScriptArgs and arguments array)
        indesign_app.ScriptArgs.SetValue("InputFile", os.path.abspath(input_path))
        indesign_app.ScriptArgs.SetValue("OutputFile", os.path.abspath(output_rtf_path))
            
        jsx_script = get_jsx_script_path(client)
        logger.info(f"[{session_id}] Executing ExtendScript: {jsx_script}")
        
        # Execute InDesign script (idJavaScript ID: 1246973031)
        # Pass the input/output paths in ScriptArgs and also as arguments array parameter
        args = [os.path.abspath(input_path), os.path.abspath(output_rtf_path)]
        try:
            indesign_app.DoScript(jsx_script, 1246973031, args)
        except Exception as e:
            try:
                while indesign_app.Documents.Count > 0:
                    indesign_app.Documents.Item(1).Close(1852776783) # idNo
            except Exception:
                pass
            fallback_jsx = os.path.abspath("default_export.jsx")
            if os.path.abspath(jsx_script) == fallback_jsx:
                raise e
            logger.warning(f"[{session_id}] Custom script execution failed: {str(e)}. Falling back to default_export.jsx...")
            
            # Re-initialize InDesign application in case the previous one crashed or disconnected
            try:
                indesign_app.ScriptPreferences.UserInteractionLevel
            except Exception:
                logger.info(f"[{session_id}] InDesign application disconnected or crashed. Re-dispatching...")
                import subprocess
                subprocess.run(["taskkill", "/F", "/IM", "InDesign.exe"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                time.sleep(2)
                indesign_app = win32com.client.Dispatch("InDesign.Application")
                try:
                    indesign_app.DoScript("app.scriptPreferences.userInteractionLevel = UserInteractionLevels.NEVER_INTERACT;", 1246973031)
                except Exception:
                    pass
            
            # Make sure default_export.jsx is generated with robust story merging export
            with open(fallback_jsx, "w", encoding="utf-8") as f:
                f.write(JSX_CONTENT)
            indesign_app.DoScript(fallback_jsx, 1246973031, args)
            
        # Close all leftover open documents to clean up InDesign state
        try:
            while indesign_app.Documents.Count > 0:
                indesign_app.Documents.Item(1).Close(1852776783) # idNo
        except Exception as close_ex:
            logger.warning(f"[{session_id}] Could not close leftover documents: {str(close_ex)}")
        
        # Verify RTF export succeeded
        if not os.path.exists(output_rtf_path):
            raise Exception("InDesign JSX completed but output RTF was not generated.")
            
        logger.info(f"[{session_id}] InDesign exported RTF successfully at {output_rtf_path}")
        
        # 3. The JSX script itself runs RTFtoDocx.exe via a batch file and produces
        #    the .docx directly in the same folder as the RTF. We just need to wait
        #    for that file to appear (RTFtoDocx.exe runs asynchronously via objFile.execute()).
        logger.info(f"[{session_id}] Waiting for DOCX produced by RTFtoDocx.exe (via JSX batch)...")
        wait_seconds = 120  # max wait time
        poll_interval = 1.0
        elapsed = 0.0
        while not os.path.exists(output_docx_path) and elapsed < wait_seconds:
            time.sleep(poll_interval)
            elapsed += poll_interval

        if not os.path.exists(output_docx_path):
            raise Exception(
                f"RTFtoDocx.exe did not produce a DOCX within {wait_seconds}s. "
                f"Expected: {output_docx_path}"
            )
            
        processing_time = time.time() - start_time
        logger.info(f"[{session_id}] Conversion completed successfully in {processing_time:.2f} seconds. Output: {output_docx_path}")
        
        # Read the DOCX bytes into memory. RTFtoDocx.exe may still hold a write lock
        # briefly after the file appears — retry until the lock is released.
        docx_bytes = None
        read_timeout = 30
        read_elapsed = 0.0
        last_read_err = None
        while read_elapsed < read_timeout:
            try:
                with open(output_docx_path, "rb") as fh:
                    docx_bytes = fh.read()
                break  # success
            except PermissionError as pe:
                last_read_err = pe
                time.sleep(0.5)
                read_elapsed += 0.5

        if docx_bytes is None:
            raise Exception(
                f"DOCX file exists but could not be read (still locked after {read_timeout}s): {last_read_err}"
            )

        from starlette.responses import Response
        docx_filename = f"{os.path.splitext(file.filename)[0]}.docx"
        return Response(
            content=docx_bytes,
            media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            headers={"Content-Disposition": f'attachment; filename="{docx_filename}"'}
        )
        
    except Exception as err:
        logger.error(f"[{session_id}] Conversion failed: {str(err)}")
        raise HTTPException(status_code=500, detail=str(err))
    finally:
        pythoncom.CoUninitialize()
        # Clean up temp folder asynchronously in background or after response
        # To avoid file lock issues, we leave cleanup to an background cron or just keep it simple.
        # But we can try to clean up non-output files immediately
        try:
            if os.path.exists(input_path):
                os.remove(input_path)
            if os.path.exists(output_rtf_path):
                os.remove(output_rtf_path)
        except Exception:
            pass

@app.post("/convert-pdf")
def convert_pdf_to_docx(file: UploadFile = File(...)):
    start_time = time.time()
    session_id = str(uuid.uuid4())
    
    # Terminate any zombie PdfToDocx.exe processes
    import subprocess
    logger.info(f"[{session_id}] Cleaning up zombie PdfToDocx.exe processes...")
    try:
        subprocess.run(["taskkill", "/F", "/IM", "PdfToDocx.exe"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except Exception:
        pass

    session_dir = os.path.abspath(f"temp_conversions/{session_id}")
    os.makedirs(session_dir, exist_ok=True)
    
    input_path = os.path.join(session_dir, file.filename)
    output_docx_name = f"{os.path.splitext(file.filename)[0]}.docx"
    output_docx_path = os.path.join(session_dir, output_docx_name)
    
    try:
        # Save uploaded PDF locally
        with open(input_path, "wb") as f:
            f.write(file.file.read())
            
        exe_path = r"C:\Users\muraliba\Documents\PdfToDocx.exe"
        if not os.path.exists(exe_path):
            raise Exception(f"PdfToDocx.exe not found at {exe_path} on the Windows server.")
            
        logger.info(f"[{session_id}] Executing: {exe_path} \"{input_path}\" \"{output_docx_path}\"")
        cmd = [exe_path, os.path.abspath(input_path), os.path.abspath(output_docx_path)]
        result = subprocess.run(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=1800,
            cwd=session_dir  # run inside session dir so relative output lands here
        )
        
        # Always log exe output to aid debugging
        if result.stdout:
            logger.info(f"[{session_id}] PdfToDocx stdout: {result.stdout.strip()}")
        if result.stderr:
            logger.warning(f"[{session_id}] PdfToDocx stderr: {result.stderr.strip()}")
        logger.info(f"[{session_id}] PdfToDocx.exe return code: {result.returncode}")
        
        if result.returncode != 0:
            raise Exception(f"PdfToDocx.exe failed with code {result.returncode}. Stderr: {result.stderr}")
        
        # PdfToDocx.exe uses Adobe PDF Services API. It may exit with rc=0 even on
        # failure, printing the error to stdout instead. Detect known failure patterns.
        stdout_lower = result.stdout.lower()
        if "exceeds permitted size" in stdout_lower:
            raise Exception(
                "PDF file is too large for Adobe PDF Services API (limit ~1 GB). "
                f"File size: ~{os.path.getsize(input_path) // (1024*1024)} MB. "
                "Please split the PDF into smaller chapters and retry."
            )
        if "conversion failed" in stdout_lower or "adobe api error" in stdout_lower:
            raise Exception(
                f"PdfToDocx.exe (Adobe API) reported a conversion failure. "
                f"Stdout: {result.stdout.strip()}"
            )
        
        # Some versions of PdfToDocx.exe ignore the output path argument and write
        # the DOCX alongside the input file using the same base name.
        # Check expected path first, then fallback locations.
        actual_docx_path = None
        candidate_paths = [
            output_docx_path,
            # Same folder as input, same basename
            os.path.join(session_dir, output_docx_name),
            # CWD of the exe (session_dir already, but be explicit)
            os.path.join(os.path.dirname(exe_path), output_docx_name),
        ]
        for candidate in candidate_paths:
            if os.path.exists(candidate):
                actual_docx_path = candidate
                logger.info(f"[{session_id}] Found DOCX at: {actual_docx_path}")
                break

        if actual_docx_path is None:
            raise Exception(
                f"PdfToDocx.exe conversion finished (rc={result.returncode}), "
                f"but output DOCX was not found. Searched: {candidate_paths}. "
                f"Stdout: {result.stdout!r}  Stderr: {result.stderr!r}"
            )
            
        processing_time = time.time() - start_time
        logger.info(f"[{session_id}] PDF conversion completed successfully in {processing_time:.2f} seconds.")
        
        # Read bytes into memory to avoid FileResponse async lock issues
        read_timeout = 30
        read_elapsed = 0.0
        docx_bytes = None
        last_read_err = None
        while read_elapsed < read_timeout:
            try:
                with open(actual_docx_path, "rb") as fh:
                    docx_bytes = fh.read()
                break
            except PermissionError as pe:
                last_read_err = pe
                time.sleep(0.5)
                read_elapsed += 0.5

        if docx_bytes is None:
            raise Exception(
                f"DOCX exists but could not be read after {read_timeout}s (still locked): {last_read_err}"
            )

        from starlette.responses import Response
        return Response(
            content=docx_bytes,
            media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            headers={"Content-Disposition": f'attachment; filename="{output_docx_name}"'}
        )
        
    except Exception as err:
        logger.error(f"[{session_id}] PDF conversion failed: {str(err)}")
        raise HTTPException(status_code=500, detail=str(err))
    finally:
        # Clean up temp files
        try:
            if os.path.exists(input_path):
                os.remove(input_path)
        except Exception:
            pass

@app.post("/apply-ppt-template")
def apply_ppt_template_api(
    ppt_file: UploadFile = File(...),
    template_file: UploadFile = File(...)
):
    print("test")
    session_id = str(uuid.uuid4())

    temp_dir = os.path.abspath(
        f"temp_ppt/{session_id}"
    )

    os.makedirs(
        temp_dir,
        exist_ok=True
    )


    try:

        logger.info(
            f"[{session_id}] PPT template request received"
        )


        # Save input PPT
        input_ppt = os.path.join(
            temp_dir,
            ppt_file.filename
        )

        with open(input_ppt, "wb") as f:
            shutil.copyfileobj(
                ppt_file.file,
                f
            )


        # Save template PPT
        template_ppt = os.path.join(
            temp_dir,
            template_file.filename
        )

        with open(template_ppt, "wb") as f:
            shutil.copyfileobj(
                template_file.file,
                f
            )


        output_ppt = os.path.join(
            temp_dir,
            "styled_" + ppt_file.filename
        )


        result = apply_ppt_template(
            input_ppt,
            template_ppt,
            output_ppt,
            session_id
        )


        if not os.path.exists(result):
            raise Exception(
                "Output PowerPoint was not generated"
            )


        return FileResponse(
            path=result,
            filename=os.path.basename(result),
            media_type=
            "application/vnd.openxmlformats-officedocument.presentationml.presentation"
        )


    except Exception as e:

        logger.error(
            f"[{session_id}] PPT API failed: {str(e)}"
        )

        raise HTTPException(
            status_code=500,
            detail=str(e)
        )

@app.post("/convert-xml-to-indesign")
def convert_xml_to_indesign(file: UploadFile = File(...)):
    start_time = time.time()
    session_id = str(uuid.uuid4())
    
    # 1. Sync script from network share if newer
    network_jsx = r"\\10.1.1.100\common_share\Murali Balu\SpringerXMLProcessor.jsx"
    local_jsx = r"C:\Users\muraliba\Documents\SpringerXMLProcessor.jsx"
    run_jsx = r"C:\Users\muraliba\Documents\SpringerXMLProcessor_run.jsx"
    workflow_base_dir = r"C:\Users\muraliba\Documents\temp_conversions"

    logger.info(f"[{session_id}] Checking network share JSX for updates...")
    if os.path.exists(network_jsx):
        try:
            if not os.path.exists(local_jsx) or os.path.getmtime(network_jsx) > os.path.getmtime(local_jsx):
                logger.info(f"[{session_id}] Syncing {network_jsx} to {local_jsx}...")
                os.makedirs(os.path.dirname(local_jsx), exist_ok=True)
                shutil.copy2(network_jsx, local_jsx)
        except Exception as sync_ex:
            logger.warning(f"[{session_id}] Failed to sync network JSX script: {str(sync_ex)}")
    else:
        logger.warning(f"[{session_id}] Network JSX script not found at {network_jsx}")

    # Terminate any zombie InDesign processes
    import subprocess
    logger.info(f"[{session_id}] Cleaning up zombie InDesign processes...")
    try:
        subprocess.run(["taskkill", "/F", "/IM", "InDesign.exe"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except Exception as tk_ex:
        logger.warning(f"[{session_id}] taskkill cleanup failed: {str(tk_ex)}")

    temp_dir = os.path.join(workflow_base_dir, session_id)
    os.makedirs(temp_dir, exist_ok=True)
    
    logger.info(f"[{session_id}] Received XML-to-InDesign conversion request")
    uploaded_file_path = os.path.join(temp_dir, file.filename)
    
    try:
        with open(uploaded_file_path, "wb") as f:
            shutil.copyfileobj(file.file, f)
        logger.info(f"[{session_id}] Saved zip to {uploaded_file_path}")
    except Exception as e:
        logger.error(f"[{session_id}] Failed to save uploaded file: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to save file: {str(e)}")

    # Extract zip file
    import zipfile
    try:
        with zipfile.ZipFile(uploaded_file_path, "r") as z:
            z.extractall(temp_dir)
        logger.info(f"[{session_id}] Unzipped XML-to-InDesign package successfully")
    except Exception as zip_ex:
        logger.error(f"[{session_id}] ZIP extraction failed: {str(zip_ex)}")
        raise HTTPException(status_code=400, detail=f"Failed to extract ZIP archive: {str(zip_ex)}")

    # Locate XML and INDT files recursively
    xml_path = None
    indt_path = None
    
    for root, _, filenames in os.walk(temp_dir):
        for fname in filenames:
            if fname.lower().endswith(".xml"):
                xml_path = os.path.abspath(os.path.join(root, fname))
            elif fname.lower().endswith(".indt"):
                indt_path = os.path.abspath(os.path.join(root, fname))
                
    if not xml_path:
        raise HTTPException(status_code=400, detail="No XML file (.xml) found in zip package")
    if not indt_path:
        raise HTTPException(status_code=400, detail="No InDesign template (.indt) found in zip package")
        
    logger.info(f"[{session_id}] XML found: {xml_path}")
    logger.info(f"[{session_id}] Template found: {indt_path}")
    
    # 2. Prepare paths for InDesign ScriptArgs
    xml_dir = os.path.dirname(xml_path)
    xml_basename = os.path.splitext(os.path.basename(xml_path))[0]
    output_indd_path = os.path.join(xml_dir, f"{xml_basename}.indd")
    output_pdf_path = os.path.join(xml_dir, f"{xml_basename}.pdf")
    
    artwork_path = os.path.join(temp_dir, "artfile")
    if not os.path.exists(artwork_path):
        artwork_path = temp_dir

    if not os.path.exists(local_jsx):
        raise HTTPException(status_code=500, detail=f"Local InDesign script missing: {local_jsx}")

    try:
        import win32com.client
        import pythoncom
    except ImportError:
        raise HTTPException(status_code=500, detail="pywin32 is not installed on this server")
        
    # COM execution
    pythoncom.CoInitialize()
    try:
        logger.info(f"[{session_id}] Dispatching InDesign.Application...")
        indesign_app = win32com.client.Dispatch("InDesign.Application")
        
        try:
            indesign_app.DoScript("app.scriptPreferences.userInteractionLevel = UserInteractionLevels.NEVER_INTERACT;", 1246973031)
        except Exception as ui_ex:
            logger.warning(f"[{session_id}] Could not set userInteractionLevel: {str(ui_ex)}")
            
        # Pass parameters via ScriptArgs
        logger.info(f"[{session_id}] Setting ScriptArgs for {local_jsx}...")
        indesign_app.ScriptArgs.SetValue("template_path", os.path.abspath(indt_path))
        indesign_app.ScriptArgs.SetValue("job_doc", os.path.abspath(output_indd_path))
        indesign_app.ScriptArgs.SetValue("pdf_path", os.path.abspath(output_pdf_path))
        indesign_app.ScriptArgs.SetValue("tokenid", session_id)
        indesign_app.ScriptArgs.SetValue("xml_path", os.path.abspath(xml_path))
        indesign_app.ScriptArgs.SetValue("artwork_path", os.path.abspath(artwork_path))

        logger.info(f"[{session_id}] Running ExtendScript JSX script directly: {local_jsx}...")
        indesign_app.DoScript(local_jsx, 1246973031)
        
        # Close leftover open documents
        try:
            while indesign_app.Documents.Count > 0:
                indesign_app.Documents.Item(1).Close(1852776783) # idNo
        except Exception:
            pass
            
        # Verify output exists
        if not os.path.exists(output_indd_path):
            raise Exception("InDesign XML Import script completed, but output .indd file was not generated.")
            
        # Create output ZIP containing both indd and pdf
        out_zip_path = os.path.join(temp_dir, f"output_{session_id}.zip")
        with zipfile.ZipFile(out_zip_path, "w", zipfile.ZIP_DEFLATED) as out_zf:
            out_zf.write(output_indd_path, os.path.basename(output_indd_path))
            if os.path.exists(output_pdf_path):
                out_zf.write(output_pdf_path, os.path.basename(output_pdf_path))
                logger.info(f"[{session_id}] Packaged PDF into output zip: {output_pdf_path}")
            else:
                logger.warning(f"[{session_id}] Output PDF file not found to package!")

        # Read zip bytes into response
        with open(out_zip_path, "rb") as fh:
            zip_bytes = fh.read()
            
        processing_time = time.time() - start_time
        logger.info(f"[{session_id}] XML to InDesign completed successfully in {processing_time:.2f} seconds")
        
        from starlette.responses import Response
        return Response(
            content=zip_bytes,
            media_type="application/zip",
            headers={"Content-Disposition": f'attachment; filename="output_{session_id}.zip"'}
        )
        
    except Exception as err:
        logger.error(f"[{session_id}] XML to InDesign execution failed: {str(err)}")
        raise HTTPException(status_code=500, detail=str(err))
    finally:
        pythoncom.CoUninitialize()
        # Keep temp directory (disabled cleanup as requested)
        # try:
        #     shutil.rmtree(temp_dir)
        # except Exception as cleanup_ex:
        #     logger.warning(f"[{session_id}] Failed to clean up temp dir {temp_dir}: {str(cleanup_ex)}")

@app.post("/convert-indesign-to-xml")
def convert_indesign_to_xml(file: UploadFile = File(...), client: str = None):
    start_time = time.time()
    session_id = str(uuid.uuid4())
    
    # Terminate zombie processes
    import subprocess
    logger.info(f"[{session_id}] Cleaning up zombie processes before starting...")
    try:
        subprocess.run(["taskkill", "/F", "/IM", "InDesign.exe"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except Exception as tk_ex:
        logger.warning(f"[{session_id}] taskkill cleanup failed: {str(tk_ex)}")

    temp_dir = os.path.abspath(f"temp_conversions/{session_id}")
    os.makedirs(temp_dir, exist_ok=True)
    
    logger.info(f"[{session_id}] Received indesign-to-xml request for file: {file.filename}")
    is_zip = file.filename.lower().endswith(".zip")
    
    uploaded_file_path = os.path.join(temp_dir, file.filename)
    try:
        with open(uploaded_file_path, "wb") as f:
            shutil.copyfileobj(file.file, f)
    except Exception as e:
        logger.error(f"[{session_id}] Failed to save uploaded file: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to save file: {str(e)}")
        
    input_path = None
    if is_zip:
        import zipfile
        try:
            logger.info(f"[{session_id}] Unzipping packaged archive...")
            with zipfile.ZipFile(uploaded_file_path, "r") as z:
                z.extractall(temp_dir)
            
            # Find the .indd file recursively
            for root, _, filenames in os.walk(temp_dir):
                for fname in filenames:
                    if fname.lower().endswith(".indd"):
                        input_path = os.path.abspath(os.path.join(root, fname))
                        break
                if input_path:
                    break
                    
            if not input_path:
                raise Exception("No .indd file found in the uploaded ZIP archive.")
            logger.info(f"[{session_id}] Located .indd file inside archive: {input_path}")
        except Exception as zip_ex:
            logger.error(f"[{session_id}] ZIP extraction failed: {str(zip_ex)}")
            raise HTTPException(status_code=400, detail=str(zip_ex))
    else:
        input_path = os.path.abspath(uploaded_file_path)

    indd_basename = os.path.basename(input_path)
    indd_name_no_ext = os.path.splitext(indd_basename)[0]
    output_xml_path = os.path.join(os.path.dirname(input_path), f"{indd_name_no_ext}_final.xml")
    
    try:
        import win32com.client
        import pythoncom
    except ImportError:
        logger.error(f"[{session_id}] pywin32 or pythoncom is not installed on this server.")
        raise HTTPException(status_code=500, detail="pywin32 is not installed on the Windows server")

    pythoncom.CoInitialize()
    try:
        logger.info(f"[{session_id}] Dispatching InDesign.Application...")
        indesign_app = win32com.client.Dispatch("InDesign.Application")
        
        try:
            indesign_app.DoScript("app.scriptPreferences.userInteractionLevel = UserInteractionLevels.NEVER_INTERACT;", 1246973031)
        except Exception as ui_ex:
            logger.warning(f"[{session_id}] Could not set UserInteractionLevel: {str(ui_ex)}")
        
        # Find Springer_Finaxml.jsx
        jsx_script = None
        candidates = [
            r"C:\Users\muraliba\Documents\Springer_Finaxml.jsx",
            os.path.abspath("Springer_Finaxml.jsx"),
            os.path.abspath("app/services/scripts/Springer_Finaxml.jsx"),
        ]
        for candidate in candidates:
            if os.path.exists(candidate):
                jsx_script = os.path.abspath(candidate)
                break
                
        if not jsx_script:
            # Fallback to default_export.jsx
            jsx_script = os.path.abspath("default_export.jsx")
            logger.info(f"[{session_id}] Springer_Finaxml.jsx not found. Using default_export.jsx: {jsx_script}")
        else:
            logger.info(f"[{session_id}] Using Springer_Finaxml.jsx script at: {jsx_script}")
        # If we are using Springer_Finaxml.jsx, we want to clear the old logs so we can wait for batch execution
        is_springer_jsx = os.path.basename(jsx_script) == "Springer_Finaxml.jsx"
        log_path = None
        epub_log_path = None
        docx_output_path = os.path.join(os.path.dirname(input_path), f"{indd_name_no_ext}_final.docx")
        if is_springer_jsx:
            script_dir = os.path.dirname(jsx_script)
            log_path = os.path.join(script_dir, "finalxml", "finalxml.log")
            epub_log_path = os.path.join(script_dir, "epub", "epub.log")
            for p, name in [(log_path, "finalxml.log"), (epub_log_path, "epub.log"), (docx_output_path, f"{indd_name_no_ext}_final.docx")]:
                if os.path.exists(p):
                    try:
                        os.remove(p)
                    except Exception as e:
                        logger.warning(f"[{session_id}] Could not remove old {name}: {e}")

        # Use absolute paths with backslashes
        abs_input = os.path.abspath(input_path).replace("/", "\\")
        abs_output = os.path.abspath(output_xml_path).replace("/", "\\")
        
        indesign_app.ScriptArgs.SetValue("InputFile", abs_input)
        indesign_app.ScriptArgs.SetValue("OutputFile", abs_output)
            
        args = [abs_input, abs_output]
        indesign_app.DoScript(jsx_script, 1246973031, args)
        
        # If we ran Springer_Finaxml.jsx, we wait for both finalxml.bat and epub.bat processes to finish
        if is_springer_jsx:
            if log_path:
                logger.info(f"[{session_id}] Waiting for Springer finalxml.bat processing...")
                start_wait = time.time()
                while time.time() - start_wait < 45:
                    if os.path.exists(log_path):
                        try:
                            # Attempt to open file to ensure it's not locked by writing process
                            with open(log_path, "r") as lf:
                                lf.read()
                            logger.info(f"[{session_id}] finalxml.bat completed successfully.")
                            break
                        except Exception:
                            pass
                    time.sleep(0.5)
            if epub_log_path:
                logger.info(f"[{session_id}] Waiting for Springer epub.bat processing...")
                start_wait = time.time()
                while time.time() - start_wait < 45:
                    if os.path.exists(epub_log_path):
                        try:
                            # Attempt to open file to ensure it's not locked by writing process
                            with open(epub_log_path, "r") as lf:
                                lf.read()
                            logger.info(f"[{session_id}] epub.bat completed successfully.")
                            break
                        except Exception:
                            pass
                    time.sleep(0.5)
            if docx_output_path:
                logger.info(f"[{session_id}] Waiting for Springer RTFtoDocx.exe conversion to {docx_output_path}...")
                start_wait = time.time()
                while time.time() - start_wait < 45:
                    if os.path.exists(docx_output_path) and os.path.getsize(docx_output_path) > 0:
                        try:
                            # Attempt to open file to ensure it's not locked by writing process
                            with open(docx_output_path, "rb") as lf:
                                lf.read(100)
                            logger.info(f"[{session_id}] DOCX conversion completed successfully.")
                            break
                        except Exception:
                            pass
                    time.sleep(0.5)
            
        try:
            while indesign_app.Documents.Count > 0:
                indesign_app.Documents.Item(1).Close(1852776783) # idNo
        except Exception:
            pass
 
        # Springer_Finaxml.jsx automatically outputs to *_finalxml.xml in the .indd directory
        # Let's locate it, rename it to *_final.xml (which is output_xml_path)
        if is_springer_jsx:
            indd_dir = os.path.dirname(input_path)
            expected_jsx_xml = os.path.join(indd_dir, f"{indd_name_no_ext}_finalxml.xml")
            if os.path.exists(expected_jsx_xml):
                try:
                    if os.path.exists(output_xml_path):
                        os.remove(output_xml_path)
                    os.rename(expected_jsx_xml, output_xml_path)
                    logger.info(f"[{session_id}] Renamed {expected_jsx_xml} to {output_xml_path}")
                except Exception as rename_err:
                    logger.warning(f"[{session_id}] Failed to rename Springer XML output: {str(rename_err)}")
            
        if not os.path.exists(output_xml_path):
            # Check if there is an error log
            error_log_path = output_xml_path + ".log.txt"
            if os.path.exists(error_log_path):
                with open(error_log_path, "r", encoding="utf-8") as err_f:
                    err_msg = err_f.read()
                raise Exception(f"InDesign JSX export failed: {err_msg}")
            raise Exception("Export failed. Output XML file was not created by InDesign.")
            
        logger.info(f"[{session_id}] XML exported successfully to {output_xml_path}")
        
        # Package all output files into ZIP response
        import io
        import zipfile
        zip_buffer = io.BytesIO()
        with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as out_zf:
            for root, _, filenames in os.walk(temp_dir):
                for fname in filenames:
                    if fname.startswith("~$") or fname.startswith("."):
                        continue
                    ext = os.path.splitext(fname)[1].lower()
                    if ext in (".xml", ".epub", ".log", ".jpg", ".jpeg", ".docx", ".pdf", ".xhtml", ".css", ".indd", ".indt") and not fname.endswith(".zip"):
                        file_abs_path = os.path.join(root, fname)
                        rel_path = os.path.relpath(file_abs_path, temp_dir)
                        try:
                            out_zf.write(file_abs_path, rel_path)
                            logger.info(f"[{session_id}] Zipped result file: {rel_path}")
                        except Exception as z_err:
                            logger.warning(f"[{session_id}] Skipping transient/unreadable file {rel_path}: {z_err}")
            if log_path and os.path.exists(log_path):
                out_zf.write(log_path, "finalxml_batch.log")
            if epub_log_path and os.path.exists(epub_log_path):
                out_zf.write(epub_log_path, "epub_batch.log")
            
        zip_bytes = zip_buffer.getvalue()
        processing_time = time.time() - start_time
        logger.info(f"[{session_id}] InDesign to XML completed successfully in {processing_time:.2f} seconds")
        
        from starlette.responses import Response
        return Response(
            content=zip_bytes,
            media_type="application/zip",
            headers={"Content-Disposition": f'attachment; filename="output_{session_id}.zip"'}
        )
        
    except Exception as err:
        logger.error(f"[{session_id}] InDesign to XML execution failed: {str(err)}")
        raise HTTPException(status_code=500, detail=str(err))
    finally:
        pythoncom.CoUninitialize()

@app.post("/extract-design-css")
def extract_design_css(file: UploadFile = File(...)):
    start_time = time.time()
    session_id = str(uuid.uuid4())
    logger.info(f"[{session_id}] Received extract-design-css request for file: {file.filename}")
    
    is_zip = file.filename.lower().endswith(".zip")
    
    temp_dir = os.path.abspath(f"temp_conversions/{session_id}")
    os.makedirs(temp_dir, exist_ok=True)
    
    uploaded_file_path = os.path.join(temp_dir, file.filename)
    try:
        with open(uploaded_file_path, "wb") as f:
            shutil.copyfileobj(file.file, f)
    except Exception as e:
        logger.error(f"[{session_id}] Failed to save uploaded file: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to save file: {str(e)}")
        
    input_path = None
    if is_zip:
        import zipfile
        try:
            with zipfile.ZipFile(uploaded_file_path, "r") as z:
                z.extractall(temp_dir)
            for root, _, filenames in os.walk(temp_dir):
                for fname in filenames:
                    if fname.lower().endswith((".indd", ".indt")):
                        input_path = os.path.abspath(os.path.join(root, fname))
                        break
                if input_path:
                    break
            if not input_path:
                raise Exception("No .indd or .indt file found in the uploaded ZIP.")
        except Exception as zip_ex:
            logger.error(f"[{session_id}] ZIP extraction failed: {str(zip_ex)}")
            raise HTTPException(status_code=400, detail=str(zip_ex))
    else:
        input_path = os.path.abspath(uploaded_file_path)

    if not input_path or not input_path.lower().endswith((".indd", ".indt")):
        raise HTTPException(status_code=400, detail="Uploaded file is not a valid InDesign document (.indd/.indt)")

    indd_basename = os.path.basename(input_path)
    indd_name_no_ext = os.path.splitext(indd_basename)[0]
    output_css_path = os.path.join(os.path.dirname(input_path), "layout_design.css")
    
    if os.path.exists(output_css_path):
        try:
            os.remove(output_css_path)
        except Exception:
            pass

    import win32com.client
    import pythoncom
    pythoncom.CoInitialize()
    
    try:
        indesign_app = win32com.client.Dispatch("InDesign.Application")
        
        try:
            indesign_app.DoScript("app.scriptPreferences.userInteractionLevel = UserInteractionLevels.NEVER_INTERACT;", 1246973031)
        except Exception:
            pass
            
        jsx_script = os.path.abspath("app/services/scripts/extract_css.jsx")
        if not os.path.exists(jsx_script):
            jsx_script = os.path.abspath("extract_css.jsx")
        if not os.path.exists(jsx_script):
            jsx_script = r"C:\Users\muraliba\Documents\CSS\extract_css.jsx"
            
        if not os.path.exists(jsx_script):
            raise Exception("extract_css.jsx script file not found on Windows server.")

        abs_input = os.path.abspath(input_path).replace("/", "\\")
        abs_output = os.path.abspath(output_css_path).replace("/", "\\")
        
        indesign_app.ScriptArgs.SetValue("InputFile", abs_input)
        indesign_app.ScriptArgs.SetValue("OutputFile", abs_output)
        
        args = [abs_input, abs_output]
        indesign_app.DoScript(jsx_script, 1246973031, args)
        
        logger.info(f"[{session_id}] Waiting for layout_design.css to be written...")
        start_wait = time.time()
        css_content = None
        while time.time() - start_wait < 20:
            err_log = output_css_path + ".err.log"
            if os.path.exists(err_log):
                with open(err_log, "r") as err_f:
                    err_msg = err_f.read()
                raise Exception(f"InDesign CSS extraction script failed: {err_msg}")
                
            if os.path.exists(output_css_path) and os.path.getsize(output_css_path) > 0:
                try:
                    with open(output_css_path, "r", encoding="utf-8") as f:
                        css_content = f.read()
                    break
                except Exception:
                    pass
            time.sleep(0.5)
            
        try:
            while indesign_app.Documents.Count > 0:
                indesign_app.Documents.Item(1).Close(1852776783)
        except Exception:
            pass
            
        if not css_content:
            raise Exception("CSS extraction failed: output file layout_design.css was not created.")
            
        logger.info(f"[{session_id}] CSS extraction completed successfully in {time.time() - start_time:.2f} seconds")
        
        from starlette.responses import Response
        return Response(content=css_content, media_type="text/css")
        
    except Exception as err:
        logger.error(f"[{session_id}] extract_design_css failed: {str(err)}")
        raise HTTPException(status_code=500, detail=str(err))
    finally:
        pythoncom.CoUninitialize()

@app.post("/merge-book")
def merge_book(file: UploadFile = File(...)):
    start_time = time.time()
    session_id = str(uuid.uuid4())
    workflow_base_dir = r"C:\Users\muraliba\Documents\temp_conversions"
    
    temp_dir = os.path.join(workflow_base_dir, f"combine_{session_id}")
    os.makedirs(temp_dir, exist_ok=True)
    
    logger.info(f"[{session_id}] Received combine book request")
    uploaded_file_path = os.path.join(temp_dir, file.filename)
    
    try:
        with open(uploaded_file_path, "wb") as f:
            shutil.copyfileobj(file.file, f)
        logger.info(f"[{session_id}] Saved zip to {uploaded_file_path}")
    except Exception as e:
        logger.error(f"[{session_id}] Failed to save uploaded file: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to save file: {str(e)}")

    # Extract zip file
    import zipfile
    try:
        with zipfile.ZipFile(uploaded_file_path, "r") as z:
            z.extractall(temp_dir)
        logger.info(f"[{session_id}] Unzipped combined package successfully")
    except Exception as zip_ex:
        logger.error(f"[{session_id}] ZIP extraction failed: {str(zip_ex)}")
        raise HTTPException(status_code=400, detail=f"Failed to extract ZIP archive: {str(zip_ex)}")

    # Run book_xml.pl
    xml_script = r"C:\Users\muraliba\Documents\Merge\book_xml.pl"
    output_xml = os.path.join(temp_dir, "merged.xml")
    
    logger.info(f"[{session_id}] Running book_xml.pl script...")
    try:
        import subprocess
        # book_xml.pl <input_dir> <output_file>
        result_xml = subprocess.run(
            ["perl", xml_script, temp_dir, output_xml],
            capture_output=True,
            text=True,
            check=True
        )
        logger.info(f"[{session_id}] book_xml.pl succeeded: {result_xml.stdout}")
    except Exception as xml_err:
        logger.error(f"[{session_id}] book_xml.pl failed: {str(xml_err)}")
        err_msg = getattr(xml_err, "stderr", str(xml_err))
        raise HTTPException(status_code=500, detail=f"XML merge failed: {err_msg}")

    # Run book_epub.pl
    epub_script = r"C:\Users\muraliba\Documents\Merge\book_epub.pl"
    
    # Locate or create a stylesheet.css in temp_dir
    css_files = [f for f in os.listdir(temp_dir) if f.lower().endswith(".css") and f != "stylesheet.css"]
    css_path = os.path.join(temp_dir, css_files[0]) if css_files else os.path.join(temp_dir, "stylesheet.css")
    if not os.path.exists(css_path):
        with open(css_path, "w") as f:
            f.write("/* empty stylesheet */\n")
            
    logger.info(f"[{session_id}] Running book_epub.pl script...")
    try:
        # book_epub.pl <dir_path> <css_file> [book_title]
        # It generates "combined_book.epub" in dir_path
        result_epub = subprocess.run(
            ["perl", epub_script, temp_dir, css_path, "Combined Book"],
            capture_output=True,
            text=True,
            check=True
        )
        logger.info(f"[{session_id}] book_epub.pl succeeded: {result_epub.stdout}")
    except Exception as epub_err:
        logger.error(f"[{session_id}] book_epub.pl failed: {str(epub_err)}")
        err_msg = getattr(epub_err, "stderr", str(epub_err))
        raise HTTPException(status_code=500, detail=f"EPUB merge failed: {err_msg}")

    # Verify and rename combined_book.epub to merged.epub
    generated_epub = os.path.join(temp_dir, "combined_book.epub")
    output_epub = os.path.join(temp_dir, "merged.epub")
    if os.path.exists(generated_epub):
        shutil.move(generated_epub, output_epub)
    else:
        logger.error(f"[{session_id}] Expected EPUB output not found at {generated_epub}")
        raise HTTPException(status_code=500, detail="Expected combined_book.epub output not found")

    if not os.path.exists(output_xml) or not os.path.exists(output_epub):
        raise HTTPException(status_code=500, detail="Merged outputs missing from temp directory")

    # Zip output files
    out_zip_path = os.path.join(temp_dir, f"merged_output_{session_id}.zip")
    try:
        with zipfile.ZipFile(out_zip_path, "w") as z_out:
            z_out.write(output_xml, "merged.xml")
            z_out.write(output_epub, "merged.epub")
        logger.info(f"[{session_id}] Packaged merged outputs successfully into {out_zip_path}")
    except Exception as zip_ex:
        logger.error(f"[{session_id}] Packaging merged outputs failed: {str(zip_ex)}")
        raise HTTPException(status_code=500, detail=f"Failed to package merged outputs: {str(zip_ex)}")

    # Stream ZIP back to client
    from starlette.responses import FileResponse
    return FileResponse(out_zip_path, media_type="application/zip", filename="merged_output.zip")

@app.post("/view-proof")
def view_proof(file: UploadFile = File(...)):
    start_time = time.time()
    session_id = str(uuid.uuid4())
    workflow_base_dir = r"C:\Users\muraliba\Documents\temp_conversions"
    temp_dir = os.path.join(workflow_base_dir, f"view_proof_{session_id}")
    os.makedirs(temp_dir, exist_ok=True)
    
    logger.info(f"[{session_id}] Received view-proof request")
    uploaded_file_path = os.path.join(temp_dir, file.filename)
    
    try:
        with open(uploaded_file_path, "wb") as f:
            shutil.copyfileobj(file.file, f)
        logger.info(f"[{session_id}] Saved zip to {uploaded_file_path}")
    except Exception as e:
        logger.error(f"[{session_id}] Failed to save uploaded file: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to save file: {str(e)}")
        
    # Extract zip file
    import zipfile
    try:
        with zipfile.ZipFile(uploaded_file_path, "r") as z:
            z.extractall(temp_dir)
        logger.info(f"[{session_id}] Unzipped view-proof package successfully")
    except Exception as zip_ex:
        logger.error(f"[{session_id}] ZIP extraction failed: {str(zip_ex)}")
        raise HTTPException(status_code=400, detail=f"Failed to extract ZIP archive: {str(zip_ex)}")

    # Find the .xhtml and .indt files recursively
    xhtml_path = None
    indt_path = None
    for root, _, filenames in os.walk(temp_dir):
        for fname in filenames:
            if fname.lower().endswith(".xhtml"):
                xhtml_path = os.path.abspath(os.path.join(root, fname))
            elif fname.lower().endswith(".indt"):
                indt_path = os.path.abspath(os.path.join(root, fname))
                
    if not xhtml_path:
        raise HTTPException(status_code=400, detail="No XHTML file (.xhtml) found in zip package")
    if not indt_path:
        raise HTTPException(status_code=400, detail="No InDesign template (.indt) found in zip package")

    logger.info(f"[{session_id}] XHTML found: {xhtml_path}")
    logger.info(f"[{session_id}] Template found: {indt_path}")

    # Prepare paths
    xml_basename = os.path.splitext(os.path.basename(xhtml_path))[0]
    output_xml_path = os.path.join(temp_dir, f"{xml_basename}.xml")
    
    # Run universal_converter.pl in xhtml2xml mode
    perl_script = r"C:\Users\muraliba\Documents\xhtml\universal_converter.pl"
    mapping_config = r"C:\Users\muraliba\Documents\xhtml\mapping_config.json"
    
    if not os.path.exists(perl_script):
        perl_script = os.path.abspath("app/services/scripts/universal_converter.pl")
    if not os.path.exists(mapping_config):
        mapping_config = os.path.abspath("app/services/scripts/mapping_config.json")
        
    logger.info(f"[{session_id}] Running universal_converter.pl (xhtml2xml)...")
    import subprocess
    cmd = [
        "perl",
        perl_script,
        "xhtml2xml",
        os.path.abspath(xhtml_path),
        os.path.abspath(mapping_config),
        os.path.abspath(output_xml_path)
    ]
    try:
        res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, check=True)
        logger.info(f"[{session_id}] Perl conversion completed: {res.stdout.strip()}")
    except subprocess.CalledProcessError as e:
        logger.error(f"[{session_id}] Perl conversion failed: {e.stderr}")
        raise HTTPException(status_code=500, detail=f"Perl conversion failed: {e.stderr}")

    if not os.path.exists(output_xml_path):
        raise HTTPException(status_code=500, detail="Output XML file was not generated by Perl script")

    # Run SpringerXMLProcessor.jsx (XML -> INDD/PDF)
    local_jsx = r"C:\Users\muraliba\Documents\SpringerXMLProcessor.jsx"
    if not os.path.exists(local_jsx):
        local_jsx = os.path.abspath("app/services/scripts/SpringerXMLProcessor.jsx")
    if not os.path.exists(local_jsx):
        raise HTTPException(status_code=500, detail=f"Local InDesign processor script missing: {local_jsx}")

    output_indd_path = os.path.join(temp_dir, f"{xml_basename}.indd")
    output_pdf_path = os.path.join(temp_dir, f"{xml_basename}.pdf")
    artwork_path = temp_dir

    try:
        import win32com.client
        import pythoncom
    except ImportError:
        raise HTTPException(status_code=500, detail="pywin32 is not installed on this server")

    pythoncom.CoInitialize()
    try:
        try:
            subprocess.run(["taskkill", "/F", "/IM", "InDesign.exe"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except Exception:
            pass

        logger.info(f"[{session_id}] Dispatching InDesign.Application...")
        indesign_app = win32com.client.Dispatch("InDesign.Application")
        
        try:
            indesign_app.DoScript("app.scriptPreferences.userInteractionLevel = UserInteractionLevels.NEVER_INTERACT;", 1246973031)
        except Exception as ui_ex:
            logger.warning(f"[{session_id}] Could not set userInteractionLevel: {str(ui_ex)}")

        logger.info(f"[{session_id}] Setting ScriptArgs for {local_jsx}...")
        indesign_app.ScriptArgs.SetValue("template_path", os.path.abspath(indt_path))
        indesign_app.ScriptArgs.SetValue("job_doc", os.path.abspath(output_indd_path))
        indesign_app.ScriptArgs.SetValue("pdf_path", os.path.abspath(output_pdf_path))
        indesign_app.ScriptArgs.SetValue("tokenid", session_id)
        indesign_app.ScriptArgs.SetValue("xml_path", os.path.abspath(output_xml_path))
        indesign_app.ScriptArgs.SetValue("artwork_path", os.path.abspath(artwork_path))

        logger.info(f"[{session_id}] Running ExtendScript JSX script directly: {local_jsx}...")
        indesign_app.DoScript(local_jsx, 1246973031)
        logger.info(f"[{session_id}] SpringerXMLProcessor.jsx completed execution.")

        try:
            while indesign_app.Documents.Count > 0:
                indesign_app.Documents.Item(1).Close(1852776783)
        except Exception:
            pass
    except Exception as indesign_err:
        logger.error(f"[{session_id}] InDesign processing failed: {str(indesign_err)}")
        raise HTTPException(status_code=500, detail=f"InDesign processing failed: {str(indesign_err)}")
    finally:
        pythoncom.CoUninitialize()

    # Run Springer_Finaxml.jsx on the newly generated INDD to extract final XML, XHTML, CSS, EPUB, and DOCX!
    jsx_script_final = r"C:\Users\muraliba\Documents\Springer_Finaxml.jsx"
    if not os.path.exists(jsx_script_final):
        jsx_script_final = os.path.abspath("app/services/scripts/Springer_Finaxml.jsx")
    if not os.path.exists(jsx_script_final):
        raise HTTPException(status_code=500, detail=f"Local InDesign export script missing: {jsx_script_final}")

    script_dir = os.path.dirname(jsx_script_final)
    log_path = os.path.join(script_dir, "finalxml", "finalxml.log")
    epub_log_path = os.path.join(script_dir, "epub", "epub.log")
    docx_output_path = os.path.join(temp_dir, f"{xml_basename}_final.docx")

    for p, name in [(log_path, "finalxml.log"), (epub_log_path, "epub.log"), (docx_output_path, f"{xml_basename}_final.docx")]:
        if os.path.exists(p):
            try:
                os.remove(p)
            except Exception as e:
                logger.warning(f"[{session_id}] Could not remove old {name}: {e}")

    pythoncom.CoInitialize()
    try:
        try:
            subprocess.run(["taskkill", "/F", "/IM", "InDesign.exe"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except Exception:
            pass

        indesign_app = win32com.client.Dispatch("InDesign.Application")
        try:
            indesign_app.DoScript("app.scriptPreferences.userInteractionLevel = UserInteractionLevels.NEVER_INTERACT;", 1246973031)
        except Exception:
            pass

        final_xml_path = os.path.join(temp_dir, f"{xml_basename}_final.xml")
        indesign_app.ScriptArgs.SetValue("InputFile", os.path.abspath(output_indd_path))
        indesign_app.ScriptArgs.SetValue("OutputFile", os.path.abspath(final_xml_path))

        logger.info(f"[{session_id}] Running {jsx_script_final} on the updated INDD...")
        args_final = [os.path.abspath(output_indd_path), os.path.abspath(final_xml_path)]
        indesign_app.DoScript(jsx_script_final, 1246973031, args_final)

        if log_path:
            logger.info(f"[{session_id}] Waiting for finalxml.bat...")
            start_wait = time.time()
            while time.time() - start_wait < 45:
                if os.path.exists(log_path):
                    try:
                        with open(log_path, "r") as lf:
                            lf.read()
                        break
                    except Exception:
                        pass
                time.sleep(0.5)

        if epub_log_path:
            logger.info(f"[{session_id}] Waiting for epub.bat...")
            start_wait = time.time()
            while time.time() - start_wait < 45:
                if os.path.exists(epub_log_path):
                    try:
                        with open(epub_log_path, "r") as lf:
                            lf.read()
                        break
                    except Exception:
                        pass
                time.sleep(0.5)

        if docx_output_path:
            logger.info(f"[{session_id}] Waiting for docx conversion...")
            start_wait = time.time()
            while time.time() - start_wait < 45:
                if os.path.exists(docx_output_path) and os.path.getsize(docx_output_path) > 0:
                    try:
                        with open(docx_output_path, "rb") as lf:
                            lf.read(100)
                        break
                    except Exception:
                        pass
                time.sleep(0.5)

        try:
            while indesign_app.Documents.Count > 0:
                indesign_app.Documents.Item(1).Close(1852776783)
        except Exception:
            pass
    except Exception as indesign_err:
        logger.error(f"[{session_id}] Final export run failed: {str(indesign_err)}")
        raise HTTPException(status_code=500, detail=f"Final export failed: {str(indesign_err)}")
    finally:
        pythoncom.CoUninitialize()

    expected_jsx_xml = os.path.join(temp_dir, f"{xml_basename}_finalxml.xml")
    if os.path.exists(expected_jsx_xml):
        try:
            if os.path.exists(final_xml_path):
                os.remove(final_xml_path)
            os.rename(expected_jsx_xml, final_xml_path)
        except Exception as rename_err:
            logger.warning(f"[{session_id}] Failed to rename finalxml output: {str(rename_err)}")

    out_zip_path = os.path.join(temp_dir, f"view_proof_output_{session_id}.zip")
    
    generated_pdf = None
    generated_xhtml = None
    generated_css = None
    generated_xml = final_xml_path if os.path.exists(final_xml_path) else None
    generated_epub = None
    generated_docx = docx_output_path if os.path.exists(docx_output_path) else None

    for root, _, filenames in os.walk(temp_dir):
        for fname in filenames:
            ext = os.path.splitext(fname)[1].lower()
            f_abs = os.path.abspath(os.path.join(root, fname))
            if ext == ".pdf":
                generated_pdf = f_abs
            elif ext == ".xhtml":
                generated_xhtml = f_abs
            elif ext == ".css":
                generated_css = f_abs
            elif ext == ".epub":
                generated_epub = f_abs
            elif ext == ".xml" and not generated_xml:
                # Fallback: pick up any .xml in temp dir if final_xml_path wasn't found earlier
                generated_xml = f_abs

    if not generated_pdf or not os.path.exists(generated_pdf):
        raise HTTPException(status_code=500, detail="Output PDF file was not created by InDesign.")
        
    try:
        with zipfile.ZipFile(out_zip_path, "w", zipfile.ZIP_DEFLATED) as out_zf:
            for root, _, filenames in os.walk(temp_dir):
                for fname in filenames:
                    if fname.startswith("~$") or fname.startswith(".") or fname.endswith(".zip"):
                        continue
                    ext = os.path.splitext(fname)[1].lower()
                    if ext in (".xml", ".epub", ".log", ".jpg", ".jpeg", ".docx", ".pdf", ".css", ".indd"):
                        f_abs = os.path.abspath(os.path.join(root, fname))
                        rel_path = os.path.relpath(f_abs, temp_dir)
                        try:
                            out_zf.write(f_abs, rel_path)
                            logger.info(f"[{session_id}] Zipped view_proof result file: {rel_path}")
                        except Exception as z_err:
                            logger.warning(f"[{session_id}] Skipping transient file {rel_path}: {z_err}")
                
        logger.info(f"[{session_id}] Packaged proof outputs successfully into {out_zip_path}")
    except Exception as zip_ex:
        logger.error(f"[{session_id}] Packaging proof outputs failed: {str(zip_ex)}")
        raise HTTPException(status_code=500, detail=f"Failed to package proof outputs: {str(zip_ex)}")

    from starlette.responses import FileResponse
    return FileResponse(out_zip_path, media_type="application/zip", filename="view_proof_output.zip")

@app.get("/health")
def health_check():
    return {"status": "healthy", "service": "indesign-to-word-converter", "log_file": log_file}


if __name__ == "__main__":
    logger.info(f"Starting InDesign Windows Conversion Server on port 5555...")
    logger.info(f"Logs are being written to: {log_file}")
    uvicorn.run(app, host="0.0.0.0", port=5555)
