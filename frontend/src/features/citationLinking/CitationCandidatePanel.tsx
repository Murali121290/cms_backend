import { useState } from "react";
import { AlertCircle, CheckCircle2, AlertTriangle, Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { useCitationCandidates, useCitationLinking, useAddCitationComment } from "./hooks";

export function splitCitationBlock(text: string): string[] {
  // Strip outer parentheses/brackets
  const clean = text.replace(/^\s*[([\]\s]+/, "").replace(/[)\]\s]+\s*$/, "").trim();
  if (!clean) return [];

  // First, if there are semicolons, split by semicolon (standard APA)
  if (clean.includes(";")) {
    return clean.split(";").map(s => s.trim()).filter(Boolean);
  }

  // If there are no semicolons, but there are multiple years/n.d., it might be separated by commas
  // e.g. "IHI, 2017, CMS, n.d." or "Smith, 2018, Jones, 2020"
  // Let's split by comma and group them
  const parts = clean.split(",").map(p => p.trim()).filter(Boolean);
  const citations: string[] = [];
  
  const isYearToken = (s: string) => {
    return /^\b(19|20)\d{2}[a-z]?\b$/.test(s) || 
           /\bn\.d\.?\b/i.test(s) || 
           /\bin\s+press\b/i.test(s);
  };

  let current = "";
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (current === "") {
      current = part;
    } else {
      current += ", " + part;
    }
    if (isYearToken(part)) {
      citations.push(current);
      current = "";
    }
  }
  if (current !== "") {
    citations.push(current);
  }

  return citations.length > 0 ? citations : [clean];
}

interface CitationCandidatePanelProps {
  fileId: number;
  citationKey: string;
  citationText: string;
  paraIdx: number;
  author?: string;
  year?: string;
  onLinkSuccess: (linkId: string) => void;
  allReferences?: Array<{ num?: number; text: string; para_idx?: number; is_cited?: boolean }>;
}

