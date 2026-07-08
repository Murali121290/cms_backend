import os
import sys
import uuid
import logging
import shutil
import time
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
    
    if (outLower.indexOf(".pdf") !== -1) {
        format = ExportFormat.PDF_TYPE;
    } else if (outLower.indexOf(".txt") !== -1) {
        format = ExportFormat.TXT;
    } else if (outLower.indexOf(".xml") !== -1) {
        format = ExportFormat.XML;
    }

    var outFile = new File(outputFile);

    if (format === ExportFormat.RTF || format === ExportFormat.TXT) {
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
    throw err;
}
"""

def get_jsx_script_path():
    # If the user has a custom script environment variable configured, use it!
    custom_script = os.environ.get("INDESIGN_SCRIPT_PATH", "").strip()
    if custom_script and os.path.exists(custom_script):
        return os.path.abspath(custom_script)
        
    # Auto-detect if user has the script in Documents or Downloads
    for auto_script in [
        r"C:\Users\muraliba\Documents\TextExtraction.jsxbin",
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
def convert_indd_to_docx(file: UploadFile = File(...)):
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
        
        # Disable dialog popups to prevent headless server hangs
        try:
            try:
                from win32com.client import constants
                indesign_app.ScriptPreferences.UserInteractionLevel = constants.idNeverInteract
            except Exception:
                indesign_app.ScriptPreferences.UserInteractionLevel = 1698829123 # idNeverInteract
        except Exception as ui_ex:
            logger.warning(f"[{session_id}] Could not set UserInteractionLevel: {str(ui_ex)}")
        
        # Pass file parameters via ScriptArgs (both app.ScriptArgs and arguments array)
        indesign_app.ScriptArgs.SetValue("InputFile", os.path.abspath(input_path))
        indesign_app.ScriptArgs.SetValue("OutputFile", os.path.abspath(output_rtf_path))
        
        # Open document first to support scripts (like TextExtraction.jsxbin) that expect an open document
        opened_doc = None
        try:
            logger.info(f"[{session_id}] Pre-opening InDesign document...")
            opened_doc = indesign_app.Open(os.path.abspath(input_path), False)
        except Exception as open_ex:
            logger.warning(f"[{session_id}] Could not pre-open document in InDesign COM: {str(open_ex)}")
            
        jsx_script = get_jsx_script_path()
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
        
        # 3. Open Word via COM Automation to convert RTF to DOCX
        logger.info(f"[{session_id}] Dispatching Word.Application...")
        word_app = win32com.client.Dispatch("Word.Application")
        word_app.Visible = False
        
        doc = word_app.Documents.Open(os.path.abspath(output_rtf_path))
        # 16 is wdFormatXMLDocument (.docx format)
        doc.SaveAs2(os.path.abspath(output_docx_path), FileFormat=16)
        doc.Close()
        word_app.Quit()
        
        if not os.path.exists(output_docx_path):
            raise Exception("Word conversion finished, but output DOCX was not found.")
            
        processing_time = time.time() - start_time
        logger.info(f"[{session_id}] Conversion completed successfully in {processing_time:.2f} seconds. Output: {output_docx_path}")
        
        # Return converted DOCX
        return FileResponse(
            path=output_docx_path,
            filename=f"{os.path.splitext(file.filename)[0]}.docx",
            media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document"
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

@app.get("/health")
def health_check():
    return {"status": "healthy", "service": "indesign-to-word-converter", "log_file": log_file}

if __name__ == "__main__":
    logger.info(f"Starting InDesign Windows Conversion Server on port 5555...")
    logger.info(f"Logs are being written to: {log_file}")
    uvicorn.run(app, host="0.0.0.0", port=5555)
