/**
 * ChapterCategorySummary â€” re-exported for backward compat.
 * The new primary exports are CHAPTER_SECTIONS and ChapterSectionCards.
 */
import type { ComponentType } from "react";
import type { LucideProps } from "lucide-react";
import { FileText, Palette, Layout, Eye, Code2, FolderOpen } from "lucide-react";

import type { ChapterCategoryCounts } from "@/types/api";
import { cn } from "@/utils/cn";

// â”€â”€â”€ ChapterSection type (used by ChapterFilesTable) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export type ChapterSection = "Overview" | keyof ChapterCategoryCounts;

// â”€â”€â”€ Section config â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface SectionDef {
  key: keyof ChapterCategoryCounts;
  label: string;
  Icon: ComponentType<LucideProps>;
  color: string;
  bg: string;
  paramKey: string; // URL query param value
}

export const CHAPTER_SECTIONS: SectionDef[] = [
  {
    key: "Manuscript",
    label: "Manuscript",
    Icon: FileText,
    color: "#2B579A",
    bg: "rgba(43,87,154,0.10)",
    paramKey: "manuscript",
  },
  {
    key: "Art",
    label: "Art",
    Icon: Palette,
    color: "#E8A838",
    bg: "rgba(232,168,56,0.10)",
    paramKey: "art",
  },
  {
    key: "InDesign",
    label: "InDesign",
    Icon: Layout,
    color: "#FF3366",
    bg: "rgba(255,51,102,0.10)",
    paramKey: "indesign",
  },
  {
    key: "Proof",
    label: "Proof",
    Icon: Eye,
    color: "#7C3AED",
    bg: "rgba(124,58,237,0.10)",
    paramKey: "proof",
  },
  {
    key: "XML",
    label: "XML",
    Icon: Code2,
    color: "#16A34A",
    bg: "rgba(22,163,74,0.10)",
    paramKey: "xml",
  },
  {
    key: "Miscellaneous",
    label: "Misc",
    Icon: FolderOpen,
    color: "#5a7b9c",
    bg: "rgba(90,123,156,0.10)",
    paramKey: "misc",
  },
];

/** Build a fast lookup: paramKey â†’ SectionDef */
export const SECTION_BY_PARAM: Record<string, SectionDef> = Object.fromEntries(
  CHAPTER_SECTIONS.map((s) => [s.paramKey, s])
);

/** Build a fast lookup: key â†’ SectionDef */
export const SECTION_BY_KEY: Record<keyof ChapterCategoryCounts, SectionDef> =
  Object.fromEntries(CHAPTER_SECTIONS.map((s) => [s.key, s])) as Record<
    keyof ChapterCategoryCounts,
    SectionDef
  >;

// â”€â”€â”€ 5-card grid (overview) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

interface ChapterSectionCardsProps {
  counts: ChapterCategoryCounts;
  onSelect: (section: keyof ChapterCategoryCounts) => void;
}

export function ChapterSectionCards({ counts, onSelect }: ChapterSectionCardsProps) {
  const total = CHAPTER_SECTIONS.reduce((sum, s) => sum + counts[s.key], 0);

  return (
    <div className="space-y-6">
      {/* Total summary */}
      <p className="text-sm text-muted">
        <span className="font-semibold text-text">{total}</span> files across all categories
      </p>

      {/* Card grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-4">
        {CHAPTER_SECTIONS.map((s) => {
          const count = counts[s.key];
          return (
            <button
              key={s.key}
              type="button"
              onClick={() => onSelect(s.key)}
              className={cn(
                "group bg-white rounded-lg border border-border p-4",
                "flex flex-col items-start gap-3 text-left",
                "hover:shadow-hover hover:border-primary transition-all duration-150",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-600"
              )}
            >
              <div
                className="w-10 h-10 rounded-lg flex items-center justify-center"
                style={{ backgroundColor: s.bg }}
              >
                <s.Icon className="w-5 h-5" style={{ color: s.color }} aria-hidden="true" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-text leading-snug">{s.label}</h3>
                <p className="text-xs text-muted mt-0.5 tabular-nums">
                  {count} {count === 1 ? "file" : "files"}
                </p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// â”€â”€â”€ Backward-compat stub (no longer rendered) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/** @deprecated Use ChapterSectionCards instead */
export function ChapterCategorySummary(_props: {
  counts: ChapterCategoryCounts;
  selectedSection: ChapterSection;
}) {
  return null;
}
