import { type RefObject, useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, Clock, FileText, Layers, Search, Sparkles, X } from "lucide-react";
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

const TABS: { key: PanelTab; icon: typeof FileText; label: string; short: string }[] = [
  { key: "styles", icon: Layers, label: "Paragraph Styles", short: "Styles" },
  { key: "issues", icon: AlertTriangle, label: "Technical Issues", short: "Issues" },
  { key: "versions", icon: Clock, label: "Version History", short: "History" },
];

function applyStyle(iframeRef: RefObject<HTMLIFrameElement>, style: string) {
  iframeRef.current?.contentWindow?.postMessage(
    JSON.stringify({ MessageId: "Action_SetParagraphStyle", Values: { Style: style } }),
    "*"
  );
}

function gotoParagraph(iframeRef: RefObject<HTMLIFrameElement>, paraIndex: number) {
  iframeRef.current?.contentWindow?.postMessage(
    JSON.stringify({ MessageId: "Action_GotoOutlineIndex", Values: { Index: paraIndex } }),
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
  const [styleQuery, setStyleQuery] = useState("");

  const visibleTabs = useMemo(
    () => TABS.filter((t) => t.key !== "issues" || (findings && findings.length > 0)),
    [findings]
  );

  const filteredStyles = useMemo(() => {
    const q = styleQuery.trim().toLowerCase();
    if (!q) return styles;
    return styles.filter((s) => s.toLowerCase().includes(q));
  }, [styles, styleQuery]);

  const issueCount = findings?.length ?? 0;
  const activeTabMeta = visibleTabs.find((t) => t.key === activeTab) ?? visibleTabs[0];

  return (
    <aside className="w-72 flex-shrink-0 border-r border-border bg-white flex flex-col h-full shadow-sm">
      {/* ── Panel header ─────────────────────────────────────────────────── */}
      <div className="px-4 py-3 border-b border-border bg-gradient-to-b from-surface-50 to-white">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-md bg-primary/10 flex items-center justify-center">
            <Sparkles className="w-3.5 h-3.5 text-primary" />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] uppercase font-semibold tracking-wider text-muted leading-none">
              Editor Toolkit
            </p>
            <p className="mt-0.5 text-xs font-semibold text-text">{activeTabMeta?.label}</p>
          </div>
        </div>
      </div>

      {/* ── Tab bar ──────────────────────────────────────────────────────── */}
      <div role="tablist" className="flex border-b border-border bg-surface-50/60">
        {visibleTabs.map(({ key, icon: Icon, short, label }) => {
          const isActive = activeTab === key;
          const count = key === "issues" ? issueCount : key === "styles" ? styles.length : undefined;
          return (
            <button
              key={key}
              role="tab"
              aria-selected={isActive}
              onClick={() => setActiveTab(key)}
              title={label}
              className={[
                "relative flex-1 inline-flex flex-col items-center justify-center gap-0.5 py-2 px-1",
                "text-[10px] font-medium transition-colors",
                "focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/30",
                isActive
                  ? "bg-white text-primary"
                  : "text-muted hover:text-text hover:bg-white/70",
              ].join(" ")}
            >
              <Icon className={`w-4 h-4 ${isActive ? "text-primary" : "text-muted"}`} />
              <span className="flex items-center gap-1">
                {short}
                {count !== undefined && count > 0 && (
                  <span
                    className={[
                      "inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full text-[9px] font-bold",
                      isActive ? "bg-primary/15 text-primary" : "bg-border/60 text-muted",
                    ].join(" ")}
                  >
                    {count > 99 ? "99+" : count}
                  </span>
                )}
              </span>
              {isActive && (
                <span
                  aria-hidden="true"
                  className="absolute inset-x-2 -bottom-px h-0.5 bg-primary rounded-full"
                />
              )}
            </button>
          );
        })}
      </div>

      {/* ── Tab content ──────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {/* Styles tab */}
        {activeTab === "styles" && (
          <div className="flex flex-col h-full">
            {/* Search */}
            <div className="p-3 border-b border-border bg-white sticky top-0 z-10">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-muted absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={styleQuery}
                  onChange={(e) => setStyleQuery(e.target.value)}
                  placeholder="Search styles…"
                  className={[
                    "w-full pl-8 pr-8 py-1.5 text-xs bg-surface-50 border border-border rounded-md",
                    "placeholder:text-muted",
                    "focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40 focus:bg-white",
                    "transition-colors",
                  ].join(" ")}
                />
                {styleQuery && (
                  <button
                    type="button"
                    onClick={() => setStyleQuery("")}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-border/50"
                    aria-label="Clear search"
                  >
                    <X className="w-3 h-3 text-muted" />
                  </button>
                )}
              </div>
            </div>

            {/* Styles list */}
            <div className="flex-1 overflow-y-auto">
              {styles.length === 0 ? (
                <div className="px-4 py-6 text-center">
                  <Layers className="w-6 h-6 text-muted opacity-40 mx-auto mb-1.5" />
                  <p className="text-xs text-muted">Loading styles…</p>
                </div>
              ) : filteredStyles.length === 0 ? (
                <div className="px-4 py-6 text-center">
                  <Search className="w-5 h-5 text-muted opacity-40 mx-auto mb-1.5" />
                  <p className="text-xs text-muted">No styles match “{styleQuery}”.</p>
                </div>
              ) : (
                <ul className="divide-y divide-border/60">
                  {filteredStyles.map((style) => (
                    <li key={style}>
                      <button
                        onClick={() => applyStyle(iframeRef, style)}
                        className={[
                          "group w-full flex items-center gap-2 text-left px-3 py-2 text-xs text-text",
                          "hover:bg-primary/5 focus:outline-none focus-visible:bg-primary/5",
                          "focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/30",
                          "transition-colors",
                        ].join(" ")}
                        title={`Apply: ${style}`}
                      >
                        <span
                          className="w-1 h-1 rounded-full bg-muted/50 group-hover:bg-primary transition-colors"
                          aria-hidden="true"
                        />
                        <span className="flex-1 truncate">{style}</span>
                        <ArrowRight className="w-3 h-3 text-muted opacity-0 group-hover:opacity-100 group-hover:text-primary transition-opacity" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}

        {/* Issues tab */}
        {activeTab === "issues" && findings && (
          <div>
            {findings.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <div className="w-10 h-10 rounded-full bg-success-100 mx-auto flex items-center justify-center mb-2">
                  <AlertTriangle className="w-5 h-5 text-success-700" />
                </div>
                <p className="text-xs font-medium text-text">No issues found</p>
                <p className="text-[11px] text-muted mt-0.5">Document passes all rules.</p>
              </div>
            ) : (
              <ul className="divide-y divide-border/60">
                {findings.map((f, i) => (
                  <li key={i}>
                    <button
                      type="button"
                      onClick={() => f.para_index !== undefined && gotoParagraph(iframeRef, f.para_index)}
                      className={[
                        "group w-full text-left px-3 py-2.5 hover:bg-primary/5 transition-colors",
                        "focus:outline-none focus-visible:bg-primary/5 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/30",
                      ].join(" ")}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="inline-flex items-center gap-1.5 text-[10px] uppercase font-semibold tracking-wider text-muted truncate">
                          <AlertTriangle className="w-3 h-3 text-warning-600 shrink-0" />
                          {f.rule_id}
                        </span>
                        {f.count !== undefined && f.count > 0 && (
                          <span className="text-[10px] font-bold bg-warning-100 text-warning-800 px-1.5 py-0.5 rounded-full shrink-0">
                            ×{f.count}
                          </span>
                        )}
                      </div>
                      {f.surface && (
                        <p className="text-[11px] text-text mt-1 font-mono truncate group-hover:text-primary transition-colors">
                          {f.surface}
                        </p>
                      )}
                      {f.replacement && (
                        <p className="flex items-center gap-1 text-[11px] text-success-800 mt-0.5 font-mono truncate">
                          <ArrowRight className="w-3 h-3 shrink-0 text-success-600" />
                          {f.replacement}
                        </p>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Versions tab */}
        {activeTab === "versions" && (
          <div className="p-2">
            <VersionHistoryPanel
              fileId={fileId}
              currentFileId={fileId}
              onOpenVersion={onOpenVersion ?? (() => {})}
              defaultExpanded
            />
          </div>
        )}
      </div>
    </aside>
  );
}
