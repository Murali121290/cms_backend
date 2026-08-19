#include "glue code.jsx"

var scriptFile = File($.fileName);
var scriptDirectory = scriptFile.parent.fsName;
try
{
    scriptDirectory = scriptDirectory.replace(/\/d\//, "d:/")
}
catch(e){}

app.scriptPreferences.userInteractionLevel = UserInteractionLevels.neverInteract;
var inputFile = "";
try {
    inputFile = app.scriptArgs.getValue("InputFile");
} catch(e) {}

if (!inputFile && typeof arguments !== "undefined" && arguments.length >= 1) {
    inputFile = arguments[0];
}
var inddFile = new File(inputFile);
var doc = app.open(inddFile);

//~ var doc = app.activeDocument;
//~ var xmlpath = decodeURI(doc.fullName);
xmlpath = inputFile.toString().replace(".indd", "_final.xml");
xmlpath = xmlpath.replace(/\/d\//, "d:/");

doc.exportFile(
    ExportFormat.XML,
    File(xmlpath)
);

var myFinalXMLBatchFile = new File(scriptDirectory + "/finalxml/finalxml.bat");
myFinalXMLBatchFile.open("w");
myFinalXMLBatchFile.writeln("echo on");
myFinalXMLBatchFile.writeln("cls");
myFinalXMLBatchFile.writeln("cd \"" + scriptDirectory + "\\finalxml\"");
myFinalXMLBatchFile.writeln("\""+ scriptDirectory + "\\finalxml\\UTF8.exe\" \"" + xmlpath + "\"");
myFinalXMLBatchFile.writeln("perl \"" + scriptDirectory + "\\finalxml\\springer_finalxml.pl\" \"" + xmlpath + "\"");
myFinalXMLBatchFile.writeln("dir > \"" + scriptDirectory + "\\finalxml\\finalxml.log\"");
//~         myFinalXMLBatchFile.writeln("pause");
myFinalXMLBatchFile.writeln("echo off");
myFinalXMLBatchFile.close();
myFinalXMLBatchFile.execute();

var docFolder = doc.filePath;
var myRuleSet = new Array (new FigElement);
with(doc)
{
    var elements = xmlElements;
    __processRuleSet(elements.item(0), myRuleSet);
}
function FigElement()
{
    this.name = "FigElement";
    this.xpath = "//fig/graphic";
    this.apply = function(myElement, myRuleProcessor)
    {
        with(myElement)
        {
            var graphic = myElement.graphics[0];

                try {

                    var frame = graphic.parent;
                    var link = graphic.itemLink;
                    var originalFile = link.filePath;
                    var fileName = link.name.replace(/\.([^\.]+)$/, "");
                    var jpgFile = File(
                        docFolder.fsName + "/" + fileName + ".jpg"
                    );
                    frame.exportFile(
                        ExportFormat.JPG,
                        jpgFile
                    );
                }
                catch (e) {$.writeln(e);}
        }
    }
}

var myepubBatchFile = new File(scriptDirectory + "/epub/epub.bat");
myepubBatchFile.open("w");
myepubBatchFile.writeln("echo on");
myepubBatchFile.writeln("cls");
myepubBatchFile.writeln("cd \"" + scriptDirectory + "\\epub\"");
myepubBatchFile.writeln("perl \"" + scriptDirectory + "\\epub\\bits2epub.pl\" \"" + xmlpath + "\"");
myepubBatchFile.writeln("dir > \"" + scriptDirectory + "\\epub\\epub.log\"");
//~         myepubBatchFile.writeln("pause");
myepubBatchFile.writeln("echo off");
myepubBatchFile.close();
myepubBatchFile.execute();

//Text Extraction
app.scriptPreferences.userInteractionLevel = UserInteractionLevels.neverInteract;
//remove layers
var mylayers = doc.layers;
for (var l=mylayers.length - 1; l>=0; l--)
{
    if (mylayers[l].name.indexOf("Slendro") != -1)
        mylayers[l].remove();
}

//remove author queries
try
{
    app.findTextPreferences = app.changeTextPreferences = NothingEnum.NOTHING;
    app.findTextPreferences.appliedParagraphStyle = doc.paragraphStyles.item("AQ");
    app.changeTextPreferences.changeTo = "";
    var queryitem = doc.findText();
    if (queryitem.length)
    {
        for (var q=queryitem.length-1; q>=0; q--)
        {
            app.select(queryitem[q]);
            app.cut();
            app.selection[0].parentTextFrames[0].remove();
        }
    }
}
catch(e){}

var rtfname = doc.name.replace(".indd", ".rtf");
var docxname = doc.name.replace(".indd", "_final.docx");
var docpath = doc.filePath.toString();
docpath = docpath.replace(/\/d\//g, 'd:\/');
docpath = docpath.replace(/\%20/g, ' ');

app.scriptPreferences.measurementUnit = MeasurementUnits.POINTS;
doc.viewPreferences.horizontalMeasurementUnits = MeasurementUnits.POINTS;
doc.viewPreferences.verticalMeasurementUnits   = MeasurementUnits.POINTS;
doc.viewPreferences.rulerOrigin = RulerOrigin.PAGE_ORIGIN;
var halfpagewidth = (doc.documentPreferences.pageWidth/2) - doc.marginPreferences.columnGutter;

var scriptFile = File($.fileName);
var scriptDirectory = scriptFile.path;
try
{
    scriptDirectory = scriptDirectory.replace(/\/d\//, "d:/")
}
catch(e){}

try
{
    var myStyleJsonfile = File(scriptDirectory +  "/Springer_TagMapping.json");
    myStyleJsonfile.open("r");
    var myStyleJsonContent = myStyleJsonfile.read();
    myStyleJsonfile.close();
}
catch(e){}
var myStyleJSCont = JSON.parse(myStyleJsonContent);

//set preflight to switch off
try
{
    doc.preflightOptions.preflightOff = true;
} 
catch(e){}

//set smar overflow to avoid overflow
with (doc.textPreferences)
{
    smartTextReflow = true;
    addPages = AddPageOptions.END_OF_STORY; 
    deleteEmptyPages = false;
    preserveFacingPageSpreads = false;
    limitToMasterTextFrames = false; 
}

var mainstory = main_stories(doc);
mainstory.insertionPoints[0].parentTextFrames[0].label = "firstframe";

var mainframe = mainstory.insertionPoints[0].parentTextFrames[0];
while (mainframe.nextTextFrame != null)
{
    mainframe.nextTextFrame.label = "mainframe";
    mainframe = mainframe.nextTextFrame;
}
try
{
    mainframe.label = "mainframe";
}
catch(e){}

try
{
    // Clear previous find/change preferences
    app.findTextPreferences = NothingEnum.NOTHING;
    app.changeTextPreferences = NothingEnum.NOTHING;
    
    // Find text formatted as All Caps
    app.findTextPreferences.capitalization = Capitalization.ALL_CAPS;
    var found = doc.findText();
    for (var i = 0; i < found.length; i++) 
    {
        app.select(found[i]);
        app.selection[0].changecase(ChangeCaseOptions.UPPERCASE);
    }
}
catch(e){}

try
{
    // Clear previous find/change preferences
    app.findTextPreferences = NothingEnum.NOTHING;
    app.changeTextPreferences = NothingEnum.NOTHING;

    // Find text formatted as Lower case
    app.findTextPreferences.capitalization = Capitalization.LOWER_CASE;
    var found = doc.findText();
    for (var i = 0; i < found.length; i++) 
    {
        app.select(found[i]);
        app.selection[0].changecase(ChangeCaseOptions.LOWERCASE);
    }
}
catch(e){}

// create conditions for marking
var paracont = doc.conditions.item("paracont");
if (!paracont.isValid)
{
    paracont = doc.conditions.add({name:"paracont", indicatorColor:[255, 0, 0], indicatorMethod:ConditionIndicatorMethod.USE_HIGHLIGHT, visible:true});
}

// get width and height
var width = doc.documentPreferences.pageWidth - (doc.pages[0].marginPreferences.right + doc.pages[0].marginPreferences.left);
var height = doc.documentPreferences.pageHeight - (doc.pages[0].marginPreferences.top + doc.pages[0].marginPreferences.bottom);
var dumframe = doc.pages[0].textFrames.add({geometricBounds: [0, -width, height, -10]});
dumframe.label = "dummy";
var pcount = doc.pages.length * 3;

// create dummy text frames for placing contents
for (var p=1; p<pcount; p++)
{
    var continueframe = doc.pages[0].textFrames.add({geometricBounds: [0, (-width - p), height, -10]});
    continueframe.label = "dummy";
    dumframe.nextTextFrame = continueframe;
    dumframe = continueframe;
}

var extstory = dumframe.parentStory;
extstory.contents = "\r";
extstory.paragraphs.everyItem().appliedParagraphStyle = doc.paragraphStyles.item("[Basic Paragraph]");

var mypage = doc.pages;
var firstFrame = [];

var floatele = 1;
var mypage = doc.pages;
var firstFrame = [];
var prevlastframe;
var destcount=0;
for (var p=0; p<mypage.length; p++)
{
    var page = mypage[p];

    if ((mypage[p].groups.length != 0))
    {
        for (var gp=0; gp<mypage[p].groups.length; gp++)
        {
            if (mypage[p].groups[gp].groups.length != 0)
            {
                mypage[p].groups[gp].groups[0].ungroup();
                mypage[p].groups[gp].ungroup();
            }
        }
    }
    
    var pgitems = page.allPageItems;
//~     if (page.name == "22")
//~     alert("yes");
    var orderedFrames = [];
    var itemArray = [];
    var item1Array = [];
    var item2Array = [];
    
    for (var pi=0; pi<pgitems.length; pi++)
    {
        try
        {
            if (pgitems[pi].contents.length == 0 || pgitems[pi].locked == true)
            continue;
            pgitems[pi].contents.length;
            app.select(pgitems[pi]);
            if (pgitems[pi].geometricBounds[1] < halfpagewidth)
            item1Array.push(pgitems[pi]);
            else
            item2Array.push(pgitems[pi]);
        }
        catch(e){}
    }

    item1Array = getTextFramesTopThenLeft(item1Array, page);
    if (item2Array.length != 0)
    {
        item2Array = getTextFramesTopThenLeft(item2Array, page);
        app.select(item2Array[0]);
        item1Array = item1Array.concat (item2Array);
    }
    
    orderedFrames = item1Array;
    try
    {
        if (orderedFrames.length != 0)
        {
            //var orderedFrames;
            //$.writeln(page.name);
            getParagraphsFloatMarking(orderedFrames, page);
        }
    }
    catch(e){}
}

var root = app.activeDocument.xmlElements[0];
while (root.xmlElements.length)
{
    root.xmlElements[0].untag();
}

//for (var p=0; p<mypage.length; p++)
var p=0;
while (doc.pages.length > p)
{
    var page = doc.pages[p];
    p++;
    var pgitems = page.allPageItems;
//~     if (page.name == "15")
//~     alert("yes");
    var orderedFrames = [];
    var itemArray = [];
    var item1Array = [];
    var item2Array = [];
    
    for (var pi=0; pi<pgitems.length; pi++)
    {
        try
        {
            if (pgitems[pi].contents.length == 0 || pgitems[pi].locked == true)
            continue;
            pgitems[pi].contents.length;
            app.select(pgitems[pi]);
            if (pgitems[pi].geometricBounds[1] < halfpagewidth)
            item1Array.push(pgitems[pi]);
            else
            item2Array.push(pgitems[pi]);
        }
        catch(e){}
    }

    item1Array = getTextFramesTopThenLeft(item1Array, page);
    if (item2Array.length != 0)
    {
        item2Array = getTextFramesTopThenLeft(item2Array, page);
        app.select(item2Array[0]);
        item1Array = item1Array.concat (item2Array);
    }
    
    orderedFrames = item1Array;
    try
    {
        if (orderedFrames.length != 0)
        {
            //var orderedFrames;
            //$.writeln(page.name);
            getParagraphs(orderedFrames, page);
        }
    }
    catch(e){}
}

//remove main contens
try
{
    app.findTextPreferences = app.changeTextPreferences = NothingEnum.NOTHING;
    app.findTextPreferences.appliedConditions = [doc.conditions.item("paracont")];
    app.changeTextPreferences.changeTo = "";
    doc.findText();
    doc.changeText();
}
catch(e){}

//remove brackets from the call outs and apply bold style
//setcallouts(extstory);

//initial cleanup
initialcleanup(extstory);

//word tagging
//tagging(extstory);

// convert all list to text
convertListtoText(extstory);

// change times new roman fonts.
fontchange(extstory);

// final clean up
finalcleanup(extstory);

app.selection = null;
extstory.texts[0].select();
app.selection[0].exportFile(ExportFormat.RTF, File(docpath + "/" + rtfname), false);
docpath = docpath.replace(/\//g, "\\");

//convert rtf to docx
$.sleep(250);
var objFile = new File("D:/textextraction/extract.bat");
objFile.open("w");
objFile.writeln("echo on");
objFile.writeln("cls");
objFile.writeln("D:");
objFile.writeln("cd D:\\textextraction");
objFile.writeln("RTFtoDocx.exe " + "\""  + (docpath + "\\" + rtfname) + "\" \"" + (docpath + "\\" + docxname) + "\"");
objFile.writeln("echo off");
objFile.close();
objFile.execute();

//doc.close(SaveOptions.NO);

function getParagraphsFloatMarking(orderedframes, page)
{
    var start = 0;
    var parastyle;
    for (var s = 0; s < orderedframes.length; s++) 
    {
        var frame = orderedframes[s];
        var floatmark = "false";
        app.select(frame);
        if ((frame.label == "dummy") || (frame.label == "done"))
        continue;
        if (frame.paragraphs[0].appliedConditions[0] != undefined  && frame.paragraphs[-1].appliedConditions[0] != undefined)
        continue;
        var paras = frame.paragraphs;
        var floatType = "None";
        try
        {
            if (frame.anchoredObjectSettings.anchoredPosition == AnchorPosition.ANCHORED)
            {
                app.select(frame.parent);
                app.findTextPreferences = app.changeTextPreferences = NothingEnum.NOTHING;
                app.findTextPreferences.findWhat = "^p";
                try
                {
                    var myfitem = app.selection[0].paragraphs[0].findText();
                    try
                    {
                        var anclabel = myfitem[0].index.toString();
                        doc.hyperlinkTextDestinations.add(myfitem[0].insertionPoints[0], {name: anclabel});
                        frame.label = anclabel;
                        frame.anchoredObjectSettings.releaseAnchoredObject();
                    }
                    catch(e){
                            var anclabel = myfitem[0].index.toString();
                            doc.hyperlinkTextDestinations.add(myfitem[0].insertionPoints[0], {name: anclabel + destcount});
                            frame.label = anclabel + destcount;
                            //frame.label = parseInt(myfitem[0].index.toString()) + 1;
                            frame.anchoredObjectSettings.releaseAnchoredObject();
                            destcount++;
                        }
                    continue;
                }
                catch(e){}
            }
        }
        catch(e){}
        
        //if (frame.previousTextFrame == null && frame.label != "firstframe")
        if (frame.previousTextFrame == null && frame.label != "firstframe")
        {
            if (app.selection[0].parent.constructor.name == "Group" && app.selection[0].parent.allGraphics.length != 0)
            {
                var iconcheck = "false";
                for (var gp=0; gp<app.selection[0].parent.allGraphics.length; gp++)
                {
                    if (app.selection[0].parent.allGraphics[gp].geometricBounds[2] - app.selection[0].parent.allGraphics[gp].geometricBounds[0] < 50 && app.selection[0].parent.allGraphics[gp].geometricBounds[3] - app.selection[0].parent.allGraphics[gp].geometricBounds[1] < 50)
                    {
                        iconcheck = "true";
                        break
                    }
                }
                if (iconcheck == "true")
                    floatType = "None";
                else
                    floatType = "FIG";
            }
            else if (app.selection[0].tables.length != 0)
            floatType = "TAB";
            else if (app.selection[0].paragraphs[0].contents.match(/(B|b)ox(s)?(\s*)(\d+)/ig) != null)
            floatType = "BOX";
            else if (app.selection[0].paragraphs[0].contents.match(/(F|f)igure(s)?(\s*)(\d+)/ig) != null)
            floatType = "FIG";
            
            if (floatType != "FIG" && floatType != "TAB" && floatType != "BOX")
            {
                string = "unnumbered";
                setFloatMarking(frame, prevlastframe);
                floatele++;
                floatmark = "true";
            }
        }
        else
        {
            if (app.selection[0].parent.constructor.name == "Group" && app.selection[0].parent.allGraphics.length != 0 && app.selection[0].label != "mainframe")
            {
                var iconcheck = "false";
                for (var gp=0; gp<app.selection[0].parent.allGraphics.length; gp++)
                {
                    if (app.selection[0].parent.allGraphics[gp].geometricBounds[2] - app.selection[0].parent.allGraphics[gp].geometricBounds[0] < 50 && app.selection[0].parent.allGraphics[gp].geometricBounds[3] - app.selection[0].parent.allGraphics[gp].geometricBounds[1] < 50)
                    {
                        iconcheck = "true";
                        break
                    }
                }
                if (iconcheck == "true")
                    floatType = "None";
                else
                    floatType = "FIG";
            }
        }
    
        if (floatType == "FIG" || floatType == "TAB" || floatType == "BOX")
        {
            string = "numbered";
            setFloatMarking(frame, prevlastframe);
            floatele++;
            floatmark = "true";
        }
        if (floatmark == "false")
            prevlastframe = frame;
    }
}

function setFloatMarking(frame, prevlastframe)
{
        //frame.label = string + floatele;
        var fframe = frame;
        while (fframe.nextTextFrame != null)
        {
            if (fframe.nextTextFrame.label == "")
            {
                fframe.nextTextFrame.label = "done";
            }
            fframe = fframe.nextTextFrame;
        }
        app.findTextPreferences = app.changeTextPreferences = NothingEnum.NOTHING;
        app.findTextPreferences.findWhat = "^p";
        try
        {
            app.select(prevlastframe);
            var myfitem = prevlastframe.paragraphs[-1].findText();
            var anclabel = myfitem[0].index.toString();
            doc.hyperlinkTextDestinations.add(myfitem[0].insertionPoints[0], {name: anclabel});
            frame.label = anclabel;
        }
        catch(e){
            //$.writeln("Not set");
            }
}

function getParagraphs(orderedframes, page)
{
    var start = 0;
    var parastyle;
    for (var s = 0; s < orderedframes.length; s++) 
    {
        var frame = orderedframes[s];
        app.select(frame);
        try
        {
            app.activeWindow.activePage = app.selection[0].parentPage;
        }
        catch(e){}
        if ((frame.label == "dummy") || (frame.label == "done"))
        continue;
        if (frame.paragraphs[0].appliedConditions[0] != undefined  && frame.paragraphs[-1].appliedConditions[0] != undefined)
        continue;
        var paras = frame.paragraphs;
        var floatType = "None";
        //if (frame.previousTextFrame == null && frame.label != "firstframe")
        if (frame.previousTextFrame == null && frame.label != "firstframe")
        {
            if (app.selection[0].parent.constructor.name == "Group" && app.selection[0].parent.allGraphics.length != 0)
                floatType = "FIG";
            else if (app.selection[0].tables.length != 0)
                floatType = "TAB";
            else if (app.selection[0].paragraphs[0].contents.match(/(B|b)ox(s)?(\s*)(\d+)/ig) != null)
            {
                floatType = "BOX";
                if (app.selection[0].paragraphs.everyItem().bulletsAndNumberingListType.join(",").indexOf("NUMBERED_LIST") != -1)
                {
                    for (var lp=0; lp<paras.length; lp++)
                    {
                        if (paras[lp].bulletsAndNumberingListType == ListType.NUMBERED_LIST)
                        {
                            paras[lp].numberingContinue = false;
                            break;
                        }
                    }
                }
            }
             
            if (floatType == "FIG")
            {
                parastyle = paras[0].appliedParagraphStyle;
                app.select(paras[0]);
                app.select(paras[-1], SelectionOptions.ADD_TO);
                app.copy();
            }
            else
            {
                if (floatType != "FIG" && floatType != "TAB" && floatType != "BOX")
                {
                    floatType =  "unnumbered";
                    for (var lp=0; lp<paras.length; lp++)
                    {
                        try
                        {
                            if (paras[lp].bulletsAndNumberingListType == ListType.NUMBERED_LIST)
                            {
                                paras[lp].numberingContinue = false;
                                break;
                            }
                        }
                        catch(e){}
                    }
                }
                parastyle = frame.paragraphs[0].appliedParagraphStyle;
                frame.parentStory.texts[0].select();
                app.copy();
            }
        }
        else
        {
            if (app.selection[0].parent.constructor.name == "Group" && app.selection[0].parent.allGraphics.length != 0 && app.selection[0].label != "mainframe")
                floatType = "FIG";
                
            if (paras[0].appliedConditions[0] == undefined)
            {
                parastyle = paras[0].appliedParagraphStyle;
                app.select(paras[0]);
            }
            else
            {
                try{
                    parastyle = paras[1].appliedParagraphStyle;
                    app.select(paras[1]);
                }
                catch(e){}
            }
            try
            {
                app.select(paras[-1], SelectionOptions.ADD_TO);
                app.copy();
                if (start == 0)
                {
                    start = 1;
                }
            }
            catch(e){}
        }
    
        if (floatType == "FIG")
        {
            doc.hyperlinkTextDestinations.item(frame.label + " 1").showDestination();
            //extstory.paragraphs[-1].insertionPoints[-1].appliedParagraphStyle = doc.paragraphStyles.item("[Basic Paragraph]");
            app.selection[0].contents = "\r";
            doc.hyperlinkTextDestinations.item(frame.label + " 1").showDestination();
            //app.select(extstory.paragraphs[-1].insertionPoints[-1]);
            try
            {
                app.selection[0].appliedParagraphStyle = parastyle;
            }
            catch(e){}
            app.paste();
            doc.hyperlinkTextDestinations.item(frame.label + " 1").showDestination();
            app.selection[0].contents = "\r";
            //extstory.paragraphs[-1].insertionPoints[-1].appliedParagraphStyle = doc.paragraphStyles.item("[Basic Paragraph]");
        }
        else if (floatType == "TAB")
        {
            doc.hyperlinkTextDestinations.item(frame.label + " 1").showDestination();
            //extstory.paragraphs[-1].insertionPoints[-1].appliedParagraphStyle = doc.paragraphStyles.item("[Basic Paragraph]");
            app.selection[0].contents = "\r";
            doc.hyperlinkTextDestinations.item(frame.label + " 1").showDestination();
            //app.select(extstory.paragraphs[-1].insertionPoints[-1]);
            try
            {
                app.selection[0].appliedParagraphStyle = parastyle;
            }
            catch(e){}
            app.paste();
            doc.hyperlinkTextDestinations.item(frame.label + " 1").showDestination();
            app.selection[0].contents = "\r";
            //extstory.paragraphs[-1].insertionPoints[-1].appliedParagraphStyle = doc.paragraphStyles.item("[Basic Paragraph]");
        }
        else if (floatType == "BOX")
        {
            doc.hyperlinkTextDestinations.item(frame.label + " 1").showDestination();
            //extstory.paragraphs[-1].insertionPoints[-1].appliedParagraphStyle = doc.paragraphStyles.item("[Basic Paragraph]");
            app.selection[0].contents = "\r";
            doc.hyperlinkTextDestinations.item(frame.label + " 1").showDestination();
            //app.select(extstory.paragraphs[-1].insertionPoints[-1]);
            try
            {
                app.selection[0].appliedParagraphStyle = parastyle;
            }
            catch(e){}
            app.paste();
            doc.hyperlinkTextDestinations.item(frame.label + " 1").showDestination();
            app.selection[0].contents = "\r";
            //extstory.paragraphs[-1].insertionPoints[-1].appliedParagraphStyle = doc.paragraphStyles.item("[Basic Paragraph]");
        }
        else if (floatType == "unnumbered")
        {
            try
            {
                doc.hyperlinkTextDestinations.item(frame.label + " 1").showDestination();
                //extstory.paragraphs[-1].insertionPoints[-1].appliedParagraphStyle = doc.paragraphStyles.item("[Basic Paragraph]");
                app.selection[0].contents = "\r";
                doc.hyperlinkTextDestinations.item(frame.label + " 1").showDestination();
                //app.select(extstory.paragraphs[-1].insertionPoints[-1]);
                try
                {
                    app.selection[0].appliedParagraphStyle = parastyle;
                }
                catch(e){}
                app.paste();
                doc.hyperlinkTextDestinations.item(frame.label + " 1").showDestination();
                app.selection[0].contents = "\r";
                //extstory.paragraphs[-1].insertionPoints[-1].appliedParagraphStyle = doc.paragraphStyles.item("[Basic Paragraph]");
            }
            catch(e){
                    app.select(extstory.paragraphs[-1].insertionPoints[-1]);
                    try
                    {
                        app.selection[0].appliedParagraphStyle = parastyle;
                    }
                    catch(e){}
                    app.paste();
                }
        }
        else
        {
            app.select(extstory.paragraphs[-1].insertionPoints[-1]);
            try
            {
                app.selection[0].appliedParagraphStyle = parastyle;
            }
            catch(e){}
            app.paste();
        }
    
        extstory.paragraphs[-1].startParagraph = StartParagraph.ANYWHERE;
        try
        {
            extstory.paragraphs[-1].contents.match(/\r/).length
        }
        catch(e)
        {
            extstory.paragraphs[-1].insertionPoints[-1].contents = "\r";
        }
    
        app.select(paras[0]);
        app.select(paras[-1], SelectionOptions.ADD_TO);
        app.selection[0].appliedConditions = [doc.conditions.item("paracont")];
        frame.label = "done";
    }
}

function getTextFramesTopThenLeft(items, page) 
{
    var pgleft;
    if (page.side == PageSideOptions.LEFT_HAND)
        pgleft = page.marginPreferences.right;
   else
        pgleft = page.marginPreferences.left;
    var frames = [];

    for (var i = 0; i < items.length; i++) {
        try
        {
            if (items[i].geometricBounds[1] < pgleft)
                doc.align ([items[i]], AlignOptions.LEFT_EDGES, AlignDistributeBounds.MARGIN_BOUNDS);
            
            //resie the text frame for ordering
            var ftop = items[i].geometricBounds[0];
            var fline = items[i].lines[0].baseline - (items[i].characters[0].ascent + items[i].textFramePreferences.insetSpacing[0]);
            var fvalue = fline - ftop;
            
            if (fvalue > 20)
            {
                if ((items[i].tables.length != 0) || (items[i].textFramePreferences.insetSpacing[0] != 0) || (items[i].textFramePreferences.insetSpacing[1] != 0) || (items[i].textFramePreferences.insetSpacing[2] != 0) || (items[i].textFramePreferences.insetSpacing[2] != 0)){}
                else
                    items[i].geometricBounds = [fline - 5, items[i].geometricBounds[1], items[i].geometricBounds[2], items[i].geometricBounds[3]];
            }
        }
        catch(e){}
        //app.select(items[i]);
        frames.push(items[i]);
    }

    var TOP_TOLERANCE = 3;   // adjust if needed
    var LEFT_TOLERANCE = 3;

    frames.sort(function (a, b) {
        var ab = a.geometricBounds; // [top, left, bottom, right]
        var bb = b.geometricBounds;

        var aTop = ab[0];
        var bTop = bb[0];

        // 1️⃣ Top → Bottom
        if (Math.abs(aTop - bTop) > TOP_TOLERANCE) {
            return aTop - bTop;
        }

        // 2️⃣ Left → Right (same row)
        return ab[1] - bb[1];
    });

    return frames;
}

function getTextFramesLeftThenTop(items, page) 
{
    var pgleft;
    if (page.side == PageSideOptions.LEFT_HAND)
        pgleft = page.marginPreferences.right;
   else
        pgleft = page.marginPreferences.left;
        
    var frames = [];
    for (var i = 0; i < items.length; i++) 
    {
        //app.select(items[i]);
        try
        {
            if (items[i].geometricBounds[1] < pgleft)
                doc.align ([items[i]], AlignOptions.LEFT_EDGES, AlignDistributeBounds.MARGIN_BOUNDS);
            
            //resie the text frame for ordering
            var ftop = items[i].geometricBounds[0];
            var fline = items[i].lines[0].baseline - (items[i].characters[0].ascent + items[i].textFramePreferences.insetSpacing[0]);
            var fvalue = fline - ftop;
            if (fvalue > 20)
            {
                items[i].geometricBounds = [fline - 5, items[i].geometricBounds[1], items[i].geometricBounds[2], items[i].geometricBounds[3]];
            }
        }
        catch(e){}
        try
        {
            frames.push(items[i]);
        }
        catch(e){}
    }

    frames.sort(function (a, b) 
    {
        var ab = a.geometricBounds;
        var bb = b.geometricBounds;

        var aLeft = ab[1];
        var bLeft = bb[1];

        // 1 Left → Right
        if (Math.abs(aLeft - bLeft) > 1) {
            return aLeft - bLeft;
        }

        // 2 Top → Bottom (same column)
        return ab[0] - bb[0];
    });
    return frames;

}

function setcallouts(extstory)
{
    // 1. Label Mapping Object & Sub-expressions
    var LabelMap = {
        fig:       { re: /Fig(?:ur(?:e|es))?s?/i,  reftype: 'fig',        prefix: 'fig' },
        table:     { re: /Tab(?:le|les)?s?\.?/i,   reftype: 'table',      prefix: 'tab' },
        box:       { re: /Box(?:es)?/i,            reftype: 'boxed-text', prefix: 'box' },
        video:     { re: /Video(?:s)?/i,           reftype: 'video',      prefix: 'vid' },
        casestudy: { re: /Case Study(?:s)?/i,      reftype: 'casestudy',  prefix: 'cs' }
    };

    var NUM     = "\\d+(?:[.\\u2011]\\d+)?";
    var SUFFIX  = "[A-Za-z]?";
    var ITEM    = NUM + SUFFIX;
    var CONNECT = "(?:\\s*[\\u2013-]\\s*|\\s+(?:and|through|to)\\s+|,\\s*(?:and\\s+)?|\\s+&\\s+)";

    function buildRegex(labelPattern) {
        var labelStr = (labelPattern instanceof RegExp) ? labelPattern.source : labelPattern;
        var fullPattern = "\\((\s*)(" + labelStr + ")\\.?\\s+(" + ITEM + "(?:" + CONNECT + ITEM + ")*)(\s*)\\)";
        return fullPattern;
    }

    // 2. ConvertLabel Function
    function convertLabel(type) {
        var mapInfo = LabelMap[type];
        if (!mapInfo) return text; // Guard clause if key invalid

        var regex = buildRegex(mapInfo.re);
        
        app.findGrepPreferences = app.changeGrepPreferences = NothingEnum.NOTHING;
        app.findGrepPreferences.findWhat = regex;
        var callouts = extstory.findGrep();
        if (callouts.length)
        {
            for (var c=callouts.length - 1; c>=0; c--)
            {
                callouts[c].contents = callouts[c].contents.replace(/(\((\s*)|(\s*)\))/g, '');
                callouts[c].fontStyle = "Bold";
            }
        }
    }

    // 3. Your Loop Transformed
    var types = ['fig', 'table', 'box', 'video', 'casestudy'];
    //var num = 1; // Example value
    //var Tmp = "Please refer to Figure 1a-2b and Table 3.1 for details.";
    for (var i = 0; i < types.length; i++) {
        var type = types[i];
        Tmp = convertLabel(type);
    }
    
}

function tagging(tagstory)
{
    var allparas = tagstory.paragraphs;
    var nlistpara = [];
    var blistpara = [];
    var floatcheckstart = "false";
    
    for (var p=0; p<allparas.length; p++)
    {
        if (allparas[p].contents.length <= 1)
        continue;
//~         if (allparas[p].tables.length != 0)
//~         continue;
        
        app.select(allparas[p]);
        //$.writeln(allparas[p].contents);
        //app.activeWindow.activePage = app.selection[0].parentTextFrames[0].parentPage;
        if (allparas[p].contents.match(/(<FIG_CAP>|<TAB>|<BOX>)/g) != null)
        {
            floatcheckstart = "true"
            continue;
        }
        if (allparas[p].contents.match(/(<\/FIG_CAP>|<\/TAB>|<\/BOX>)/g) != null)
        {
            floatcheckstart = "end"
            continue;
        }
        if (floatcheckstart == "true")
        continue;
        
        if (allparas[p].bulletsAndNumberingListType != ListType.NO_LIST)
        {
            blistpara.push(allparas[p]);
//~             if (allparas[p].leftIndent == allparas[p+1].leftIndent)
//~             continue;
//~            if (allparas[p].leftIndent < allparas[p+1].leftIndent)
//~                listlevel1cond = "true";
            try
            {
                if (allparas[p+1].bulletsAndNumberingListType == ListType.NO_LIST)
                {
                    setTag(blistpara);
                    blistpara = [];
                }
            }
            catch(e){}
        }
        else
        {
            if (allparas[p].tables.length != 0)
            {
                allparas[p].insertionPoints[0].contents = "<UNTAB>";
                allparas[p].insertionPoints[-1].contents = "</UNTAB>";
            }
            {
                if (myStyleJSCont[allparas[p].appliedParagraphStyle.name])
                {
                    allparas[p].insertionPoints[0].contents = "<" + myStyleJSCont[allparas[p].appliedParagraphStyle.name] + ">";
                }
                else if (myStyleJSCont[allparas[p].appliedParagraphStyle.name] == ""){}
                else
                {
                    allparas[p].insertionPoints[0].contents = "<" + allparas[p].appliedParagraphStyle.name + ">";
                }
            }
        }
    }
}

function setTag(listparas)
{
    var type;
    if (listparas[0].bulletsAndNumberingListType == ListType.NUMBERED_LIST)
        type="NL";
    else if (listparas[0].bulletsAndNumberingListType == ListType.BULLET_LIST)
        type="BL";
    else
        type = listparas[0].appliedParagraphStyle.name;
        
    listparas[0].insertionPoints[0].contents = "<" + type + ">";
    listparas[listparas.length-1].insertionPoints[-2].contents = "</" + type + ">";
}

function convertListtoText(liststory)
{
//~     try
//~     {
//~         app.findGrepPreferences = app.changeGrepPreferences = NothingEnum.NOTHING;
//~         app.findGrepPreferences.findWhat = "(<NL>|<BL>)";
//~         app.changeGrepPreferences.changeTo = "$1\r";
//~         doc.findGrep();
//~         doc.changeGrep();
//~     }
//~     catch(e){}

//~     try
//~     {
//~         app.findGrepPreferences = app.changeGrepPreferences = NothingEnum.NOTHING;
//~         app.findGrepPreferences.findWhat = "(</NL>|</BL>)";
//~         app.changeGrepPreferences.changeTo = "\r$1";
//~         doc.findGrep();
//~         doc.changeGrep();
//~     }
//~     catch(e){}

//~     try
//~     {
//~         app.findGrepPreferences = app.changeGrepPreferences = NothingEnum.NOTHING;
//~         app.findGrepPreferences.findWhat = "(<FIG_CAP>|<FIG>|<FIG_NUM>|<TAB>|<BOX>|<NL>|<BL>|</FIG_CAP>|</FIG>|</FIG_NUM>|</TAB>|</BOX>|</NL>|</BL>)";
//~         app.changeGrepPreferences.changeTo = "$1";
//~         app.changeGrepPreferences.appliedParagraphStyle = doc.paragraphStyles.item("[Basic Paragraph]");
//~         doc.findGrep();
//~         doc.changeGrep();
//~     }
//~     catch(e){}
    
//~     try
//~     {
//~         app.findGrepPreferences = app.changeGrepPreferences = NothingEnum.NOTHING;
//~         app.findGrepPreferences.findWhat = "(</FIG_CAP>|</FIG>|</FIG_NUM>|</TAB>|</BOX>|</NL>|</BL>)";
//~         app.changeGrepPreferences.changeTo = "$1";
//~         app.changeGrepPreferences.appliedParagraphStyle = doc.paragraphStyles.item("[Basic Paragraph]");
//~         liststory.findGrep();
//~         liststory.changeGrep();
//~     }
//~     catch(e){}
    
    try
    {
        app.findTextPreferences = app.changeTextPreferences = NothingEnum.NOTHING;
        app.findTextPreferences.bulletsAndNumberingListType = ListType.BULLET_LIST;
        var bullItems = doc.findText();
        if (bullItems.length > 0)
        {
            for (var i=bullItems.length - 1; i>=0; i--)
            {
                bullItems[i].convertBulletsAndNumberingToText();
            }
        }
    }
    catch(e){}
    try
    {
        app.findTextPreferences = app.changeTextPreferences = NothingEnum.NOTHING;
        app.findTextPreferences.bulletsAndNumberingListType = ListType.NUMBERED_LIST;
        var numItems = doc.findText();
        if (numItems.length > 0)
        {
            for (var i=numItems.length - 1; i>=0; i--)
            {
                numItems[i].convertBulletsAndNumberingToText();
            }
        }
    }
    catch(e){}
}

function fontchange(fontstory)
{
    var styleMap = {
        "Bold Italic"   : "Bold Italic",
        "Black Italic"   : "Bold Italic",
        "Black Oblique"  : "Bold Italic",
        "Bold Oblique"   : "Bold Italic",
        "Heavy Italic"   : "Bold Italic",
        "Demi Italic"   : "Bold Italic",
        "ExtraBold Italic"   : "Bold Italic",
        "Bold"          : "Bold",
        "Black"          : "Bold",
        "Heavy"          : "Bold",
        "SemiBold"       : "Bold",
        "Demi"           : "Bold",
        "ExtraBold"      : "Bold",
        "Extra Condensed" : "Bold",
        "Oblique"        : "Italic",
        "Italic"        : "Italic",
        "Book Italic"        : "Italic",
        "Light"        : "Regular",
        "Medium"        : "Regular",
        "Regular"        : "Regular",
        "Book"        : "Regular",
        "Condensed"        : "Regular",
        
    };

    var fontStyles = [];
    for (var i = 0; i < doc.fonts.length; i++)
    {
        fontStyles.push(doc.fonts[i].fontStyleName);
    }

    for (var style=0; style<fontStyles.length; style++)
    {
        for (var key in styleMap)
        {
            //if (fontStyles[style].toLowerCase().indexOf(key.toLowerCase()) >= 0)
            if (fontStyles[style].toLowerCase() == key.toLowerCase())
            {
                app.findTextPreferences = NothingEnum.NOTHING;
                app.changeTextPreferences = NothingEnum.NOTHING;

                app.findTextPreferences.fontStyle = fontStyles[style];
                app.changeTextPreferences.fontStyle = styleMap[key];
                app.changeTextPreferences.appliedFont = "Times New Roman";
                doc.findText();
                doc.changeText();
            }
        }
    }

//~     fontstory.texts[0].select();
//~     app.selection[0].appliedFont = "Times New Roman";

}

function initialcleanup(cleanstory)
{
    if (cleanstory.paragraphs[0].contents.length == 1)
    cleanstory.paragraphs[0].remove();
    
    doc.recompose();
    $.sleep(200);

    try
    {
        app.findTextPreferences = app.changeTextPreferences = NothingEnum.NOTHING;
        app.findTextPreferences.findWhat = " ^n";
        app.changeTextPreferences.changeTo = " ";
        doc.findText();
        doc.changeText();
    }
    catch(e){}

    doc.recompose();
    $.sleep(200);

    try
    {
        app.findGrepPreferences = app.changeGrepPreferences = NothingEnum.NOTHING;
        app.findGrepPreferences.findWhat = "\\r(\\r+)";
        app.changeGrepPreferences.changeTo = "\\r";
        doc.findGrep();
        doc.changeGrep();
    }
    catch(e){}
}

function finalcleanup(cleanstory)
{
    var floatelement = new Array("NL", "BL", "UNTAB");//"FIG_CAP", "TAB", "BOX", 
    for (var f=0; f<floatelement.length; f++)
    {
        try
        {
            app.findTextPreferences = app.changeTextPreferences = NothingEnum.NOTHING;
            app.findTextPreferences.findWhat = "<" + floatelement[f] + ">";
            app.changeTextPreferences.changeTo = "<" + floatelement[f] + ">\r";
            doc.findText();
            doc.changeText();
        }
        catch(e){}
        try
        {
            app.findTextPreferences = app.changeTextPreferences = NothingEnum.NOTHING;
            app.findTextPreferences.findWhat = "</" + floatelement[f] + ">";
            app.changeTextPreferences.changeTo = "\r</" + floatelement[f] + ">";
            doc.findText();
            doc.changeText();
        }
        catch(e){}
    }
    
    // figure tag process
    try
    {
        app.findGrepPreferences = app.changeGrepPreferences = NothingEnum.NOTHING;
        app.findGrepPreferences.findWhat = "(?i)<FIG_CAP>(\\s*)(F|f)ig(ur|ure|ures|s)?(\\.)?(\\s+)(\\d+)([\\-|.|‑]?)(?:[A-z|.|0-9]*)";
        var foundItem = doc.findGrep();
        if (foundItem.length)
        {
            for (var fi=foundItem.length - 1; fi>=0; fi--)
            {
                var figcont = foundItem[fi].contents.replace(/<FIG_CAP>(\s*)/g, "");
                foundItem[fi].insertionPoints[0].contents = "<FIG>\r<FIG_NUM>\r<Insert " + figcont + " Here>\r</FIG_NUM>\r";
            }
        }
    }
    catch(e){}
    try
    {
        app.findGrepPreferences = app.changeGrepPreferences = NothingEnum.NOTHING;
        app.findGrepPreferences.findWhat = "(?i)<[BASIC PARAGRAPH]>(\\s*)(F|f)ig(ur|ure|ures|s)?(\\.)?(\\s+)(\\d+)([\\-|.|‑]?)(?:[A-z|.|0-9]*)";
        var foundItem = doc.findGrep();
        if (foundItem.length)
        {
            for (var fi=foundItem.length - 1; fi>=0; fi--)
            {
                var figcont = foundItem[fi].contents.replace(/<[BASIC PARAGRAPH]>(\s*)/g, "");
                foundItem[fi].insertionPoints[0].contents = "<FIG>\r<FIG_NUM>\r<Insert " + figcont + " Here>\r</FIG_NUM>\r";
            }
        }
    }
    catch(e){}
    try
    {
        
        app.findTextPreferences = app.changeTextPreferences = NothingEnum.NOTHING;
        app.findTextPreferences.findWhat = "</FIG_CAP>";
        app.changeTextPreferences.changeTo = "</FIG_CAP>^p</FIG>^p";
        doc.findText();
        doc.changeText();
    }
    catch(e){}

    try
    {
        app.findGrepPreferences = app.changeGrepPreferences = NothingEnum.NOTHING;
        app.findGrepPreferences.findWhat = "(<FIG>|<FIG_NUM>|<Insert[^>]+>|</FIG>|</FIG_NUM>)";
        app.changeGrepPreferences.changeTo = "$1";
        app.changeGrepPreferences.appliedParagraphStyle = doc.paragraphStyles.item("[Basic Paragraph]");
        doc.findGrep();
        doc.changeGrep();
    }
    catch(e){}

    try
    {
        app.findGrepPreferences = app.changeGrepPreferences = NothingEnum.NOTHING;
        app.findGrepPreferences.findWhat = "\\r(\\r+)";
        app.changeGrepPreferences.changeTo = "\\r";
        doc.findGrep();
        doc.changeGrep();
    }
    catch(e){}
}

function main_stories(myD)
{
    d=0;
    for (q=0; q<myD.stories.length; q++)
        if (myD.stories[d].length < myD.stories[q].length)
            d=q;
            return myD.stories[d];
}

app.scriptPreferences.userInteractionLevel = UserInteractionLevels.INTERACT_WITH_ALL;

doc.close(SaveOptions.NO);