import { useState } from "react";

interface ChapterCreateFormProps {
  isPending: boolean;
  onSubmit: (number: string, title: string) => Promise<unknown>;
}

export function ChapterCreateForm({ isPending, onSubmit }: ChapterCreateFormProps) {
  const [number, setNumber] = useState("");
  const [title, setTitle] = useState("");

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedNumber = number.trim();
    const normalizedTitle = title.trim();
    if (!normalizedNumber || !normalizedTitle) {
      return;
    }

    await onSubmit(normalizedNumber, normalizedTitle);
    setNumber("");
    setTitle("");
  }

  return (
    <section className="panel stack">
      <div className="section-title">
        <h2>Create chapter</h2>
        <span className="helper-text">
          {"Uses the current /api/v2/projects/{project_id}/chapters contract."}
        </span>
      </div>

      <form className="admin-form-grid" onSubmit={handleSubmit}>
        <label className="field">
          <span>Number</span>
          <input
            className="search-input"
            disabled={isPending}
            placeholder="03"
            type="text"
            value={number}
            onChange={(event) => setNumber(event.target.value)}
          />
        </label>
        <label className="field">
          <span>Title</span>
          <input
            className="search-input"
            disabled={isPending}
            placeholder="Chapter 03"
            type="text"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <div className="upload-actions">
          <button className="button" disabled={isPending} type="submit">
            {isPending ? "Creating..." : "Create chapter"}
          </button>
        </div>
      </form>
    </section>
  );
}
