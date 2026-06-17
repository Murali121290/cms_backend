import { Mark, mergeAttributes } from "@tiptap/core";

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    comment: {
      addComment: (commentId: string) => ReturnType;
      removeComment: (commentId: string) => ReturnType;
      resolveComment: (commentId: string) => ReturnType;
    }
  }
}

export const Comment = Mark.create({
  name: "comment",

  addOptions() {
    return {
      HTMLAttributes: {
        class: "tc-comment",
      },
    };
  },

  inclusive: false,

  addAttributes() {
    return {
      commentId: {
        default: null,
        parseHTML: element => element.getAttribute("data-comment-id"),
        renderHTML: attributes => {
          if (!attributes.commentId) {
            return {};
          }
          return {
            "data-comment-id": attributes.commentId,
          };
        },
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: "span[data-comment-id]",
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes),
      0,
    ];
  },

  addCommands() {
    return {
      addComment: (commentId: string) => ({ chain }) => {
        return chain()
          .setMark(this.name, { commentId })
          .run();
      },
      removeComment: (commentId: string) => ({ state, dispatch }) => {
        const { tr, doc } = state;
        let found = false;
        doc.descendants((node, pos) => {
          const mark = node.marks.find(m => m.type.name === "comment" && m.attrs.commentId === commentId);
          if (mark) {
            tr.removeMark(pos, pos + node.nodeSize, state.schema.marks.comment);
            found = true;
          }
        });
        if (found) {
          if (dispatch) dispatch(tr);
          return true;
        }
        return false;
      },
      resolveComment: (commentId: string) => ({ state, dispatch }) => {
        if (dispatch) {
          const tr = state.tr.setMeta("resolveComment", commentId);
          dispatch(tr);
        }
        return true;
      },
    };
  },
});
