#show include
#include "includes/glue code.jsx"
#include "includes/StylesSpringer.jsx"
#include "includes/AuthorQueryPro.jsx"
#include "includes/SymbolSpringer.jsx"
#include "includes/ElementMove.jsx"
#include "includes/JACLogger.jsx"
#include "includes/JACUtils.jsx"
#include "includes/BoxProcessSpringer.jsx"
#include "includes/InlineBoxSpringer.jsx"
#include "includes/TableProcessSpringer.jsx"
#include "includes/FigureProcessSpringer.jsx"
//#include "includes/FigureProcessSpringer_Jstat.jsx"
//#include "includes/FigureModeSpringer.jsx"
#include "includes/FootnoteSpringer.jsx"
#include "includes/PlacingID.jsx"
#include "includes/Placement.jsx"
#include "includes/HyperlinkSpringer.jsx"
#include "includes/TableWidthSpringer.jsx"
#include "includes/TablesJournals.jsx"
//#include "includes/TableCharAlign.jsx"
#include "includes/CleanSpringer.jsx"
#include "includes/MathSpringer.jsx"
#include "includes/AuthorQueryFlag.jsx"
#include "includes/LastPageBalanceSpringer.jsx"
var JawsTokenIdPath;
var JasonPassorFailArr = new Array();

function JACProcessor(scriptFilePath) {
    // JACProcessor needs this to be able to load resources
    this.scriptFilePath = scriptFilePath;
    // if the export fails this will contain the error object
    this.error = undefined;
    //Enable/DIsable Logging
    this.doLogging = true;
    // this must contain a file object referencing this script file
    //logger
    this.logger = undefined;

    //Inputs
    this.idTempFile = undefined;
    this.idJobFile = undefined;
    this.xmlFile = undefined;
    this.logFile = undefined;
    this.pdfFile = undefined;

    //Paths
    this.xmlFolderPath = undefined;
    //XML Elements
    this.articleElement = undefined;
    this.frontEle = undefined;
    this.bodyEle = undefined;
    this.backEle = undefined;
    this.artworkFolderPath = undefined;
    //this.stampingImagePath = undefined;
    this.jrnlIDDoc = undefined;

    this.lastArticleFrame = undefined;
    //new members added for positioning the fig,table
    this.lstPageItemPlacedOn = null;
    this.lstObjectReferenceLine = null;
    this.placedInlineGraphicArray = new Array();
    this.myDoc = undefined;
    this.myBoxPlace = new Array();
    this.myTablePlace = new Array();
    this.myFigurePlace = new Array();
    this.mySCHPlace = new Array();
    this.myPHOPlace = new Array();
    //var JasonPassorFailArr = new Array();
    this.JawsErrorList = "";
    this.myBoxCount = 0;
    this.myTableCount = 0;
    this.myFigureCount = 0;
    this.mySingle = 0;
    this.myDouble = 0;
    this.myLandscape = 0;
    this.Artcheck;
    this.FigureCaptionSpace = 0;
    this.TopTextWrap = 0;
    this.LeftTextWrap = 0;
    this.RightTextWrap = 0;
    this.BottomTextWrap = 0;
    this.NumberColumn = 0;
    this.TableInsetSpace = 0;
    this.TableInsetSpaceChange = 0;
    this.TableAroundSpace = 0;
    this.myXMLName;
} // JACProcessor


