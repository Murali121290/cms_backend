import { type RefObject, useState } from "react";
import { AlertTriangle, Clock, FileText } from "lucide-react";
import { VersionHistoryPanel } from "@/features/structuringReview/components/VersionHistoryPanel";

interface Finding {
  rule_id: string;
  surface?: string;
  para_index?: number;
  count?: number;
  replacement?: string;
}

interface CollaboraSidePanelProps {
  iframeRef: RefObject<HTMLIFrameElement>;
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

function applyStyle(iframeRef: RefObject<HTMLIFrameElement>, style: string) {
  iframeRef.current?.contentWindow?.postMessage(
    JSON.stringify({ MessageId: "Action_SetParagraphStyle", Values: { Style: style } }),
    "*"
  );
}

export function CollaboraSidePanel({
  iframeRef,
  styles,
  fileId,
  onOpenVersion,
  findings,
}: CollaboraSidePanelProps) {
  const [activeTab, setActiveTab] = useState<PanelTab>("styles");
  const visibleTabs = TAB_ICONS.filter((t) => t.key !== "issues" || (findings && findings.length > 0));

  return (
    <div className="w-64 flex-shrink-0 border-r border-border bg-white flex flex-col h-full shadow-sm">
      {/* Tab icons row */}
      <div className="flex border-b border-border bg-background">
        {visibleTabs.map(({ key, icon: Icon, label }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            title={label}
            className={`flex-1 flex items-center justify-center py-2.5 transition-colors ${
              activeTab === key
                ? "bg-white text-text border-b-2 border-text"
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
      <div className="flex-1 overflow-y-auto">
        {activeTab === "styles" && (
          <div>
            {styles.length === 0 && (
              <p className="text-xs text-muted px-3 py-4 text-center">Loading stylesâ€¦</p>
            )}
            {styles.map((style) => (
              <button
                key={style}
                onClick={() => applyStyle(iframeRef, style)}
                className="w-full text-left px-3 py-2 text-xs text-text hover:bg-sidebar/3 transition-colors border-b border-border last:border-b-0"
                title={`Apply: ${style}`}
              >
                {style}
              </button>
            ))}
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
                    if (f.para_index !== undefined) {
                      iframeRef.current?.contentWindow?.postMessage(
                        JSON.stringify({ MessageId: "Action_GotoOutlineIndex", Values: { Index: f.para_index } }),
                        "*"
                      );
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
    </div>
  );
}
