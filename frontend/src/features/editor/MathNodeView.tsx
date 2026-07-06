import React, { useState, useEffect, useRef } from "react";
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
function renderEquation(target: HTMLElement, latex: string, mathml: string, display: boolean) {
  if (latex) {
    try {
      katex.render(latex, target, {
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

export function MathNodeView({ node, updateAttributes, selected }: NodeViewProps) {
  const openOnMount = !!node.attrs.openOnMount;
  const [isEditing, setIsEditing] = useState(openOnMount);
  const [latexInput, setLatexInput] = useState<string>(node.attrs.latex || "");
  const previewRef = useRef<HTMLSpanElement>(null);
  const mathfieldRef = useRef<HTMLElement>(null);
  // Snapshot of the LaTeX at the moment editing starts. On Save we only drop
  // the raw OMML if this changed — merely opening + closing the editor must
  // not compromise the byte-perfect round-trip.
  const initialLatexRef = useRef<string>(node.attrs.latex || "");

  // Clear the transient openOnMount flag after the first render so refreshes
  // (e.g. after saving) don't re-open the editor.
  useEffect(() => {
    if (openOnMount) {
      updateAttributes({ openOnMount: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isBlock = node.attrs.display === "block";

  // Render preview via KaTeX (LaTeX path) or inline MathML.
  useEffect(() => {
    if (previewRef.current && !isEditing) {
      renderEquation(previewRef.current, node.attrs.latex || "", node.attrs.mathml || "", isBlock);
    }
  }, [node.attrs.latex, node.attrs.mathml, isEditing, isBlock]);

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

  const handleCancel = (e?: React.MouseEvent) => {
    e?.preventDefault();
    e?.stopPropagation();
    setLatexInput(node.attrs.latex || "");
    setIsEditing(false);
  };

  return (
    <NodeViewWrapper className={`inline-block align-middle mx-1.5 relative select-none${isBlock ? " math-node-block" : ""}`}>
      {isEditing ? (
        <div className="absolute left-1/2 -translate-x-1/2 bottom-[100%] mb-2 z-50 bg-[#090d16]/95 border border-slate-700/80 rounded-lg shadow-2xl p-2.5 flex flex-col gap-2 min-w-[320px] backdrop-blur-md">
          <div className="flex items-center justify-between border-b border-slate-800 pb-1.5">
            <span className="text-[10px] uppercase tracking-wider font-extrabold text-slate-400">Equation Editor</span>
            <span className="text-[9px] font-mono text-slate-500">Mathlive</span>
          </div>

          {/* Mathlive web component provides fractions, sqrt, greek, sum, integral, matrix, brackets */}
          {/* @ts-ignore */}
          <math-field
            ref={mathfieldRef}
            style={{
              width: "100%",
              minHeight: "50px",
              background: "#131b2e",
              color: "#f8fafc",
              border: "1px solid #334155",
              borderRadius: "4px",
              padding: "6px",
              fontSize: "16px",
            }}
          />

          <div className="flex justify-end gap-1.5 pt-1.5 border-t border-slate-800/60">
            <button
              onClick={handleCancel}
              className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] font-bold uppercase rounded transition-colors cursor-pointer border-none"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              className="px-2.5 py-1 bg-amber-600 hover:bg-amber-700 text-white text-[10px] font-bold uppercase rounded transition-colors cursor-pointer border-none"
            >
              Save
            </button>
          </div>
        </div>
      ) : (
        <span
          ref={previewRef}
          onClick={(e) => {
            e.stopPropagation();
            setIsEditing(true);
          }}
          className={`inline-block px-2 py-1 rounded transition-all duration-200 cursor-pointer border border-transparent ${
            selected
              ? "bg-amber-500/10 border-amber-500/50 shadow-sm"
              : "hover:bg-slate-200 hover:border-slate-300"
          }`}
          title="Click to edit equation"
        />
      )}
    </NodeViewWrapper>
  );
}
