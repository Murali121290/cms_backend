import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";
import { SPECIAL_SPACE_NAMES } from "./specialCharacters";

// On-screen only: highlights en/em/thin/non-breaking (etc.) spaces so editors
// can tell them apart from ordinary spaces. Decorations never reach getHTML()
// or the saved DOCX.

const SPACE_CHARS = Object.keys(SPECIAL_SPACE_NAMES);
const SPACE_RE = new RegExp(`[${SPACE_CHARS.join("")}]`, "g");
const NBSP_LIKE = new Set([" ", " "]);

export const specialSpaceMarksKey = new PluginKey("specialSpaceMarks");

function buildDecorations(doc: PMNode): DecorationSet {
  const decos: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    SPACE_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = SPACE_RE.exec(node.text))) {
      const ch = m[0];
      const from = pos + m.index;
      decos.push(
        Decoration.inline(from, from + 1, {
          class: `special-space${NBSP_LIKE.has(ch) ? " special-space--nbsp" : ""}`,
          title: SPECIAL_SPACE_NAMES[ch],
        }),
      );
    }
  });
  return DecorationSet.create(doc, decos);
}

export const SpecialSpaceMarks = Extension.create({
  name: "specialSpaceMarks",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: specialSpaceMarksKey,
        state: {
          init: (_, state) => buildDecorations(state.doc),
          apply: (tr, old) => (tr.docChanged ? buildDecorations(tr.doc) : old),
        },
        props: {
          decorations(state) {
            return specialSpaceMarksKey.getState(state);
          },
        },
      }),
    ];
  },
});
