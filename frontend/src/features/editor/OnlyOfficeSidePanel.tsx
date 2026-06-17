import { useState, useEffect } from "react";
import { AlertTriangle, Clock, FileText, Plus, Search, X } from "lucide-react";
import { VersionHistoryPanel } from "@/features/structuringReview/components/VersionHistoryPanel";
import { NewStyleDialog } from "@/features/structuringReview/components/NewStyleDialog";

interface Finding {
  rule_id: string;
  surface?: string;
  para_index?: number;
  count?: number;
  replacement?: string;
}

interface OnlyOfficeSidePanelProps {
  connector: any;
  styles: string[];
  fileId: number;
  onOpenVersion?: (versionId: number) => void;
  findings?: Finding[];
  onAddStyle?: (newStyle: string) => void;
}

type PanelTab = "styles" | "issues" | "versions";

const TAB_ICONS = [
  { key: "styles" as PanelTab, icon: FileText, label: "Paragraph Styles" },
  { key: "issues" as PanelTab, icon: AlertTriangle, label: "Technical Issues" },
  { key: "versions" as PanelTab, icon: Clock, label: "Version History" },
];

function HighlightedText({ text, highlight }: { text: string; highlight: string }) {
  if (!highlight.trim()) {
    return <span>{text}</span>;
  }
  const regex = new RegExp(`(${highlight.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&")})`, "gi");
  const parts = text.split(regex);
  return (
    <span>
      {parts.map((part, idx) =>
        part.toLowerCase() === highlight.toLowerCase() ? (
          <mark key={idx} className="bg-amber-200 text-amber-950 font-bold px-0.5 rounded">
            {part}
          </mark>
        ) : (
          <span key={idx}>{part}</span>
        )
      )}
    </span>
  );
}

