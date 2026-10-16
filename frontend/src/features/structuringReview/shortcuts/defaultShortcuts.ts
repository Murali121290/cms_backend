import type { AllClientsShortcutsConfig } from "./types";

export const DEFAULT_CLIENT_SHORTCUTS: AllClientsShortcutsConfig = {
  publisher: {
    client_label: "Publisher / Wolters Kluwer / BEP",
    tagset: "publisher",
    paragraph_shortcuts: [
      { action: "heading_1", style: "H1", shortcut: "Ctrl+Alt+1", label: "Heading 1", type: "paragraph", badgeColor: "#3b82f6" },
      { action: "heading_2", style: "H2", shortcut: "Ctrl+Alt+2", label: "Heading 2", type: "paragraph", badgeColor: "#06b6d4" },
      { action: "heading_3", style: "H3", shortcut: "Ctrl+Alt+3", label: "Heading 3", type: "paragraph", badgeColor: "#64748b" },
      { action: "heading_4", style: "H4", shortcut: "Ctrl+Alt+4", label: "Heading 4", type: "paragraph", badgeColor: "#475569" },
      { action: "chapter_title", style: "CT", shortcut: "Ctrl+Alt+T", label: "Chapter Title", type: "paragraph", badgeColor: "#7c3aed" },
      { action: "body_text", style: "TXT", shortcut: "Ctrl+Alt+0", label: "Body Paragraph", type: "paragraph", badgeColor: "#94a3b8" },
      { action: "extract", style: "EXT-MID", shortcut: "Ctrl+Alt+E", label: "Extract / Blockquote", type: "paragraph", badgeColor: "#f59e0b" },
    ],
    character_shortcuts: [
      { action: "figure_citation", style: "FigureCitation", shortcut: "Alt+Shift+F", label: "Figure Citation", type: "character" },
      { action: "table_citation", style: "TableCitation", shortcut: "Alt+Shift+T", label: "Table Citation", type: "character" },
      { action: "bib_citation", style: "cite_bib", shortcut: "Alt+Shift+B", label: "Bibliography Citation", type: "character" },
      { action: "box_citation", style: "cite_box", shortcut: "Alt+Shift+X", label: "Box Citation", type: "character" },
      { action: "clear_character_style", style: null, shortcut: "Alt+Shift+0", label: "Clear Character Style", type: "character" },
    ],
  },
  springer: {
    client_label: "Springer Nature",
    tagset: "springer",
    paragraph_shortcuts: [
      { action: "heading_1", style: "Head1", shortcut: "Ctrl+Alt+1", label: "Heading 1", type: "paragraph", badgeColor: "#3b82f6" },
      { action: "heading_2", style: "Head2", shortcut: "Ctrl+Alt+2", label: "Heading 2", type: "paragraph", badgeColor: "#06b6d4" },
      { action: "heading_3", style: "Head3", shortcut: "Ctrl+Alt+3", label: "Heading 3", type: "paragraph", badgeColor: "#64748b" },
      { action: "heading_4", style: "Head4", shortcut: "Ctrl+Alt+4", label: "Heading 4", type: "paragraph", badgeColor: "#475569" },
      { action: "chapter_title", style: "ChapterTitle", shortcut: "Ctrl+Alt+T", label: "Chapter Title", type: "paragraph", badgeColor: "#7c3aed" },
      { action: "body_text", style: "Para-FL", shortcut: "Ctrl+Alt+0", label: "Body Paragraph", type: "paragraph", badgeColor: "#94a3b8" },
      { action: "extract", style: "eXtractTxt", shortcut: "Ctrl+Alt+E", label: "Extract / Blockquote", type: "paragraph", badgeColor: "#f59e0b" },
    ],
    character_shortcuts: [
      { action: "figure_citation", style: "FigureCitation", shortcut: "Alt+Shift+F", label: "Figure Citation", type: "character" },
      { action: "table_citation", style: "TableCitation", shortcut: "Alt+Shift+T", label: "Table Citation", type: "character" },
      { action: "bib_citation", style: "cite_bib", shortcut: "Alt+Shift+B", label: "Bibliography Citation", type: "character" },
      { action: "box_citation", style: "cite_box", shortcut: "Alt+Shift+X", label: "Box Citation", type: "character" },
      { action: "clear_character_style", style: null, shortcut: "Alt+Shift+0", label: "Clear Character Style", type: "character" },
    ],
  },
};
