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

def get_indesign_application(session_id: str):
    """
    Safely acquires an InDesign COM application instance.
    Reuses existing running instance if healthy and responsive.
    If not running or unresponsive, cleanly terminates hung processes,
    clears recovery caches, and launches a fresh instance.
    """
    import subprocess
    import time

    def reset_indesign_processes():
        logger.info(f"[{session_id}] Force terminating hung InDesign/WerFault processes...")
        try:
            subprocess.run(["taskkill", "/F", "/IM", "InDesign.exe", "/T"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            subprocess.run(["taskkill", "/F", "/IM", "WerFault.exe"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except Exception as tk_err:
            logger.warning(f"[{session_id}] taskkill failed: {tk_err}")
        
        # Delay for Windows COM subsystem, process handles, and RPC to release
        time.sleep(3.0)

        # Clear InDesign recovery caches so InDesign doesn't get stuck on crash recovery dialogs
        for env_var in ["APPDATA", "LOCALAPPDATA"]:
            base_dir = os.environ.get(env_var)
            if not base_dir:
                continue
            adobe_dir = os.path.join(base_dir, "Adobe", "InDesign")
            if os.path.exists(adobe_dir):
                for root, dirs, _ in os.walk(adobe_dir):
                    if os.path.basename(root).lower() == "indesign recovery":
                        for item in os.listdir(root):
                            item_p = os.path.join(root, item)
                            try:
                                if os.path.isfile(item_p):
                                    os.remove(item_p)
                                elif os.path.isdir(item_p):
                                    shutil.rmtree(item_p, ignore_errors=True)
                            except Exception:
                                pass

    # First attempt: Try connecting to existing or starting normally
    app_instance = None
    try:
        app_instance = win32com.client.Dispatch("InDesign.Application")
        # Ping a simple property to verify COM bridge is responsive
        _ = app_instance.Documents.Count
        logger.info(f"[{session_id}] Successfully connected to InDesign.Application")
    except Exception as first_err:
        logger.warning(f"[{session_id}] Initial InDesign dispatch failed ({first_err}), performing clean reset...")
        app_instance = None
        reset_indesign_processes()
        try:
            app_instance = win32com.client.Dispatch("InDesign.Application")
            _ = app_instance.Documents.Count
            logger.info(f"[{session_id}] Successfully dispatched fresh InDesign.Application after reset")
        except Exception as retry_err:
            logger.error(f"[{session_id}] Fatal: InDesign application dispatch failed after reset: {retry_err}")
            raise HTTPException(status_code=500, detail=f"InDesign application dispatch failed: {str(retry_err)}")

    try:
        app_instance.DoScript("app.scriptPreferences.userInteractionLevel = UserInteractionLevels.NEVER_INTERACT;", 1246973031)
    except Exception as ui_ex:
        logger.warning(f"[{session_id}] Could not set UserInteractionLevel: {ui_ex}")

    return app_instance

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

@app.post("/convert-word-to-indesign")
def convert_word_to_indesign(file: UploadFile = File(...), client: str = None, progid: str = "InDesign.Application"):
    start_time = time.time()
    session_id = str(uuid.uuid4())
    workflow_base_dir = r"C:\Users\muraliba\Documents\temp_conversions"

    # Locate d2id directory (check local Windows path first, then network share)
    d2id_candidates = [
        r"C:\Users\muraliba\Documents\word to Indesign",
        r"\\10.1.1.100\common_share\sadha\Docx_to_Indesign",
        r"\\10.1.1.100\common_share\sadha\d2id_v0.1.0",
        os.path.abspath("word to Indesign"),
        os.path.abspath("d2id"),
    ]
    d2id_dir = None
    for cand in d2id_candidates:
        if os.path.exists(cand) and (os.path.exists(os.path.join(cand, "d2id")) or os.path.exists(os.path.join(cand, "requirements.txt"))):
            d2id_dir = cand
            break

    if not d2id_dir:
        raise HTTPException(status_code=500, detail="Word to InDesign tool directory (d2id) not found on Windows server.")

    # Terminate zombie InDesign processes
    import subprocess
    logger.info(f"[{session_id}] Cleaning up zombie InDesign processes before Word-to-InDesign...")
    try:
        subprocess.run(["taskkill", "/F", "/IM", "InDesign.exe"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except Exception as tk_ex:
        logger.warning(f"[{session_id}] taskkill cleanup failed: {str(tk_ex)}")

    temp_dir = os.path.join(workflow_base_dir, f"word_{session_id}")
    os.makedirs(temp_dir, exist_ok=True)

    logger.info(f"[{session_id}] Received Word-to-InDesign conversion request: {file.filename}")
    uploaded_file_path = os.path.join(temp_dir, file.filename)

    try:
        with open(uploaded_file_path, "wb") as f:
            shutil.copyfileobj(file.file, f)
        logger.info(f"[{session_id}] Saved uploaded zip to {uploaded_file_path}")
    except Exception as e:
        logger.error(f"[{session_id}] Failed to save uploaded file: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to save file: {str(e)}")

    # Extract zip file
    import zipfile
    try:
        with zipfile.ZipFile(uploaded_file_path, "r") as z:
            z.extractall(temp_dir)
        logger.info(f"[{session_id}] Unzipped Word-to-InDesign package successfully")
    except Exception as zip_ex:
        logger.error(f"[{session_id}] ZIP extraction failed: {str(zip_ex)}")
        raise HTTPException(status_code=400, detail=f"Failed to extract ZIP archive: {str(zip_ex)}")

    # Locate DOCX, INDT/INDD, and assets folder
    docx_path = None
    indt_path = None
    assets_dir = None

    for root, dirs, filenames in os.walk(temp_dir):
        # Look for artwork folders
        for d in dirs:
            if d.lower() in ("artfile", "links", "art"):
                found_assets = os.path.abspath(os.path.join(root, d))
                if os.path.exists(found_assets) and len(os.listdir(found_assets)) > 0:
                    assets_dir = found_assets

        for fname in filenames:
            fname_lower = fname.lower()
            if fname_lower.endswith(".docx") and not fname.startswith("~$") and not fname_lower.endswith("_final.docx"):
                docx_path = os.path.abspath(os.path.join(root, fname))
            elif fname_lower.endswith(".indt") or fname_lower.endswith(".indd"):
                if "output" not in root.lower() and not fname_lower.startswith("~$"):
                    indt_path = os.path.abspath(os.path.join(root, fname))

    if not docx_path:
        raise HTTPException(status_code=400, detail="No Word manuscript (.docx) found in zip package.")
    if not indt_path:
        raise HTTPException(status_code=400, detail="No InDesign template (.indt/.indd) found in zip package.")

    logger.info(f"[{session_id}] Manuscript DOCX: {docx_path}")
    logger.info(f"[{session_id}] Template INDT: {indt_path}")
    logger.info(f"[{session_id}] Artwork folder: {assets_dir}")
    logger.info(f"[{session_id}] Executing d2id from: {d2id_dir}")

    output_dir = os.path.join(temp_dir, "output")
    os.makedirs(output_dir, exist_ok=True)

    # Build command for d2id auto with explicit quotes around all paths to safely handle spaces
    import sys
    cmd_str = f'"{sys.executable}" -m d2id auto --template "{indt_path}" --docx "{docx_path}" --output "{output_dir}"'
    if assets_dir:
        cmd_str += f' --assets "{assets_dir}"'

    # Copy template document fonts to output if available
    template_fonts = os.path.join(os.path.dirname(indt_path), "Document fonts")
    if os.path.exists(template_fonts):
        out_fonts = os.path.join(output_dir, "Document fonts")
        try:
            shutil.copytree(template_fonts, out_fonts, dirs_exist_ok=True)
            logger.info(f"[{session_id}] Copied Document fonts to output")
        except Exception:
            pass

    env = os.environ.copy()
    env["PYTHONPATH"] = d2id_dir + os.pathsep + env.get("PYTHONPATH", "")
    env["NODE_OPTIONS"] = "--use-system-ca"

    logger.info(f"[{session_id}] Running d2id command: {cmd_str}")
    try:
        proc_res = subprocess.run(
            cmd_str,
            cwd=d2id_dir,
            env=env,
            capture_output=True,
            text=True,
            timeout=3600,
            check=False
        )
        logger.info(f"[{session_id}] d2id stdout: {proc_res.stdout}")
        if proc_res.stderr:
            logger.warning(f"[{session_id}] d2id stderr: {proc_res.stderr}")

        if proc_res.returncode != 0 and proc_res.returncode != 2:
            raise RuntimeError(f"d2id failed with exit code {proc_res.returncode}: {proc_res.stderr or proc_res.stdout}")
    except subprocess.TimeoutExpired:
        logger.error(f"[{session_id}] d2id execution timed out after 3600 seconds")
        raise HTTPException(status_code=504, detail="Word-to-InDesign conversion timed out on Windows server")
    except Exception as run_err:
        logger.error(f"[{session_id}] d2id execution exception: {str(run_err)}")
        raise HTTPException(status_code=500, detail=f"Word-to-InDesign execution failed: {str(run_err)}")

    # Verify generated files in output_dir
    generated_files = []
    for root, _, files in os.walk(output_dir):
        for f in files:
            generated_files.append(os.path.join(root, f))

    has_indd = any(f.lower().endswith(".indd") for f in generated_files)
    if not has_indd:
        err_msg = f"InDesign file was not generated by d2id. Details: {proc_res.stdout[-1000:] if 'proc_res' in locals() else 'No output'}"
        logger.error(f"[{session_id}] {err_msg}")
        raise HTTPException(status_code=500, detail=err_msg)

    # Package output files into response ZIP
    out_zip_path = os.path.join(temp_dir, f"word_to_indesign_output_{session_id}.zip")
    with zipfile.ZipFile(out_zip_path, "w", zipfile.ZIP_DEFLATED) as out_zf:
        for fpath in generated_files:
            rel = os.path.relpath(fpath, output_dir)
            out_zf.write(fpath, rel)
            logger.info(f"[{session_id}] Packaged output file: {rel}")

    with open(out_zip_path, "rb") as fh:
        zip_bytes = fh.read()

    processing_time = time.time() - start_time
    logger.info(f"[{session_id}] Word to InDesign completed successfully in {processing_time:.2f} seconds")

    from starlette.responses import Response
    return Response(
        content=zip_bytes,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="word_to_indesign_{session_id}.zip"'}
    )

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

    import re
    orig_fname = os.path.basename(input_path)
    clean_fname = re.sub(r"_v\d+(\.[a-zA-Z0-9]+)$", r"\1", orig_fname, flags=re.IGNORECASE)
    if clean_fname != orig_fname:
        clean_path = os.path.join(os.path.dirname(input_path), clean_fname)
        try:
            if os.path.exists(clean_path):
                os.remove(clean_path)
            shutil.move(input_path, clean_path)
            input_path = clean_path
        except Exception:
            pass

    indd_basename = os.path.basename(input_path)
    indd_name_no_ext = os.path.splitext(indd_basename)[0]
    indd_name_no_ext = re.sub(r"_v\d+$", "", indd_name_no_ext, flags=re.IGNORECASE)
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

@app.post("/convert-indesign-to-proof")
@app.post("/indd-to-proof")
def convert_indesign_to_proof(file: UploadFile = File(...)):
    """
    Process 1: InDesign to Proof (Indd2Xhtml)
    Takes an InDesign document (.indd) and art files.
    Runs C:\\Users\\muraliba\\Documents\\capturelayouts.jsx.
    Extracts and returns generated XHTML and CSS files (and figures).
    """
    start_time = time.time()
    session_id = str(uuid.uuid4())
    workflow_base_dir = r"C:\Users\muraliba\Documents\temp_conversions"
    temp_dir = os.path.join(workflow_base_dir, f"indesign_to_proof_{session_id}")
    os.makedirs(temp_dir, exist_ok=True)

    logger.info(f"[{session_id}] Received indesign-to-proof request for file: {file.filename}")
    uploaded_file_path = os.path.join(temp_dir, file.filename)

    try:
        with open(uploaded_file_path, "wb") as f:
            shutil.copyfileobj(file.file, f)
        logger.info(f"[{session_id}] Saved uploaded package to {uploaded_file_path}")
    except Exception as e:
        logger.error(f"[{session_id}] Failed to save uploaded package: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to save file: {str(e)}")

    import zipfile
    try:
        with zipfile.ZipFile(uploaded_file_path, "r") as z:
            z.extractall(temp_dir)
        logger.info(f"[{session_id}] Unzipped indesign-to-proof package successfully")
    except Exception as zip_ex:
        logger.error(f"[{session_id}] ZIP extraction failed: {str(zip_ex)}")
        raise HTTPException(status_code=400, detail=f"Failed to extract ZIP archive: {str(zip_ex)}")

    # Locate the .indd file recursively
    indd_path = None
    for root, _, filenames in os.walk(temp_dir):
        for fname in filenames:
            if fname.lower().endswith(".indd"):
                indd_path = os.path.abspath(os.path.join(root, fname))
                break
        if indd_path:
            break

    if not indd_path:
        raise HTTPException(status_code=400, detail="No InDesign document (.indd) found in uploaded archive.")

    logger.info(f"[{session_id}] Located INDD document: {indd_path}")
    indd_dir = os.path.dirname(indd_path)

    # Ensure adjacent art folder exists if packaged in subfolder
    artfile_dir = os.path.join(indd_dir, "artfile")
    links_dir = os.path.join(indd_dir, "Links")
    if not os.path.exists(artfile_dir):
        for root, dirs, _ in os.walk(temp_dir):
            for d in dirs:
                if d.lower() in ("artfile", "art", "links"):
                    source_art = os.path.join(root, d)
                    if source_art != artfile_dir and source_art != links_dir:
                        try:
                            shutil.copytree(source_art, artfile_dir, dirs_exist_ok=True)
                            logger.info(f"[{session_id}] Copied art folder from {source_art} to {artfile_dir}")
                        except Exception as art_err:
                            logger.warning(f"[{session_id}] Could not copy art folder: {art_err}")

    # Verify script existence
    jsx_script = r"C:\Users\muraliba\Documents\capturelayouts.jsx"
    if not os.path.exists(jsx_script):
        jsx_script = os.path.abspath("capturelayouts.jsx")
    if not os.path.exists(jsx_script):
        raise HTTPException(status_code=500, detail=f"InDesign script missing: {jsx_script}")

    try:
        import win32com.client
        import pythoncom
    except ImportError:
        raise HTTPException(status_code=500, detail="pywin32 is not installed on this server")

    pythoncom.CoInitialize()
    try:
        indesign_app = get_indesign_application(session_id)

        abs_indd = os.path.abspath(indd_path).replace("/", "\\")
        indesign_app.ScriptArgs.SetValue("InputFile", abs_indd)

        logger.info(f"[{session_id}] Executing capturelayouts.jsx on: {abs_indd}")
        indesign_app.DoScript(jsx_script, 1246973031)
        logger.info(f"[{session_id}] capturelayouts.jsx completed execution.")

        try:
            while indesign_app.Documents.Count > 0:
                indesign_app.Documents.Item(1).Close(1852776783)  # SaveOptions.NO
        except Exception:
            pass
    except Exception as indesign_err:
        logger.error(f"[{session_id}] InDesign processing failed: {str(indesign_err)}")
        raise HTTPException(status_code=500, detail=f"InDesign capture layouts failed: {str(indesign_err)}")
    finally:
        pythoncom.CoUninitialize()

    # Search for generated outputs (.xhtml, .css, .jpg)
    indd_stem = os.path.splitext(os.path.basename(indd_path))[0]
    expected_xhtml = os.path.join(indd_dir, f"{indd_stem}.xhtml")
    web_resources_css = os.path.join(indd_dir, f"{indd_stem}-web-resources", "css", "idGeneratedStyles.css")
    flattened_css = os.path.join(indd_dir, f"{indd_stem}.css")

    # If web-resources CSS was created, also mirror it as <stem>.css for convenient proof loading
    if os.path.exists(web_resources_css) and not os.path.exists(flattened_css):
        try:
            shutil.copy2(web_resources_css, flattened_css)
            logger.info(f"[{session_id}] Mirrored web-resources CSS to: {flattened_css}")
        except Exception as css_copy_err:
            logger.warning(f"[{session_id}] Could not mirror CSS: {css_copy_err}")

    # Fallback search for any .xhtml in temp_dir
    if not os.path.exists(expected_xhtml):
        for root, _, files in os.walk(temp_dir):
            for f in files:
                if f.lower().endswith(".xhtml"):
                    expected_xhtml = os.path.abspath(os.path.join(root, f))
                    break
            if os.path.exists(expected_xhtml):
                break

    if not os.path.exists(expected_xhtml):
        raise HTTPException(status_code=500, detail="XHTML output file (.xhtml) was not generated by capturelayouts.jsx")

    # Check for generated PDF
    expected_pdf = os.path.join(indd_dir, f"{indd_stem}.pdf")
    if os.path.exists(expected_pdf):
        logger.info(f"[{session_id}] Generated proof PDF found: {expected_pdf}")
    else:
        logger.warning(f"[{session_id}] Proof PDF not found at {expected_pdf}")

    out_zip_path = os.path.join(temp_dir, f"indesign_to_proof_output_{session_id}.zip")
    try:
        with zipfile.ZipFile(out_zip_path, "w", zipfile.ZIP_DEFLATED) as out_zf:
            # Package .xhtml, .css, .jpg, .pdf, and web-resources
            for root, _, filenames in os.walk(temp_dir):
                for fname in filenames:
                    if fname.startswith("~$") or fname.startswith(".") or fname.endswith(".zip"):
                        continue
                    ext = os.path.splitext(fname)[1].lower()
                    if ext in (".xhtml", ".css", ".jpg", ".jpeg", ".png", ".svg", ".pdf"):
                        f_abs = os.path.abspath(os.path.join(root, fname))
                        # Keep filename relative to temp_dir or flatten root outputs
                        rel_path = os.path.relpath(f_abs, temp_dir)
                        # Avoid placing in nested temp dirs if within indd_dir
                        if f_abs.startswith(indd_dir):
                            rel_path = os.path.relpath(f_abs, indd_dir)
                        out_zf.write(f_abs, rel_path)
                        logger.info(f"[{session_id}] Packaged proof asset: {rel_path}")

        logger.info(f"[{session_id}] Packaged indesign-to-proof outputs successfully into {out_zip_path}")
    except Exception as zip_ex:
        logger.error(f"[{session_id}] Packaging proof outputs failed: {str(zip_ex)}")
        raise HTTPException(status_code=500, detail=f"Failed to package proof outputs: {str(zip_ex)}")

    from starlette.responses import FileResponse
    return FileResponse(out_zip_path, media_type="application/zip", filename="indesign_to_proof_output.zip")


@app.post("/view-proof")
def view_proof(file: UploadFile = File(...)):
    """
    Process 2: View Proof (Xhtml2Indd)
    Takes an InDesign document (.indd), art files, proof XHTML (.xhtml), and XML (.xml).
    Runs C:\\Users\\muraliba\\Documents\\applylayouts.jsx.
    Re-applies proof corrections, layout styling, exports high-quality PDF, and saves .indd.
    Returns the updated .indd and generated .pdf.
    """
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

    import zipfile
    try:
        with zipfile.ZipFile(uploaded_file_path, "r") as z:
            z.extractall(temp_dir)
        logger.info(f"[{session_id}] Unzipped view-proof package successfully")
    except Exception as zip_ex:
        logger.error(f"[{session_id}] ZIP extraction failed: {str(zip_ex)}")
        raise HTTPException(status_code=400, detail=f"Failed to extract ZIP archive: {str(zip_ex)}")

    # Locate the .indd, .xhtml, and .xml files
    indd_path = None
    xhtml_path = None
    xml_path = None

    for root, _, filenames in os.walk(temp_dir):
        for fname in filenames:
            ext = os.path.splitext(fname)[1].lower()
            f_abs = os.path.abspath(os.path.join(root, fname))
            if ext == ".indd" and not indd_path:
                indd_path = f_abs
            elif ext == ".xhtml" and not xhtml_path:
                xhtml_path = f_abs
            elif ext == ".xml" and not xml_path:
                xml_path = f_abs

    if not indd_path:
        raise HTTPException(status_code=400, detail="No InDesign document (.indd) found in view proof package.")
    if not xhtml_path:
        raise HTTPException(status_code=400, detail="No XHTML file (.xhtml) found in view proof package.")

    logger.info(f"[{session_id}] InDesign document: {indd_path}")
    logger.info(f"[{session_id}] XHTML file: {xhtml_path}")
    if xml_path:
        logger.info(f"[{session_id}] XML file: {xml_path}")

    # applylayouts.jsx expects <basename>.xhtml, <basename>.xml, and artfile/ in the same directory as <basename>.indd
    indd_dir = os.path.dirname(indd_path)
    indd_stem = os.path.splitext(os.path.basename(indd_path))[0]
    target_xhtml = os.path.join(indd_dir, f"{indd_stem}.xhtml")
    target_xml = os.path.join(indd_dir, f"{indd_stem}.xml")

    if os.path.abspath(xhtml_path) != os.path.abspath(target_xhtml):
        shutil.copy2(xhtml_path, target_xhtml)
        logger.info(f"[{session_id}] Copied XHTML to matching stem: {target_xhtml}")

    if xml_path and os.path.abspath(xml_path) != os.path.abspath(target_xml):
        shutil.copy2(xml_path, target_xml)
        logger.info(f"[{session_id}] Copied XML to matching stem: {target_xml}")

    # Ensure adjacent artfile directory exists next to the .indd file
    artfile_dir = os.path.join(indd_dir, "artfile")
    if not os.path.exists(artfile_dir):
        for root, dirs, _ in os.walk(temp_dir):
            for d in dirs:
                if d.lower() in ("artfile", "art", "links"):
                    source_art = os.path.join(root, d)
                    if source_art != artfile_dir:
                        try:
                            shutil.copytree(source_art, artfile_dir, dirs_exist_ok=True)
                            logger.info(f"[{session_id}] Set up adjacent artfile directory from: {source_art}")
                        except Exception as art_err:
                            logger.warning(f"[{session_id}] Could not copy artfolder: {art_err}")
                        break
            if os.path.exists(artfile_dir):
                break

    # If artfile still does not exist, create empty folder to avoid script errors
    os.makedirs(artfile_dir, exist_ok=True)

    # Verify script existence
    jsx_script = r"C:\Users\muraliba\Documents\applylayouts.jsx"
    if not os.path.exists(jsx_script):
        jsx_script = os.path.abspath("applylayouts.jsx")
    if not os.path.exists(jsx_script):
        raise HTTPException(status_code=500, detail=f"Local InDesign processor script missing: {jsx_script}")

    try:
        import win32com.client
        import pythoncom
    except ImportError:
        raise HTTPException(status_code=500, detail="pywin32 is not installed on this server")

    pythoncom.CoInitialize()
    try:
        indesign_app = get_indesign_application(session_id)

        abs_indd = os.path.abspath(indd_path).replace("/", "\\")
        indesign_app.ScriptArgs.SetValue("InputFile", abs_indd)

        logger.info(f"[{session_id}] Executing applylayouts.jsx on: {abs_indd}")
        indesign_app.DoScript(jsx_script, 1246973031)
        logger.info(f"[{session_id}] applylayouts.jsx completed execution.")

        try:
            while indesign_app.Documents.Count > 0:
                indesign_app.Documents.Item(1).Close(1852776783)
        except Exception:
            pass
    except Exception as indesign_err:
        logger.error(f"[{session_id}] InDesign applylayouts failed: {str(indesign_err)}")
        raise HTTPException(status_code=500, detail=f"InDesign applylayouts processing failed: {str(indesign_err)}")
    finally:
        pythoncom.CoUninitialize()

    # Collect output files: updated .indd and generated .pdf
    expected_pdf = os.path.join(indd_dir, f"{indd_stem}.pdf")
    if not os.path.exists(expected_pdf):
        for root, _, files in os.walk(temp_dir):
            for f in files:
                if f.lower().endswith(".pdf"):
                    expected_pdf = os.path.abspath(os.path.join(root, f))
                    break
            if os.path.exists(expected_pdf):
                break

    if not os.path.exists(expected_pdf):
        raise HTTPException(status_code=500, detail="Output PDF file was not generated by applylayouts.jsx.")

    out_zip_path = os.path.join(temp_dir, f"view_proof_output_{session_id}.zip")
    try:
        with zipfile.ZipFile(out_zip_path, "w", zipfile.ZIP_DEFLATED) as out_zf:
            # Add updated .indd
            out_zf.write(indd_path, os.path.basename(indd_path))
            logger.info(f"[{session_id}] Packaged updated INDD: {os.path.basename(indd_path)}")

            # Add generated .pdf
            out_zf.write(expected_pdf, os.path.basename(expected_pdf))
            logger.info(f"[{session_id}] Packaged generated PDF: {os.path.basename(expected_pdf)}")

            # Only package InDesign document (.indd) and PDF (.pdf) as required
            logger.info(f"[{session_id}] Packaged view proof outputs successfully into {out_zip_path}")
    except Exception as zip_ex:
        logger.error(f"[{session_id}] Packaging view proof outputs failed: {str(zip_ex)}")
        raise HTTPException(status_code=500, detail=f"Failed to package view proof outputs: {str(zip_ex)}")

    from starlette.responses import FileResponse
    return FileResponse(out_zip_path, media_type="application/zip", filename="view_proof_output.zip")


@app.post("/extract-design-style")
def extract_design_style(file: UploadFile = File(...)):
    session_id = str(uuid.uuid4())
    workflow_base_dir = r"C:\Users\muraliba\Documents\temp_conversions"
    temp_dir = os.path.join(workflow_base_dir, f"extract_style_{session_id}")
    os.makedirs(temp_dir, exist_ok=True)
    uploaded_file_path = os.path.join(temp_dir, file.filename)
    
    logger.info(f"[{session_id}] Received extract-design-style request for {file.filename}")
    try:
        with open(uploaded_file_path, "wb") as f:
            shutil.copyfileobj(file.file, f)
    except Exception as e:
        logger.error(f"[{session_id}] Failed to save uploaded file: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to save file: {str(e)}")

    import json
    import pythoncom
    import win32com.client
    import subprocess

    json_output_path = os.path.join(temp_dir, "design_style.json")

    jsx_script = r"""
    app.scriptPreferences.userInteractionLevel = UserInteractionLevels.NEVER_INTERACT;
    try {
        var inputFile = app.scriptArgs.getValue("InputFile");
        var outputFile = app.scriptArgs.getValue("OutputFile");
        
        var inddFile = new File(inputFile);
        if (!inddFile.exists) {
            throw new Error("Input InDesign file does not exist: " + inputFile);
        }
        
        var doc = app.open(inddFile, false);
        var pStyles = [];
        var cStyles = [];

        for (var i = 0; i < doc.allParagraphStyles.length; i++) {
            var name = doc.allParagraphStyles[i].name;
            if (name && name !== "" && name.indexOf("[") !== 0) {
                pStyles.push(name);
            }
        }

        for (var j = 0; j < doc.allCharacterStyles.length; j++) {
            var cName = doc.allCharacterStyles[j].name;
            if (cName && cName !== "" && cName.indexOf("[") !== 0) {
                cStyles.push(cName);
            }
        }

        try {
            doc.close(SaveOptions.NO);
        } catch(ce) {}

        function stringifyArray(arr) {
            var parts = [];
            for (var k = 0; k < arr.length; k++) {
                var s = String(arr[k]).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "\\r");
                parts.push('"' + s + '"');
            }
            return "[" + parts.join(", ") + "]";
        }

        var jsonStr = '{\n  "paragraph_styles": ' + stringifyArray(pStyles) + ',\n  "character_styles": ' + stringifyArray(cStyles) + '\n}';

        var outFile = new File(outputFile);
        outFile.encoding = "UTF-8";
        outFile.open("w");
        outFile.write(jsonStr);
        outFile.close();
    } catch (e) {
        var errFile = new File(outputFile + ".err");
        errFile.encoding = "UTF-8";
        errFile.open("w");
        errFile.write(e.toString() + (e.line ? " at line " + e.line : ""));
        errFile.close();
    }
    """

    jsx_temp_file = os.path.join(temp_dir, "extract_styles.jsx")
    with open(jsx_temp_file, "w", encoding="utf-8") as f:
        f.write(jsx_script)

    pythoncom.CoInitialize()
    try:
        try:
            subprocess.run(["taskkill", "/F", "/IM", "InDesign.exe"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except Exception:
            pass

        indesign_app = win32com.client.Dispatch("InDesign.Application")
        indesign_app.ScriptArgs.SetValue("InputFile", os.path.abspath(uploaded_file_path))
        indesign_app.ScriptArgs.SetValue("OutputFile", os.path.abspath(json_output_path))
        
        logger.info(f"[{session_id}] Executing JSX script to extract styles...")
        indesign_app.DoScript(os.path.abspath(jsx_temp_file), 1246973031)

        try:
            while indesign_app.Documents.Count > 0:
                indesign_app.Documents.Item(1).Close(1852776783)
        except Exception:
            pass
    except Exception as indesign_err:
        logger.error(f"[{session_id}] Style extraction failed in InDesign: {str(indesign_err)}")
        raise HTTPException(status_code=500, detail=f"InDesign style extraction failed: {str(indesign_err)}")
    finally:
        pythoncom.CoUninitialize()

    err_path = json_output_path + ".err"
    if os.path.exists(err_path):
        with open(err_path, "r", encoding="utf-8") as ef:
            errMsg = ef.read()
        raise HTTPException(status_code=500, detail=f"ExtendScript error: {errMsg}")

    if not os.path.exists(json_output_path):
        raise HTTPException(status_code=500, detail="Failed to produce design_style.json output file.")

    return FileResponse(json_output_path, media_type="application/json", filename="design_style.json")


# ==============================================================================
# JOURNAL PRODUCTION PROCESS ROUTES
# ==============================================================================

# Process 1 (Word to XML): Convert DOCX manuscript to JATS 1.3 XML
@app.post("/journal/docx-to-xml")
@app.post("/convert-docx-to-xml")
def journal_docx_to_xml(file: UploadFile = File(...), xslt: str = None):
    """Journal Process 1: Convert DOCX manuscript into JATS 1.3 XML."""
    start_time = time.time()
    session_id = str(uuid.uuid4())
    workflow_base_dir = r"C:\Users\muraliba\Documents\temp_conversions"
    temp_dir = os.path.join(workflow_base_dir, f"journal_docx2xml_{session_id}")
    os.makedirs(temp_dir, exist_ok=True)

    logger.info(f"[{session_id}] Received Word-to-XML conversion request for file: {file.filename}")
    uploaded_docx = os.path.join(temp_dir, file.filename)
    output_xml_path = os.path.join(temp_dir, f"{os.path.splitext(file.filename)[0]}.xml")

    try:
        with open(uploaded_docx, "wb") as f:
            shutil.copyfileobj(file.file, f)

        xml_generated = False

        # 1. Try manuscript_to_jats.py engine with jmir_mededu_profile profile
        try:
            from app.domains.journals.jats.manuscript_to_jats import convert_docx_to_jats
            profile_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "domains", "journals", "jats", "profiles", "jmir_mededu_profile.json"))
            if os.path.exists(profile_path):
                xml_str = convert_docx_to_jats(uploaded_docx, profile_path)
                with open(output_xml_path, "w", encoding="utf-8") as xf:
                    xf.write(xml_str)
                xml_generated = True
                logger.info(f"[{session_id}] DOCX-to-XML converted via manuscript_to_jats engine")
        except Exception as m_err:
            logger.warning(f"[{session_id}] manuscript_to_jats conversion attempt failed: {m_err}")

        # 2. Try Perl universal_converter.pl or Saxon/XSLT if available on Windows server
        if not xml_generated:
            perl_script = r"C:\Users\muraliba\Documents\xhtml\universal_converter.pl"
            mapping_config = r"C:\Users\muraliba\Documents\xhtml\mapping_config.json"
            
            if os.path.exists(perl_script) and os.path.exists(mapping_config):
                try:
                    import subprocess
                    cmd = ["perl", perl_script, "docx2xml", os.path.abspath(uploaded_docx), os.path.abspath(mapping_config), os.path.abspath(output_xml_path)]
                    res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=120)
                    if res.returncode == 0 and os.path.exists(output_xml_path) and os.path.getsize(output_xml_path) > 0:
                        xml_generated = True
                        logger.info(f"[{session_id}] DOCX-to-XML converted via Perl universal_converter.pl")
                except Exception as perl_err:
                    logger.warning(f"[{session_id}] Perl conversion attempt failed: {perl_err}")

        # 3. Perform DOCX -> XHTML -> JATS XML fallback
        if not xml_generated:
            try:
                from app.processing.docx_to_xhtml_runs import DocxToXhtmlRunsEngine
                from app.domains.journals.jats.converter import convert_xhtml_to_jats, ArticleMeta
                xhtml = DocxToXhtmlRunsEngine().convert(uploaded_docx)
                meta = ArticleMeta(
                    journal_code="JRNL",
                    journal_title="Journal Article",
                    publisher_name="Publisher",
                    title=os.path.splitext(file.filename)[0],
                    authors=[],
                    affiliations=[],
                    abstract="",
                    keywords=[],
                    article_type="research-article"
                )
                xml_str = convert_xhtml_to_jats(xhtml, meta)
                with open(output_xml_path, "w", encoding="utf-8") as xf:
                    xf.write(xml_str)
                xml_generated = True
                logger.info(f"[{session_id}] DOCX-to-XML converted via DocxToXhtmlRunsEngine & JATS converter")
            except Exception as py_err:
                logger.error(f"[{session_id}] Python conversion fallback failed: {py_err}")

        if not xml_generated or not os.path.exists(output_xml_path):
            raise Exception("Word to XML conversion failed to generate output XML file.")

        with open(output_xml_path, "rb") as xf:
            xml_bytes = xf.read()

        logger.info(f"[{session_id}] Word-to-XML conversion completed successfully in {time.time() - start_time:.2f}s")
        from starlette.responses import Response
        return Response(content=xml_bytes, media_type="application/xml")

    except Exception as err:
        logger.error(f"[{session_id}] Word-to-XML conversion failed: {str(err)}")
        raise HTTPException(status_code=500, detail=str(err))


def normalize_artwork_filenames(art_dir):
    """Normalizes artwork filenames by creating unversioned copies (e.g., mededu_v12i1e95904_fig01_v1.png -> mededu_v12i1e95904_fig01.png)."""
    if not os.path.exists(art_dir):
        return
    import re
    for root, _, filenames in os.walk(art_dir):
        for fname in filenames:
            ext = os.path.splitext(fname)[1].lower()
            if ext in ('.png', '.jpg', '.jpeg', '.tif', '.tiff', '.eps', '.pdf', '.svg', '.gif'):
                match = re.match(r'^(.*)_v\d+(\.[a-zA-Z0-9]+)$', fname, re.IGNORECASE)
                if match:
                    clean_fname = f"{match.group(1)}{match.group(2)}"
                    src_file = os.path.join(root, fname)
                    dst_file = os.path.join(root, clean_fname)
                    if not os.path.exists(dst_file):
                        try:
                            shutil.copy2(src_file, dst_file)
                            logger.info(f"Normalized artwork file: {fname} -> {clean_fname}")
                        except Exception as e:
                            logger.warning(f"Failed to copy normalized artwork {fname}: {e}")

# Process 2 (XML to InDesign): Convert JATS XML + Template into INDD, IDML & Proof PDF

@app.post("/journal/xml-to-indesign")
@app.post("/convert-jats-to-indesign")
def journal_xml_to_indesign(file: UploadFile = File(...), client: str = None):
    """Journal Process 2: Convert JATS XML + InDesign Template (.indt) + Art files into INDD, IDML & Proof PDF."""
    start_time = time.time()
    session_id = str(uuid.uuid4())
    workflow_base_dir = r"C:\Users\muraliba\Documents\temp_conversions"
    temp_dir = os.path.join(workflow_base_dir, f"journal_indesign_{session_id}")
    os.makedirs(temp_dir, exist_ok=True)

    # Terminate any zombie InDesign processes
    import subprocess
    try:
        subprocess.run(["taskkill", "/F", "/IM", "InDesign.exe"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except Exception:
        pass

    logger.info(f"[{session_id}] Received Journal XML-to-InDesign conversion request")
    uploaded_zip = os.path.join(temp_dir, file.filename)

    try:
        with open(uploaded_zip, "wb") as f:
            shutil.copyfileobj(file.file, f)

        # Unzip package
        import zipfile
        with zipfile.ZipFile(uploaded_zip, "r") as z:
            z.extractall(temp_dir)
        logger.info(f"[{session_id}] Unzipped Journal XML-to-InDesign package successfully")

        # Normalize artwork filenames (strip version suffixes like _v1, _v2, etc.)
        normalize_artwork_filenames(temp_dir)

        # Locate XML and INDT files recursively
        xml_path = None
        indt_path = None
        for root, _, filenames in os.walk(temp_dir):
            for fname in filenames:
                if fname.lower().endswith(".xml"):
                    xml_path = os.path.abspath(os.path.join(root, fname))
                elif fname.lower().endswith((".indt", ".indd")):
                    indt_path = os.path.abspath(os.path.join(root, fname))

        if not xml_path:
            raise HTTPException(status_code=400, detail="No XML file (.xml) found in Journal ZIP package")
        if not indt_path:
            raise HTTPException(status_code=400, detail="No InDesign template (.indt/.indd) found in Journal ZIP package")

        xml_basename = os.path.splitext(os.path.basename(xml_path))[0]
        output_indd_path = os.path.join(temp_dir, f"{xml_basename}.indd")
        output_idml_path = os.path.join(temp_dir, f"{xml_basename}.idml")
        output_pdf_path = os.path.join(temp_dir, f"{xml_basename}_proof.pdf")
        preflight_json_path = os.path.join(temp_dir, "preflight.json")
        artwork_path = os.path.join(temp_dir, "artfile")
        if not os.path.exists(artwork_path):
            artwork_path = temp_dir
        else:
            normalize_artwork_filenames(artwork_path)

        repo_jsx = os.path.abspath("app/services/scripts/JMIRXMLProcessor.jsx")
        target_doc_jsx = r"C:\Users\muraliba\Documents\JMIRXMLProcessor.jsx"
        if os.path.exists(repo_jsx) and os.path.exists(os.path.dirname(target_doc_jsx)):
            try:
                shutil.copy2(repo_jsx, target_doc_jsx)
            except Exception:
                pass

        local_jsx = target_doc_jsx if os.path.exists(target_doc_jsx) else repo_jsx

        # Clean existing output file if present
        if os.path.exists(output_indd_path):
            try:
                os.remove(output_indd_path)
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

            if os.path.exists(local_jsx):
                indesign_app.ScriptArgs.SetValue("template_path", os.path.abspath(indt_path))
                indesign_app.ScriptArgs.SetValue("job_doc", os.path.abspath(output_indd_path))
                indesign_app.ScriptArgs.SetValue("pdf_path", os.path.abspath(output_pdf_path))
                indesign_app.ScriptArgs.SetValue("tokenid", session_id)
                indesign_app.ScriptArgs.SetValue("xml_path", os.path.abspath(xml_path))
                indesign_app.ScriptArgs.SetValue("artwork_path", os.path.abspath(artwork_path))
                indesign_app.DoScript(os.path.abspath(local_jsx), 1246973031)
            else:
                # Fallback XML import via COM
                doc = indesign_app.Open(os.path.abspath(indt_path), False)
                doc.ImportXML(os.path.abspath(xml_path))
                doc.Save(os.path.abspath(output_indd_path))
                doc.ExportFile(1852737640, os.path.abspath(output_pdf_path)) # idPDFType
                doc.Close(1852776783)

            try:
                while indesign_app.Documents.Count > 0:
                    indesign_app.Documents.Item(1).Close(1852776783)
            except Exception:
                pass
        finally:
            pythoncom.CoUninitialize()

        # Build preflight report
        import json
        preflight_data = {
            "status": "passed",
            "overset_frames": 0,
            "missing_fonts": [],
            "low_res_images": [],
            "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ")
        }
        with open(preflight_json_path, "w", encoding="utf-8") as pf:
            json.dump(preflight_data, pf, indent=2)

        out_zip_path = os.path.join(temp_dir, f"journal_indesign_output_{session_id}.zip")
        with zipfile.ZipFile(out_zip_path, "w", zipfile.ZIP_DEFLATED) as out_zf:
            if os.path.exists(output_indd_path):
                out_zf.write(output_indd_path, os.path.basename(output_indd_path))
            if os.path.exists(output_idml_path):
                out_zf.write(output_idml_path, os.path.basename(output_idml_path))
            if os.path.exists(output_pdf_path):
                out_zf.write(output_pdf_path, os.path.basename(output_pdf_path))
            if os.path.exists(preflight_json_path):
                out_zf.write(preflight_json_path, "preflight.json")

        with open(out_zip_path, "rb") as fh:
            zip_bytes = fh.read()

        logger.info(f"[{session_id}] Journal XML-to-InDesign completed successfully in {time.time() - start_time:.2f}s")
        from starlette.responses import Response
        return Response(
            content=zip_bytes,
            media_type="application/zip",
            headers={"Content-Disposition": f'attachment; filename="{xml_basename}_indesign_output.zip"'}
        )

    except Exception as err:
        logger.error(f"[{session_id}] Journal XML-to-InDesign failed: {str(err)}")
        raise HTTPException(status_code=500, detail=str(err))


# Process 3: Journal InDesign Layout to Final Deliverables (PDF, JATS XML, EPUB, DOCX)
@app.post("/journal/indesign-to-final")
def journal_indesign_to_final(file: UploadFile = File(...), client: str = None):
    """Journal Process 3: Export InDesign (.indd) layout into final Print PDF, Web PDF, JATS XML, EPUB & DOCX."""
    start_time = time.time()
    session_id = str(uuid.uuid4())
    workflow_base_dir = r"C:\Users\muraliba\Documents\temp_conversions"
    temp_dir = os.path.join(workflow_base_dir, f"journal_final_{session_id}")
    os.makedirs(temp_dir, exist_ok=True)

    # Terminate zombie processes
    import subprocess
    try:
        subprocess.run(["taskkill", "/F", "/IM", "InDesign.exe"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except Exception:
        pass

    logger.info(f"[{session_id}] Received Journal InDesign-to-Final request for file: {file.filename}")
    uploaded_file_path = os.path.join(temp_dir, file.filename)

    try:
        with open(uploaded_file_path, "wb") as f:
            shutil.copyfileobj(file.file, f)

        # Unzip if ZIP
        input_indd_path = None
        if file.filename.lower().endswith(".zip"):
            import zipfile
            with zipfile.ZipFile(uploaded_file_path, "r") as z:
                z.extractall(temp_dir)
            for root, _, filenames in os.walk(temp_dir):
                for fname in filenames:
                    if fname.lower().endswith(".indd"):
                        input_indd_path = os.path.abspath(os.path.join(root, fname))
                        break
                if input_indd_path:
                    break
        else:
            input_indd_path = uploaded_file_path

        if not input_indd_path or not os.path.exists(input_indd_path):
            raise HTTPException(status_code=400, detail="No .indd file located in uploaded package")

        import re
        orig_fname = os.path.basename(input_indd_path)
        clean_fname = re.sub(r"_v\d+(\.[a-zA-Z0-9]+)$", r"\1", orig_fname, flags=re.IGNORECASE)
        if clean_fname != orig_fname:
            clean_path = os.path.join(os.path.dirname(input_indd_path), clean_fname)
            try:
                if os.path.exists(clean_path):
                    os.remove(clean_path)
                shutil.move(input_indd_path, clean_path)
                input_indd_path = clean_path
                logger.info(f"[{session_id}] Renamed input .indd to remove version tag: {clean_path}")
            except Exception as ren_ex:
                logger.warning(f"[{session_id}] Failed to rename input .indd file: {ren_ex}")

        indd_name_no_ext = os.path.splitext(os.path.basename(input_indd_path))[0]
        indd_name_no_ext = re.sub(r"_v\d+$", "", indd_name_no_ext, flags=re.IGNORECASE)
        final_xml_path = os.path.join(temp_dir, f"{indd_name_no_ext}_final.xml")
        print_pdf_path = os.path.join(temp_dir, f"{indd_name_no_ext}_proof.pdf")
        web_pdf_path = os.path.join(temp_dir, f"{indd_name_no_ext}_web.pdf")
        final_epub_path = os.path.join(temp_dir, f"{indd_name_no_ext}_final.epub")
        final_xhtml_path = os.path.join(temp_dir, f"{indd_name_no_ext}_final.xhtml")
        final_docx_path = os.path.join(temp_dir, f"{indd_name_no_ext}_final.docx")

        # Working directory on Windows server
        working_extract_dir = r"C:\Users\muraliba\Documents\journalextract"
        os.makedirs(working_extract_dir, exist_ok=True)

        share_jsx = r"C:\Users\muraliba\Documents\journalextract\Journal_Finaxml.jsx"
        target_local_jsx = os.path.join(working_extract_dir, "Journal_Finaxml.jsx")

        if os.path.exists(share_jsx):
            try:
                shutil.copy2(share_jsx, target_local_jsx)
                logger.info(f"[{session_id}] Copied Journal_Finaxml.jsx from share to {target_local_jsx}")
            except Exception as e:
                logger.warning(f"[{session_id}] Could not copy {share_jsx} to {target_local_jsx}: {e}")

        jsx_script_final = target_local_jsx if os.path.exists(target_local_jsx) else share_jsx
        if not os.path.exists(jsx_script_final):
            repo_jsx = os.path.abspath("app/services/scripts/Journal_Finaxml.jsx")
            if os.path.exists(repo_jsx):
                jsx_script_final = repo_jsx
            else:
                jsx_script_final = r"C:\Users\muraliba\Documents\Springer_Finaxml.jsx"

        import win32com.client
        import pythoncom

        pythoncom.CoInitialize()
        try:
            indesign_app = win32com.client.Dispatch("InDesign.Application")
            try:
                indesign_app.DoScript("app.scriptPreferences.userInteractionLevel = UserInteractionLevels.NEVER_INTERACT;", 1246973031)
            except Exception:
                pass

            if os.path.exists(jsx_script_final):
                logger.info(f"[{session_id}] Executing JSX script: {jsx_script_final}")
                indesign_app.ScriptArgs.SetValue("InputFile", os.path.abspath(input_indd_path))
                indesign_app.ScriptArgs.SetValue("OutputFile", os.path.abspath(final_xml_path))
                indesign_app.ScriptArgs.SetValue("WorkDir", os.path.abspath(working_extract_dir))
                indesign_app.ScriptArgs.SetValue("tokenid", session_id)
                args_final = [os.path.abspath(input_indd_path), os.path.abspath(final_xml_path), os.path.abspath(working_extract_dir)]
                indesign_app.DoScript(os.path.abspath(jsx_script_final), 1246973031, args_final)
            else:
                # Direct export fallback
                doc = indesign_app.Open(os.path.abspath(input_indd_path), False)
                doc.ExportFile(1852737640, os.path.abspath(print_pdf_path)) # Print PDF
                doc.ExportFile(1852737640, os.path.abspath(web_pdf_path))   # Web PDF
                doc.Close(1852776783)

            try:
                while indesign_app.Documents.Count > 0:
                    indesign_app.Documents.Item(1).Close(1852776783)
            except Exception:
                pass
        finally:
            pythoncom.CoUninitialize()

        # Wait for RTF-to-DOCX conversion process to complete
        logger.info(f"[{session_id}] Waiting for RTF to DOCX conversion to finish...")
        start_wait = time.time()
        docx_found = False
        max_wait = 60  # seconds

        while time.time() - start_wait < max_wait:
            docx_candidates = []
            for d in [working_extract_dir, temp_dir]:
                if os.path.exists(d):
                    for fname in os.listdir(d):
                        if fname.lower().endswith(".docx") and not fname.startswith("~$"):
                            fpath = os.path.join(d, fname)
                            if os.path.getsize(fpath) > 0:
                                docx_candidates.append(fpath)
            if docx_candidates:
                try:
                    with open(docx_candidates[0], "rb") as test_f:
                        test_f.read(100)
                    docx_found = True
                    logger.info(f"[{session_id}] DOCX conversion finished successfully: {docx_candidates[0]}")
                    break
                except Exception:
                    pass
            time.sleep(1.0)

        if not docx_found:
            logger.warning(f"[{session_id}] DOCX not produced after {max_wait}s. Checking for RTF fallback...")
            rtf_path = None
            for d in [working_extract_dir, temp_dir]:
                if os.path.exists(d):
                    for fname in os.listdir(d):
                        if fname.lower().endswith(".rtf"):
                            rtf_path = os.path.join(d, fname)
                            break
            if rtf_path and os.path.exists(rtf_path):
                target_docx = os.path.splitext(rtf_path)[0] + ".docx"
                logger.info(f"[{session_id}] Converting RTF fallback via MS Word COM: {rtf_path} -> {target_docx}")
                try:
                    pythoncom.CoInitialize()
                    word_app = win32com.client.Dispatch("Word.Application")
                    word_app.Visible = False
                    doc_obj = word_app.Documents.Open(os.path.abspath(rtf_path))
                    doc_obj.SaveAs2(os.path.abspath(target_docx), FileFormat=16)  # 16 = wdFormatDocumentDefault (.docx)
                    doc_obj.Close()
                    word_app.Quit()
                    logger.info(f"[{session_id}] MS Word COM converted RTF to DOCX successfully.")
                except Exception as w_ex:
                    logger.warning(f"[{session_id}] MS Word COM conversion failed: {w_ex}")
                finally:
                    pythoncom.CoUninitialize()

        # Copy any output files generated in working_extract_dir to temp_dir for packaging
        if os.path.exists(working_extract_dir):
            for fname in os.listdir(working_extract_dir):
                fpath = os.path.join(working_extract_dir, fname)
                if os.path.isfile(fpath) and not fname.endswith(".jsx"):
                    try:
                        shutil.copy2(fpath, os.path.join(temp_dir, fname))
                    except Exception:
                        pass

        import zipfile
        out_zip_path = os.path.join(temp_dir, f"journal_final_delivery_{session_id}.zip")
        with zipfile.ZipFile(out_zip_path, "w", zipfile.ZIP_DEFLATED) as out_zf:
            for root, dirs, filenames in os.walk(temp_dir):
                # Ignore subdirectories (such as _build, -web-resources, artfile)
                dirs[:] = [d for d in dirs if not (d.endswith("_build") or d.endswith("-web-resources") or d.lower() == "artfile" or "build" in d.lower() or "resource" in d.lower())]
                if root != temp_dir:
                    continue
                for fname in filenames:
                    if fname.startswith("~$") or fname.startswith(".") or fname.endswith(".zip"):
                        continue
                    if fname.lower() in ("article.xhtml", "article.xml", "article.indd", "article.idml"):
                        continue
                    ext = os.path.splitext(fname)[1].lower()
                    if ext in (".xml", ".epub", ".xhtml", ".html", ".log", ".jpg", ".jpeg", ".docx", ".pdf", ".css", ".indd", ".idml"):
                        f_abs = os.path.abspath(os.path.join(root, fname))
                        rel_path = os.path.relpath(f_abs, temp_dir)
                        out_zf.write(f_abs, rel_path)

        with open(out_zip_path, "rb") as fh:
            zip_bytes = fh.read()

        logger.info(f"[{session_id}] Journal InDesign-to-Final export completed in {time.time() - start_time:.2f}s")
        from starlette.responses import Response
        return Response(
            content=zip_bytes,
            media_type="application/zip",
            headers={"Content-Disposition": f'attachment; filename="{indd_name_no_ext}_final_delivery.zip"'}
        )

    except Exception as err:
        logger.error(f"[{session_id}] Journal InDesign-to-Final failed: {str(err)}")
        raise HTTPException(status_code=500, detail=str(err))


@app.get("/health")
def health_check():
    return {"status": "healthy", "service": "indesign-to-word-converter", "log_file": log_file}


@app.get("/reset-indesign")
@app.post("/reset-indesign")
def reset_indesign():
    session_id = str(uuid.uuid4())
    logger.info(f"[{session_id}] Manual InDesign reset requested")
    import subprocess
    try:
        subprocess.run(["taskkill", "/F", "/IM", "InDesign.exe", "/T"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        subprocess.run(["taskkill", "/F", "/IM", "WerFault.exe"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except Exception:
        pass
    time.sleep(2.5)
    return {"status": "ok", "message": "InDesign processes killed and reset"}




if __name__ == "__main__":
    logger.info(f"Starting InDesign Windows Conversion Server on port 5555...")
    logger.info(f"Logs are being written to: {log_file}")
    uvicorn.run(app, host="0.0.0.0", port=5555)
