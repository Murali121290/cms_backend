import { ChevronDown, ChevronUp } from "lucide-react";
import type { StructuredBlock } from "@/types/api";

interface FootnotesSectionProps {
  blocks: StructuredBlock[];
  expanded: boolean;
  onToggle: () => void;
}

export function FootnotesSection({ blocks, expanded, onToggle }: FootnotesSectionProps) {
  return (
    <div
      style={{
        padding: "16px",
        marginTop: "24px",
        borderTop: "1px solid #E2DDD6",
        backgroundColor: "#F5F4F1",
        borderRadius: "4px",
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          fontSize: "14px",
          fontWeight: 600,
          color: "#1A1714",
          backgroundColor: "transparent",
          border: "none",
          cursor: "pointer",
          padding: "0",
        }}
      >
        {expanded ? (
          <ChevronUp size={18} />
        ) : (
          <ChevronDown size={18} />
        )}
        Footnotes & Endnotes ({blocks.length})
      </button>

      {expanded && (
        <div style={{ marginTop: "12px", display: "flex", flexDirection: "column", gap: "12px" }}>
          {blocks.map((block) => (
            <div
              key={block.index}
              style={{
                padding: "12px",
                backgroundColor: "#FFFFFF",
                borderRadius: "4px",
                fontSize: "13px",
                lineHeight: "1.5",
                color: "#1A1714",
              }}
            >
              <span
                style={{
                  display: "inline-block",
                  fontWeight: 600,
                  marginRight: "8px",
                  minWidth: "24px",
                }}
              >
                <sup>{block.ref_index}</sup>
              </span>
              <div
                style={{ display: "inline" }}
                dangerouslySetInnerHTML={{ __html: block.html }}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
