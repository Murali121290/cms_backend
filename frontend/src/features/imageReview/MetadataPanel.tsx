import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Code2, Loader2, X as XIcon } from "lucide-react";

import {
  getImageMetadata,
  type MetadataSection,
  type MetadataValue,
} from "./api";

interface Props {
  fileId: number;
  filename: string;
  onClose: () => void;
}

interface SectionSpec {
  key: keyof Sections;
  title: string;
  defaultOpen?: boolean;
}

type Sections = {
  file_information: MetadataSection;
  image_properties: MetadataSection;
  color_profile: MetadataSection | null;
  tiff_information: MetadataSection | null;
  photoshop_information: MetadataSection | null;
  exif_xmp: MetadataSection | null;
};

const SECTION_SPECS: SectionSpec[] = [
  { key: "file_information", title: "File Information", defaultOpen: true },
  { key: "image_properties", title: "Image Properties", defaultOpen: true },
  { key: "color_profile", title: "Color Profile" },
  { key: "tiff_information", title: "TIFF Information" },
  { key: "photoshop_information", title: "Photoshop Information" },
  { key: "exif_xmp", title: "EXIF / XMP" },
];

export function MetadataPanel({ fileId, filename, onClose }: Props) {
  const [showRaw, setShowRaw] = useState(false);
  const query = useQuery({
    queryKey: ["file-metadata", fileId],
    queryFn: () => getImageMetadata(fileId),
    staleTime: 60_000,
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 flex items-center justify-center p-4"
      style={{ zIndex: 2147483000, background: "rgba(15, 23, 42, 0.45)" }}
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-2xl border border-slate-200 w-[760px] max-w-full max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-200">
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-bold text-slate-900">Image Metadata</h2>
            <div className="text-[11px] text-slate-500 font-mono truncate">
              {filename}
            </div>
          </div>
          <button
            onClick={() => setShowRaw((v) => !v)}
            disabled={!query.data}
            className={`flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[11px] font-semibold border transition-colors ${
              showRaw
                ? "bg-primary/10 text-primary border-primary/30"
                : "bg-white text-slate-700 border-slate-300 hover:bg-slate-50"
            } disabled:opacity-40 disabled:cursor-not-allowed`}
            title="Show every extracted metadata value"
          >
            <Code2 className="w-3.5 h-3.5" />
            {showRaw ? "Structured View" : "View Raw Metadata"}
          </button>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-slate-500 hover:bg-slate-100"
            aria-label="Close"
          >
            <XIcon className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-y-auto bg-slate-50">
          {query.isLoading && (
            <div className="flex items-center justify-center py-12 text-slate-500 text-[12px]">
              <Loader2 className="w-4 h-4 animate-spin mr-2" />
              Extracting metadata…
            </div>
          )}

          {query.error && !query.isLoading && (
            <div className="p-4 text-[12px] text-rose-600">
              {query.error instanceof Error
                ? query.error.message
                : "Failed to load metadata."}
            </div>
          )}

          {query.data && !showRaw && (
            <div className="p-3 space-y-2">
              {SECTION_SPECS.map((spec) => (
                <CollapsibleSection
                  key={spec.key}
                  title={spec.title}
                  fields={query.data!.sections[spec.key]}
                  defaultOpen={spec.defaultOpen}
                />
              ))}
            </div>
          )}

          {query.data && showRaw && (
            <pre className="text-[11px] font-mono text-slate-800 whitespace-pre-wrap break-all p-4">
              {JSON.stringify(query.data.raw, null, 2)}
            </pre>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function CollapsibleSection({
  title,
  fields,
  defaultOpen,
}: {
  title: string;
  fields: MetadataSection | null;
  defaultOpen?: boolean;
}) {
  const available = fields != null;
  const [open, setOpen] = useState(!!defaultOpen && available);

  return (
    <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => available && setOpen((v) => !v)}
        className={`w-full flex items-center gap-2 px-3 py-2 text-left ${
          available
            ? "hover:bg-slate-50 cursor-pointer"
            : "cursor-default opacity-60"
        }`}
      >
        {available ? (
          open ? (
            <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-slate-500" />
          )
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-slate-300" />
        )}
        <span className="text-[12px] font-bold text-slate-900 tracking-tight">
          {title}
        </span>
        {!available && (
          <span className="ml-auto text-[10px] italic text-slate-400">
            Not Available
          </span>
        )}
      </button>
      {available && open && (
        <div className="border-t border-slate-100">
          {Object.entries(fields!).map(([label, value]) => (
            <Row key={label} label={label} value={value} />
          ))}
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: MetadataValue }) {
  const missing =
    value === null || value === undefined || (typeof value === "string" && value.trim() === "");
  const display = missing ? "Not Available" : String(value);
  return (
    <div className="grid grid-cols-[220px_1fr] gap-3 border-b border-slate-100 last:border-b-0 px-3 py-1.5">
      <div className="text-[11px] font-semibold text-slate-600">{label}</div>
      <div
        className={`text-[11px] font-mono break-all ${
          missing ? "text-slate-400 italic" : "text-slate-900"
        }`}
      >
        {display}
      </div>
    </div>
  );
}