// Build the editor-context script that resolves an ApiStyle by name (optionally
// creating it) and applies it to EVERY paragraph in the selection, falling back
// to the cursor's paragraph when there is no multi-paragraph selection.
function buildApplyStyleScript(style: string, create: boolean): string {
  const safe = String(style).replace(/["'\\]/g, "");
  return `
    var oDocument = Api.GetDocument();
    var oStyle = oDocument.GetStyle("${safe}");
    ${create ? `if (!oStyle) { oStyle = oDocument.CreateStyle("${safe}", "paragraph"); }` : ""}
    if (!oStyle) return;
    var applied = false;
    var oRange = oDocument.GetRangeBySelect();
    if (oRange && oRange.GetAllParagraphs) {
      var paras = oRange.GetAllParagraphs();
      if (paras && paras.length) {
        for (var i = 0; i < paras.length; i++) { paras[i].SetStyle(oStyle); }
        applied = true;
      }
    }
    if (!applied) {
      var oPara = oDocument.GetCurrentParagraph();
      if (oPara) { oPara.SetStyle(oStyle); }
    }
  `;
}

function applyStyle(connector: any, style: string, create = false) {
  if (!connector) return;
  try {
    connector.callCommand(new Function(buildApplyStyleScript(style, create)) as any, function () {});
  } catch (e) {
    console.error("Failed to apply style via OnlyOffice connector:", e);
  }
}

// Read the style name of the paragraph at the cursor, for the "Current" indicator.
function readCurrentStyle(connector: any, cb: (name: string) => void) {
  if (!connector) return;
  const body = `
    var oDocument = Api.GetDocument();
    var oPara = oDocument.GetCurrentParagraph();
    return (oPara && oPara.GetStyle()) ? oPara.GetStyle().GetName() : "";
  `;
  try {
    connector.callCommand(new Function(body) as any, function (result: any) {
      if (typeof result === "string") cb(result);
    });
  } catch (e) {
    /* ignore */
  }
}

function jumpToFinding(connector: any, surface: string) {
  if (!connector || !surface) return;
  try {
    connector.executeMethod("SearchAndReplace", [{
      searchString: surface,
      replaceString: "",
      matchCase: true,
      findNext: true
    }]);
  } catch (e) {
    console.error("Failed to jump to finding via OnlyOffice connector:", e);
  }
}

export function OnlyOfficeSidePanel({
  connector,
  styles,
  fileId,
  onOpenVersion,
  findings,
  onAddStyle,
}: OnlyOfficeSidePanelProps) {
  const [activeTab, setActiveTab] = useState<PanelTab>("styles");
  const [currentStyle, setCurrentStyle] = useState<string>("");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [localStyles, setLocalStyles] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [copiedStyle, setCopiedStyle] = useState<string | null>(null);

  const handleStyleClick = (style: string, create = false) => {
    if (connector) {
      applyStyle(connector, style, create);
    } else {
      // Find the ONLYOFFICE editor iframe
      const iframe = document.querySelector('iframe[src*="web-apps"], iframe[id="iframeEditor"]') as HTMLIFrameElement;
      if (iframe && iframe.contentWindow) {
        try {
          const dataMessage = {
            frameEditorId: iframe.id || "iframeEditor",
            guid: "asc.{4c1b92a4-793d-4251-ba23-1451e06eeafd}",
            type: "onExternalPluginMessage",
            data: {
              action: "applyStyle",
              styleName: style,
              create: create
            }
          };
          iframe.contentWindow.postMessage(JSON.stringify(dataMessage), "*");
          
          // Use copiedStyle state to show a brief "Applied" style feedback badge
          setCopiedStyle(style);
          setTimeout(() => setCopiedStyle(null), 1000);
        } catch (e) {
          console.error("Failed to post style command to ONLYOFFICE plugin:", e);
        }
      } else {
        // Fallback to clipboard if iframe is not found
        navigator.clipboard.writeText(style).then(() => {
          setCopiedStyle(style);
          setTimeout(() => setCopiedStyle(null), 1500);
        });
      }
    }
  };
  const visibleTabs = TAB_ICONS.filter((t) => t.key !== "issues" || (findings && findings.length > 0));

  // Styles from the document plus any created here this session.
  const allStyles = Array.from(new Set([...styles, ...localStyles]));

  // Reflect the style of the paragraph under the cursor while the Styles tab is
  // open. OnlyOffice exposes no host-side "selection changed" event, so poll.
  useEffect(() => {
    if (!connector || activeTab !== "styles") return;
    let cancelled = false;
    const tick = () => readCurrentStyle(connector, (name) => { if (!cancelled) setCurrentStyle(name); });
    tick();
    const id = window.setInterval(tick, 1500);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [connector, activeTab]);

  const filteredStyles = allStyles.filter((style) =>
    style.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div 
      className="w-64 flex-shrink-0 border-r border-border bg-white flex flex-col h-full min-h-0 shadow-sm"
      style={{ height: "100%", maxHeight: "100%", overflow: "hidden" }}
    >
      {/* Tab icons row */}
      <div className="flex border-b border-border bg-background">
        {visibleTabs.map(({ key, icon: Icon, label }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            title={label}
            className={`flex-1 flex items-center justify-center py-2.5 transition-colors cursor-pointer border-t-0 border-x-0 bg-transparent ${
              activeTab === key
                ? "bg-white text-text border-b-2 border-text font-bold"
                : "text-muted hover:text-text hover:bg-white"
            }`}
          >
            <Icon className="w-4 h-4" />
          </button>
        ))}
      </div>

      {/* Tab label */}
      <div className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-muted border-b border-border bg-background">
        {TAB_ICONS.find((t) => t.key === activeTab)?.label}
      </div>

      {/* Tab content */}
      <div className="flex-1 min-h-0 flex flex-col bg-white">
        {activeTab === "styles" && (
          <div className="flex-1 flex flex-col min-h-0">
            {/* Current style indicator (mirrors the WYSIWYG StylesPanel) */}
            <div className="flex-shrink-0 px-3 py-2 border-b border-border bg-background flex items-center gap-2">
              <span className="text-[10px] text-muted uppercase font-bold">Current:</span>
              <span className="px-2 py-0.5 bg-amber-100 text-amber-900 border border-amber-300 rounded text-[10px] font-semibold truncate">
                {currentStyle || (connector ? "Normal" : "—")}
              </span>
            </div>

            {/* Search Input */}
            <div className="flex-shrink-0 px-3 py-2 border-b border-border bg-background flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-muted" />
                <input
                  type="text"
                  placeholder="Search or add style..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && searchQuery.trim()) {
                      const clean = searchQuery.trim();
                      const matched = filteredStyles.find(
                        (s) => s.toLowerCase() === clean.toLowerCase()
                      );
                      if (matched) {
                        handleStyleClick(matched);
                      } else {
                        if (!localStyles.includes(clean) && !styles.includes(clean)) {
                          setLocalStyles((prev) => [...prev, clean]);
                        }
                        if (onAddStyle) {
                          onAddStyle(clean);
                        }
                        handleStyleClick(clean, true);
                      }
                      setSearchQuery("");
                    }
                  }}
                  className="w-full pl-8 pr-7 py-1.5 text-xs border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary bg-white text-text font-medium"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery("")}
                    className="absolute right-2 top-2 p-0.5 hover:bg-slate-100 rounded text-muted hover:text-text cursor-pointer border-none bg-transparent"
                    title="Clear search"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>

            {/* Scrollable style list */}
            <div className="flex-1 overflow-y-auto styles-scrollbar p-2 space-y-1">
              {!connector && (
                <div className="text-[10px] text-emerald-800 px-2.5 py-1.5 bg-emerald-50 rounded-md border border-emerald-200/60 mb-2 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 animate-ping shrink-0" />
                  <span>Direct style integration active.</span>
                </div>
              )}

              {searchQuery && !allStyles.some(s => s.toLowerCase() === searchQuery.toLowerCase().trim()) && (
                <button
                  onClick={() => {
                    const clean = searchQuery.trim();
                    if (clean) {
                      if (!localStyles.includes(clean) && !styles.includes(clean)) {
                        setLocalStyles((prev) => [...prev, clean]);
                      }
                      if (onAddStyle) {
                        onAddStyle(clean);
                      }
                      handleStyleClick(clean, true);
                      setSearchQuery("");
                    }
                  }}
                  className="w-full text-left px-3 py-2.5 bg-primary/10 border border-primary/20 text-primary hover:bg-primary/20 rounded-md text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">
                    Create & Apply "{searchQuery.trim()}"
                  </span>
                </button>
              )}

              {filteredStyles.length === 0 && !searchQuery && (
                <p className="text-xs text-muted py-4 text-center">Loading styles…</p>
              )}

              {filteredStyles.length === 0 && searchQuery && (
                <p className="text-xs text-muted py-4 text-center">No matching styles found</p>
              )}

              {filteredStyles.map((style) => {
                const active = currentStyle === style;
                const isCopied = copiedStyle === style;
                return (
                  <button
                    key={style}
                    onClick={() => handleStyleClick(style)}
                    className={`group w-full text-left px-3 py-2 text-xs transition-colors border-b border-border last:border-b-0 cursor-pointer bg-transparent flex items-center justify-between ${
                      active ? "bg-emerald-50 text-emerald-900 font-bold" : "text-text hover:bg-sidebar/3"
                    }`}
                    title={`Apply style: ${style}`}
                  >
                    <span className="truncate">
                      <HighlightedText text={style} highlight={searchQuery} />
                    </span>
                    {active ? (
                      <span className="w-2 h-2 rounded-full bg-emerald-600 shrink-0" />
                    ) : isCopied ? (
                      <span className="text-[9px] font-semibold px-1.5 py-0.5 bg-emerald-100 text-emerald-800 rounded shrink-0">
                        Applied!
                      </span>
                    ) : (
                      <span className="text-[9px] font-semibold px-1.5 py-0.5 bg-text/10 text-white rounded opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                        Apply
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Fixed footer New Style button */}
            <div className="flex-shrink-0 p-3 border-t border-border bg-white">
              <button
                type="button"
                onClick={() => setIsDialogOpen(true)}
                className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-[11px] font-semibold text-text bg-background border border-border rounded-md hover:bg-sidebar/3 transition-colors cursor-pointer"
                title="Create a new paragraph style"
              >
                <Plus className="w-3 h-3" />
                New Style
              </button>
            </div>
          </div>
        )}

        {activeTab === "issues" && findings && (
          <div className="flex-1 overflow-y-auto styles-scrollbar">
            {findings.length === 0 ? (
              <p className="text-xs text-emerald-600 px-3 py-4 text-center">No issues found.</p>
            ) : (
              findings.map((f, i) => (
                <div
                  key={i}
                  className="px-3 py-2.5 border-b border-border hover:bg-sidebar/3 transition-colors cursor-pointer"
                  onClick={() => {
                    if (f.surface) {
                      jumpToFinding(connector, f.surface);
                    }
                  }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-[10px] font-bold text-muted uppercase truncate flex-1">
                      {f.rule_id}
                    </span>
                    {f.count !== undefined && (
                      <span className="text-[10px] font-bold bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded flex-shrink-0">
                        {f.count}
                      </span>
                    )}
                  </div>
                  {f.surface && (
                    <p className="text-[11px] text-text mt-0.5 font-mono truncate">{f.surface}</p>
                  )}
                  {f.replacement && (
                    <p className="text-[11px] text-emerald-600 mt-0.5 font-mono truncate">→ {f.replacement}</p>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {activeTab === "versions" && (
          <div className="flex-1 overflow-y-auto styles-scrollbar p-2">
            <VersionHistoryPanel
              fileId={fileId}
              currentFileId={fileId}
              onOpenVersion={onOpenVersion ?? (() => {})}
            />
          </div>
        )}
      </div>

      <NewStyleDialog
        isOpen={isDialogOpen}
        onClose={() => setIsDialogOpen(false)}
        onAdd={(styleName) => {
          if (!localStyles.includes(styleName) && !styles.includes(styleName)) {
            setLocalStyles((prev) => [...prev, styleName]);
          }
          if (onAddStyle) {
            onAddStyle(styleName);
          }
          // Create the paragraph style in the document (if new) and apply it.
          handleStyleClick(styleName, true);
        }}
      />

      <style>{`
        .styles-scrollbar::-webkit-scrollbar {
          width: 5px;
        }
        .styles-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .styles-scrollbar::-webkit-scrollbar-thumb {
          background: #cbd5e1;
          border-radius: 4px;
        }
        .styles-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #94a3b8;
        }
      `}</style>
    </div>
  );
}

