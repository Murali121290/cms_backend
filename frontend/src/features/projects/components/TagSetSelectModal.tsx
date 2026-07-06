import { useEffect, useState } from "react";
import { Check, Wrench, X } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

import { Modal } from "@/components/ui/Modal";
import { getTagSets, startStructuring, type TagSetOption } from "@/api/processing";
import { getApiErrorMessage } from "@/api/client";
import { useToast } from "@/components/ui/useToast";

interface TagSetSelectModalProps {
  fileId: number;
  fileName: string;
  isOpen: boolean;
  onClose: () => void;
}

export function TagSetSelectModal({ fileId, fileName, isOpen, onClose }: TagSetSelectModalProps) {
  const { addToast } = useToast();
  const queryClient = useQueryClient();

  const [tagSets, setTagSets] = useState<TagSetOption[]>([]);
  const [selectedTagSet, setSelectedTagSet] = useState("lww");
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setErrorMsg(null);
    setSelectedTagSet("lww");
    setIsLoading(true);
    getTagSets()
      .then(setTagSets)
      .catch((err) => setErrorMsg(getApiErrorMessage(err, "Failed to load tag sets.")))
      .finally(() => setIsLoading(false));
  }, [isOpen]);

  async function handleSubmit() {
    setErrorMsg(null);
    setIsSubmitting(true);

    try {
      await startStructuring(fileId, selectedTagSet);

      addToast({
        title: "✓ Structuring Started",
        description: `Manual structuring job queued for "${fileName}"`,
        variant: "success",
      });

      void queryClient.invalidateQueries({
        queryKey: ["processing-status", fileId],
      });

      onClose();
    } catch (err) {
      setErrorMsg(getApiErrorMessage(err, "Failed to start structuring."));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Select Tag Set"
      description={`Choose the tag convention to use for manual structuring of "${fileName}"`}
      size="sm"
      footer={
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="px-4 py-2 text-sm font-medium text-text bg-white border border-border rounded-md hover:bg-background disabled:opacity-50 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={isSubmitting || isLoading || tagSets.length === 0}
            className="px-4 py-2 text-sm font-medium text-white bg-[#C9821A] rounded-md hover:bg-[#B3711A] disabled:opacity-50 transition-colors flex items-center gap-2"
          >
            <Wrench size={16} />
            {isSubmitting ? "Starting…" : "Start Structuring"}
          </button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        {errorMsg && (
          <div className="flex items-start gap-3 px-4 py-3 text-sm text-danger bg-danger/5 border border-danger/30 rounded-md">
            <X size={16} className="flex-shrink-0 mt-0.5" />
            {errorMsg}
          </div>
        )}

        {isLoading ? (
          <div className="text-sm text-muted">Loading tag sets…</div>
        ) : (
          <div className="space-y-2">
            {tagSets.map((opt) => (
              <label
                key={opt.key}
                className="flex items-center gap-3 cursor-pointer p-3 rounded-lg border-2 border-transparent hover:border-blue-300 transition-colors"
                onMouseDown={() => setSelectedTagSet(opt.key)}
              >
                <span
                  role="radio"
                  aria-checked={selectedTagSet === opt.key}
                  className="inline-flex items-center justify-center w-5 h-5 rounded-full border-2 flex-shrink-0 transition-colors"
                  style={{
                    borderColor: selectedTagSet === opt.key ? "#C9821A" : "#D1CBC3",
                    backgroundColor: selectedTagSet === opt.key ? "#C9821A" : "#FFFFFF",
                  }}
                >
                  {selectedTagSet === opt.key && <Check size={12} color="#FFFFFF" strokeWidth={3} />}
                </span>
                <span className="text-sm font-medium text-text">{opt.label}</span>
              </label>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
