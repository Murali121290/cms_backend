import { Modal } from "@/components/ui/Modal";
import { Mail, ArrowRight } from "lucide-react";

interface TransitionConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
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
  const displayMsg = config.custom_message || `Complete ${currentStage} and move to ${nextStage}?`;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Stage Transition Notification"
      size="xl"
    >
      <div className="relative space-y-4 py-2 min-h-[250px]">
        {/* Loading Overlay to freeze screen */}
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
              {config.body || "—"}
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
            onClick={onConfirm}
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
