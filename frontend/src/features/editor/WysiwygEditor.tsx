import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Bold as TiptapBold } from "@tiptap/extension-bold";
import { Italic as TiptapItalic } from "@tiptap/extension-italic";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import { TextAlign } from "@tiptap/extension-text-align";
import { Underline } from "@tiptap/extension-underline";
import { Color } from "@tiptap/extension-color";
import { Highlight } from "@tiptap/extension-highlight";
import { Placeholder } from "@tiptap/extension-placeholder";
import { FontFamily } from "@tiptap/extension-font-family";
import { Superscript } from "@tiptap/extension-superscript";
import { Subscript } from "@tiptap/extension-subscript";
import { CharacterCount } from "@tiptap/extension-character-count";
import { Link } from "@tiptap/extension-link";
import {
  Bold,
  Italic,
  List,
  ListOrdered,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  Undo,
  Redo,
  Download,
  Save,
  Strikethrough,
  Type,
  Maximize2,
  Table2,
  Highlighter,
  Superscript as SuperscriptIcon,
  Subscript as SubscriptIcon,
  Link as LinkIcon,
  Search,
  X,
  FileText,
  Indent,
  Outdent,
  SeparatorHorizontal,
  MessageSquare,
  Check,
  Trash2,
  CornerDownRight,
  CheckCircle2,
  Sigma,
} from "lucide-react";
import { useState, useEffect, useImperativeHandle, forwardRef, useCallback, useRef } from "react";
import { Button } from "@/components/ui/Button";
import Paragraph from "@tiptap/extension-paragraph";
import Heading from "@tiptap/extension-heading";
import { TrackChanges } from "./TrackChanges";
import { OccurrenceHighlight, type Occurrence } from "./OccurrenceHighlight";
import { RunAnchor } from "./RunAnchor";
import { CharStyle } from "./CharStyle";
import { FontSize } from "./FontSize";
import { Comment } from "./Comment";
import { SearchReplace } from "./SearchReplace";
import { MathNode } from "./MathNode";
import { SdtBlock } from "./SdtBlock";
import { SdtInline } from "./SdtInline";
import katex from "katex";


const CustomParagraph = Paragraph.extend({
  addAttributes() {
    return {
      styleLabel: {
        default: "Normal",
        parseHTML: (element) => {
          // 1. Always prioritize explicit prefix tags in text (e.g. "<CN>CHAPTER 2" -> "CN")
          const text = (element.textContent || "").trim();
          const match = text.match(/<([/A-Za-z0-9_.-]+)>/);
          if (match && text.indexOf(match[0]) < 15) {
            return match[1];
          }

          // 2. Fall back to existing data attributes or classes
          const attrLabel =
            element.getAttribute("data-style-label") ||
            element.getAttribute("class");
          if (attrLabel && attrLabel !== "Normal" && attrLabel !== "MsoNormal") {
            return attrLabel;
          }

          return "Normal";
        },
        renderHTML: (attributes) => {
          const label = attributes.styleLabel || "Normal";
          return {
            "data-style-label": label,
            class: label,
          };
        },
      },
      bookmark: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-bookmark"),
        renderHTML: (attributes) =>
          attributes.bookmark ? { "data-bookmark": attributes.bookmark } : {},
      },
      paraIdx: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-para-idx"),
        renderHTML: (attributes) =>
          attributes.paraIdx ? { "data-para-idx": attributes.paraIdx } : {},
      },
    };
  },
});

const CustomHeading = Heading.extend({
  addAttributes() {
    return {
      styleLabel: {
        default: "H1",
        parseHTML: (element) => {
          // 1. Always prioritize explicit prefix tags in text
          const text = (element.textContent || "").trim();
          const match = text.match(/<([/A-Za-z0-9_.-]+)>/);
          if (match && text.indexOf(match[0]) < 15) {
            return match[1];
          }

          // 2. Fall back to existing attributes
          const attrLabel =
            element.getAttribute("data-style-label") ||
            element.getAttribute("class");
          if (attrLabel && attrLabel !== "Normal" && attrLabel !== "MsoNormal") {
            return attrLabel;
          }

          const tag = element.tagName.toLowerCase();
          const level = tag.substring(1);
          return `H${level}`;
        },
        renderHTML: (attributes) => {
          const label = attributes.styleLabel || "H1";
          return {
            "data-style-label": label,
            class: label,
          };
        },
      },
      bookmark: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-bookmark"),
        renderHTML: (attributes) =>
          attributes.bookmark ? { "data-bookmark": attributes.bookmark } : {},
      },
      paraIdx: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-para-idx"),
        renderHTML: (attributes) =>
          attributes.paraIdx ? { "data-para-idx": attributes.paraIdx } : {},
      },
    };
  },
});

const CustomBold = TiptapBold.extend({
  renderHTML({ HTMLAttributes }) {
    return ["b", HTMLAttributes, 0];
  },
});

const CustomItalic = TiptapItalic.extend({
  renderHTML({ HTMLAttributes }) {
    return ["i", HTMLAttributes, 0];
  },
});

import { Node as TiptapNode } from "@tiptap/core";

const PageBreak = TiptapNode.create({
  name: "pageBreak",
  group: "block",
  atom: true,
  parseHTML() {
    return [
      { tag: "div.page-break" },
      { tag: "hr.page-break" },
    ];
  },
  renderHTML() {
    return ["div", { class: "page-break", "data-type": "page-break" }, ["span", {}, "Page Break"]];
  },
});

export interface WysiwygEditorProps {
  initialContent: string;
  onSave: (html: string) => Promise<void>;
  isSaving?: boolean;
  saveLabel?: string;
  exportHref?: string;
  documentTitle?: string;
  sidePanel?: React.ReactNode;
  height?: string;
  trackChangesEnabled?: boolean;
  onTrackChangesToggle?: (v: boolean) => void;
  occurrences?: Occurrence[];
  selectedOccurrenceIndex?: number;
  onOccurrenceClick?: (index: number) => void;
  onContentChange?: () => void;
  styles?: string[];
  onAddStyle?: (newStyle: string) => void;
  charStyles?: string[];
  onActiveCharStyleChange?: (cls: string | null) => void;
  currentUser?: string;
  fileId?: string;
}

const ToolbarButton = ({
  active,
  onClick,
  disabled,
  children,
  title,
}: {
  active?: boolean;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
  title?: string;
}) => (
  <button
    onClick={onClick}
    disabled={disabled}
    title={title}
    className={`p-1.5 rounded-md transition-all duration-150 ${active
      ? "bg-amber-600 text-white shadow-sm shadow-amber-500/10"
      : "text-slate-400 hover:bg-slate-800/80 hover:text-slate-200"
      } ${disabled ? "opacity-35 cursor-not-allowed" : "cursor-pointer"}`}
  >
    {children}
  </button>
);

const ToolbarDivider = () => <div className="w-px h-5 bg-slate-700 mx-1" />;

export interface WysiwygEditorHandle {
  editor: any; // TipTap Editor instance
}

