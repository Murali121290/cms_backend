// ReferenceHighlight — paints a single "selected"-style decoration over
// the First Definition · Reference range when the user clicks the
// reference row in an abbreviation group. Uses the exact same CSS
// classes as a selected abbreviation finding (``occurrence-highlight
// occurrence-highlight-selected occurrence-abbreviations
// occurrence-abbreviations-selected``) so the green outline + fill is
// visually identical to the Repeated Definition row's highlight.
//
// A reference target is identified by (paraIdx, startOffset, endOffset)
// against the editor's DOCX paragraph indexing. Set via a transaction
// meta on ``referenceHighlightKey``; set to ``null`` to clear.
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

export interface ReferenceTarget {
  paraIndex: number;
  startOffset: number;
  endOffset: number;
}

interface ReferenceHighlightState {
  decorations: DecorationSet;
  target: ReferenceTarget | null;
}

export const referenceHighlightKey = new PluginKey<ReferenceHighlightState>(
  "referenceHighlight",
);

function buildDecorations(
  doc: any,
  target: ReferenceTarget | null,
): DecorationSet {
  if (!target) return DecorationSet.empty;
  let fromPos: number | null = null;
  let toPos: number | null = null;
  doc.descendants((node: any, pos: number) => {
    if (fromPos !== null) return false;
    if (
      !node.isBlock ||
      !(node.type.name === "paragraph" || node.type.name.startsWith("heading"))
    ) {
      return true;
    }
    const raw = node.attrs?.paraIdx;
    const pi = raw != null ? parseInt(String(raw), 10) : NaN;
    if (!Number.isFinite(pi) || pi !== target.paraIndex) return true;
    const size = node.content.size;
    const s = Math.max(0, Math.min(size, target.startOffset));
    const e = Math.max(s, Math.min(size, target.endOffset));
    if (e <= s) return false;
    fromPos = pos + 1 + s;
    toPos = pos + 1 + e;
    return false;
  });
  if (fromPos === null || toPos === null) return DecorationSet.empty;
  // Mirror the finding-selected class set so .occurrence-highlight-selected
  // CSS (green fill + outline) applies with identical visual weight.
  const classes = [
    "occurrence-highlight",
    "occurrence-highlight-selected",
    "occurrence-abbreviations",
    "occurrence-abbreviations-selected",
    "occurrence-reference",
  ].join(" ");
  const dec = Decoration.inline(fromPos, toPos, {
    class: classes,
    "data-reference-highlight": "true",
  });
  return DecorationSet.create(doc, [dec]);
}

export const ReferenceHighlight = Extension.create({
  name: "referenceHighlight",

  addProseMirrorPlugins() {
    return [
      new Plugin<ReferenceHighlightState>({
        key: referenceHighlightKey,
        state: {
          init() {
            return { decorations: DecorationSet.empty, target: null };
          },
          apply(tr, pluginState, _oldState, newState) {
            const meta = tr.getMeta(referenceHighlightKey);
            let target = pluginState.target;
            let changed = false;
            if (meta !== undefined) {
              // meta can be ``null`` to clear.
              target = meta as ReferenceTarget | null;
              changed = true;
            }
            if (tr.docChanged) changed = true;
            if (!changed) return pluginState;
            return {
              decorations: buildDecorations(newState.doc, target),
              target,
            };
          },
        },
        props: {
          decorations(state) {
            return (
              referenceHighlightKey.getState(state)?.decorations ??
              DecorationSet.empty
            );
          },
        },
      }),
    ];
  },
});
