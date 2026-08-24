import { useState } from "react";
import type { ComponentType, RefObject } from "react";
import {
  AlertCircle,
  AlertTriangle,
  BookOpen,
  Calendar,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Download,
  GitBranch,
  Hash,
  Inbox,
  MinusCircle,
  RefreshCw,
  Save,
  SearchX,
  Sparkles,
  XCircle,
} from "lucide-react";

import { Button } from "@/components/ui/Button";
import type { WysiwygEditorHandle } from "@/features/editor";

import { useReferenceReviewQuery } from "../useReferenceReviewQuery";
import { useReferenceSave } from "../useReferenceSave";
import { useReferenceValidateOnly } from "../useReferenceValidateOnly";

type PanelTab = "citations" | "references" | "changes" | "issues" | "missing";

interface Props {
  fileId: number | null;
  editorRef: RefObject<WysiwygEditorHandle | null>;
}

export function ReferenceReviewSidePanel({ fileId, editorRef }: Props) {
  const [styleOverride, setStyleOverride] = useState<"AUTO" | "AMA" | "APA">("AUTO");
  const [citationFormat, setCitationFormat] =
    useState<"auto" | "superscript" | "bracket" | "paren" | "plain">("auto");
  const [activeTab, setActiveTab] = useState<PanelTab>("citations");
  const [lastValidatedAt, setLastValidatedAt] = useState<Date | null>(null);

  const reviewQuery = useReferenceReviewQuery(
    fileId,
    styleOverride === "AUTO" ? undefined : styleOverride,
    citationFormat === "auto" ? undefined : citationFormat,
  );
  const saveMutation = useReferenceSave(fileId);
  const validateMutation = useReferenceValidateOnly(fileId ?? 0);

  const logs = reviewQuery.data?.validation_logs;
  const detectedStyle = logs?.detected_style ?? "AMA";
  const citationPairs = logs?.citation_pairs ?? [];
  const referenceEntries = logs?.reference_entries ?? [];
  const issues = logs?.issues ?? [];
  const duplicates = logs?.duplicates ?? [];
  const missing = logs?.missing_references ?? [];
  const unused = logs?.unused_references ?? [];

  const citationCount = citationPairs.length;
  const referenceCount = referenceEntries.length;
  const changesCount = 0;
  const issueCount = issues.length + duplicates.length + (logs?.sequence_issues?.length ?? 0);
  const missingCount = missing.length + unused.length;
  const matchedCount = citationPairs.filter((p) => p.status === "ok").length;

  const flashBlock = (el: HTMLElement | null) => {
    if (!el || !el.scrollIntoView) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("rr-para-flash");
    setTimeout(() => el.classList.remove("rr-para-flash"), 1200);
  };

  // Locate a paragraph in the SHARED main editor by its paraIdx. Tries
  // ProseMirror node-attr lookup first, then falls back to a DOM query for
  // data-para-idx, then to indexing into top-level blocks.
  const locate = (paraIdx?: number) => {
    if (paraIdx == null || paraIdx < 0) return;
    const editor = editorRef.current?.editor;
    if (!editor) return;

    let targetPos = -1;
    editor.state.doc.descendants((node: any, pos: number) => {
      if (targetPos !== -1) return false;
      const isBlock =
        node.isBlock && (node.type.name === "paragraph" || String(node.type.name).startsWith("heading"));
      if (isBlock && node.attrs?.paraIdx != null && String(node.attrs.paraIdx) === String(paraIdx)) {
        targetPos = pos;
        return false;
      }
      return true;
    });
    if (targetPos !== -1) {
      editor.commands.focus();
      editor.commands.setTextSelection(targetPos + 1);
      try {
        const info = editor.view.domAtPos(targetPos + 1);
        const el = (info.node.nodeType === Node.TEXT_NODE ? info.node.parentElement : info.node) as HTMLElement | null;
        flashBlock(el);
      } catch {
        /* ignore */
      }
      return;
    }

    const el = editor.view.dom.querySelector(`[data-para-idx="${paraIdx}"]`) as HTMLElement | null;
    if (el) {
      editor.commands.focus();
      flashBlock(el);
      return;
    }

    const blocks = editor.view.dom.querySelectorAll("p, h1, h2, h3, h4, h5, h6, li");
    if (paraIdx < blocks.length) flashBlock(blocks[paraIdx] as HTMLElement);
  };

  const handleValidate = async () => {
    const editor = editorRef.current?.editor;
    if (!editor || !reviewQuery.data) return;
    const html = editor.getHTML();
    try {
      await saveMutation.save(reviewQuery.data.save_endpoint, html);
      await validateMutation.mutateAsync({
        style: styleOverride === "AUTO" ? undefined : styleOverride,
        citationFormat: citationFormat === "auto" ? undefined : citationFormat,
      });
      setLastValidatedAt(new Date());
      await reviewQuery.refetch();
    } catch {
      /* surfaced via saveMutation.errorMessage */
    }
  };

  const handleSave = async () => {
    const editor = editorRef.current?.editor;
    if (!editor || !reviewQuery.data) return;
    await saveMutation.save(reviewQuery.data.save_endpoint, editor.getHTML());
    await reviewQuery.refetch();
  };

  if (reviewQuery.isPending) {
    return (
      <div className="h-full flex items-center justify-center text-xs text-navy-500 p-4">
        Loading reference review…
      </div>
    );
  }
  if (reviewQuery.isError || !reviewQuery.data) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-2 p-6 text-center">
        <AlertCircle className="w-5 h-5 text-error-500" />
        <div className="text-xs text-navy-700 font-semibold">Reference review unavailable</div>
        <Button size="sm" variant="secondary" onClick={() => reviewQuery.refetch()}>
          Retry
        </Button>
      </div>
    );
  }

  const renderBody = () => {
    switch (activeTab) {
      case "citations":
        return citationPairs.length === 0 ? (
          <EmptyState Icon={Hash} message="No citations detected." />
        ) : (
          <ul className="divide-y divide-slate-100">
            {citationPairs.map((c, i) => (
              <ItemRow
                key={i}
                title={c.citation ?? `Ref [${c.ref_number ?? "?"}]`}
                subtitle={c.ref_text}
                status={c.status}
                onLocate={() => locate(c.para_idx)}
              />
            ))}
          </ul>
        );
      case "references":
        return referenceEntries.length === 0 ? (
          <EmptyState Icon={BookOpen} message="No references parsed." />
        ) : (
          <ul className="divide-y divide-slate-100">
            {referenceEntries.map((r, i) => (
              <ItemRow
                key={i}
                title={r.number != null ? `[${r.number}]` : `#${i + 1}`}
                subtitle={r.text}
                status={r.is_cited ? "ok" : "unused"}
                onLocate={() => locate(r.para_idx)}
              />
            ))}
          </ul>
        );
      case "issues":
        return issues.length === 0 && duplicates.length === 0 ? (
          <EmptyState Icon={CheckCircle2} tone="success" message="All clear — no issues." />
        ) : (
          <ul className="divide-y divide-slate-100">
            {issues.map((it, i) => (
              <ItemRow
                key={`iss-${i}`}
                title={it.type.replace(/_/g, " ")}
                subtitle={it.message}
                status="issue"
                onLocate={() => locate(it.para_idx)}
              />
            ))}
            {duplicates.map((d, i) => (
              <ItemRow
                key={`dup-${i}`}
                title={`Duplicate ${d.num1 ?? "?"} ↔ ${d.num2 ?? "?"}`}
                subtitle={`${d.text1.slice(0, 80)}… / ${d.text2.slice(0, 80)}…`}
                status="issue"
                onLocate={() => locate(d.para_idx1)}
              />
            ))}
          </ul>
        );
      case "missing":
        return missing.length === 0 && unused.length === 0 ? (
          <EmptyState Icon={CheckCircle2} tone="success" message="No missing or unused references." />
        ) : (
          <ul className="divide-y divide-slate-100">
            {missing.map((m, i) => (
              <ItemRow
                key={`m-${i}`}
                title={m.citation ?? "Missing citation"}
                subtitle={m.message}
                status="missing"
                onLocate={() => locate(m.para_idx)}
              />
            ))}
            {unused.map((u, i) => (
              <ItemRow
                key={`u-${i}`}
                title={u.citation ?? "Unused reference"}
                subtitle={u.message}
                status="unused"
                onLocate={() => locate(u.para_idx)}
              />
            ))}
          </ul>
        );
      case "changes":
        return (
          <EmptyState
            Icon={Sparkles}
            message={
              <>
                Run <span className="font-semibold text-navy-700">Validate</span> to detect
                auto-corrections. Approved changes will appear here.
              </>
            }
          />
        );
    }
  };

  return (
    <div className="h-full flex flex-col bg-white">
      <style>{`
        .rr-para-flash { animation: rr-para-flash 1.2s ease-out; }
        @keyframes rr-para-flash {
          0% { background-color: rgba(251, 191, 36, 0.35); }
          100% { background-color: transparent; }
        }
      `}</style>

      {/* Header — brand row, style + validate, at-a-glance chips */}
      <div className="shrink-0 border-b border-slate-200 bg-gradient-to-b from-slate-50 to-white">
        <div className="px-3 pt-2.5 pb-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <span className="w-6 h-6 rounded-md bg-navy-800 flex items-center justify-center shadow-sm">
              <ClipboardCheck className="w-3.5 h-3.5 text-white" />
            </span>
            <span className="text-[11px] font-bold uppercase tracking-wider text-navy-800">
              Reference Review
            </span>
          </div>
          {lastValidatedAt && (
            <span className="text-[10px] text-navy-500 flex items-center gap-1 tabular-nums">
              <Calendar className="w-3 h-3" />
              {lastValidatedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
        </div>
        <div className="px-3 pb-2 flex items-center gap-2">
          <label className="flex-1 flex items-center gap-1.5 min-w-0">
            <span className="text-[10px] font-semibold uppercase text-navy-500 shrink-0">Style</span>
            <select
              value={styleOverride}
              onChange={(e) => setStyleOverride(e.target.value as any)}
              className="flex-1 min-w-0 px-2 py-1 text-xs font-medium border border-slate-200 rounded bg-white text-navy-800 focus:outline-none focus:ring-1 focus:ring-navy-300"
            >
              <option value="AUTO">Auto · {detectedStyle}</option>
              <option value="AMA">AMA</option>
              <option value="APA">APA</option>
            </select>
          </label>
          <Button
            size="sm"
            variant="primary"
            leftIcon={<RefreshCw className="w-3.5 h-3.5" />}
            onClick={handleValidate}
            isLoading={saveMutation.isPending || validateMutation.isPending}
          >
            Validate
          </Button>
        </div>
        <div className="px-3 pb-2.5 grid grid-cols-2 gap-1.5">
          <StatCard
            Icon={AlertTriangle}
            count={issueCount}
            label={issueCount === 1 ? "Issue" : "Issues"}
            tone={issueCount > 0 ? "error" : "muted"}
          />
          <StatCard
            Icon={CheckCircle2}
            count={matchedCount}
            label="Matched"
            tone={matchedCount > 0 ? "success" : "muted"}
          />
        </div>
      </div>

      {/* Tab strip — icon + label + count, subtle tone underline when active */}
      <div className="shrink-0 flex border-b border-slate-200 bg-white">
        <TabBtn
          active={activeTab === "citations"}
          count={citationCount}
          label="Cite"
          Icon={Hash}
          onClick={() => setActiveTab("citations")}
          tone="info"
        />
        <TabBtn
          active={activeTab === "references"}
          count={referenceCount}
          label="Refs"
          Icon={BookOpen}
          onClick={() => setActiveTab("references")}
          tone="info"
        />
        <TabBtn
          active={activeTab === "changes"}
          count={changesCount}
          label="Chg"
          Icon={GitBranch}
          onClick={() => setActiveTab("changes")}
          tone="info"
        />
        <TabBtn
          active={activeTab === "issues"}
          count={issueCount}
          label="Issues"
          Icon={AlertTriangle}
          onClick={() => setActiveTab("issues")}
          tone={issueCount > 0 ? "error" : "info"}
        />
        <TabBtn
          active={activeTab === "missing"}
          count={missingCount}
          label="Miss"
          Icon={SearchX}
          onClick={() => setActiveTab("missing")}
          tone={missingCount > 0 ? "warning" : "info"}
        />
      </div>

      {/* Scrollable body */}
      <div className="flex-1 min-h-0 overflow-y-auto">{renderBody()}</div>

      {/* Status/error banner */}
      {(saveMutation.errorMessage || saveMutation.statusMessage) && (
        <div
          className={`shrink-0 px-3 py-1.5 text-[11px] font-medium border-t ${
            saveMutation.errorMessage
              ? "bg-error-50 text-error-700 border-error-200"
              : "bg-success-50 text-success-700 border-success-200"
          }`}
        >
          {saveMutation.errorMessage ?? saveMutation.statusMessage}
        </div>
      )}

      {/* Compact footer */}
      <div className="shrink-0 px-3 py-2 border-t border-slate-200 bg-slate-50 flex items-center gap-2">
        <Button
          size="sm"
          variant="secondary"
          leftIcon={<Save className="w-3.5 h-3.5" />}
          onClick={handleSave}
          isLoading={saveMutation.isPending}
        >
          Save Reference Changes
        </Button>
        {reviewQuery.data.export_href && (
          <a href={reviewQuery.data.export_href} download className="no-underline ml-auto">
            <Button size="sm" variant="ghost" leftIcon={<Download className="w-3.5 h-3.5" />}>
              Export
            </Button>
          </a>
        )}
      </div>
    </div>
  );
}

/* ─── Presentational helpers ───────────────────────────────────────────── */

type Tone = "error" | "success" | "warning" | "info" | "muted";

// Status metadata keyed by row.status — drives icon, text color, left border
// stripe, and pill color. Kept in one place so palette stays consistent.
const STATUS_META: Record<
  string,
  { Icon: ComponentType<{ className?: string }>; text: string; stripe: string; pill: string; label: string }
> = {
  ok: {
    Icon: CheckCircle2,
    text: "text-emerald-600",
    stripe: "border-l-emerald-400",
    pill: "bg-emerald-50 text-emerald-700 border-emerald-200",
    label: "OK",
  },
  missing: {
    Icon: XCircle,
    text: "text-rose-600",
    stripe: "border-l-rose-400",
    pill: "bg-rose-50 text-rose-700 border-rose-200",
    label: "Missing",
  },
  unused: {
    Icon: MinusCircle,
    text: "text-amber-600",
    stripe: "border-l-amber-400",
    pill: "bg-amber-50 text-amber-700 border-amber-200",
    label: "Unused",
  },
  issue: {
    Icon: AlertTriangle,
    text: "text-rose-600",
    stripe: "border-l-rose-500",
    pill: "bg-rose-50 text-rose-700 border-rose-200",
    label: "Issue",
  },
  default: {
    Icon: AlertCircle,
    text: "text-slate-500",
    stripe: "border-l-slate-300",
    pill: "bg-slate-100 text-slate-600 border-slate-200",
    label: "Info",
  },
};

// Prominent count card at the top — icon, big number, small label. Uses a
// subtle gradient tinted by tone so the eye can grab the counts at a glance
// without the panel feeling loud.
function StatCard({
  Icon,
  count,
  label,
  tone,
}: {
  Icon: ComponentType<{ className?: string }>;
  count: number;
  label: string;
  tone: Tone;
}) {
  const styles: Record<Tone, { bg: string; icon: string; number: string; label: string }> = {
    error: {
      bg: "bg-gradient-to-br from-rose-50 to-rose-100/60 border-rose-200",
      icon: "text-rose-600",
      number: "text-rose-900",
      label: "text-rose-700",
    },
    success: {
      bg: "bg-gradient-to-br from-emerald-50 to-emerald-100/60 border-emerald-200",
      icon: "text-emerald-600",
      number: "text-emerald-900",
      label: "text-emerald-700",
    },
    warning: {
      bg: "bg-gradient-to-br from-amber-50 to-amber-100/60 border-amber-200",
      icon: "text-amber-600",
      number: "text-amber-900",
      label: "text-amber-700",
    },
    info: {
      bg: "bg-gradient-to-br from-sky-50 to-sky-100/60 border-sky-200",
      icon: "text-sky-600",
      number: "text-sky-900",
      label: "text-sky-700",
    },
    muted: {
      bg: "bg-slate-50 border-slate-200",
      icon: "text-slate-400",
      number: "text-slate-700",
      label: "text-slate-500",
    },
  };
  const s = styles[tone];
  return (
    <div className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md border ${s.bg}`}>
      <Icon className={`w-4 h-4 shrink-0 ${s.icon}`} />
      <div className="flex flex-col leading-tight min-w-0">
        <span className={`text-sm font-extrabold tabular-nums ${s.number}`}>{count}</span>
        <span className={`text-[9px] font-semibold uppercase tracking-wide ${s.label}`}>{label}</span>
      </div>
    </div>
  );
}

function TabBtn({
  active,
  count,
  label,
  Icon,
  onClick,
  tone = "info",
}: {
  active: boolean;
  count: number;
  label: string;
  Icon: ComponentType<{ className?: string }>;
  onClick: () => void;
  tone?: Tone;
}) {
  const toneAccent: Record<Tone, { underline: string; icon: string; badge: string }> = {
    error: {
      underline: "border-rose-500",
      icon: "text-rose-600",
      badge: "bg-rose-500 text-white",
    },
    warning: {
      underline: "border-amber-500",
      icon: "text-amber-600",
      badge: "bg-amber-500 text-white",
    },
    success: {
      underline: "border-emerald-500",
      icon: "text-emerald-600",
      badge: "bg-emerald-500 text-white",
    },
    info: {
      underline: "border-navy-700",
      icon: "text-navy-700",
      badge: "bg-slate-200 text-slate-700",
    },
    muted: {
      underline: "border-slate-400",
      icon: "text-slate-500",
      badge: "bg-slate-100 text-slate-400",
    },
  };
  const t = toneAccent[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 min-w-0 py-2 px-1 text-[11px] font-semibold flex items-center justify-center gap-1 border-b-2 transition-colors cursor-pointer ${
        active
          ? `${t.underline} bg-white`
          : "border-transparent text-navy-500 hover:text-navy-800 hover:bg-slate-50"
      }`}
    >
      <Icon className={`w-3.5 h-3.5 ${active ? t.icon : count > 0 ? t.icon : "text-slate-400"}`} />
      <span className={active ? "text-navy-900" : ""}>{label}</span>
      <span
        className={`inline-flex items-center justify-center min-w-[18px] px-1 h-4 rounded-full text-[9px] font-bold tabular-nums ${
          count > 0 ? t.badge : "bg-slate-100 text-slate-400"
        }`}
      >
        {count}
      </span>
    </button>
  );
}

function ItemRow({
  title,
  subtitle,
  status,
  onLocate,
}: {
  title: string;
  subtitle: string;
  status: string;
  onLocate: () => void;
}) {
  const meta = STATUS_META[status] ?? STATUS_META.default;
  const StatusIcon = meta.Icon;
  return (
    <li
      onClick={onLocate}
      className={`group cursor-pointer flex items-start gap-2.5 pl-2 pr-3 py-2 border-l-[3px] ${meta.stripe} hover:bg-slate-50 transition-colors`}
    >
      <StatusIcon className={`w-4 h-4 shrink-0 mt-0.5 ${meta.text}`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-semibold text-navy-800 truncate flex-1 min-w-0">{title}</span>
          <span
            className={`shrink-0 text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border ${meta.pill}`}
          >
            {meta.label}
          </span>
        </div>
        <div className="text-[11px] text-navy-500 mt-0.5 line-clamp-2 leading-snug">{subtitle}</div>
      </div>
      <ChevronRight className="w-4 h-4 shrink-0 mt-0.5 text-slate-300 group-hover:text-navy-700 transition-colors" />
    </li>
  );
}

function EmptyState({
  Icon = Inbox,
  message,
  tone = "muted",
}: {
  Icon?: ComponentType<{ className?: string }>;
  message: React.ReactNode;
  tone?: "muted" | "success";
}) {
  const iconCls = tone === "success" ? "text-emerald-400" : "text-slate-300";
  return (
    <div className="px-4 py-10 flex flex-col items-center gap-2 text-center">
      <Icon className={`w-8 h-8 ${iconCls}`} />
      <div className="text-xs text-navy-500 max-w-[240px] leading-relaxed">{message}</div>
    </div>
  );
}
