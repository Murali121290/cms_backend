import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

export interface Occurrence {
  para_index: number;
  match_start: number;
  match_end: number;
  surface: string;
  category?: string;
  in_stylesheet?: boolean;
}

interface OccurrencePluginState {
  decorations: DecorationSet;
  occurrences: Occurrence[];
  selectedIndex: number;
  // Whitelist of occurrence categories whose decorations should be painted.
  // ``null`` means "no filter" (every occurrence is decorated — the behaviour
  // before category-aware filtering existed). An empty array hides every
  // finding decoration (used by the Comments / Rules tabs which have no
  // occurrence-backed highlights of their own).
  allowedCategories: string[] | null;
}

interface BlockInfo {
  pos: number;
  size: number;
  text: string;
  paraIdx: number | null;
}

const occurrenceHighlightKey = new PluginKey<OccurrencePluginState>("occurrenceHighlight");

export const OccurrenceHighlight = Extension.create({
  name: "occurrenceHighlight",

  addStorage() {
    return {
      occurrences: [] as Occurrence[],
      selectedIndex: -1,
      onOccurrenceClick: null as ((index: number) => void) | null,
      // Mirrors the plugin-state field; used by the apply() fallback path
      // that re-seeds state from storage when an unrelated transaction
      // triggers recompute without a meta payload.
      allowedCategories: null as string[] | null,
    };
  },

  addProseMirrorPlugins() {
    const extension = this;

    return [
      new Plugin<OccurrencePluginState>({
        key: occurrenceHighlightKey,
        state: {
          init() {
            return {
              decorations: DecorationSet.empty,
              occurrences: [] as Occurrence[],
              selectedIndex: -1,
              allowedCategories: null as string[] | null,
            };
          },
          apply(tr, pluginState, oldState, newState) {
            const meta = tr.getMeta(occurrenceHighlightKey) || tr.getMeta("occurrenceHighlight");
            let occurrences = pluginState?.occurrences || extension.storage.occurrences || [];
            let selectedIndex = pluginState?.selectedIndex ?? extension.storage.selectedIndex ?? -1;
            let allowedCategories: string[] | null =
              pluginState?.allowedCategories !== undefined
                ? pluginState.allowedCategories
                : (extension.storage.allowedCategories ?? null);
            let needsRecompute = false;

            if (meta) {
              if (meta.occurrences !== undefined && meta.occurrences !== occurrences) {
                occurrences = meta.occurrences;
                needsRecompute = true;
              }
              if (meta.selectedIndex !== undefined && meta.selectedIndex !== selectedIndex) {
                selectedIndex = meta.selectedIndex;
                needsRecompute = true;
              }
              // `null` is a valid payload ("show everything"), so key off
              // property presence rather than truthiness. Reference compare
              // is enough because the page wraps the array in useMemo keyed
              // on the active category tab.
              if (
                Object.prototype.hasOwnProperty.call(meta, "allowedCategories") &&
                meta.allowedCategories !== allowedCategories
              ) {
                allowedCategories = meta.allowedCategories ?? null;
                needsRecompute = true;
              }
            } else if (
              extension.storage.occurrences &&
              extension.storage.occurrences.length > 0 &&
              extension.storage.occurrences !== occurrences
            ) {
              occurrences = extension.storage.occurrences;
              selectedIndex = extension.storage.selectedIndex ?? -1;
              allowedCategories = extension.storage.allowedCategories ?? null;
              needsRecompute = true;
            }

            if (tr.docChanged) {
              needsRecompute = true;
            }

            if (!needsRecompute && pluginState) {
              return pluginState;
            }

            if (!occurrences || occurrences.length === 0) {
              return {
                decorations: DecorationSet.empty,
                occurrences: [],
                selectedIndex: -1,
                allowedCategories,
              };
            }

            // Build a membership check once per recompute. `null` disables
            // filtering entirely so the "All" tab keeps the pre-filter
            // behaviour verbatim. An empty whitelist ⇒ no occurrence ever
            // passes (used by Comments / Rules tabs).
            const allowedSet = allowedCategories ? new Set(allowedCategories) : null;

            // 1. Collect all block nodes with both sequential index and data-para-idx
            const blocks: BlockInfo[] = [];
            newState.doc.descendants((node, pos) => {
              if (node.isBlock && (node.type.name === "paragraph" || node.type.name.startsWith("heading"))) {
                const rawParaIdx = node.attrs?.paraIdx != null ? parseInt(node.attrs.paraIdx, 10) : null;
                blocks.push({
                  pos,
                  size: node.content.size,
                  text: node.textContent,
                  paraIdx: Number.isFinite(rawParaIdx) ? rawParaIdx : null,
                });
              }
            });

            const decorations: Decoration[] = [];

            // 2. Map each occurrence to the best matching block using content-based & paragraph scoring
            occurrences.forEach((occ: Occurrence, occIndex: number) => {
              if (!occ.surface) return;

              // Category-aware filter. Applied before any match work so
              // hidden-category occurrences cost nothing beyond the Set
              // lookup. Occurrences without a category (e.g. stylesheet
              // term highlights) are treated as uncategorised and hide
              // when any specific whitelist is active — they resurface
              // under the "All" tab (allowedSet === null).
              if (allowedSet) {
                if (!occ.category || !allowedSet.has(occ.category)) return;
              }

              let bestBlock: BlockInfo | null = null;
              let bestScore = Infinity;
              let bestMatchStart = -1;

              for (let blockIdx = 0; blockIdx < blocks.length; blockIdx++) {
                const block = blocks[blockIdx];
                if (!block.text || !block.text.includes(occ.surface)) continue;

                // Para distance: compare against paraIdx if available, else blockIdx
                let paraDistance: number;
                if (block.paraIdx !== null) {
                  paraDistance = Math.abs(block.paraIdx - occ.para_index);
                } else {
                  paraDistance = Math.abs(blockIdx - occ.para_index);
                }

                // Check exact match_start first
                let matchPos = -1;
                if (
                  occ.match_start >= 0 &&
                  occ.match_start + occ.surface.length <= block.text.length &&
                  block.text.substring(occ.match_start, occ.match_start + occ.surface.length) === occ.surface
                ) {
                  matchPos = occ.match_start;
                } else {
                  // Find all occurrences in block.text and pick closest to occ.match_start
                  let searchIdx = 0;
                  let closestDist = Infinity;
                  while (searchIdx <= block.text.length - occ.surface.length) {
                    const foundAt = block.text.indexOf(occ.surface, searchIdx);
                    if (foundAt === -1) break;
                    const dist = Math.abs(foundAt - occ.match_start);
                    if (dist < closestDist) {
                      closestDist = dist;
                      matchPos = foundAt;
                    }
                    searchIdx = foundAt + 1;
                  }
                }

                if (matchPos !== -1) {
                  const score = paraDistance * 1000 + Math.abs(matchPos - occ.match_start);
                  if (score < bestScore) {
                    bestScore = score;
                    bestBlock = block;
                    bestMatchStart = matchPos;
                  }
                }
              }

              if (bestBlock && bestMatchStart !== -1) {
                const matchedBlock: BlockInfo = bestBlock;
                const nodeStart = matchedBlock.pos + 1;
                const from = nodeStart + bestMatchStart;
                const to = from + occ.surface.length;

                if (from >= nodeStart && to <= nodeStart + matchedBlock.size) {
                  // Protection: Do NOT decorate text that is already deleted/track-changed.
                  // Applying decorations inside <del> marks breaks ProseMirror DOM diffing.
                  let hasDelMark = false;
                  newState.doc.nodesBetween(from, to, (n) => {
                    if (n.marks && n.marks.some((m) => m.type.name === "del")) {
                      hasDelMark = true;
                    }
                  });
                  if (hasDelMark) return;

                  const isSelected = occIndex === selectedIndex;
                  const classes = ["occurrence-highlight"];
                  if (isSelected) {
                    classes.push("occurrence-highlight-selected");
                  }

                  if (occ.in_stylesheet) {
                    classes.push(isSelected ? "occurrence-stylesheet-selected" : "occurrence-stylesheet");
                  } else if (occ.category) {
                    classes.push(`occurrence-${occ.category}`);
                    if (isSelected) {
                      classes.push(`occurrence-${occ.category}-selected`);
                    }
                  }

                  decorations.push(
                    Decoration.inline(from, to, {
                      class: classes.join(" "),
                      title: `${occ.category || "Finding"}: ${occ.surface}`,
                      "data-occ-index": String(occIndex),
                    })
                  );
                }
              }
            });

            // CRITICAL: ProseMirror REQUIRES decorations to be sorted by start position (from)
            decorations.sort((a, b) => a.from - b.from || a.to - b.to);

            return {
              decorations: DecorationSet.create(newState.doc, decorations),
              occurrences,
              selectedIndex,
              allowedCategories,
            };
          },
        },
        props: {
          decorations(state) {
            const pluginState = occurrenceHighlightKey.getState(state);
            return pluginState?.decorations ?? DecorationSet.empty;
          },
          handleClick(_view, _pos, event) {
            // NOTE: can't read the occ index from `deco.spec` — Decoration.inline
            // stores its 3rd argument in `type.attrs` (DOM attrs), and the real
            // `spec` object is empty unless an explicit 4th argument is passed.
            // Walk up the clicked DOM target to find the data-occ-index attribute.
            const cb = extension.storage.onOccurrenceClick;
            if (!cb) return false;
            const target = event?.target as HTMLElement | null;
            const el = target?.closest?.("[data-occ-index]") as HTMLElement | null;
            if (!el) return false;
            const idxStr = el.getAttribute("data-occ-index");
            if (idxStr == null) return false;
            const idx = parseInt(idxStr, 10);
            if (!Number.isFinite(idx)) return false;
            cb(idx);
            return true;
          },
        },
      }),
    ];
  },
});
