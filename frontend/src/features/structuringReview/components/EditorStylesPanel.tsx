import { useState, useEffect } from "react";
import { Button } from "@/components/ui/Button";
import { BookOpen, Plus } from "lucide-react";
import type { WysiwygEditorHandle } from "@/features/editor";
import { NewStyleDialog } from "./NewStyleDialog";

interface StylesPanelProps {
  styles: string[];
  editorRef: React.RefObject<WysiwygEditorHandle>;
}

export function StylesPanel({ styles, editorRef }: StylesPanelProps) {
  const [currentStyle, setCurrentStyle] = useState<string>("Normal");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [allStyles, setAllStyles] = useState<string[]>(styles);

  // Update current style when selection changes
  useEffect(() => {
    const editor = editorRef.current?.editor;
    if (!editor) return;

    const updateCurrentStyle = () => {
      if (editor.isActive("heading")) {
        const attrs = editor.getAttributes("heading");
        setCurrentStyle(attrs.styleLabel || "H1");
      } else if (editor.isActive("paragraph")) {
        const attrs = editor.getAttributes("paragraph");
        setCurrentStyle(attrs.styleLabel || "Normal");
      } else {
        setCurrentStyle("Normal");
      }
    };

    editor.on("selectionUpdate", updateCurrentStyle);
    editor.on("update", updateCurrentStyle);
    updateCurrentStyle();

    return () => {
      editor.off("selectionUpdate", updateCurrentStyle);
      editor.off("update", updateCurrentStyle);
    };
  }, [editorRef]);

  const applyStyle = (styleName: string) => {
    const editor = editorRef.current?.editor;
    if (!editor) return;

    const headingMap: Record<string, number> = {
      "H1": 1, "H2": 2, "H3": 3, "H4": 4, "H5": 5, "H6": 6,
    };

    const headingLevel = headingMap[styleName];
    let chain = editor.chain().focus();

    if (headingLevel) {
      chain = chain
        .setHeading({ level: headingLevel as any })
        .updateAttributes("heading", { styleLabel: styleName });
    } else {
      const label = (styleName === "Normal" || styleName === "Body Text") ? "Normal" : styleName;
      
      // Convert to paragraph only if it's currently a heading, to avoid lifting list items out of lists
      if (editor.isActive("heading")) {
        chain = chain.setParagraph();
      }
      chain = chain.updateAttributes("paragraph", { styleLabel: label });
    }
    chain.run();
  };

  return (
    <div className="bg-white rounded-lg shadow-card border border-border flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b border-border">
        <h3 className="text-xs font-semibold text-text uppercase tracking-wider flex items-center gap-2">
          <BookOpen className="w-4 h-4 text-primary" />
          Paragraph Styles
        </h3>
        <div className="mt-2 flex items-center gap-2">
          <span className="text-[10px] text-muted">Current:</span>
          <span className="px-2 py-1 bg-amber-100 text-amber-900 border border-amber-300 rounded text-[10px] font-semibold">
            {currentStyle}
          </span>
        </div>
      </div>

      {/* Styles List */}
      <div className="flex-1 overflow-y-auto styles-scrollbar pr-1 p-3 space-y-2">
        {allStyles.length === 0 ? (
          <div className="text-center py-6 text-muted text-xs">
            No styles available
          </div>
        ) : (
          allStyles.map((style) => (
            <button
              key={style}
              onClick={() => applyStyle(style)}
              className={`group w-full text-left px-3 py-2 rounded-md text-sm font-medium transition-all border relative ${
                currentStyle === style
                  ? "bg-emerald-100 border-emerald-400 text-emerald-900 ring-2 ring-emerald-300"
                  : "bg-background border-border text-text hover:bg-sidebar/5 hover:border-border"
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <span className="font-mono text-[10px] uppercase tracking-wide">
                    {style}
                  </span>
                  <p className="text-[10px] text-muted mt-0.5">
                    {style === "Normal" || style === "Body Text"
                      ? "Regular paragraph"
                      : style.startsWith("H")
                        ? `Heading ${style.substring(1)}`
                        : "Custom style"}
                  </p>
                </div>
                <div className="flex items-center gap-2 ml-2 shrink-0">
                  {currentStyle === style && (
                    <span className="w-2 h-2 rounded-full bg-emerald-600"></span>
                  )}
                  {currentStyle !== style && (
                    <span className="text-[9px] font-semibold px-1.5 py-0.5 bg-text/10 text-white rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                      Apply
                    </span>
                  )}
                </div>
              </div>
            </button>
          ))
        )}
      </div>

      {/* New Style Button */}
      <div className="border-t border-border p-3">
        <Button
          variant="secondary"
          size="sm"
          leftIcon={<Plus className="w-3 h-3" />}
          className="w-full text-[11px]"
          onClick={() => setIsDialogOpen(true)}
          title="Create a new paragraph style"
        >
          New Style
        </Button>
      </div>

      {/* New Style Dialog */}
      <NewStyleDialog
        isOpen={isDialogOpen}
        onClose={() => setIsDialogOpen(false)}
        onAdd={(styleName) => {
          // Add the new style to the list if it doesn't exist
          if (!allStyles.includes(styleName)) {
            setAllStyles([...allStyles, styleName]);
          }
          // Apply the new style to the current selection
          applyStyle(styleName);
        }}
      />
      <style>{`
        .styles-scrollbar::-webkit-scrollbar {
          width: 5px;
        }
        .styles-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .styles-scrollbar::-webkit-scrollbar-thumb {
          background: #cbd5e1;
          border-radius: 4px;
        }
        .styles-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #94a3b8;
        }
      `}</style>
    </div>
  );
}
