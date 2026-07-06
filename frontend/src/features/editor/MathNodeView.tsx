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

  // Feed the mathfield with LaTeX when available, else MathML. Mathlive
  // internally converts either to its live AST so subsequent edits are
  // captured as LaTeX for saving.
  useEffect(() => {
    const mathfield = mathfieldRef.current;
    if (mathfield && isEditing) {
      const latex = node.attrs.latex || "";
      const mathml = node.attrs.mathml || "";
      try {
        if (latex) {
          (mathfield as any).setValue(latex, { format: "latex" });
        } else if (mathml) {
          (mathfield as any).setValue(mathml, { format: "math-ml" });
        } else {
          (mathfield as any).setValue("", { format: "latex" });
        }
      } catch (err) {
        console.error("Mathlive setValue failed:", err);
      }

      const handleInput = (e: Event) => {
        const value = (e.target as any).value;
        setLatexInput(value || "");
      };

      mathfield.addEventListener("input", handleInput);

      // Auto-focus so the user can immediately type/insert symbols.
      setTimeout(() => {
        try { mathfield.focus(); } catch { /* noop */ }
      }, 50);

      // Seed the input state with whatever Mathlive resolved the value to.
      try {
        const initialLatex = (mathfield as any).getValue?.("latex-expanded") || (mathfield as any).value || "";
        setLatexInput(initialLatex);
      } catch { /* noop */ }

      return () => {
        mathfield.removeEventListener("input", handleInput);
      };
    }
  }, [isEditing, node.attrs.latex, node.attrs.mathml]);

  const handleSave = (e?: React.MouseEvent) => {
    e?.preventDefault();
    e?.stopPropagation();
    // Regenerate MathML from the current LaTeX so the backend can serialize
    // it to OMML on save. Drop the original OMML — the equation just changed.
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
