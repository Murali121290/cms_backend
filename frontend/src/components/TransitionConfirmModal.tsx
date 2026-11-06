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
  config,
}: TransitionConfirmModalProps) {
  const [shipmentNotes, setShipmentNotes] = useState("");
  const displayMsg = config.custom_message || `Complete ${currentStage} and move to ${nextStage}?`;

  const displayedBody = useMemo(() => {
    let raw = config.body || "—";
    const notesVal = shipmentNotes.trim() || "—";
    if (raw.includes("{shipment_notes}")) {
      raw = raw.split("{shipment_notes}").join(notesVal);
    } else if (shipmentNotes.trim()) {
      // In ASCII table format, replace the shipment notes column or trailing dash
      raw = raw.replace(/\|\s*—\s*\|(?=\s*\n|$)/g, `| ${notesVal} |`);
    }
    return raw;
  }, [config.body, shipmentNotes]);

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
              ? "✓ Notes will be included in the email table and recorded on this chapter."
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

          {/* Email Content Body */}
          <div className="p-4 bg-card min-h-[150px]">
            <pre className="text-sm text-text font-sans whitespace-pre-wrap leading-relaxed">
              {displayedBody}
            </pre>
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
