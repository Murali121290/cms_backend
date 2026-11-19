import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { createRef } from "react";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { SpecialCharPicker } from "@/features/editor/SpecialCharPicker";

describe("SpecialCharPicker", () => {
  it("renders into document.body (not clipped by the toolbar) and inserts on click", () => {
    const editor = new Editor({ extensions: [StarterKit], content: "<p>ab</p>" });
    editor.commands.setTextSelection(2);
    const anchor = document.createElement("div");
    document.body.appendChild(anchor);
    const anchorRef = createRef<HTMLElement>() as { current: HTMLElement | null };
    anchorRef.current = anchor;

    const { container } = render(
      <div style={{ overflow: "auto" }}>
        <SpecialCharPicker editor={editor} open onClose={() => {}} anchorRef={anchorRef} />
      </div>,
    );

    const dialog = screen.getByRole("dialog", { name: "Insert symbol" });
    expect(container.contains(dialog)).toBe(false); // portalled out of the clipping parent
    expect(dialog.parentElement).toBe(document.body);
    expect(dialog.style.position).toBe("fixed");

    fireEvent.click(screen.getByRole("button", { name: "Em space" }));
    expect(editor.state.doc.textContent).toBe("a b");
    editor.destroy();
  });
});
