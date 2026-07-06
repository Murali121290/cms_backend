// Adobe InDesign ExtendScript to export .indd to RTF/PDF
// Reads arguments set via ScriptArgs in Python

try {
    var inputFile = app.scriptArgs.getValue("InputFile");
    var outputFile = app.scriptArgs.getValue("OutputFile");

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
    var format = ExportFormat.RTF; // Default to RTF (Rich Text Format) which Word opens
    
    if (outLower.indexOf(".pdf") !== -1) {
        format = ExportFormat.PDF_TYPE;
    } else if (outLower.indexOf(".txt") !== -1) {
        format = ExportFormat.TXT;
    } else if (outLower.indexOf(".xml") !== -1) {
        format = ExportFormat.XML;
    }

    var outFile = new File(outputFile);
    doc.exportFile(format, outFile, false);
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
