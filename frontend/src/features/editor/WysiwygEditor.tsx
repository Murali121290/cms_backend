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
import { TextStyle } from "@tiptap/extension-text-style";
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
  Eye,
  EyeOff,
  Keyboard,
  Plus,
  History as HistoryIcon,
} from "lucide-react";
import { diffWords, diffArrays } from "diff";
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
import { CommentDialog } from "./CommentDialog";
import { useCommentsQuery, useCommentMutations } from "./useComments";
import { SearchReplace } from "./SearchReplace";
import { MathNode } from "./MathNode";
import { SdtBlock } from "./SdtBlock";
import { SdtInline } from "./SdtInline";
import { ImageNode } from "./ImageNode";
import { ImageEditingToolbar } from "./ImageEditingToolbar";
import { ImageEditingProvider, useImageEditing } from "./imageEditingContext";
import katex from "katex";


/**
 * Helpers for the toolbar's eye toggle (review-mode diff overlay).
 */

const IS_MAC = typeof navigator !== "undefined"
  && /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || "");

// Format a Windows-style shortcut string ("Ctrl+Shift+L") for the current
// platform. On macOS swap to ⌘/⇧/⌥/⏎ glyphs so tooltips read like native apps.
const kbd = (combo: string): string => {
  if (!IS_MAC) return combo;
  return combo
    .replace(/Ctrl\+/g, "⌘")
    .replace(/Shift\+/g, "⇧")
    .replace(/Alt\+/g, "⌥")
    .replace(/\bEnter\b/g, "⏎");
};

// Split a Windows-form combo ("Ctrl+Shift+X") into per-key tokens for chip
// rendering. On macOS, modifier names are swapped for their Mac glyphs first
// so each chip ends up as a single symbol.
const splitCombo = (combo: string): string[] => {
  if (!IS_MAC) return combo.split("+");
  const macMap: Record<string, string> = { Ctrl: "⌘", Shift: "⇧", Alt: "⌥", Enter: "⏎" };
  return combo.split("+").map((p) => macMap[p] || p);
};

// Tailwind palette tokens used to tint each shortcut category. Kept in
// expanded form so Tailwind's JIT picks them up.
type SectionAccent = {
  icon: typeof Bold;
  iconWrap: string;     // background + border for the section icon
  iconColor: string;    // icon foreground
  ring: string;         // group hover ring
};

const SHORTCUT_GROUPS: {
  title: string;
  accent: SectionAccent;
  items: { label: string; combo: string }[];
}[] = [
  {
    title: "Text Formatting",
    accent: {
      icon: Bold,
      iconWrap: "bg-indigo-50 border-indigo-100",
      iconColor: "text-indigo-600",
      ring: "hover:ring-indigo-100",
    },
    items: [
      { label: "Bold", combo: "Ctrl+B" },
      { label: "Italic", combo: "Ctrl+I" },
      { label: "Underline", combo: "Ctrl+U" },
      { label: "Strikethrough", combo: "Ctrl+Shift+X" },
      { label: "Superscript", combo: "Ctrl+Shift+=" },
      { label: "Subscript", combo: "Ctrl+=" },
    ],
  },
  {
    title: "Paragraph & Alignment",
    accent: {
      icon: AlignLeft,
      iconWrap: "bg-emerald-50 border-emerald-100",
      iconColor: "text-emerald-600",
      ring: "hover:ring-emerald-100",
    },
    items: [
      { label: "Align Left", combo: "Ctrl+L" },
      { label: "Align Center", combo: "Ctrl+E" },
      { label: "Align Right", combo: "Ctrl+R" },
      { label: "Justify", combo: "Ctrl+J" },
      { label: "Heading 1–6", combo: "Ctrl+Alt+1…6" },
    ],
  },
  {
    title: "Lists",
    accent: {
      icon: List,
      iconWrap: "bg-amber-50 border-amber-100",
      iconColor: "text-amber-600",
      ring: "hover:ring-amber-100",
    },
    items: [
      { label: "Bullet List", combo: "Ctrl+Shift+L" },
      { label: "Numbered List", combo: "Ctrl+Shift+O" },
    ],
  },
  {
    title: "Insert",
    accent: {
      icon: Plus,
      iconWrap: "bg-violet-50 border-violet-100",
      iconColor: "text-violet-600",
      ring: "hover:ring-violet-100",
    },
    items: [
      { label: "Insert / Edit Link", combo: "Ctrl+K" },
      { label: "Insert Table 3×3", combo: "Ctrl+Alt+T" },
      { label: "Insert Page Break", combo: "Ctrl+Enter" },
      { label: "Insert Math Equation", combo: "Ctrl+Alt+E" },
      { label: "Add Comment", combo: "Ctrl+Alt+M" },
    ],
  },
  {
    title: "History",
    accent: {
      icon: HistoryIcon,
      iconWrap: "bg-slate-100 border-slate-200",
      iconColor: "text-slate-600",
      ring: "hover:ring-slate-200",
    },
    items: [
      { label: "Undo", combo: "Ctrl+Z" },
      { label: "Redo", combo: "Ctrl+Y" },
    ],
  },
];

const escapeHtml = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

/**
 * Extract the visible plain text per block from an HTML string. Returns one
 * trimmed string per paragraph / heading / list item, preserving order. Empty
 * blocks are dropped so a stray trailing `<p></p>` introduced by TipTap can't
 * misalign the diff.
 */
