import { useNavigate } from "react-router-dom";

import type { StructuringReviewActions } from "@/types/api";

interface StructuringReturnActionProps {
  actions: StructuringReviewActions;
}

export function StructuringReturnAction({ actions }: StructuringReturnActionProps) {
  const navigate = useNavigate();

  if (actions.return_mode === "route" && actions.return_href) {
    return (
      <a className="button button--secondary" href={actions.return_href}>
        Return
      </a>
    );
  }

  return (
    <button className="button button--secondary" type="button" onClick={() => navigate(-1)}>
      Return
    </button>
  );
}
