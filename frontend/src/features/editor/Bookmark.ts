import { Mark, mergeAttributes } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";

/**
 * Bookmark — an inline anchor that survives the DOCX round-trip via the
 * `data-bookmark` attribute (see app/processing/xhtml_to_docx_delta.py and
 * docx_to_xhtml_runs.py, which map it to <w:bookmarkStart/w:bookmarkEnd>).
 *
 * Auto-applied by the Reference Review flow: each reference entry becomes a
 * target (data-bookmark-role="target"), each in-text citation [N] becomes a
 * source (data-bookmark-role="source"), both named "REF{N}". Clicking either
 * jumps to its counterpart.
 *
 * The `data-bookmark-role` attribute is what distinguishes user-authored /
 * reference-review bookmarks from the pre-existing DOCX-imported ones that
 * RunAnchor already carries — so we parse selectors that require the role
 * to avoid overlapping with RunAnchor's schema.
 */
export const Bookmark = Mark.create({
  name: "bookmark",
  inclusive: false,
  excludes: "",

  addAttributes() {
    return {
      name: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-bookmark"),
        renderHTML: (attrs) =>
          attrs.name
            ? { "data-bookmark": attrs.name, id: `bookmark-${attrs.name}` }
            : {},
      },
      role: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-bookmark-role"),
        renderHTML: (attrs) =>
          attrs.role ? { "data-bookmark-role": attrs.role } : {},
      },
    };
  },

  parseHTML() {
    return [
      { tag: "a[data-bookmark-role]" },
      { tag: "span[data-bookmark-role]" },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "a",
      mergeAttributes(HTMLAttributes, { class: "rr-bookmark" }),
      0,
    ];
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          handleClickOn(view, _pos, _node, _nodePos, event, direct) {
            if (!direct) return false;
            const target = event.target as HTMLElement | null;
            const el = target?.closest?.("[data-bookmark-role]") as HTMLElement | null;
            if (!el) return false;
            const name = el.getAttribute("data-bookmark");
            const role = el.getAttribute("data-bookmark-role");
            if (!name || !role) return false;
            const otherRole = role === "target" ? "source" : "target";
            const counter = view.dom.querySelector(
              `[data-bookmark="${CSS.escape(name)}"][data-bookmark-role="${otherRole}"]`,
            ) as HTMLElement | null;
            if (!counter) return false;
            counter.scrollIntoView({ behavior: "smooth", block: "center" });
            counter.classList.add("rr-para-flash");
            window.setTimeout(() => counter.classList.remove("rr-para-flash"), 1200);
            return true;
          },
        },
      }),
    ];
  },
});