JACProcessor.prototype.createJournal = function () {
    var success = false;
    do {
        //Test function for InDesign Desktop Client 
        this.testInitializeData(); //uncomment for client
        //this.getScriptArguments();//uncomment for server

        //Open template document and save
        success = this.openNsaveTemplate();
        if (success == false || this.jrnlIDDoc == undefined)
            break;

        //var pasteboardMargins  =this.jrnlIDDoc.pasteboardPreferences.pasteboardMargins;
        //this.jrnlIDDoc.pasteboardPreferences.pasteboardMargins=[2000, pasteboardMargins[1]];
        //set document units to points
        //JACUtils.setDocMesUnits(this.jrnlIDDoc, MeasurementUnits.POINTS, MeasurementUnits.POINTS, this.logger);

        //Process XML
        success = this.processJournalXML();

        //Export PDF
        success = JACUtils.exportPDF(this.jrnlIDDoc, this.pdfFile.fullName, this.idTempFile, this.logger, JasonPassorFailArr);

        //Close Template Document
        this.success = this.closeDocument(true);//TEMP1

        //update message
        //alert("PDF generated successfully.!");

    } while (false);

    this.cleanup();

    return (this.error == undefined);
} // JACProcessor.prototype.createDirectory


JACProcessor.prototype.cleanup = function () {
    // convert error to standard Error object
    if (this.error != undefined) {
        if ('errorString' in this.error) {
            this.error = new Error(this.error.errorString);
        }
    }
    //2du:	reset memebers

    //Write final Log
    if (this.logger != undefined) {
        var logFilePath = this.logger.logFilePath;
        var fileName = this.logger.logFile.name;
        this.logger.endLog("success");
        if (this.logger.m_isErrorOccured == true)
            JACUtils.copyFileToGivenFolder(logFilePath, this.pdfFile.path, fileName);
    }

} // cleanup


