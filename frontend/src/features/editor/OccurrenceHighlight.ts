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
            };
          },
          apply(tr, pluginState, oldState, newState) {
            const meta = tr.getMeta(occurrenceHighlightKey) || tr.getMeta("occurrenceHighlight");
            let occurrences = pluginState?.occurrences || extension.storage.occurrences || [];
            let selectedIndex = pluginState?.selectedIndex ?? extension.storage.selectedIndex ?? -1;
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
            } else if (
              extension.storage.occurrences &&
              extension.storage.occurrences.length > 0 &&
              extension.storage.occurrences !== occurrences
            ) {
              occurrences = extension.storage.occurrences;
              selectedIndex = extension.storage.selectedIndex ?? -1;
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
              };
            }

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
            };
          },
        },
        props: {
          decorations(state) {
            const pluginState = occurrenceHighlightKey.getState(state);
            return pluginState?.decorations ?? DecorationSet.empty;
          },
          handleClick(view, pos) {
            const cb = extension.storage.onOccurrenceClick;
            if (!cb) return false;

            const pluginState = occurrenceHighlightKey.getState(view.state);
            const decos = pluginState?.decorations;
            if (decos) {
              const found = decos.find(pos, pos);
              if (found && found.length > 0) {
                for (const deco of found) {
                  const occIdxStr = (deco.spec as any)?.["data-occ-index"];
                  if (occIdxStr !== undefined) {
                    const idx = parseInt(occIdxStr, 10);
                    if (Number.isFinite(idx)) {
                      cb(idx);
                      return true;
                    }
                  }
                }
              }
            }
            return false;
          },
        },
      }),
    ];
  },
});
