import { useState, useEffect, useRef, useImperativeHandle, forwardRef } from "react";
import { Editor } from "@tinymce/tinymce-react";
import { Save, Loader2, CheckCircle2, MessageSquare, Check, X, CheckCheck, XCircle, FileText, PanelRightClose, PanelRightOpen } from "lucide-react";
import { Button } from "@/components/ui/Button";

export interface TinyMceEditorProps {
  initialContent: string;
  onSave: (html: string) => Promise<void>;
  isSaving?: boolean;
  saveLabel?: string;
  documentTitle?: string;
  height?: string;
  trackChangesEnabled?: boolean;
  onTrackChangesToggle?: (v: boolean) => void;
  onContentChange?: () => void;
  styles?: string[];
  currentUser?: string;
  fileId?: string;
  onAddStyle?: (newStyle: string) => void;
  onSelectionUpdate?: (props: { editor: any }) => void;
  customCss?: string;
}

export interface TinyMceEditorHandle {
  editor: {
    getHTML: () => string;
  };
  triggerCommentDialog: () => void;
}

export interface CommentReply {
  id: string;
  author: string;
  date: string;
  text: string;
}

export interface CommentItem {
  id: string;
  author: string;
  date: string;
  text: string;
  selectedText: string;
  isResolved?: boolean;
  replies?: CommentReply[];
}

