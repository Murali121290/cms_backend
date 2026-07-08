app.scriptPreferences.userInteractionLevel = UserInteractionLevels.neverInteract;

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

var inddFile = new File(inputFile);
var doc = app.open(inddFile);

var rtfname = doc.name.replace(".indd", ".rtf");
var docxname = doc.name.replace(".indd", ".docx");
var docpath = doc.filePath.fsName;

app.scriptPreferences.measurementUnit = MeasurementUnits.POINTS;
doc.viewPreferences.horizontalMeasurementUnits = MeasurementUnits.POINTS;
doc.viewPreferences.verticalMeasurementUnits   = MeasurementUnits.POINTS;
doc.viewPreferences.rulerOrigin = RulerOrigin.PAGE_ORIGIN;

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

var root = app.activeDocument.xmlElements[0];
while (root.xmlElements.length)
{
    root.xmlElements[0].untag();
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
for (var p=0; p<mypage.length; p++)
{
    var page = mypage[p]
    var pgitems = page.allPageItems;
//~     if (page.name == "4")
//~     alert("yes");
    var itemArray = [];
    for (var pi=0; pi<pgitems.length; pi++)
    {
        
        try
        {
            pgitems[pi].contents.length;
            app.select(pgitems[pi]);
            itemArray.push(pgitems[pi]);
        }
        catch(e){}
    }
    try
    {
        if (itemArray.length != 0)
        {
            var orderedFrames;
            if (p == 0)
            orderedFrames = getTextFramesTopThenLeft(itemArray, page);
            else
            orderedFrames = getTextFramesLeftThenTop(itemArray, page);
            
//~             if (orderedFrames.length != 0)
//~             {
//~                 for (var or=0; or<orderedFrames.length; or++)
//~                 {
//~                     var objcount = or + 1;
//~                     var objstyle = orderedFrames[or].appliedObjectStyle.duplicate();
//~                     objstyle.name = page.name + "_" + objcount;
//~                     orderedFrames[or].appliedObjectStyle = objstyle;
//~                 }
//~             }
        $.writeln(page.name);
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

//word tagging
tagging(extstory);

//initial cleanup
initialcleanup(extstory);

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
// objFile.execute();

doc.close(SaveOptions.NO);

function getParagraphs(orderedframes, page)
{
    var start = 0;
    var parastyle;
    for (var s = 0; s < orderedframes.length; s++) 
    {
        var frame = orderedframes[s];
        app.select(frame);
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
            floatType = "BOX";
             
            if (floatType == "FIG")
            {
                parastyle = paras[0].appliedParagraphStyle;
                app.select(paras[0]);
                app.select(paras[-1], SelectionOptions.ADD_TO);
                app.copy();
            }
            else
            {
                parastyle = frame.paragraphs[0].appliedParagraphStyle;
                frame.parentStory.texts[0].select();
                app.copy();
            }
        }
        else
        {
            if (app.selection[0].parent.constructor.name == "Group" && app.selection[0].parent.allGraphics.length != 0)
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
            extstory.paragraphs[-1].insertionPoints[-1].appliedParagraphStyle = doc.paragraphStyles.item("[Basic Paragraph]");
            extstory.paragraphs[-1].insertionPoints[-1].contents = "<FIG_CAP>\r";
            app.select(extstory.paragraphs[-1].insertionPoints[-1]);
            try
            {
                app.selection[0].appliedParagraphStyle = parastyle;
            }
            catch(e){}
            app.paste();
            extstory.paragraphs[-1].insertionPoints[-1].contents = "\r</FIG_CAP>";
            extstory.paragraphs[-1].insertionPoints[-1].appliedParagraphStyle = doc.paragraphStyles.item("[Basic Paragraph]");
        }
        else if (floatType == "TAB")
        {
            extstory.paragraphs[-1].insertionPoints[-1].appliedParagraphStyle = doc.paragraphStyles.item("[Basic Paragraph]");
            extstory.paragraphs[-1].insertionPoints[-1].contents = "<TAB>\r";
            app.select(extstory.paragraphs[-1].insertionPoints[-1]);
            try
            {
                app.selection[0].appliedParagraphStyle = parastyle;
            }
            catch(e){}
            app.paste();
            extstory.paragraphs[-1].insertionPoints[-1].contents = "\r</TAB>";
            extstory.paragraphs[-1].insertionPoints[-1].appliedParagraphStyle = doc.paragraphStyles.item("[Basic Paragraph]");
        }
        else if (floatType == "BOX")
        {
            extstory.paragraphs[-1].insertionPoints[-1].appliedParagraphStyle = doc.paragraphStyles.item("[Basic Paragraph]");
            extstory.paragraphs[-1].insertionPoints[-1].contents = "<BOX>\r";
            app.select(extstory.paragraphs[-1].insertionPoints[-1]);
            try
            {
                app.selection[0].appliedParagraphStyle = parastyle;
            }
            catch(e){}
            app.paste();
            extstory.paragraphs[-1].insertionPoints[-1].contents = "\r</BOX>";
            extstory.paragraphs[-1].insertionPoints[-1].appliedParagraphStyle = doc.paragraphStyles.item("[Basic Paragraph]");
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
        if (allparas[p].tables.length != 0)
        continue;
        
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
            allparas[p].insertionPoints[0].contents = "<" + allparas[p].appliedParagraphStyle.name + ">";
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
    try
    {
        app.findGrepPreferences = app.changeGrepPreferences = NothingEnum.NOTHING;
        app.findGrepPreferences.findWhat = "(<NL>|<BL>)";
        app.changeGrepPreferences.changeTo = "$1\r";
        doc.findGrep();
        doc.changeGrep();
    }
    catch(e){}

    try
    {
        app.findGrepPreferences = app.changeGrepPreferences = NothingEnum.NOTHING;
        app.findGrepPreferences.findWhat = "(</NL>|</BL>)";
        app.changeGrepPreferences.changeTo = "\r$1";
        doc.findGrep();
        doc.changeGrep();
    }
    catch(e){}

    try
    {
        app.findGrepPreferences = app.changeGrepPreferences = NothingEnum.NOTHING;
        app.findGrepPreferences.findWhat = "(<FIG_CAP>|<FIG>|<FIG_NUM>|<TAB>|<BOX>|<NL>|<BL>|</FIG_CAP>|</FIG>|</FIG_NUM>|</TAB>|</BOX>|</NL>|</BL>)";
        app.changeGrepPreferences.changeTo = "$1";
        app.changeGrepPreferences.appliedParagraphStyle = doc.paragraphStyles.item("[Basic Paragraph]");
        doc.findGrep();
        doc.changeGrep();
    }
    catch(e){}
    
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
    fontstory.texts[0].select();
    //app.selection[0].appliedFont = "Times New Roman";
    //app.selection[0].pointSize = "12 pt";
    app.selection[0].fillColor = doc.swatches.item("Black");
}

function initialcleanup(cleanstory)
{
    if (cleanstory.paragraphs[0].contents.length == 1)
    cleanstory.paragraphs[0].remove();
    
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
    var floatelement = new Array("NL", "BL");//"FIG_CAP", "TAB", "BOX", 
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
