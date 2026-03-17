import type { ChapterCategoryCounts } from "@/types/api";

interface ChapterCategorySummaryProps {
  counts: ChapterCategoryCounts;
  activeTab: string;
}

const orderedCategories: Array<keyof ChapterCategoryCounts> = [
  "Manuscript",
  "Art",
  "InDesign",
  "Proof",
  "XML",
  "Miscellaneous",
];

export function ChapterCategorySummary({ counts, activeTab }: ChapterCategorySummaryProps) {
  return (
    <div className="chip-row">
      {orderedCategories.map((category) => (
        <span
          className={`chip${category === activeTab ? " chip--active" : ""}`}
          key={category}
        >
          {category}: {counts[category]}
        </span>
      ))}
    </div>
  );
}
