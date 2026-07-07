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

// ─── Word-style ribbon for the equation editor ───────────────────────────
//
// Each category button opens a small floating palette showing math templates
// as clickable KaTeX-rendered thumbnails. Clicking a template calls
// mf.executeCommand(['insert', latex, {selectionMode:'placeholder'}]) so the
// user types straight into the first #? slot.

type PaletteItem = {
  // Displayed preview — rendered with KaTeX so the palette shows real math,
  // not placeholder glyphs.
  preview: string;
  // The LaTeX inserted into the mathfield. Use #? for tab-navigable holes.
  insert: string;
  title: string;
};

type RibbonCategory = {
  id: string;
  label: string;
  // The icon shown on the ribbon button — rendered with KaTeX.
  icon: string;
  items: PaletteItem[];
  // Column count in the palette grid; auto if omitted.
  columns?: number;
  // Width override for wide palettes (e.g. Greek).
  width?: string;
};

const RIBBON: RibbonCategory[] = [
  {
    id: "fraction",
    label: "Fraction",
    icon: "\\frac{a}{b}",
    items: [
      { preview: "\\frac{a}{b}", insert: "\\frac{#?}{#?}", title: "Stacked fraction" },
      { preview: "{a}/{b}", insert: "{#?}/{#?}", title: "Linear fraction" },
      { preview: "\\frac{\\partial a}{\\partial b}", insert: "\\frac{\\partial #?}{\\partial #?}", title: "Partial derivative" },
      { preview: "\\frac{da}{db}", insert: "\\frac{d#?}{d#?}", title: "Differential" },
    ],
    columns: 2,
  },
  {
    id: "script",
    label: "Script",
    icon: "x^{a}",
    items: [
      { preview: "x^{a}", insert: "#?^{#?}", title: "Superscript" },
      { preview: "x_{a}", insert: "#?_{#?}", title: "Subscript" },
      { preview: "x_{a}^{b}", insert: "#?_{#?}^{#?}", title: "Sub-superscript" },
      { preview: "{}^{a}x", insert: "{}^{#?}#?", title: "Left superscript" },
      { preview: "{}_{a}x", insert: "{}_{#?}#?", title: "Left subscript" },
      { preview: "\\bar{a}", insert: "\\bar{#?}", title: "Over-bar" },
      { preview: "\\underline{a}", insert: "\\underline{#?}", title: "Underline" },
      { preview: "\\overrightarrow{ab}", insert: "\\overrightarrow{#?}", title: "Right arrow above" },
    ],
    columns: 2,
  },
  {
    id: "radical",
    label: "Radical",
    icon: "\\sqrt{a}",
    items: [
      { preview: "\\sqrt{a}", insert: "\\sqrt{#?}", title: "Square root" },
      { preview: "\\sqrt[n]{a}", insert: "\\sqrt[#?]{#?}", title: "N-th root" },
      { preview: "\\sqrt[3]{a}", insert: "\\sqrt[3]{#?}", title: "Cube root" },
    ],
    columns: 3,
  },
  {
    id: "integral",
    label: "Integral",
    icon: "\\int",
    items: [
      { preview: "\\int", insert: "\\int #?", title: "Integral" },
      { preview: "\\int_{a}^{b}", insert: "\\int_{#?}^{#?} #?", title: "Definite integral" },
      { preview: "\\iint", insert: "\\iint #?", title: "Double integral" },
      { preview: "\\iiint", insert: "\\iiint #?", title: "Triple integral" },
      { preview: "\\oint", insert: "\\oint #?", title: "Contour integral" },
      { preview: "\\oint_{a}^{b}", insert: "\\oint_{#?}^{#?} #?", title: "Contour with limits" },
    ],
    columns: 3,
  },
  {
    id: "operator",
    label: "Operator",
    icon: "\\sum",
    items: [
      { preview: "\\sum", insert: "\\sum #?", title: "Sum" },
      { preview: "\\sum_{a}^{b}", insert: "\\sum_{#?}^{#?} #?", title: "Sum with limits" },
      { preview: "\\prod", insert: "\\prod #?", title: "Product" },
      { preview: "\\prod_{a}^{b}", insert: "\\prod_{#?}^{#?} #?", title: "Product with limits" },
      { preview: "\\coprod", insert: "\\coprod #?", title: "Coproduct" },
      { preview: "\\bigcup", insert: "\\bigcup #?", title: "Union" },
      { preview: "\\bigcap", insert: "\\bigcap #?", title: "Intersection" },
      { preview: "\\lim_{n\\to\\infty}", insert: "\\lim_{#?\\to#?} #?", title: "Limit" },
    ],
    columns: 2,
  },
  {
    id: "bracket",
    label: "Bracket",
    icon: "( )",
    items: [
      { preview: "(a)", insert: "\\left(#?\\right)", title: "Parentheses" },
      { preview: "[a]", insert: "\\left[#?\\right]", title: "Square brackets" },
      { preview: "\\{a\\}", insert: "\\left\\{#?\\right\\}", title: "Braces" },
      { preview: "|a|", insert: "\\left|#?\\right|", title: "Absolute value" },
      { preview: "\\|a\\|", insert: "\\left\\|#?\\right\\|", title: "Norm" },
      { preview: "\\langle a\\rangle", insert: "\\left\\langle #?\\right\\rangle", title: "Angle brackets" },
      { preview: "\\lfloor a\\rfloor", insert: "\\left\\lfloor #?\\right\\rfloor", title: "Floor" },
      { preview: "\\lceil a\\rceil", insert: "\\left\\lceil #?\\right\\rceil", title: "Ceiling" },
    ],
    columns: 2,
  },
  {
    id: "function",
    label: "Function",
    icon: "\\sin",
    items: [
      { preview: "\\sin", insert: "\\sin #?", title: "sin" },
      { preview: "\\cos", insert: "\\cos #?", title: "cos" },
      { preview: "\\tan", insert: "\\tan #?", title: "tan" },
      { preview: "\\cot", insert: "\\cot #?", title: "cot" },
      { preview: "\\sec", insert: "\\sec #?", title: "sec" },
      { preview: "\\csc", insert: "\\csc #?", title: "csc" },
      { preview: "\\arcsin", insert: "\\arcsin #?", title: "arcsin" },
      { preview: "\\arccos", insert: "\\arccos #?", title: "arccos" },
      { preview: "\\arctan", insert: "\\arctan #?", title: "arctan" },
      { preview: "\\sinh", insert: "\\sinh #?", title: "sinh" },
      { preview: "\\cosh", insert: "\\cosh #?", title: "cosh" },
      { preview: "\\tanh", insert: "\\tanh #?", title: "tanh" },
      { preview: "\\log", insert: "\\log #?", title: "log" },
      { preview: "\\ln", insert: "\\ln #?", title: "ln" },
      { preview: "\\exp", insert: "\\exp #?", title: "exp" },
      { preview: "\\lim", insert: "\\lim #?", title: "lim" },
    ],
    columns: 4,
  },
  {
    id: "accent",
    label: "Accent",
    icon: "\\hat{a}",
    items: [
      { preview: "\\hat{a}", insert: "\\hat{#?}", title: "Hat" },
      { preview: "\\tilde{a}", insert: "\\tilde{#?}", title: "Tilde" },
      { preview: "\\bar{a}", insert: "\\bar{#?}", title: "Bar" },
      { preview: "\\vec{a}", insert: "\\vec{#?}", title: "Vector" },
      { preview: "\\dot{a}", insert: "\\dot{#?}", title: "Dot" },
      { preview: "\\ddot{a}", insert: "\\ddot{#?}", title: "Double dot" },
      { preview: "\\breve{a}", insert: "\\breve{#?}", title: "Breve" },
      { preview: "\\check{a}", insert: "\\check{#?}", title: "Check" },
    ],
    columns: 4,
  },
  {
    id: "matrix",
    label: "Matrix",
    icon: "[a\\,b]",
    items: [
      { preview: "\\begin{pmatrix}a & b\\\\c & d\\end{pmatrix}", insert: "\\begin{pmatrix}#? & #? \\\\ #? & #?\\end{pmatrix}", title: "2×2 parenthesized" },
      { preview: "\\begin{bmatrix}a & b\\\\c & d\\end{bmatrix}", insert: "\\begin{bmatrix}#? & #? \\\\ #? & #?\\end{bmatrix}", title: "2×2 bracketed" },
      { preview: "\\begin{vmatrix}a & b\\\\c & d\\end{vmatrix}", insert: "\\begin{vmatrix}#? & #? \\\\ #? & #?\\end{vmatrix}", title: "2×2 determinant" },
      { preview: "\\begin{pmatrix}a & b & c\\\\d & e & f\\\\g & h & i\\end{pmatrix}", insert: "\\begin{pmatrix}#? & #? & #? \\\\ #? & #? & #? \\\\ #? & #? & #?\\end{pmatrix}", title: "3×3 parenthesized" },
      { preview: "\\begin{pmatrix}a\\\\b\\end{pmatrix}", insert: "\\begin{pmatrix}#? \\\\ #?\\end{pmatrix}", title: "Column vector" },
      { preview: "\\begin{pmatrix}a & b\\end{pmatrix}", insert: "\\begin{pmatrix}#? & #?\\end{pmatrix}", title: "Row vector" },
      { preview: "\\begin{cases}a\\\\b\\end{cases}", insert: "\\begin{cases}#? \\\\ #?\\end{cases}", title: "Cases" },
    ],
    columns: 2,
  },
  {
    id: "greek",
    label: "Greek",
    icon: "\\alpha",
    items: [
      "\\alpha", "\\beta", "\\gamma", "\\delta", "\\epsilon", "\\varepsilon",
      "\\zeta", "\\eta", "\\theta", "\\vartheta", "\\iota", "\\kappa",
      "\\lambda", "\\mu", "\\nu", "\\xi", "\\pi", "\\varpi",
      "\\rho", "\\sigma", "\\tau", "\\upsilon", "\\phi", "\\varphi",
      "\\chi", "\\psi", "\\omega",
      "\\Gamma", "\\Delta", "\\Theta", "\\Lambda", "\\Xi", "\\Pi",
      "\\Sigma", "\\Upsilon", "\\Phi", "\\Psi", "\\Omega",
    ].map((cmd) => ({ preview: cmd, insert: cmd, title: cmd })),
    columns: 6,
    width: "280px",
  },
  {
    id: "relation",
    label: "Relation",
    icon: "\\leq",
    items: [
      "\\pm", "\\mp", "\\times", "\\div", "\\cdot", "\\ast",
      "\\leq", "\\geq", "\\ll", "\\gg", "\\neq", "\\approx",
      "\\equiv", "\\sim", "\\propto", "\\in", "\\notin", "\\subset",
      "\\subseteq", "\\supset", "\\cup", "\\cap", "\\forall", "\\exists",
      "\\infty", "\\partial", "\\nabla", "\\to", "\\leftarrow", "\\leftrightarrow",
      "\\Rightarrow", "\\Leftarrow", "\\Leftrightarrow", "\\therefore", "\\because",
    ].map((cmd) => ({ preview: cmd, insert: cmd, title: cmd })),
    columns: 6,
    width: "280px",
  },
];

