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
      setWholeWord: (enabled: boolean) => ReturnType;
      setRegexMode: (enabled: boolean) => ReturnType;
      setCaseSensitive: (enabled: boolean) => ReturnType;
    }
  }
}

export const searchReplaceKey = new PluginKey("searchReplace");

export interface SearchReplaceResult {
  from: number;
  to: number;
  // When regex mode is on, captured groups are retained so Save-as-rule
  // can preview the first match with its \1, \2 ... expansion.
  groups?: string[];
}

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

/**
 * Build the search regex. In literal mode the term is escaped; in regex
 * mode it is compiled raw and ``error`` captures any SyntaxError so the
 * UI can show it inline without the extension throwing on every keystroke.
 */
function buildRegex(
  term: string,
  opts: { regexMode: boolean; wholeWord: boolean; caseSensitive: boolean }
): { regex: RegExp | null; error: string | null } {
  if (!term) return { regex: null, error: null };
  try {
    let pattern: string;
    if (opts.regexMode) {
      pattern = opts.wholeWord ? `\\b(?:${term})\\b` : term;
    } else {
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      pattern = opts.wholeWord ? `\\b${escaped}\\b` : escaped;
    }
    const flags = opts.caseSensitive ? "g" : "gi";
    return { regex: new RegExp(pattern, flags), error: null };
  } catch (err: any) {
    return { regex: null, error: err?.message ?? "Invalid regex" };
  }
}

export const SearchReplace = Extension.create({
  name: "searchReplace",

  addStorage() {
    return {
      searchTerm: "",
      results: [] as SearchReplaceResult[],
      activeIndex: -1,
      caseSensitive: false,
      wholeWord: false,
      regexMode: false,
      error: null as string | null,
    };
  },

  addCommands() {
    return {
      setSearchTerm: (term: string) => ({ state, dispatch }) => {
        const storage = this.storage;
        storage.searchTerm = term;
        storage.results = [];
        storage.activeIndex = -1;
        storage.error = null;

        if (term) {
          const { regex, error } = buildRegex(term, {
            regexMode: !!storage.regexMode,
            wholeWord: !!storage.wholeWord,
            caseSensitive: !!storage.caseSensitive,
          });
          if (error) {
            storage.error = error;
          } else if (regex) {
            const results: SearchReplaceResult[] = [];
            // Hard safety cap — a careless `.*` in regex mode on a big doc
            // can produce tens of thousands of matches and lock the UI.
            const MAX_RESULTS = 5000;
            let aborted = false;

            state.doc.descendants((node, pos) => {
              if (aborted) return false;
              if (node.isText && node.text) {
                let match;
                regex.lastIndex = 0;
                while ((match = regex.exec(node.text)) !== null) {
                  // Zero-width matches (e.g. `\b` with punctuation, or an
                  // empty-matchable regex pattern) advance manually.
                  if (match[0].length === 0) { regex.lastIndex++; continue; }
                  results.push({
                    from: pos + match.index,
                    to: pos + match.index + match[0].length,
                    groups: match.slice(1),
                  });
                  if (results.length >= MAX_RESULTS) {
                    aborted = true;
                    break;
                  }
                }
              }
              return !aborted;
            });

            storage.results = results;
            if (aborted) {
              storage.error = `Too many matches (showing first ${MAX_RESULTS}). Narrow the pattern.`;
            }
            if (results.length > 0) {
              storage.activeIndex = 0;
            }
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

      setWholeWord: (enabled: boolean) => ({ dispatch }) => {
        const storage = this.storage;
        storage.wholeWord = !!enabled;
        if (storage.searchTerm) {
          this.editor.commands.setSearchTerm(storage.searchTerm);
        } else if (dispatch) {
          dispatch(this.editor.state.tr.setMeta("searchReplaceUpdate", true));
        }
        return true;
      },

      setRegexMode: (enabled: boolean) => ({ dispatch }) => {
        const storage = this.storage;
        storage.regexMode = !!enabled;
        if (storage.searchTerm) {
          this.editor.commands.setSearchTerm(storage.searchTerm);
        } else if (dispatch) {
          dispatch(this.editor.state.tr.setMeta("searchReplaceUpdate", true));
        }
        return true;
      },

      setCaseSensitive: (enabled: boolean) => ({ dispatch }) => {
        const storage = this.storage;
        storage.caseSensitive = !!enabled;
        if (storage.searchTerm) {
          this.editor.commands.setSearchTerm(storage.searchTerm);
        } else if (dispatch) {
          dispatch(this.editor.state.tr.setMeta("searchReplaceUpdate", true));
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
        // Regex mode supports $1, $2 ... backreferences via the captured
        // groups snapshot. Literal mode replaces verbatim.
        const replacement = storage.regexMode
          ? expandBackrefs(text, active.groups ?? [])
          : text;

        if (dispatch) {
          const tr = state.tr;
          tr.insertText(replacement, active.from, active.to);
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
            const replacement = storage.regexMode
              ? expandBackrefs(text, res.groups ?? [])
              : text;
            tr.insertText(replacement, res.from, res.to);
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

              const decos = results.map((res: SearchReplaceResult, index: number) => {
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

/** Expand ``$1``, ``$2`` ... in ``template`` using the given captured groups.
 * Wrap the whole pattern in a group and use ``$1`` if you want the full
 * match in the replacement — we don't support ``$&`` to keep semantics
 * aligned with Python ``re.Match.expand`` which is what the backend uses
 * when the rule later fires through the engine. */
function expandBackrefs(template: string, groups: string[]): string {
  return template.replace(/\$(\d{1,2})/g, (_m, key) => {
    const idx = parseInt(key, 10);
    if (Number.isNaN(idx) || idx < 1) return "";
    return groups[idx - 1] ?? "";
  });
}
