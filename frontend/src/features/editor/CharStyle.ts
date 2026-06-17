import { Mark, mergeAttributes } from "@tiptap/core";

/**
 * CharStyle — preserves bibliography and citation character style class names.
 *
 * This mark prevents class stripping on spans with class names starting with `bib_` or `cite_`.
 */
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
          const match = className.split(" ").find(c => c.startsWith("bib_") || c.startsWith("cite_"));
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
          const hasMatch = className.split(" ").some(c => c.startsWith("bib_") || c.startsWith("cite_"));
          return hasMatch ? null : false;
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes), 0];
  },
});
