import { useState, useEffect } from "react";
import { useStructuredContentQuery } from "../useStructuredContentQuery";
import { useStructuringSave } from "../useStructuringSave";
import type { StructuredBlock } from "@/types/api";
// import { StylesPanel } from "./StylesPanel"; // Deprecated: replaced by WysiwygEditor + EditorStylesPanel
import { ParagraphBlock } from "./ParagraphBlock";
import { TableBlock } from "./TableBlock";
import { FootnotesSection } from "./FootnotesSection";

interface StructuringDocEditorProps {
  fileId: number;
  saveEndpoint: string;
  onSaveComplete?: () => void;
}

export function StructuringDocEditor({
  fileId,
  saveEndpoint,
  onSaveComplete,
}: StructuringDocEditorProps) {
  const query = useStructuredContentQuery(fileId);
  const [blocks, setBlocks] = useState<StructuredBlock[]>([]);
  const [availableStyles, setAvailableStyles] = useState<string[]>([]);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [pendingChanges, setPendingChanges] = useState<
    Array<{ para_index: number; style_name: string }>
  >([]);
  const [expandFootnotes, setExpandFootnotes] = useState(false);
  const saveMutation = useStructuringSave(fileId);

  useEffect(() => {
    if (query.data?.blocks) {
      setBlocks(query.data.blocks);
    }
  }, [query.data?.blocks]);

  useEffect(() => {
    if (query.data?.available_styles) {
      setAvailableStyles(query.data.available_styles);
    }
  }, [query.data?.available_styles]);

  function applyStyle(styleId: string) {
    if (selectedIdx === null) return;
    setBlocks((prev) =>
      prev.map((b) =>
        b.index === selectedIdx ? { ...b, style: styleId } : b
      )
    );
    setPendingChanges((prev) => {
      const without = prev.filter((c) => c.para_index !== selectedIdx);
      return [...without, { para_index: selectedIdx, style_name: styleId }];
    });
  }

  function handleAddCustomStyle(styleName: string) {
    if (!styleName.trim()) return;
    const cleanName = styleName.trim();
    if (!availableStyles.includes(cleanName)) {
      setAvailableStyles((prev) => [...prev, cleanName].sort());
    }
    applyStyle(cleanName);
  }

  async function handleSave() {
    if (pendingChanges.length === 0) return;
    try {
      await saveMutation.save(saveEndpoint, {
        paragraph_styles: pendingChanges,
      });
      setPendingChanges([]);
      onSaveComplete?.();
    } catch (error) {
      console.error("Save failed:", error);
    }
  }

  if (query.isLoading) {
    return <div style={{ padding: "24px", textAlign: "center" }}>Loading document…</div>;
  }

  if (query.isError) {
    return (
      <div style={{ padding: "24px", color: "#B91C1C" }}>
        Failed to load document structure
      </div>
    );
  }

  const paragraphBlocks = blocks.filter((b) => b.type !== "footnote" && b.type !== "endnote");
  const footnoteBlocks = blocks.filter((b) => b.type === "footnote" || b.type === "endnote");
  const currentStyle =
    selectedIdx !== null && blocks[selectedIdx] ? blocks[selectedIdx].style : null;

  return (
    <div style={{ display: "flex", height: "100%", backgroundColor: "#F3F4F6", minHeight: 0 }}>
      {/* Scrollable Editor Container */}
      <div
        style={{
          flex: 1,
          height: "100%",
          overflowY: "auto",
          padding: "40px 24px",
          minHeight: 0,
          boxSizing: "border-box",
        }}
      >
        {/* Centered "Word" Page */}
        <div
          style={{
            width: "100%",
            maxWidth: "850px",
            margin: "0 auto",
            backgroundColor: "#FFFFFF",
            borderRadius: "4px",
            boxShadow: "0 4px 10px rgba(0, 0, 0, 0.08), 0 1px 3px rgba(0, 0, 0, 0.04)",
            padding: "48px 56px",
            boxSizing: "border-box",
            minHeight: "100%",
            display: "flex",
            flexDirection: "column",
            gap: "16px",
          }}
        >
          {paragraphBlocks.map((block) =>
            block.type === "table" ? (
              <TableBlock
                key={block.index}
                block={block}
                isSelected={block.index === selectedIdx}
                onClick={() => setSelectedIdx(block.index)}
              />
            ) : (
              <ParagraphBlock
                key={block.index}
                block={block}
                isSelected={block.index === selectedIdx}
                onClick={() => setSelectedIdx(block.index)}
              />
            )
          )}

          {footnoteBlocks.length > 0 && (
            <div style={{ marginTop: "auto", paddingTop: "32px", borderTop: "1px solid #E5E7EB" }}>
              <FootnotesSection
                blocks={footnoteBlocks}
                expanded={expandFootnotes}
                onToggle={() => setExpandFootnotes((v) => !v)}
              />
            </div>
          )}
        </div>
      </div>

      {/* Frozen/Sticky Styles Panel - Deprecated, use EditorStylesPanel with WysiwygEditor instead */}
      {/* <StylesPanel
        availableStyles={availableStyles}
        currentStyle={currentStyle}
        onApply={applyStyle}
        onAddCustomStyle={handleAddCustomStyle}
        pendingCount={pendingChanges.length}
        isSaving={saveMutation.isPending}
        onSave={handleSave}
      /> */}
    </div>
  );
}