export const TinyMceEditor = forwardRef<TinyMceEditorHandle, TinyMceEditorProps>(
  function TinyMceEditor(
    {
      initialContent,
      onSave,
      isSaving = false,
      saveLabel = "Save XHTML",
      documentTitle,
      height = "calc(100vh - 48px)",
      trackChangesEnabled = true,
      onTrackChangesToggle,
      onContentChange,
      styles,
      currentUser = "Compositor",
      customCss = "",
    }: TinyMceEditorProps,
    ref
  ) {
    const [content, setContent] = useState(initialContent);
    const [tcEnabled, setTcEnabled] = useState(trackChangesEnabled);
    const [isDirty, setIsDirty] = useState(false);
    const [savedAt, setSavedAt] = useState<Date | null>(null);
    const [comments, setComments] = useState<CommentItem[]>([]);
    const [activeCommentId, setActiveCommentId] = useState<string | null>(null);
    const [showCommentsSidebar, setShowCommentsSidebar] = useState(true);
    const [isCommentModalOpen, setIsCommentModalOpen] = useState(false);
    const [pendingSelectedText, setPendingSelectedText] = useState("");
    const [commentInputText, setCommentInputText] = useState("");
    const [replyInputMap, setReplyInputMap] = useState<Record<string, string>>({});
    const [commentFilter, setCommentFilter] = useState<"all" | "active" | "resolved">("all");

    const contentRef = useRef(content);
    const editorRef = useRef<any>(null);
    const tcEnabledRef = useRef(tcEnabled);
    const currentUserRef = useRef(currentUser);

    // Sync refs to prevent stale closure issues in TinyMCE event listeners
    useEffect(() => {
      tcEnabledRef.current = tcEnabled;
    }, [tcEnabled]);

    useEffect(() => {
      currentUserRef.current = currentUser;
    }, [currentUser]);

    // Keep contentRef up to date for useImperativeHandle
    useEffect(() => {
      contentRef.current = content;
    }, [content]);

    // Handle initialContent changes
    useEffect(() => {
      setContent(initialContent);
      setIsDirty(false);
    }, [initialContent]);

    // Extract comments from HTML content when loaded
    useEffect(() => {
      if (!initialContent) return;
      try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(initialContent, "text/html");
        const commentMarks = doc.querySelectorAll("mark.doc-comment");
        const extracted: CommentItem[] = [];

        commentMarks.forEach((mark) => {
          const id = mark.getAttribute("data-comment-id") || String(Math.random());
          const author = mark.getAttribute("data-author") || "Reviewer";
          const date = mark.getAttribute("data-date") || new Date().toISOString();
          const text = mark.getAttribute("data-comment") || "Comment on selection";
          const selectedText = mark.textContent || "";
          
          if (!extracted.some(c => c.id === id)) {
            extracted.push({ id, author, date, text, selectedText, isResolved: false, replies: [] });
          }
        });
        setComments(extracted);
      } catch (err) {
        console.error("Failed to parse initial comments:", err);
      }
    }, [initialContent]);

    // Expose the editor.getHTML method via ref
    useImperativeHandle(
      ref,
      () => ({
        editor: {
          getHTML: () => {
            if (editorRef.current) {
              return editorRef.current.getContent();
            }
            return contentRef.current;
          },
        },
        triggerCommentDialog: () => {
          handleOpenCommentModal();
        },
      }),
      []
    );

    const handleSaveClick = async () => {
      const currentHtml = editorRef.current ? editorRef.current.getContent() : content;
      await onSave(currentHtml);
      setIsDirty(false);
      setSavedAt(new Date());
    };

    // Track Changes Acceptance Logic
    const acceptCurrentChange = () => {
      const editor = editorRef.current;
      if (!editor) return;
      const node = editor.selection.getNode();
      const ins = editor.dom.getParent(node, "ins.tc-insert, span.tc-insert");
      const del = editor.dom.getParent(node, "del.tc-delete, span.tc-delete");

      if (ins) {
        editor.dom.remove(ins, true); // Unwrap <ins>/<span> keeping inner text
        editor.nodeChanged();
        editor.undoManager.add();
        setIsDirty(true);
      } else if (del) {
        editor.dom.remove(del); // Remove <del>/<span> entirely
        editor.nodeChanged();
        editor.undoManager.add();
        setIsDirty(true);
      }
    };

    const rejectCurrentChange = () => {
      const editor = editorRef.current;
      if (!editor) return;
      const node = editor.selection.getNode();
      const ins = editor.dom.getParent(node, "ins.tc-insert, span.tc-insert");
      const del = editor.dom.getParent(node, "del.tc-delete, span.tc-delete");

      if (ins) {
        editor.dom.remove(ins); // Remove inserted text
        editor.nodeChanged();
        editor.undoManager.add();
        setIsDirty(true);
      } else if (del) {
        editor.dom.remove(del, true); // Unwrap <del>/<span> restoring text
        editor.nodeChanged();
        editor.undoManager.add();
        setIsDirty(true);
      }
    };

    const acceptAllChanges = () => {
      const editor = editorRef.current;
      if (!editor) return;
      
      const doc = editor.getDoc();
      const insList = doc.querySelectorAll("ins.tc-insert, span.tc-insert");
      insList.forEach((ins: Element) => {
        editor.dom.remove(ins, true);
      });

      const delList = doc.querySelectorAll("del.tc-delete, span.tc-delete");
      delList.forEach((del: Element) => {
        editor.dom.remove(del);
      });

      editor.nodeChanged();
      editor.undoManager.add();
      setIsDirty(true);
    };

    const rejectAllChanges = () => {
      const editor = editorRef.current;
      if (!editor) return;

      const doc = editor.getDoc();
      const insList = doc.querySelectorAll("ins.tc-insert, span.tc-insert");
      insList.forEach((ins: Element) => {
        editor.dom.remove(ins);
      });

      const delList = doc.querySelectorAll("del.tc-delete, span.tc-delete");
      delList.forEach((del: Element) => {
        editor.dom.remove(del, true);
      });

      editor.nodeChanged();
      editor.undoManager.add();
      setIsDirty(true);
    };

    // Comment Handling with Interactive Modal & Replies
    const handleOpenCommentModal = () => {
      const editor = editorRef.current;
      if (!editor) return;

      const selectedText = editor.selection.getContent({ format: "text" });
      if (!selectedText || !selectedText.trim()) {
        alert("Please select text in the editor to add a comment.");
        return;
      }

      setPendingSelectedText(selectedText);
      setCommentInputText("");
      setIsCommentModalOpen(true);
    };

    const handleConfirmAddComment = () => {
      if (!commentInputText.trim()) return;

      const editor = editorRef.current;
      if (!editor) return;

      const commentId = "cmt_" + Date.now();
      const dateStr = new Date().toISOString();

      const markHtml = `<mark class="doc-comment" data-comment-id="${commentId}" data-author="${currentUser}" data-date="${dateStr}" data-comment="${commentInputText.replace(/"/g, "&quot;")}">${pendingSelectedText}</mark>`;
      editor.selection.setContent(markHtml);
      editor.undoManager.add();

      const newComment: CommentItem = {
        id: commentId,
        author: currentUser,
        date: dateStr,
        text: commentInputText,
        selectedText: pendingSelectedText,
        isResolved: false,
        replies: [],
      };

      setComments((prev) => [...prev, newComment]);
      setActiveCommentId(commentId);
      setShowCommentsSidebar(true);
      setIsDirty(true);
      setIsCommentModalOpen(false);
      setCommentInputText("");
    };

    const handleToggleResolveComment = (commentId: string) => {
      setComments((prev) =>
        prev.map((c) => (c.id === commentId ? { ...c, isResolved: !c.isResolved } : c))
      );
      setIsDirty(true);
    };

    const handleAddCommentReply = (commentId: string) => {
      const replyText = replyInputMap[commentId];
      if (!replyText || !replyText.trim()) return;

      const newReply: CommentReply = {
        id: "rpl_" + Date.now(),
        author: currentUser,
        date: new Date().toISOString(),
        text: replyText,
      };

      setComments((prev) =>
        prev.map((c) =>
          c.id === commentId
            ? { ...c, replies: [...(c.replies || []), newReply] }
            : c
        )
      );
      setReplyInputMap((prev) => ({ ...prev, [commentId]: "" }));
      setIsDirty(true);
    };

    const handleDeleteComment = (commentId: string) => {
      const editor = editorRef.current;
      if (editor) {
        const doc = editor.getDoc();
        const mark = doc.querySelector(`mark.doc-comment[data-comment-id="${commentId}"]`);
        if (mark) {
          editor.dom.remove(mark, true);
        }
      }
      setComments((prev) => prev.filter((c) => c.id !== commentId));
      if (activeCommentId === commentId) setActiveCommentId(null);
      setIsDirty(true);
    };

    const handleSelectComment = (commentId: string) => {
      setActiveCommentId(commentId);
      const editor = editorRef.current;
      if (!editor) return;

      const doc = editor.getDoc();
      const mark = doc.querySelector(`mark.doc-comment[data-comment-id="${commentId}"]`);
      if (mark) {
        editor.selection.select(mark);
        mark.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    };

    // Combine custom CSS with A4 Word Document Styling
    const wordPageStyle = `
      body {
        background-color: #f1f5f9 !important;
        display: flex !important;
        justify-content: center !important;
        padding: 24px 0 !important;
        margin: 0 !important;
        font-family: 'Inter', -apple-system, sans-serif !important;
      }
      .mce-content-body {
        background-color: #ffffff !important;
        width: 816px !important;
        min-height: 1056px !important;
        padding: 64px 72px !important;
        box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.05) !important;
        border: 1px solid #cbd5e1 !important;
        box-sizing: border-box !important;
        margin: 0 auto !important;
      }
      ins, ins.tc-insert, span.tc-insert, .tc-insert, [data-xml-tag="insert"], [data-xml-tag="tc-insert"] {
        background-color: #dcfce7 !important;
        color: #15803d !important;
        text-decoration: underline !important;
        text-decoration-color: #16a34a !important;
        padding: 0 2px !important;
        border-radius: 2px !important;
        display: inline !important;
      }
      del, del.tc-delete, span.tc-delete, .tc-delete, [data-xml-tag="delete"], [data-xml-tag="tc-delete"] {
        background-color: #fee2e2 !important;
        color: #b91c1c !important;
        text-decoration: line-through !important;
        text-decoration-color: #dc2626 !important;
        padding: 0 2px !important;
        border-radius: 2px !important;
        display: inline !important;
      }
      mark.doc-comment {
        background-color: #fef08a !important;
        color: #854d0e !important;
        border-bottom: 2px solid #eab308 !important;
        padding: 2px 4px !important;
        border-radius: 3px !important;
        cursor: pointer !important;
        position: relative !important;
        display: inline !important;
      }
      mark.doc-comment::after {
        content: " 💬 " attr(data-comment) !important;
        font-family: system-ui, -apple-system, sans-serif !important;
        font-style: normal !important;
        font-weight: 500 !important;
        font-size: 11px !important;
        background: #1e293b !important;
        color: #f8fafc !important;
        padding: 2px 8px !important;
        border-radius: 12px !important;
        margin-left: 6px !important;
        display: inline-inline-flex !important;
        align-items: center !important;
        gap: 4px !important;
        box-shadow: 0 2px 6px rgba(0, 0, 0, 0.15) !important;
        vertical-align: middle !important;
        border: 1px solid #475569 !important;
        max-width: 240px !important;
        white-space: nowrap !important;
        overflow: hidden !important;
        text-overflow: ellipsis !important;
        cursor: pointer !important;
        user-select: none !important;
      }
      mark.doc-comment:hover {
        background-color: #fde047 !important;
      }
      mark.doc-comment:hover::after {
        background-color: #2563eb !important;
        color: #ffffff !important;
        border-color: #3b82f6 !important;
        box-shadow: 0 4px 12px rgba(37, 99, 235, 0.3) !important;
        max-width: 400px !important;
      }
      /* Ensure inline XML citation sub-elements render inline according to Proof idGeneratedStyles.css */
      div[data-xml-tag="edition"],
      div[data-xml-tag="publisher-name"],
      div[data-xml-tag="publisher-loc"],
      div[data-xml-tag="month"],
      div[data-xml-tag="year"],
      div[data-xml-tag="surname"],
      div[data-xml-tag="given-names"],
      div[data-xml-tag="collab"],
      div[data-xml-tag="comment"],
      div[data-xml-tag="volume"],
      div[data-xml-tag="issue"],
      div[data-xml-tag="fpage"],
      div[data-xml-tag="lpage"],
      span[data-xml-tag] {
        display: inline !important;
        margin: 0 !important;
        padding: 0 !important;
      }
      /* Visual styling for character formatting tags & classes */
      b, strong, .bold, .Bold, [data-xml-tag="bold"], [data-xml-tag="Bold"], span.bold {
        font-weight: 700 !important;
      }
      i, em, .italic, .Italic, [data-xml-tag="italic"], [data-xml-tag="Italic"], span.italic {
        font-style: italic !important;
      }
      u, .underline, .Underline, [data-xml-tag="underline"], [data-xml-tag="Underline"], span.underline {
        text-decoration: underline !important;
      }
      s, strike, .strikethrough, [data-xml-tag="strikethrough"], span.strikethrough {
        text-decoration: line-through !important;
      }
      sub, .sub, [data-xml-tag="sub"], span.sub {
        vertical-align: sub !important;
        font-size: 0.75em !important;
      }
      sup, .sup, [data-xml-tag="sup"], span.sup {
        vertical-align: super !important;
        font-size: 0.75em !important;
      }
      .smallcaps, [data-xml-tag="smallcaps"], span.smallcaps {
        font-variant: small-caps !important;
      }
      ${customCss}
    `;

    return (
      <div className="flex flex-col h-full bg-slate-900 border border-slate-700/60 rounded-lg overflow-hidden shadow-2xl">
        {/* MS Word Top Header Bar */}
        <div className="flex items-center justify-between px-4 h-12 bg-slate-950 border-b border-slate-800 flex-shrink-0 select-none">
          <div className="flex items-center gap-3">
            <div className="w-6 h-6 bg-blue-600 text-white rounded flex items-center justify-center font-bold text-xs">
              W
            </div>
            <span className="text-xs font-semibold text-slate-200 truncate max-w-xs">
              {documentTitle ?? "Edit Document"}
            </span>
            {isDirty ? (
              <span className="text-[10px] bg-amber-500/10 text-amber-400 px-2 py-0.5 rounded font-medium border border-amber-500/20">
                Unsaved Changes
              </span>
            ) : savedAt ? (
              <div className="flex items-center gap-1.5 text-[10px] text-emerald-400">
                <CheckCircle2 size={12} />
                <span>Saved at {savedAt.toLocaleTimeString()}</span>
              </div>
            ) : null}
          </div>

          <div className="flex items-center gap-2">
            {/* Quick Track Changes Acceptance Controls */}
            <div className="flex items-center bg-slate-900 border border-slate-800 rounded p-0.5">
              <button
                onClick={acceptCurrentChange}
                title="Accept Current Change"
                className="p-1 hover:bg-slate-800 text-emerald-400 rounded transition-colors"
              >
                <Check className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={rejectCurrentChange}
                title="Reject Current Change"
                className="p-1 hover:bg-slate-800 text-rose-400 rounded transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
              <div className="w-[1px] h-4 bg-slate-800 mx-1" />
              <button
                onClick={acceptAllChanges}
                title="Accept All Revisions"
                className="px-2 py-0.5 text-[10px] font-semibold hover:bg-emerald-950 text-emerald-400 rounded transition-colors flex items-center gap-1"
              >
                <CheckCheck className="w-3.5 h-3.5" />
                Accept All
              </button>
              <button
                onClick={rejectAllChanges}
                title="Reject All Revisions"
                className="px-2 py-0.5 text-[10px] font-semibold hover:bg-rose-950 text-rose-400 rounded transition-colors flex items-center gap-1"
              >
                <XCircle className="w-3.5 h-3.5" />
                Reject All
              </button>
            </div>

            {/* Track Changes Toggle */}
            <button
              onClick={() => {
                const next = !tcEnabled;
                setTcEnabled(next);
                onTrackChangesToggle?.(next);
              }}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-semibold border transition-all ${
                tcEnabled
                  ? "bg-emerald-600/10 border-emerald-500/30 text-emerald-400 font-bold"
                  : "bg-slate-900 border-slate-800 text-slate-400 hover:bg-slate-800"
              }`}
            >
              Track Changes: {tcEnabled ? "ON" : "OFF"}
            </button>

            {/* Toggle Comments Sidebar */}
            <button
              onClick={() => setShowCommentsSidebar(!showCommentsSidebar)}
              className={`p-1.5 rounded border transition-all ${
                showCommentsSidebar
                  ? "bg-blue-600/10 border-blue-500/30 text-blue-400"
                  : "bg-slate-900 border-slate-800 text-slate-400 hover:bg-slate-800"
              }`}
              title="Toggle Comments Panel"
            >
              {showCommentsSidebar ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
            </button>

            {/* Save Button */}
            <Button
              onClick={handleSaveClick}
              disabled={isSaving}
              size="sm"
              className="bg-blue-600 hover:bg-blue-500 text-white font-bold flex items-center gap-1.5 px-3"
            >
              {isSaving ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="w-3.5 h-3.5" />
                  {saveLabel}
                </>
              )}
            </Button>
          </div>
        </div>

        {/* Editor Main Body */}
        <div className="flex-1 flex overflow-hidden bg-slate-900">
          {/* TinyMCE Editor Viewport */}
          <div className="flex-1 overflow-hidden relative">
            <Editor
              tinymceScriptSrc="https://cdn.jsdelivr.net/npm/tinymce@6/tinymce.min.js"
              onInit={(evt, editor) => {
                editorRef.current = editor;
              }}
              value={content}
              onEditorChange={(newVal) => {
                setContent(newVal);
                setIsDirty(true);
                onContentChange?.();
              }}
              init={{
                height: height,
                menubar: "file edit view insert format tools table help",
                plugins: [
                  "advlist", "autolink", "lists", "link", "image", "charmap", "preview",
                  "anchor", "searchreplace", "visualblocks", "code", "fullscreen",
                  "insertdatetime", "media", "table", "wordcount", "help", "nonbreaking",
                  "pagebreak", "emoticons", "quickbars"
                ],
                toolbar: [
                  "undo redo | styles blocks fontfamily fontsize | bold italic underline strikethrough | forecolor backcolor | alignleft aligncenter alignright alignjustify",
                  "subscript superscript | addcomment | bullist numlist outdent indent | table link image media emoticons charmap hr pagebreak nonbreaking anchor insertdatetime | code fullscreen preview searchreplace visualblocks wordcount"
                ],
                quickbars_selection_toolbar: "bold italic underline | addcomment quicklink h2 h3 blockquote",
                quickbars_insert_toolbar: "quickimage quicktable media hr",
                contextmenu: "link table addcomment",
                skin: "oxide",
                content_style: wordPageStyle,
                valid_elements: "*[*]",
                extended_valid_elements: "*[*]",
                valid_children: "*[*]",
                custom_elements: "*",
                verify_html: false,
                schema: "html5",
                forced_root_block: "",
                allow_conditional_comments: true,
                entity_encoding: "raw",
                formats: {
                  bold: { inline: "span", classes: "bold", attributes: { "data-xml-tag": "bold" }, remove: "all" },
                  italic: { inline: "span", classes: "italic", attributes: { "data-xml-tag": "italic" }, remove: "all" },
                  underline: { inline: "span", classes: "underline", attributes: { "data-xml-tag": "underline" }, remove: "all" },
                  strikethrough: { inline: "span", classes: "strikethrough", attributes: { "data-xml-tag": "strikethrough" }, remove: "all" },
                  subscript: { inline: "span", classes: "sub", attributes: { "data-xml-tag": "sub" }, remove: "all" },
                  superscript: { inline: "span", classes: "sup", attributes: { "data-xml-tag": "sup" }, remove: "all" },
                },
                style_formats: [
                  {
                    title: "Paragraph Styles",
                    items: [
                      { title: "First Line Indent (Para-FL)", block: "p", classes: "Para-FL", attributes: { "data-xml-tag": "para" } },
                      { title: "Block Paragraph (Para-BL)", block: "p", classes: "Para-BL", attributes: { "data-xml-tag": "para" } },
                      { title: "Heading 1 (Head1)", block: "h1", classes: "Head1", attributes: { "data-xml-tag": "head1" } },
                      { title: "Heading 2 (Head2)", block: "h2", classes: "Head2", attributes: { "data-xml-tag": "head2" } },
                      { title: "Heading 3 (Head3)", block: "h3", classes: "Head3", attributes: { "data-xml-tag": "head3" } },
                      { title: "Heading 4 (Head4)", block: "h4", classes: "Head4", attributes: { "data-xml-tag": "head4" } },
                      { title: "Reference (Ref)", block: "p", classes: "Ref", attributes: { "data-xml-tag": "ref" } },
                      { title: "Extract Quote", block: "p", classes: "Extract", attributes: { "data-xml-tag": "extract" } },
                      { title: "Abstract", block: "p", classes: "Abstract", attributes: { "data-xml-tag": "abstract" } },
                      { title: "Keywords", block: "p", classes: "Keywords", attributes: { "data-xml-tag": "keywords" } },
                      { title: "Caption", block: "p", classes: "Caption", attributes: { "data-xml-tag": "caption" } },
                      { title: "Section Title", block: "p", classes: "Section-Title", attributes: { "data-xml-tag": "section-title" } },
                    ],
                  },
                  {
                    title: "Character Styles",
                    items: [
                      { title: "Bold", inline: "span", classes: "bold", attributes: { "data-xml-tag": "bold" } },
                      { title: "Italic", inline: "span", classes: "italic", attributes: { "data-xml-tag": "italic" } },
                      { title: "Subscript", inline: "span", classes: "sub", attributes: { "data-xml-tag": "sub" } },
                      { title: "Superscript", inline: "span", classes: "sup", attributes: { "data-xml-tag": "sup" } },
                      { title: "Small Caps", inline: "span", classes: "smallcaps", attributes: { "data-xml-tag": "smallcaps" } },
                      { title: "Emphasis", inline: "span", classes: "emphasis", attributes: { "data-xml-tag": "emphasis" } },
                      { title: "Cross Ref (xref)", inline: "span", classes: "xref", attributes: { "data-xml-tag": "xref" } },
                      { title: "Link / URL (uri)", inline: "span", classes: "uri", attributes: { "data-xml-tag": "uri" } },
                      { title: "Surname", inline: "span", classes: "surname", attributes: { "data-xml-tag": "surname" } },
                      { title: "Given Names", inline: "span", classes: "given-names", attributes: { "data-xml-tag": "given-names" } },
                      { title: "Edition", inline: "span", classes: "edition", attributes: { "data-xml-tag": "edition" } },
                      { title: "Publisher Name", inline: "span", classes: "publisher-name", attributes: { "data-xml-tag": "publisher-name" } },
                      { title: "Publisher Loc", inline: "span", classes: "publisher-loc", attributes: { "data-xml-tag": "publisher-loc" } },
                      { title: "Month", inline: "span", classes: "month", attributes: { "data-xml-tag": "month" } },
                      { title: "Year", inline: "span", classes: "year", attributes: { "data-xml-tag": "year" } },
                      { title: "Volume", inline: "span", classes: "volume", attributes: { "data-xml-tag": "volume" } },
                      { title: "First Page (fpage)", inline: "span", classes: "fpage", attributes: { "data-xml-tag": "fpage" } },
                      { title: "Last Page (lpage)", inline: "span", classes: "lpage", attributes: { "data-xml-tag": "lpage" } },
                    ],
                  },
                ],
                setup: (editor) => {
                  // Register custom toolbar & context menu Comment button
                  editor.ui.registry.addButton("addcomment", {
                    text: "Comment",
                    icon: "comment",
                    tooltip: "Add Comment to Selection",
                    onAction: () => {
                      handleOpenCommentModal();
                    },
                  });

                  // Listen for clicks on comment marks inside editor body
                  editor.on("click", (e) => {
                    const mark = editor.dom.getParent(e.target, "mark.doc-comment");
                    if (mark) {
                      const commentId = mark.getAttribute("data-comment-id");
                      if (commentId) {
                        setActiveCommentId(commentId);
                        setShowCommentsSidebar(true);
                      }
                    }
                  });
                  // Intercept key events for track changes insertion/deletion
                  editor.on("keydown", (e) => {
                    if (!tcEnabledRef.current) return;

                    if (e.key === "Backspace" || e.key === "Delete") {
                      const range = editor.selection.getRng();
                      if (!range.collapsed) {
                        e.preventDefault();
                        const selectedText = editor.selection.getContent({ format: "text" });
                        if (selectedText) {
                          const delHtml = `<span class="tc-delete" data-xml-tag="delete" data-author="${currentUserRef.current}" data-date="${new Date().toISOString()}">${selectedText}</span>`;
                          editor.selection.setContent(delHtml);
                          editor.nodeChanged();
                          editor.undoManager.add();
                          setIsDirty(true);
                        }
                      } else {
                        e.preventDefault();
                        const rng = range.cloneRange();
                        if (e.key === "Backspace") {
                          rng.setStart(rng.startContainer, Math.max(0, rng.startOffset - 1));
                        } else {
                          rng.setEnd(rng.endContainer, Math.min(rng.endContainer.length || 0, rng.endOffset + 1));
                        }
                        editor.selection.setRng(rng);
                        const selectedText = editor.selection.getContent({ format: "text" });
                        if (selectedText) {
                          const delHtml = `<span class="tc-delete" data-xml-tag="delete" data-author="${currentUserRef.current}" data-date="${new Date().toISOString()}">${selectedText}</span>`;
                          editor.selection.setContent(delHtml);
                          editor.selection.collapse(false);
                          editor.nodeChanged();
                          editor.undoManager.add();
                          setIsDirty(true);
                        }
                      }
                    }
                  });

                  editor.on("keypress", (e) => {
                    if (!tcEnabledRef.current) return;

                    if (e.charCode && !e.ctrlKey && !e.metaKey && !e.altKey) {
                      const char = String.fromCharCode(e.charCode);
                      const node = editor.selection.getNode();
                      let parentIns = editor.dom.getParent(node, "ins.tc-insert, span.tc-insert");

                      // Check if cursor is immediately at the end of an insertion span
                      if (!parentIns) {
                        const rng = editor.selection.getRng();
                        if (rng && rng.collapsed) {
                          const container = rng.startContainer;
                          if (container.nodeType === 3) {
                            const p = container.parentNode;
                            if (p && editor.dom.hasClass(p, "tc-insert")) {
                              parentIns = p;
                            }
                          } else if (container.nodeType === 1) {
                            const prevChild = container.childNodes[rng.startOffset - 1];
                            if (prevChild && editor.dom.hasClass(prevChild, "tc-insert")) {
                              parentIns = prevChild;
                            }
                          }
                        }
                      }

                      // If typing continuously inside or at the end of an insertion span by the same author
                      if (parentIns && parentIns.getAttribute("data-author") === currentUserRef.current) {
                        e.preventDefault();
                        const doc = editor.getDoc();
                        const textNode = doc.createTextNode(char);
                        parentIns.appendChild(textNode);

                        // Position cursor at end of text inside the existing span
                        const newRng = doc.createRange();
                        newRng.setStartAfter(textNode);
                        newRng.collapse(true);
                        editor.selection.setRng(newRng);
                        editor.nodeChanged();
                        editor.undoManager.add();
                        setIsDirty(true);
                        return;
                      }

                      // Create a new insertion span and keep cursor INSIDE it
                      e.preventDefault();
                      const doc = editor.getDoc();
                      const insSpan = doc.createElement("span");
                      insSpan.className = "tc-insert";
                      insSpan.setAttribute("data-xml-tag", "insert");
                      insSpan.setAttribute("data-author", currentUserRef.current);
                      insSpan.setAttribute("data-date", new Date().toISOString());
                      insSpan.textContent = char;

                      editor.selection.setNode(insSpan);

                      // Place selection cursor INSIDE the newly created span at the end of the character
                      if (insSpan.firstChild) {
                        const newRng = doc.createRange();
                        newRng.setStart(insSpan.firstChild, insSpan.firstChild.nodeValue?.length || 1);
                        newRng.collapse(true);
                        editor.selection.setRng(newRng);
                      }
                      editor.nodeChanged();
                      editor.undoManager.add();
                      setIsDirty(true);
                    }
                  });
                },
              }}
            />
          </div>

          {/* Right Comments Sidebar */}
          {showCommentsSidebar && (
            <div className="w-80 bg-slate-950 border-l border-slate-800 flex flex-col flex-shrink-0">
              <div className="p-3 border-b border-slate-800 flex items-center justify-between bg-slate-900/50">
                <div className="flex items-center gap-2 text-xs font-semibold text-slate-200">
                  <MessageSquare size={14} className="text-blue-400" />
                  <span>Comments</span>
                  <span className="bg-blue-600/20 text-blue-400 px-1.5 py-0.5 rounded text-[10px]">
                    {comments.length}
                  </span>
                </div>
                <button
                  onClick={handleOpenCommentModal}
                  className="text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white px-2 py-1 rounded transition-colors flex items-center gap-1"
                >
                  + Add Comment
                </button>
              </div>

              {/* Filter Tabs */}
              <div className="flex items-center border-b border-slate-800/80 px-3 py-1.5 gap-1 bg-slate-900/30">
                {(["all", "active", "resolved"] as const).map((filter) => (
                  <button
                    key={filter}
                    onClick={() => setCommentFilter(filter)}
                    className={`px-2 py-0.5 rounded text-[11px] font-medium capitalize transition-all ${
                      commentFilter === filter
                        ? "bg-blue-600/20 text-blue-400 border border-blue-500/30"
                        : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50"
                    }`}
                  >
                    {filter}
                  </button>
                ))}
              </div>

              <div className="flex-1 overflow-y-auto p-3 space-y-3">
                {comments.filter(c => commentFilter === "all" ? true : commentFilter === "resolved" ? c.isResolved : !c.isResolved).length === 0 ? (
                  <div className="text-center py-8 text-xs text-slate-500">
                    No {commentFilter !== "all" ? commentFilter : ""} comments in this document. Select text and click <strong>+ Add Comment</strong>.
                  </div>
                ) : (
                  comments
                    .filter(c => commentFilter === "all" ? true : commentFilter === "resolved" ? c.isResolved : !c.isResolved)
                    .map((comment) => (
                      <div
                        key={comment.id}
                        onClick={() => handleSelectComment(comment.id)}
                        className={`p-3 rounded-lg border transition-all cursor-pointer text-xs ${
                          comment.isResolved
                            ? "bg-slate-900/30 border-slate-800/60 opacity-75"
                            : activeCommentId === comment.id
                            ? "bg-slate-900 border-blue-500/50 shadow-lg shadow-blue-500/10"
                            : "bg-slate-900/60 border-slate-800 hover:border-slate-700"
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="font-semibold text-slate-300 flex items-center gap-1.5">
                            <span className="w-4 h-4 rounded-full bg-blue-600 text-white text-[9px] flex items-center justify-center font-bold">
                              {comment.author.substring(0, 2).toUpperCase()}
                            </span>
                            {comment.author}
                          </span>
                          <div className="flex items-center gap-1.5">
                            {comment.isResolved && (
                              <span className="text-[9px] bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-1 rounded">
                                Resolved
                              </span>
                            )}
                            <span className="text-[10px] text-slate-500">
                              {new Date(comment.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                        </div>
                        <div className="text-slate-400 italic text-[11px] mb-2 pl-2 border-l-2 border-slate-700 truncate">
                          "{comment.selectedText}"
                        </div>
                        <div className="text-slate-200 font-medium leading-relaxed mb-2">
                          {comment.text}
                        </div>

                        {/* Threaded Replies */}
                        {comment.replies && comment.replies.length > 0 && (
                          <div className="mt-2.5 pt-2 border-t border-slate-800/80 space-y-2">
                            {comment.replies.map((reply) => (
                              <div key={reply.id} className="bg-slate-950/60 p-2 rounded border border-slate-800/50 text-[11px]">
                                <div className="flex items-center justify-between mb-0.5 text-slate-400">
                                  <span className="font-semibold text-slate-300">{reply.author}</span>
                                  <span className="text-[9px]">{new Date(reply.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                </div>
                                <div className="text-slate-300">{reply.text}</div>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Reply Input Box */}
                        <div className="mt-2.5 flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="text"
                            placeholder="Type a reply..."
                            value={replyInputMap[comment.id] || ""}
                            onChange={(e) => setReplyInputMap({ ...replyInputMap, [comment.id]: e.target.value })}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleAddCommentReply(comment.id);
                            }}
                            className="flex-1 bg-slate-950 border border-slate-800 rounded px-2 py-1 text-[11px] text-slate-200 focus:outline-none focus:border-blue-500"
                          />
                          <button
                            onClick={() => handleAddCommentReply(comment.id)}
                            className="text-[10px] bg-slate-800 hover:bg-slate-700 text-slate-200 px-2 py-1 rounded font-medium transition-colors"
                          >
                            Reply
                          </button>
                        </div>

                        {/* Card Action Controls */}
                        <div className="flex items-center justify-between pt-2 mt-2 border-t border-slate-800/60">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleToggleResolveComment(comment.id);
                            }}
                            className="text-[10px] text-emerald-400 hover:text-emerald-300 font-medium flex items-center gap-1"
                          >
                            <CheckCircle2 size={11} />
                            {comment.isResolved ? "Unresolve" : "Resolve"}
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteComment(comment.id);
                            }}
                            className="text-[10px] text-rose-400 hover:text-rose-300 font-medium"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* Interactive Add Comment Modal Overlay */}
        {isCommentModalOpen && (
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-slate-900 border border-slate-700/80 rounded-xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-150">
              <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/60">
                <div className="flex items-center gap-2 font-semibold text-sm text-slate-100">
                  <MessageSquare size={16} className="text-blue-400" />
                  <span>Add Comment</span>
                </div>
                <button
                  onClick={() => setIsCommentModalOpen(false)}
                  className="text-slate-400 hover:text-slate-200 p-1 rounded hover:bg-slate-800 transition-colors"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="p-4 space-y-3.5">
                <div>
                  <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block mb-1">
                    Selected Text Quote
                  </label>
                  <div className="bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs text-slate-300 italic border-l-4 border-l-blue-500 max-h-24 overflow-y-auto">
                    "{pendingSelectedText}"
                  </div>
                </div>

                <div>
                  <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block mb-1">
                    Your Comment ({currentUser})
                  </label>
                  <textarea
                    autoFocus
                    rows={3}
                    placeholder="Write your review feedback or comment here..."
                    value={commentInputText}
                    onChange={(e) => setCommentInputText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                        handleConfirmAddComment();
                      }
                    }}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 transition-all resize-none"
                  />
                  <span className="text-[10px] text-slate-500 mt-1 block">
                    Press <kbd className="bg-slate-800 px-1 rounded text-slate-400">Ctrl+Enter</kbd> to submit
                  </span>
                </div>
              </div>

              <div className="p-3.5 border-t border-slate-800 bg-slate-950/40 flex items-center justify-end gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setIsCommentModalOpen(false)}
                  className="text-slate-400 hover:text-slate-200 text-xs"
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={handleConfirmAddComment}
                  disabled={!commentInputText.trim()}
                  className="bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs px-4"
                >
                  Post Comment
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }
);
