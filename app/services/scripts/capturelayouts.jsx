#target indesign
#include "glue code.jsx";
#include "json2.jsx";

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
//~         inputFile = "D:/s4c/wordtoxml/FirstXML/jsx/Revises/test2/Giardino00443_R1_Ch03_025-042.indd";
} catch(e) {}

if (!inputFile && typeof arguments !== "undefined" && arguments.length >= 1) {
    inputFile = arguments[0];
}
var inddFile = new File(inputFile);
var doc = app.open(inddFile);
//~ var doc = app.activeDocument;

var pdfpath = inddFile.toString().replace(".indd", ".pdf");
pdfpath = pdfpath.replace(/\/d\//, "d:/");
pdfPresetToUse = "[High Quality Print]";
doc.exportFile(ExportFormat.pdfType, File(pdfpath));

var xmlpath = inputFile.toString().replace(".indd", ".xml");
xmlpath = xmlpath.replace(/\/d\//, "d:/");

var htmlpath = inputFile.toString().replace(".indd", ".html");
htmlpath = htmlpath.replace(/\/d\//, "d:/");

var xhtmlpath = inputFile.toString().replace(".indd", ".xhtml");
xhtmlpath = xhtmlpath.replace(/\/d\//, "d:/");

// ---- tsp_common ----
var S = "\uE000", E = "\uE001";
var PMAP = [["sb","spaceBefore"],["sa","spaceAfter"],["li","leftIndent"],
            ["ri","rightIndent"],["fi","firstLineIndent"],["ll","lastLineIndent"]];
function r3(n){ return Math.round(n*1000)/1000; }
function setPoints(doc){
  var o = {h:doc.viewPreferences.horizontalMeasurementUnits, v:doc.viewPreferences.verticalMeasurementUnits};
  doc.viewPreferences.horizontalMeasurementUnits = MeasurementUnits.POINTS;
  doc.viewPreferences.verticalMeasurementUnits   = MeasurementUnits.POINTS;
  return o;
}
function restoreUnits(doc,o){
  doc.viewPreferences.horizontalMeasurementUnits = o.h;
  doc.viewPreferences.verticalMeasurementUnits   = o.v;
}
function tabStr(o){           // tab stops incl. decimal/unit alignment character
  var a=[], i, t;
  for (i=0;i<o.tabStops.length;i++){
    t=o.tabStops[i];
    a.push(r3(t.position)+":"+t.alignment.toString()+":"+encodeURIComponent(t.alignmentCharacter||""));
  }
  return a.join(",");
}

// ---- capture ----
(function(){
  //var src = app.activeDocument;
  //var f = new File(src.fullName.fsName.replace(/\.indd$/i,"_tsp.indd"));
  //src.saveACopy(f);
  //var doc = app.open(f);
  //var doc = app.activeDocument;
  var u = setPoints(doc);
  var nTrack = 0, nTrackTbl = 0, nTblParas = 0, nTblMarked = 0, fails = [];
  var SIG = /\uE000(?:P\||T\||\/T)/;
  doc.layers.everyItem().locked = false;   // temp copy only: a locked layer refuses the marker insertion
  app.scriptPreferences.enableRedraw = false;

  function inCellOf(p){ try { return p.parent instanceof Cell; } catch(e){ return false; } }

  function trackOf(tr, ps){                // tracking value if it is a real local override, else null
    var t = tr.tracking, cs = tr.appliedCharacterStyle, csTr = null;
    if (typeof t !== "number") return null;
    try { if (cs.id !== doc.characterStyles[0].id && typeof cs.tracking === "number") csTr = cs.tracking; } catch(e0){}
    return (Math.abs(t - ps.tracking) > 0.001 && (csTr === null || Math.abs(t - csTr) > 0.001)) ? t : null;
  }
  function paraKV(p, ps){
    var kv = [];
    for (var m=0;m<PMAP.length;m++){
      var pr = PMAP[m][1];
      if (Math.abs(p[pr]-ps[pr]) > 0.001) kv.push(PMAP[m][0]+"="+r3(p[pr]));
    }
    if (p.justification.toString() !== ps.justification.toString()) kv.push("j="+p.justification.toString());
    var ts = tabStr(p); if (ts !== tabStr(ps)) kv.push("tb="+ts);
    return kv;
  }

  // ---------- body text: your logic, unchanged ----------
  var by = {};                               // story id -> {st, ops[]}
  var stories = doc.stories.everyItem().getElements();
  for (var s=0; s<stories.length; s++){
    var st = stories[s], ops = [], seq = 0;
    var paras = st.paragraphs.everyItem().getElements();
    for (var i=0;i<paras.length;i++){
      var p = paras[i];
      if (inCellOf(p)) continue;             // table text is done in the table pass below
      var ps = p.appliedParagraphStyle, kv = paraKV(p, ps);

      var base = p.insertionPoints[0].index;
      var pend = p.insertionPoints.lastItem().index;
      if (p.characters.lastItem().contents === "\r") pend--;   // keep the paragraph return outside the range
      if (kv.length) ops.push({pos:base, seq:seq++, txt:S+"P|"+kv.join(";")+E});

      var runs = p.textStyleRanges.everyItem().getElements();
      for (var r=0;r<runs.length;r++){
        var tr = runs[r], t = trackOf(tr, ps);
        if (t === null) continue;
        var a = tr.insertionPoints[0].index;
        var b = Math.min(tr.insertionPoints.lastItem().index, pend);
        if (b <= a) continue;
        ops.push({pos:a, seq:seq++, txt:S+"T|v="+r3(t)+";n="+(b-a)+E});
        ops.push({pos:b, seq:seq++, txt:S+"/T"+E});
        nTrack++;
      }
    }
    by[st.id] = {st:st, ops:ops};
  }

  // wrap on anchored frames: marker goes just before the anchor character
  var pis = doc.allPageItems;
  for (var w=0; w<pis.length; w++){
    var pi = pis[w];
    if (!(pi.parent instanceof Character)) continue;
    var ch = pi.parent, tw = pi.textWrapPreferences, sid = ch.parentStory.id;
    if (!by[sid]) by[sid] = {st:ch.parentStory, ops:[]};
    by[sid].ops.push({pos:ch.insertionPoints[0].index, seq:1000000+w,
      txt:S+"W|m="+tw.textWrapMode.toString()+";s="+tw.textWrapSide.toString()+
          ";o="+[].concat(tw.textWrapOffset).join("/")+E});
  }

  // insert from the end of each story backwards so offsets stay valid
  for (var k in by){
    var o = by[k].ops;
    o.sort(function(x,y){ return (y.pos-x.pos) || (y.seq-x.seq); });
    for (var q=0;q<o.length;q++){
      try { by[k].st.insertionPoints[o[q].pos].contents = o[q].txt; }
      catch (eIns){ fails.push("story " + k + " pos " + o[q].pos + ": " + eIns.message); }
    }
  }

  // ---------- tables only: positions INSIDE each cell paragraph ----------
  function tableParagraph(p){
    nTblParas++;
    try {
      var nChars = p.characters.length;
      if (!nChars) return;
      if (SIG.test(p.contents)) return;                  // markers already there
      var ps = p.appliedParagraphStyle, kv = paraKV(p, ps), tops = [], seq2 = 0, nT = 0;
      if (kv.length) tops.push({pos:0, seq:seq2++, txt:S+"P|"+kv.join(";")+E});

      var lc = p.characters.lastItem().contents;         // keep return / cell-end character outside the range
      var trailing = (typeof lc === "string") ? /^[\r\u0007\u0016]$/.test(lc) : true;
      var limit = nChars - (trailing ? 1 : 0);

      var runs2 = p.textStyleRanges.everyItem().getElements(), off = 0;
      for (var r2=0; r2<runs2.length; r2++){
        var tr2 = runs2[r2], len = tr2.characters.length, a2 = off, b2 = Math.min(off+len, limit);
        off += len;
        var t2 = trackOf(tr2, ps);
        if (t2 === null || b2 <= a2) continue;
        tops.push({pos:a2, seq:seq2++, txt:S+"T|v="+r3(t2)+";n="+(b2-a2)+E});
        tops.push({pos:b2, seq:seq2++, txt:S+"/T"+E});
        nT++;
      }
      if (!tops.length) return;
      tops.sort(function(x,y){ return (y.pos-x.pos) || (y.seq-x.seq); });
      for (var z=0; z<tops.length; z++) p.insertionPoints[tops[z].pos].contents = tops[z].txt;
      nTblMarked++; nTrack += nT; nTrackTbl += nT;
    } catch (eT){ fails.push("table paragraph: " + eT.message); }
  }

  for (var s2=0; s2<stories.length; s2++){
    var tbs = stories[s2].tables.everyItem().getElements();
    for (var tb=0; tb<tbs.length; tb++){
      var cells = tbs[tb].cells.everyItem().getElements();
      for (var c=0; c<cells.length; c++){
        var cps = cells[c].paragraphs.everyItem().getElements();
        for (var kk=0; kk<cps.length; kk++) tableParagraph(cps[kk]);
      }
    }
  }

  restoreUnits(doc,u);
  app.scriptPreferences.enableRedraw = true;
  if (fails.length){
    var lf = new File(Folder.desktop + "/tsp_capture_log.txt");
    lf.open("w"); lf.write(fails.join("\n")); lf.close();
  }
//~   alert("Markers written. Tracking ranges: " + nTrack + " (in tables: " + nTrackTbl + ")\n" +
//~         "Table paragraphs checked: " + nTblParas + ", marked: " + nTblMarked +
//~         (fails.length ? "\nFAILED inserts: " + fails.length + " (see tsp_capture_log.txt on the desktop)" : "") +
//~         "\nExport XML from this copy:\n" + f.fsName);

//export html
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
    this.xpath = "//graphic";
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

doc.htmlExportPreferences.viewDocumentAfterExport = false;

doc.exportFile(
    ExportFormat.HTML,
    File(htmlpath)
);

var csspath = inputFile.replace(".indd", "") + "-web-resources/css/idGeneratedStyles.css";
csspath = csspath.toString().replace(/\/d\//, "d:/");

// export html and the jpg's
doc.exportFile(
    ExportFormat.XML,
    File(xmlpath)
);

try
{
    if (File(scriptDirectory + "\\inddtoxhtml\\inddtoxhtml.log").exists == true)
    {
        File(scriptDirectory + "\\inddtoxhtml\\inddtoxhtml.log").remove();
    }
}
catch(e){}

var myinddtoxhtmlBatchFile = new File(scriptDirectory + "/inddtoxhtml/inddtoxhtml.bat");
myinddtoxhtmlBatchFile.open("w");
myinddtoxhtmlBatchFile.writeln("echo on");
myinddtoxhtmlBatchFile.writeln("cls");
myinddtoxhtmlBatchFile.writeln("cd \"" + scriptDirectory + "\\inddtoxhtml\"");
myinddtoxhtmlBatchFile.writeln("\""+ scriptDirectory + "\\inddtoxhtml\\01_UTF8.exe\" \"" + xmlpath + "\"");
myinddtoxhtmlBatchFile.writeln("perl \"" + scriptDirectory + "\\inddtoxhtml\\02_springer_finalxmlwithaid.pl\" \"" + xmlpath + "\"");
myinddtoxhtmlBatchFile.writeln("perl \"" + scriptDirectory + "\\inddtoxhtml\\03_marker2pi.pl\" \"" + xmlpath + "\"");
myinddtoxhtmlBatchFile.writeln("perl \"" + scriptDirectory + "\\inddtoxhtml\\04_universal_converter.pl\" xml2xhtml \"" + xmlpath  + "\" \"" + scriptDirectory + "\\xhtmltoindd\\mapping_config.json\" \"" + xhtmlpath + "\" \"" + csspath + "\"");
myinddtoxhtmlBatchFile.writeln("dir > \"" + scriptDirectory + "\\inddtoxhtml\\inddtoxhtml.log\"");
//~ myinddtoxhtmlBatchFile.writeln("pause");
myinddtoxhtmlBatchFile.writeln("echo off");
myinddtoxhtmlBatchFile.close();
myinddtoxhtmlBatchFile.execute();

for (var _wait = 0; _wait < 300; _wait++)
{
    try
    {
        if (File(scriptDirectory + "\inddtoxhtml\inddtoxhtml.log").exists == true)
        {
            File(scriptDirectory + "\inddtoxhtml\inddtoxhtml.log").remove();
            break;
        }
    }
    catch(e){}
    $.sleep(200);
}

doc.close (SaveOptions.NO);

})();