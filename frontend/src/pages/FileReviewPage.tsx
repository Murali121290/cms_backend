import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { StructuringReviewPage } from "@/pages/StructuringReviewPage";
import { ReferenceValidationReviewPage } from "@/pages/ReferenceValidationReviewPage";

type ReviewView = "editor" | "reference";

function parseView(raw: string | null): ReviewView {
  return raw === "reference" ? "reference" : "editor";
}

export function FileReviewPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const view = parseView(searchParams.get("view"));

  // Once a tab has been visited, keep it mounted so state/scroll/data survive
  // subsequent tab switches. The inactive tab starts unmounted so we don't
  // double-fetch on first paint.
  const [mounted, setMounted] = useState<Record<ReviewView, boolean>>(() => ({
    editor: view === "editor",
    reference: view === "reference",
  }));

  useEffect(() => {
    setMounted((prev) => (prev[view] ? prev : { ...prev, [view]: true }));
  }, [view]);

  const selectView = useCallback(
    (next: ReviewView) => {
      if (next === view) return;
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev);
          params.set("view", next);
          return params;
        },
        { replace: false },
      );
    },
    [view, setSearchParams],
  );

  const tabs = useMemo(
    () =>
      [
        { key: "editor" as const, label: "Editor" },
        { key: "reference" as const, label: "Reference Review" },
      ],
    [],
  );

  return (
    <div className="flex min-h-screen flex-col bg-surface-100">
      <div
        role="tablist"
        aria-label="File review tabs"
        className="sticky top-0 z-30 flex items-center gap-1 border-b border-surface-200 bg-white px-4 shadow-sm"
      >
        {tabs.map((tab) => {
          const active = tab.key === view;
          return (
            <button
              key={tab.key}
              role="tab"
              type="button"
              aria-selected={active}
              onClick={() => selectView(tab.key)}
              className={[
                "relative px-4 py-3 text-sm font-semibold transition-colors",
                active
                  ? "text-blue-600"
                  : "text-slate-500 hover:text-slate-800",
              ].join(" ")}
            >
              {tab.label}
              <span
                aria-hidden
                className={[
                  "absolute inset-x-2 -bottom-px h-0.5 rounded-t",
                  active ? "bg-blue-600" : "bg-transparent",
                ].join(" ")}
              />
            </button>
          );
        })}
      </div>

      <div className="flex-1">
        {mounted.editor && (
          <div hidden={view !== "editor"}>
            <StructuringReviewPage />
          </div>
        )}
        {mounted.reference && (
          <div hidden={view !== "reference"}>
            <ReferenceValidationReviewPage />
          </div>
        )}
      </div>
    </div>
  );
}

export default FileReviewPage;
