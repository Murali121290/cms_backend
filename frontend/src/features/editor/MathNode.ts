import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { MathNodeView } from "./MathNodeView";

export type MathWrapperAttrs = {
  wrapperBold?: boolean;
  wrapperItalic?: boolean;
  wrapperColor?: string;
  wrapperBgColor?: string;
  wrapperFontSize?: string;
  wrapperFontFamily?: string;
};

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    mathNode: {
      insertMathNode: (attrs?: { latex?: string; mathml?: string; omml?: string; display?: string; openOnMount?: boolean } & MathWrapperAttrs) => ReturnType;
      updateSelectedMathNode: (attrs: MathWrapperAttrs) => ReturnType;
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
      // ─── Wrapper formatting (Phase 2) ─────────────────────────────
      // Applied to the equation as a whole from the outer toolbar.
      // Displayed via CSS on the wrapper span and injected into every
      // <m:r>'s <m:rPr>/<w:rPr> on save so Word receives it.
      wrapperBold: {
        default: false,
        parseHTML: element => element.getAttribute("data-wrapper-bold") === "true",
        renderHTML: attrs => (attrs.wrapperBold ? { "data-wrapper-bold": "true" } : {}),
      },
      wrapperItalic: {
        default: false,
        parseHTML: element => element.getAttribute("data-wrapper-italic") === "true",
        renderHTML: attrs => (attrs.wrapperItalic ? { "data-wrapper-italic": "true" } : {}),
      },
      wrapperColor: {
        default: "",
        parseHTML: element => element.getAttribute("data-wrapper-color") || "",
        renderHTML: attrs => (attrs.wrapperColor ? { "data-wrapper-color": attrs.wrapperColor } : {}),
      },
      wrapperBgColor: {
        default: "",
        parseHTML: element => element.getAttribute("data-wrapper-bg") || "",
        renderHTML: attrs => (attrs.wrapperBgColor ? { "data-wrapper-bg": attrs.wrapperBgColor } : {}),
      },
      wrapperFontSize: {
        // A pt-size string like "14" or CSS value like "14pt".
        default: "",
        parseHTML: element => element.getAttribute("data-wrapper-size") || "",
        renderHTML: attrs => (attrs.wrapperFontSize ? { "data-wrapper-size": attrs.wrapperFontSize } : {}),
      },
      wrapperFontFamily: {
        default: "",
        parseHTML: element => element.getAttribute("data-wrapper-font") || "",
        renderHTML: attrs => (attrs.wrapperFontFamily ? { "data-wrapper-font": attrs.wrapperFontFamily } : {}),
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
          // A <math> that we round-tripped through the backend carries
          // data-omml / data-latex / data-display / data-wrapper-* on the
          // root — preserve them so the equation stays editable, styled
          // consistently, and the raw OMML stays available for a
          // byte-perfect re-inject on the next save.
          const omml = el.getAttribute("data-omml") || "";
          const latex = el.getAttribute("data-latex") || "";
          const explicitMathml = el.getAttribute("data-mathml") || "";
          const display =
            el.getAttribute("data-display") === "block" ||
            el.getAttribute("display") === "block"
              ? "block"
              : "inline";
          const mathml = explicitMathml || new XMLSerializer().serializeToString(el);
          return {
            mathml, latex, omml, display,
            wrapperBold: el.getAttribute("data-wrapper-bold") === "true",
            wrapperItalic: el.getAttribute("data-wrapper-italic") === "true",
            wrapperColor: el.getAttribute("data-wrapper-color") || "",
            wrapperBgColor: el.getAttribute("data-wrapper-bg") || "",
            wrapperFontSize: el.getAttribute("data-wrapper-size") || "",
            wrapperFontFamily: el.getAttribute("data-wrapper-font") || "",
          };
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    // Leaf node — no content hole. Visual rendering is entirely handled by
    // the React NodeView; this serialization is only used when TipTap
    // produces HTML for save/paste-out.
    return ["span", mergeAttributes(HTMLAttributes, { class: "math-node" })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(MathNodeView);
  },

  addKeyboardShortcuts() {
    return {
      // Enter (and Space) on a selected math node opens the equation editor,
      // matching the standard "single click = select, Enter = open" pattern.
      Enter: () => {
        const sel: any = this.editor.state.selection;
        if (sel && sel.node && sel.node.type?.name === this.name) {
          this.editor.chain().updateSelectedMathNode({ openOnMount: true } as any).run();
          return true;
        }
        return false;
      },
    };
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
              wrapperBold: !!a.wrapperBold,
              wrapperItalic: !!a.wrapperItalic,
              wrapperColor: a.wrapperColor ?? "",
              wrapperBgColor: a.wrapperBgColor ?? "",
              wrapperFontSize: a.wrapperFontSize ?? "",
              wrapperFontFamily: a.wrapperFontFamily ?? "",
            },
          })
          .run();
      },
      // Toggle/set wrapper formatting on the currently-selected math node.
      // Returns false if the current selection isn't a math node.
      updateSelectedMathNode: (attrs) => ({ state, dispatch }) => {
        const { from } = state.selection;
        const node = state.doc.nodeAt(from);
        if (!node || node.type.name !== this.name) return false;
        if (dispatch) {
          const tr = state.tr.setNodeMarkup(from, undefined, { ...node.attrs, ...attrs });
          dispatch(tr);
        }
        return true;
      },
    };
  },
});

