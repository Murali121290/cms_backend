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
              const date = new Date().toISOString();
              const changeId = crypto.randomUUID();

              if (!empty) {
                const tr = state.tr.addMark(from, to, state.schema.marks.del.create({ author, date, changeId }));
                tr.setSelection(Selection.near(tr.doc.resolve(to)));
                tr.setMeta("preventTrackChanges", true);
                dispatch(tr);
                return true;
              } else {
                if (from > 1) {
                  const charFrom = from - 1;
                  const tr = state.tr.addMark(charFrom, from, state.schema.marks.del.create({ author, date, changeId }));
                  tr.setSelection(Selection.near(tr.doc.resolve(charFrom)));
                  tr.setMeta("preventTrackChanges", true);
                  dispatch(tr);
                  return true;
                }
              }
            }

            if (event.key === "Delete") {
              const author = extension.storage.author || "Unknown";
              const date = new Date().toISOString();
              const changeId = crypto.randomUUID();

              if (!empty) {
                const tr = state.tr.addMark(from, to, state.schema.marks.del.create({ author, date, changeId }));
                tr.setSelection(Selection.near(tr.doc.resolve(from)));
                tr.setMeta("preventTrackChanges", true);
                dispatch(tr);
                return true;
              } else {
                if (from < state.doc.content.size - 1) {
                  const charTo = from + 1;
                  const tr = state.tr.addMark(from, charTo, state.schema.marks.del.create({ author, date, changeId }));
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
                const date = new Date().toISOString();
                const changeId = crypto.randomUUID();

                const tr = state.tr.addMark(from, to, state.schema.marks.del.create({ author, date, changeId }));
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
            const date = new Date().toISOString();
            const changeId = crypto.randomUUID();

            transaction.steps.forEach((step) => {
              const map = step.getMap();
              map.forEach((_from, _to, newFrom, newTo) => {
                if (newTo > newFrom) {
                  const mappedFrom = tr.mapping.map(newFrom);
                  const mappedTo = tr.mapping.map(newTo);

                  tr.addMark(mappedFrom, mappedTo, newState.schema.marks.ins.create({ author, date, changeId }));
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
