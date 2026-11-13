/**
 * Regression tests for the TipTap SearchReplace extension.
 *
 * Load-bearing case (Issue 1): a search phrase that spans multiple
 * text nodes — because inline marks like bold / italic / highlight /
 * tracked-changes split the text into separate runs — must still
 * be found. Previously the extension iterated each text node in
 * isolation and ran the regex against ``node.text``, so a phrase
 * split by marks produced zero matches (editor Find would show
 * ``1 of 1`` when the visible document contained two occurrences).
 *
 * The fix flattens every textblock's inline content into a string +
 * a per-character ProseMirror-position map and runs the regex
 * against the flat string. Match offsets translate back to real
 * positions via the map. No document content is modified.
 */
import { describe, it, expect } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Highlight from "@tiptap/extension-highlight";
import { SearchReplace } from "@/features/editor/SearchReplace";

function makeEditor(html: string) {
  return new Editor({
    extensions: [
      SearchReplace,
      StarterKit.configure({ history: false } as any),
      Highlight,
    ],
    content: html,
  });
}

describe("SearchReplace — flat-text matching across inline marks", () => {
  it("finds a phrase split across two text nodes by a bold mark", () => {
    // "psychiatric-mental health " is plain; "nurse practitioner"
    // is bolded; ProseMirror stores them as two text nodes within
    // the same paragraph.
    const editor = makeEditor(
      '<p>The <strong>psychiatric-mental</strong> health nurse practitioner reviewed the chart.</p>' +
      '<p>Later, the psychiatric-mental health nurse practitioner updated the chart.</p>'
    );

    editor.commands.setSearchTerm("psychiatric-mental health nurse practitioner");
    const storage = (editor as any).storage.searchReplace;
    expect(storage.results).toHaveLength(2);
  });

  it("finds a phrase split by highlight marks (language-editing decorations)", () => {
    const editor = makeEditor(
      '<p>The <mark>psychiatric-mental</mark> health nurse <mark>practitioner</mark> arrived.</p>'
    );
    editor.commands.setSearchTerm("psychiatric-mental health nurse practitioner");
    const storage = (editor as any).storage.searchReplace;
    expect(storage.results).toHaveLength(1);
  });

  it("finds the same phrase across three different inline marks", () => {
    const editor = makeEditor(
      '<p><em>psychiatric-mental</em> <strong>health</strong> nurse <mark>practitioner</mark> described.</p>'
    );
    editor.commands.setSearchTerm("psychiatric-mental health nurse practitioner");
    const storage = (editor as any).storage.searchReplace;
    expect(storage.results).toHaveLength(1);
  });

  it("match count equals occurrences visible in the document", () => {
    // Two separate paragraphs, each with the full phrase but split
    // by at least one inline mark. User reports "2 visible, Find
    // shows 1 of 1". After the fix the count must be 2 of 2.
    const editor = makeEditor(
      '<p>psychiatric-mental health <strong>nurse practitioner</strong> is educated.</p>' +
      '<p>The <em>Psychiatric-Mental Health</em> Nurse Practitioner (PMHNP) role is central.</p>'
    );
    editor.commands.setSearchTerm("psychiatric-mental health nurse practitioner");
    const storage = (editor as any).storage.searchReplace;
    expect(storage.results).toHaveLength(2);
    // Each result's (from, to) maps to a real contiguous range.
    for (const r of storage.results) {
      expect(r.to).toBeGreaterThan(r.from);
    }
    expect(storage.activeIndex).toBe(0);
  });

  it("findNext / findPrev cycle through every occurrence", () => {
    const editor = makeEditor(
      '<p>psychiatric-mental health <strong>nurse</strong> practitioner one.</p>' +
      '<p>psychiatric-mental health <strong>nurse</strong> practitioner two.</p>' +
      '<p>psychiatric-mental health <strong>nurse</strong> practitioner three.</p>'
    );
    editor.commands.setSearchTerm("psychiatric-mental health nurse practitioner");
    const storage = (editor as any).storage.searchReplace;
    expect(storage.results).toHaveLength(3);

    expect(storage.activeIndex).toBe(0);
    editor.commands.findNext();
    expect(storage.activeIndex).toBe(1);
    editor.commands.findNext();
    expect(storage.activeIndex).toBe(2);
    editor.commands.findNext();
    // Wraps around.
    expect(storage.activeIndex).toBe(0);
    editor.commands.findPrev();
    expect(storage.activeIndex).toBe(2);
  });

  it("finds literal match in plain text (no inline marks)", () => {
    const editor = makeEditor("<p>The nurse practitioner reviewed the chart.</p>");
    editor.commands.setSearchTerm("nurse practitioner");
    const storage = (editor as any).storage.searchReplace;
    expect(storage.results).toHaveLength(1);
  });

  it("case-insensitive by default; case-sensitive toggle respects case", () => {
    const editor = makeEditor(
      '<p>The Nurse Practitioner and the nurse practitioner met.</p>'
    );
    editor.commands.setSearchTerm("nurse practitioner");
    const storage = (editor as any).storage.searchReplace;
    expect(storage.results).toHaveLength(2);

    editor.commands.setCaseSensitive(true);
    editor.commands.setSearchTerm("nurse practitioner");
    expect(storage.results).toHaveLength(1);
  });

  it("wholeWord toggle anchors at word boundaries", () => {
    const editor = makeEditor(
      '<p>The practitioner and the practitioners both arrived.</p>'
    );
    editor.commands.setSearchTerm("practitioner");
    const storage = (editor as any).storage.searchReplace;
    // Without wholeWord, "practitioners" contains "practitioner" → 2 hits.
    expect(storage.results).toHaveLength(2);

    editor.commands.setWholeWord(true);
    editor.commands.setSearchTerm("practitioner");
    // With wholeWord, only the standalone "practitioner" matches.
    expect(storage.results).toHaveLength(1);
  });

  it("does not modify document content on search", () => {
    const before = "<p>The <strong>nurse</strong> practitioner reviewed the chart.</p>";
    const editor = makeEditor(before);
    editor.commands.setSearchTerm("nurse practitioner");
    expect(editor.getHTML()).toBe(before);
  });

  it("does not match across paragraph boundaries", () => {
    // The phrase is split across two <p> blocks. Phrases that cross
    // block boundaries are intentionally NOT matched — each paragraph
    // is its own flat-text scope.
    const editor = makeEditor(
      "<p>psychiatric-mental health</p><p>nurse practitioner</p>"
    );
    editor.commands.setSearchTerm("psychiatric-mental health nurse practitioner");
    const storage = (editor as any).storage.searchReplace;
    expect(storage.results).toHaveLength(0);
  });
});
