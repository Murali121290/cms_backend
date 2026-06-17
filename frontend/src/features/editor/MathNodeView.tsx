import React, { useState, useEffect, useRef } from "react";
import { NodeViewWrapper, NodeViewProps } from "@tiptap/react";
import katex from "katex";
import "katex/dist/katex.min.css";

// Import Mathlive to register the <math-field> custom element
import "mathlive";

export function MathNodeView({ node, updateAttributes, selected }: NodeViewProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [latexInput, setLatexInput] = useState(node.attrs.latex);
  const previewRef = useRef<HTMLSpanElement>(null);
  const mathfieldRef = useRef<HTMLElement>(null);

  // Render LaTeX using KaTeX
  useEffect(() => {
    if (previewRef.current && !isEditing) {
      try {
        katex.render(node.attrs.latex, previewRef.current, {
          throwOnError: false,
          displayMode: false,
        });
      } catch (err) {
        console.error("KaTeX render error:", err);
      }
    }
  }, [node.attrs.latex, isEditing]);

  // Set up Mathlive event listener when editing
  useEffect(() => {
    const mathfield = mathfieldRef.current;
    if (mathfield && isEditing) {
      // Set initial value
      (mathfield as any).setValue(node.attrs.latex, { format: "latex" });

      const handleInput = (e: Event) => {
        const value = (e.target as any).value;
        setLatexInput(value);
      };

      mathfield.addEventListener("input", handleInput);
      
      // Auto focus the mathfield
      setTimeout(() => {
        mathfield.focus();
      }, 50);

      return () => {
        mathfield.removeEventListener("input", handleInput);
      };
    }
  }, [isEditing, node.attrs.latex]);

  const handleSave = (e?: React.MouseEvent) => {
    e?.preventDefault();
    e?.stopPropagation();
    updateAttributes({ latex: latexInput });
    setIsEditing(false);
  };

  const handleCancel = (e?: React.MouseEvent) => {
    e?.preventDefault();
    e?.stopPropagation();
    setLatexInput(node.attrs.latex);
    setIsEditing(false);
  };

  return (
    <NodeViewWrapper className="inline-block align-middle mx-1.5 relative select-none">
      {isEditing ? (
        <div className="absolute left-1/2 -translate-x-1/2 bottom-[100%] mb-2 z-50 bg-[#090d16]/95 border border-slate-700/80 rounded-lg shadow-2xl p-2.5 flex flex-col gap-2 min-w-[280px] backdrop-blur-md">
          <div className="flex items-center justify-between border-b border-slate-800 pb-1.5">
            <span className="text-[10px] uppercase tracking-wider font-extrabold text-slate-400">Visual Math Editor</span>
            <span className="text-[9px] font-mono text-slate-500">Mathlive Field</span>
          </div>
          
          {/* Custom Web Component from Mathlive */}
          {/* @ts-ignore */}
          <math-field
            ref={mathfieldRef}
            style={{
              width: "100%",
              minHeight: "45px",
              background: "#131b2e",
              color: "#f8fafc",
              border: "1px solid #334155",
              borderRadius: "4px",
              padding: "6px",
              fontSize: "14px",
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
          title="Click to edit formula"
        />
      )}
    </NodeViewWrapper>
  );
}
