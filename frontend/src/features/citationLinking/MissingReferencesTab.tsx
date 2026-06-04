import { useState } from "react";
import { AlertCircle, CheckCircle2, Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { useCitationComments, useAddCitationComment } from "./hooks";

interface MissingReferencesTabProps {
  fileId: number;
}

export function MissingReferencesTab({ fileId }: MissingReferencesTabProps) {
  const { data, isLoading, error } = useCitationComments(fileId);
  const [expandedCommentId, setExpandedCommentId] = useState<string | null>(null);

  const links = data?.links || [];
  const comments = data?.comments || [];

  // Group comments by citation/reference
  const commentsByTarget = comments.reduce(
    (acc, comment) => {
      const key = comment.citation_key || `ref_${comment.ref_idx}`;
      if (!acc[key]) {
        acc[key] = [];
      }
      acc[key].push(comment);
      return acc;
    },
    {} as Record<string, typeof comments>
  );

  return (
    <div className="flex flex-col h-full space-y-4 p-4">
      {/* Header */}
      <div>
        <h3 className="font-semibold text-gray-900 mb-1">
          Citation-Reference Links & Comments
        </h3>
        <p className="text-xs text-gray-600">
          {links.length} link{links.length !== 1 ? "s" : ""} • {comments.length} comment
          {comments.length !== 1 ? "s" : ""}
        </p>
      </div>

      {/* Loading State */}
      {isLoading && (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
          <span className="ml-2 text-sm text-gray-500">Loading comments...</span>
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="p-3 bg-red-50 rounded border border-red-200 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-red-700">Failed to load comments</p>
        </div>
      )}

      {/* Links & Comments List */}
      {!isLoading && !error && (links.length > 0 || comments.length > 0) ? (
        <div className="flex-1 overflow-y-auto space-y-3 pr-2">
          {/* Render links */}
          {links.map((link) => (
            <LinkCard key={link.link_id} link={link} />
          ))}

          {/* Render comments */}
          {comments.map((comment) => (
            <CommentCard
              key={comment.comment_id}
              comment={comment}
              isExpanded={expandedCommentId === comment.comment_id}
              onToggle={() =>
                setExpandedCommentId(
                  expandedCommentId === comment.comment_id ? null : comment.comment_id
                )
              }
            />
          ))}
        </div>
      ) : !isLoading && !error ? (
        <EmptyState
          title="No comments or links yet"
          description="Comments and links will appear here as you link citations to references"
          icon={AlertCircle}
        />
      ) : null}

      {/* Add Comment Form */}
      {!isLoading && (
        <div className="pt-4 border-t">
          <AddCommentForm fileId={fileId} links={links} />
        </div>
      )}
    </div>
  );
}

interface LinkCardProps {
  link: any;
}

function LinkCard({ link }: LinkCardProps) {
  return (
    <div className="p-3 bg-green-50 rounded border border-green-200">
      <div className="flex items-start gap-2">
        <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-bold text-green-900">LINKED</span>
            <span className="text-xs text-green-700 font-semibold">
              {link.confidence ? `${Math.round(link.confidence * 100)}%` : ""}
            </span>
          </div>
          <p className="text-xs text-green-800 font-medium mb-1">
            {link.citation_text} → [{link.ref_idx}]
          </p>
          <p className="text-xs text-green-700 line-clamp-2">{link.ref_text}</p>
          <p className="text-xs text-green-600 mt-1">
            Linked by {link.linked_by} •{" "}
            {new Date(link.linked_at).toLocaleDateString()}
          </p>
        </div>
      </div>
    </div>
  );
}

interface CommentCardProps {
  comment: any;
  isExpanded: boolean;
  onToggle: () => void;
}

function CommentCard({ comment, isExpanded, onToggle }: CommentCardProps) {
  const getIconForTarget = (targetType: string) => {
    return targetType === "citation" ? (
      <AlertCircle className="w-4 h-4 text-blue-600" />
    ) : (
      <AlertCircle className="w-4 h-4 text-orange-600" />
    );
  };

  return (
    <div
      className={`p-3 rounded border cursor-pointer transition-all ${
        isExpanded
          ? "bg-gray-50 border-gray-300"
          : "bg-white border-gray-200 hover:border-gray-300"
      }`}
      onClick={onToggle}
    >
      <div className="flex items-start gap-2">
        {getIconForTarget(comment.target_type)}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-bold uppercase text-gray-600">
              {comment.target_type}
            </span>
            {comment.flags?.length > 0 && (
              <div className="flex gap-1">
                {comment.flags.map((flag: string) => (
                  <span
                    key={flag}
                    className="text-xs px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 font-medium"
                  >
                    {flag}
                  </span>
                ))}
              </div>
            )}
          </div>
          <p className="text-xs font-medium text-gray-800 mb-1">
            {comment.citation_text || `[${comment.ref_idx}]`}
          </p>
          {isExpanded && (
            <>
              <p className="text-xs text-gray-700 mb-2 leading-relaxed whitespace-pre-wrap">
                {comment.comment_text}
              </p>
              <p className="text-xs text-gray-500">
                {comment.created_by} • {new Date(comment.created_at).toLocaleString()}
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

interface AddCommentFormProps {
  fileId: number;
  links: any[];
}

function AddCommentForm({ fileId, links }: AddCommentFormProps) {
  const [commentText, setCommentText] = useState("");
  const [selectedLinkIdx, setSelectedLinkIdx] = useState<number | null>(null);
  const [flagOption, setFlagOption] = useState("verified");
  const addCommentMutation = useAddCitationComment(fileId);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!commentText.trim()) return;

    try {
      const selectedLink = selectedLinkIdx !== null ? links[selectedLinkIdx] : null;

      await addCommentMutation.mutateAsync({
        target_type: "citation",
        comment_text: commentText,
        citation_key: selectedLink?.citation_key,
        para_idx: selectedLink?.para_idx,
        ref_idx: selectedLink?.ref_idx,
        flags: [flagOption],
      });

      setCommentText("");
      setSelectedLinkIdx(null);
    } catch (err) {
      console.error("Failed to add comment:", err);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <label className="block text-xs font-semibold text-gray-600 mb-2">
        Add Comment
      </label>

      {links.length > 0 && (
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-gray-600">
            Link comment to (optional):
          </label>
          <div className="space-y-1 max-h-24 overflow-y-auto">
            {links.map((link, idx) => (
              <label key={idx} className="flex items-center gap-2 cursor-pointer text-xs">
                <input
                  type="radio"
                  checked={selectedLinkIdx === idx}
                  onChange={() => setSelectedLinkIdx(idx)}
                  className="w-3 h-3"
                />
                <span className="text-gray-700">
                  {link.citation_text} → [{link.ref_idx}]
                </span>
              </label>
            ))}
          </div>
        </div>
      )}

      <textarea
        value={commentText}
        onChange={(e) => setCommentText(e.target.value)}
        placeholder="Add notes about this citation or reference..."
        className="w-full h-20 p-2 text-xs border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
      />

      <div className="space-y-2">
        <label className="text-xs font-semibold text-gray-600">Flag as:</label>
        <div className="flex gap-3">
          {["verified", "needs_review", "secondary"].map((flag) => (
            <label key={flag} className="flex items-center gap-1 cursor-pointer">
              <input
                type="radio"
                value={flag}
                checked={flagOption === flag}
                onChange={(e) => setFlagOption(e.target.value)}
                className="w-3 h-3"
              />
              <span className="text-xs text-gray-700 capitalize">
                {flag.replace(/_/g, " ")}
              </span>
            </label>
          ))}
        </div>
      </div>

      <Button
        type="submit"
        disabled={!commentText.trim() || addCommentMutation.isPending}
        className="w-full"
        variant="primary"
        size="sm"
      >
        <Send className="w-3 h-3 mr-1" />
        {addCommentMutation.isPending ? "Posting..." : "Post Comment"}
      </Button>
    </form>
  );
}
