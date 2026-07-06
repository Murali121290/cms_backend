// Adobe InDesign ExtendScript to export .indd to RTF/PDF
// Reads arguments set via ScriptArgs or arguments array

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
    // Write error to a log file next to output if we can
    if (outputFile) {
        try {
            var logFile = new File(outputFile + ".log.txt");
            logFile.open("w");
            logFile.write("InDesign Export Error: " + err.message + "\nLine: " + err.line + "\nStack: " + err.stack);
            logFile.close();
        } catch (logErr) {
            // Ignore log writing failure
        }
    }
    // Re-throw so Python automation detects the error
    throw err;
}
