import { Extension, Mark, mergeAttributes } from "@tiptap/core";
import { Plugin, PluginKey, Selection } from "@tiptap/pm/state";
import { DecorationSet, Decoration } from "@tiptap/pm/view";

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    trackChanges: {
      acceptChange: (pos?: number) => ReturnType;
      rejectChange: (pos?: number) => ReturnType;
      acceptAllChanges: () => ReturnType;
      rejectAllChanges: () => ReturnType;
    }
  }
}

// ── Define Ins Mark ──────────────────────────────────────────────────────────
export const Ins = Mark.create({
  name: "ins",
  // Non-inclusive: the mark must NOT extend to typing that happens at its
  // left/right boundary. ProseMirror's default (``inclusive: true``) causes
  // ``storedMarks`` to carry the mark when the caret sits at the boundary,
  // so the next keystroke would inherit the previous insertion's attrs. For
  // Track Changes that would double-mark new typing (the appendTransaction
  // below adds its own fresh ins mark), and when the caret sits adjacent to
  // a <del> run it would render typed characters as strikethrough-red AND
  // underline-green at the same time. Setting ``inclusive: false`` on both
  // sides is what Word-style track changes expect.
  inclusive: false,
  addAttributes() {
    return {
      author: {
        default: "Unknown",
        parseHTML: element => element.getAttribute("data-author") || "Unknown",
        renderHTML: attributes => ({ "data-author": attributes.author }),
      },
      date: {
        default: null,
        parseHTML: element => element.getAttribute("data-date"),
        renderHTML: attributes => attributes.date ? { "data-date": attributes.date } : {},
      },
      changeId: {
        default: null,
        parseHTML: element => element.getAttribute("data-change-id"),
        renderHTML: attributes => attributes.changeId ? { "data-change-id": attributes.changeId } : {},
      },
    };
  },
  parseHTML() {
    return [
      { tag: "ins" },
      { tag: "span", getAttrs: (node) => (node as HTMLElement).classList.contains("tc-insert") && null },
    ];
  },
  renderHTML({ HTMLAttributes }) {
    return ["ins", mergeAttributes(HTMLAttributes, { class: "tc-insert" }), 0];
  },
});

// ── Define Del Mark ──────────────────────────────────────────────────────────
export const Del = Mark.create({
  name: "del",
  // Same rationale as ``Ins`` — the caret sitting at the end of a <del> run
  // (e.g. right after the user Backspace-deletes a word) must not inherit
  // the del mark onto the next typed character. Default ``inclusive: true``
  // would make the first replacement character render as strikethrough on
  // top of its green insertion styling.
  inclusive: false,
  addAttributes() {
    return {
      author: {
        default: "Unknown",
        parseHTML: element => element.getAttribute("data-author") || "Unknown",
        renderHTML: attributes => ({ "data-author": attributes.author }),
      },
      date: {
        default: null,
        parseHTML: element => element.getAttribute("data-date"),
        renderHTML: attributes => attributes.date ? { "data-date": attributes.date } : {},
      },
      changeId: {
        default: null,
        parseHTML: element => element.getAttribute("data-change-id"),
        renderHTML: attributes => attributes.changeId ? { "data-change-id": attributes.changeId } : {},
      },
    };
  },
  parseHTML() {
    return [
      { tag: "del" },
      { tag: "span", getAttrs: (node) => (node as HTMLElement).classList.contains("tc-delete") && null },
    ];
  },
  renderHTML({ HTMLAttributes }) {
    return ["del", mergeAttributes(HTMLAttributes, { class: "tc-delete" }), 0];
  },
});

const trackChangesKey = new PluginKey<DecorationSet>("trackChanges");