function extractParagraphs(html: string): string[] {
  if (!html) return [];
  const doc = new DOMParser().parseFromString(html, "text/html");
  const blocks = Array.from(
    doc.body.querySelectorAll("p, h1, h2, h3, h4, h5, h6, li"),
  );
  const lines = blocks.map((el) => (el.textContent || "").replace(/\s+/g, " ").trim());
  // If the parser produced no block-level children (e.g. raw text), fall back
  // to the whole body text content.
  if (lines.length === 0) {
    const body = (doc.body.textContent || "").replace(/\s+/g, " ").trim();
    return body ? [body] : [];
  }
  return lines.filter((l) => l.length > 0);
}

/**
 * Build the read-only review HTML by diffing two paragraph lists.
 *
 * Strategy:
 *   1. Align paragraphs via `diffArrays` so wholesale insertions/deletions
 *      don't cascade. A removed paragraph followed by an added paragraph is
 *      treated as a paragraph EDIT and word-diffed against each other.
 *   2. Pure additions render as <ins class="rv-ins">…</ins>.
 *   3. Pure removals render as <del class="rv-del">…</del>.
 *   4. Equal paragraphs render as plain text.
 *
 * Result: removed words are red strikethrough, added words are green
 * highlight, unchanged content stays neutral.
 */
function buildReviewHtml(originalParas: string[], currentParas: string[]): string {
  const aligned = diffArrays(originalParas, currentParas);
  const out: string[] = [];

  for (let i = 0; i < aligned.length; i++) {
    const part = aligned[i];
    const next = aligned[i + 1];

    // Paragraph edits: a "removed" group immediately followed by an "added"
    // group represents lines whose text changed. Word-diff each pair so the
    // user sees individual replacements like "the ~~new~~ old change".
    if (part.removed && next && next.added) {
      const oldLines = part.value;
      const newLines = next.value;
      const len = Math.max(oldLines.length, newLines.length);
      for (let j = 0; j < len; j++) {
        const a = oldLines[j] ?? "";
        const b = newLines[j] ?? "";
        if (a === b) {
          out.push(`<p>${escapeHtml(a) || "&nbsp;"}</p>`);
        } else if (!a) {
          out.push(`<p><ins class="rv-ins">${escapeHtml(b)}</ins></p>`);
        } else if (!b) {
          out.push(`<p><del class="rv-del">${escapeHtml(a)}</del></p>`);
        } else {
          const words = diffWords(a, b);
          const inner = words
            .map((w) => {
              const t = escapeHtml(w.value);
              if (w.added) return `<ins class="rv-ins">${t}</ins>`;
              if (w.removed) return `<del class="rv-del">${t}</del>`;
              return t;
            })
            .join("");
          out.push(`<p>${inner || "&nbsp;"}</p>`);
        }
      }
      i++; // consume the paired "added" part
      continue;
    }

    if (part.added) {
      for (const line of part.value) {
        out.push(`<p><ins class="rv-ins">${escapeHtml(line) || "&nbsp;"}</ins></p>`);
      }
    } else if (part.removed) {
      for (const line of part.value) {
        out.push(`<p><del class="rv-del">${escapeHtml(line) || "&nbsp;"}</del></p>`);
      }
    } else {
      for (const line of part.value) {
        out.push(`<p>${escapeHtml(line) || "&nbsp;"}</p>`);
      }
    }
  }

  return out.join("") || "<p>&nbsp;</p>";
}


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

import { Node as TiptapNode, Extension } from "@tiptap/core";

// Register list shortcuts through Tiptap/prosemirror-keymap (same mechanism
// used by Bold/Italic/etc.) instead of a DOM-level keydown listener. This
// avoids two problems: (1) racing with Tiptap's default Mod-Shift-7 binding
// for OrderedList — the DOM listener fired AFTER Tiptap's keymap and
// double-toggled the list — and (2) browser-level Mod-Shift-O capture
// (Chrome's Bookmark Manager) that sometimes beats DOM listeners.
const CustomListShortcuts = Extension.create({
  name: "customListShortcuts",
  addKeyboardShortcuts() {
    return {
      "Mod-Shift-o": () => this.editor.chain().focus().toggleOrderedList().run(),
      "Mod-Shift-l": () => this.editor.chain().focus().toggleBulletList().run(),
    };
  },
});

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
  toolbarExtras?: React.ReactNode;
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

// Scales the document card by the current image-editor view zoom (100% by
// default; adjusted by the Zoom In/Out buttons in the image toolbar). Zoom is
// view-only and never touches persisted image dimensions.
function EditorZoomWrapper({ children }: { children: React.ReactNode }) {
  const { viewZoom } = useImageEditing();
  return (
    <div
      style={{
        transform: `scale(${viewZoom})`,
        transformOrigin: "top center",
        transition: "transform 120ms ease",
      }}
    >
      {children}
    </div>
  );
}

