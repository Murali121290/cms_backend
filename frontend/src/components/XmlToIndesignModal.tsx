import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Modal } from "@/components/ui/Modal";
import { Layers, Loader2, AlertCircle } from "lucide-react";
import { toast } from "sonner";

interface TemplateFile {
  id: number;
  filename: string;
  category: string;
  file_size: string;
  uploaded_by: string;
  uploaded_on: string;
}

interface XmlToIndesignModalProps {
  isOpen: boolean;
  onClose: () => void;
  fileId: number;
  fileName: string;
  projectId: number;
  onComplete: () => void;
}

export function XmlToIndesignModal({
  isOpen,
  onClose,
  fileId,
  fileName,
  projectId,
  onComplete,
}: XmlToIndesignModalProps) {
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Fetch InDesign templates for this project
  const { data: templates, isLoading, error } = useQuery<TemplateFile[]>({
    queryKey: ["indesign-templates", projectId],
    queryFn: async () => {
      const response = await fetch(`/api/v2/projects/${projectId}/indesign-templates`);
      if (!response.ok) {
        throw new Error("Failed to fetch templates");
      }
      return response.json();
    },
    enabled: isOpen && !!projectId,
  });

  const handleSubmit = async () => {
    if (!selectedTemplateId) {
      toast.error("Please select a template.");
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch(`/api/v2/files/${fileId}/processing-jobs`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          process_type: "xml_to_indesign",
          mode: "style",
          options: {
            template_file_id: selectedTemplateId,
          },
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || "Failed to start conversion.");
      }

      toast.success("XML to InDesign conversion job started in the background!");
      onComplete();
      onClose();
    } catch (err: any) {
      toast.error(err.message || "Failed to start XML to InDesign conversion.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Generate InDesign from XML"
      size="md"
    >
      <div className="space-y-4 py-2 relative">
        {submitting && (
          <div className="absolute inset-0 bg-background/70 backdrop-blur-[1px] flex flex-col items-center justify-center z-50 rounded-xl">
            <Loader2 className="animate-spin h-10 w-10 text-primary" />
            <p className="text-sm font-semibold text-text mt-3">Starting conversion...</p>
          </div>
        )}

        <div>
          <label className="text-xs font-semibold text-muted block mb-1">XML File</label>
          <div className="p-2.5 bg-surface/50 border border-border rounded-lg text-xs font-mono text-text truncate">
            {fileName}
          </div>
        </div>

        <div>
          <label className="text-xs font-semibold text-muted block mb-1">Select InDesign Template (.indt)</label>
          {isLoading ? (
            <div className="flex items-center justify-center p-6 border border-border rounded-lg bg-surface/30">
              <Loader2 className="animate-spin h-5 w-5 text-muted mr-2" />
              <span className="text-xs text-muted">Loading templates...</span>
            </div>
          ) : error ? (
            <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-xs text-red-500">
              <AlertCircle size={14} />
              <span>Failed to load templates. Make sure a template is uploaded in the design chapter.</span>
            </div>
          ) : !templates || templates.length === 0 ? (
            <div className="text-center p-6 border border-dashed border-border rounded-lg bg-surface/10">
              <AlertCircle className="h-6 w-6 text-muted-foreground mx-auto mb-2" />
              <p className="text-xs text-muted">No InDesign templates (.indt) found.</p>
              <p className="text-[10px] text-muted-foreground mt-1">
                Please upload an InDesign template in the <strong>Design</strong> chapter under the <strong>Template Indesign</strong> folder.
              </p>
            </div>
          ) : (
            <div className="max-h-48 overflow-y-auto border border-border rounded-lg bg-card divide-y divide-border">
              {templates.map((tpl) => (
                <div
                  key={tpl.id}
                  onClick={() => setSelectedTemplateId(tpl.id)}
                  className={`flex items-center justify-between p-3 cursor-pointer transition-colors text-xs
                    ${selectedTemplateId === tpl.id ? "bg-accent/60 text-primary font-medium" : "text-text hover:bg-surface/50"}`}
                >
                  <div className="flex items-center gap-2.5 truncate">
                    <Layers size={14} className={selectedTemplateId === tpl.id ? "text-primary" : "text-muted-foreground"} />
                    <span className="truncate" title={tpl.filename}>
                      {tpl.filename}
                    </span>
                  </div>
                  <span className="text-[10px] text-muted-foreground px-1.5 py-0.5 rounded bg-border">
                    {tpl.file_size}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-3 border-t border-border mt-6">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 text-xs font-medium text-text bg-background border border-border rounded-lg hover:bg-surface transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting || !selectedTemplateId}
            className="px-4 py-2 text-xs font-semibold text-white bg-primary rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center gap-1.5"
          >
            Generate InDesign
          </button>
        </div>
      </div>
    </Modal>
  );
}
