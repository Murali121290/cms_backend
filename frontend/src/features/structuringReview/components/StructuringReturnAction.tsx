import { useNavigate } from "react-router-dom";

import type { StructuringReviewActions } from "@/types/api";
import { uiPaths } from "@/utils/appPaths";

interface StructuringReturnActionProps {
  actions: StructuringReviewActions;
  projectId?: number;
  chapterId?: number;
  className?: string;
  label?: string;
}

export function StructuringReturnAction({
  actions,
  projectId,
  chapterId,
  className = "button button--secondary",
  label = "Return",
}: StructuringReturnActionProps) {
  const navigate = useNavigate();

  if (actions.return_mode === "route") {
    return (
      <button
        className={className}
        type="button"
        onClick={() => {
          if (projectId != null && chapterId != null) {
            navigate(uiPaths.chapterDetail(projectId, chapterId));
          } else {
            navigate(-1);
          }
        }}
      >
        {label}
      </button>
    );
  }

  return (
    <button className={className} type="button" onClick={() => navigate(-1)}>
      {label}
    </button>
  );
}
