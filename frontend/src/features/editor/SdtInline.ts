import { Node, mergeAttributes } from "@tiptap/core";

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    sdtInline: {
      toggleSdtInline: (alias: string, tag: string) => ReturnType;
      unsetSdtInline: () => ReturnType;
    }
  }
}

export const SdtInline = Node.create({
  name: "sdtInline",
  group: "inline",
  inline: true,
  content: "inline*",
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
        tag: "span.sdt-inline",
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes, { class: "sdt-inline" }), 0];
  },

  addCommands() {
    return {
      toggleSdtInline: (alias: string, tag: string) => ({ commands }) => {
        return commands.wrapIn(this.name, { alias, tag });
      },
      unsetSdtInline: () => ({ commands }) => {
        return commands.lift(this.name);
      },
    };
  },
});

