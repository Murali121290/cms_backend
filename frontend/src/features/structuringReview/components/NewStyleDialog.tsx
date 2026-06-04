import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { X } from "lucide-react";

interface NewStyleDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onAdd: (styleName: string) => void;
}

export function NewStyleDialog({ isOpen, onClose, onAdd }: NewStyleDialogProps) {
  const [styleName, setStyleName] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!styleName.trim()) return;

    setIsLoading(true);
    try {
      onAdd(styleName.trim());
      setStyleName("");
      onClose();
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-lg p-6 max-w-sm w-full mx-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-text">Create New Style</h2>
          <button
            onClick={onClose}
            className="text-muted hover:text-text"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label className="block text-sm font-medium text-text mb-2">
              Style Name
            </label>
            <input
              type="text"
              value={styleName}
              onChange={(e) => setStyleName(e.target.value)}
              placeholder="e.g., Quote, Caption, Sidebar"
              className="w-full px-3 py-2 border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-gold-400"
              disabled={isLoading}
              autoFocus
            />
            <p className="text-xs text-muted mt-1">
              Custom style will be applied as a paragraph.
            </p>
          </div>

          {/* Buttons */}
          <div className="flex gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={onClose}
              disabled={isLoading}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={!styleName.trim() || isLoading}
              className="flex-1"
            >
              {isLoading ? "Creating..." : "Create Style"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
