import { useState } from "react";
import { AlertCircle, CheckCircle2, AlertTriangle, Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { useReferenceCandidates, useCitationLinking, useAddCitationComment } from "./hooks";

export function getRefDisplay(text: string): { display: string; year: string } {
  const yearMatch = text.match(/\b(19|20)\d{2}\b/) || 
                    text.match(/\bn\.d\.?\b/i) || 
                    text.match(/\bin\s+press\b/i);
  const year = yearMatch ? yearMatch[0] : "";
  
  const dotIdx = text.indexOf(".");
  const parenIdx = text.indexOf("(");
  let authorPart = text;
  if (dotIdx > 0 && (parenIdx < 0 || dotIdx < parenIdx)) {
    authorPart = text.slice(0, dotIdx).trim();
  } else if (parenIdx > 0) {
    authorPart = text.slice(0, parenIdx).trim();
  }
  
  if (authorPart.length > 50) {
    authorPart = authorPart.slice(0, 47) + "...";
  }
  
  return { display: authorPart, year };
}

interface ReferenceCandidatePanelProps {
  fileId: number;
  refText: string;
  refIdx: number;
  onLinkSuccess: (linkId: string) => void;
  allCitations?: Array<{ citation: string; para_idx?: number; status?: string; author?: string; year?: string }>;
}

export function ReferenceCandidatePanel({
  fileId,
  refText,
  refIdx,
  onLinkSuccess,
  allCitations = [],
}: ReferenceCandidatePanelProps) {
  const { data: candidatesData, isLoading, error } = useReferenceCandidates(
    fileId,
    refText,
    refIdx
  );

  const linkMutation = useCitationLinking(fileId);
  const addCommentMutation = useAddCitationComment(fileId);

  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [manualSelectedIdx, setManualSelectedIdx] = useState<number | null>(null);
  const [flagOption, setFlagOption] = useState<"verified" | "secondary">("verified");
  const [activeTab, setActiveTab] = useState<"suggested" | "manual">("suggested");
  const [manualSearchQuery, setManualSearchQuery] = useState("");
  const [commentAdded, setCommentAdded] = useState(false);

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

  const handleLinkManual = async (citation: any) => {
    try {
      const result = await linkMutation.mutateAsync({
        citation_key: citation.citation,
        citation_text: citation.citation,
        para_idx: citation.para_idx || 0,
        ref_idx: refIdx,
        ref_text: refText,
        match_type: "manual",
        confidence: 1.0,
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

  const handleAddAQComment = async () => {
    const parsedRef = getRefDisplay(refText);
    const displayVal = parsedRef.year ? `${parsedRef.display}, ${parsedRef.year}` : parsedRef.display;
    
    try {
      await addCommentMutation.mutateAsync({
        target_type: "reference",
        comment_text: `AQ: The reference "${displayVal}" is given in the list but not cited in the text. Please cite the reference in the text or delete from the list.`,
        ref_idx: refIdx,
        flags: ["aq"],
      });
      setCommentAdded(true);
    } catch (err) {
      console.error("Failed to add AQ comment:", err);
    }
  };

  // Filtered citations for manual search
  const filteredCitations = allCitations.map((cit, idx) => ({ ...cit, originalIndex: idx }))
    .filter(cit => cit.citation.toLowerCase().includes(manualSearchQuery.toLowerCase()));

  return (
    <div className="flex flex-col h-full p-4 space-y-4">
      {/* Reference Context */}
      <div className="p-3 bg-amber-50 rounded-lg border border-amber-200 shadow-sm flex items-start justify-between gap-4">
        <div className="flex-1">
          <p className="text-[10px] font-black uppercase text-amber-950 tracking-wide mb-1">Unused Bibliography Entry:</p>
          <p className="text-xs font-semibold text-amber-900 break-words leading-relaxed select-text">
            {refText}
          </p>
        </div>
        <Button
          onClick={handleAddAQComment}
          disabled={commentAdded || addCommentMutation.isPending}
          variant="secondary"
          size="sm"
          className={`shrink-0 font-bold text-[10px] px-2.5 py-1 h-auto cursor-pointer border-none shadow-sm transition-all self-center ${
            commentAdded
              ? "bg-green-100 text-green-800 hover:bg-green-100"
              : "bg-amber-600 text-white hover:bg-amber-700"
          }`}
        >
          {commentAdded ? "Added ✓" : "Add AQ Comment"}
        </Button>
      </div>

      {/* Segmented Control / Tabs */}
      <div className="bg-slate-100 p-0.5 rounded-lg border border-slate-200 flex shrink-0">
        <button
          onClick={() => setActiveTab("suggested")}
          className={`flex-1 py-1.5 rounded-md text-xs font-bold transition-all border-none cursor-pointer ${
            activeTab === "suggested"
              ? "bg-white text-navy-800 shadow-sm"
              : "text-slate-500 hover:text-slate-700 bg-transparent"
          }`}
        >
          Suggested Citations
        </button>
        <button
          onClick={() => setActiveTab("manual")}
          className={`flex-1 py-1.5 rounded-md text-xs font-bold transition-all border-none cursor-pointer ${
            activeTab === "manual"
              ? "bg-white text-navy-800 shadow-sm"
              : "text-slate-500 hover:text-slate-700 bg-transparent"
          }`}
        >
          All Citations ({allCitations.length})
        </button>
      </div>

      {activeTab === "suggested" ? (
        <>
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
              <div className="flex-1 min-h-0">
                <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">
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
              <div className="pt-4 border-t border-slate-100 space-y-2 shrink-0">
                <p className="text-xs font-semibold text-gray-600">Mark as:</p>
                <div className="flex gap-4">
                  <label className="flex items-center gap-1.5 cursor-pointer text-xs font-semibold text-gray-700">
                    <input
                      type="radio"
                      value="verified"
                      checked={flagOption === "verified"}
                      onChange={(e) => setFlagOption(e.target.value as any)}
                      className="w-4 h-4 cursor-pointer"
                    />
                    ✓ Verified match
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer text-xs font-semibold text-gray-700">
                    <input
                      type="radio"
                      value="secondary"
                      checked={flagOption === "secondary"}
                      onChange={(e) => setFlagOption(e.target.value as any)}
                      className="w-4 h-4 cursor-pointer"
                    />
                    ⚠ Secondary/derivative
                  </label>
                </div>
              </div>

              {/* Link Button */}
              {selectedIdx !== null && (
                <div className="pt-4 border-t border-slate-100 shrink-0">
                  <Button
                    onClick={() => handleLink(selectedIdx)}
                    disabled={linkMutation.isPending}
                    className="w-full font-bold py-2 bg-navy-800 hover:bg-navy-950 text-white"
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
              description="We couldn't find any unmatched citations in the text resembling this reference. Try manual search."
              icon={AlertTriangle}
            />
          ) : null}
        </>
      ) : (
        /* MANUAL ALL CITATIONS TAB */
        <>
          <div className="flex-1 min-h-0 flex flex-col gap-3">
            <div className="relative shrink-0">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search citation text..."
                value={manualSearchQuery}
                onChange={(e) => setManualSearchQuery(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 bg-slate-50 text-xs rounded-lg border border-slate-200 focus:outline-none focus:ring-1 focus:ring-slate-400 font-medium"
              />
            </div>

            <div className="flex-1 overflow-y-auto pr-1 space-y-2">
              {filteredCitations.length === 0 ? (
                <div className="text-center py-8 text-slate-400 text-xs font-semibold">
                  No citations match the search.
                </div>
              ) : (
                filteredCitations.map((cit) => {
                  const isSel = manualSelectedIdx === cit.originalIndex;
                  return (
                    <div
                      key={cit.originalIndex}
                      onClick={() => setManualSelectedIdx(cit.originalIndex)}
                      className={`p-3 rounded-lg border cursor-pointer transition-all flex gap-3 items-start ${
                        isSel
                          ? "bg-blue-50/50 border-blue-400 shadow-sm ring-1 ring-blue-400"
                          : "border-slate-200 hover:border-slate-300 bg-white"
                      }`}
                    >
                      <input
                        type="radio"
                        checked={isSel}
                        onChange={() => setManualSelectedIdx(cit.originalIndex)}
                        className="w-4 h-4 mt-0.5 cursor-pointer shrink-0"
                      />
                      <div className="text-xs leading-relaxed text-slate-800 select-text">
                        <p className="font-extrabold text-slate-900 mb-1">{cit.citation}</p>
                        {cit.status && (
                          <span className={`inline-block px-1.5 py-0.5 rounded text-[8.5px] font-black uppercase tracking-wide mr-2 ${cit.status === "missing" ? "bg-red-100 text-red-800" : "bg-green-100 text-green-800"}`}>
                            {cit.status}
                          </span>
                        )}
                        {cit.para_idx !== undefined && (
                          <span className="text-[10px] text-slate-400">Paragraph #{cit.para_idx + 1}</span>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Flag Options for Manual tab */}
          <div className="pt-4 border-t border-slate-100 space-y-2 shrink-0">
            <p className="text-xs font-semibold text-gray-600">Mark as:</p>
            <div className="flex gap-4">
              <label className="flex items-center gap-1.5 cursor-pointer text-xs font-semibold text-gray-700">
                <input
                  type="radio"
                  value="verified"
                  checked={flagOption === "verified"}
                  onChange={(e) => setFlagOption(e.target.value as any)}
                  className="w-4 h-4 cursor-pointer"
                />
                ✓ Verified match
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer text-xs font-semibold text-gray-700">
                <input
                  type="radio"
                  value="secondary"
                  checked={flagOption === "secondary"}
                  onChange={(e) => setFlagOption(e.target.value as any)}
                  className="w-4 h-4 cursor-pointer"
                />
                ⚠ Secondary/derivative
              </label>
            </div>
          </div>

          {/* Manual Link Button */}
          {manualSelectedIdx !== null && (
            <div className="pt-4 border-t border-slate-100 shrink-0">
              <Button
                onClick={() => handleLinkManual(allCitations[manualSelectedIdx])}
                disabled={linkMutation.isPending}
                className="w-full font-bold py-2 bg-navy-800 hover:bg-navy-950 text-white"
                variant="primary"
              >
                {linkMutation.isPending ? "Linking..." : "Link manually to Selected"}
              </Button>
            </div>
          )}
        </>
      )}
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
