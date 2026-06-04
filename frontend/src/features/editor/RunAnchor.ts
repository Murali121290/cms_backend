import { Mark, mergeAttributes } from "@tiptap/core";

/**
 * RunAnchor — preserves a DOCX run's identity and original run-properties through editing.
 *
 * The run-anchored XHTML export ([docx_to_xhtml_runs.py]) wraps each run's text in
 * `<span data-run="1" data-rpr="<base64 w:rPr>">`. TipTap normally drops unknown
 * attributes, so this mark round-trips `data-run` / `data-rpr` and (crucially) sets
 * `keepOnSplit: true` so that when a run is split — e.g. bolding part of it — both halves
 * keep the original run-properties. On save, the delta-patch importer
 * ([xhtml_to_docx_delta.py]) clones `data-rpr` as each run's baseline and overlays only the
 * marks the user changed.
 */
export const RunAnchor = Mark.create({
  name: "runAnchor",

  // Keep the anchor on both halves when a run is split, and on text typed at its edges.
  keepOnSplit: true,
  inclusive: false,
  // Allow it to coexist with bold/italic/etc. on the same text.
  excludes: "",

  addAttributes() {
    return {
      runId: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-run"),
        renderHTML: (attributes) =>
          attributes.runId ? { "data-run": attributes.runId } : {},
      },
      rpr: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-rpr"),
        renderHTML: (attributes) =>
          attributes.rpr ? { "data-rpr": attributes.rpr } : {},
      },
      bookmark: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-bookmark"),
        renderHTML: (attributes) =>
          attributes.bookmark ? { "data-bookmark": attributes.bookmark } : {},
      },
      replacement: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-replacement"),
        renderHTML: (attributes) =>
          attributes.replacement ? { "data-replacement": attributes.replacement } : {},
      },
      ruleId: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-rule-id"),
        renderHTML: (attributes) =>
          attributes.ruleId ? { "data-rule-id": attributes.ruleId } : {},
      },
      ruleCategory: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-rule-category"),
        renderHTML: (attributes) =>
          attributes.ruleCategory ? { "data-rule-category": attributes.ruleCategory } : {},
      },
    };
  },

  parseHTML() {
    return [
      { tag: "span[data-rpr]" },
      { tag: "span[data-run]" },
      { tag: "span[data-bookmark]" },
      { tag: "span[data-replacement]" },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes), 0];
  },
});