/** Render KaTeX to an HTML string once and cache. */
const katexCache = new Map<string, string>();
function katexToHtml(latex: string, displayMode = false): string {
  const key = (displayMode ? "d:" : "i:") + latex;
  const cached = katexCache.get(key);
  if (cached !== undefined) return cached;
  let html = "";
  try {
    html = katex.renderToString(latex, {
      throwOnError: false,
      displayMode,
      output: "html",
    });
  } catch {
    html = `<span style="font-family:monospace;font-size:11px">${latex}</span>`;
  }
  katexCache.set(key, html);
  return html;
}

function RibbonButton({
  category,
  active,
  onClick,
}: {
  category: RibbonCategory;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => {
        // Keep focus in the mathfield AND prevent the panel-level "close
        // palette" handler from firing, so toggling works.
        e.preventDefault();
        e.stopPropagation();
      }}
      onClick={onClick}
      title={category.label}
      className={`flex flex-col items-center justify-center gap-1 px-3 py-1.5 rounded border cursor-pointer transition-colors ${
        active
          ? "bg-amber-500/20 border-amber-500 text-amber-100"
          : "bg-slate-800 border-slate-700 text-slate-100 hover:bg-slate-700"
      }`}
    >
      <span
        className="katex-preview leading-none"
        style={{ fontSize: "13px", color: "inherit" }}
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: katexToHtml(category.icon) }}
      />
      <span className="text-[9px] font-semibold uppercase tracking-wide opacity-80">
        {category.label}
      </span>
    </button>
  );
}

