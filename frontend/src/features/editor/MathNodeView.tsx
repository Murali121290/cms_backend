import React, { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { NodeViewWrapper, NodeViewProps } from "@tiptap/react";
import katex from "katex";
import "katex/dist/katex.min.css";

// Import Mathlive to register the <math-field> custom element
import "mathlive";

/**
 * Render an equation to the preview span.
 *
 * Preference order:
 *   1. If we have LaTeX (either from the ∑ button or from a previously-edited
 *      equation), render it with KaTeX — highest fidelity for typical algebra.
 *   2. Otherwise, if we have MathML (freshly opened from OMML), inject it
 *      directly. Browsers render inline MathML natively; when they don't,
 *      Mathlive's stylesheet still styles it acceptably.
 */
function wrapLatexWithFormatting(
  latex: string,
  attrs: { wrapperBold?: boolean; wrapperItalic?: boolean; wrapperColor?: string },
): string {
  if (!latex) return latex;
  let out = latex;
  // Apply innermost to outermost so nesting doesn't collide.
  if (attrs.wrapperItalic) out = `\\mathit{${out}}`;
  if (attrs.wrapperBold) out = `\\mathbf{${out}}`;
  if (attrs.wrapperColor) out = `\\textcolor{${attrs.wrapperColor}}{${out}}`;
  return out;
}

function renderEquation(
  target: HTMLElement,
  latex: string,
  mathml: string,
  display: boolean,
  attrs?: { wrapperBold?: boolean; wrapperItalic?: boolean; wrapperColor?: string },
) {
  if (latex) {
    try {
      const styledLatex = attrs ? wrapLatexWithFormatting(latex, attrs) : latex;
      katex.render(styledLatex, target, {
        throwOnError: false,
        displayMode: display,
      });
      return;
    } catch (err) {
      console.error("KaTeX render error:", err);
      // fall through to MathML
    }
  }
  if (mathml) {
    target.innerHTML = mathml;
    return;
  }
  target.textContent = "∑";
}

export function MathNodeView({ node, updateAttributes, selected, editor, getPos }: NodeViewProps) {
  const openOnMount = !!node.attrs.openOnMount;
  const [isEditing, setIsEditing] = useState(openOnMount);
  const [latexInput, setLatexInput] = useState<string>(node.attrs.latex || "");
  const previewRef = useRef<HTMLSpanElement>(null);
  const mathfieldRef = useRef<HTMLElement>(null);
  const keyboardHostRef = useRef<HTMLDivElement>(null);
  // Snapshot of the LaTeX at the moment editing starts. On Save we only drop
  // the raw OMML if this changed — merely opening + closing the editor must
  // not compromise the byte-perfect round-trip.
  const initialLatexRef = useRef<string>(node.attrs.latex || "");

  // openOnMount is set true by (a) the ∑ toolbar button when inserting a
  // fresh equation and (b) the MathNode Enter keyboard shortcut when a math
  // node is selected. Watch the attr — not just the initial mount — so
  // pressing Enter on an existing equation opens the modal too. Clear it
  // immediately so refreshes don't re-open.
  useEffect(() => {
    if (node.attrs.openOnMount) {
      setIsEditing(true);
      updateAttributes({ openOnMount: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.attrs.openOnMount]);

  const isBlock = node.attrs.display === "block";

  // Render preview via KaTeX (LaTeX path) or inline MathML. Re-run when any
  // wrapper formatting attr changes so Bold/Italic/Color are visible in the
  // editor immediately — CSS on the parent alone can't override KaTeX's
  // internal math font stack.
  useEffect(() => {
    if (previewRef.current && !isEditing) {
      renderEquation(
        previewRef.current,
        node.attrs.latex || "",
        node.attrs.mathml || "",
        isBlock,
        {
          wrapperBold: !!node.attrs.wrapperBold,
          wrapperItalic: !!node.attrs.wrapperItalic,
          wrapperColor: node.attrs.wrapperColor || "",
        },
      );
    }
  }, [
    node.attrs.latex,
    node.attrs.mathml,
    node.attrs.wrapperBold,
    node.attrs.wrapperItalic,
    node.attrs.wrapperColor,
    isEditing,
    isBlock,
  ]);

  // Feed the mathfield with LaTeX when available, else MathML. The
  // <math-field> web component initialises its shadow DOM asynchronously in
  // its connectedCallback, so calling setValue() the same tick the ref lands
  // often no-ops silently. We wait for the custom element to be defined and
  // then set the value once — and verify the value stuck; if MathML→internal
  // parsing failed, retry with a MathML→LaTeX fallback so the user always
  // sees the equation they clicked.
  useEffect(() => {
    if (!isEditing) return;
    let cancelled = false;
    let cleanup: (() => void) | undefined;

    const applyValue = (mf: any) => {
      if (cancelled || !mf) return;
      const latex = node.attrs.latex || "";
      const mathml = node.attrs.mathml || "";

      const trySet = () => {
        try {
          if (latex) {
            mf.setValue(latex, { format: "latex", silenceNotifications: true });
          } else if (mathml) {
            // Some MathML shapes from OMML include the xmlns attribute which
            // Mathlive tolerates, but stray whitespace/newlines around the
            // root confuse the parser. Normalise before setting.
            const normalized = mathml.replace(/\s*\n\s*/g, "").trim();
            mf.setValue(normalized, { format: "math-ml", silenceNotifications: true });
            // Fallback: if MathML parsing produced nothing, try converting to
            // LaTeX by rendering the MathML into a hidden mathfield and reading
            // its LaTeX form back. When that too fails, drop the raw MathML in
            // as latex so the user still sees a placeholder they can replace.
            const after = mf.getValue?.("latex") || mf.value || "";
            if (!after) {
              // Last-resort: strip tags so the user at least sees the raw
              // symbols and can rebuild the equation manually.
              const textOnly = normalized.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
              mf.setValue(textOnly, { format: "latex", silenceNotifications: true });
            }
          } else {
            mf.setValue("", { format: "latex", silenceNotifications: true });
          }
        } catch (err) {
          console.error("Mathlive setValue failed:", err);
        }

        // Sync React state to whatever value Mathlive settled on so Save
        // captures the current content even if the user doesn't type. Also
        // remember it so we can tell whether the user actually edited.
        try {
          const initialLatex = mf.getValue?.("latex") || mf.value || "";
          setLatexInput(initialLatex);
          initialLatexRef.current = initialLatex;
        } catch { /* noop */ }

        try { mf.focus(); } catch { /* noop */ }
      };

      // Give the custom element one frame to finish its shadow DOM setup.
      requestAnimationFrame(() => {
        if (cancelled) return;
        trySet();
      });

      const handleInput = (e: Event) => {
        const value = (e.target as any).value;
        setLatexInput(value || "");
      };
      mf.addEventListener("input", handleInput);
      cleanup = () => mf.removeEventListener("input", handleInput);
    };

    const mathfield = mathfieldRef.current;
    if (mathfield && (mathfield as any).setValue) {
      applyValue(mathfield);
    } else if (typeof customElements !== "undefined") {
      // Custom element not upgraded yet — wait for it.
      customElements.whenDefined("math-field").then(() => {
        if (!cancelled) applyValue(mathfieldRef.current);
      });
    }

    return () => {
      cancelled = true;
      if (cleanup) cleanup();
    };
  }, [isEditing, node.attrs.latex, node.attrs.mathml]);

  const handleSave = (e?: React.MouseEvent) => {
    e?.preventDefault();
    e?.stopPropagation();
    const edited = latexInput !== initialLatexRef.current;

    // If the user opened the editor and saved without changing anything,
    // keep the original OMML/MathML intact so the round-trip stays byte
    // perfect. Only regenerate on an actual edit.
    if (!edited) {
      setIsEditing(false);
      return;
    }

    let newMathml = "";
    try {
      const mf = mathfieldRef.current as any;
      if (mf && typeof mf.getValue === "function") {
        newMathml = mf.getValue("math-ml") || "";
      }
    } catch { /* noop */ }
    if (!newMathml && latexInput) {
      try {
        newMathml = katex.renderToString(latexInput, { output: "mathml", throwOnError: false });
        const parsed = new DOMParser().parseFromString(newMathml, "text/html").querySelector("math");
        newMathml = parsed ? new XMLSerializer().serializeToString(parsed) : "";
      } catch (err) {
        console.error("Failed to synthesise MathML on save:", err);
      }
    }
    // Mathlive's math-ml output is a bare <mrow>. mathml2omml on the server
    // needs a proper <math> root to emit <m:oMath>, so wrap if missing.
    if (newMathml && !/^\s*<math\b/i.test(newMathml)) {
      newMathml = '<math xmlns="http://www.w3.org/1998/Math/MathML">' + newMathml + '</math>';
    }
    // Equation changed — drop the raw OMML since it no longer matches.
    updateAttributes({ latex: latexInput, mathml: newMathml, omml: "" });
    setIsEditing(false);
  };

  const handleCancel = (e?: React.MouseEvent | React.KeyboardEvent) => {
    e?.preventDefault();
    e?.stopPropagation();
    setLatexInput(node.attrs.latex || "");
    setIsEditing(false);
  };

  // While the modal is open, pull Mathlive's virtual keyboard into a
  // container inside the modal instead of letting it float at the bottom
  // of the viewport. useLayoutEffect fires BEFORE the setValue effect
  // focuses the mathfield — critical, because focus triggers keyboard.show()
  // and once the keyboard element is built into <body>, changing `container`
  // is a no-op. We also install a MutationObserver on <body> so that any
  // keyboard Mathlive still attaches there gets moved into our host.
  React.useLayoutEffect(() => {
    if (!isEditing) return;
    const kb = (window as any).mathVirtualKeyboard;
    const host = keyboardHostRef.current;
    if (!host) return;

    let previousContainer: HTMLElement | null = null;
    let previousParent: HTMLElement | null = null;
    let keyboardEl: HTMLElement | null = null;

    if (kb) {
      previousContainer = kb.container ?? null;
      try { kb.container = host; } catch { /* noop */ }
    }

    const adopt = (el: HTMLElement) => {
      if (el.parentElement === host) return;
      previousParent = el.parentElement;
      host.appendChild(el);
      keyboardEl = el;
    };

    // Grab any pre-existing keyboard from a previous open.
    const existing = document.querySelector<HTMLElement>(".ML__keyboard");
    if (existing) adopt(existing);

    // Watch for a keyboard element that Mathlive appends anywhere later.
    const observer = new MutationObserver(() => {
      const el = document.querySelector<HTMLElement>(".ML__keyboard");
      if (el && el.parentElement !== host) adopt(el);
    });
    observer.observe(document.body, { childList: true, subtree: true });

    // Also proactively show the keyboard so it appears without needing focus.
    try { kb?.show?.(); } catch { /* noop */ }

    return () => {
      observer.disconnect();
      if (keyboardEl && previousParent) {
        try { previousParent.appendChild(keyboardEl); } catch { /* noop */ }
      }
      if (kb) {
        try { kb.hide?.(); } catch { /* noop */ }
        try { kb.container = previousContainer; } catch { /* noop */ }
      }
    };
  }, [isEditing]);

  // Escape → cancel; Ctrl/Cmd+Enter → save.
  useEffect(() => {
    if (!isEditing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        handleCancel();
      } else if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEditing, latexInput]);

  // Lock body scroll while the modal is open.
  useEffect(() => {
    if (!isEditing) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [isEditing]);

  const modal = isEditing ? (
    <div
      className="math-modal-root fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/70 backdrop-blur-sm p-2 sm:p-4"
      onMouseDown={(e) => {
        // Backdrop click cancels; ignore clicks that started inside the modal.
        if (e.target === e.currentTarget) handleCancel();
      }}
    >
      <div
        className="math-modal-panel flex flex-col rounded-xl shadow-2xl bg-[#0b1220] border border-slate-700 overflow-hidden"
        style={{ width: "50vw", minWidth: "480px", maxWidth: "780px", height: "68vh", maxHeight: "620px" }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-800 flex-shrink-0">
          <div className="flex flex-col">
            <span className="text-base font-bold text-slate-100 tracking-tight">Equation Editor</span>
            <span className="text-[11px] text-slate-500">Cmd/Ctrl+Enter to save · Esc to cancel</span>
          </div>
          <button
            onClick={handleCancel}
            className="text-slate-400 hover:text-slate-200 text-2xl leading-none w-9 h-9 flex items-center justify-center rounded hover:bg-slate-800 border-none bg-transparent cursor-pointer"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* Body: editor on top (fixed portion), keyboard fills the rest.
            Both share full modal width; nothing overflows because keyboard
            host is flex-1 min-h-0 with overflow-hidden. */}
        <div className="flex-1 min-h-0 flex flex-col gap-3 p-4">
          {/* @ts-ignore */}
          <math-field
            ref={mathfieldRef}
            className="math-modal-field"
            style={{
              width: "100%",
              height: "90px",
              flexShrink: 0,
              padding: "10px 12px",
              fontSize: "20px",
              lineHeight: "1.3",
              boxSizing: "border-box",
            }}
          />

          <div
            ref={keyboardHostRef}
            className="math-modal-keyboard-host flex-1 min-h-0 w-full rounded-lg bg-slate-900/60 border border-slate-800 overflow-hidden"
          />
        </div>

        <style>{`
          /* Force a white surface with dark ink so the equation is legible
             on the dark modal panel. Mathlive uses its own CSS variables
             internally (see mathlive/mathlive.mjs for the full list) so we
             set them explicitly on the field host. */
          .math-modal-panel math-field.math-modal-field {
            background: #ffffff !important;
            color: #0f172a !important;
            border: 1px solid #cbd5e1 !important;
            border-radius: 8px !important;
            --primary: #0f172a;
            --primary-color: #0f172a;
            --primary-color-dark: #000000;
            --caret-color: #0f172a;
            --text-color: #0f172a;
            --bg-color: #ffffff;
            --selection-background-color: #dbeafe;
            --selection-color: #0f172a;
            --placeholder-color: #94a3b8;
            --contains-highlight-background-color: #f1f5f9;
            --border-color: #cbd5e1;
          }
          .math-modal-panel math-field.math-modal-field::part(content) {
            color: #0f172a !important;
          }
          .math-modal-panel math-field.math-modal-field::part(virtual-keyboard-toggle) {
            color: #475569 !important;
          }
          /* Hide the three-dot overflow menu — none of its options are used.
             Belt-and-suspenders: match by part selector AND directly on the
             math-field host with the highest-specificity fallback. */
          math-field::part(menu-toggle),
          .math-modal-panel math-field::part(menu-toggle),
          .math-modal-panel math-field.math-modal-field::part(menu-toggle) {
            display: none !important;
            visibility: hidden !important;
            width: 0 !important;
            height: 0 !important;
            opacity: 0 !important;
            pointer-events: none !important;
          }
          .math-modal-keyboard-host {
            display: block;
            /* Mathlive's keyboard toolbar (123 / αβγ / abc / … tabs) defaults
               to dark text (--keyboard-toolbar-text: #2c2e2f), which is
               invisible against our dark modal keyboard host. Override so
               inactive tabs are clearly readable and the active one is
               highlighted. */
            --keyboard-toolbar-text: #cbd5e1;
            --keyboard-toolbar-text-active: #ffffff;
            --keyboard-toolbar-background: transparent;
            --keyboard-toolbar-background-hover: rgba(148, 163, 184, 0.15);
            --keyboard-toolbar-background-selected: rgba(251, 191, 36, 0.25);
          }
          .math-modal-keyboard-host .action {
            color: #cbd5e1 !important;
          }
          .math-modal-keyboard-host .selected,
          .math-modal-keyboard-host .action.selected {
            color: #ffffff !important;
          }
          /* Once we adopt Mathlive's .ML__keyboard into our host it is no
             longer a child of <body>, so its "body > .ML__keyboard { position: fixed }"
             rule no longer applies and the base rule takes over
             (position: relative; width: 100%; height: 100%). Below we
             harden that against any conflicting Mathlive z-index, transform,
             or transitions so the keyboard flows entirely within our host. */
          .math-modal-keyboard-host .ML__keyboard {
            position: relative !important;
            top: auto !important;
            left: auto !important;
            right: auto !important;
            bottom: auto !important;
            width: 100% !important;
            height: 100% !important;
            max-height: 100% !important;
            transform: none !important;
            box-shadow: none !important;
            border-radius: 0 !important;
            margin: 0 !important;
            pointer-events: auto !important;
            visibility: visible !important;
            opacity: 1 !important;
            display: block !important;
            z-index: auto !important;
          }
          .math-modal-keyboard-host .MLK__backdrop {
            position: absolute !important;
            inset: 0 !important;
            transform: none !important;
            transition: none !important;
            opacity: 1 !important;
          }
          .math-modal-keyboard-host .MLK__plate {
            position: relative !important;
            width: 100% !important;
            height: 100% !important;
            box-sizing: border-box !important;
          }
          /* Give keycaps and rows a compact, responsive rhythm inside the host. */
          .math-modal-keyboard-host .MLK__keycap {
            min-width: 0 !important;
            font-size: clamp(11px, 1.4vh, 14px) !important;
          }
        `}</style>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-slate-800 flex-shrink-0">
          <button
            onClick={handleCancel}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-semibold rounded transition-colors cursor-pointer border-none"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-5 py-2 bg-amber-600 hover:bg-amber-700 text-white text-sm font-semibold rounded transition-colors cursor-pointer border-none"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  ) : null;

  return (
    <NodeViewWrapper className={`inline-block align-middle mx-1.5 relative select-none${isBlock ? " math-node-block" : ""}`}>
      <span
        ref={previewRef}
        onClick={(e) => {
          // Single click selects the node so the outer toolbar (Bold,
          // Italic, Font, Size, Color, Highlight) can apply formatting to
          // the whole equation. Double-click opens the content editor.
          e.stopPropagation();
          if (editor && typeof getPos === "function") {
            try {
              editor.chain().setNodeSelection(getPos()).focus().run();
            } catch { /* noop */ }
          }
        }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          setIsEditing(true);
        }}
        style={{
          fontWeight: node.attrs.wrapperBold ? 700 : undefined,
          fontStyle: node.attrs.wrapperItalic ? "italic" : undefined,
          color: node.attrs.wrapperColor || undefined,
          backgroundColor: node.attrs.wrapperBgColor || undefined,
          fontSize: node.attrs.wrapperFontSize ? `${node.attrs.wrapperFontSize}pt` : undefined,
          fontFamily: node.attrs.wrapperFontFamily || undefined,
        }}
        className={`inline-block px-2 py-1 rounded transition-all duration-200 cursor-pointer border border-transparent ${
          selected
            ? "bg-amber-500/10 border-amber-500/50 shadow-sm"
            : "hover:bg-slate-200 hover:border-slate-300"
        }`}
        title="Click to select · Double-click to edit"
      />
      {modal && typeof document !== "undefined" ? createPortal(modal, document.body) : null}
    </NodeViewWrapper>
  );
}
