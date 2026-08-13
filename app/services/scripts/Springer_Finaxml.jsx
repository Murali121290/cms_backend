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

doc.close(SaveOptions.NO);