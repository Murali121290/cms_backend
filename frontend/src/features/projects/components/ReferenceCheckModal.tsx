import { useState } from "react";
import { Check, X, Upload } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

import { Modal } from "@/components/ui/Modal";
import { startProcessingJob } from "@/api/processing";
import { getApiErrorMessage } from "@/api/client";
import { useToast } from "@/components/ui/useToast";
import type { FileRecord } from "@/types/api";

interface ReferenceCheckModalProps {
  file: FileRecord;
  isOpen: boolean;
  onClose: () => void;
}

type CitationFormat = "auto" | "styled" | "superscript" | "bracket" | "paren" | "plain";
type TargetStyle = "Auto" | "APA" | "AMA";

export function ReferenceCheckModal({ file, isOpen, onClose }: ReferenceCheckModalProps) {
  const { addToast } = useToast();
  const queryClient = useQueryClient();

  // Pipeline options
  const [runValidation, setRunValidation] = useState(true);
  const [runNameYear, setRunNameYear] = useState(false);
  const [runStructuring, setRunStructuring] = useState(false);
  const [reportOnly, setReportOnly] = useState(false);

  // Conditional options
  const [citationFormat, setCitationFormat] = useState<CitationFormat>("auto");
  const [targetStyle, setTargetStyle] = useState<TargetStyle>("Auto");

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Compute pipeline summary
  const pipelineSteps: string[] = [];
  if (runValidation) pipelineSteps.push("① Number Validation");
  if (runNameYear) pipelineSteps.push("② Name & Year Validation (APA)");
  if (runStructuring) pipelineSteps.push("③ Structuring & Conversion");

  async function handleSubmit() {
    setErrorMsg(null);

    if (!runValidation && !runNameYear && !runStructuring) {
      setErrorMsg("Please select at least one processing option.");
      return;
    }

    setIsSubmitting(true);

    try {
      // Determine the unified process type:
      // If ONLY structuring is checked, use "reference_structuring"
      // Otherwise, use "reference_validation" (which handles multiple steps)
      const isStructuringOnly = runStructuring && !runValidation && !runNameYear;
      const processType = isStructuringOnly ? "reference_structuring" : "reference_validation";

      const options = {
        run_validation: runValidation,
        run_name_year_validation: runNameYear,
        run_structuring: runStructuring,
        citation_format: citationFormat,
        target_style: targetStyle,
        report_only: reportOnly,
      };

      await startProcessingJob(file.id, processType, "style", options);

      addToast({
        title: "✓ Processing Started",
        description: `Reference processing job queued for "${file.filename}"`,
        variant: "success",
      });

      void queryClient.invalidateQueries({
        queryKey: ["processing-status", file.id],
      });

      onClose();
    } catch (err) {
      setErrorMsg(getApiErrorMessage(err, "Failed to start processing."));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Reference Processing Pipeline"
      description={`Configure and run reference checks on "${file.filename}"`}
      size="lg"
      footer={
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm text-navy-600">
            {pipelineSteps.length > 0 && (
              <span className="font-medium">
                Will run: <span className="text-[#C9821A]">{pipelineSteps.join(" → ")}</span>
              </span>
            )}
          </div>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 text-sm font-medium text-navy-600 bg-white border border-surface-400 rounded-md hover:bg-surface-100 disabled:opacity-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleSubmit()}
              disabled={isSubmitting || (pipelineSteps.length === 0)}
              className="px-4 py-2 text-sm font-medium text-white bg-[#C9821A] rounded-md hover:bg-[#B3711A] disabled:opacity-50 transition-colors flex items-center gap-2"
            >
              <Upload size={16} />
              {isSubmitting ? "Processing…" : "Start Processing"}
            </button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-6">
        {errorMsg && (
          <div className="flex items-start gap-3 px-4 py-3 text-sm text-error-700 bg-error-50 border border-error-200 rounded-md">
            <X size={16} className="flex-shrink-0 mt-0.5" />
            {errorMsg}
          </div>
        )}

        {/* Processing Pipeline Section */}
        <div className="space-y-4 bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div className="text-xs font-bold text-blue-600 uppercase tracking-wider">
            Processing Pipeline — Select steps to run in order
          </div>

          {/* Step 1: Number Validation */}
          <label className="flex items-start gap-3 cursor-pointer p-3 rounded-lg border-2 border-transparent hover:border-blue-300 transition-colors"
            onMouseDown={() => setRunValidation(!runValidation)}>
            <span
              role="checkbox"
              aria-checked={runValidation}
              className="inline-flex items-center justify-center w-5 h-5 rounded border-2 flex-shrink-0 mt-0.5 transition-colors"
              style={{
                borderColor: runValidation ? "#C9821A" : "#D1CBC3",
                backgroundColor: runValidation ? "#C9821A" : "#FFFFFF",
              }}
            >
              {runValidation && <Check size={14} color="#FFFFFF" strokeWidth={3} />}
            </span>
            <div className="flex-1">
              <div className="text-sm font-semibold text-navy-800">Step 1 — Number Validation
                <span className="text-xs font-normal text-navy-600 ml-2">(AMA / Vancouver)</span>
              </div>
              <div className="text-xs text-navy-700 mt-1">
                Checks in-text citation numbers match the numbered reference list. Highlights mismatches.
              </div>
              <div className="text-xs text-blue-600 font-medium mt-2">📄 Output: Annotated .docx with highlighted changes</div>
            </div>
          </label>

          {/* Citation Format (shown when Step 1 is checked) */}
          {runValidation && (
            <div className="ml-8 p-3 bg-white border border-blue-200 rounded-lg">
              <label className="text-xs font-semibold text-blue-600 block mb-2">
                How are citations formatted?
              </label>
              <div className="space-y-2">
                {[
                  { value: "auto", label: "Auto-detect (recommended)" },
                  { value: "styled", label: "Already styled with cite_bib character style" },
                  { value: "superscript", label: "Superscript numbers (e.g., ¹, ²⁻⁴)" },
                  { value: "bracket", label: "Bracketed numbers (e.g., [1], [2-4])" },
                  { value: "paren", label: "Parenthetical numbers (e.g., (1), (2-4))" },
                  { value: "plain", label: "Plain numbers (⚠️ high false-positive risk)" },
                ].map((opt) => (
                  <label key={opt.value} className="flex items-center gap-2 text-xs cursor-pointer">
                    <input
                      type="radio"
                      name="citation_format"
                      value={opt.value}
                      checked={citationFormat === opt.value}
                      onChange={(e) => setCitationFormat(e.target.value as CitationFormat)}
                      className="w-3 h-3"
                      style={{ accentColor: "#C9821A" }}
                    />
                    <span className="text-navy-700">{opt.label}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Step 2: Name & Year Validation */}
          <label className="flex items-start gap-3 cursor-pointer p-3 rounded-lg border-2 border-transparent hover:border-blue-300 transition-colors"
            onMouseDown={() => setRunNameYear(!runNameYear)}>
            <span
              role="checkbox"
              aria-checked={runNameYear}
              className="inline-flex items-center justify-center w-5 h-5 rounded border-2 flex-shrink-0 mt-0.5 transition-colors"
              style={{
                borderColor: runNameYear ? "#C9821A" : "#D1CBC3",
                backgroundColor: runNameYear ? "#C9821A" : "#FFFFFF",
              }}
            >
              {runNameYear && <Check size={14} color="#FFFFFF" strokeWidth={3} />}
            </span>
            <div className="flex-1">
              <div className="text-sm font-semibold text-navy-800">Step 2 — Name & Year Validation
                <span className="text-xs font-normal text-navy-600 ml-2">(APA / Chicago)</span>
              </div>
              <div className="text-xs text-navy-700 mt-1">
                Validates author names, years, et al., suffixes (a/b/c), org abbreviations. Inserts Word comments for issues.
              </div>
              <div className="text-xs text-blue-600 font-medium mt-2">💬 Output: .docx with Word comments for issues</div>
            </div>
          </label>

          {/* Step 3: Structuring & Conversion */}
          <label className="flex items-start gap-3 cursor-pointer p-3 rounded-lg border-2 border-transparent hover:border-blue-300 transition-colors"
            onMouseDown={() => setRunStructuring(!runStructuring)}>
            <span
              role="checkbox"
              aria-checked={runStructuring}
              className="inline-flex items-center justify-center w-5 h-5 rounded border-2 flex-shrink-0 mt-0.5 transition-colors"
              style={{
                borderColor: runStructuring ? "#C9821A" : "#D1CBC3",
                backgroundColor: runStructuring ? "#C9821A" : "#FFFFFF",
              }}
            >
              {runStructuring && <Check size={14} color="#FFFFFF" strokeWidth={3} />}
            </span>
            <div className="flex-1">
              <div className="text-sm font-semibold text-navy-800">Step 3 — Structuring & Conversion</div>
              <div className="text-xs text-navy-700 mt-1">
                Restructures and converts references between APA ↔ AMA formats with URL validation.
              </div>
              <div className="text-xs text-blue-600 font-medium mt-2">📝 Output: .docx with track changes (format conversions)</div>
            </div>
          </label>

          {/* Target Style (shown when Step 3 is checked) */}
          {runStructuring && (
            <div className="ml-8 p-3 bg-white border border-blue-200 rounded-lg">
              <label className="text-xs font-semibold text-blue-600 block mb-2">
                Target Style (for Step 3)
              </label>
              <select
                value={targetStyle}
                onChange={(e) => setTargetStyle(e.target.value as TargetStyle)}
                className="w-full max-w-xs px-3 py-2 text-sm border border-blue-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="Auto">Auto-detect (Structuring only)</option>
                <option value="APA">Convert to APA</option>
                <option value="AMA">Convert to AMA</option>
              </select>
            </div>
          )}

          {/* Report Only Option */}
          <div className="pt-2 border-t border-blue-200">
            <label className="flex items-center gap-3 cursor-pointer">
              <span
                role="checkbox"
                aria-checked={reportOnly}
                className="inline-flex items-center justify-center w-5 h-5 rounded border-2 flex-shrink-0 transition-colors"
                style={{
                  borderColor: reportOnly ? "#C9821A" : "#D1CBC3",
                  backgroundColor: reportOnly ? "#C9821A" : "#FFFFFF",
                }}
                onMouseDown={() => setReportOnly(!reportOnly)}
              >
                {reportOnly && <Check size={14} color="#FFFFFF" strokeWidth={3} />}
              </span>
              <div>
                <div className="text-sm font-semibold text-navy-800">Report Only (no annotated .docx)</div>
                <div className="text-xs text-navy-700">Only produce the log/report — do not save an annotated Word document.</div>
              </div>
            </label>
          </div>
        </div>

        {/* Pipeline Summary */}
        {pipelineSteps.length > 0 && (
          <div className="px-3 py-2 bg-white border border-blue-300 rounded-lg text-xs text-navy-700">
            <strong className="text-blue-600">Will run:</strong> {pipelineSteps.join(" → ")}
            {reportOnly && <span className="ml-2 text-blue-600 font-medium">[Report Only]</span>}
          </div>
        )}
      </div>
    </Modal>
  );
}