export interface WysiwygEditorHandle {
  editor: any; // TipTap Editor instance
  triggerCommentDialog: () => void;
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
      toolbarExtras,
    }: WysiwygEditorProps,
    ref
  ) {
    const [tcEnabled, setTcEnabled] = useState(trackChangesEnabled);
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
    // Keyboard shortcuts dialog
    const [showShortcuts, setShowShortcuts] = useState(false);
    const [shortcutQuery, setShortcutQuery] = useState("");
    // Review-mode toggle (eye icon): when ON, swap the editor for a read-only
    // inline diff of the originally-loaded content vs the user's current edits.
    // Turning it OFF restores the editable HTML the user was last working with.
    // The baseline is stored as an array of plain-text paragraphs so the
    // comparison can never drift from TipTap's HTML re-serialisation quirks.
    const [reviewMode, setReviewMode] = useState(false);
    const originalParagraphsRef = useRef<string[]>([]);
    const preReviewHtmlRef = useRef<string>("");
    // Color picker refs
    const textColorRef = useRef<HTMLInputElement>(null);
    const highlightColorRef = useRef<HTMLInputElement>(null);
    // Track whether content has been initialised to avoid skipping loads
    const contentInitialised = useRef(false);

    // Comments: server-persisted via the backend; the editor only owns the
    // dialog state. `fileId` here is a string-or-undefined prop, so we coerce
    // to number for the hook.
    const numericFileId = fileId ? Number(fileId) : null;
    const commentsQuery = useCommentsQuery(Number.isFinite(numericFileId) ? numericFileId : null);
    const commentMutations = useCommentMutations(Number.isFinite(numericFileId) ? numericFileId : null);
    const comments: Record<string, any> = (commentsQuery.data ?? []).reduce(
      (acc, c) => {
        acc[c.comment_uuid] = c;
        return acc;
      },
      {} as Record<string, any>,
    );
    const [commentPositions, setCommentPositions] = useState<Record<string, number>>({});
    const [commentDialog, setCommentDialog] = useState<
      | { mode: "create"; commentUuid: string; quotedText: string }
      | { mode: "edit"; commentUuid: string; initialText: string; quotedText: string }
      | null
    >(null);
    const [currentFontSize, setCurrentFontSize] = useState("default");
    const [currentFontFamily, setCurrentFontFamily] = useState("default");
    // Position of the selected image node (NodeSelection), or null when the
    // selection is in text. Drives the context-aware toolbar swap.
    const [selectedImagePos, setSelectedImagePos] = useState<number | null>(null);

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
        TextStyle,
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
        ImageNode,
        CustomListShortcuts,
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

    const prevInitialContentRef = useRef<string | null>(null);

    // ── Image selection tracking ────────────────────────────────────────────
    // Watches ProseMirror selection changes; when the user clicks (or arrows
    // into) an image node, `selectedImagePos` becomes that node's position and
    // the toolbar swaps to image-editing mode. Any other selection clears it.
    useEffect(() => {
      if (!editor) return;
      const sync = () => {
        const sel = editor.state.selection as unknown as {
          node?: { type: { name: string } };
          from: number;
        };
        if (sel.node && sel.node.type.name === "image") {
          setSelectedImagePos(sel.from);
        } else {
          setSelectedImagePos(null);
        }
      };
      sync();
      editor.on("selectionUpdate", sync);
      editor.on("transaction", sync);
      return () => {
        editor.off("selectionUpdate", sync);
        editor.off("transaction", sync);
      };
    }, [editor]);

    const handleExitImageMode = useCallback(() => {
      if (!editor || selectedImagePos == null) return;
      const target = Math.min(
        editor.state.doc.content.size,
        selectedImagePos + 1,
      );
      editor.chain().focus().setTextSelection(target).run();
    }, [editor, selectedImagePos]);

    // Initialize content or update when parent provides new content (e.g. after apply)
    useEffect(() => {
      if (editor && initialContent && initialContent !== prevInitialContentRef.current) {
        prevInitialContentRef.current = initialContent;
        contentInitialised.current = true;
        editor.commands.setContent(initialContent);
        // Snapshot the baseline as plain-text paragraphs straight from the
        // initialContent prop. We deliberately do NOT use editor.getHTML()
        // here — at this moment TipTap has just finished setContent and a
        // delayed normalisation pass can still alter what getHTML returns,
        // causing the very first eye-toggle to paint the whole tail of the
        // document as "inserted". Reading the raw initialContent + extracting
        // paragraph text is deterministic and immune to that race.
        originalParagraphsRef.current = extractParagraphs(initialContent);
        setIsDirty(false);
      }
    }, [editor, initialContent]);

    // Eye toggle: switch between editable current view and read-only diff view.
    // setContent uses { emitUpdate: false } so the toggle never flags the
    // document as dirty or fires onContentChange.
    const handleToggleReviewMode = useCallback(() => {
      if (!editor) return;
      if (!reviewMode) {
        preReviewHtmlRef.current = editor.getHTML();
        const currentParas = extractParagraphs(preReviewHtmlRef.current);
        const diffHtml = buildReviewHtml(originalParagraphsRef.current, currentParas);
        editor.setEditable(false);
        editor.commands.setContent(diffHtml, { emitUpdate: false });
      } else {
        editor.commands.setContent(preReviewHtmlRef.current || editor.getHTML(), { emitUpdate: false });
        editor.setEditable(true);
      }
      setReviewMode((on) => !on);
    }, [editor, reviewMode]);

    // Handle track changes. The TrackChanges plugin reads storage via the editor's
    // shared storage map (editor.storage.trackChanges) — that's the live, mutable
    // reference the plugin's closure sees. Mutating storage through an extension
    // instance pulled from extensionManager does not propagate, because that path
    // returns a fresh object on each access.
    useEffect(() => {
      if (editor) {
        const store = (editor as any).storage?.trackChanges;
        if (store) {
          store.enabled = tcEnabled;
          if (onTrackChangesToggle) {
            onTrackChangesToggle(tcEnabled);
          }
        }
      }
    }, [tcEnabled, editor, onTrackChangesToggle]);

    // Handle track changes author
    useEffect(() => {
      if (editor) {
        const store = (editor as any).storage?.trackChanges;
        if (store) {
          store.author = currentUser || "Unknown";
        }
      }
    }, [currentUser, editor]);

    // Update heading level, font size, font family, and charStyle on selection updates
    useEffect(() => {
      if (editor) {
        const updateSelectionStates = () => {
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

    // Click on an inline comment highlight → open the edit dialog. Attached to
    // the ProseMirror DOM so it works regardless of which paragraph the mark
    // lands in.
    useEffect(() => {
      if (!editor) return;
      const dom = editor.view.dom as HTMLElement;
      const handle = (e: MouseEvent) => {
        const target = (e.target as HTMLElement | null)?.closest?.("span[data-comment-id]") as HTMLElement | null;
        if (!target) return;
        const uuid = target.getAttribute("data-comment-id");
        if (!uuid) return;
        const existing = comments[uuid];
        setCommentDialog({
          mode: "edit",
          commentUuid: uuid,
          initialText: existing?.text ?? "",
          quotedText: (target.textContent || "").trim(),
        });
      };
      dom.addEventListener("click", handle);
      return () => dom.removeEventListener("click", handle);
    }, [editor, comments]);

    const searchResults = (editor?.storage as any)?.searchReplace?.results || [];
    const activeSearchIndex = (editor?.storage as any)?.searchReplace?.activeIndex ?? -1;
    const searchMatchCount = searchResults.length;
    const currentSearchMatch = searchMatchCount > 0 ? activeSearchIndex + 1 : 0;

    // Open the comment-creation dialog from whatever is selected in the
    // editor. Used by both the in-toolbar button and the page-level
    // CommentsPanel (via the ref), so both entry points behave identically.
    const openCommentDialog = useCallback(() => {
      if (!editor) return;
      // Make sure the editor has focus so the selection is current.
      editor.commands.focus();
      const { empty, from, to } = editor.state.selection;
      if (empty) {
        alert("Please select some text to comment on.");
        return;
      }
      if (!Number.isFinite(numericFileId)) {
        alert("Cannot add comments until the file is loaded.");
        return;
      }
      const quoted = editor.state.doc.textBetween(from, to, " ").trim();
      const commentId = crypto.randomUUID();
      setCommentDialog({ mode: "create", commentUuid: commentId, quotedText: quoted });
    }, [editor, numericFileId]);

    // Expose editor instance + imperative comment trigger to parent via ref
    useImperativeHandle(
      ref,
      () => ({ editor: editor as any, triggerCommentDialog: openCommentDialog }),
      [editor, openCommentDialog],
    );

    // ── Keyboard shortcuts ───────────────────────────────────────────────────
    // Listener is attached to editor.view.dom so it only fires while the
    // editor itself has keyboard focus (matches the "shortcuts work only when
    // editor is focused" requirement). Mod = Ctrl on Win/Linux, Cmd on macOS.
    useEffect(() => {
      if (!editor) return;
      const dom = editor.view.dom as HTMLElement;

      const onKeyDown = (e: KeyboardEvent) => {
        const mod = e.ctrlKey || e.metaKey;
        if (!mod) return;
        // Use e.code (physical key) instead of e.key: on macOS Option+letter
        // produces special characters (Alt+T = "†", Alt+M = "µ", Alt+E = "´"),
        // so e.key never matches "t"/"m"/"e". e.code stays "KeyT" / "KeyM" /
        // "KeyE" regardless of modifiers or keyboard layout.
        const code = e.code;
        const fire = (fn: () => void) => { e.preventDefault(); e.stopPropagation(); fn(); };

        // Mod + key (no Shift / Alt)
        if (!e.shiftKey && !e.altKey) {
          switch (code) {
            case "KeyL": return fire(() => editor.chain().focus().setTextAlign("left").run());
            case "KeyE": return fire(() => editor.chain().focus().setTextAlign("center").run());
            case "KeyR": return fire(() => editor.chain().focus().setTextAlign("right").run());
            case "KeyJ": return fire(() => editor.chain().focus().setTextAlign("justify").run());
            case "KeyK": return fire(() => {
              const existing = editor.getAttributes("link")?.href || "";
              setLinkUrl(existing);
              setShowLinkDialog(true);
            });
            case "Enter":
            case "NumpadEnter": return fire(() =>
              editor.chain().focus().insertContent({ type: "pageBreak" }).run()
            );
            case "Equal": return fire(() => editor.chain().focus().toggleSubscript().run());
          }
        }

        // Mod + Shift + key
        // Note: bullet/ordered list shortcuts (Mod-Shift-L / Mod-Shift-O) are
        // registered via the CustomListShortcuts Tiptap extension instead of
        // here — going through prosemirror-keymap is more reliable and
        // avoids racing with Tiptap's own Mod-Shift-7 / Mod-Shift-8 defaults.
        if (e.shiftKey && !e.altKey) {
          switch (code) {
            case "KeyX": return fire(() => editor.chain().focus().toggleStrike().run());
            case "Equal": return fire(() => editor.chain().focus().toggleSuperscript().run());
          }
        }

        // Mod + Alt + key
        if (e.altKey && !e.shiftKey) {
          switch (code) {
            case "KeyT": return fire(() =>
              editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
            );
            case "KeyM": return fire(() => openCommentDialog());
            case "KeyE": return fire(() =>
              (editor.chain().focus() as any).insertMathNode("x^2 + y^2 = z^2").run()
            );
          }
        }
      };

      dom.addEventListener("keydown", onKeyDown);
      return () => dom.removeEventListener("keydown", onKeyDown);
    }, [editor, openCommentDialog]);

    const handleToggleTrackChanges = () => setTcEnabled(!tcEnabled);

    // Convert client-only LaTeX spans to MathML on save. Comment spans
    // (`span[data-comment-id]`) are intentionally preserved so the backend
    // can pair each highlighted range with its metadata when generating DOCX.
    function convertMathForSave(html: string): string {
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, "text/html");

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
        const cleanHtml = convertMathForSave(html);
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
      <ImageEditingProvider>
      <div className="flex flex-col bg-[#e8e8e8] w-full" style={{ height }}>

        {/* Comment dialog (modal, fixed position) */}
        {commentDialog && (
          <CommentDialog
            open
            mode={commentDialog.mode}
            author={currentUser}
            quotedText={commentDialog.quotedText}
            initialText={commentDialog.mode === "edit" ? commentDialog.initialText : ""}
            onCancel={() => setCommentDialog(null)}
            onSubmit={(text) => {
              const uuid = commentDialog.commentUuid;
              if (commentDialog.mode === "create") {
                editor?.chain().focus().addComment(uuid).run();
                commentMutations.create.mutate({ commentUuid: uuid, text });
              } else {
                commentMutations.update.mutate({ commentUuid: uuid, text });
              }
              setCommentDialog(null);
            }}
            onDelete={
              commentDialog.mode === "edit"
                ? () => {
                  const uuid = commentDialog.commentUuid;
                  editor?.chain().focus().removeComment(uuid).run();
                  commentMutations.remove.mutate({ commentUuid: uuid });
                  setCommentDialog(null);
                }
                : undefined
            }
          />
        )}

        {/* â”€â”€ Toolbar â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
        <div className="sticky top-0 z-10 bg-[#090d16] border-b border-slate-800 px-3 py-2 flex items-center gap-1.5 overflow-x-auto shadow-md flex-wrap transition-colors duration-150">
          {selectedImagePos !== null ? (
            <ImageEditingToolbar
              editor={editor}
              imagePos={selectedImagePos}
              onExit={handleExitImageMode}
            />
          ) : (<>

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
          <ToolbarButton active={editor?.isActive("bold")} onClick={() => editor?.chain().focus().toggleBold().run()} title={`Bold (${kbd("Ctrl+B")})`}>
            <Bold className="w-4 h-4" />
          </ToolbarButton>
          <ToolbarButton active={editor?.isActive("italic")} onClick={() => editor?.chain().focus().toggleItalic().run()} title={`Italic (${kbd("Ctrl+I")})`}>
            <Italic className="w-4 h-4" />
          </ToolbarButton>
          <ToolbarButton active={editor?.isActive("underline")} onClick={() => editor?.chain().focus().toggleUnderline().run()} title={`Underline (${kbd("Ctrl+U")})`}>
            <Type className="w-4 h-4" />
          </ToolbarButton>
          <ToolbarButton active={editor?.isActive("strike")} onClick={() => editor?.chain().focus().toggleStrike().run()} title={`Strikethrough (${kbd("Ctrl+Shift+X")})`}>
            <Strikethrough className="w-4 h-4" />
          </ToolbarButton>
          <ToolbarButton active={editor?.isActive("superscript")} onClick={() => editor?.chain().focus().toggleSuperscript().run()} title={`Superscript (${kbd("Ctrl+Shift+=")})`}>
            <SuperscriptIcon className="w-4 h-4" />
          </ToolbarButton>
          <ToolbarButton active={editor?.isActive("subscript")} onClick={() => editor?.chain().focus().toggleSubscript().run()} title={`Subscript (${kbd("Ctrl+=")})`}>
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
          <ToolbarButton active={editor?.isActive({ textAlign: "left" })} onClick={() => editor?.chain().focus().setTextAlign("left").run()} title={`Align Left (${kbd("Ctrl+L")})`}>
            <AlignLeft className="w-4 h-4" />
          </ToolbarButton>
          <ToolbarButton active={editor?.isActive({ textAlign: "center" })} onClick={() => editor?.chain().focus().setTextAlign("center").run()} title={`Align Center (${kbd("Ctrl+E")})`}>
            <AlignCenter className="w-4 h-4" />
          </ToolbarButton>
          <ToolbarButton active={editor?.isActive({ textAlign: "right" })} onClick={() => editor?.chain().focus().setTextAlign("right").run()} title={`Align Right (${kbd("Ctrl+R")})`}>
            <AlignRight className="w-4 h-4" />
          </ToolbarButton>
          <ToolbarButton active={editor?.isActive({ textAlign: "justify" })} onClick={() => editor?.chain().focus().setTextAlign("justify").run()} title={`Justify (${kbd("Ctrl+J")})`}>
            <AlignJustify className="w-4 h-4" />
          </ToolbarButton>

          <ToolbarDivider />

          {/* Lists */}
          <ToolbarButton active={editor?.isActive("bulletList")} onClick={() => editor?.chain().focus().toggleBulletList().run()} title={`Bullet List (${kbd("Ctrl+Shift+L")})`}>
            <List className="w-4 h-4" />
          </ToolbarButton>
          <ToolbarButton active={editor?.isActive("orderedList")} onClick={() => editor?.chain().focus().toggleOrderedList().run()} title={`Numbered List (${kbd("Ctrl+Shift+O")})`}>
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
          <ToolbarButton onClick={() => editor?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()} title={`Insert Table 3×3 (${kbd("Ctrl+Alt+T")})`}>
            <Table2 className="w-4 h-4" />
          </ToolbarButton>

          {/* Insert Page Break */}
          <ToolbarButton onClick={() => editor?.chain().focus().insertContent({ type: 'pageBreak' }).run()} title={`Insert Page Break (${kbd("Ctrl+Enter")})`}>
            <SeparatorHorizontal className="w-4 h-4 text-emerald-400" />
          </ToolbarButton>

          {/* Table Tools (Only visible when cursor is inside a table) */}
          {editor?.isActive("table") && (
            <>
              <ToolbarDivider />
              <div className="flex items-center gap-1 bg-[#131b2e] border border-slate-700/60 rounded-md p-0.5" title="Table Tools">
                <button onClick={() => editor.chain().focus().addRowBefore().run()} className="px-1.5 py-1 hover:bg-slate-800 text-[10px] font-bold text-slate-200 rounded" title="Insert Row Above">+ Row Above</button>
                <button onClick={() => editor.chain().focus().addRowAfter().run()} className="px-1.5 py-1 hover:bg-slate-800 text-[10px] font-bold text-slate-200 rounded" title="Insert Row Below">+ Row Below</button>
                <div className="w-px h-3.5 bg-slate-800" />
                <button onClick={() => editor.chain().focus().addColumnBefore().run()} className="px-1.5 py-1 hover:bg-slate-800 text-[10px] font-bold text-slate-200 rounded" title="Insert Column Left">+ Col Left</button>
                <button onClick={() => editor.chain().focus().addColumnAfter().run()} className="px-1.5 py-1 hover:bg-slate-800 text-[10px] font-bold text-slate-200 rounded" title="Insert Column Right">+ Col Right</button>
                <div className="w-px h-3.5 bg-slate-800" />
                <button onClick={() => editor.chain().focus().mergeCells().run()} className="p-1 hover:bg-slate-800 text-[10px] font-bold text-slate-200 rounded" title="Merge Cells">Merge</button>
                <button onClick={() => editor.chain().focus().splitCell().run()} className="p-1 hover:bg-slate-800 text-[10px] font-bold text-slate-200 rounded" title="Split Cell">Split</button>
                <div className="w-px h-3.5 bg-slate-800" />
                <button onClick={() => editor.chain().focus().deleteRow().run()} className="px-1.5 py-1 hover:bg-slate-800 text-[10px] font-bold text-rose-400 rounded" title="Delete Row">Delete Row</button>
                <button onClick={() => editor.chain().focus().deleteColumn().run()} className="px-1.5 py-1 hover:bg-slate-800 text-[10px] font-bold text-rose-400 rounded" title="Delete Column">Delete Col</button>
                <button onClick={() => editor.chain().focus().deleteTable().run()} className="px-1.5 py-1 hover:bg-slate-850 text-[10px] font-bold text-rose-500 rounded" title="Delete Table">Delete Table</button>
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
            title={`Insert / Remove Link (${kbd("Ctrl+K")})`}
          >
            <LinkIcon className="w-4 h-4" />
          </ToolbarButton>

          <ToolbarDivider />

          {/* History */}
          <ToolbarButton onClick={() => editor?.chain().focus().undo().run()} disabled={!editor?.can().undo()} title={`Undo (${kbd("Ctrl+Z")})`}>
            <Undo className="w-4 h-4" />
          </ToolbarButton>
          <ToolbarButton onClick={() => editor?.chain().focus().redo().run()} disabled={!editor?.can().redo()} title={`Redo (${kbd("Ctrl+Y")})`}>
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

          {/* Add Comment Button — opens the dialog; the Tiptap mark and the
              backend record are only created once the user submits text. */}
          <ToolbarButton
            onClick={openCommentDialog}
            title={`Add Comment on selection (${kbd("Ctrl+Alt+M")})`}
          >
            <MessageSquare className="w-4 h-4 text-sky-400" />
          </ToolbarButton>

          {/* Insert Equation Button */}
          <ToolbarButton
            onClick={() => {
              if (!editor) return;
              editor.chain().focus().insertMathNode("x^2 + y^2 = z^2").run();
            }}
            title={`Insert Math Equation (${kbd("Ctrl+Alt+E")})`}
          >
            <Sigma className="w-4 h-4 text-amber-500" />
          </ToolbarButton>

          {/* Keyboard Shortcuts Reference */}
          <ToolbarButton
            onClick={() => setShowShortcuts(true)}
            title="Keyboard Shortcuts"
          >
            <Keyboard className="w-4 h-4" />
          </ToolbarButton>

          <ToolbarDivider />

          {/* Review-mode (compare with original) Toggle */}
          <button
            onClick={handleToggleReviewMode}
            className={`p-1.5 rounded-md transition-all duration-150 border shrink-0 ${
              reviewMode
                ? "bg-sky-950/40 text-sky-300 border-sky-800/80 shadow-sm"
                : "bg-slate-900 text-slate-400 border-slate-800 hover:bg-slate-800 hover:text-slate-200"
            }`}
            title={
              reviewMode
                ? "Reviewing changes vs. original — click to return to current view"
                : "Show changes vs. original (review mode)"
            }
            aria-pressed={reviewMode}
          >
            {reviewMode ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
          </button>

          {/* Track Changes Toggle */}
          <button
            onClick={handleToggleTrackChanges}
            disabled={reviewMode}
            className={`px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider rounded-md transition-all duration-150 border shrink-0 ${tcEnabled
              ? "bg-emerald-950/40 text-emerald-400 border-emerald-800/80 shadow-sm"
              : "bg-slate-900 text-slate-400 border-slate-800 hover:bg-slate-800 hover:text-slate-200"
              } ${reviewMode ? "opacity-40 cursor-not-allowed" : ""}`}
            title={reviewMode ? "Track Changes is disabled in review mode" : "Toggle Track Changes"}
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

          {toolbarExtras && (
            <div className="ml-auto flex items-center gap-1.5 shrink-0 pl-2">
              {toolbarExtras}
            </div>
          )}
          </>)}
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

        {/* ── Keyboard Shortcuts Dialog ──────────────────────────────────────── */}
        {showShortcuts && (() => {
          const q = shortcutQuery.trim().toLowerCase();
          const filtered = SHORTCUT_GROUPS
            .map((g) => ({
              ...g,
              items: q
                ? g.items.filter(
                    (it) =>
                      it.label.toLowerCase().includes(q) ||
                      it.combo.toLowerCase().includes(q),
                  )
                : g.items,
            }))
            .filter((g) => g.items.length > 0);
          const totalCount = SHORTCUT_GROUPS.reduce((s, g) => s + g.items.length, 0);
          const close = () => { setShowShortcuts(false); setShortcutQuery(""); };
          return (
            <div
              className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-md animate-in fade-in duration-150"
              onClick={close}
              onKeyDown={(e) => { if (e.key === "Escape") close(); }}
              role="dialog"
              aria-modal="true"
              aria-label="Keyboard shortcuts"
            >
              <div
                className="relative w-[780px] max-w-full max-h-[88vh] flex flex-col bg-white rounded-2xl shadow-[0_30px_80px_-20px_rgba(15,23,42,0.45)] border border-slate-200/80 overflow-hidden animate-in fade-in zoom-in-95 duration-200"
                onClick={(e) => e.stopPropagation()}
              >
                {/* Header */}
                <div className="relative px-6 pt-5 pb-4 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white">
                  <div className="absolute inset-0 opacity-[0.07] pointer-events-none"
                       style={{ backgroundImage: "radial-gradient(circle at 1px 1px, white 1px, transparent 0)", backgroundSize: "16px 16px" }} />
                  <div className="relative flex items-start justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-white/10 border border-white/15 flex items-center justify-center backdrop-blur-sm">
                        <Keyboard className="w-5 h-5 text-amber-300" />
                      </div>
                      <div>
                        <h2 className="text-base font-bold tracking-tight">Keyboard Shortcuts</h2>
                        <p className="text-[11px] text-slate-300/90 mt-0.5">
                          {totalCount} shortcuts · works while the editor is focused
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={close}
                      className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-300 hover:text-white hover:bg-white/10 transition-colors"
                      aria-label="Close"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Search */}
                  <div className="relative mt-4">
                    <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      autoFocus
                      type="text"
                      value={shortcutQuery}
                      onChange={(e) => setShortcutQuery(e.target.value)}
                      placeholder="Search shortcuts…"
                      className="w-full pl-9 pr-9 py-2 text-xs bg-white/95 text-slate-800 rounded-lg border border-white/20 focus:outline-none focus:ring-2 focus:ring-amber-400/60 placeholder-slate-400 shadow-inner"
                    />
                    {shortcutQuery && (
                      <button
                        onClick={() => setShortcutQuery("")}
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-slate-400 hover:text-slate-700 rounded"
                        aria-label="Clear search"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Body */}
                <div className="flex-1 overflow-y-auto p-6 bg-slate-50/50">
                  {filtered.length === 0 ? (
                    <div className="text-center py-12 text-slate-400 text-xs">
                      No shortcuts match <span className="font-semibold text-slate-600">"{shortcutQuery}"</span>.
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {filtered.map((group) => {
                        const Icon = group.accent.icon;
                        return (
                          <section
                            key={group.title}
                            className={`bg-white border border-slate-200/70 rounded-xl p-4 shadow-sm hover:shadow-md transition-shadow ring-1 ring-transparent ${group.accent.ring}`}
                          >
                            <header className="flex items-center gap-2.5 mb-3 pb-2 border-b border-slate-100">
                              <div className={`w-7 h-7 rounded-lg border flex items-center justify-center ${group.accent.iconWrap}`}>
                                <Icon className={`w-3.5 h-3.5 ${group.accent.iconColor}`} />
                              </div>
                              <h3 className="text-[12px] font-bold text-slate-800 tracking-tight">
                                {group.title}
                              </h3>
                              <span className="ml-auto text-[10px] font-semibold text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded-full">
                                {group.items.length}
                              </span>
                            </header>
                            <ul className="space-y-1">
                              {group.items.map((item) => {
                                const parts = splitCombo(item.combo);
                                return (
                                  <li
                                    key={item.label}
                                    className="group flex items-center justify-between gap-3 px-2 py-1.5 rounded-md hover:bg-slate-50 transition-colors"
                                  >
                                    <span className="text-[12px] text-slate-700 group-hover:text-slate-900 truncate">
                                      {item.label}
                                    </span>
                                    <span className="inline-flex items-center gap-1 shrink-0">
                                      {parts.map((p, i) => (
                                        <span key={i} className="inline-flex items-center gap-1">
                                          {i > 0 && !IS_MAC && (
                                            <span className="text-[10px] text-slate-400 font-medium">+</span>
                                          )}
                                          <kbd className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 bg-gradient-to-b from-white to-slate-50 border border-slate-300 rounded-md text-[10.5px] font-mono font-semibold text-slate-700 shadow-[0_1px_0_rgba(15,23,42,0.08),inset_0_-1px_0_rgba(15,23,42,0.04)]">
                                            {p}
                                          </kbd>
                                        </span>
                                      ))}
                                    </span>
                                  </li>
                                );
                              })}
                            </ul>
                          </section>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Footer */}
                <div className="px-6 py-3 border-t border-slate-200 bg-white flex items-center justify-between text-[11px] text-slate-500">
                  <div className="flex items-center gap-1.5">
                    <span>Press</span>
                    <kbd className="inline-flex items-center justify-center px-1.5 h-[20px] bg-slate-100 border border-slate-300 rounded text-[10px] font-mono font-semibold text-slate-700">Esc</kbd>
                    <span>to close</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-slate-400">
                    <span>{IS_MAC ? "macOS" : "Windows / Linux"} bindings</span>
                  </div>
                </div>
              </div>
            </div>
          );
        })()}

        {/* â”€â”€ Document Area â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
        <div className="flex-1 overflow-y-auto bg-gradient-to-tr from-slate-200 to-slate-100 px-6 py-6 pb-20 flex items-start justify-center overflow-x-auto">
          <EditorZoomWrapper>
          <div className={sidePanel ? "flex gap-6 max-w-[1400px] justify-start lg:justify-center" : "flex justify-center"}>
            {/* Word-style A4 Document Page — fixed width so it looks like a
                physical sheet on the canvas, regardless of viewport width. */}
            <div
              className="bg-white text-sm transition-shadow duration-300 relative shrink-0"
              style={{
                fontFamily: "'Times New Roman', Times, serif",
                lineHeight: "2",
                width: "8.27in",          // A4 width (210mm)
                minHeight: "11.69in",     // A4 height (297mm)
                padding: "1in 1in",       // Word default margins
                boxShadow: "0 4px 20px rgba(0,0,0,0.08), 0 12px 36px rgba(0,0,0,0.06)",
                border: "1px solid rgba(203, 213, 225, 0.9)",
                overflow: "visible",
                borderRadius: "2px",
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
                      <span className="px-1.5 py-0.5 bg-slate-800 text-blue-400 rounded text-[9px] font-mono">
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
                            ? "bg-blue-600 text-white font-bold"
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
                        className="w-full px-2 py-1.5 bg-slate-900 border border-slate-700/60 rounded text-xs text-slate-200 focus:outline-none focus:border-blue-500 placeholder-slate-500 font-semibold"
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
              {/* Comments managed via Comments popover in toolbar + click dialog;
                  old margin rail retired (its disclaimer was stale once Phase 2
                  wired comments into DOCX export). */}
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
          </EditorZoomWrapper>
        </div>

        {/* â”€â”€ Save Bar â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
        <div className="fixed bottom-0 left-0 right-0 z-30 border-t border-slate-200 bg-white/95 backdrop-blur-sm px-6 py-3 flex items-center gap-3 shadow-[0_-2px_12px_rgba(15,23,42,0.08)]">
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
        /* ── Review mode (eye toggle) — original vs current diff overlay ───── */
        .rv-del {
          background-color: rgba(239, 68, 68, 0.12);
          color: rgb(153, 27, 27);
          text-decoration: line-through;
          text-decoration-color: rgb(220, 38, 38);
          padding: 1px 3px;
          border-radius: 2px;
        }
        .rv-ins {
          background-color: rgba(16, 185, 129, 0.16);
          color: rgb(6, 95, 70);
          padding: 1px 3px;
          border-radius: 2px;
        }
        /* Occurrence highlights */
        .occurrence-highlight {
          padding: 1px 3px !important;
          border-radius: 2px !important;
          cursor: pointer !important;
          transition: all 0.18s ease-in-out !important;
          background-color: rgba(249, 115, 22, 0.20) !important;
          border-bottom: 2px solid rgba(249, 115, 22, 0.85) !important;
          color: inherit !important;
        }

        .occurrence-highlight:hover {
          background-color: rgba(249, 115, 22, 0.3) !important;
        }

        /* --- Active Selection (Vivid Focus Pulsating Highlights) --- */
        @keyframes green-highlight-pulse {
          0% { box-shadow: 0 0 0 2px rgba(34, 197, 94, 0.3); }
          50% { box-shadow: 0 0 0 5px rgba(34, 197, 94, 0.55); }
          100% { box-shadow: 0 0 0 2px rgba(34, 197, 94, 0.3); }
        }

        .occurrence-highlight-selected {
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
          left: -0.95in !important;
          top: 0.35rem !important;
          width: 0.85in !important;
          text-align: center !important;
          padding: 0.15rem 0.35rem !important;
          font-size: 0.6rem !important;
          font-weight: 700 !important;
          background-color: rgba(59, 130, 246, 0.07) !important;
          border: 1px solid rgba(59, 130, 246, 0.28) !important;
          color: #1d4ed8 !important;
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
          background-color: rgba(59, 130, 246, 0.18) !important;
          border-color: rgba(59, 130, 246, 0.6) !important;
          color: #1e3a8a !important;
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
          background-color: rgba(147, 197, 253, 0.4) !important;
          border-bottom: 2px solid #2563eb !important;
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
      </ImageEditingProvider>
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