// Look for an existing ins/del mark from the same author on the character
// immediately before `from` or immediately after `to`. When one is found we
// reuse its (author, date, changeId) so the new mark merges with it in
// ProseMirror's mark set — otherwise every keystroke would carry a fresh
// UUID and the DOM would fragment into one <ins>/<del> element per
// character. With per-element CSS padding on ``.tc-delete`` that fragmentation
// shows up as visible gaps between letters ("T H E  S T U D Y"); on the
// insertion side it causes discontinuous underlining and jittery kerning.
// Collapsing runs into a single DOM element also makes Accept/Reject operate
// on the whole edit session (one logical change) the way Word does.
export function findSessionChangeAttrs(
  doc: any,
  from: number,
  to: number,
  markName: "ins" | "del",
  author: string,
): { author: string; date: string; changeId: string } | null {
  const pickMark = (node: any) => {
    if (!node || !node.marks) return null;
    const m = node.marks.find(
      (mk: any) => mk.type.name === markName && mk.attrs.author === author,
    );
    if (!m) return null;
    return {
      author: m.attrs.author,
      date: m.attrs.date,
      changeId: m.attrs.changeId,
    };
  };
  try {
    if (from > 0) {
      const attrs = pickMark(doc.resolve(from).nodeBefore);
      if (attrs) return attrs;
    }
  } catch { /* position may be invalid mid-transaction; fall through */ }
  try {
    if (to < doc.content.size) {
      const attrs = pickMark(doc.resolve(to).nodeAfter);
      if (attrs) return attrs;
    }
  } catch { /* ignore */ }
  return null;
}

export function collectChanges(doc: any) {
  const changes: {
    from: number;
    to: number;
    type: "ins" | "del";
    text: string;
    author: string;
    date: string;
    changeId: string;
  }[] = [];

  doc.descendants((node: any, pos: number) => {
    if (!node.isText) return true;

    const insMark = node.marks.find((m: any) => m.type.name === "ins");
    const delMark = node.marks.find((m: any) => m.type.name === "del");
    const activeMark = insMark || delMark;

    if (activeMark) {
      const type = insMark ? "ins" : "del";
      const { author, date, changeId } = activeMark.attrs;
      const text = node.text || "";

      changes.push({
        from: pos,
        to: pos + node.nodeSize,
        type,
        text,
        author: author || "Unknown",
        date: date || "",
        changeId: changeId || "",
      });
    }
    return false;
  });

  const coalesced: typeof changes = [];
  for (const change of changes) {
    if (coalesced.length > 0) {
      const last = coalesced[coalesced.length - 1];
      if (
        last.to === change.from &&
        last.type === change.type &&
        last.changeId === change.changeId
      ) {
        last.to = change.to;
        last.text += change.text;
        continue;
      }
    }
    coalesced.push(change);
  }

  return coalesced;
}

