import type { StructuredBlock } from "@/types/api";

interface TableBlockProps {
  block: StructuredBlock;
  isSelected: boolean;
  onClick: () => void;
}

export function TableBlock({ block, isSelected, onClick }: TableBlockProps) {
  return (
    <div
      onClick={onClick}
      style={{
        padding: "16px",
        marginBottom: "8px",
        borderLeft: isSelected ? "4px solid #C9821A" : "4px solid transparent",
        backgroundColor: isSelected ? "#FEF7F0" : "#FFFFFF",
        cursor: "pointer",
        borderRadius: "4px",
        transition: "all 0.2s ease",
        overflowX: "auto",
      }}
    >
      <span
        style={{
          display: "inline-block",
          fontSize: "10px",
          fontWeight: 600,
          color: "#FFFFFF",
          backgroundColor: "#C9821A",
          padding: "4px 8px",
          borderRadius: "4px",
          marginBottom: "8px",
          textTransform: "uppercase",
          letterSpacing: "0.1em",
        }}
      >
        Table: {block.style}
      </span>
      <div
        style={{
          fontSize: "13px",
          lineHeight: "1.5",
          color: "#1A1714",
          marginTop: "8px",
        }}
        dangerouslySetInnerHTML={{ __html: block.html }}
      />
    </div>
  );
}
