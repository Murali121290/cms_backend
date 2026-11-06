import { useState, useMemo } from "react";
import { Modal } from "@/components/ui/Modal";
import { Mail, ArrowRight, Truck } from "lucide-react";

interface TransitionConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (shipmentNotes?: string) => void;
  loading?: boolean;
  currentStage: string;
  nextStage: string;
  chapterNumber?: string;
  dueDate?: string;
  config: {
    custom_message?: string;
    to: string[];
    cc: string[];
    subject: string;
    body: string;
    from_email?: string;
  };
}

export function TransitionConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  loading = false,
  currentStage,
  nextStage,
  chapterNumber,
  dueDate,
  config,
}: TransitionConfirmModalProps) {
  const [shipmentNotes, setShipmentNotes] = useState("");
  const displayMsg = config.custom_message || `Complete ${currentStage} and move to ${nextStage}?`;

  // Format due date or today's date cleanly as DD-Mon-YYYY
  const todayFormatted = useMemo(() => {
    const raw = (dueDate && dueDate !== "—") ? dueDate : null;
    if (raw) {
      const match = String(raw).match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (match) {
        const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        const mIdx = parseInt(match[2], 10) - 1;
        return `${match[3]}-${months[mIdx] || match[2]}-${match[1]}`;
      }
      return String(raw).replace(/\s+00:00:00(\+00:00)?$/, "");
    }
    const now = new Date();
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const d = String(now.getDate()).padStart(2, "0");
    const m = months[now.getMonth()];
    const y = now.getFullYear();
    return `${d}-${m}-${y}`;
  }, [dueDate]);

  // Resolve chapter number from props or fallback from subject
  const resolvedChapterNumber = useMemo(() => {
    if (chapterNumber) {
      const c = chapterNumber.trim();
      return c.toLowerCase().startsWith("chapter ") ? c.slice(8).trim() : c;
    }
    const match = (config.subject || "").match(/Chapter(?:s)?\s+([^|]+)/i);
    if (match) {
      return match[1].trim();
    }
    return "01";
  }, [chapterNumber, config.subject]);

  // Parse body around {chapter_table} or ASCII table pattern
  const { introText, outroText } = useMemo(() => {
    let raw = config.body || "";
    const asciiTableRegex = /\+[-+]+\+[\s\S]*?\+[-+]+\+[\s\S]*?\+[-+]+\+/g;
    if (asciiTableRegex.test(raw)) {
      raw = raw.replace(asciiTableRegex, "{chapter_table}");
    }
    raw = raw.replace(/\|[^\n\r]*\|[\r\n\s]*\+[-+]+\+/g, "");

    if (!raw.includes("{chapter_table}")) {
      if (raw.includes("Regards,")) {
        const parts = raw.split("Regards,");
        raw = parts[0].trim() + "\n\n{chapter_table}\n\nRegards," + parts[1];
      } else {
        raw += "\n\n{chapter_table}";
      }
    }

    if (raw.includes("{chapter_table}")) {
      const parts = raw.split("{chapter_table}");
      return {
        introText: parts[0].trim(),
        outroText: parts[1]?.trim() || "",
      };
    }
    return {
      introText: raw.trim(),
      outroText: "",
    };
  }, [config.body]);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Stage Transition Notification"
      size="xl"
    >
      <div className="relative space-y-4 py-2 min-h-[250px]">
        {/* Loading Overlay */}
        {loading && (
          <div className="absolute inset-0 bg-background/70 backdrop-blur-[1px] flex flex-col items-center justify-center z-50 rounded-xl">
            <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-primary"></div>
            <p className="text-sm font-semibold text-text mt-3">Sending notification...</p>
          </div>
        )}

        {/* Custom warning/transition message */}
        <div className="p-3 bg-accent/40 rounded-lg border border-border/80 flex items-start gap-3">
          <Mail className="h-5 w-5 text-primary mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-sm font-medium text-text">{displayMsg}</p>
            <div className="flex items-center gap-1.5 mt-1 text-xs text-muted">
              <span>{currentStage}</span>
              <ArrowRight size={10} />
              <span className="font-semibold text-primary">{nextStage}</span>
            </div>
          </div>
        </div>

        {/* Shipment Notes Query Prompt */}
        <div className="p-3 bg-surface/80 rounded-xl border border-border space-y-1.5">
          <div className="flex items-center justify-between">
            <label htmlFor="shipmentNotesInput" className="text-xs font-semibold text-text flex items-center gap-1.5">
              <Truck className="h-4 w-4 text-primary flex-shrink-0" />
              <span>Any shipment notes available?</span>
            </label>
            <span className="text-[10px] text-muted font-medium bg-background px-2 py-0.5 rounded border border-border">
              Optional
            </span>
          </div>
          <input
            id="shipmentNotesInput"
            type="text"
            value={shipmentNotes}
            onChange={(e) => setShipmentNotes(e.target.value)}
            placeholder="e.g. Batch 01 priority ingest, Dispatched via FTP, etc."
            className="w-full text-xs px-3 py-2 bg-background border border-border rounded-lg text-text placeholder:text-muted/60 focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition"
          />
          <p className="text-[11px] text-muted">
            {shipmentNotes.trim()
              ? "✓ Notes will be rendered in the email table and recorded on this chapter."
              : 'Leave blank to display as "—" in the email notification table.'}
          </p>
        </div>

        {/* Unified Email Composer Preview */}
        <div className="border border-border rounded-xl bg-surface/30 overflow-hidden shadow-sm">
          {/* Email Header */}
          <div className="bg-surface/70 px-4 py-3 border-b border-border space-y-2">
            <div className="flex items-start text-sm">
              <span className="w-16 font-medium text-muted flex-shrink-0">From:</span>
              <span className="text-text font-mono">{config.from_email || "inkflow-noreply@example.com"}</span>
            </div>
            <div className="flex items-start text-sm">
              <span className="w-16 font-medium text-muted flex-shrink-0">To:</span>
              <span className="text-text font-mono break-all">{config.to.join(", ") || "—"}</span>
            </div>
            {config.cc && config.cc.length > 0 && (
              <div className="flex items-start text-sm">
                <span className="w-16 font-medium text-muted flex-shrink-0">Cc:</span>
                <span className="text-text font-mono break-all">{config.cc.join(", ")}</span>
              </div>
            )}
            <div className="flex items-start text-sm border-t border-border/50 pt-2 mt-1">
              <span className="w-16 font-medium text-muted flex-shrink-0">Subject:</span>
              <span className="text-text font-semibold break-words">{config.subject || "—"}</span>
            </div>
          </div>

          {/* Email Content Body with REAL Table */}
          <div className="p-4 bg-card min-h-[150px] space-y-3 font-sans text-xs leading-relaxed text-text">
            {/* Intro text */}
            {introText && (
              <div className="space-y-2 whitespace-pre-wrap">
                {introText.split("\n\n").map((para, idx) => (
                  <p key={idx} className="leading-relaxed">
                    {para.split("\n").map((line, lIdx) => {
                      const pMatch = line.match(/^(Project Name:|Client Name:)(.*)$/);
                      if (pMatch) {
                        return (
                          <span key={lIdx} className="block">
                            <strong className="font-semibold text-text">{pMatch[1]}</strong>
                            <span className="text-text">{pMatch[2]}</span>
                          </span>
                        );
                      }
                      return (
                        <span key={lIdx} className="block">
                          {line}
                        </span>
                      );
                    })}
                  </p>
                ))}
              </div>
            )}

            {/* The REAL Structured HTML/React Table */}
            <div className="my-3 overflow-hidden rounded-lg border border-border shadow-xs bg-surface/30">
              <table className="w-full text-xs text-left border-collapse">
                <thead>
                  <tr className="bg-surface/80 border-b border-border text-muted font-semibold">
                    <th className="py-2.5 px-3 border-r border-border">Chapter</th>
                    <th className="py-2.5 px-3 border-r border-border">Stage</th>
                    <th className="py-2.5 px-3 border-r border-border">Due Date</th>
                    <th className="py-2.5 px-3">Shipment Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border bg-card">
                  <tr>
                    <td className="py-2.5 px-3 border-r border-border font-medium text-text">
                      {resolvedChapterNumber}
                    </td>
                    <td className="py-2.5 px-3 border-r border-border text-text">
                      <span className="inline-flex items-center gap-1.5 font-medium">
                        <span>{currentStage}</span>
                        <span className="text-muted">→</span>
                        <span className="text-primary font-semibold">{nextStage}</span>
                      </span>
                    </td>
                    <td className="py-2.5 px-3 border-r border-border text-text">
                      {todayFormatted}
                    </td>
                    <td className="py-2.5 px-3 text-text">
                      {shipmentNotes.trim() ? (
                        <span className="text-primary font-semibold bg-primary/10 px-2 py-0.5 rounded border border-primary/20">
                          {shipmentNotes.trim()}
                        </span>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Outro text */}
            {outroText && (
              <div className="space-y-2 whitespace-pre-wrap pt-1">
                {outroText.split("\n\n").map((para, idx) => (
                  <p
                    key={idx}
                    className={
                      para.toLowerCase().includes("note :")
                        ? "text-muted italic text-[11px] pt-1"
                        : "leading-relaxed"
                    }
                  >
                    {para}
                  </p>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Buttons */}
        <div className="flex justify-end gap-2.5 pt-3 border-t border-border">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="px-4 py-2 text-sm font-medium text-text bg-background border border-border rounded-lg hover:bg-surface transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm(shipmentNotes.trim() || undefined)}
            disabled={loading}
            className="px-4 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary/95 transition-colors disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2"
          >
            {loading ? "Sending..." : "Send & Proceed"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
