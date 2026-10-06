import type { RefObject } from "react";

import type { WysiwygEditorHandle } from "@/features/editor";
import { ReferenceReviewSidePanel } from "./ReferenceReviewSidePanel";

interface LeftReferenceSidebarTableProps {
  fileId: number | null;
  editorRef: RefObject<WysiwygEditorHandle | null>;
}

// Thin wrapper around the real ReferenceReviewSidePanel (stat tiles, Style/
// Format dropdowns, Style Highlight Manager, All/Matched/Missing/Unused
// filters, Locate links) — that component is already fully self-contained
// with only {fileId, editorRef}, so full feature parity comes for free.
//
// Note: the real panel's natural layout is a right-hand column (as used today
// inside StructuringReviewPage.tsx), so the unified page renders it on the
// right despite this file's "Left…" name — see the implementation plan for
// the reasoning.
export function LeftReferenceSidebarTable({ fileId, editorRef }: LeftReferenceSidebarTableProps) {
  return <ReferenceReviewSidePanel fileId={fileId} editorRef={editorRef} />;
}
