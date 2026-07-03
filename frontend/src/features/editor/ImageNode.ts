import { Node, mergeAttributes } from "@tiptap/core";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    imageNode: {
      insertImage: (options: { src: string; alt?: string; title?: string }) => ReturnType;
    };
  }
}

function parseNumberAttr(value: string | null): number | null {
  if (!value) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Bare block-level image node so pasted images render in the editor and
 * round-trip through the XHTML → DOCX save. Editing (crop/rotate/etc.) lives
 * in the dedicated Image Editor page, not the document editor toolbar.
 */
export const ImageNode = Node.create({
  name: "image",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      src: {
        default: "",
        parseHTML: (el) => el.getAttribute("src") ?? "",
        renderHTML: (attrs) => (attrs.src ? { src: attrs.src } : {}),
      },
      alt: {
        default: null,
        parseHTML: (el) => el.getAttribute("alt"),
        renderHTML: (attrs) => (attrs.alt ? { alt: attrs.alt } : {}),
      },
      title: {
        default: null,
        parseHTML: (el) => el.getAttribute("title"),
        renderHTML: (attrs) => (attrs.title ? { title: attrs.title } : {}),
      },
      width: {
        default: null,
        parseHTML: (el) => parseNumberAttr(el.getAttribute("width")),
        renderHTML: (attrs) => (attrs.width ? { width: String(attrs.width) } : {}),
      },
      height: {
        default: null,
        parseHTML: (el) => parseNumberAttr(el.getAttribute("height")),
        renderHTML: (attrs) => (attrs.height ? { height: String(attrs.height) } : {}),
      },
    };
  },

  parseHTML() {
    return [{ tag: "img[src]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["img", mergeAttributes(HTMLAttributes)];
  },

  addCommands() {
    return {
      insertImage:
        ({ src, alt, title }) =>
        ({ chain }) =>
          chain()
            .insertContent({
              type: this.name,
              attrs: { src, alt: alt ?? null, title: title ?? null },
            })
            .run(),
    };
  },
});