function PaletteItemButton({
  item,
  onSelect,
}: {
  item: PaletteItem;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onClick={onSelect}
      title={item.title}
      className="min-h-[38px] px-2 py-1 flex items-center justify-center bg-slate-900 hover:bg-amber-500/20 hover:border-amber-500 border border-slate-700 rounded cursor-pointer transition-colors text-slate-100"
    >
      <span
        className="katex-preview leading-none"
        style={{ fontSize: "14px", color: "inherit" }}
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: katexToHtml(item.preview) }}
      />
    </button>
  );
}

// Inline sub-ribbon: appears BELOW the category buttons and above the
// editor when a category is active. Never overlays the equation.
function SubRibbon({
  category,
  onSelect,
  onClose,
}: {
  category: RibbonCategory;
  onSelect: (item: PaletteItem) => void;
  onClose: () => void;
}) {
  // Column count that Greek/Relation asked for is designed for a narrow
  // popup; on the full-width sub-ribbon we can just let items flow.
  return (
    <div
      className="border-b border-slate-800 bg-slate-950/60 px-3 py-2"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
          {category.label}
        </span>
        <button
          type="button"
          onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
          onClick={onClose}
          title="Close panel"
          className="text-slate-500 hover:text-slate-200 text-xs leading-none w-5 h-5 flex items-center justify-center rounded hover:bg-slate-800 border-none bg-transparent cursor-pointer"
        >
          ×
        </button>
      </div>
      <div className="flex flex-wrap gap-1">
        {category.items.map((item, i) => (
          <PaletteItemButton key={i} item={item} onSelect={() => onSelect(item)} />
        ))}
      </div>
    </div>
  );
}

