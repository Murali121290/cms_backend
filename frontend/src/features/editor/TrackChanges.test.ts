import { describe, it, expect } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { TrackChanges } from "@/features/editor/TrackChanges";

function makeEditor(html = "<p>Hello world</p>") {
  return new Editor({
    extensions: [TrackChanges, StarterKit.configure({ history: false })],
    content: html,
  });
}

function pressKey(editor: Editor, key: string): boolean {
  const view = editor.view;
  const event = new KeyboardEvent("keydown", { key });
  return (view as any).someProp("handleKeyDown", (fn: any) => fn(view, event)) === true;
}

describe("TrackChanges", () => {
  it("with TC OFF: Backspace is not intercepted (plugin returns false)", () => {
    const editor = makeEditor("<p>abcdef</p>");
    editor.commands.setTextSelection({ from: 4, to: 4 });
    const intercepted = pressKey(editor, "Backspace");
    expect(intercepted).toBe(false);
    expect(editor.getHTML()).not.toContain("<del");
  });

  it("with TC ON: Backspace marks one char with <del>, text NOT removed", () => {
    const editor = makeEditor("<p>abcdef</p>");
    (editor as any).storage.trackChanges.enabled = true;
    (editor as any).storage.trackChanges.author = "Test";

    editor.commands.setTextSelection({ from: 4, to: 4 });
    const intercepted = pressKey(editor, "Backspace");

    expect(intercepted).toBe(true);
    const html = editor.getHTML();
    expect(html).toContain("<del");
    expect(html).toContain('class="tc-delete"');
    expect(html.replace(/<[^>]+>/g, "")).toBe("abcdef");
  });

  it("with TC ON: Backspace over a selection marks the whole range", () => {
    const editor = makeEditor("<p>This is a line</p>");
    (editor as any).storage.trackChanges.enabled = true;

    editor.commands.setTextSelection({ from: 1, to: 15 });
    const intercepted = pressKey(editor, "Backspace");

    expect(intercepted).toBe(true);
    const html = editor.getHTML();
    expect(html).toContain("<del");
    expect(html.replace(/<[^>]+>/g, "")).toBe("This is a line");
  });

  it("with TC ON: Delete key also marks the char as <del>", () => {
    const editor = makeEditor("<p>abcdef</p>");
    (editor as any).storage.trackChanges.enabled = true;

    editor.commands.setTextSelection({ from: 4, to: 4 });
    const intercepted = pressKey(editor, "Delete");

    expect(intercepted).toBe(true);
    const html = editor.getHTML();
    expect(html).toContain("<del");
    expect(html.replace(/<[^>]+>/g, "")).toBe("abcdef");
  });
});
