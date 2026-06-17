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

const occurrenceHighlightKey = new PluginKey("occurrenceHighlight");

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
      new Plugin({
        key: occurrenceHighlightKey,
        state: {
          init() {
            return DecorationSet.empty;
          },
          apply(tr, value, oldState, newState) {
            // Try to get occurrences from storage first, then from transaction metadata
            let occurrences = extension.storage.occurrences || [];
            let selectedIndex = extension.storage.selectedIndex ?? -1;

            // Fallback: try to read from transaction metadata
            const metaData = tr.getMeta("occurrenceHighlight");
            if (metaData) {
              occurrences = metaData.occurrences || occurrences;
              selectedIndex = metaData.selectedIndex ?? selectedIndex;
            }

            if (occurrences.length === 0) {
              return DecorationSet.empty;
            }

            const decorations: Decoration[] = [];

            // 1. Collect all block nodes
            const blocks: { pos: number; size: number; text: string }[] = [];
            tr.doc.descendants((node, pos) => {
              if (node.isBlock && (node.type.name === "paragraph" || node.type.name.startsWith("heading"))) {
                blocks.push({
                  pos,
                  size: node.content.size,
                  text: node.textContent,
                });
              }
            });

            // 2. Map each occurrence to the best matching block using content-based distance scoring
            occurrences.forEach((occ: Occurrence, occIndex: number) => {
              let bestBlockIdx = -1;
              let bestScore = Infinity;
              let bestMatchStart = -1;

              blocks.forEach((block, blockIdx) => {
                const surfaceIdx = block.text.indexOf(occ.surface);
                if (surfaceIdx !== -1) {
                  const score = Math.abs(blockIdx - occ.para_index);
                  if (score < bestScore) {
                    bestScore = score;
                    bestBlockIdx = blockIdx;
                    bestMatchStart = surfaceIdx;
                  }
                }
              });

              if (bestBlockIdx !== -1) {
                const matchedBlock = blocks[bestBlockIdx];
                const nodeStart = matchedBlock.pos + 1;
                const from = nodeStart + bestMatchStart;
                const to = from + occ.surface.length;

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

                const className = classes.join(" ");

                if (from >= nodeStart && to <= nodeStart + matchedBlock.size) {
                  decorations.push(
                    Decoration.inline(from, to, {
                      class: className,
                      title: `${occ.category || "Finding"}: ${occ.surface}`,
                    })
                  );
                }
              }
            });

            return DecorationSet.create(tr.doc, decorations);
          },
        },
        props: {
          decorations(state) {
            return occurrenceHighlightKey.getState(state) ?? DecorationSet.empty;
          },
          handleClick(view, pos) {
            const cb = extension.storage.onOccurrenceClick;
            if (!cb) return false;
            const occs: Occurrence[] = extension.storage.occurrences || [];
            if (!occs.length) return false;

            // 1. Collect all block nodes
            const blocks: { pos: number; size: number; text: string }[] = [];
            view.state.doc.descendants((node, nodePos) => {
              if (node.isBlock && (node.type.name === "paragraph" || node.type.name.startsWith("heading"))) {
                blocks.push({
                  pos: nodePos,
                  size: node.content.size,
                  text: node.textContent,
                });
              }
            });

            // 2. Find if the clicked pos falls within any mapped occurrence bounds
            let clickedIndex = -1;
            occs.forEach((occ, occIdx) => {
              if (clickedIndex !== -1) return;

              let bestBlockIdx = -1;
              let bestScore = Infinity;
              let bestMatchStart = -1;

              blocks.forEach((block, blockIdx) => {
                const surfaceIdx = block.text.indexOf(occ.surface);
                if (surfaceIdx !== -1) {
                  const score = Math.abs(blockIdx - occ.para_index);
                  if (score < bestScore) {
                    bestScore = score;
                    bestBlockIdx = blockIdx;
                    bestMatchStart = surfaceIdx;
                  }
                }
              });

              if (bestBlockIdx !== -1) {
                const matchedBlock = blocks[bestBlockIdx];
                const nodeStart = matchedBlock.pos + 1;
                const from = nodeStart + bestMatchStart;
                const to = from + occ.surface.length;
                if (pos >= from && pos <= to) {
                  clickedIndex = occIdx;
                }
              }
            });

            if (clickedIndex !== -1) {
              cb(clickedIndex);
              return true;
            }
            return false;
          },
        },
      }),
    ];
  },
});
