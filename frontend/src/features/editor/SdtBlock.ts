import { Node, mergeAttributes } from "@tiptap/core";

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    sdtBlock: {
      wrapInSdtBlock: (alias: string, tag: string) => ReturnType;
      unwrapSdtBlock: () => ReturnType;
    }
  }
}

export const SdtBlock = Node.create({
  name: "sdtBlock",
  group: "block",
  content: "block+",
  defining: true,

  addAttributes() {
    return {
      alias: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-alias") || "",
        renderHTML: (attributes) => ({
          "data-alias": attributes.alias,
        }),
      },
      tag: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-tag") || "",
        renderHTML: (attributes) => ({
          "data-tag": attributes.tag,
        }),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: "div.sdt-block",
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { class: "sdt-block" }), 0];
  },

  addCommands() {
    return {
      wrapInSdtBlock: (alias: string, tag: string) => ({ commands }) => {
        return commands.wrapIn(this.name, { alias, tag });
      },
      unwrapSdtBlock: () => ({ commands }) => {
        return commands.lift(this.name);
      },
    };
  },
});
