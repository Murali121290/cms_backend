import { Mark, mergeAttributes } from "@tiptap/core";

// Caption character styles created by pipeline Step 8
const CAPTION_CHAR_STYLES = new Set(["FigureCitation", "TableCitation", "FIG-NUM", "TN"]);

function isPipelineCharStyle(cls: string): boolean {
  if (!cls || cls.startsWith("tc-") || cls.startsWith("occurrence-")) return false;
  // Equation wrappers belong to MathNode — never treat them as a char style.
  if (cls === "math-node") return false;
  if (cls.startsWith("bib_") || cls.startsWith("cite_")) return true;
  if (CAPTION_CHAR_STYLES.has(cls)) return true;
  if (/^[a-z0-9_-]+$/i.test(cls) && cls.length > 1) return true; // formatting styles: bold, italic, kt, sansitalic, etc.
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
          // This rule outranks MathNode (priority 60 vs 50). Claiming an
          // equation span here turned it into a mark, dropped its data-omml,
          // and made convertMathForSave delete the equation on save.
          if (
            element.classList.contains("math-node") ||
            element.hasAttribute("data-omml") ||
            element.hasAttribute("data-mathml") ||
            element.hasAttribute("data-latex")
          ) {
            return false;
          }
          const className = element.getAttribute("class") || "";
          const classes = className.trim().split(/\s+/);
          const match = classes.find(isPipelineCharStyle);
          return match ? { class: match } : false;
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes), 0];
  },
});
