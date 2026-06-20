(function(window, undefined){

    window.Asc.plugin.init = function() {
        // Background plugin automatically initializes
    };

    window.Asc.plugin.button = function(id) {
    };

    window.Asc.plugin.onExternalPluginMessage = function(data) {
        if (data && data.action === "applyStyle") {
            Asc.scope.styleName = data.styleName;
            Asc.scope.create = data.create;
            
            window.Asc.plugin.callCommand(function() {
                var oDocument = Api.GetDocument();
                var styleName = Asc.scope.styleName;
                var create = Asc.scope.create;
                
                var oStyle = oDocument.GetStyle(styleName);
                if (create && !oStyle) {
                    oStyle = oDocument.CreateStyle(styleName, "paragraph");
                }
                if (oStyle) {
                    var applied = false;
                    var oRange = oDocument.GetRangeBySelect();
                    if (oRange && oRange.GetAllParagraphs) {
                        var paras = oRange.GetAllParagraphs();
                        if (paras && paras.length) {
                            for (var i = 0; i < paras.length; i++) {
                                paras[i].SetStyle(oStyle);
                            }
                            applied = true;
                        }
                    }
                    if (!applied) {
                        var oPara = oDocument.GetCurrentParagraph();
                        if (oPara) {
                            oPara.SetStyle(oStyle);
                        }
                    }
                }
            }, false, true);
        }
    };

})(window, undefined);
