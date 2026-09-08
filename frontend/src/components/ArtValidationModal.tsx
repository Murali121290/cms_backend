import React, { useEffect, useState } from 'react';
import {
  FileImage,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ExternalLink,
  Loader2,
  Search,
  X,
  Info,
} from 'lucide-react';
import { getArtValidation, type ArtValidationResponse, type ArtValidationDetail } from '@/api/processing';

interface ArtValidationModalProps {
  isOpen: boolean;
  onClose: () => void;
  fileId: number | null;
  fileName: string;
}

export const ArtValidationModal: React.FC<ArtValidationModalProps> = ({
  isOpen,
  onClose,
  fileId,
  fileName,
}) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ArtValidationResponse | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');

  useEffect(() => {
    if (isOpen && fileId) {
      setLoading(true);
      setError(null);
      getArtValidation(fileId)
        .then((res) => {
          setData(res);
        })
        .catch((err) => {
          console.error("Art validation error:", err);
          setError(err.response?.data?.message || err.message || "Failed to run art validation.");
        })
        .finally(() => {
          setLoading(false);
        });
    }
  }, [isOpen, fileId]);

  if (!isOpen) return null;

  const handleOpenHtmlReport = () => {
    if (fileId) {
      window.open(`/api/v2/files/${fileId}/art-validation/html`, '_blank');
    }
  };

  const filteredDetails = (data?.details || []).filter((item: ArtValidationDetail) => {
    const matchesStatus =
      filterStatus === 'ALL' ||
      (filterStatus === 'MATCHED' && item.status === 'MATCHED') ||
      (filterStatus === 'MISSING' && item.status === 'MISSING') ||
      (filterStatus === 'UNREFERENCED' && item.status === 'UNREFERENCED');

    const matchesSearch =
      !searchQuery ||
      item.fig_num.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.filename.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.docx_ref.toLowerCase().includes(searchQuery.toLowerCase());

    return matchesStatus && matchesSearch;
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="relative w-full max-w-5xl bg-card border border-border rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-surface">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-sky-50 text-sky-600 border border-sky-200">
              <FileImage size={20} />
            </div>
            <div>
              <h2 className="text-base font-bold text-text">Art Validation Report</h2>
              <p className="text-xs text-muted">
                Pre-conversion check for manuscript <span className="font-semibold text-text">{fileName}</span>
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-muted hover:text-text hover:bg-card transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {loading && (
            <div className="flex flex-col items-center justify-center py-16 text-muted space-y-3">
              <Loader2 size={32} className="animate-spin text-primary" />
              <p className="text-sm font-medium">Extracting figures & scanning art directory...</p>
            </div>
          )}

          {error && (
            <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">
              <strong>Error running validation:</strong> {error}
            </div>
          )}

          {!loading && !error && data && (
            <>
              {data.summary.total_docx_figures === 0 && (
                <div className="p-4 rounded-xl bg-sky-50 border border-sky-200 text-sky-800 text-xs font-medium flex items-center gap-2">
                  <Info size={16} className="text-sky-500 flex-shrink-0" />
                  <span>There is no art and caption in this chapter.</span>
                </div>
              )}

              {/* Summary Metrics Cards */}
              <div className="grid grid-cols-4 gap-4">
                <div className="p-4 rounded-xl bg-surface border border-border">
                  <div className="text-2xl font-black text-sky-600">{data.summary.total_docx_figures}</div>
                  <div className="text-xs font-semibold text-muted uppercase tracking-wider mt-1">
                    Docx Figures
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-emerald-50/50 border border-emerald-200">
                  <div className="flex items-center justify-between">
                    <div className="text-2xl font-black text-emerald-600">{data.summary.matched_count}</div>
                    <CheckCircle2 size={20} className="text-emerald-500" />
                  </div>
                  <div className="text-xs font-semibold text-emerald-800 uppercase tracking-wider mt-1">
                    Matched Art
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-red-50/50 border border-red-200">
                  <div className="flex items-center justify-between">
                    <div className="text-2xl font-black text-red-600">{data.summary.missing_count}</div>
                    <XCircle size={20} className="text-red-500" />
                  </div>
                  <div className="text-xs font-semibold text-red-800 uppercase tracking-wider mt-1">
                    Missing Art
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-amber-50/50 border border-amber-200">
                  <div className="flex items-center justify-between">
                    <div className="text-2xl font-black text-amber-600">{data.summary.unreferenced_count}</div>
                    <AlertTriangle size={20} className="text-amber-500" />
                  </div>
                  <div className="text-xs font-semibold text-amber-800 uppercase tracking-wider mt-1">
                    Unreferenced
                  </div>
                </div>
              </div>

              {/* Filters & Search Toolbar */}
              <div className="flex items-center justify-between gap-4 pt-2">
                <div className="flex items-center gap-1 bg-surface p-1 rounded-lg border border-border">
                  {['ALL', 'MATCHED', 'MISSING', 'UNREFERENCED'].map((status) => (
                    <button
                      key={status}
                      onClick={() => setFilterStatus(status)}
                      className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                        filterStatus === status
                          ? 'bg-card text-text shadow-sm'
                          : 'text-muted hover:text-text'
                      }`}
                    >
                      {status}
                    </button>
                  ))}
                </div>

                <div className="relative w-64">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search figure or filename..."
                    className="w-full pl-9 pr-3 py-1.5 text-xs bg-surface border border-border rounded-lg text-text focus:outline-none focus:ring-1 focus:ring-primary/40"
                  />
                </div>
              </div>

              {/* Details Table */}
              <div className="border border-border rounded-xl overflow-hidden bg-card">
                <table className="w-full text-left text-xs">
                  <thead className="bg-surface border-b border-border text-muted font-bold uppercase tracking-wider text-[10px]">
                    <tr>
                      <th className="px-4 py-3">#</th>
                      <th className="px-4 py-3">Type</th>
                      <th className="px-4 py-3">Figure Ref</th>
                      <th className="px-4 py-3">Art Filename</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Size (Picas)</th>
                      <th className="px-4 py-3">DPI</th>
                      <th className="px-4 py-3">Style</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {filteredDetails.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="px-4 py-10 text-center text-muted">
                          <div className="flex flex-col items-center justify-center space-y-1">
                            <Info size={20} className="text-muted/60" />
                            <p className="text-xs font-semibold text-muted">
                              {data.summary.total_docx_figures === 0
                                ? 'There is no art and caption in this chapter.'
                                : 'No matching figure details found.'}
                            </p>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      filteredDetails.map((item, idx) => (
                        <tr key={idx} className="hover:bg-surface/50 transition-colors">
                          <td className="px-4 py-3 text-muted font-mono">{idx + 1}</td>
                          <td className="px-4 py-3">
                            <span className="px-2 py-0.5 rounded bg-surface border border-border text-[10px] text-muted">
                              {item.type}
                            </span>
                          </td>
                          <td className="px-4 py-3 font-bold text-text">{item.fig_num}</td>
                          <td className="px-4 py-3 font-mono text-muted">{item.filename}</td>
                          <td className="px-4 py-3">
                            {item.status === 'MATCHED' && (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
                                <CheckCircle2 size={11} /> MATCHED
                              </span>
                            )}
                            {item.status === 'MISSING' && (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-800">
                                <XCircle size={11} /> MISSING
                              </span>
                            )}
                            {item.status === 'UNREFERENCED' && (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800">
                                <AlertTriangle size={11} /> UNREFERENCED
                              </span>
                            )}
                            {item.status === 'EXTENSION MISMATCH' && (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-sky-100 text-sky-800">
                                <AlertTriangle size={11} /> EXT MISMATCH
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 font-mono text-muted">
                            {item.width_picas ? `${item.width_picas} × ${item.height_picas}` : '—'}
                          </td>
                          <td className="px-4 py-3 font-mono text-muted">{item.resolution_dpi || '—'}</td>
                          <td className="px-4 py-3 text-muted">{item.docx_style || '—'}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-border bg-surface">
          <button
            onClick={handleOpenHtmlReport}
            disabled={!fileId || loading}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-sky-700 bg-sky-50 border border-sky-200 rounded-lg hover:bg-sky-100 transition-colors disabled:opacity-50"
          >
            <ExternalLink size={14} /> Open Formatted HTML Report
          </button>
          <button
            onClick={onClose}
            className="px-5 py-2 text-xs font-semibold text-white bg-primary rounded-lg hover:bg-primary/90 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
