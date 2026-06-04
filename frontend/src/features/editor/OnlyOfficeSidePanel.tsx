import { useState, useEffect } from "react";
import { AlertTriangle, Clock, FileText, Plus } from "lucide-react";
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
}

type PanelTab = "styles" | "issues" | "versions";

const TAB_ICONS = [
  { key: "styles" as PanelTab, icon: FileText, label: "Paragraph Styles" },
  { key: "issues" as PanelTab, icon: AlertTriangle, label: "Technical Issues" },
  { key: "versions" as PanelTab, icon: Clock, label: "Version History" },
];

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
}: OnlyOfficeSidePanelProps) {
  const [activeTab, setActiveTab] = useState<PanelTab>("styles");
  const [currentStyle, setCurrentStyle] = useState<string>("");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [localStyles, setLocalStyles] = useState<string[]>([]);
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

  return (
    <div className="w-64 flex-shrink-0 border-r border-border bg-white flex flex-col h-full min-h-0 shadow-sm">
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
      <div className="flex-1 min-h-0 overflow-y-auto">
        {activeTab === "styles" && (
          <div>
            {/* Current style indicator (mirrors the WYSIWYG StylesPanel) */}
            <div className="px-3 py-2 border-b border-border bg-background flex items-center gap-2">
              <span className="text-[10px] text-muted uppercase font-bold">Current:</span>
              <span className="px-2 py-0.5 bg-amber-100 text-amber-900 border border-amber-300 rounded text-[10px] font-semibold truncate">
                {currentStyle || (connector ? "Normal" : "â€”")}
              </span>
            </div>

            {!connector && (
              <p className="text-[11px] text-amber-700 px-3 py-2 bg-amber-50 border-b border-amber-100">
                Waiting for the editor to loadâ€¦ place the cursor in a paragraph, then click a style.
              </p>
            )}

            {allStyles.length === 0 && (
              <p className="text-xs text-muted px-3 py-4 text-center">Loading stylesâ€¦</p>
            )}

            {allStyles.map((style) => {
              const active = currentStyle === style;
              return (
                <button
                  key={style}
                  onClick={() => applyStyle(connector, style)}
                  disabled={!connector}
                  className={`group w-full text-left px-3 py-2 text-xs transition-colors border-b border-border last:border-b-0 cursor-pointer bg-transparent flex items-center justify-between disabled:opacity-50 disabled:cursor-not-allowed ${
                    active ? "bg-emerald-50 text-emerald-900 font-bold" : "text-text hover:bg-sidebar/3"
                  }`}
                  title={`Apply: ${style}`}
                >
                  <span className="truncate">{style}</span>
                  {active ? (
                    <span className="w-2 h-2 rounded-full bg-emerald-600 shrink-0" />
                  ) : (
                    <span className="text-[9px] font-semibold px-1.5 py-0.5 bg-text/10 text-white rounded opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                      Apply
                    </span>
                  )}
                </button>
              );
            })}

            {/* New Style â€” creates the style (if missing) and applies it to the selection */}
            <div className="p-3 border-t border-border sticky bottom-0 bg-white">
              <button
                type="button"
                onClick={() => setIsDialogOpen(true)}
                disabled={!connector}
                className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-[11px] font-semibold text-text bg-background border border-border rounded-md hover:bg-sidebar/3 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                title="Create a new paragraph style and apply it"
              >
                <Plus className="w-3 h-3" />
                New Style
              </button>
            </div>
          </div>
        )}

        {activeTab === "issues" && findings && (
          <div>
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
                    <p className="text-[11px] text-emerald-600 mt-0.5 font-mono truncate">â†’ {f.replacement}</p>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {activeTab === "versions" && (
          <div className="p-2">
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
          // Create the paragraph style in the document (if new) and apply it.
          applyStyle(connector, styleName, true);
        }}
      />
    </div>
  );
}
