import { SlideDrawer } from "@/components/ui/SlideDrawer";
import { CitationCandidatePanel } from "./CitationCandidatePanel";
import { ReferenceCandidatePanel } from "./ReferenceCandidatePanel";

export interface LinkingSource {
  type: "citation" | "reference";
  key?: string;
  text: string;
  paraIdx?: number;
  refIdx?: number;
  author?: string;
  year?: string;
}

interface LinkingPanelProps {
  fileId: number;
  linkingSource: LinkingSource | null;
  onClose: () => void;
  onLinkSuccess?: (linkId: string) => void;
}

export function LinkingPanel({
  fileId,
  linkingSource,
  onClose,
  onLinkSuccess,
}: LinkingPanelProps) {
  if (!linkingSource) {
    return null;
  }

  const title = linkingSource.type === "citation"
    ? "Link Citation to Reference"
    : "Link Reference to Citation";

  return (
    <SlideDrawer
      isOpen={!!linkingSource}
      onClose={onClose}
      width="md"
      title={title}
    >
      {linkingSource.type === "citation" ? (
        <CitationCandidatePanel
          fileId={fileId}
          citationKey={linkingSource.key || ""}
          citationText={linkingSource.text}
          paraIdx={linkingSource.paraIdx || 0}
          author={linkingSource.author}
          year={linkingSource.year}
          onLinkSuccess={(linkId) => {
            onLinkSuccess?.(linkId);
            onClose();
          }}
        />
      ) : (
        <ReferenceCandidatePanel
          fileId={fileId}
          refText={linkingSource.text}
          refIdx={linkingSource.refIdx || 0}
          onLinkSuccess={(linkId) => {
            onLinkSuccess?.(linkId);
            onClose();
          }}
        />
      )}
    </SlideDrawer>
  );
}
