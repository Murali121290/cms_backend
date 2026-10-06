import React from "react";
import { CheckCircle2, AlertCircle, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/Button";

interface TechnicalApplyConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  isPending: boolean;
  fixesCount: number;
  highlightsCount: number;
}

export function TechnicalApplyConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  isPending,
  fixesCount,
  highlightsCount,
}: TechnicalApplyConfirmModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full border border-slate-200 overflow-hidden">
        {/* Modal Header */}
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <CheckCircle2 className="w-5 h-5" />
            </div>
            <h3 className="text-sm font-bold text-slate-900">Confirm Technical Apply</h3>
          </div>
          <button
            onClick={onClose}
            disabled={isPending}
            className="p-1 text-slate-400 hover:text-slate-600 rounded-md transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 space-y-4">
          <p className="text-xs text-slate-600 leading-relaxed">
            Are you sure you want to apply the selected modifications to this manuscript? A new version will be generated with tracked changes and highlights.
          </p>

          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 bg-emerald-50/60 border border-emerald-100 rounded-lg">
              <div className="text-[10px] font-extrabold uppercase text-emerald-700 tracking-wider">
                Track Changes Fixes
              </div>
              <div className="text-xl font-black text-emerald-900 mt-0.5">
                {fixesCount}
              </div>
              <div className="text-[10px] text-emerald-600 mt-0.5">Substitutions</div>
            </div>

            <div className="p-3 bg-amber-50/60 border border-amber-100 rounded-lg">
              <div className="text-[10px] font-extrabold uppercase text-amber-700 tracking-wider">
                Highlights Only
              </div>
              <div className="text-xl font-black text-amber-900 mt-0.5">
                {highlightsCount}
              </div>
              <div className="text-[10px] text-amber-600 mt-0.5">Editorial marks</div>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-100 flex items-center justify-end gap-2.5">
          <Button variant="secondary" size="sm" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={onConfirm}
            disabled={isPending}
            leftIcon={isPending ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
          >
            {isPending ? "Applying Changes..." : "Confirm & Apply"}
          </Button>
        </div>
      </div>
    </div>
  );
}
