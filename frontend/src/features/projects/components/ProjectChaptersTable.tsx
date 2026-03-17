import { Link } from "react-router-dom";
import { useEffect, useState } from "react";

import type { ChapterSummary } from "@/types/api";
import { uiPaths } from "@/utils/appPaths";

type ChapterActionKind = "create" | "rename" | "delete";

interface ProjectChaptersTableProps {
  projectId: number;
  chapters: ChapterSummary[];
  isPending: (action: ChapterActionKind, chapterId?: number | null) => boolean;
  onRename: (chapterId: number, number: string, title: string) => Promise<unknown>;
  onDelete: (chapterId: number, number: string) => Promise<unknown>;
}

function ProjectChapterRow({
  projectId,
  chapter,
  isPending,
  onRename,
  onDelete,
}: {
  projectId: number;
  chapter: ChapterSummary;
  isPending: ProjectChaptersTableProps["isPending"];
  onRename: ProjectChaptersTableProps["onRename"];
  onDelete: ProjectChaptersTableProps["onDelete"];
}) {
  const [number, setNumber] = useState(chapter.number);
  const [title, setTitle] = useState(chapter.title);

  useEffect(() => {
    setNumber(chapter.number);
    setTitle(chapter.title);
  }, [chapter.number, chapter.title]);

  return (
    <tr>
      <td>
        <input
          className="table-input"
          disabled={isPending("rename", chapter.id)}
          type="text"
          value={number}
          onChange={(event) => setNumber(event.target.value)}
        />
      </td>
      <td>
        <div className="stack stack--tight">
          <Link className="table-link" to={uiPaths.chapterDetail(projectId, chapter.id)}>
            {chapter.title}
          </Link>
          <input
            className="table-input"
            disabled={isPending("rename", chapter.id)}
            type="text"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </div>
      </td>
      <td>{chapter.has_manuscript ? "Yes" : "No"}</td>
      <td>{chapter.has_art ? "Yes" : "No"}</td>
      <td>{chapter.has_indesign ? "Yes" : "No"}</td>
      <td>{chapter.has_proof ? "Yes" : "No"}</td>
      <td>{chapter.has_xml ? "Yes" : "No"}</td>
      <td>
        <div className="table-actions">
          <button
            className="button button--secondary button--small"
            disabled={isPending("rename", chapter.id)}
            type="button"
            onClick={() => void onRename(chapter.id, number.trim(), title.trim())}
          >
            {isPending("rename", chapter.id) ? "Saving..." : "Save"}
          </button>
          <a
            className="button button--secondary button--small"
            href={`/api/v2/projects/${projectId}/chapters/${chapter.id}/package`}
          >
            Package
          </a>
          <button
            className="button button--secondary button--small"
            disabled={isPending("delete", chapter.id)}
            type="button"
            onClick={() => void onDelete(chapter.id, chapter.number)}
          >
            {isPending("delete", chapter.id) ? "Deleting..." : "Delete"}
          </button>
        </div>
      </td>
    </tr>
  );
}

export function ProjectChaptersTable({
  projectId,
  chapters,
  isPending,
  onRename,
  onDelete,
}: ProjectChaptersTableProps) {
  return (
    <div className="panel">
      <table className="list-table">
        <thead>
          <tr>
            <th>Number</th>
            <th>Title</th>
            <th>Manuscript</th>
            <th>Art</th>
            <th>InDesign</th>
            <th>Proof</th>
            <th>XML</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {chapters.map((chapter) => (
            <ProjectChapterRow
              chapter={chapter}
              isPending={isPending}
              key={chapter.id}
              onDelete={onDelete}
              onRename={onRename}
              projectId={projectId}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
