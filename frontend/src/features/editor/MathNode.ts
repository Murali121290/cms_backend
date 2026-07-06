import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { MathNodeView } from "./MathNodeView";

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    mathNode: {
      insertMathNode: (attrs?: { latex?: string; mathml?: string; omml?: string; display?: string; openOnMount?: boolean }) => ReturnType;
    }
  }
}

export const MathNode = Node.create({
  name: "mathNode",
  group: "inline",
  inline: true,
  atom: true,

  addAttributes() {
    return {
      latex: {
        // Editable LaTeX source. Empty for equations that arrived from OMML
        // and haven't been edited yet — display code falls back to `mathml`.
        default: "",
        parseHTML: element => element.getAttribute("data-latex") || "",
        renderHTML: attributes => (attributes.latex ? { "data-latex": attributes.latex } : {}),
      },
      mathml: {
        // MathML string for display (and for lossy MathML→OMML on save when
        // no raw OMML is available, e.g. new equations authored in Mathlive).
        default: "",
        parseHTML: element => {
          const attr = element.getAttribute("data-mathml");
          if (attr) return attr;
          // Fallback: if the incoming node is <math>...</math> or contains
          // an inline <math> child, serialize it.
          const tag = (element.tagName || "").toLowerCase();
          if (tag === "math") {
            return new XMLSerializer().serializeToString(element);
          }
          const inner = element.querySelector && element.querySelector("math");
          if (inner) return new XMLSerializer().serializeToString(inner);
          return "";
        },
        renderHTML: attributes => (attributes.mathml ? { "data-mathml": attributes.mathml } : {}),
      },
      omml: {
        // Base64 of the raw OMML XML. When present and the equation was NOT
        // re-edited by the user, the delta engine will inject the OMML back
        // into the DOCX byte-for-byte — the round-trip becomes lossless.
        default: "",
        parseHTML: element => element.getAttribute("data-omml") || "",
        renderHTML: attributes => (attributes.omml ? { "data-omml": attributes.omml } : {}),
      },
      display: {
        // "inline" or "block" — how the equation appeared in the source DOCX.
        default: "inline",
        parseHTML: element => element.getAttribute("data-display") || "inline",
        renderHTML: attributes => ({ "data-display": attributes.display || "inline" }),
      },
      openOnMount: {
        // Transient flag: when a new equation is inserted from the ∑ toolbar
        // button, MathNodeView opens straight into edit mode.
        default: false,
        parseHTML: () => false,
        renderHTML: () => ({}),
      },
    };
  },

  parseHTML() {
    return [
      { tag: "span.math-node" },
      { tag: "span[data-latex]" },
      { tag: "span[data-mathml]" },
      {
        tag: "math",
        getAttrs: (node) => {
          if (typeof node === "string") return null;
          const el = node as HTMLElement;
          const mathml = new XMLSerializer().serializeToString(el);
          const display = el.getAttribute("display") === "block" ? "block" : "inline";
          return { mathml, latex: "", omml: "", display };
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, { class: "math-node" }),
      0,
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(MathNodeView);
  },

  addCommands() {
    return {
      insertMathNode: (attrs) => ({ chain }) => {
        const a = attrs || {};
        return chain()
          .insertContent({
            type: this.name,
            attrs: {
              latex: a.latex ?? "",
              mathml: a.mathml ?? "",
              omml: a.omml ?? "",
              display: a.display ?? "inline",
              openOnMount: !!a.openOnMount,
            },
          })
          .run();
      },
    };
  },
});

