import { describe, it, expect } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { TrackChanges } from "@/features/editor/TrackChanges";
import { SpecialSpaceMarks } from "@/features/editor/SpecialSpaceMarks";
import { insertSpecialChar } from "@/features/editor/SpecialCharPicker";
import { SPACES, ALL_SPECIAL_CHARS, searchSpecialChars } from "@/features/editor/specialCharacters";

function makeEditor(html = "<p>ab</p>") {
  const editor = new Editor({
    extensions: [TrackChanges, StarterKit, SpecialSpaceMarks],
    content: html,
  });
  editor.commands.setTextSelection(2); // between "a" and "b"
  return editor;
}

describe("special characters", () => {
  it.each(SPACES.map((s) => [s.name, s.char]))("inserts %s as the exact code point", (_name, ch) => {
    const editor = makeEditor();
    insertSpecialChar(editor, ch);
    const text = editor.state.doc.textContent;
    expect(text).toBe(`a${ch}b`);
    const html = editor.getHTML();
    if (ch === " ") {
      expect(html.includes(" ") || html.includes("&nbsp;")).toBe(true);
    } else {
      expect(html).toContain(ch);
    }
    editor.destroy();
  });

  it("inserts markup-looking characters literally", () => {
    const editor = makeEditor();
    insertSpecialChar(editor, "≤");
    insertSpecialChar(editor, "…");
    expect(editor.state.doc.textContent).toBe("a≤…b");
    editor.destroy();
  });

  it("space markers are on-screen only — never in getHTML()", () => {
    const editor = makeEditor("<p>a b c d</p>");
    expect(editor.view.dom.querySelectorAll(".special-space").length).toBe(3);
    expect(editor.getHTML()).not.toContain("special-space");
    editor.destroy();
  });

  it("with Track Changes on, an inserted symbol is tracked as an insertion", () => {
    const editor = makeEditor();
    (editor as any).storage.trackChanges.enabled = true;
    insertSpecialChar(editor, "—");
    const html = editor.getHTML();
    expect(html).toMatch(/<ins[^>]*>[^<]*—/);
    editor.destroy();
  });

  it("catalogue has unique characters and search works", () => {
    const chars = ALL_SPECIAL_CHARS.map((c) => c.char);
    expect(new Set(chars).size).toBe(chars.length);
    expect(searchSpecialChars("em space")[0]?.char).toBe(" ");
    expect(searchSpecialChars("less than").map((c) => c.char)).toContain("≤");
    expect(searchSpecialChars("U+2026")[0]?.char).toBe("…");
  });
});