export const WysiwygEditor = forwardRef<WysiwygEditorHandle, WysiwygEditorProps>(
  function WysiwygEditor(
    {
      initialContent,
      onSave,
      isSaving = false,
      saveLabel = "Save & Convert to DOCX",
      exportHref,
      documentTitle,
      sidePanel,
      height = "calc(100vh - 280px)",
      trackChangesEnabled = false,
      onTrackChangesToggle,
      occurrences = [],
      selectedOccurrenceIndex = -1,
      onOccurrenceClick,
      onContentChange,
      styles,
      onAddStyle,
      charStyles,
      onActiveCharStyleChange,
      currentUser,
      fileId,
    }: WysiwygEditorProps,
    ref
  ) {
    const [tcEnabled, setTcEnabled] = useState(trackChangesEnabled);
    const [headingLevel, setHeadingLevel] = useState<number>(0);
    const [activeGutter, setActiveGutter] = useState<{
      pos: number;
      element: HTMLElement;
      styleLabel: string;
      clientX: number;
      clientY: number;
      pageLeft: number;
      pageTop: number;
    } | null>(null);
    const [isDirty, setIsDirty] = useState(false);
    const [savedAt, setSavedAt] = useState<Date | null>(null);
    // Find & Replace state
    const [showFindReplace, setShowFindReplace] = useState(false);
    const [findTerm, setFindTerm] = useState("");
    const [replaceTerm, setReplaceTerm] = useState("");
    // Link dialog state
    const [showLinkDialog, setShowLinkDialog] = useState(false);
    const [linkUrl, setLinkUrl] = useState("");
    // Color picker refs
    const textColorRef = useRef<HTMLInputElement>(null);
    const highlightColorRef = useRef<HTMLInputElement>(null);
    // Track whether content has been initialised to avoid skipping loads
    const contentInitialised = useRef(false);

    // Comments state
    const [comments, setComments] = useState<Record<string, any>>({});
    const [commentPositions, setCommentPositions] = useState<Record<string, number>>({});
    const [currentFontSize, setCurrentFontSize] = useState("default");
    const [currentFontFamily, setCurrentFontFamily] = useState("default");

    const editor = useEditor({
      extensions: [
        TrackChanges,
        StarterKit.configure({
          paragraph: false,
          heading: false,
          bold: false,
          italic: false,
          // Underline and Link are registered explicitly below; disable the
          // StarterKit-bundled copies to avoid duplicate-extension warnings.
          link: false,
          underline: false,
        }),
        CustomBold,
        CustomItalic,
        CustomParagraph,
        CustomHeading,
        Table.configure({ resizable: true }),
        TableRow,
        TableCell,
        TableHeader,
        TextAlign.configure({ types: ["heading", "paragraph"] }),
        Underline,
        Color,
        FontSize,
        Highlight.configure({ multicolor: true }),
        Placeholder.configure({
          placeholder: "Start typing your document...",
        }),
        FontFamily,
        Superscript,
        Subscript,
        CharacterCount,
        Link.configure({
          openOnClick: false,
          HTMLAttributes: { rel: "noopener noreferrer", target: "_blank" },
        }),
        OccurrenceHighlight,
        RunAnchor,
        CharStyle,
        PageBreak,
        Comment,
        SearchReplace,
        MathNode,
        SdtBlock,
        SdtInline,
      ],
      content: "",
      editorProps: {
        attributes: {
          class:
            "prose prose-sm focus:outline-none max-w-none px-0 py-0 text-base leading-relaxed",
        },
      },
      onUpdate: () => {
        setIsDirty(true);
        onContentChange?.();
      },
    });

    // Initialize content
    useEffect(() => {
      if (editor && initialContent && !contentInitialised.current) {
        contentInitialised.current = true;
        editor.commands.setContent(initialContent);
        setIsDirty(false);
      }
    }, [editor, initialContent]);

    // Handle track changes
    useEffect(() => {
      if (editor) {
        const tcExt = editor.extensionManager.extensions.find(
          (e) => e.name === "trackChanges"
        );
        if (tcExt) {
          (tcExt as any).storage.enabled = tcEnabled;
          if (onTrackChangesToggle) {
            onTrackChangesToggle(tcEnabled);
          }
        }
      }
    }, [tcEnabled, editor, onTrackChangesToggle]);

    // Handle track changes author
    useEffect(() => {
      if (editor) {
        const tcExt = editor.extensionManager.extensions.find(
          (e) => e.name === "trackChanges"
        );
        if (tcExt) {
          (tcExt as any).storage.author = currentUser || "Unknown";
        }
      }
    }, [currentUser, editor]);

    // Update heading level, font size, font family, and charStyle on selection updates
    useEffect(() => {
      if (editor) {
        const updateSelectionStates = () => {
          // Heading level
          if (editor.isActive("heading", { level: 1 })) setHeadingLevel(1);
          else if (editor.isActive("heading", { level: 2 })) setHeadingLevel(2);
          else if (editor.isActive("heading", { level: 3 })) setHeadingLevel(3);
          else if (editor.isActive("heading", { level: 4 })) setHeadingLevel(4);
          else if (editor.isActive("heading", { level: 5 })) setHeadingLevel(5);
          else if (editor.isActive("heading", { level: 6 })) setHeadingLevel(6);
          else setHeadingLevel(0);

          // Font size
          const attrs = editor.getAttributes("textStyle");
          if (attrs && attrs.fontSize) {
            setCurrentFontSize(attrs.fontSize.replace("pt", ""));
          } else {
            setCurrentFontSize("default");
          }

          // Font family
          setCurrentFontFamily(attrs?.fontFamily || "default");

          // Active character style callback
          if (onActiveCharStyleChange) {
            const charStyleAttrs = editor.getAttributes("charStyle");
            onActiveCharStyleChange(charStyleAttrs?.class || null);
          }
        };
        editor.on("selectionUpdate", updateSelectionStates);
        editor.on("update", updateSelectionStates);
        return () => {
          editor.off("selectionUpdate", updateSelectionStates);
          editor.off("update", updateSelectionStates);
        };
      }
    }, [editor, onActiveCharStyleChange]);

    // Update occurrences highlighting and wire click callback
    useEffect(() => {
      if (editor) {
        const ext = editor.extensionManager.extensions.find((e: any) => e.name === "occurrenceHighlight");
        if (ext) {
          (ext as any).storage.occurrences = occurrences;
          (ext as any).storage.selectedIndex = selectedOccurrenceIndex;
          (ext as any).storage.onOccurrenceClick = onOccurrenceClick ?? null;
        }

        const tr = editor.state.tr.setMeta("occurrenceHighlight", {
          occurrences,
          selectedIndex: selectedOccurrenceIndex,
          onOccurrenceClick,
        });
        editor.view.dispatch(tr);

        // Scroll to selected occurrence
        if (selectedOccurrenceIndex >= 0 && occurrences.length > selectedOccurrenceIndex) {
          const occ = occurrences[selectedOccurrenceIndex];
          const blocks: { pos: number; size: number; text: string }[] = [];
          editor.state.doc.descendants((node, pos) => {
            if (node.isBlock && (node.type.name === "paragraph" || node.type.name.startsWith("heading"))) {
              blocks.push({ pos, size: node.content.size, text: node.textContent });
            }
          });

          let bestBlockIdx = -1;
          let bestScore = Infinity;
          let bestMatchStart = -1;

          blocks.forEach((block, blockIdx) => {
            const surfaceIdx = block.text.indexOf(occ.surface);
            if (surfaceIdx !== -1) {
              const score = Math.abs(blockIdx - occ.para_index);
              if (score < bestScore) {
                bestScore = score;
                bestBlockIdx = blockIdx;
                bestMatchStart = surfaceIdx;
              }
            }
          });

          if (bestBlockIdx !== -1) {
            const matchedBlock = blocks[bestBlockIdx];
            const from = matchedBlock.pos + 1 + bestMatchStart;
            try {
              const domInfo = editor.view.domAtPos(from);
              const el =
                domInfo.node.nodeType === Node.TEXT_NODE
                  ? domInfo.node.parentElement
                  : (domInfo.node as Element);
              el?.scrollIntoView({ behavior: "smooth", block: "center" });
            } catch { /* ignore */ }
          }
        }
      }
    }, [editor, occurrences, selectedOccurrenceIndex, onOccurrenceClick]);

    // Keyboard shortcut: Ctrl+F for Find
    useEffect(() => {
      const handleKeyDown = (e: KeyboardEvent) => {
        if ((e.ctrlKey || e.metaKey) && e.key === "f") {
          e.preventDefault();
          setShowFindReplace((v) => !v);
        }
        if (e.key === "Escape" && showFindReplace) {
          setShowFindReplace(false);
          setFindTerm("");
        }
      };
      window.addEventListener("keydown", handleKeyDown);
      return () => window.removeEventListener("keydown", handleKeyDown);
    }, [showFindReplace]);

    // Update comment positions next to their document location
    const updateCommentPositions = useCallback(() => {
      if (!editor || editor.isDestroyed) return;
      const newPositions: Record<string, number> = {};
      const { doc } = editor.state;
      const pageElement = editor.view.dom;
      const pageRect = pageElement.getBoundingClientRect();

      doc.descendants((node, pos) => {
        const commentMark = node.marks.find(m => m.type.name === "comment");
        if (commentMark) {
          const commentId = commentMark.attrs.commentId;
          if (commentId && newPositions[commentId] === undefined) {
            try {
              const coords = editor.view.coordsAtPos(pos);
              const topOffset = coords.top - pageRect.top;
              newPositions[commentId] = topOffset;
            } catch (e) {
              // ignore coordinate errors
            }
          }
        }
      });
      setCommentPositions(newPositions);
    }, [editor]);

    useEffect(() => {
      if (!editor) return;
      editor.on("selectionUpdate", updateCommentPositions);
      editor.on("update", updateCommentPositions);
      window.addEventListener("resize", updateCommentPositions);
      const timer = setTimeout(updateCommentPositions, 100);

      return () => {
        editor.off("selectionUpdate", updateCommentPositions);
        editor.off("update", updateCommentPositions);
        window.removeEventListener("resize", updateCommentPositions);
        clearTimeout(timer);
      };
    }, [editor, updateCommentPositions]);

    // Load and save comments from localStorage
    useEffect(() => {
      if (fileId) {
        try {
          const stored = localStorage.getItem(`comments-${fileId}`);
          if (stored) {
            setComments(JSON.parse(stored));
          } else {
            setComments({});
          }
        } catch (e) {
          console.error("Failed to load comments", e);
        }
      }
    }, [fileId]);

    useEffect(() => {
      if (fileId) {
        localStorage.setItem(`comments-${fileId}`, JSON.stringify(comments));
      }
    }, [comments, fileId]);

    const searchResults = (editor?.storage as any)?.searchReplace?.results || [];
    const activeSearchIndex = (editor?.storage as any)?.searchReplace?.activeIndex ?? -1;
    const searchMatchCount = searchResults.length;
    const currentSearchMatch = searchMatchCount > 0 ? activeSearchIndex + 1 : 0;

    // Expose editor instance to parent via ref
    useImperativeHandle(ref, () => ({ editor: editor as any }), [editor]);

    const handleToggleTrackChanges = () => setTcEnabled(!tcEnabled);

    const handleHeadingChange = (level: number) => {
      if (level === 0) {
        editor?.chain().focus().setParagraph().run();
      } else {
        editor?.chain().focus().setHeading({ level: level as any }).run();
      }
      setHeadingLevel(level);
    };

    const getCurrentStyle = (): string => {
      if (!editor) return "Normal";
      if (editor.isActive("heading", { level: 1 })) return "H1";
      if (editor.isActive("heading", { level: 2 })) return "H2";
      if (editor.isActive("heading", { level: 3 })) return "H3";
      if (editor.isActive("heading", { level: 4 })) return "H4";
      if (editor.isActive("heading", { level: 5 })) return "H5";
      if (editor.isActive("heading", { level: 6 })) return "H6";
      return "Normal";
    };

    function stripCommentMarks(html: string): string {
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, "text/html");
      const commentSpans = doc.querySelectorAll("span[data-comment-id]");
      commentSpans.forEach(span => {
        const parent = span.parentNode;
        if (parent) {
          while (span.firstChild) {
            parent.insertBefore(span.firstChild, span);
          }
          parent.removeChild(span);
        }
      });

      const mathSpans = doc.querySelectorAll("span[data-latex]");
      mathSpans.forEach(span => {
        const latex = span.getAttribute("data-latex");
        if (latex) {
          try {
            const temp = document.createElement("div");
            temp.innerHTML = katex.renderToString(latex, { output: "mathml" });
            const mathElement = temp.querySelector("math");
            if (mathElement) {
              span.parentNode?.replaceChild(mathElement, span);
            }
          } catch (err) {
            console.error("Failed to convert LaTeX to MathML on save:", err);
          }
        }
      });

      return doc.body.innerHTML;
    }

    const handleSave = async () => {
      if (editor) {
        const html = editor.getHTML();
        const cleanHtml = stripCommentMarks(html);
        await onSave(cleanHtml);
        setIsDirty(false);
        setSavedAt(new Date());
      }
    };

    const applyStyle = (styleName: string, pos: number) => {
      if (!editor) return;

      const headingMap: Record<string, number> = {
        "H1": 1,
        "H2": 2,
        "H3": 3,
        "H4": 4,
        "H5": 5,
        "H6": 6,
      };

      const headingLevel = headingMap[styleName];

      // Select the paragraph node position
      let chain = editor.chain().focus().setTextSelection({ from: pos, to: pos });

      if (headingLevel) {
        chain = chain.setHeading({ level: headingLevel as any }).updateAttributes("heading", { styleLabel: styleName });
      } else {
        const label = (styleName === "Normal" || styleName === "Body Text") ? "Normal" : styleName;

        // Determine synchronously if the node at target position is currently a heading
        const $pos = editor.state.doc.resolve(pos);
        const isHeading = $pos.parent && $pos.parent.type.name === "heading";

        // Convert to paragraph only if it's currently a heading, to avoid lifting list items out of lists
        if (isHeading) {
          chain = chain.setParagraph();
        }
        chain = chain.updateAttributes("paragraph", { styleLabel: label });
      }

      chain.run();
      setIsDirty(true);
      onContentChange?.();
    };

    const handleAddNewStyleFromGutter = (styleName: string, pos: number) => {
      if (!styleName.trim()) return;
      const cleanName = styleName.trim();
      if (onAddStyle) {
        onAddStyle(cleanName);
      }
      applyStyle(cleanName, pos);
      setActiveGutter(null);
    };

    const handleInsertLink = () => {
      if (!linkUrl) return;
      editor?.chain().focus().setLink({ href: linkUrl }).run();
      setLinkUrl("");
      setShowLinkDialog(false);
    };

    const wordCount = editor?.storage.characterCount?.words() ?? 0;
    const charCount = editor?.storage.characterCount?.characters() ?? 0;

    return (
      <div className="flex flex-col bg-[#e8e8e8] w-full" style={{ height }}>

        {/* â”€â”€ Toolbar â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
        <div className="sticky top-0 z-10 bg-[#090d16] border-b border-slate-800 px-3 py-2 flex items-center gap-1.5 overflow-x-auto shadow-md flex-wrap">

          {/* Style Badge */}
          <div className="px-2 py-1 bg-amber-950/40 text-amber-500 border border-amber-800/60 rounded-md text-[10px] font-bold tracking-wider uppercase shrink-0">
            {getCurrentStyle()}
          </div>

          <ToolbarDivider />

          {/* Heading Selector */}
          <select
            value={headingLevel}
            onChange={(e) => handleHeadingChange(parseInt(e.target.value))}
            className="px-2 py-1 text-[11px] font-bold border border-slate-700 rounded-md bg-slate-900 text-slate-200 hover:bg-slate-800 focus:outline-none shrink-0"
          >
            <option value={0}>Normal</option>
            <option value={1}>Heading 1</option>
            <option value={2}>Heading 2</option>
            <option value={3}>Heading 3</option>
            <option value={4}>Heading 4</option>
            <option value={5}>Heading 5</option>
            <option value={6}>Heading 6</option>
          </select>

          {/* Font Family */}
          <select
            value={currentFontFamily}
            onChange={(e) => {
              const font = e.target.value;
              if (font === "default") {
                editor?.chain().focus().unsetFontFamily().run();
              } else {
                editor?.chain().focus().setFontFamily(font).run();
              }
              setCurrentFontFamily(font);
            }}
            className="px-2 py-1 text-[11px] font-bold border border-slate-700 rounded-md bg-slate-900 text-slate-200 hover:bg-slate-800 focus:outline-none max-w-[110px] shrink-0"
            title="Font Family"
          >
            <option value="default">Font</option>
            {["Calibri", "Cambria", "Arial", "Times New Roman", "Georgia", "Garamond", "Verdana", "Tahoma", "Trebuchet MS", "Courier New", "Consolas", "Helvetica"].map(f => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>

          {/* Font Size */}
          <select
            value={currentFontSize}
            onChange={(e) => {
              const size = e.target.value;
              if (size === "default") {
                editor?.chain().focus().unsetFontSize().run();
              } else {
                editor?.chain().focus().setFontSize(`${size}pt`).run();
              }
              setCurrentFontSize(size);
            }}
            className="px-2 py-1 text-[11px] font-bold border border-slate-700 rounded-md bg-slate-900 text-slate-200 hover:bg-slate-800 focus:outline-none w-16 shrink-0"
            title="Font Size"
          >
            <option value="default">Size</option>
            {[8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 36, 48].map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>

          <ToolbarDivider />

          {/* Text Formatting */}
          <ToolbarButton active={editor?.isActive("bold")} onClick={() => editor?.chain().focus().toggleBold().run()} title="Bold (Ctrl+B)">
            <Bold className="w-4 h-4" />
          </ToolbarButton>
          <ToolbarButton active={editor?.isActive("italic")} onClick={() => editor?.chain().focus().toggleItalic().run()} title="Italic (Ctrl+I)">
            <Italic className="w-4 h-4" />
          </ToolbarButton>
          <ToolbarButton active={editor?.isActive("underline")} onClick={() => editor?.chain().focus().toggleUnderline().run()} title="Underline (Ctrl+U)">
            <Type className="w-4 h-4" />
          </ToolbarButton>
          <ToolbarButton active={editor?.isActive("strike")} onClick={() => editor?.chain().focus().toggleStrike().run()} title="Strikethrough">
            <Strikethrough className="w-4 h-4" />
          </ToolbarButton>
          <ToolbarButton active={editor?.isActive("superscript")} onClick={() => editor?.chain().focus().toggleSuperscript().run()} title="Superscript">
            <SuperscriptIcon className="w-4 h-4" />
          </ToolbarButton>
          <ToolbarButton active={editor?.isActive("subscript")} onClick={() => editor?.chain().focus().toggleSubscript().run()} title="Subscript">
            <SubscriptIcon className="w-4 h-4" />
          </ToolbarButton>

          <ToolbarDivider />

          {/* Color Controls */}
          {/* Text Color */}
          <div className="relative" title="Text Color">
            <button
              onClick={() => textColorRef.current?.click()}
              className="p-1.5 rounded-md text-slate-400 hover:bg-slate-800/80 hover:text-slate-200 transition-all duration-150 cursor-pointer flex flex-col items-center gap-0.5"
            >
              <span className="text-[10px] font-bold leading-none">A</span>
              <span
                className="h-1 w-4 rounded-full"
                style={{ backgroundColor: editor?.getAttributes("textStyle").color || "#ffffff" }}
              />
            </button>
            <input
              ref={textColorRef}
              type="color"
              defaultValue="#000000"
              onChange={(e) => editor?.chain().focus().setColor(e.target.value).run()}
              className="absolute inset-0 opacity-0 w-0 h-0 cursor-pointer"
            />
          </div>

          {/* Highlight Color */}
          <div className="relative" title="Highlight Color">
            <button
              onClick={() => highlightColorRef.current?.click()}
              className="p-1.5 rounded-md text-slate-400 hover:bg-slate-800/80 hover:text-slate-200 transition-all duration-150 cursor-pointer"
            >
              <Highlighter className="w-4 h-4" />
            </button>
            <input
              ref={highlightColorRef}
              type="color"
              defaultValue="#fef08a"
              onChange={(e) => editor?.chain().focus().toggleHighlight({ color: e.target.value }).run()}
              className="absolute inset-0 opacity-0 w-0 h-0 cursor-pointer"
            />
          </div>

          <ToolbarDivider />

          {/* Alignment */}
          <ToolbarButton active={editor?.isActive({ textAlign: "left" })} onClick={() => editor?.chain().focus().setTextAlign("left").run()} title="Align Left">
            <AlignLeft className="w-4 h-4" />
          </ToolbarButton>
          <ToolbarButton active={editor?.isActive({ textAlign: "center" })} onClick={() => editor?.chain().focus().setTextAlign("center").run()} title="Align Center">
            <AlignCenter className="w-4 h-4" />
          </ToolbarButton>
          <ToolbarButton active={editor?.isActive({ textAlign: "right" })} onClick={() => editor?.chain().focus().setTextAlign("right").run()} title="Align Right">
            <AlignRight className="w-4 h-4" />
          </ToolbarButton>
          <ToolbarButton active={editor?.isActive({ textAlign: "justify" })} onClick={() => editor?.chain().focus().setTextAlign("justify").run()} title="Justify">
            <AlignJustify className="w-4 h-4" />
          </ToolbarButton>

          <ToolbarDivider />

          {/* Lists */}
          <ToolbarButton active={editor?.isActive("bulletList")} onClick={() => editor?.chain().focus().toggleBulletList().run()} title="Bullet List">
            <List className="w-4 h-4" />
          </ToolbarButton>
          <ToolbarButton active={editor?.isActive("orderedList")} onClick={() => editor?.chain().focus().toggleOrderedList().run()} title="Numbered List">
            <ListOrdered className="w-4 h-4" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => {
              if (editor?.isActive("bulletList") || editor?.isActive("orderedList")) {
                editor.chain().focus().sinkListItem("listItem").run();
              }
            }}
            disabled={!editor?.isActive("bulletList") && !editor?.isActive("orderedList")}
            title="Indent (List Item)"
          >
            <Indent className="w-4 h-4" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => {
              if (editor?.isActive("bulletList") || editor?.isActive("orderedList")) {
                editor.chain().focus().liftListItem("listItem").run();
              }
            }}
            disabled={!editor?.isActive("bulletList") && !editor?.isActive("orderedList")}
            title="Outdent (List Item)"
          >
            <Outdent className="w-4 h-4" />
          </ToolbarButton>

          <ToolbarDivider />

          {/* Insert Table */}
          <ToolbarButton onClick={() => editor?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()} title="Insert Table (3x3)">
            <Table2 className="w-4 h-4" />
          </ToolbarButton>

          {/* Insert Page Break */}
          <ToolbarButton onClick={() => editor?.chain().focus().insertContent({ type: 'pageBreak' }).run()} title="Insert Page Break">
            <SeparatorHorizontal className="w-4 h-4 text-emerald-400" />
          </ToolbarButton>

          {/* Table Tools (Only visible when cursor is inside a table) */}
          {editor?.isActive("table") && (
            <>
              <ToolbarDivider />
              <div className="flex items-center gap-1 bg-[#131b2e] border border-slate-700/60 rounded-md p-0.5" title="Table Tools">
                <button onClick={() => editor.chain().focus().addRowBefore().run()} className="p-1 hover:bg-slate-800 text-[10px] font-bold text-slate-200 rounded" title="Insert Row Above">R+â†‘</button>
                <button onClick={() => editor.chain().focus().addRowAfter().run()} className="p-1 hover:bg-slate-800 text-[10px] font-bold text-slate-200 rounded" title="Insert Row Below">R+â†“</button>
                <div className="w-px h-3.5 bg-slate-800" />
                <button onClick={() => editor.chain().focus().addColumnBefore().run()} className="p-1 hover:bg-slate-800 text-[10px] font-bold text-slate-200 rounded" title="Insert Column Left">C+â†</button>
                <button onClick={() => editor.chain().focus().addColumnAfter().run()} className="p-1 hover:bg-slate-800 text-[10px] font-bold text-slate-200 rounded" title="Insert Column Right">C+â†’</button>
                <div className="w-px h-3.5 bg-slate-800" />
                <button onClick={() => editor.chain().focus().mergeCells().run()} className="p-1 hover:bg-slate-800 text-[10px] font-bold text-slate-200 rounded" title="Merge Cells">Merge</button>
                <button onClick={() => editor.chain().focus().splitCell().run()} className="p-1 hover:bg-slate-800 text-[10px] font-bold text-slate-200 rounded" title="Split Cell">Split</button>
                <div className="w-px h-3.5 bg-slate-800" />
                <button onClick={() => editor.chain().focus().deleteRow().run()} className="p-1 hover:bg-slate-800 text-[10px] font-bold text-rose-400 rounded" title="Delete Row">R-</button>
                <button onClick={() => editor.chain().focus().deleteColumn().run()} className="p-1 hover:bg-slate-800 text-[10px] font-bold text-rose-400 rounded" title="Delete Column">C-</button>
                <button onClick={() => editor.chain().focus().deleteTable().run()} className="p-1 hover:bg-slate-850 text-[10px] font-bold text-rose-500 rounded" title="Delete Table">Del Tab</button>
              </div>
            </>
          )}

          {/* Insert Link */}
          <ToolbarButton
            active={editor?.isActive("link")}
            onClick={() => {
              if (editor?.isActive("link")) {
                editor.chain().focus().unsetLink().run();
              } else {
                const url = editor?.getAttributes("link").href ?? "";
                setLinkUrl(url);
                setShowLinkDialog(true);
              }
            }}
            title="Insert / Remove Link"
          >
            <LinkIcon className="w-4 h-4" />
          </ToolbarButton>

          <ToolbarDivider />

          {/* History */}
          <ToolbarButton onClick={() => editor?.chain().focus().undo().run()} disabled={!editor?.can().undo()} title="Undo (Ctrl+Z)">
            <Undo className="w-4 h-4" />
          </ToolbarButton>
          <ToolbarButton onClick={() => editor?.chain().focus().redo().run()} disabled={!editor?.can().redo()} title="Redo (Ctrl+Y)">
            <Redo className="w-4 h-4" />
          </ToolbarButton>

          <ToolbarDivider />

          {/* Character Style Dropdown (Gated) */}
          {charStyles && charStyles.length > 0 && (
            <>
              <select
                onChange={(e) => {
                  const styleClass = e.target.value;
                  if (!styleClass || styleClass === "CLEAR") {
                    editor?.chain().focus().unsetMark("charStyle").run();
                  } else {
                    editor?.chain().focus().setMark("charStyle", { class: styleClass }).run();
                  }
                  e.target.value = "";
                }}
                className="px-2 py-1 text-[11px] font-bold border border-slate-700 rounded bg-slate-900 text-slate-200 hover:bg-slate-800 focus:outline-none shrink-0"
                title="Character Style"
              >
                <option value="">Character Style</option>
                <option value="CLEAR">Clear Style</option>
                <optgroup label="Bibliography Styles">
                  {charStyles
                    .filter((s) => s.startsWith("bib_"))
                    .map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                </optgroup>
                <optgroup label="Citation Styles">
                  {charStyles
                    .filter((s) => s.startsWith("cite_"))
                    .map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                </optgroup>
              </select>
              <ToolbarDivider />
            </>
          )}

          {/* Add Comment Button */}
          <ToolbarButton
            onClick={() => {
              if (!editor) return;
              const { empty } = editor.state.selection;
              if (empty) {
                alert("Please select some text to comment on.");
                return;
              }
              const commentId = crypto.randomUUID();
              editor.chain().focus().addComment(commentId).run();
              setComments((prev) => ({
                ...prev,
                [commentId]: {
                  id: commentId,
                  text: "",
                  author: currentUser || "Unknown",
                  date: new Date().toISOString(),
                  resolved: false,
                  replies: [],
                },
              }));
              setTimeout(updateCommentPositions, 50);
            }}
            title="Add Comment"
          >
            <MessageSquare className="w-4 h-4 text-sky-400" />
          </ToolbarButton>

          {/* Insert Equation Button */}
          <ToolbarButton
            onClick={() => {
              if (!editor) return;
              editor.chain().focus().insertMathNode("x^2 + y^2 = z^2").run();
            }}
            title="Insert Math Equation"
          >
            <Sigma className="w-4 h-4 text-amber-500" />
          </ToolbarButton>

          <ToolbarDivider />

          {/* Track Changes Toggle */}
          <button
            onClick={handleToggleTrackChanges}
            className={`px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider rounded-md transition-all duration-150 border shrink-0 ${tcEnabled
              ? "bg-emerald-950/40 text-emerald-400 border-emerald-800/80 shadow-sm"
              : "bg-slate-900 text-slate-400 border-slate-800 hover:bg-slate-800 hover:text-slate-200"
              }`}
            title="Toggle Track Changes"
          >
            TC {tcEnabled ? "ON" : "OFF"}
          </button>

          {/* Accept/Reject All Buttons (when TC is ON) */}
          {tcEnabled && (
            <div className="flex items-center gap-1 bg-[#0c1b30] border border-emerald-900/60 rounded-md p-0.5 shrink-0" title="Bulk Resolve Changes">
              <button
                onClick={() => {
                  editor?.commands.acceptAllChanges();
                  setTimeout(updateCommentPositions, 50);
                }}
                className="p-1 hover:bg-slate-800 text-[10px] font-bold text-emerald-400 rounded flex items-center gap-0.5 cursor-pointer border-none bg-transparent"
                title="Accept All Changes"
              >
                <Check className="w-3 h-3" /> All
              </button>
              <div className="w-px h-3 bg-emerald-900/40" />
              <button
                onClick={() => {
                  editor?.commands.rejectAllChanges();
                  setTimeout(updateCommentPositions, 50);
                }}
                className="p-1 hover:bg-slate-800 text-[10px] font-bold text-rose-400 rounded flex items-center gap-0.5 cursor-pointer border-none bg-transparent"
                title="Reject All Changes"
              >
                <X className="w-3.5 h-3.5" /> All
              </button>
            </div>
          )}

          <ToolbarDivider />

          {/* Find & Replace Toggle */}
          <ToolbarButton
            active={showFindReplace}
            onClick={() => setShowFindReplace(!showFindReplace)}
            title="Find & Replace (Ctrl+F)"
          >
            <Search className="w-4 h-4" />
          </ToolbarButton>

          {/* Clear Formatting */}
          <ToolbarButton
            onClick={() => editor?.chain().focus().clearNodes().unsetAllMarks().run()}
            title="Clear All Formatting"
          >
            <Maximize2 className="w-4 h-4" />
          </ToolbarButton>
        </div>

        {/* â”€â”€ Find & Replace Bar â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
        {showFindReplace && (
          <div className="bg-slate-900 border-b border-slate-700 px-4 py-2 flex items-center gap-3 text-sm flex-wrap">
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <span className="text-slate-400 text-xs font-semibold uppercase tracking-wide shrink-0">Find</span>
              <input
                autoFocus
                type="text"
                value={findTerm}
                onChange={(e) => {
                  const val = e.target.value;
                  setFindTerm(val);
                  editor?.commands.setSearchTerm(val);
                }}
                placeholder="Search in document..."
                className="flex-1 min-w-0 px-2.5 py-1 bg-slate-800 border border-slate-600 rounded-md text-xs text-slate-200 focus:outline-none focus:border-amber-500"
              />
              {searchMatchCount > 0 && (
                <span className="text-[10px] text-slate-400 shrink-0 font-mono">
                  {currentSearchMatch}/{searchMatchCount}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <span className="text-slate-400 text-xs font-semibold uppercase tracking-wide shrink-0">Replace</span>
              <input
                type="text"
                value={replaceTerm}
                onChange={(e) => setReplaceTerm(e.target.value)}
                placeholder="Replacement text..."
                className="flex-1 min-w-0 px-2.5 py-1 bg-slate-800 border border-slate-600 rounded-md text-xs text-slate-200 focus:outline-none focus:border-amber-500"
              />
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                onClick={() => {
                  editor?.commands.findPrev();
                }}
                className="px-2.5 py-1 bg-slate-700 text-slate-200 text-[10px] font-bold rounded-md hover:bg-slate-600 transition-colors cursor-pointer border-none"
              >
                Prev
              </button>
              <button
                onClick={() => {
                  editor?.commands.findNext();
                }}
                className="px-2.5 py-1 bg-slate-700 text-slate-200 text-[10px] font-bold rounded-md hover:bg-slate-600 transition-colors cursor-pointer border-none"
              >
                Next
              </button>
              <button
                onClick={() => {
                  if (replaceTerm) {
                    editor?.commands.replaceCurrent(replaceTerm);
                  }
                }}
                className="px-2.5 py-1 bg-amber-600 text-white text-[10px] font-bold rounded-md hover:bg-amber-700 transition-colors cursor-pointer border-none"
              >
                Replace
              </button>
              <button
                onClick={() => {
                  if (replaceTerm) {
                    editor?.commands.replaceAll(replaceTerm);
                  }
                }}
                className="px-2.5 py-1 bg-amber-600 text-white text-[10px] font-bold rounded-md hover:bg-amber-700 transition-colors cursor-pointer border-none"
              >
                Replace All
              </button>
              <button onClick={() => { setShowFindReplace(false); setFindTerm(""); editor?.commands.setSearchTerm(""); }} className="p-1 text-slate-400 hover:text-slate-200 transition-colors cursor-pointer border-none bg-transparent">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* â”€â”€ Link Dialog â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
        {showLinkDialog && (
          <div className="bg-slate-900 border-b border-slate-700 px-4 py-2 flex items-center gap-3">
            <LinkIcon className="w-4 h-4 text-blue-400 shrink-0" />
            <input
              autoFocus
              type="url"
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleInsertLink(); if (e.key === "Escape") setShowLinkDialog(false); }}
              placeholder="https://..."
              className="flex-1 px-2.5 py-1 bg-slate-800 border border-slate-600 rounded-md text-xs text-slate-200 focus:outline-none focus:border-blue-500"
            />
            <button onClick={handleInsertLink} className="px-3 py-1 bg-blue-600 text-white text-[10px] font-bold rounded-md hover:bg-blue-700 transition-colors shrink-0">
              Insert Link
            </button>
            <button onClick={() => setShowLinkDialog(false)} className="p-1 text-slate-400 hover:text-slate-200 transition-colors">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* â”€â”€ Document Area â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
        <div className="flex-1 overflow-y-auto bg-gradient-to-tr from-slate-100 to-slate-50 p-8 flex justify-start lg:justify-center items-start overflow-x-auto">
          <div className={sidePanel ? "flex gap-8 w-full max-w-[1400px] justify-start lg:justify-center" : ""}>
            {/* Word-style Document Page */}
            <div
              className="bg-white flex-shrink-0 text-sm transition-shadow duration-300 relative"
              style={{
                fontFamily: "'Times New Roman', Times, serif",
                lineHeight: "2",
                width: "8.5in",
                minHeight: "11in",
                padding: "1.0in 1.1in",
                boxShadow: "0 4px 20px rgba(0,0,0,0.06), 0 12px 36px rgba(0,0,0,0.04)",
                border: "1px solid rgba(226, 232, 240, 0.8)",
                overflow: "visible",
                borderRadius: "4px"
              }}
              onClick={(e) => {
                if (!editor) return;
                const target = e.target as HTMLElement;
                const blockEl = target.closest(".ProseMirror > p, .ProseMirror > h1, .ProseMirror > h2, .ProseMirror > h3, .ProseMirror > h4, .ProseMirror > h5, .ProseMirror > h6");
                if (!blockEl) return;

                const rect = blockEl.getBoundingClientRect();
                const offsetLeft = e.clientX - rect.left;

                if (offsetLeft >= -130 && offsetLeft <= -10) {
                  e.preventDefault();
                  e.stopPropagation();

                  try {
                    const pos = editor.view.posAtDOM(blockEl, 0);
                    const styleLabel = blockEl.getAttribute("data-style-label") || blockEl.tagName;

                    const pageRect = e.currentTarget.getBoundingClientRect();
                    const pageLeft = rect.left - pageRect.left;
                    const pageTop = rect.top - pageRect.top;

                    setActiveGutter({
                      pos,
                      element: blockEl as HTMLElement,
                      styleLabel,
                      clientX: e.clientX,
                      clientY: e.clientY,
                      pageLeft: pageLeft - 105,
                      pageTop: pageTop,
                    });
                  } catch (err) {
                    console.error(err);
                  }
                }
              }}
            >
              {documentTitle && (
                <div className="text-center text-sm text-slate-400 mb-8 pb-4 border-b border-slate-100 font-sans tracking-wide">
                  {documentTitle}
                </div>
              )}
              <EditorContent editor={editor} />

              {/* Gutter Style Selector Popup */}
              {activeGutter && (
                <>
                  <div
                    className="fixed inset-0 z-40 bg-transparent"
                    onClick={() => setActiveGutter(null)}
                  />
                  <div
                    className="absolute z-50 bg-[#0c1222]/98 border border-slate-700/80 text-slate-200 rounded-lg shadow-2xl p-2.5 w-60 flex flex-col backdrop-blur-md transition-all duration-200"
                    style={{
                      left: `${activeGutter.pageLeft}px`,
                      top: `${activeGutter.pageTop + 24}px`,
                      boxShadow: "0 10px 30px -10px rgba(0,0,0,0.5), 0 1px 3px rgba(255,255,255,0.05)"
                    }}
                  >
                    <div className="px-2 py-1 text-[10px] uppercase tracking-wider font-bold text-slate-400 border-b border-slate-800 mb-1.5 flex items-center justify-between">
                      <span>Change Style</span>
                      <span className="px-1.5 py-0.5 bg-slate-800 text-amber-500 rounded text-[9px] font-mono">
                        {activeGutter.styleLabel}
                      </span>
                    </div>
                    <div className="max-h-60 overflow-y-auto pr-1 flex flex-col gap-0.5 styles-scrollbar">
                      {(styles || [
                        "Normal",
                        "H1",
                        "H2",
                        "H3",
                        "H4",
                        "H5",
                        "H6",
                        "CN",
                        "APX-TXT-FLUSH",
                        "EPI",
                        "ACKTXT",
                        "FootnoteText",
                        "EndnoteText"
                      ]).map((style) => (
                        <button
                          key={style}
                          onClick={() => {
                            applyStyle(style, activeGutter.pos);
                            setActiveGutter(null);
                          }}
                          className={`w-full text-left px-2.5 py-1.5 rounded text-xs transition-colors font-semibold flex items-center justify-between cursor-pointer ${activeGutter.styleLabel === style
                            ? "bg-amber-600 text-white font-bold"
                            : "hover:bg-slate-800 text-slate-300 hover:text-white"
                            }`}
                        >
                          <span>{style}</span>
                          {activeGutter.styleLabel === style && <span className="w-1.5 h-1.5 rounded-full bg-white" />}
                        </button>
                      ))}
                    </div>

                    {/* Inline Add Style input */}
                    <div className="border-t border-slate-800/80 mt-2 pt-2">
                      <input
                        type="text"
                        placeholder="Add new style..."
                        className="w-full px-2 py-1.5 bg-slate-900 border border-slate-700/60 rounded text-xs text-slate-200 focus:outline-none focus:border-amber-500 placeholder-slate-500 font-semibold"
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            handleAddNewStyleFromGutter(e.currentTarget.value, activeGutter.pos);
                          }
                        }}
                      />
                      <p className="text-[9px] text-slate-500 mt-1 px-1 font-medium">Press Enter to create and apply style</p>
                    </div>
                  </div>
                </>
              )}
              {/* Comments margin rail */}
              <div className="absolute left-[100%] top-0 ml-8 w-80 h-full pointer-events-none hidden xl:block">
                {Object.keys(comments).length > 0 && (
                  <div className="pointer-events-auto bg-slate-900/90 border border-slate-700/80 rounded-md p-3 mb-4 text-[10px] text-slate-300 font-bold uppercase tracking-wide flex items-center gap-1.5 shadow-md">
                    <span className="text-amber-400">âš ï¸</span>
                    <span>Comments are review-only; not written to exported DOCX.</span>
                  </div>
                )}
                {Object.entries(comments).map(([id, comment]) => {
                  const pos = commentPositions[id];
                  if (pos === undefined) return null;
                  return (
                    <div
                      key={id}
                      className="absolute w-full pointer-events-auto transition-all duration-200"
                      style={{ top: `${pos}px` }}
                    >
                      <CommentCard
                        comment={comment}
                        currentUser={currentUser || "Unknown"}
                        onSaveText={(cid, text) => {
                          setComments(prev => ({
                            ...prev,
                            [cid]: { ...prev[cid], text }
                          }));
                        }}
                        onAddReply={(cid, replyText) => {
                          setComments(prev => ({
                            ...prev,
                            [cid]: {
                              ...prev[cid],
                              replies: [
                                ...prev[cid].replies,
                                { text: replyText, author: currentUser || "Unknown", date: new Date().toISOString() }
                              ]
                            }
                          }));
                        }}
                        onToggleResolve={(cid) => {
                          setComments(prev => ({
                            ...prev,
                            [cid]: { ...prev[cid], resolved: !prev[cid].resolved }
                          }));
                        }}
                        onDelete={(cid) => {
                          editor?.commands.removeComment(cid);
                          setComments(prev => {
                            const next = { ...prev };
                            delete next[cid];
                            return next;
                          });
                        }}
                      />
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Side Panel */}
            {sidePanel && (
              <div
                className="w-80 flex-shrink-0 min-h-0 sticky top-0 self-start"
                style={{
                  height: `calc(${height} - 180px)`,
                  maxHeight: `calc(${height} - 180px)`,
                }}
              >
                {sidePanel}
              </div>
            )}
          </div>
        </div>

        {/* â”€â”€ Save Bar â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
        <div className="border-t border-slate-200 bg-white/95 backdrop-blur-sm px-6 py-3 flex items-center gap-3 shadow-md">
          <Button
            variant="primary"
            onClick={handleSave}
            disabled={isSaving}
            leftIcon={isSaving ? undefined : <Save className="w-4 h-4" />}
          >
            {isSaving ? "Saving..." : saveLabel}
          </Button>

          {exportHref && (
            <a href={exportHref} download className="no-underline">
              <Button variant="secondary" leftIcon={<Download className="w-4 h-4" />}>
                Export
              </Button>
            </a>
          )}

          {/* Dirty-state / saved indicator */}
          <div className="ml-2 flex items-center gap-2">
            {isDirty && !isSaving && (
              <span className="flex items-center gap-1.5 text-xs font-semibold text-amber-600">
                <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                Unsaved changes
              </span>
            )}
            {!isDirty && savedAt && !isSaving && (
              <span className="flex items-center gap-1.5 text-xs font-semibold text-emerald-600">
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
                Saved {savedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </span>
            )}
          </div>

          <div className="ml-auto flex items-center gap-4">
            {/* Word / char count */}
            <span className="flex items-center gap-1.5 text-[11px] text-slate-400 font-mono">
              <FileText className="w-3.5 h-3.5" />
              {wordCount.toLocaleString()} words Â· {charCount.toLocaleString()} chars
            </span>

            {tcEnabled && (
              <span className="text-xs font-semibold px-3 py-1 bg-emerald-50 text-emerald-700 rounded-full border border-emerald-200">
                Track Changes ON
              </span>
            )}
          </div>
        </div>

        {/* â”€â”€ Editor CSS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
        <style>{`
        /* ── SDT Block (Word Content Control) ─────────────────────────────── */
        .sdt-block {
          position: relative;
          border: 1.5px solid #4f83cc;
          border-radius: 3px;
          padding: 6px 8px 6px 32px;
          margin: 6px 0;
          background: rgba(79, 131, 204, 0.04);
        }
        .sdt-block::before {
          content: attr(data-alias);
          position: absolute; top: 0; left: 0;
          background: #4f83cc; color: #fff;
          font-size: 8px; font-weight: 700; font-family: monospace;
          padding: 1px 4px; border-radius: 2px 0 2px 0;
          text-transform: uppercase; letter-spacing: 0.5px; line-height: 1.6;
          max-width: 120px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .sdt-block .sdt-block {
          border-color: #7c3aed;
          background: rgba(124, 58, 237, 0.04);
        }
        .sdt-block .sdt-block::before { background: #7c3aed; }

        /* ── Dynamic Group Styles (Content Control Color Coding) ──────────── */
        /* Table / tbl_ Theme (Teal) */
        .sdt-block[data-alias*="Table"], .sdt-block[data-alias*="tbl_"] {
          border-color: #0d9488;
          background: rgba(13, 148, 136, 0.03);
        }
        .sdt-block[data-alias*="Table"]::before, .sdt-block[data-alias*="tbl_"]::before {
          background: #0d9488;
        }
        .sdt-inline[data-alias*="Table"], .sdt-inline[data-alias*="tbl_"] {
          background: rgba(13, 148, 136, 0.08) !important;
          border-top: 1px solid rgba(13, 148, 136, 0.4) !important;
          border-bottom: 1px solid rgba(13, 148, 136, 0.4) !important;
        }
        .sdt-inline[data-alias*="Table"]::before, .sdt-inline[data-alias*="tbl_"]::before {
          background: #0d9488 !important;
        }

        /* Figure / fig_ Theme (Orange) */
        .sdt-block[data-alias*="Figure"], .sdt-block[data-alias*="fig_"] {
          border-color: #ea580c;
          background: rgba(234, 88, 12, 0.03);
        }
        .sdt-block[data-alias*="Figure"]::before, .sdt-block[data-alias*="fig_"]::before {
          background: #ea580c;
        }
        .sdt-inline[data-alias*="Figure"], .sdt-inline[data-alias*="fig_"] {
          background: rgba(234, 88, 12, 0.08) !important;
          border-top: 1px solid rgba(234, 88, 12, 0.4) !important;
          border-bottom: 1px solid rgba(234, 88, 12, 0.4) !important;
        }
        .sdt-inline[data-alias*="Figure"]::before, .sdt-inline[data-alias*="fig_"]::before {
          background: #ea580c !important;
        }

        /* Chapters / Sections / Sequences (Pink/Rose) */
        .sdt-block[data-alias*="Chap"], .sdt-block[data-alias*="Seq"] {
          border-color: #be185d;
          background: rgba(190, 24, 93, 0.03);
        }
        .sdt-block[data-alias*="Chap"]::before, .sdt-block[data-alias*="Seq"]::before {
          background: #be185d;
        }
        .sdt-inline[data-alias*="Chap"], .sdt-inline[data-alias*="Seq"] {
          background: rgba(190, 24, 93, 0.08) !important;
          border-top: 1px solid rgba(190, 24, 93, 0.4) !important;
          border-bottom: 1px solid rgba(190, 24, 93, 0.4) !important;
        }
        .sdt-inline[data-alias*="Chap"]::before, .sdt-inline[data-alias*="Seq"]::before {
          background: #be185d !important;
        }

        /* Bibliography / References / bib_ / cite_ (Indigo/Purple) */
        .sdt-block[data-alias*="Bib"], .sdt-block[data-alias*="Ref"] {
          border-color: #6366f1;
          background: rgba(99, 102, 241, 0.03);
        }
        .sdt-block[data-alias*="Bib"]::before, .sdt-block[data-alias*="Ref"]::before {
          background: #6366f1;
        }
        .sdt-inline[data-alias*="Bib"], .sdt-inline[data-alias*="Ref"] {
          background: rgba(99, 102, 241, 0.08) !important;
          border-top: 1px solid rgba(99, 102, 241, 0.4) !important;
          border-bottom: 1px solid rgba(99, 102, 241, 0.4) !important;
        }
        .sdt-inline[data-alias*="Bib"]::before, .sdt-inline[data-alias*="Ref"]::before {
          background: #6366f1 !important;
        }

        /* ── SDT Inline ───────────────────────────────────────────────────── */
        .sdt-inline {
          background: rgba(79, 131, 204, 0.12);
          border-top: 1px solid rgba(79, 131, 204, 0.35);
          border-bottom: 1px solid rgba(79, 131, 204, 0.35);
          padding: 1px 0;
        }
        /* Alias pill — only on the FIRST span in a consecutive group */
        .sdt-inline[data-alias]::before {
          content: attr(data-alias);
          font-size: 7px; font-weight: 700; font-family: monospace;
          color: #fff; background: #4f83cc;
          padding: 0 3px; border-radius: 2px; margin-right: 3px;
          vertical-align: 1px; text-transform: uppercase; letter-spacing: 0.3px;
        }
        /* Suppress repeat pill — Case 1: sdt-inline spans are direct siblings */
        .sdt-inline + .sdt-inline::before { display: none; }
        /* Suppress repeat pill — Case 2: each sdt-inline is nested inside a run span */
        [data-run] + [data-run] > .sdt-inline::before { display: none; }

        /* ── Character Styles Color & Typographic Treatments ──────────────── */

        /* Formatting character styles from pipeline Step 7 */
        .ProseMirror span.bold { font-weight: bold; }
        .ProseMirror span.italic { font-style: italic; }
        .ProseMirror span.bolditalics { font-weight: bold; font-style: italic; }
        .ProseMirror span.singleunderline { text-decoration: underline; }
        .ProseMirror span.doubleunderline { text-decoration: underline double; }
        .ProseMirror span.superscript { vertical-align: super; font-size: 0.75em; }
        .ProseMirror span.subscript { vertical-align: sub; font-size: 0.75em; }
        .ProseMirror span.allcaps { text-transform: uppercase; }
        .ProseMirror span.smallcaps { font-variant-caps: small-caps; }
        .ProseMirror span.boldsingleunderline { font-weight: bold; text-decoration: underline; }
        .ProseMirror span.bolddoubleunderline { font-weight: bold; text-decoration: underline double; }
        .ProseMirror span.boldsuperscript { font-weight: bold; vertical-align: super; font-size: 0.75em; }
        .ProseMirror span.boldsubscript { font-weight: bold; vertical-align: sub; font-size: 0.75em; }
        .ProseMirror span.boldallcaps { font-weight: bold; text-transform: uppercase; }
        .ProseMirror span.boldsmallcaps { font-weight: bold; font-variant-caps: small-caps; }
        .ProseMirror span.italicsingleunderline { font-style: italic; text-decoration: underline; }
        .ProseMirror span.italicdoubleunderline { font-style: italic; text-decoration: underline double; }
        .ProseMirror span.italicsuperscript { font-style: italic; vertical-align: super; font-size: 0.75em; }
        .ProseMirror span.italicsubscript { font-style: italic; vertical-align: sub; font-size: 0.75em; }
        .ProseMirror span.italicallcaps { font-style: italic; text-transform: uppercase; }
        .ProseMirror span.italicsmallcaps { font-style: italic; font-variant-caps: small-caps; }
        .ProseMirror span.bolditalicsuperscript { font-weight: bold; font-style: italic; vertical-align: super; font-size: 0.75em; }
        .ProseMirror span.bolditalicsubscript { font-weight: bold; font-style: italic; vertical-align: sub; font-size: 0.75em; }
        .ProseMirror span.bolditalicallcaps { font-weight: bold; font-style: italic; text-transform: uppercase; }
        .ProseMirror span.bolditalicsmallcaps { font-weight: bold; font-style: italic; font-variant-caps: small-caps; }
        /* Caption character styles from pipeline Step 8 */
        .ProseMirror span.FigureCitation { background-color: rgba(255, 255, 0, 0.35); }
        .ProseMirror span.TableCitation { background-color: rgba(146, 208, 80, 0.35); }
        .ProseMirror span[class="FIG-NUM"] { background-color: rgba(255, 255, 0, 0.35); }
        .ProseMirror span.TN { background-color: rgba(146, 208, 80, 0.35); }

        /* Default Bibliography Spans */
        span[class^="bib_"], span[class*=" bib_"] {
          background-color: rgba(16, 185, 129, 0.06);
          color: #059669;
          border-bottom: 1px dotted rgba(16, 185, 129, 0.4);
          padding: 1px 0;
        }
        /* Default Citation Spans */
        span[class^="cite_"], span[class*=" cite_"] {
          background-color: rgba(249, 115, 22, 0.06);
          color: #ea580c;
          border-bottom: 1px dotted rgba(249, 115, 22, 0.4);
          padding: 1px 0;
        }
        
        /* Specific Bibliography styles */
        .bib_fname, .bib_surname {
          font-weight: 700;
          color: #0d9488 !important;
          background-color: rgba(13, 148, 136, 0.08) !important;
          border-bottom: 1px dotted rgba(13, 148, 136, 0.4) !important;
        }
        .bib_year {
          font-weight: 700;
          color: #64748b !important;
          background-color: rgba(100, 116, 139, 0.08) !important;
          border-bottom: 1px dotted rgba(100, 116, 139, 0.4) !important;
        }
        .bib_title, .bib_journal {
          font-style: italic;
          color: #4f46e5 !important;
          background-color: rgba(79, 70, 229, 0.08) !important;
          border-bottom: 1px dotted rgba(79, 70, 229, 0.4) !important;
        }
        .bib_volume {
          font-weight: 700;
          color: #1e293b !important;
          background-color: rgba(241, 245, 249, 0.8) !important;
          border-bottom: none !important;
        }
        .bib_doi, .bib_url {
          text-decoration: underline;
          color: #e11d48 !important;
          background-color: rgba(225, 29, 72, 0.08) !important;
          border-bottom: none !important;
        }

        /* Specific Citation styles */
        .cite_bib {
          font-style: italic;
          font-weight: 600;
          color: #7c3aed !important;
          background-color: rgba(139, 92, 246, 0.08) !important;
          border-bottom: 1px dotted rgba(139, 92, 246, 0.4) !important;
        }
        .cite_fig, .cite_tbl {
          font-weight: 700;
          color: #d97706 !important;
          background-color: rgba(245, 158, 11, 0.08) !important;
          border-bottom: 1px dotted rgba(245, 158, 11, 0.4) !important;
        }
        .cite_eq, .cite_app {
          font-style: italic;
          font-weight: 600;
          color: #0891b2 !important;
          background-color: rgba(6, 182, 212, 0.08) !important;
          border-bottom: 1px dotted rgba(6, 182, 212, 0.4) !important;
        }

        .ProseMirror {
          outline: none;
          position: relative;
          word-wrap: break-word;
          white-space: normal;
        }
        .ProseMirror p {
          margin: 0;
          padding: 0;
          line-height: 2;
        }
        .ProseMirror p.is-editor-empty:first-child::before {
          color: #adb5bd;
          content: attr(data-placeholder);
          float: left;
          height: 0;
          pointer-events: none;
        }
        .tc-insert {
          background-color: rgba(34, 197, 94, 0.2);
          text-decoration: underline;
          text-decoration-color: rgb(22, 163, 74);
        }
        .tc-delete {
          background-color: rgba(239, 68, 68, 0.15);
          text-decoration: line-through;
          text-decoration-color: rgb(220, 38, 38);
          color: rgba(127, 29, 29, 0.8);
          padding: 2px 4px;
          border-radius: 2px;
        }
        .tc-delete:hover {
          background-color: rgba(239, 68, 68, 0.25);
        }
        /* Occurrence highlights */
        .occurrence-highlight {
          padding: 1px 3px !important;
          border-radius: 2px !important;
          cursor: pointer !important;
          transition: all 0.18s ease-in-out !important;
        }

        /* --- Active Selection (Vivid Focus Pulsating Highlights) --- */
        @keyframes green-highlight-pulse {
          0% { box-shadow: 0 0 0 2px rgba(34, 197, 94, 0.3); }
          50% { box-shadow: 0 0 0 5px rgba(34, 197, 94, 0.55); }
          100% { box-shadow: 0 0 0 2px rgba(34, 197, 94, 0.3); }
        }
        @keyframes orange-highlight-pulse {
          0% { box-shadow: 0 0 0 2px rgba(249, 115, 22, 0.3); }
          50% { box-shadow: 0 0 0 5px rgba(249, 115, 22, 0.55); }
          100% { box-shadow: 0 0 0 2px rgba(249, 115, 22, 0.3); }
        }

        /* 1. Green highlights (Compliance / Rules / Stylesheet) */
        .occurrence-stylesheet,
        .occurrence-te_point {
          background-color: rgba(34, 197, 94, 0.20) !important;
          border-bottom: 3px solid rgba(34, 197, 94, 0.85) !important;
          color: inherit !important;
          font-weight: inherit !important;
        }
        .occurrence-stylesheet:hover,
        .occurrence-te_point:hover {
          background-color: rgba(34, 197, 94, 0.12) !important;
          border-bottom: 2px solid rgba(34, 197, 94, 0.9) !important;
        }
        .occurrence-stylesheet-selected,
        .occurrence-te_point-selected {
          background-color: rgba(34, 197, 94, 0.40) !important;
          border-bottom: 2.5px solid rgba(34, 197, 94, 0.95) !important;
          color: #14532d !important;
          font-weight: 700 !important;
          padding: 2px 3px !important;
          border-radius: 3px !important;
          animation: green-highlight-pulse 2s infinite ease-in-out !important;
          transition: all 0.18s ease-in-out !important;
          opacity: 1 !important;
        }

        /* 2. Orange highlights (Language anomalies: spelling, grammar, style, consistency, bias, hyphenation) */
        .occurrence-spelling,
        .occurrence-consistency,
        .occurrence-grammar,
        .occurrence-style,
        .occurrence-hyphenation,
        .occurrence-bias {
          background-color: rgba(249, 115, 22, 0.20) !important;
          border-bottom: 3px solid rgba(249, 115, 22, 0.85) !important;
          color: inherit !important;
          font-weight: inherit !important;
        }
        .occurrence-spelling:hover,
        .occurrence-consistency:hover,
        .occurrence-grammar:hover,
        .occurrence-style:hover,
        .occurrence-hyphenation:hover,
        .occurrence-bias:hover {
          background-color: rgba(249, 115, 22, 0.12) !important;
          border-bottom: 2px solid rgba(249, 115, 22, 0.9) !important;
        }
        .occurrence-spelling-selected,
        .occurrence-consistency-selected,
        .occurrence-grammar-selected,
        .occurrence-style-selected,
        .occurrence-hyphenation-selected,
        .occurrence-bias-selected {
          background-color: rgba(249, 115, 22, 0.40) !important;
          border-bottom: 2.5px solid rgba(249, 115, 22, 0.95) !important;
          color: #7c2d12 !important;
          font-weight: 700 !important;
          padding: 2px 3px !important;
          border-radius: 3px !important;
          animation: orange-highlight-pulse 2s infinite ease-in-out !important;
          transition: all 0.18s ease-in-out !important;
          opacity: 1 !important;
        }

        /* Fallbacks for generic occurrence classes */
        .occurrence-highlight-selected {
          background-color: rgba(22, 163, 74, 0.40) !important;
          border-bottom: 2.5px solid rgba(22, 163, 74, 0.95) !important;
          color: #14532d !important;
          font-weight: 700 !important;
          padding: 2px 3px !important;
          border-radius: 3px !important;
          animation: green-highlight-pulse 2s infinite ease-in-out !important;
          transition: all 0.18s ease-in-out !important;
          opacity: 1 !important;
        }


        /* Style indicators on the Left Margin */
        .ProseMirror h1,
        .ProseMirror h2,
        .ProseMirror h3,
        .ProseMirror h4,
        .ProseMirror h5,
        .ProseMirror h6,
        .ProseMirror p {
          position: relative !important;
        }
        .ProseMirror h1::after,
        .ProseMirror h2::after,
        .ProseMirror h3::after,
        .ProseMirror h4::after,
        .ProseMirror h5::after,
        .ProseMirror h6::after,
        .ProseMirror p::after {
          content: attr(data-style-label) !important;
          position: absolute !important;
          left: -1.25in !important;
          top: 0.35rem !important;
          width: 1.0in !important;
          text-align: right !important;
          padding: 0.15rem 0.35rem !important;
          font-size: 0.6rem !important;
          font-weight: 700 !important;
          background-color: rgba(245, 158, 11, 0.07) !important;
          border: 1px solid rgba(245, 158, 11, 0.28) !important;
          color: #b45309 !important;
          border-radius: 0.25rem !important;
          text-transform: uppercase !important;
          letter-spacing: 0.04em !important;
          white-space: nowrap !important;
          overflow: hidden !important;
          text-overflow: ellipsis !important;
          pointer-events: auto !important;
          cursor: pointer !important;
          line-height: 1.1 !important;
          font-family: system-ui, -apple-system, sans-serif !important;
          transition: all 0.15s ease !important;
        }

        .ProseMirror p[data-style-label]:hover::after,
        .ProseMirror h1[data-style-label]:hover::after,
        .ProseMirror h2[data-style-label]:hover::after,
        .ProseMirror h3[data-style-label]:hover::after,
        .ProseMirror h4[data-style-label]:hover::after,
        .ProseMirror h5[data-style-label]:hover::after,
        .ProseMirror h6[data-style-label]:hover::after {
          background-color: rgba(245, 158, 11, 0.18) !important;
          border-color: rgba(245, 158, 11, 0.6) !important;
          color: #92400e !important;
          box-shadow: 0 1px 3px rgba(0,0,0,0.06) !important;
        }

        /* Suppress empty/Normal style margin badges */
        .ProseMirror p:not([data-style-label])::after,
        .ProseMirror p[data-style-label=""]::after,
        .ProseMirror p[data-style-label="Normal"]::after,
        .ProseMirror p[data-style-label="MsoNormal"]::after,
        .ProseMirror h1:not([data-style-label])::after,
        .ProseMirror h1[data-style-label=""]::after,
        .ProseMirror h2:not([data-style-label])::after,
        .ProseMirror h2[data-style-label=""]::after,
        .ProseMirror h3:not([data-style-label])::after,
        .ProseMirror h3[data-style-label=""]::after,
        .ProseMirror h4:not([data-style-label])::after,
        .ProseMirror h4[data-style-label=""]::after,
        .ProseMirror h5:not([data-style-label])::after,
        .ProseMirror h5[data-style-label=""]::after,
        .ProseMirror h6:not([data-style-label])::after,
        .ProseMirror h6[data-style-label=""]::after {
          display: none !important;
        }

        /* Bullet & Numbered List Styling */
        .ProseMirror ul {
          list-style-type: disc !important;
          margin-left: 2rem !important;
          padding-left: 0.5rem !important;
          margin-top: 0.5rem !important;
          margin-bottom: 0.5rem !important;
        }
        .ProseMirror ul ul {
          list-style-type: circle !important;
        }
        .ProseMirror ul ul ul {
          list-style-type: square !important;
        }
        .ProseMirror ul ul ul ul {
          list-style-type: disc !important;
        }

        .ProseMirror ol {
          list-style-type: decimal !important;
          margin-left: 2rem !important;
          padding-left: 0.5rem !important;
          margin-top: 0.5rem !important;
          margin-bottom: 0.5rem !important;
        }
        .ProseMirror ol ol {
          list-style-type: lower-alpha !important;
        }
        .ProseMirror ol ol ol {
          list-style-type: lower-roman !important;
        }
        .ProseMirror ol ol ol ol {
          list-style-type: upper-alpha !important;
        }
        .ProseMirror ol ol ol ol ol {
          list-style-type: upper-roman !important;
        }

        .ProseMirror li {
          margin-bottom: 0.25rem !important;
          line-height: 1.8 !important;
        }

        /* Extracts and BlockQuotes Styling (Word-like indents) */
        .ProseMirror blockquote,
        .ProseMirror p.EXT-FIRST,
        .ProseMirror p.EXT-MID,
        .ProseMirror p.EXT-LAST,
        .ProseMirror p.EXT-ONLY,
        .ProseMirror p.Extract,
        .ProseMirror p.Quote,
        .ProseMirror p.BlockQuote,
        .ProseMirror p[data-style-label="EXT-FIRST"],
        .ProseMirror p[data-style-label="EXT-MID"],
        .ProseMirror p[data-style-label="EXT-LAST"],
        .ProseMirror p[data-style-label="EXT-ONLY"],
        .ProseMirror p[data-style-label="Extract"],
        .ProseMirror p[data-style-label="Quote"],
        .ProseMirror p[data-style-label="BlockQuote"],
        .ProseMirror p[data-style-label="Block Quote"] {
          margin-left: 3rem !important;
          margin-right: 3rem !important;
          font-size: 0.95em !important;
          border-left: 3px solid #cbd5e1 !important;
          padding-left: 1rem !important;
          margin-top: 0.5rem !important;
          margin-bottom: 0.5rem !important;
          line-height: 1.6 !important;
        }

        /* Custom Page Break Node Styling */
        .ProseMirror .page-break {
          border: none !important;
          margin: 2.5rem 0 !important;
          padding: 0 !important;
          display: flex !important;
          align-items: center !important;
          justify-content: center !important;
          position: relative !important;
          user-select: none !important;
        }
        .ProseMirror .page-break::before {
          content: "" !important;
          position: absolute !important;
          left: 0 !important;
          right: 0 !important;
          height: 1px !important;
          border-top: 2px dashed #94a3b8 !important;
          z-index: 1 !important;
        }
        .ProseMirror .page-break span {
          background: #ffffff !important;
          padding: 2px 12px !important;
          color: #64748b !important;
          font-size: 11px !important;
          font-weight: 600 !important;
          text-transform: uppercase !important;
          letter-spacing: 0.1em !important;
          z-index: 2 !important;
          border: 1px solid #cbd5e1 !important;
          border-radius: 4px !important;
          font-family: system-ui, -apple-system, sans-serif !important;
        }

        /* Premium Table Borders & Header Styling */
        .ProseMirror table {
          border-collapse: collapse !important;
          table-layout: fixed !important;
          width: 100% !important;
          margin: 1.5rem 0 !important;
          overflow: hidden !important;
          border: 1px solid #cbd5e1 !important;
          box-shadow: 0 1px 3px rgba(0,0,0,0.02) !important;
        }
        .ProseMirror td,
        .ProseMirror th {
          min-width: 1em !important;
          border: 1px solid #cbd5e1 !important;
          padding: 10px 14px !important;
          vertical-align: top !important;
          box-sizing: border-box !important;
          position: relative !important;
        }
        .ProseMirror th {
          font-weight: bold !important;
          text-align: left !important;
          background-color: #f8fafc !important;
          border-bottom: 2px solid #94a3b8 !important;
        }
        .ProseMirror .selectedCell:after {
          z-index: 2 !important;
          position: absolute !important;
          content: "" !important;
          left: 0 !important; right: 0 !important; top: 0 !important; bottom: 0 !important;
          background: rgba(200, 200, 250, 0.3) !important;
          pointer-events: none !important;
        }
        .ProseMirror .column-resize-handle {
          position: absolute !important;
          right: -2px !important;
          top: 0 !important;
          bottom: -2px !important;
          width: 4px !important;
          background-color: #3b82f6 !important;
          pointer-events: none !important;
        }

        /* Link styling */
        .ProseMirror a {
          color: #2563eb !important;
          text-decoration: underline !important;
          cursor: pointer !important;
        }
        .ProseMirror a:hover {
          color: #1d4ed8 !important;
        }

        /* Superscript / Subscript */
        .ProseMirror sup { vertical-align: super; font-size: 0.75em; }
        .ProseMirror sub { vertical-align: sub; font-size: 0.75em; }

        /* Footnote Visual Differentiation (Soft Blue) */
        .ProseMirror p[data-style-label*="footnote" i],
        .ProseMirror p[class*="footnote" i],
        .ProseMirror p.footnote,
        .ProseMirror p.FootnoteText {
          background-color: rgba(59, 130, 246, 0.04) !important;
          border-left: 3px solid #3b82f6 !important;
          padding: 8px 14px !important;
          margin-bottom: 8px !important;
          font-size: 0.85rem !important;
          line-height: 1.6 !important;
          border-radius: 0 4px 4px 0 !important;
          font-family: system-ui, -apple-system, sans-serif !important;
        }

        /* Endnote Visual Differentiation (Soft Amber) */
        .ProseMirror p[data-style-label*="endnote" i],
        .ProseMirror p[class*="endnote" i],
        .ProseMirror p.endnote,
        .ProseMirror p.EndnoteText {
          background-color: rgba(217, 119, 6, 0.04) !important;
          border-left: 3px solid #d97706 !important;
          padding: 8px 14px !important;
          margin-bottom: 8px !important;
          font-size: 0.85rem !important;
          line-height: 1.6 !important;
          border-radius: 0 4px 4px 0 !important;
          font-family: system-ui, -apple-system, sans-serif !important;
        }

        /* Reference Validation Character Style Highlights (no borders) */
        .ProseMirror span.bib_alt-year { background-color: #d8b4fe !important; }
        .ProseMirror span.bib_article { background-color: #bae6fd !important; }
        .ProseMirror span.bib_book { background-color: #93c5fd !important; }
        .ProseMirror span.bib_chapterno { background-color: #e5e7eb !important; }
        .ProseMirror span.bib_chaptertitle { background-color: #fdba74 !important; }
        .ProseMirror span.bib_comment { background-color: #c7d2fe !important; }
        .ProseMirror span.bib_confacronym { background-color: #f472b6 !important; }
        .ProseMirror span.bib_confdate { background-color: #2dd4bf !important; }
        .ProseMirror span.bib_conference { background-color: #60a5fa !important; }
        .ProseMirror span.bib_conflocation { background-color: #f87171 !important; }
        .ProseMirror span.bib_confpaper { background-color: #86efac !important; }
        .ProseMirror span.bib_confproceedings { background-color: #fbbf24 !important; }
        .ProseMirror span.bib_day { background-color: #fef08a !important; }
        .ProseMirror span.bib_doi { background-color: #fef08a !important; }
        .ProseMirror span.bib_ed-etal { background-color: #22d3ee !important; }
        .ProseMirror span.bib_ed-fname { background-color: #fef08a !important; }
        .ProseMirror span.bib_editionno { background-color: #facc15 !important; }
        .ProseMirror span.bib_ed-organization { background-color: #fbcfe8 !important; }
        .ProseMirror span.bib_ed-suffix { background-color: #a7f3d0 !important; }
        .ProseMirror span.bib_ed-surname { background-color: #facc15 !important; }
        .ProseMirror span.bib_etal { background-color: #bef264 !important; }
        .ProseMirror span.bib_extlink { background-color: #5eead4 !important; }
        .ProseMirror span.bib_fname { background-color: #fef9c3 !important; }
        .ProseMirror span.bib_fpage { background-color: #fef9c3 !important; }
        .ProseMirror span.bib_institution { background-color: #d1fae5 !important; }
        .ProseMirror span.bib_isbn { background-color: #f3f4f6 !important; }
        .ProseMirror span.bib_issue { background-color: #bfdbfe !important; }
        .ProseMirror span.bib_journal { background-color: #ffedd5 !important; }
        .ProseMirror span.bib_location { background-color: #fecdd3 !important; }
        .ProseMirror span.bib_lpage { background-color: #e5e7eb !important; }
        .ProseMirror span.bib_medline { background-color: #bae6fd !important; }
        .ProseMirror span.bib_month { background-color: #bef264 !important; }
        .ProseMirror span.bib_number { background-color: #c084fc !important; }
        .ProseMirror span.bib_organization { background-color: #d1fae5 !important; }
        .ProseMirror span.bib_pagecount { background-color: #22c55e !important; }
        .ProseMirror span.bib_papernumber { background-color: #fef08a !important; }
        .ProseMirror span.bib_patent { background-color: #38bdf8 !important; }
        .ProseMirror span.bib_publisher { background-color: #f472b6 !important; }
        .ProseMirror span.bib_reportnum { background-color: #818cf8 !important; }
        .ProseMirror span.bib_school { background-color: #fb923c !important; }
        .ProseMirror span.bib_season { background-color: #ea580c !important; }
        .ProseMirror span.bib_series { background-color: #ffedd5 !important; }
        .ProseMirror span.bib_seriesno { background-color: #fef08a !important; }
        .ProseMirror span.bib_suppl { background-color: #fef9c3 !important; }
        .ProseMirror span.bib_surname { background-color: #bef264 !important; }
        .ProseMirror span.bib_title { background-color: #fbcfe8 !important; }
        .ProseMirror span.bib_trans { background-color: #bef264 !important; }
        .ProseMirror span.bib_url { background-color: #d9f99d !important; }
        .ProseMirror span.bib_volcount { background-color: #22c55e !important; }
        .ProseMirror span.bib_volume { background-color: #bae6fd !important; }
        .ProseMirror span.bib_year { background-color: #e9d5ff !important; }

        .ProseMirror span.cite_app { background-color: #bef264 !important; }
        .ProseMirror span.cite_bib { background-color: #cffafe !important; }
        .ProseMirror span.cite_eq { background-color: #fdba74 !important; }
        .ProseMirror span.cite_fig { background-color: #bbf7d0 !important; }
        .ProseMirror span.cite_fn { background-color: #fbcfe8 !important; }
        .ProseMirror span.cite_sec { background-color: #fecdd3 !important; }
        .ProseMirror span.cite_tbl { background-color: #fca5a5 !important; }
        .ProseMirror span.cite_tfn { background-color: #fed7aa !important; }

        /* Custom Comment and Find/Replace Styles */
        .ProseMirror span.tc-comment {
          background-color: rgba(254, 240, 138, 0.4) !important;
          border-bottom: 2px solid #eab308 !important;
          cursor: pointer;
        }
        .ProseMirror span.search-result {
          background-color: rgba(254, 240, 138, 0.8) !important;
        }
        .ProseMirror span.search-result-active {
          background-color: #f97316 !important;
          color: white !important;
        }

        /* ── Structured Bullet List Styles (Word-like lists converted to flat <p> elements) ── */
        .ProseMirror p[data-style-label="BL-FIRST"],
        .ProseMirror p[data-style-label="BL-MID"],
        .ProseMirror p[data-style-label="BL-LAST"],
        .ProseMirror p[data-style-label="BX1-BL-FIRST"],
        .ProseMirror p[data-style-label="BX1-BL-MID"],
        .ProseMirror p[data-style-label="BX1-BL-LAST"],
        .ProseMirror p[data-style-label="BX1-UL-FIRST"],
        .ProseMirror p[data-style-label="BX1-UL-MID"],
        .ProseMirror p[data-style-label="BX1-UL-LAST"],
        .ProseMirror p[data-style-label="FN-BL-FIRST"],
        .ProseMirror p[data-style-label="FN-BL-MID"],
        .ProseMirror p[data-style-label="FN-BL-LAST"],
        .ProseMirror p[data-style-label="KP-BL-FIRST"],
        .ProseMirror p[data-style-label="KP-BL-LAST"],
        .ProseMirror p[data-style-label="KP-BL-MID"],
        .ProseMirror p[data-style-label="KT-BL-FIRST"],
        .ProseMirror p[data-style-label="KT-BL-LAST"],
        .ProseMirror p[data-style-label="KT-BL-MID"],
        .ProseMirror p[data-style-label="NBX-BL-FIRST"],
        .ProseMirror p[data-style-label="NBX-BL-MID"],
        .ProseMirror p[data-style-label="NBX-BL-LAST"],
        .ProseMirror p[data-style-label="OBJ-BL-FIRST"],
        .ProseMirror p[data-style-label="OBJ-BL-LAST"],
        .ProseMirror p[data-style-label="OBJ-BL-MID"],
        .ProseMirror p[data-style-label="OBJ-UL-FIRST"],
        .ProseMirror p[data-style-label="OBJ-UL-LAST"],
        .ProseMirror p[data-style-label="OBJ-UL-MID"],
        .ProseMirror p[data-style-label="SBBL-FIRST"],
        .ProseMirror p[data-style-label="SBBL-LAST"],
        .ProseMirror p[data-style-label="SBBL-MID"],
        .ProseMirror p[data-style-label="SBUL-FIRST"],
        .ProseMirror p[data-style-label="SBUL"],
        .ProseMirror p[data-style-label="TFN-BL-FIRST"],
        .ProseMirror p[data-style-label="TFN-BL-MID"],
        .ProseMirror p[data-style-label="TFN-BL-LAST"],
        .ProseMirror p[data-style-label="TUL-FIRST"],
        .ProseMirror p[data-style-label="TUL-MID"],
        .ProseMirror p[data-style-label="UL-FIRST"],
        .ProseMirror p[data-style-label="UL-LAST"],
        .ProseMirror p[data-style-label="UL-MID"],
        .ProseMirror p[data-style-label="UNBX-BL"],
        .ProseMirror p[data-style-label="UNBX-UL"],
        .ProseMirror p[data-style-label="UNT-BL"],
        .ProseMirror p[data-style-label="UNT-UL"],
        .ProseMirror p[data-style-label="GLOS-BL-FIRST"],
        .ProseMirror p[data-style-label="GLOS-BL-MID"] {
          position: relative !important;
          margin-left: 2rem !important;
          padding-left: 0.5rem !important;
          margin-top: 0.25rem !important;
          margin-bottom: 0.25rem !important;
        }

        .ProseMirror p[data-style-label="BL-FIRST"]::before,
        .ProseMirror p[data-style-label="BL-MID"]::before,
        .ProseMirror p[data-style-label="BL-LAST"]::before,
        .ProseMirror p[data-style-label="BX1-BL-FIRST"]::before,
        .ProseMirror p[data-style-label="BX1-BL-MID"]::before,
        .ProseMirror p[data-style-label="BX1-BL-LAST"]::before,
        .ProseMirror p[data-style-label="BX1-UL-FIRST"]::before,
        .ProseMirror p[data-style-label="BX1-UL-MID"]::before,
        .ProseMirror p[data-style-label="BX1-UL-LAST"]::before,
        .ProseMirror p[data-style-label="FN-BL-FIRST"]::before,
        .ProseMirror p[data-style-label="FN-BL-MID"]::before,
        .ProseMirror p[data-style-label="FN-BL-LAST"]::before,
        .ProseMirror p[data-style-label="KP-BL-FIRST"]::before,
        .ProseMirror p[data-style-label="KP-BL-LAST"]::before,
        .ProseMirror p[data-style-label="KP-BL-MID"]::before,
        .ProseMirror p[data-style-label="KT-BL-FIRST"]::before,
        .ProseMirror p[data-style-label="KT-BL-LAST"]::before,
        .ProseMirror p[data-style-label="KT-BL-MID"]::before,
        .ProseMirror p[data-style-label="NBX-BL-FIRST"]::before,
        .ProseMirror p[data-style-label="NBX-BL-MID"]::before,
        .ProseMirror p[data-style-label="NBX-BL-LAST"]::before,
        .ProseMirror p[data-style-label="OBJ-BL-FIRST"]::before,
        .ProseMirror p[data-style-label="OBJ-BL-LAST"]::before,
        .ProseMirror p[data-style-label="OBJ-BL-MID"]::before,
        .ProseMirror p[data-style-label="OBJ-UL-FIRST"]::before,
        .ProseMirror p[data-style-label="OBJ-UL-LAST"]::before,
        .ProseMirror p[data-style-label="OBJ-UL-MID"]::before,
        .ProseMirror p[data-style-label="SBBL-FIRST"]::before,
        .ProseMirror p[data-style-label="SBBL-LAST"]::before,
        .ProseMirror p[data-style-label="SBBL-MID"]::before,
        .ProseMirror p[data-style-label="SBUL-FIRST"]::before,
        .ProseMirror p[data-style-label="SBUL"]::before,
        .ProseMirror p[data-style-label="TFN-BL-FIRST"]::before,
        .ProseMirror p[data-style-label="TFN-BL-MID"]::before,
        .ProseMirror p[data-style-label="TFN-BL-LAST"]::before,
        .ProseMirror p[data-style-label="TUL-FIRST"]::before,
        .ProseMirror p[data-style-label="TUL-MID"]::before,
        .ProseMirror p[data-style-label="UL-FIRST"]::before,
        .ProseMirror p[data-style-label="UL-LAST"]::before,
        .ProseMirror p[data-style-label="UL-MID"]::before,
        .ProseMirror p[data-style-label="UNBX-BL"]::before,
        .ProseMirror p[data-style-label="UNBX-UL"]::before,
        .ProseMirror p[data-style-label="UNT-BL"]::before,
        .ProseMirror p[data-style-label="UNT-UL"]::before,
        .ProseMirror p[data-style-label="GLOS-BL-FIRST"]::before,
        .ProseMirror p[data-style-label="GLOS-BL-MID"]::before {
          content: "•" !important;
          position: absolute !important;
          left: -1rem !important;
          top: 0 !important;
          font-weight: bold !important;
          color: inherit !important;
        }

        /* Level 2 Bullet List Styles */
        .ProseMirror p[data-style-label="BL2-MID"],
        .ProseMirror p[data-style-label="BX1-BL2-MID"],
        .ProseMirror p[data-style-label="NBX-BL2-MID"] {
          position: relative !important;
          margin-left: 3.5rem !important;
          padding-left: 0.5rem !important;
          margin-top: 0.25rem !important;
          margin-bottom: 0.25rem !important;
        }
        .ProseMirror p[data-style-label="BL2-MID"]::before,
        .ProseMirror p[data-style-label="BX1-BL2-MID"]::before,
        .ProseMirror p[data-style-label="NBX-BL2-MID"]::before {
          content: "◦" !important;
          position: absolute !important;
          left: -1rem !important;
          top: 0 !important;
          font-weight: bold !important;
          color: inherit !important;
        }

        /* Level 3 Bullet List Styles */
        .ProseMirror p[data-style-label="BL3-MID"] {
          position: relative !important;
          margin-left: 5rem !important;
          padding-left: 0.5rem !important;
          margin-top: 0.25rem !important;
          margin-bottom: 0.25rem !important;
        }
        .ProseMirror p[data-style-label="BL3-MID"]::before {
          content: "▪" !important;
          position: absolute !important;
          left: -1rem !important;
          top: 0 !important;
          font-weight: bold !important;
          color: inherit !important;
        }

        /* Levels 4, 5, 6 Bullet List Styles */
        .ProseMirror p[data-style-label="BL4-MID"] {
          position: relative !important;
          margin-left: 6.5rem !important;
          padding-left: 0.5rem !important;
          margin-top: 0.25rem !important;
          margin-bottom: 0.25rem !important;
        }
        .ProseMirror p[data-style-label="BL4-MID"]::before {
          content: "•" !important;
          position: absolute !important;
          left: -1rem !important;
          top: 0 !important;
          font-weight: bold !important;
          color: inherit !important;
        }

        .ProseMirror p[data-style-label="BL5-MID"] {
          position: relative !important;
          margin-left: 8rem !important;
          padding-left: 0.5rem !important;
          margin-top: 0.25rem !important;
          margin-bottom: 0.25rem !important;
        }
        .ProseMirror p[data-style-label="BL5-MID"]::before {
          content: "◦" !important;
          position: absolute !important;
          left: -1rem !important;
          top: 0 !important;
          font-weight: bold !important;
          color: inherit !important;
        }

        .ProseMirror p[data-style-label="BL6-MID"] {
          position: relative !important;
          margin-left: 9.5rem !important;
          padding-left: 0.5rem !important;
          margin-top: 0.25rem !important;
          margin-bottom: 0.25rem !important;
        }
        .ProseMirror p[data-style-label="BL6-MID"]::before {
          content: "▪" !important;
          position: absolute !important;
          left: -1rem !important;
          top: 0 !important;
          font-weight: bold !important;
          color: inherit !important;
        }

        /* Numbered List Styles Indentation */
        .ProseMirror p[data-style-label="NL-FIRST"],
        .ProseMirror p[data-style-label="NL-MID"],
        .ProseMirror p[data-style-label="NL-LAST"],
        .ProseMirror p[data-style-label="BX1-NL-FIRST"],
        .ProseMirror p[data-style-label="BX1-NL-MID"],
        .ProseMirror p[data-style-label="BX1-NL-LAST"],
        .ProseMirror p[data-style-label="NBX-NL-FIRST"],
        .ProseMirror p[data-style-label="NBX-NL-MID"],
        .ProseMirror p[data-style-label="NBX-NL-LAST"],
        .ProseMirror p[data-style-label="OBJ-NL-FIRST"],
        .ProseMirror p[data-style-label="OBJ-NL-MID"],
        .ProseMirror p[data-style-label="OBJ-NL-LAST"],
        .ProseMirror p[data-style-label="EX-NL-FIRST"],
        .ProseMirror p[data-style-label="EX-NL-MID"],
        .ProseMirror p[data-style-label="EX-NL-LAST"],
        .ProseMirror p[data-style-label="KP-NL-FIRST"],
        .ProseMirror p[data-style-label="KP-NL-MID"],
        .ProseMirror p[data-style-label="KP-NL-LAST"],
        .ProseMirror p[data-style-label="KT-NL-FIRST"],
        .ProseMirror p[data-style-label="KT-NL-MID"],
        .ProseMirror p[data-style-label="KT-NL-LAST"],
        .ProseMirror p[data-style-label="RQ-NL-FIRST"],
        .ProseMirror p[data-style-label="RQ-NL-MID"],
        .ProseMirror p[data-style-label="RQ-NL-LAST"],
        .ProseMirror p[data-style-label="GLOS-NL-FIRST"],
        .ProseMirror p[data-style-label="GLOS-NL-MID"],
        .ProseMirror p[data-style-label="UNBX-NL"],
        .ProseMirror p[data-style-label^="EXER-"][data-style-label*="-NL-"] {
          position: relative !important;
          margin-left: 2rem !important;
          padding-left: 0.5rem !important;
          margin-top: 0.25rem !important;
          margin-bottom: 0.25rem !important;
        }

        /* Numbered List Auto-numbering */
        .ProseMirror {
          counter-reset: structured-num-list;
        }

        /* Reset the counter for a new sequence of consecutive numbered list items */
        .ProseMirror > *:not(p[data-style-label^="NL-"]):not(p[data-style-label*="-NL-"]):not(p[data-style-label$="-NL"]):not(p[data-style-label^="EXER-"][data-style-label*="-NL-"]) + p[data-style-label^="NL-"],
        .ProseMirror > *:not(p[data-style-label^="NL-"]):not(p[data-style-label*="-NL-"]):not(p[data-style-label$="-NL"]):not(p[data-style-label^="EXER-"][data-style-label*="-NL-"]) + p[data-style-label*="-NL-"],
        .ProseMirror > *:not(p[data-style-label^="NL-"]):not(p[data-style-label*="-NL-"]):not(p[data-style-label$="-NL"]):not(p[data-style-label^="EXER-"][data-style-label*="-NL-"]) + p[data-style-label$="-NL"],
        .ProseMirror > *:not(p[data-style-label^="NL-"]):not(p[data-style-label*="-NL-"]):not(p[data-style-label$="-NL"]):not(p[data-style-label^="EXER-"][data-style-label*="-NL-"]) + p[data-style-label^="EXER-"][data-style-label*="-NL-"] {
          counter-reset: structured-num-list;
        }

        /* Increment counter for each list item */
        .ProseMirror p[data-style-label^="NL-"],
        .ProseMirror p[data-style-label*="-NL-"],
        .ProseMirror p[data-style-label$="-NL"],
        .ProseMirror p[data-style-label^="EXER-"][data-style-label*="-NL-"] {
          counter-increment: structured-num-list;
        }

        /* Display the counter value */
        .ProseMirror p[data-style-label^="NL-"]::before,
        .ProseMirror p[data-style-label*="-NL-"]::before,
        .ProseMirror p[data-style-label$="-NL"]::before,
        .ProseMirror p[data-style-label^="EXER-"][data-style-label*="-NL-"]::before {
          content: counter(structured-num-list) ". " !important;
          position: absolute !important;
          left: -1rem !important;
          top: 0 !important;
          font-weight: bold !important;
          color: inherit !important;
        }
      `}</style>
      </div>
    );
  }
);

interface CommentCardProps {
  comment: {
    id: string;
    text: string;
    author: string;
    date: string;
    resolved: boolean;
    replies: { text: string; author: string; date: string }[];
  };
  currentUser: string;
  onSaveText: (id: string, text: string) => void;
  onAddReply: (id: string, replyText: string) => void;
  onToggleResolve: (id: string) => void;
  onDelete: (id: string) => void;
}

function CommentCard({
  comment,
  currentUser,
  onSaveText,
  onAddReply,
  onToggleResolve,
  onDelete,
}: CommentCardProps) {
  const [isEditing, setIsEditing] = useState(!comment.text);
  const [editText, setEditText] = useState(comment.text);
  const [replyText, setReplyText] = useState("");

  const handleSave = () => {
    if (!editText.trim()) {
      alert("Comment cannot be empty.");
      return;
    }
    onSaveText(comment.id, editText.trim());
    setIsEditing(false);
  };

  const handleAddReply = () => {
    if (!replyText.trim()) return;
    onAddReply(comment.id, replyText.trim());
    setReplyText("");
  };

  return (
    <div
      className={`bg-slate-900 border text-xs rounded-lg shadow-xl overflow-hidden transition-all duration-200 ${comment.resolved
        ? "border-slate-800 opacity-60 hover:opacity-100"
        : "border-slate-700/80 hover:border-amber-500/50"
        }`}
    >
      {/* Header */}
      <div className="bg-slate-950 px-3 py-2 border-b border-slate-800 flex items-center justify-between">
        <div className="flex flex-col">
          <span className="font-extrabold text-slate-200 truncate max-w-[120px]">
            {comment.author}
          </span>
          <span className="text-[9px] text-slate-500 font-mono">
            {new Date(comment.date).toLocaleDateString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => onToggleResolve(comment.id)}
            className={`p-1 rounded hover:bg-slate-800 transition-colors cursor-pointer border-none bg-transparent ${comment.resolved ? "text-emerald-400" : "text-slate-400 hover:text-emerald-400"
              }`}
            title={comment.resolved ? "Reopen comment" : "Resolve comment"}
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => onDelete(comment.id)}
            className="p-1 text-slate-400 hover:text-rose-400 hover:bg-slate-800 rounded transition-colors cursor-pointer border-none bg-transparent"
            title="Delete comment"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="p-3 space-y-2">
        {isEditing ? (
          <div className="space-y-2">
            <textarea
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              className="w-full min-h-[50px] p-2 bg-slate-800 border border-slate-700 rounded text-xs text-slate-200 focus:outline-none focus:border-amber-500 font-sans"
              placeholder="Write a comment..."
            />
            <div className="flex justify-end gap-1.5">
              {comment.text && (
                <button
                  onClick={() => {
                    setEditText(comment.text);
                    setIsEditing(false);
                  }}
                  className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-[9px] font-bold uppercase cursor-pointer"
                >
                  Cancel
                </button>
              )}
              <button
                onClick={handleSave}
                className="px-2 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded text-[9px] font-bold uppercase cursor-pointer flex items-center gap-1"
              >
                <Save className="w-3 h-3" /> Save
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-1">
            <p
              onClick={() => setIsEditing(true)}
              className="text-slate-200 whitespace-pre-wrap leading-relaxed cursor-pointer hover:bg-slate-850 p-1 rounded font-sans"
              title="Click to edit comment"
            >
              {comment.text}
            </p>
          </div>
        )}

        {/* Replies */}
        {comment.replies.length > 0 && (
          <div className="pt-2 border-t border-slate-800 space-y-2.5 max-h-[150px] overflow-y-auto pr-1">
            {comment.replies.map((reply, index) => (
              <div key={index} className="flex gap-2 items-start pl-1 text-[11px] font-sans">
                <CornerDownRight className="w-3.5 h-3.5 text-slate-500 mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className="font-bold text-slate-300 truncate">{reply.author}</span>
                    <span className="text-[8px] text-slate-500 font-mono">
                      {new Date(reply.date).toLocaleDateString([], { month: "short", day: "numeric" })}
                    </span>
                  </div>
                  <p className="text-slate-400 whitespace-pre-wrap leading-relaxed">{reply.text}</p>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Add Reply Input */}
        {!isEditing && (
          <div className="pt-2 border-t border-slate-800 flex gap-1.5 items-center">
            <input
              type="text"
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAddReply();
              }}
              placeholder="Reply..."
              className="flex-1 px-2.5 py-1 bg-slate-800 border border-slate-700 rounded text-[11px] text-slate-200 focus:outline-none focus:border-amber-500 font-sans"
            />
            <button
              onClick={handleAddReply}
              className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-[9px] font-bold uppercase transition-colors cursor-pointer border-none"
            >
              Reply
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
