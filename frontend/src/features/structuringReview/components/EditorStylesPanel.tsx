import { useState, useEffect } from "react";
import { Button } from "@/components/ui/Button";
import { BookOpen, Plus, Search, X } from "lucide-react";
import type { WysiwygEditorHandle } from "@/features/editor";
import { NewStyleDialog } from "./NewStyleDialog";

interface StylesPanelProps {
  styles: string[];
  editorRef: React.RefObject<WysiwygEditorHandle>;
  onAddStyle?: (newStyle: string) => void;
}

function HighlightedText({ text, highlight }: { text: string; highlight: string }) {
  if (!highlight.trim()) {
    return <span>{text}</span>;
  }
  const regex = new RegExp(`(${highlight.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&")})`, "gi");
  const parts = text.split(regex);
  return (
    <span>
      {parts.map((part, idx) =>
        part.toLowerCase() === highlight.toLowerCase() ? (
          <mark key={idx} className="bg-amber-200 text-amber-950 font-bold px-0.5 rounded">
            {part}
          </mark>
        ) : (
          <span key={idx}>{part}</span>
        )
      )}
    </span>
  );
}

export function StylesPanel({ styles, editorRef, onAddStyle }: StylesPanelProps) {
  const [currentStyle, setCurrentStyle] = useState<string>("Normal");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [allStyles, setAllStyles] = useState<string[]>(styles);
  const [searchQuery, setSearchQuery] = useState("");

  // Update local styles when prop changes
  useEffect(() => {
    setAllStyles(styles);
  }, [styles]);

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

    if (onAddStyle) {
      onAddStyle(styleName);
    }
  };

  const filteredStyles = allStyles.filter((style) =>
    style.toLowerCase().includes(searchQuery.toLowerCase())
  );

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

      {/* Search Input */}
      <div className="px-3 py-2 border-b border-border bg-sidebar/5 flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-muted" />
          <input
            type="text"
            placeholder="Search or add style..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && searchQuery.trim()) {
                const clean = searchQuery.trim();
                const matched = filteredStyles.find(
                  (s) => s.toLowerCase() === clean.toLowerCase()
                );
                if (matched) {
                  applyStyle(matched);
                } else {
                  if (!allStyles.includes(clean)) {
                    setAllStyles((prev) => [...prev, clean].sort());
                  }
                  applyStyle(clean);
                }
                setSearchQuery("");
              }
            }}
            className="w-full pl-8 pr-7 py-1.5 text-xs border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary bg-white text-text font-medium"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-2 top-2 p-0.5 hover:bg-slate-100 rounded text-muted hover:text-text cursor-pointer border-none bg-transparent"
              title="Clear search"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Styles List */}
      <div className="flex-1 overflow-y-auto styles-scrollbar pr-1 p-3 space-y-2">
        {searchQuery && !allStyles.some(s => s.toLowerCase() === searchQuery.toLowerCase().trim()) && (
          <button
            onClick={() => {
              const clean = searchQuery.trim();
              if (clean) {
                if (!allStyles.includes(clean)) {
                  setAllStyles((prev) => [...prev, clean].sort());
                }
                applyStyle(clean);
                setSearchQuery("");
              }
            }}
            className="w-full text-left px-3 py-2.5 bg-primary/10 border border-primary/20 text-primary hover:bg-primary/20 rounded-md text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">Create & Apply "{searchQuery.trim()}"</span>
          </button>
        )}
        {filteredStyles.length === 0 && !searchQuery ? (
          <div className="text-center py-6 text-muted text-xs">
            No styles available
          </div>
        ) : filteredStyles.length === 0 ? (
          <div className="text-center py-6 text-muted text-xs">
            No matching styles found
          </div>
        ) : (
          filteredStyles.map((style) => (
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
                    <HighlightedText text={style} highlight={searchQuery} />
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

