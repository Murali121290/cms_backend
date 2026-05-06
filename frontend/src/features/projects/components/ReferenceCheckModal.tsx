import { useState } from "react";
import { Check } from "lucide-react";

import { Modal } from "@/components/ui/Modal";
import { startProcessingJob } from "@/api/processing";
import { getApiErrorMessage } from "@/api/client";
import { useToast } from "@/components/ui/useToast";
import type { FileRecord } from "@/types/api";

interface CheckOption {
  label: string;
  processType: string;
  defaultChecked: boolean;
}

const OPTIONS: CheckOption[] = [
  { label: "Number Validation", processType: "reference_number_validation", defaultChecked: true },
  { label: "Name & Year (APA/Chicago)", processType: "reference_apa_chicago_validation", defaultChecked: false },
  { label: "Report Only", processType: "reference_report_only", defaultChecked: false },
  { label: "Structuring (Post-Validation)", processType: "reference_structuring", defaultChecked: false },
];

interface ReferenceCheckModalProps {
  file: FileRecord;
  isOpen: boolean;
  onClose: () => void;
}

export function ReferenceCheckModal({ file, isOpen, onClose }: ReferenceCheckModalProps) {
  const { addToast } = useToast();

  const [checked, setChecked] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(OPTIONS.map((o) => [o.processType, o.defaultChecked]))
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  function toggle(processType: string) {
    setChecked((prev) => ({ ...prev, [processType]: !prev[processType] }));
    setErrorMsg(null);
  }

  async function handleSubmit() {
    const selected = OPTIONS.filter((o) => checked[o.processType]);
    if (selected.length === 0) {
      setErrorMsg("Please select at least one option.");
      return;
    }

    setIsSubmitting(true);
    setErrorMsg(null);

    try {
      for (const opt of selected) {
        await startProcessingJob(file.id, opt.processType);
        addToast({
          title: `Reference Check (${opt.label}) started for ${file.filename}`,
          variant: "info",
        });
      }
      onClose();
    } catch (err) {
      setErrorMsg(getApiErrorMessage(err, "Failed to start reference check."));
      setIsSubmitting(false);
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Reference Check"
      description={`Select which checks to run on "${file.filename}".`}
      size="md"
      footer={
        <div className="flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="px-4 py-2 text-sm font-medium text-navy-600 bg-white border border-surface-400 rounded-md hover:bg-surface-100 disabled:opacity-50 transition-colors duration-100"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={isSubmitting}
            className="px-4 py-2 text-sm font-medium text-white bg-[#C9821A] rounded-md hover:bg-[#B3711A] disabled:opacity-50 transition-colors duration-100"
          >
            {isSubmitting ? "Running…" : "Run Checks"}
          </button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        {errorMsg && (
          <div className="px-4 py-3 text-sm text-error-700 bg-error-50 border border-error-200 rounded-md">
            {errorMsg}
          </div>
        )}

        {OPTIONS.map((opt) => {
          const isChecked = checked[opt.processType];
          return (
            <label
              key={opt.processType}
              className="flex items-center gap-3 cursor-pointer select-none"
              onClick={() => toggle(opt.processType)}
            >
              {/* Custom checkbox */}
              <span
                role="checkbox"
                aria-checked={isChecked}
                tabIndex={0}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => { if (e.key === " " || e.key === "Enter") toggle(opt.processType); }}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: "18px",
                  height: "18px",
                  borderRadius: "4px",
                  border: isChecked ? "2px solid #C9821A" : "2px solid #D1CBC3",
                  backgroundColor: isChecked ? "#C9821A" : "#FFFFFF",
                  flexShrink: 0,
                  transition: "background-color 100ms, border-color 100ms",
                  outline: "none",
                  cursor: "pointer",
                }}
              >
                {isChecked && <Check size={12} color="#FFFFFF" strokeWidth={3} aria-hidden />}
              </span>
              <span className="text-sm text-navy-800">{opt.label}</span>
            </label>
          );
        })}
      </div>
    </Modal>
  );
}
