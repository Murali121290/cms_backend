import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { MathNodeView } from "./MathNodeView";

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    mathNode: {
      insertMathNode: (latex: string) => ReturnType;
    }
  }
}

export const MathNode = Node.create({
  name: "mathNode",
  group: "inline",
  inline: true,
  atom: true, // Treated as a single leaf node

  addAttributes() {
    return {
      latex: {
        default: "E = mc^2",
        parseHTML: element => element.getAttribute("data-latex") || element.textContent || "E = mc^2",
        renderHTML: attributes => ({
          "data-latex": attributes.latex,
          class: "math-node",
        }),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: "span[data-latex]",
      },
      {
        tag: "math",
        // Parse MathML nodes directly by converting them back if needed, but since our editor output is span[data-latex],
        // this is a fallback for incoming pandoc math.
        getAttrs: (node) => {
          if (typeof node === "string") return null;
          // Fallback to text content if it's raw
          return { latex: (node as HTMLElement).textContent || "" };
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes), 0];
  },

  addNodeView() {
    return ReactNodeViewRenderer(MathNodeView);
  },

  addCommands() {
    return {
      insertMathNode: (latex: string) => ({ chain }) => {
        return chain()
          .insertContent({
            type: this.name,
            attrs: { latex },
          })
          .run();
      },
    };
  },
});