export function MathNodeView({ node, updateAttributes, selected, editor, getPos }: NodeViewProps) {
  const openOnMount = !!node.attrs.openOnMount;
  const [isEditing, setIsEditing] = useState(openOnMount);
  const [latexInput, setLatexInput] = useState<string>(node.attrs.latex || "");
  const previewRef = useRef<HTMLSpanElement>(null);
  const mathfieldRef = useRef<HTMLElement>(null);
  const [openCategory, setOpenCategory] = useState<string | null>(null);
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

  // Insert a LaTeX snippet at the caret using Mathlive's insert command.
  // Selection mode "placeholder" makes the first #? land selected so the
  // user can immediately type into the fraction numerator / sqrt argument /
  // sum body / etc.
  const insertLatex = (latex: string) => {
    const mf = mathfieldRef.current as any;
    if (!mf) return;
    try {
      mf.focus?.();
      mf.executeCommand?.(["insert", latex, {
        insertionMode: "replaceSelection",
        selectionMode: "placeholder",
        format: "latex",
      }]);
      const nextLatex = mf.getValue?.("latex") || mf.value || "";
      setLatexInput(nextLatex);
    } catch (err) {
      console.error("Mathlive insert failed:", err);
    }
  };

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

  // Close ribbon palette when the modal closes.
  useEffect(() => {
    if (!isEditing) setOpenCategory(null);
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
        className="math-modal-panel flex flex-col rounded-xl shadow-2xl bg-[#0b1220] border border-slate-700"
        style={{
          width: "min(90vw, 780px)",
          minWidth: "640px",
          maxHeight: "min(90vh, 600px)",
        }}
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

        {/* Word-style ribbon: category buttons on top; when one is active,
            an inline sub-ribbon appears below it (in-flow) with the symbols
            for that category. Clicking a symbol inserts it and closes the
            sub-ribbon so the editor gets its full space back. The editor
            is never covered — the modal grows to fit. */}
        <div className="flex-shrink-0 border-b border-slate-800 bg-slate-900/60 px-2 py-1.5">
          <div className="flex flex-wrap items-stretch gap-1">
            {RIBBON.map((cat) => (
              <RibbonButton
                key={cat.id}
                category={cat}
                active={openCategory === cat.id}
                onClick={() =>
                  setOpenCategory((prev) => (prev === cat.id ? null : cat.id))
                }
              />
            ))}
          </div>
        </div>

        {(() => {
          const active = RIBBON.find((c) => c.id === openCategory);
          return active ? (
            <SubRibbon
              category={active}
              onSelect={(item) => {
                // Keep the panel open after inserting so users can chain
                // multiple insertions (matches Word's Equation ribbon).
                insertLatex(item.insert);
              }}
              onClose={() => setOpenCategory(null)}
            />
          ) : null;
        })()}

        {/* Body: sized to the equation area, not stretched. Keeps the modal
            compact — the ribbon fits at the top, the editor is a fixed
            reasonable height, and the footer sits right below. */}
        <div className="flex flex-col p-3">
          {/* @ts-ignore */}
          <math-field
            ref={mathfieldRef}
            className="math-modal-field"
            math-virtual-keyboard-policy="manual"
            style={{
              width: "100%",
              minHeight: "150px",
              maxHeight: "260px",
              padding: "12px 14px",
              fontSize: "20px",
              lineHeight: "1.4",
              boxSizing: "border-box",
            }}
          />
        </div>

        <style>{`
          /* Force a white surface with dark ink so the equation is legible
             on the dark modal panel. */
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
          /* Hide the virtual keyboard toggle and the three-dot menu — we
             render our own symbol toolbar above. */
          .math-modal-panel math-field::part(virtual-keyboard-toggle),
          .math-modal-panel math-field::part(menu-toggle) {
            display: none !important;
            visibility: hidden !important;
            width: 0 !important;
            height: 0 !important;
            opacity: 0 !important;
            pointer-events: none !important;
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