export function CitationCandidatePanel({
  fileId,
  citationKey,
  citationText,
  paraIdx,
  author,
  year,
  onLinkSuccess,
  allReferences = [],
}: CitationCandidatePanelProps) {
  const { data: candidatesData, isLoading, error } = useCitationCandidates(
    fileId,
    citationText,
    author,
    year
  );

  const linkMutation = useCitationLinking(fileId);
  const addCommentMutation = useAddCitationComment(fileId);

  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [manualSelectedIdx, setManualSelectedIdx] = useState<number | null>(null);
  const [flagOption, setFlagOption] = useState<"verified" | "secondary">("verified");
  const [activeTab, setActiveTab] = useState<"suggested" | "manual">("suggested");
  const [manualSearchQuery, setManualSearchQuery] = useState("");
  const [addedCitations, setAddedCitations] = useState<Set<string>>(new Set());

  const candidates = candidatesData?.candidates || [];
  const individualCitations = splitCitationBlock(citationText);

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

  const handleLinkManual = async (refIdx: number, refText: string) => {
    try {
      const result = await linkMutation.mutateAsync({
        citation_key: citationKey,
        citation_text: citationText,
        para_idx: paraIdx,
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

  const handleAddAQComment = async (citText: string) => {
    try {
      await addCommentMutation.mutateAsync({
        target_type: "citation",
        comment_text: `AQ: The reference "${citText}" is cited in the text but not given in the list. Please provide complete publication details of this reference in the list or delete the citation from the text.`,
        citation_key: citationKey,
        para_idx: paraIdx,
        flags: ["aq"],
      });
      setAddedCitations(prev => {
        const next = new Set(prev);
        next.add(citText);
        return next;
      });
    } catch (err) {
      console.error("Failed to add AQ comment:", err);
    }
  };

  // Filtered references for manual search
  const filteredReferences = allReferences.map((ref, idx) => ({ ...ref, originalIndex: idx }))
    .filter(ref => ref.text.toLowerCase().includes(manualSearchQuery.toLowerCase()));

  return (
    <div className="flex flex-col h-full p-4 space-y-4">
      {/* Citation Context */}
      <div className="p-3 bg-blue-50 rounded-lg border border-blue-200 shadow-sm space-y-2.5">
        <div>
          <p className="text-[10px] font-black uppercase text-blue-900 tracking-wide mb-1">Citation in Text:</p>
          <p className="text-xs font-semibold text-blue-800 break-words leading-relaxed select-text">
            {citationText}
          </p>
        </div>

        {/* AQ Comment Actions */}
        <div className="pt-2 border-t border-blue-200/60 flex flex-col gap-2">
          {individualCitations.map((cit, idx) => {
            const hasBeenAdded = addedCitations.has(cit);
            return (
              <div key={idx} className="flex items-center justify-between gap-4 bg-white/60 p-2 rounded-md border border-blue-100 shadow-sm">
                <span className="text-[11px] font-bold text-blue-900 break-all select-text">
                  {cit}
                </span>
                <Button
                  onClick={() => handleAddAQComment(cit)}
                  disabled={hasBeenAdded || addCommentMutation.isPending}
                  variant="secondary"
                  size="sm"
                  className={`shrink-0 font-bold text-[10px] px-2.5 py-1 h-auto cursor-pointer border-none shadow-sm transition-all ${
                    hasBeenAdded
                      ? "bg-green-100 text-green-800 hover:bg-green-100"
                      : "bg-blue-600 text-white hover:bg-blue-700"
                  }`}
                >
                  {hasBeenAdded ? "Added ✓" : "Add AQ Comment"}
                </Button>
              </div>
            );
          })}
        </div>
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
          Suggested Matches
        </button>
        <button
          onClick={() => setActiveTab("manual")}
          className={`flex-1 py-1.5 rounded-md text-xs font-bold transition-all border-none cursor-pointer ${
            activeTab === "manual"
              ? "bg-white text-navy-800 shadow-sm"
              : "text-slate-500 hover:text-slate-700 bg-transparent"
          }`}
        >
          All References ({allReferences.length})
        </button>
      </div>

      {activeTab === "suggested" ? (
        <>
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
              <div className="flex-1 min-h-0">
                <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">
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
                    onClick={() => handleLink(candidates[selectedIdx].ref_key as number)}
                    disabled={linkMutation.isPending}
                    className="w-full font-bold py-2 bg-navy-800 hover:bg-navy-950 text-white"
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
              description="This citation might need manual selection in the 'All References' tab."
              icon={AlertTriangle}
            />
          ) : null}
        </>
      ) : (
        /* MANUAL ALL REFERENCES TAB */
        <>
          <div className="flex-1 min-h-0 flex flex-col gap-3">
            <div className="relative shrink-0">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search reference text or number..."
                value={manualSearchQuery}
                onChange={(e) => setManualSearchQuery(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 bg-slate-50 text-xs rounded-lg border border-slate-200 focus:outline-none focus:ring-1 focus:ring-slate-400 font-medium"
              />
            </div>

            <div className="flex-1 overflow-y-auto pr-1 space-y-2">
              {filteredReferences.length === 0 ? (
                <div className="text-center py-8 text-slate-400 text-xs font-semibold">
                  No references match the search.
                </div>
              ) : (
                filteredReferences.map((ref) => {
                  const isSel = manualSelectedIdx === ref.originalIndex;
                  return (
                    <div
                      key={ref.originalIndex}
                      onClick={() => setManualSelectedIdx(ref.originalIndex)}
                      className={`p-3 rounded-lg border cursor-pointer transition-all flex gap-3 items-start ${
                        isSel
                          ? "bg-blue-50/50 border-blue-400 shadow-sm ring-1 ring-blue-400"
                          : "border-slate-200 hover:border-slate-300 bg-white"
                      }`}
                    >
                      <input
                        type="radio"
                        checked={isSel}
                        onChange={() => setManualSelectedIdx(ref.originalIndex)}
                        className="w-4 h-4 mt-0.5 cursor-pointer shrink-0"
                      />
                      <div className="text-xs leading-relaxed text-slate-800 select-text">
                        <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-black mr-2 ${isSel ? "bg-blue-100 text-blue-800" : "bg-slate-100 text-slate-600"}`}>
                          Ref {ref.num || ref.originalIndex + 1}
                        </span>
                        {ref.text}
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
                onClick={() => handleLinkManual(manualSelectedIdx, allReferences[manualSelectedIdx].text)}
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
