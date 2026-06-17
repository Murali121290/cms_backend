import { Mark, mergeAttributes } from "@tiptap/core";

// Caption character styles created by pipeline Step 8
const CAPTION_CHAR_STYLES = new Set(["FigureCitation", "TableCitation", "FIG-NUM", "TN"]);

function isPipelineCharStyle(cls: string): boolean {
  if (cls.startsWith("bib_") || cls.startsWith("cite_")) return true;
  if (/^[a-z]+$/.test(cls) && cls.length > 1) return true; // formatting styles: bold, italic, bolditalics, etc.
  if (CAPTION_CHAR_STYLES.has(cls)) return true;
  return false;
}

export const CharStyle = Mark.create({
  name: "charStyle",

  keepOnSplit: true,
  inclusive: true,
  excludes: "",

  addAttributes() {
    return {
      class: {
        default: null,
        parseHTML: (element) => {
          const className = element.getAttribute("class") || "";
          const match = className.split(" ").find(isPipelineCharStyle);
          return match || null;
        },
        renderHTML: (attributes) => {
          return attributes.class ? { class: attributes.class } : {};
        },
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: "span",
        priority: 60,
        getAttrs: (element) => {
          if (typeof element === "string") return false;
          const className = element.getAttribute("class") || "";
          const classes = className.trim().split(/\s+/);
          if (classes.length !== 1) return false; // only single-class spans
          return isPipelineCharStyle(classes[0]) ? null : false;
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes), 0];
  },
});
