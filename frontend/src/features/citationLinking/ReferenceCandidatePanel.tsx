import { useState } from "react";
import { AlertCircle, CheckCircle2, AlertTriangle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { useReferenceCandidates, useCitationLinking } from "./hooks";

interface ReferenceCandidatePanelProps {
  fileId: number;
  refText: string;
  refIdx: number;
  onLinkSuccess: (linkId: string) => void;
}

export function ReferenceCandidatePanel({
  fileId,
  refText,
  refIdx,
  onLinkSuccess,
}: ReferenceCandidatePanelProps) {
  const { data: candidatesData, isLoading, error } = useReferenceCandidates(
    fileId,
    refText,
    refIdx
  );

  const linkMutation = useCitationLinking(fileId);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [flagOption, setFlagOption] = useState<"verified" | "secondary">("verified");

  const candidates = candidatesData?.candidates || [];

  const handleLink = async (candidateIdx: number) => {
    const candidate = candidates[candidateIdx];
    if (!candidate) return;

    try {
      const result = await linkMutation.mutateAsync({
        citation_key: candidate.citation_text, // Use the citation_text as key for Name-Year
        citation_text: candidate.citation_text,
        para_idx: candidate.para_idx,
        ref_idx: refIdx,
        ref_text: refText,
        match_type: candidate.match_type || "user_selected",
        confidence: candidate.confidence,
        link_flags: {
          flag_type: flagOption === "verified" ? "verified" : "secondary",
          user_notes: "",
        },
      });

      onLinkSuccess(result.link_id);
    } catch (err) {
      console.error("Link failed:", err);
    }
  };

  return (
    <div className="flex flex-col h-full p-4 space-y-4">
      {/* Reference Context */}
      <div className="p-3 bg-amber-50 rounded border border-amber-200">
        <p className="text-xs font-semibold text-amber-950 mb-1">Unused Bibliography Entry:</p>
        <p className="text-sm font-medium text-amber-900 break-words">
          {refText}
        </p>
      </div>

      {/* Loading State */}
      {isLoading && (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
          <span className="ml-2 text-sm text-gray-500">Finding citation candidates...</span>
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="p-3 bg-red-50 rounded border border-red-200 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-semibold text-red-900">Error loading candidates</p>
            <p className="text-xs text-red-700">{String(error)}</p>
          </div>
        </div>
      )}

      {/* Candidates List */}
      {!isLoading && !error && candidates.length > 0 ? (
        <>
          <div>
            <p className="text-xs font-semibold text-gray-600 mb-2">
              Pick matching citation found in text:
            </p>

            <div className="space-y-2 max-h-[300px] overflow-y-auto pr-2">
              {candidates.map((candidate, idx) => (
                <CandidateCitationCard
                  key={idx}
                  candidate={candidate}
                  isSelected={selectedIdx === idx}
                  onSelect={() => setSelectedIdx(idx)}
                  onLink={() => handleLink(idx)}
                  isLoading={linkMutation.isPending}
                />
              ))}
            </div>
          </div>

          {/* Flag Options */}
          <div className="pt-4 border-t space-y-2">
            <p className="text-xs font-semibold text-gray-600">Mark as:</p>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                value="verified"
                checked={flagOption === "verified"}
                onChange={(e) => setFlagOption(e.target.value as any)}
                className="w-4 h-4"
              />
              <span className="text-sm text-gray-700">✓ Verified match</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                value="secondary"
                checked={flagOption === "secondary"}
                onChange={(e) => setFlagOption(e.target.value as any)}
                className="w-4 h-4"
              />
              <span className="text-sm text-gray-700">⚠ Secondary/derivative</span>
            </label>
          </div>

          {/* Link Button */}
          {selectedIdx !== null && (
            <div className="pt-4">
              <Button
                onClick={() => handleLink(selectedIdx)}
                disabled={linkMutation.isPending}
                className="w-full"
                variant="primary"
              >
                {linkMutation.isPending ? "Linking..." : "Confirm & Link"}
              </Button>
            </div>
          )}
        </>
      ) : !isLoading && !error ? (
        <EmptyState
          title="No citation candidates found"
          description="We couldn't find any unmatched citations in the text resembling this reference"
          icon={AlertTriangle}
        />
      ) : null}
    </div>
  );
}

interface CandidateCitationCardProps {
  candidate: any;
  isSelected: boolean;
  onSelect: () => void;
  onLink: () => void;
  isLoading: boolean;
}

function CandidateCitationCard({
  candidate,
  isSelected,
  onSelect,
  onLink,
  isLoading,
}: CandidateCitationCardProps) {
  const getMatchIcon = (matchType: string) => {
    if (matchType === "exact") {
      return <CheckCircle2 className="w-4 h-4 text-green-600" />;
    }
    return <AlertTriangle className="w-4 h-4 text-yellow-600" />;
  };

  const getMatchColor = (confidence: number) => {
    if (confidence >= 0.9) {
      return "bg-green-50 border-green-200 hover:border-green-300";
    }
    return "bg-yellow-50 border-yellow-200 hover:border-yellow-300";
  };

  return (
    <div
      onClick={onSelect}
      className={`p-3 rounded border cursor-pointer transition-all ${getMatchColor(
        candidate.confidence
      )} ${isSelected ? "ring-2 ring-blue-400 ring-offset-1" : ""}`}
    >
      <div className="flex items-start gap-2 mb-2">
        <input
          type="radio"
          checked={isSelected}
          onChange={onSelect}
          className="w-4 h-4 mt-0.5"
        />
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            {getMatchIcon(candidate.match_type)}
            <span className="text-xs font-bold uppercase text-gray-600">
              {candidate.confidence >= 0.9 ? "Spelling Match" : "Spelling Mismatch"}
            </span>
            <span className="ml-auto text-xs font-semibold text-gray-700">
              {Math.round(candidate.confidence * 100)}%
            </span>
          </div>
          <p className="text-xs text-gray-600 font-semibold">
            Cited as: "{candidate.citation_text}"
          </p>
          <p className="text-xs text-gray-500 mt-1 italic">{candidate.reason}</p>
          <p className="text-[10px] text-gray-400 mt-0.5">Found at Paragraph #{candidate.para_idx + 1}</p>
        </div>
      </div>
      {isSelected && (
        <div className="ml-6">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onLink();
            }}
            disabled={isLoading}
            className="text-xs font-semibold text-blue-600 hover:text-blue-700 px-2 py-1 rounded hover:bg-blue-100 transition-colors disabled:opacity-50"
          >
            {isLoading ? "Linking..." : "Link to this"}
          </button>
        </div>
      )}
    </div>
  );
}