export const TrackChanges = Extension.create({
  name: "trackChanges",

  addStorage() {
    return {
      enabled: false,
      author: "Unknown",
    };
  },

  addExtensions() {
    return [Ins, Del];
  },

  addCommands() {
    return {
      acceptChange: (pos?: number) => ({ state, dispatch }) => {
        const targetPos = pos !== undefined ? pos : state.selection.from;
        const changes = collectChanges(state.doc);
        const change = changes.find(c => c.from <= targetPos && targetPos <= c.to);
        if (!change) return false;

        if (dispatch) {
          const tr = state.tr;
          tr.setMeta("preventTrackChanges", true);
          if (change.type === "ins") {
            tr.removeMark(change.from, change.to, state.schema.marks.ins);
          } else {
            tr.delete(change.from, change.to);
          }
          dispatch(tr);
        }
        return true;
      },
      rejectChange: (pos?: number) => ({ state, dispatch }) => {
        const targetPos = pos !== undefined ? pos : state.selection.from;
        const changes = collectChanges(state.doc);
        const change = changes.find(c => c.from <= targetPos && targetPos <= c.to);
        if (!change) return false;

        if (dispatch) {
          const tr = state.tr;
          tr.setMeta("preventTrackChanges", true);
          if (change.type === "ins") {
            tr.delete(change.from, change.to);
          } else {
            tr.removeMark(change.from, change.to, state.schema.marks.del);
          }
          dispatch(tr);
        }
        return true;
      },
      acceptAllChanges: () => ({ state, dispatch }) => {
        const changes = collectChanges(state.doc);
        if (changes.length === 0) return false;

        if (dispatch) {
          const tr = state.tr;
          tr.setMeta("preventTrackChanges", true);

          // Accept insertions first: just remove the "ins" mark (no position shift).
          const insChanges = changes.filter(c => c.type === "ins");
          insChanges.forEach(c => {
            const mappedFrom = tr.mapping.map(c.from);
            const mappedTo = tr.mapping.map(c.to);
            tr.removeMark(mappedFrom, mappedTo, state.schema.marks.ins);
          });

          // Delete deletions from highest to lowest position so each delete
          // does not shift positions of later (lower-index) deletes.
          const delChanges = changes
            .filter(c => c.type === "del")
            .sort((a, b) => b.from - a.from);
          delChanges.forEach(c => {
            // Re-map position through all prior steps in this transaction.
            const mappedFrom = tr.mapping.map(c.from);
            const mappedTo = tr.mapping.map(c.to);
            if (mappedFrom < mappedTo) {
              tr.delete(mappedFrom, mappedTo);
            }
          });

          dispatch(tr);
        }
        return true;
      },
      rejectAllChanges: () => ({ state, dispatch }) => {
        const changes = collectChanges(state.doc);
        if (changes.length === 0) return false;

        if (dispatch) {
          const tr = state.tr;
          tr.setMeta("preventTrackChanges", true);

          // Reject deletions first: just remove the "del" mark (no position shift).
          const delChanges = changes.filter(c => c.type === "del");
          delChanges.forEach(c => {
            const mappedFrom = tr.mapping.map(c.from);
            const mappedTo = tr.mapping.map(c.to);
            tr.removeMark(mappedFrom, mappedTo, state.schema.marks.del);
          });

          // Delete insertions from highest to lowest position so each delete
          // does not shift positions of later (lower-index) deletes.
          const insChanges = changes
            .filter(c => c.type === "ins")
            .sort((a, b) => b.from - a.from);
          insChanges.forEach(c => {
            // Re-map position through all prior steps in this transaction.
            const mappedFrom = tr.mapping.map(c.from);
            const mappedTo = tr.mapping.map(c.to);
            if (mappedFrom < mappedTo) {
              tr.delete(mappedFrom, mappedTo);
            }
          });

          dispatch(tr);
        }
        return true;
      },
    };
  },

  addProseMirrorPlugins() {
    const extension = this;

    return [
      new Plugin({
        key: trackChangesKey,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, decorations, _oldState, newState) {
            decorations = decorations.map(tr.mapping, newState.doc);

            if (!extension.storage.enabled || !tr.docChanged) {
              return decorations;
            }

            tr.steps.forEach((step) => {
              step.getMap().forEach((_f, _t, from, to) => {
                if (to > from) {
                  decorations = decorations.add(newState.doc, [
                    Decoration.inline(from, to, { class: "tc-insert" }),
                  ]);
                }
              });
            });

            return decorations;
          },
        },
        props: {
          decorations: (state) =>
            trackChangesKey.getState(state) ?? DecorationSet.empty,

          handleKeyDown(view, event) {
            if (!extension.storage.enabled) return false;

            const { state, dispatch } = view;
            const { selection } = state;
            const { empty, from, to } = selection;

            if (event.key === "Backspace") {
              const author = extension.storage.author || "Unknown";
              const freshAttrs = () => ({
                author,
                date: new Date().toISOString(),
                changeId: crypto.randomUUID(),
              });

              if (!empty) {
                const attrs =
                  findSessionChangeAttrs(state.doc, from, to, "del", author) ??
                  freshAttrs();
                const tr = state.tr.addMark(from, to, state.schema.marks.del.create(attrs));
                tr.setSelection(Selection.near(tr.doc.resolve(to)));
                tr.setMeta("preventTrackChanges", true);
                dispatch(tr);
                return true;
              } else {
                if (from > 1) {
                  const charFrom = from - 1;
                  const attrs =
                    findSessionChangeAttrs(state.doc, charFrom, from, "del", author) ??
                    freshAttrs();
                  const tr = state.tr.addMark(charFrom, from, state.schema.marks.del.create(attrs));
                  tr.setSelection(Selection.near(tr.doc.resolve(charFrom)));
                  tr.setMeta("preventTrackChanges", true);
                  dispatch(tr);
                  return true;
                }
              }
            }

            if (event.key === "Delete") {
              const author = extension.storage.author || "Unknown";
              const freshAttrs = () => ({
                author,
                date: new Date().toISOString(),
                changeId: crypto.randomUUID(),
              });

              if (!empty) {
                const attrs =
                  findSessionChangeAttrs(state.doc, from, to, "del", author) ??
                  freshAttrs();
                const tr = state.tr.addMark(from, to, state.schema.marks.del.create(attrs));
                tr.setSelection(Selection.near(tr.doc.resolve(from)));
                tr.setMeta("preventTrackChanges", true);
                dispatch(tr);
                return true;
              } else {
                if (from < state.doc.content.size - 1) {
                  const charTo = from + 1;
                  const attrs =
                    findSessionChangeAttrs(state.doc, from, charTo, "del", author) ??
                    freshAttrs();
                  const tr = state.tr.addMark(from, charTo, state.schema.marks.del.create(attrs));
                  tr.setSelection(Selection.near(tr.doc.resolve(charTo)));
                  tr.setMeta("preventTrackChanges", true);
                  dispatch(tr);
                  return true;
                }
              }
            }

            return false;
          },

          handleDOMEvents: {
            cut(view, event) {
              if (!extension.storage.enabled) return false;

              const { state, dispatch } = view;
              const { selection } = state;
              const { empty, from, to } = selection;

              if (!empty) {
                const text = state.doc.textBetween(from, to);
                event.clipboardData?.setData("text/plain", text);

                const author = extension.storage.author || "Unknown";
                const attrs =
                  findSessionChangeAttrs(state.doc, from, to, "del", author) ?? {
                    author,
                    date: new Date().toISOString(),
                    changeId: crypto.randomUUID(),
                  };

                const tr = state.tr.addMark(from, to, state.schema.marks.del.create(attrs));
                tr.setMeta("preventTrackChanges", true);
                dispatch(tr);

                event.preventDefault();
                return true;
              }
              return false;
            },
          },
        },

        appendTransaction(transactions, oldState, newState) {
          const isEnabled = extension.storage.enabled;
          if (!isEnabled) return;

          const docChanged = transactions.some((tr) => tr.docChanged);
          if (!docChanged) return;

          const tr = newState.tr;
          let modified = false;

          transactions.forEach((transaction) => {
            if (transaction.getMeta("preventTrackChanges") || transaction.getMeta("addToHistory") === false) {
              return;
            }

            const author = extension.storage.author || "Unknown";
            // Per-transaction default used only when no adjacent ins run
            // exists to extend. Keeping it per-transaction (rather than
            // per-step) preserves the previous behaviour where multiple
            // simultaneous inserts in one transaction share a changeId.
            let defaultAttrs: { author: string; date: string; changeId: string } | null = null;
            const takeDefaultAttrs = () => {
              if (!defaultAttrs) {
                defaultAttrs = {
                  author,
                  date: new Date().toISOString(),
                  changeId: crypto.randomUUID(),
                };
              }
              return defaultAttrs;
            };

            transaction.steps.forEach((step) => {
              const map = step.getMap();
              map.forEach((_from, _to, newFrom, newTo) => {
                if (newTo > newFrom) {
                  const mappedFrom = tr.mapping.map(newFrom);
                  const mappedTo = tr.mapping.map(newTo);

                  // Reuse an adjacent ins run's attrs when the caret is
                  // continuing the same author's insertion. This makes
                  // consecutive keystrokes collapse into a single <ins>
                  // DOM element instead of one <ins> per character.
                  const attrs =
                    findSessionChangeAttrs(tr.doc, mappedFrom, mappedTo, "ins", author) ??
                    takeDefaultAttrs();
                  tr.addMark(mappedFrom, mappedTo, newState.schema.marks.ins.create(attrs));
                  modified = true;
                }
              });
            });
          });

          if (modified) {
            tr.setMeta("preventTrackChanges", true);
            return tr;
          }
        },
      }),
    ];
  },
});
