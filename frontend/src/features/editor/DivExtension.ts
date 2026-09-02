import { Node, mergeAttributes } from "@tiptap/core";

export const DivExtension = Node.create({
  name: "div",

  group: "block",

  content: "block+",

  defining: true,

  addAttributes() {
    return {
      "data-xml-tag": {
        default: null,
        parseHTML: (element) => element.getAttribute("data-xml-tag"),
        renderHTML: (attributes) => {
          if (!attributes["data-xml-tag"]) return {};
          return { "data-xml-tag": attributes["data-xml-tag"] };
        },
      },
      "disp-level": {
        default: null,
        parseHTML: (element) => element.getAttribute("disp-level"),
        renderHTML: (attributes) => {
          if (!attributes["disp-level"]) return {};
          return { "disp-level": attributes["disp-level"] };
        },
      },
      id: {
        default: null,
        parseHTML: (element) => element.getAttribute("id"),
        renderHTML: (attributes) => {
          if (!attributes.id) return {};
          return { id: attributes.id };
        },
      },
      class: {
        default: null,
        parseHTML: (element) => element.getAttribute("class"),
        renderHTML: (attributes) => {
          if (!attributes.class) return {};
          return { class: attributes.class };
        },
      },
    };
  },

  parseHTML() {
    return [
      { tag: "div" },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes), 0];
  },
});
