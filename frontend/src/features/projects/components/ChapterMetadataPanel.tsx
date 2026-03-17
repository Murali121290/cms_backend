import type { ChapterDetail } from "@/types/api";

interface ChapterMetadataPanelProps {
  chapter: ChapterDetail;
  activeTab: string;
}

export function ChapterMetadataPanel({ chapter, activeTab }: ChapterMetadataPanelProps) {
  return (
    <div className="detail-grid">
      <article className="detail-card">
        <strong>Chapter number</strong>
        <span>{chapter.number}</span>
      </article>
      <article className="detail-card">
        <strong>Title</strong>
        <span>{chapter.title}</span>
      </article>
      <article className="detail-card">
        <strong>Active tab</strong>
        <span>{activeTab}</span>
      </article>
      <article className="detail-card">
        <strong>Manuscript files</strong>
        <span>{chapter.category_counts.Manuscript}</span>
      </article>
      <article className="detail-card">
        <strong>Art files</strong>
        <span>{chapter.category_counts.Art}</span>
      </article>
      <article className="detail-card">
        <strong>XML files</strong>
        <span>{chapter.category_counts.XML}</span>
      </article>
    </div>
  );
}
