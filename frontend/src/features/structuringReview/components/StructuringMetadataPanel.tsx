import type { StructuringReviewResponse } from "@/types/api";

interface StructuringMetadataPanelProps {
  review: StructuringReviewResponse;
}

export function StructuringMetadataPanel({ review }: StructuringMetadataPanelProps) {
  return (
    <section className="panel stack">
      <div className="section-title">
        <h2>Review metadata</h2>
        <span className="helper-text">Rendered directly from the current /api/v2 structuring-review contract.</span>
      </div>

      <div className="detail-grid">
        <article className="detail-card">
          <strong>Source file</strong>
          <span>{review.file.filename}</span>
        </article>
        <article className="detail-card">
          <strong>Processed file</strong>
          <span>{review.processed_file.filename}</span>
        </article>
        <article className="detail-card">
          <strong>Editor mode</strong>
          <span>{review.editor.mode}</span>
        </article>
        <article className="detail-card">
          <strong>WOPI mode</strong>
          <span>{review.editor.wopi_mode}</span>
        </article>
        <article className="detail-card">
          <strong>Save mode</strong>
          <span>{review.editor.save_mode}</span>
        </article>
        <article className="detail-card">
          <strong>Styles available</strong>
          <span>{review.styles.length}</span>
        </article>
      </div>

      <div className="chip-row">
        {review.styles.map((style) => (
          <span className="chip" key={style}>
            {style}
          </span>
        ))}
      </div>

      {review.editor.collabora_url ? (
        <div className="upload-actions">
          <a
            className="button button--secondary"
            href={review.editor.collabora_url}
            rel="noreferrer"
            target="_blank"
          >
            Open provided editor URL
          </a>
        </div>
      ) : null}
    </section>
  );
}
