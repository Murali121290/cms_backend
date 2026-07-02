import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { ImageNodeView } from "./ImageNodeView";

export type CropRect = { x: number; y: number; w: number; h: number } | null;

export interface ImageAttrs {
  src: string;
  alt: string | null;
  title: string | null;
  width: number | null;
  height: number | null;
  originalSrc: string | null;
  rotation: number;
  flipH: boolean;
  flipV: boolean;
  brightness: number;
  contrast: number;
  cropRect: CropRect;
}

export const IMAGE_DEFAULT_ATTRS = {
  rotation: 0,
  flipH: false,
  flipV: false,
  brightness: 1,
  contrast: 1,
  cropRect: null as CropRect,
};

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

function parseBoolAttr(value: string | null): boolean {
  return value === "true" || value === "1";
}

function parseCropAttr(value: string | null): CropRect {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    if (
      parsed &&
      typeof parsed.x === "number" &&
      typeof parsed.y === "number" &&
      typeof parsed.w === "number" &&
      typeof parsed.h === "number"
    ) {
      return parsed as CropRect;
    }
  } catch {
    // ignore
  }
  return null;
}

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
      originalSrc: {
        default: null,
        parseHTML: (el) =>
          el.getAttribute("data-original-src") ?? el.getAttribute("src") ?? null,
        renderHTML: (attrs) =>
          attrs.originalSrc ? { "data-original-src": attrs.originalSrc } : {},
      },
      rotation: {
        default: 0,
        parseHTML: (el) => parseNumberAttr(el.getAttribute("data-rotation")) ?? 0,
        renderHTML: (attrs) =>
          attrs.rotation ? { "data-rotation": String(attrs.rotation) } : {},
      },
      flipH: {
        default: false,
        parseHTML: (el) => parseBoolAttr(el.getAttribute("data-flip-h")),
        renderHTML: (attrs) => (attrs.flipH ? { "data-flip-h": "true" } : {}),
      },
      flipV: {
        default: false,
        parseHTML: (el) => parseBoolAttr(el.getAttribute("data-flip-v")),
        renderHTML: (attrs) => (attrs.flipV ? { "data-flip-v": "true" } : {}),
      },
      brightness: {
        default: 1,
        parseHTML: (el) => parseNumberAttr(el.getAttribute("data-brightness")) ?? 1,
        renderHTML: (attrs) =>
          attrs.brightness !== 1
            ? { "data-brightness": String(attrs.brightness) }
            : {},
      },
      contrast: {
        default: 1,
        parseHTML: (el) => parseNumberAttr(el.getAttribute("data-contrast")) ?? 1,
        renderHTML: (attrs) =>
          attrs.contrast !== 1 ? { "data-contrast": String(attrs.contrast) } : {},
      },
      cropRect: {
        default: null,
        parseHTML: (el) => parseCropAttr(el.getAttribute("data-crop")),
        renderHTML: (attrs) =>
          attrs.cropRect ? { "data-crop": JSON.stringify(attrs.cropRect) } : {},
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: "img[src]",
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ["img", mergeAttributes(HTMLAttributes)];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ImageNodeView);
  },

  addCommands() {
    return {
      insertImage:
        ({ src, alt, title }) =>
        ({ chain }) =>
          chain()
            .insertContent({
              type: this.name,
              attrs: {
                src,
                alt: alt ?? null,
                title: title ?? null,
                originalSrc: src,
              },
            })
            .run(),
    };
  },
});