JACProcessor.prototype.testInitializeData = function ()//uncomment for standalone call
{
    //// <input>
    var server_xml = app.scriptArgs.get("xml_path");
    var xmlfile;
    if (server_xml != undefined && server_xml != "") {
        xmlfile = new File(server_xml);
    } else {
        xmlfile = new File("D:/s4c/SpringXMLWorkflow/d45b6201-6159-4256-9461-c36b9581b7a6/Degeneffe75953_Ch09_indd.xml");
    }
    var xmlpath = xmlfile.path;
    xmlfile = xmlfile.toString().replace(/\/d\//, "d:\/");
    xmlpath = xmlpath.replace(/\/d\//, "d:\/");

    var server_artwork = app.scriptArgs.get("artwork_path");
    var Artwork_Path;
    if (server_artwork != undefined && server_artwork != "") {
        Artwork_Path = server_artwork;
    } else {
        Artwork_Path = xmlpath + "/artfile";
    }
    Artwork_Path = Artwork_Path.replace(/\//g, '\\');

    var server_template = app.scriptArgs.get("template_path");
    var temppath;
    if (server_template != undefined && server_template != "") {
        temppath = new File(server_template).path;
    } else {
        temppath = xmlpath + "/Design/template/indesign";
    }
    var docpath = xmlpath;

    var scriptFile = File($.fileName);
    var scriptDirectory = scriptFile.path;
    try {
        scriptDirectory = scriptDirectory.replace(/\/d\//, "d:/")
    }
    catch (e) { }

    var textopdflog = new File(scriptDirectory + "/xmltopdf/xmltopdf.log");
    if (textopdflog.exists == true) {
        textopdflog.remove();
    }

    var cmdScriptDir = scriptDirectory.replace(/\//g, "\\");
    var cmdXmlFile = xmlfile.toString().replace(/\//g, "\\");
    var cmdArtwork = Artwork_Path.replace(/\//g, "\\");

    var myTextoPDFBatchFile = new File(scriptDirectory + "/xmltopdf/xmltopdf.bat");
    myTextoPDFBatchFile.open("w");
    myTextoPDFBatchFile.writeln("echo on");
    myTextoPDFBatchFile.writeln("cls");
    myTextoPDFBatchFile.writeln("cd /d \"" + cmdScriptDir + "\\xmltopdf\"");
    myTextoPDFBatchFile.writeln("\"" + cmdScriptDir + "\\xmltopdf\\springer_xslt.exe\" \"" + cmdScriptDir + "\\xmltopdf\\springer_config.xml\" \"" + cmdXmlFile + "\" \"" + cmdArtwork + "\"");
    myTextoPDFBatchFile.writeln("dir > \"" + cmdScriptDir + "\\xmltopdf\\xmltopdf.log\"");
    //~         myTextoPDFBatchFile.writeln("pause");
    myTextoPDFBatchFile.writeln("echo off");
    myTextoPDFBatchFile.close();
    myTextoPDFBatchFile.execute();

    var textopdflog = new File(scriptDirectory + "/xmltopdf/xmltopdf.log");
    var timeoutLimit = 300; // 300 * 200ms = 60 seconds
    var attempts = 0;
    for (; ;) {
        if (textopdflog.exists == true) {
            textopdflog.remove();
            break;
        }
        attempts++;
        if (attempts > timeoutLimit) {
            break;
        }
        $.sleep(200);
    }

    //temp data
    do {
        //collecte inputs
        //var tempFile = File.openDialog("Choose InDesign Template", "File Types: *.indt");
        var tempFile = Folder(temppath).getFiles("*.indt");
        var ID_Temp_Path;
        if (server_template != undefined && server_template != "") {
            ID_Temp_Path = server_template;
        } else {
            ID_Temp_Path = tempFile[0].fullName;
        }
        var Property_File = ID_Temp_Path.toString().replace(".indt", ".txt");
        if (ID_Temp_Path == null) {
            //alert("Please select a InDesign template document!");
            break;
        }
        if (Property_File == null) {
            //alert("Properties files is missing for the corresponding templates!");
            break;
        }
        this.FileProperties(Property_File);
        //tempFile=File.openDialog("Choose XML File", "File Types: *.xml");
        var inddxmlFile = xmlfile.toString();
        if (inddxmlFile.indexOf("_indd.xml") == -1) {
            inddxmlFile = inddxmlFile.replace(".xml", "_indd.xml");
        }
        XML_Path = File(inddxmlFile).fullName;
        if (XML_Path == null) {
            //alert("Please select a XML file for a journal!");
            break;
        }
        //remove extension
        var filePathNoExt = XML_Path.replace(".xml", "");
        filePathNoExt = XML_Path.replace(".XML", "");

        var server_job = app.scriptArgs.get("job_doc");
        ID_Job_Path = (server_job != undefined && server_job != "") ? server_job : (filePathNoExt + ".indd");
        Log_Path = filePathNoExt + ".log";
        if (File(ID_Job_Path).exists == true) {
            var myLogfilee = new File(Log_Path);
            myLogfilee.open("w");
            myLogfilee.writeln("\r");
            myLogfilee.writeln("The Application file is already Exists in folder. Please Check.");
            myLogfilee.close();
            exit();
        }
        var server_pdf = app.scriptArgs.get("pdf_path");
        PDF_Path = (server_pdf != undefined && server_pdf != "") ? server_pdf : (filePathNoExt + ".pdf");
        //Artwork_Path="//10.4.1.55/Data_Springer/Springer/JAWS/JPA/A.AB37E4/ARTWORK";
        Artcheck = ID_Job_Path.replace(".indd", "_art.log");
        //call for menu item call
        if (this.initialize(ID_Temp_Path, ID_Job_Path, XML_Path, PDF_Path, Artwork_Path, Log_Path) == false) {
            //alert("Failed to initialize data members. \nPlease check log file. \nLog file is at same location as XML with smae name as XML with.log extension.");
        }
        // init properties	
        //this.initProperties();
    } while (false);
}


JACProcessor.prototype.FileProperties = function (Property_File) {
    myFile = new File(Property_File);
    myFile.open("r");
    while (!myFile.eof) {
        var myLine = myFile.readln();
        if (myLine.indexOf("SingleColumnWidth") != -1) {
            mySingle = myLine.split("=")[1] * 1;
        }
        else if (myLine.indexOf("DoubleColumnWidth") != -1) {
            myDouble = myLine.split("=")[1] * 1;
        }
        else if (myLine.indexOf("LandscapeColumnWidth") != -1) {
            myLandscape = myLine.split("=")[1] * 1;
        }
        else if (myLine.indexOf("FigureCaptionSpace") != -1) {
            FigureCaptionSpace = myLine.split("=")[1] * 1;
        }
        else if (myLine.indexOf("TopTextWrap") != -1) {
            TopTextWrap = myLine.split("=")[1] * 1;
        }
        else if (myLine.indexOf("LeftTextWrap") != -1) {
            LeftTextWrap = myLine.split("=")[1] * 1;
        }
        else if (myLine.indexOf("RightTextWrap") != -1) {
            RightTextWrap = myLine.split("=")[1] * 1;
        }
        else if (myLine.indexOf("BottomTextWrap") != -1) {
            BottomTextWrap = myLine.split("=")[1] * 1;
        }
        else if (myLine.indexOf("NumberofColumn") != -1) {
            NumberColumn = myLine.split("=")[1] * 1;
        }
        else if (myLine.indexOf("TableSpaceInset") != -1) {
            TableInsetSpace = myLine.split("=")[1] * 1;
        }
        else if (myLine.indexOf("TableInsetSpaceAdjust") != -1) {
            TableInsetSpaceChange = myLine.split("=")[1] * 1;
        }
        else if (myLine.indexOf("TableAroundSpace") != -1) {
            TableAroundSpace = myLine.split("=")[1] * 1;
        }
        else { }
    }
    myFile.close();
}


JACProcessor.prototype.getScriptArguments = function () {
    do {
        var ID_Temp_Path = app.scriptArgs.get("template_path");
        if (ID_Temp_Path == undefined)
            break;
        // alert (ID_Temp_Path);

        Property_File = ID_Temp_Path.replace(".indt", ".txt");
        if (Property_File == null) {
            // alert("Properties files is missing for the corresponding templates!");
        }
        this.FileProperties(Property_File);

        var ID_Job_Path = app.scriptArgs.get("job_doc");
        if (ID_Job_Path == undefined)
            break;
        // alert (ID_Job_Path);

        var PDF_Path = app.scriptArgs.get("pdf_path");
        if (PDF_Path == undefined)
            break;
        // alert (PDF_Path);

        JawsTokenIdPath = app.scriptArgs.get("tokenid");
        if (JawsTokenIdPath == undefined)
            break;
        // alert (JawsTokenIdPath);

        var XML_Path = app.scriptArgs.get("xml_path");
        if (XML_Path == undefined)
            break;
        // alert (XML_Path);

        var Artwork_Path = app.scriptArgs.get("artwork_path");
        if (Artwork_Path == undefined)
            break;
        // alert (Artwork_Path);

        var Log_Path = XML_Path + ".log";
        Artcheck = ID_Job_Path.replace(".indd", "_art.log");
        //call for menu item call
        if (this.initialize(ID_Temp_Path, ID_Job_Path, XML_Path, PDF_Path, Artwork_Path, Log_Path) == false) {
            // alert("Failed to initialize data members. \nPlease check log file. \nLog file is at same location as XML with smae name as XML with.log extension.");
        }
        //this.initProperties();	
    } while (false);
}

JACProcessor.prototype.initialize = function (ID_Temp_Path, ID_Job_Path, XML_Path, PDF_Path, Artwork_Path, Log_Path) {
    var status = false;
    do {
        //Logger
        var logFilePath = Log_Path;
        if (logFilePath == undefined || logFilePath == "") {
            var curDate = new Date();
            var logFileName = "JAC-" + curDate.getDate() + "-" + curDate.getMonth() + "-" + curDate.getFullYear() + "-" + curDate.getHours() + "-" + curDate.getMinutes() + ".log";
            logFilePath = "//Macintosh HD/Temp" + "/" + logFileName; //TODO: Define some folder path for log
        }
        this.logger = new JACLogger(this.doLogging, logFilePath);
        if (this.logger) {
            //stat log
            this.logger.startLog();
        }
        //Input validations and initialization
        if (ID_Temp_Path == undefined) {
            this.logger.logError("JACProcessor: InDesign template path is not defined.");
            JasonPassorFailArr.push("JACProcessor: InDesign template path is not defined.");
            break;
        }
        else {
            this.idTempFile = new File(ID_Temp_Path);
            if (this.idTempFile == undefined) {
                this.logger.logError("JACProcessor: InDesign template file does not exist.");
                JasonPassorFailArr.push("JACProcessor: InDesign template file does not exist.");
                break;
            }
        }
        if (ID_Job_Path == undefined) {
            this.logger.logError("JACProcessor: InDesign job path is not defined.");
            JasonPassorFailArr.push("JACProcessor: InDesign job path is not defined.");
            break;
        }
        else {
            this.idJobFile = new File(ID_Job_Path);
            if (this.idJobFile.exists == true) {
                Log_Pathh = ID_Job_Path + "";
                Log_Pathh = Log_Pathh.replace(".indd", ".Log");
                var myLogfilee = new File(Log_Pathh);
                myLogfilee.open("w");
                myLogfilee.writeln("\r");
                myLogfilee.writeln("The Application file is already Exists in folder. Please Check.");
                myLogfilee.close();
                exit();
            }
            if (this.idJobFile == undefined) {
                this.logger.logError("JACProcessor: InDesign job path does not exist.");
                JasonPassorFailArr.push("JACProcessor: InDesign job path does not exist.");
                break;
            }
        }
        if (XML_Path == undefined) {
            this.logger.logError("JACProcessor: Data XML path is not defined.");
            JasonPassorFailArr.push("JACProcessor: Data XML path is not defined.");
            break;
        }
        else {
            this.xmlFile = new File(XML_Path);
            if (this.xmlFile == undefined) {
                this.logger.logError("JACProcessor: Data XML file does not exist.");
                JasonPassorFailArr.push("JACProcessor: Data XML file does not exist.");
                break;
            }
            this.xmlFolderPath = this.xmlFile.path;
        }
        if (PDF_Path == undefined) {
            this.logger.logError("JACProcessor: PDF path is not defined.");
            JasonPassorFailArr.push("JACProcessor: PDF path is not defined.");
            break;
        }
        else {
            this.pdfFile = new File(PDF_Path);
        }
        if (Log_Path == undefined) {
            this.logger.logWarning("JACProcessor: Log File Path is not defined.");
            JasonPassorFailArr.push("JACProcessor: Log File Path is not defined.");
            break;
        }
        if (Artwork_Path == undefined) {
            this.logger.logError("JACProcessor: Artwork folder path is not defined.");
            JasonPassorFailArr.push("JACProcessor: Artwork folder path is not defined.");
            break;
        }
        else {
            this.artworkFolderPath = Artwork_Path;
        }

        //Script file path
        if (this.scriptFilePath == undefined) {
            try {
                this.scriptFilePath = app.activeScript.path;
            }
            catch (e) {
                // we are running from the ESTK
                this.scriptFilePath = File(e.fileName).path;
            }
        }
        status = true;
    } while (false);
    return status;
}


JACProcessor.prototype.importJournalXML = function () {
    var isImport = false;

    do {
        //Get XML root
        //var rootElement = this.jrnlIDDoc.xmlElements.item(0);
        //~ 		if(rootElement == undefined)
        //~ 		{
        //~ 			this.logger.logError("Document does not contain XML root element - Highly impossible!");
        //~ 			break;
        //~ 		}
        //find child element with name article
        //~ 		this.articleElement = rootElement.xmlElements.itemByName("article");
        //~ 		if(this.articleElement == null){
        //~ 			this.logger.logError("Document does not contain required article XML element.");
        //~ 			break;
        //~ 		}
        //~ 		var childs = rootElement.xmlElements.itemByName("article");	
        //set XML Import Prefs

        var xmlPrefs = this.jrnlIDDoc.xmlImportPreferences;
        if (xmlPrefs != null) {
            xmlPrefs.allowTransform = false;
            xmlPrefs.createLinkToXML = false;
            xmlPrefs.ignoreUnmatchedIncoming = false;
            xmlPrefs.ignoreWhitespace = false;
            xmlPrefs.importCALSTables = false;
            //xmlPrefs.importStyle = 
            xmlPrefs.importTextIntoTables = false;
            xmlPrefs.importToSelected = false;
            xmlPrefs.removeUnmatchedExisting = false;
            xmlPrefs.repeatTextElements = false;
            //xmlPrefs.transformFilename 
            //xmlPrefs.transformParameters   
        }
        //import XML now
        try {
            this.jrnlIDDoc.importXML(this.xmlFile);
            try {
                myXMLName = this.xmlFile.name.split("_")[0];
                //check for overset 
                isImport = true;
            }
            catch (e) { }
        }
        catch (e) {
            //Log file implementation
            //this.logger.logError(e.message);
            this.logger.logError("Error occured while importing XML. Detail " + e);
            try {
                JasonPassorFailArr.push("Error occured while importing XML. Detail " + e);
            }
            catch (e) {
                this.jrnlIDDoc.close(SaveOptions.NO);
            }
        }
    } while (false);
    return isImport;
}

JACProcessor.prototype.openNsaveTemplate = function () {
    var status = true;
    do {
        var tempDoc = undefined;
        //Open template document
        try {
            //app.scriptPreferences.useractionLevel = UserInteractionLevels.neverInteract;
            tempDoc = app.open(this.idTempFile);//JACUtils.openIDDoc(this.idTempFile);
            //New Style Checking
            try {
                with (tempDoc.viewPreferences) {
                    horizontalMeasurementUnits = MeasurementUnits.points;
                    verticalMeasurementUnits = MeasurementUnits.points;
                    rulerOrigin = RulerOrigin.pageOrigin;
                }
                tempDoc.zeroPoint = [0, 0];
                var myStyles = tempDoc.paragraphStyles.itemByRange(2, tempDoc.paragraphStyles.length - 1).name.join(",");
                var myStyleFrame = tempDoc.pages[5].textFrames.add({ geometricBounds: [10, -1000, 600, -400] });
                myStyles = myStyles.replace(/\,/g, "@@");
                myStyles = "@" + myStyles + "@";
                myStyleFrame.contents = myStyles;
                //myStyleFrame.move([500, 0]);
                myStyleFrame.textFramePreferences.ignoreWrap = true;
                //myStyleFrame.fit(FitOptions.FRAME_TO_CONTENT)
                myStyleFrame.label = "parastyles";
                myStyleFrame.nonprinting = true;
                //~             var myStyles = tempDoc.paragraphStyles.itemByRange(2, tempDoc.paragraphStyles.length-1).name.join(",");
                //~             var myStyleFrame = tempDoc.pages[0].textFrames.add({geometricBounds:[0, -500, 500, 100]});
                //~             myStyles = myStyles.replace(/\,/g, "@@");
                //~             myStyles = "@" + myStyles + "@";
                //~             myStyleFrame.contents = myStyles;
                //~             myStyleFrame.move([-1300, 0]);
                //~             myStyleFrame.textFramePreferences.ignoreWrap = true;
                //~             myStyleFrame.fit(FitOptions.FRAME_TO_CONTENT)
                //~             myStyleFrame.label = "parastyles";
                //~             myStyleFrame.nonprinting = true;
            }
            catch (e) {
                alert(e);
                exit();
            }
            //alert("Template");
        } catch (e) {
            this.logger.logError("Failed to open template - " + this.idTempFile + " Error is - " + e.message);
            JasonPassorFailArr.push("Failed to open template - " + this.idTempFile + " Error is - " + e.message);
            status = false;
        }
        if (status == false)
            break;
        //Save template as journal
        try {
            this.jrnlIDDoc = tempDoc.save(this.idJobFile);
        }
        catch (e) {
            this.logger.logError("Failed to save template as " + this.idJobFile + " Error is - " + e.message);
            JasonPassorFailArr.push("Failed to save template as " + this.idJobFile + " Error is - " + e.message);
            status = false;
        }
        if (status == false)
            break;
        if (this.jrnlIDDoc == undefined) {
            status = false;
            this.logger.logError("Job document is null.");
            JasonPassorFailArr.push("Job document is null.");
        }
        status = true;
    } while (false);
    return status;
}

JACProcessor.prototype.processJournalXML = function () {
    var status = false;
    do {
        //Import XML and initialize members
        status = this.importJournalXML();
        if (status == false)
            break;
        try {
            app.menuActions.item("$ID/Fast Display").invoke();
        }
        catch (e) { }

        //this.myDoc = this.jrnlIDDoc;
        with (this.jrnlIDDoc.viewPreferences) {
            horizontalMeasurementUnits = MeasurementUnits.points;
            verticalMeasurementUnits = MeasurementUnits.points;
            rulerOrigin = RulerOrigin.pageOrigin;
        }
        this.jrnlIDDoc.zeroPoint = [0, 0];

        try {
            AuthorQueryPro.authorquery(this.jrnlIDDoc);
            this.logger.logError("Error at Author Query Processing: None");
            this.jrnlIDDoc.save();
        }
        catch (e) {
            this.logger.logError("Error at Author Query Processing: " + e);
            JasonPassorFailArr.push("Error at Author Query Processing: " + e);
            ErrorCalling();
            this.jrnlIDDoc.close(SaveOptions.YES);
            exit();
        }

        try {
            StylesSpringer.styleapply(this.jrnlIDDoc, this.logger, myXMLName, this.artworkFolderPath, JasonPassorFailArr); //completed
            this.logger.logError("Error at Styles Apply: None");
            this.jrnlIDDoc.save();
        }
        catch (e) {
            this.logger.logError("Error at Styles Apply: " + e);
            JasonPassorFailArr.push("Error at Styles Apply: " + e);
            ErrorCalling();
            this.jrnlIDDoc.close(SaveOptions.YES);
            exit();
        }

        try {
            BoxProcessSpringer.boxprocess(this.jrnlIDDoc, this.myBoxPlace, this.myBoxCount); //completed , mySingle, myDouble, myLandscape
            this.logger.logError("Error at Box Processing: None");
            this.jrnlIDDoc.save();
        }
        catch (e) {
            this.logger.logError("Error at Box Processing: " + e);
            JasonPassorFailArr.push("Error at Box Processing: " + e);
            ErrorCalling();
            this.jrnlIDDoc.close(SaveOptions.YES);
            exit();
        }

        try {
            FigureProcessSpringer.figureprocess(this.jrnlIDDoc, this.myFigurePlace, this.myFigureCount); //completed
            this.logger.logError("Error at Figure Processing: None");
            this.jrnlIDDoc.save();
            //this.jrnlIDDoc.close (SaveOptions.YES);
        }
        catch (e) {
            this.logger.logError("Error at Figure Processing: " + e);
            JasonPassorFailArr.push("Error at Figure Processing: " + e);
            ErrorCalling();
            this.jrnlIDDoc.close(SaveOptions.YES);
            exit();
        }

        try {
            TableWidthSpringer.tablewidth(this.jrnlIDDoc); //completed
            this.logger.logError("Error at Table Width: None");
            this.jrnlIDDoc.save();
        }
        catch (e) {
            this.logger.logError("Error at Table Width: " + e);
            JasonPassorFailArr.push("Error at Table Width: " + e);
            ErrorCalling();
            this.jrnlIDDoc.close(SaveOptions.YES);
            exit();
        }

        try {
            TableProcessSpringer.tableprocess(this.jrnlIDDoc, this.myTablePlace, this.myTableCount); //completed
            this.logger.logError("Error at Table Processing: None");
            this.jrnlIDDoc.save();
        }
        catch (e) {
            this.logger.logError("Error at Table Processing: " + e);
            JasonPassorFailArr.push("Error at Table Processing: " + e);
            ErrorCalling();
            this.jrnlIDDoc.close(SaveOptions.YES);
            exit();
        }

        try {
            CleanSpringer.clean(this.jrnlIDDoc); //completed
            this.logger.logError("Error at Cleaning: None");
            this.jrnlIDDoc.save();
        }
        catch (e) {
            this.logger.logError("Error at Cleaning: " + e);
            JasonPassorFailArr.push("Error at Cleaning: " + e);
            ErrorCalling();
            this.jrnlIDDoc.close(SaveOptions.YES);
            exit();
        }

        try {
            LastPageBalanceSpringer.lastpagebalance(this.jrnlIDDoc); //completed 
            this.logger.logError("Error at Last Page Balance: None");
            //alert("Lastpage Done.");
            this.jrnlIDDoc.save();
        }
        catch (e) {
            this.logger.logError("Error at Last Page Balance: " + e);
            JasonPassorFailArr.push("Error at Last Page Balance: " + e);
            ErrorCalling();
            this.jrnlIDDoc.close(SaveOptions.YES);
            exit();
        }

        this.jrnlIDDoc.save();
        ErrorCalling();
        //Jason file for tracking systems
        function ErrorCalling() {
            try {
                if (JawsTokenIdPath != null) {
                    if (JasonPassorFailArr.length != 0) {
                        JawsErrorList = (JasonPassorFailArr.join(","));
                        JasonPassorFail = 1;
                        input = { "tokenid": JawsTokenIdPath, "file_pdf": PDF_Path, "pdfstatus": JasonPassorFail, "error_pdf": JawsErrorList, "category": "Springer_Journals" };
                        updateDB(input);
                        exit();
                    }
                    else {
                        JasonPassorFail = 0;
                        input = { "tokenid": JawsTokenIdPath, "file_pdf": PDF_Path, "pdfstatus": JasonPassorFail, "error_pdf": JawsErrorList, "category": "Springer_Journals" };
                        updateDB(input);
                        exit();
                    }
                }
            }
            catch (e) {
            }
            function updateDB(ipJSON) {
                try {
                    var param = "";
                    for (var s in ipJSON) {
                        param += '&' + s + "=" + escape(ipJSON[s]);
                    }
                    alert(param);
                    var site = "jaws.newgen.co:9999";
                    var path = '/monitize/updatedata?apikey=568d3a525690b9f16f75b6HHf9294d9f3&tokenid=' + JawsTokenIdPath + '&table=selfpublishing&pdfstatus=' + JasonPassorFail + '&file_pdf=' + PDF_Path;
                    var conn = new Socket();
                    if (conn.open(site)) {
                        conn.timeout = 600000;
                        conn.write("GET " + path + " HTTP/1.0\n\n");
                        reply = conn.read(399999999999);
                        alert("Response from server " + reply.toString());
                        conn.close();
                    }
                    else {
                        alert("Error: " + conn.error);
                    }
                }
                catch (e) {
                    alert(e);
                }
            }
        }
    } while (false);
    return status;
}


JACProcessor.prototype.closeDocument = function (saveFlag) {
    //Close Document
    JACUtils.closeIDDoc(this.jrnlIDDoc, saveFlag);
    return true;
}

var jac = new JACProcessor(undefined);//uncomment for standalone class
jac.createJournal();
