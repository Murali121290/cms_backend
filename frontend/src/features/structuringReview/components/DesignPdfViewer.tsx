import { useEffect } from "react";
import "pdfjs-viewer-element";
import { X, FileText } from "lucide-react";

interface DesignPdfViewerProps {
  pdfUrl?: string | null;
  filename?: string;
  onClose?: () => void;
  className?: string;
}

export function DesignPdfViewer({
  pdfUrl,
  filename = "Design PDF",
  onClose,
  className = "",
}: DesignPdfViewerProps) {
  // Ensure pdfjs-viewer-element Web Component script is loaded in the DOM
  useEffect(() => {
    const scriptId = "pdfjs-viewer-element-script";
    let script = document.getElementById(scriptId) as HTMLScriptElement | null;
    if (!script) {
      script = document.createElement("script");
      script.id = scriptId;
      script.type = "module";
      script.src = "https://cdn.jsdelivr.net/npm/pdfjs-viewer-element/dist/pdfjs-viewer-element.js";
      document.body.appendChild(script);
    }
  }, []);

  return (
    <div className={`flex flex-col bg-slate-900 border border-slate-700 rounded-lg overflow-hidden shadow-2xl ${className}`}>
      {/* Header Bar */}
      <div className="h-10 px-3 bg-slate-800 border-b border-slate-700 flex items-center justify-between shrink-0 select-none text-slate-200">
        <div className="flex items-center gap-2 min-w-0">
          <span className="px-2 py-0.5 bg-rose-500/20 text-rose-300 font-bold text-[10px] rounded border border-rose-500/40 uppercase shrink-0">
            Design PDF
          </span>
          <span className="text-xs font-semibold text-slate-200 truncate max-w-[280px]" title={filename}>
            {filename}
          </span>
        </div>

        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="p-1 hover:bg-slate-700 rounded text-slate-400 hover:text-white transition-colors cursor-pointer border-none bg-transparent"
            title="Close Design View"
          >
            <X size={16} />
          </button>
        )}
      </div>

      {/* Main Viewer Body */}
      <div className="flex-1 relative bg-slate-950 overflow-hidden">
        {pdfUrl ? (
          // @ts-ignore
          <pdfjs-viewer-element
            src={pdfUrl}
            key={pdfUrl}
            style={{ width: "100%", height: "100%", display: "block", border: "0" }}
          />
        ) : (
          <div className="flex-1 h-full flex items-center justify-center text-slate-400 p-8 text-center">
            <div>
              <FileText size={48} className="mx-auto mb-3 opacity-20 text-slate-400" />
              <p className="text-sm font-medium text-slate-300">No Design PDF file found</p>
              <p className="text-xs mt-1 max-w-xs text-slate-500">
                Please make sure a .pdf file is present in the chapter's design folder.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
