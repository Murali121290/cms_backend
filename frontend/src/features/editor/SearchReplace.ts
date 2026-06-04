import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, Selection } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    searchReplace: {
      setSearchTerm: (term: string) => ReturnType;
      findNext: () => ReturnType;
      findPrev: () => ReturnType;
      replaceCurrent: (text: string) => ReturnType;
      replaceAll: (text: string) => ReturnType;
    }
  }
}

export const searchReplaceKey = new PluginKey("searchReplace");

const scrollToPos = (view: any, pos: number) => {
  try {
    const domInfo = view.domAtPos(pos);
    const el = domInfo.node.nodeType === Node.TEXT_NODE
      ? domInfo.node.parentElement
      : (domInfo.node as Element);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  } catch (e) {
    // ignore
  }
};

export const SearchReplace = Extension.create({
  name: "searchReplace",

  addStorage() {
    return {
      searchTerm: "",
      results: [] as { from: number; to: number }[],
      activeIndex: -1,
      caseSensitive: false,
    };
  },

  addCommands() {
    return {
      setSearchTerm: (term: string) => ({ state, dispatch }) => {
        const storage = this.storage;
        storage.searchTerm = term;
        storage.results = [];
        storage.activeIndex = -1;

        if (term) {
          const results: { from: number; to: number }[] = [];
          const regex = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");

          state.doc.descendants((node, pos) => {
            if (node.isText && node.text) {
              let match;
              while ((match = regex.exec(node.text)) !== null) {
                results.push({
                  from: pos + match.index,
                  to: pos + match.index + match[0].length,
                });
              }
            }
          });

          storage.results = results;
          if (results.length > 0) {
            storage.activeIndex = 0;
          }
        }

        if (dispatch) {
          dispatch(state.tr.setMeta("searchReplaceUpdate", true));
        }

        if (storage.results.length > 0 && storage.activeIndex !== -1) {
          const active = storage.results[storage.activeIndex];
          if (dispatch) {
            const tr = state.tr.setSelection(
              Selection.near(state.tr.doc.resolve(active.from))
            );
            dispatch(tr);
            setTimeout(() => scrollToPos(this.editor.view, active.from), 50);
          }
        }

        return true;
      },

      findNext: () => ({ state, dispatch }) => {
        const storage = this.storage;
        if (storage.results.length === 0) return false;

        storage.activeIndex = (storage.activeIndex + 1) % storage.results.length;
        const active = storage.results[storage.activeIndex];

        if (dispatch) {
          const tr = state.tr.setSelection(
            Selection.near(state.tr.doc.resolve(active.from))
          );
          dispatch(tr.setMeta("searchReplaceUpdate", true));
          setTimeout(() => scrollToPos(this.editor.view, active.from), 50);
        }

        return true;
      },

      findPrev: () => ({ state, dispatch }) => {
        const storage = this.storage;
        if (storage.results.length === 0) return false;

        storage.activeIndex = (storage.activeIndex - 1 + storage.results.length) % storage.results.length;
        const active = storage.results[storage.activeIndex];

        if (dispatch) {
          const tr = state.tr.setSelection(
            Selection.near(state.tr.doc.resolve(active.from))
          );
          dispatch(tr.setMeta("searchReplaceUpdate", true));
          setTimeout(() => scrollToPos(this.editor.view, active.from), 50);
        }

        return true;
      },

      replaceCurrent: (text: string) => ({ state, dispatch }) => {
        const storage = this.storage;
        if (storage.results.length === 0 || storage.activeIndex === -1) return false;

        const active = storage.results[storage.activeIndex];

        if (dispatch) {
          const tr = state.tr;
          tr.insertText(text, active.from, active.to);
          dispatch(tr);
          const nextTerm = storage.searchTerm;
          this.editor.commands.setSearchTerm(nextTerm);
        }

        return true;
      },

      replaceAll: (text: string) => ({ state, dispatch }) => {
        const storage = this.storage;
        if (storage.results.length === 0) return false;

        if (dispatch) {
          const tr = state.tr;
          const sorted = [...storage.results].sort((a, b) => b.from - a.from);
          sorted.forEach(res => {
            tr.insertText(text, res.from, res.to);
          });
          dispatch(tr);
          this.editor.commands.setSearchTerm("");
        }

        return true;
      },
    };
  },

  addProseMirrorPlugins() {
    const extension = this;

    return [
      new Plugin({
        key: searchReplaceKey,
        state: {
          init() {
            return DecorationSet.empty;
          },
          apply(tr, oldDeco, oldState, newState) {
            if (tr.docChanged || tr.getMeta("searchReplaceUpdate")) {
              const { results, activeIndex } = extension.storage;
              if (results.length === 0) {
                return DecorationSet.empty;
              }

              const decos = results.map((res: { from: number; to: number }, index: number) => {
                const className = index === activeIndex ? "search-result-active" : "search-result";
                return Decoration.inline(res.from, res.to, { class: className });
              });

              return DecorationSet.create(newState.doc, decos);
            }

            return oldDeco.map(tr.mapping, newState.doc);
          },
        },
        props: {
          decorations(state) {
            return searchReplaceKey.getState(state) || DecorationSet.empty;
          },
        },
      }),
    ];
  },
});
