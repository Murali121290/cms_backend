import { useState } from "react";
import { AlertCircle, CheckCircle2, AlertTriangle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { useCitationCandidates, useCitationLinking } from "./hooks";

interface CitationCandidatePanelProps {
  fileId: number;
  citationKey: string;
  citationText: string;
  paraIdx: number;
  author?: string;
  year?: string;
  onLinkSuccess: (linkId: string) => void;
}

export function CitationCandidatePanel({
  fileId,
  citationKey,
  citationText,
  paraIdx,
  author,
  year,
  onLinkSuccess,
}: CitationCandidatePanelProps) {
  const { data: candidatesData, isLoading, error } = useCitationCandidates(
    fileId,
    citationText,
    author,
    year
  );

  const linkMutation = useCitationLinking(fileId);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [flagOption, setFlagOption] = useState<"verified" | "secondary">("verified");

  const candidates = candidatesData?.candidates || [];

  const handleLink = async (refIdx: number) => {
    const candidate = candidates[selectedIdx ?? 0];
    if (!candidate) return;

    try {
      const result = await linkMutation.mutateAsync({
        citation_key: citationKey,
        citation_text: citationText,
        para_idx: paraIdx,
        ref_idx: refIdx,
        ref_text: candidate.ref_text,
        match_type: candidate.match_type,
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
      {/* Citation Context */}
      <div className="p-3 bg-blue-50 rounded border border-blue-200">
        <p className="text-xs font-semibold text-blue-900 mb-1">Citation:</p>
        <p className="text-sm font-medium text-blue-800 break-words">
          {citationText}
        </p>
      </div>

      {/* Loading State */}
      {isLoading && (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
          <span className="ml-2 text-sm text-gray-500">Finding candidates...</span>
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
              Found {candidates.length} candidate{candidates.length !== 1 ? "s" : ""}
            </p>

            <div className="space-y-2 max-h-[300px] overflow-y-auto pr-2">
              {candidates.map((candidate, idx) => (
                <CandidateCard
                  key={idx}
                  candidate={candidate}
                  isSelected={selectedIdx === idx}
                  onSelect={() => setSelectedIdx(idx)}
                  onLink={() => handleLink(candidate.ref_key as number)}
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
                onClick={() => handleLink(candidates[selectedIdx].ref_key as number)}
                disabled={linkMutation.isPending}
                className="w-full"
                variant="primary"
              >
                {linkMutation.isPending ? "Linking..." : "Link to Selected"}
              </Button>
            </div>
          )}
        </>
      ) : !isLoading && !error ? (
        <EmptyState
          title="No candidates found"
          description="This citation might need manual entry in the bibliography"
          icon={AlertTriangle}
        />
      ) : null}
    </div>
  );
}

interface CandidateCardProps {
  candidate: any;
  isSelected: boolean;
  onSelect: () => void;
  onLink: () => void;
  isLoading: boolean;
}

function CandidateCard({
  candidate,
  isSelected,
  onSelect,
  onLink,
  isLoading,
}: CandidateCardProps) {
  const getMatchIcon = (matchType: string) => {
    switch (matchType) {
      case "exact":
        return <CheckCircle2 className="w-4 h-4 text-green-600" />;
      case "smart":
        return <CheckCircle2 className="w-4 h-4 text-blue-600" />;
      case "spelling_mismatch":
        return <AlertTriangle className="w-4 h-4 text-yellow-600" />;
      case "year_mismatch":
        return <AlertTriangle className="w-4 h-4 text-orange-600" />;
      default:
        return <AlertCircle className="w-4 h-4 text-gray-400" />;
    }
  };

  const getMatchColor = (matchType: string) => {
    switch (matchType) {
      case "exact":
        return "bg-green-50 border-green-200 hover:border-green-300";
      case "smart":
        return "bg-blue-50 border-blue-200 hover:border-blue-300";
      case "spelling_mismatch":
      case "year_mismatch":
        return "bg-yellow-50 border-yellow-200 hover:border-yellow-300";
      default:
        return "bg-gray-50 border-gray-200 hover:border-gray-300";
    }
  };

  return (
    <div
      onClick={onSelect}
      className={`p-3 rounded border cursor-pointer transition-all ${getMatchColor(
        candidate.match_type
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
              {candidate.match_type.replace(/_/g, " ")}
            </span>
            <span className="ml-auto text-xs font-semibold text-gray-700">
              {Math.round(candidate.confidence * 100)}%
            </span>
          </div>
          <p className="text-xs text-gray-600 line-clamp-2">
            {candidate.ref_text}
          </p>
          <p className="text-xs text-gray-500 mt-1 italic">{candidate.reason}</p>
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
