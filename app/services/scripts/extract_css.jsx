// extract_css.jsx
app.scriptPreferences.userInteractionLevel = UserInteractionLevels.NEVER_INTERACT;
try {
    var inputFile = "";
    var outputFile = "";
    
    try {
        inputFile = app.scriptArgs.getValue("InputFile");
        outputFile = app.scriptArgs.getValue("OutputFile");
    } catch(e) {}
    
    if (!inputFile && typeof arguments !== "undefined" && arguments.length >= 2) {
        inputFile = arguments[0];
        outputFile = arguments[1];
    }
    
    var scriptFile = File($.fileName);
    var scriptDirectory = scriptFile.parent.fsName;
    try {
        scriptDirectory = scriptDirectory.replace(/\/d\//, "d:/");
    } catch(e){}
    
    // Parse mapping from springer_config.xml
    var mapping = {};
    try {
        var configXMLFile = new File(scriptDirectory + "/springer_config.xml");
        if (configXMLFile.exists) {
            configXMLFile.open("r");
            var content = configXMLFile.read();
            configXMLFile.close();
            
            // Strip DOCTYPE to prevent E4X parsing issues
            content = content.replace(/<!DOCTYPE[^>]*>/i, "");
            var xml = new XML(content);
            
            // 1. Process pstyle nodes
            var pstyles = xml.pstyle;
            for (var i = 0; i < pstyles.length(); i++) {
                var pNode = pstyles[i];
                var id = pNode.@idstyle.toString();
                var xp = pNode.@xpath.toString();
                if (id) {
                    mapping[id] = { xpath: xp, tagType: "pstyle" };
                }
            }
            
            // 2. Process cstyle nodes
            var cstyles = xml.cstyle;
            for (var j = 0; j < cstyles.length(); j++) {
                var cNode = cstyles[j];
                var cId = cNode.@idstyle.toString();
                var cXp = cNode.@xpath.toString();
                if (cId) {
                    mapping[cId] = { xpath: cXp, tagType: "cstyle" };
                }
            }
            
            // 3. Process multistyle nodes
            var mstyles = xml.multistyle;
            for (var k = 0; k < mstyles.length(); k++) {
                var mNode = mstyles[k];
                var mId = mNode.@idstyle.toString();
                var mXp = mNode.@xpath.toString();
                if (mId) {
                    mapping[mId] = { xpath: mXp, tagType: "multistyle" };
                }
            }
        }
    } catch(err_xml) {
        var log_xml = new File(outputFile + ".xml_err.log");
        log_xml.open("w");
        log_xml.writeln("XML Parse Error: " + err_xml.message);
        log_xml.close();
    }
    
    var doc = app.open(new File(inputFile), false);
    
    var cssFile = new File(outputFile);
    cssFile.open("w");
    cssFile.writeln("/* Extracted InDesign Template Styles */");
    
    function isValidValue(val) {
        if (val === null || val === undefined || val === "") {
            return false;
        }
        var str = val.toString();
        if (str === "1851876449" || str === "-1851876449" || str === "Nothing" || str === "none") {
            return false;
        }
        var num = Number(val);
        if (!isNaN(num)) {
            if (num === 1851876449 || num === -1851876449 || num > 100000) {
                return false;
            }
        }
        return true;
    }
    
    function getHTMLSelector(tagType, xpath, styleName) {
        if (!xpath) return null;
        var xpath_lower = xpath.toLowerCase();
        
        // Character styles mapping
        if (tagType === "cstyle") {
            if (xpath_lower === "//italic" || xpath_lower === "italic") return "em, i";
            if (xpath_lower === "//bold" || xpath_lower === "bold") return "strong, b";
            if (xpath_lower === "//sub" || xpath_lower === "subscript") return "sub";
            if (xpath_lower === "//sup" || xpath_lower === "superscript") return "sup";
            if (xpath_lower === "//underline" || xpath_lower === "underline") return "u";
            if (xpath_lower === "//monospace" || xpath_lower === "monospace") return "code, kbd";
            
            if (xpath_lower.indexOf("mixed-citation//source") !== -1) return ".bib_journal";
            if (xpath_lower.indexOf("mixed-citation//volume") !== -1) return ".bib_volume";
            if (xpath_lower.indexOf("mixed-citation//issue") !== -1) return ".bib_issue";
            if (xpath_lower.indexOf("mixed-citation//fpage") !== -1) return ".bib_fpage";
            if (xpath_lower.indexOf("mixed-citation//lpage") !== -1) return ".bib_lpage";
            if (xpath_lower.indexOf("mixed-citation//year") !== -1) return ".bib_year";
            
            return "." + styleName.replace(/[^a-zA-Z0-9_\-]/g, "_");
        }
        
        // Paragraph / Block / Multi styles mapping
        var normalized = xpath_lower.replace(/\/\//g, "/");
        
        if (normalized.indexOf("title-group/label") !== -1) {
            return "h2.chapter-number";
        }
        if (normalized.indexOf("title-group/title") !== -1) {
            return "h1.chapter-title";
        }
        if (normalized.indexOf("contrib-group") !== -1) {
            return ".chapter-authors";
        }
        if (normalized.indexOf("abstract/title") !== -1) {
            return ".abstract-title";
        }
        if (normalized.indexOf("abstract/p") !== -1) {
            return "section.abstract p";
        }
        if (normalized.indexOf("kwd-group/title") !== -1) {
            return ".keyword-title";
        }
        if (normalized.indexOf("kwd-group/kwd") !== -1) {
            return ".kwd-list li";
        }
        if (normalized.indexOf("sec/sec/sec/sec/title") !== -1) {
            return "h5";
        }
        if (normalized.indexOf("sec/sec/sec/title") !== -1) {
            return "h4";
        }
        if (normalized.indexOf("sec/sec/title") !== -1) {
            return "h3.subsection-heading";
        }
        if (normalized.indexOf("sec/title") !== -1) {
            return "h2.section-heading";
        }
        if (normalized.indexOf("sec/p") !== -1) {
            return "p";
        }
        if (normalized.indexOf("fig/caption") !== -1) {
            return ".figure-caption";
        }
        if (normalized.indexOf("fig/p") !== -1) {
            return ".figure-source";
        }
        if (normalized.indexOf("table-wrap/caption") !== -1) {
            return ".table-caption";
        }
        if (normalized.indexOf("ref/mixed-citation/label") !== -1) {
            return "li.ref-item label";
        }
        if (normalized.indexOf("ref/mixed-citation") !== -1) {
            return "li.ref-item";
        }
        if (normalized.indexOf("boxed-text") !== -1) {
            if (normalized.indexOf("caption") !== -1) {
                return ".boxed-text-title, .boxed-caption";
            }
            if (normalized.indexOf("attrib") !== -1) {
                return ".boxed-text-attrib";
            }
            if (normalized.indexOf("p") !== -1) {
                return ".boxed-text p";
            }
            return ".boxed-text";
        }
        if (normalized.indexOf("disp-quote") !== -1) {
            return "blockquote";
        }
        
        if (normalized.indexOf("list[@list-type=\"order\"]") !== -1 || normalized.indexOf("list[@list-type='order']") !== -1) {
            return "ol.item-list li";
        }
        if (normalized.indexOf("list[@list-type=\"bullet\"]") !== -1 || normalized.indexOf("list[@list-type='bullet']") !== -1) {
            return "ul.item-list li";
        }
        
        var parts = normalized.split("/");
        var lastTag = parts[parts.length - 1];
        lastTag = lastTag.replace(/\[[^\]]+\]/g, "");
        
        if (lastTag === "p") return "p";
        if (lastTag === "title") return "h2.section-heading";
        if (lastTag === "caption") return "caption";
        
        return "." + styleName.replace(/[^a-zA-Z0-9_\-]/g, "_");
    }
    
    function cleanSelector(styleName, isParagraphStyle) {
        var defaultSelector = "." + styleName.replace(/[^a-zA-Z0-9_\-]/g, "_");
        if (mapping[styleName]) {
            var item = mapping[styleName];
            var selector = getHTMLSelector(item.tagType, item.xpath, styleName);
            if (selector) {
                return selector;
            }
        }
        return defaultSelector;
    }
    
    function toHex(val) {
        var hex = val.toString(16);
        return hex.length === 1 ? "0" + hex : hex;
    }
    
    function getRGB(color) {
        if (!color || !color.colorValue) return null;
        var vals = color.colorValue;
        var space = color.space.toString();
        var r, g, b;
        if (space.indexOf("RGB") !== -1) {
            r = Math.round(vals[0]);
            g = Math.round(vals[1]);
            b = Math.round(vals[2]);
        } else if (space.indexOf("CMYK") !== -1) {
            var c = vals[0] / 100;
            var m = vals[1] / 100;
            var y = vals[2] / 100;
            var k = vals[3] / 100;
            r = Math.round(255 * (1 - c) * (1 - k));
            g = Math.round(255 * (1 - m) * (1 - k));
            b = Math.round(255 * (1 - y) * (1 - k));
        } else {
            return null;
        }
        return "#" + toHex(r) + toHex(g) + toHex(b);
    }
    
    // Process paragraph styles
    var pStyles = doc.allParagraphStyles;
    for (var i = 0; i < pStyles.length; i++) {
        var style = pStyles[i];
        if (style.name === "[No Paragraph Style]" || style.name === "NormalParagraphStyle") continue;
        
        var selector = cleanSelector(style.name, true);
        cssFile.writeln(selector + " {");
        
        try {
            if (style.appliedFont) {
                cssFile.writeln("  font-family: '" + style.appliedFont.fontFamily + "', sans-serif;");
            }
        } catch(e) {}
        
        try {
            if (isValidValue(style.pointSize)) {
                cssFile.writeln("  font-size: " + style.pointSize + "pt;");
            }
        } catch(e) {}
        
        try {
            var leading = style.leading;
            if (typeof leading === "number" && isValidValue(leading)) {
                cssFile.writeln("  line-height: " + leading + "pt;");
            } else if (isValidValue(style.pointSize)) {
                cssFile.writeln("  line-height: " + (style.pointSize * 1.2) + "pt;");
            }
        } catch(e) {}
        
        try {
            var color = getRGB(style.fillColor);
            if (color) {
                cssFile.writeln("  color: " + color + ";");
            }
        } catch(e) {}
        
        try {
            var just = style.justification.toString();
            var align = "left";
            if (just.indexOf("CENTER") !== -1) align = "center";
            else if (just.indexOf("RIGHT") !== -1) align = "right";
            else if (just.indexOf("JUSTIFIED") !== -1) align = "justify";
            cssFile.writeln("  text-align: " + align + ";");
        } catch(e) {}
        
        try {
            if (isValidValue(style.firstLineIndent)) cssFile.writeln("  text-indent: " + style.firstLineIndent + "pt;");
            if (isValidValue(style.leftIndent)) cssFile.writeln("  margin-left: " + style.leftIndent + "pt;");
            if (isValidValue(style.rightIndent)) cssFile.writeln("  margin-right: " + style.rightIndent + "pt;");
            if (isValidValue(style.spaceBefore)) cssFile.writeln("  margin-top: " + style.spaceBefore + "pt;");
            if (isValidValue(style.spaceAfter)) cssFile.writeln("  margin-bottom: " + style.spaceAfter + "pt;");
        } catch(e) {}
        
        try {
            var fontStyle = style.fontStyle;
            if (fontStyle) {
                if (fontStyle.indexOf("Bold") !== -1) cssFile.writeln("  font-weight: bold;");
                if (fontStyle.indexOf("Italic") !== -1) cssFile.writeln("  font-style: italic;");
            }
        } catch(e) {}
        
        cssFile.writeln("}");
        cssFile.writeln("");
    }
    
    // Process character styles
    var cStyles = doc.allCharacterStyles;
    for (var j = 0; j < cStyles.length; j++) {
        var cStyle = cStyles[j];
        if (cStyle.name === "[No Character Style]") continue;
        
        var charSelector = cleanSelector(cStyle.name, false);
        cssFile.writeln(charSelector + " {");
        
        try {
            if (isValidValue(cStyle.pointSize)) {
                cssFile.writeln("  font-size: " + cStyle.pointSize + "pt;");
            }
        } catch(e) {}
        
        try {
            var charColor = cStyle.fillColor;
            if (charColor && charColor.colorValue) {
                var cRgb = getRGB(charColor);
                if (cRgb) {
                    cssFile.writeln("  color: " + cRgb + ";");
                }
            }
        } catch(e) {}
        
        try {
            var cFontStyle = cStyle.fontStyle;
            if (cFontStyle) {
                if (cFontStyle.indexOf("Bold") !== -1) cssFile.writeln("  font-weight: bold;");
                if (cFontStyle.indexOf("Italic") !== -1) cssFile.writeln("  font-style: italic;");
            }
        } catch(e) {}
        
        cssFile.writeln("}");
        cssFile.writeln("");
    }
    
    cssFile.close();
    doc.close(SaveOptions.NO);
} catch(err) {
    var errLog = new File(outputFile + ".err.log");
    errLog.open("w");
    errLog.writeln(err.message + "\nLine: " + err.line);
    errLog.close();
}
