"""OMML (Office Math) → LaTeX converter.

Purpose: feed the Mathlive equation editor with a LaTeX string it can parse
reliably, since Mathlive's math-ml import silently rejects some shapes our
OMML→MathML converter produces.

Fidelity is intentionally moderate — LaTeX is only used as an *editing seed*.
The lossless round-trip lives elsewhere: the raw OMML is preserved as base64
on the editor node and re-injected verbatim when the equation is not edited.
So if this converter produces slightly imperfect LaTeX, unedited equations
are still emitted byte-identically, and edited equations only need the LaTeX
to be a faithful *starting point* for the user's changes.
"""

from __future__ import annotations

from lxml import etree

_M_NS = "http://schemas.openxmlformats.org/officeDocument/2006/math"

# ─── Character → LaTeX map for common Unicode math ──────────────────────

_UNICODE_TO_LATEX = {
    "α": r"\alpha", "β": r"\beta", "γ": r"\gamma", "δ": r"\delta",
    "ε": r"\epsilon", "ϵ": r"\epsilon", "ζ": r"\zeta", "η": r"\eta",
    "θ": r"\theta", "ϑ": r"\vartheta", "ι": r"\iota", "κ": r"\kappa",
    "λ": r"\lambda", "μ": r"\mu", "ν": r"\nu", "ξ": r"\xi",
    "π": r"\pi", "ϖ": r"\varpi", "ρ": r"\rho", "ϱ": r"\varrho",
    "σ": r"\sigma", "ς": r"\varsigma", "τ": r"\tau", "υ": r"\upsilon",
    "φ": r"\phi", "ϕ": r"\varphi", "χ": r"\chi", "ψ": r"\psi",
    "ω": r"\omega",
    "Α": r"A", "Β": r"B", "Γ": r"\Gamma", "Δ": r"\Delta", "Ε": r"E",
    "Ζ": r"Z", "Η": r"H", "Θ": r"\Theta", "Ι": r"I", "Κ": r"K",
    "Λ": r"\Lambda", "Μ": r"M", "Ν": r"N", "Ξ": r"\Xi", "Π": r"\Pi",
    "Ρ": r"P", "Σ": r"\Sigma", "Τ": r"T", "Υ": r"\Upsilon", "Φ": r"\Phi",
    "Χ": r"X", "Ψ": r"\Psi", "Ω": r"\Omega",
    "∞": r"\infty", "±": r"\pm", "∓": r"\mp", "×": r"\times",
    "÷": r"\div", "·": r"\cdot", "≤": r"\leq", "≥": r"\geq",
    "≠": r"\neq", "≈": r"\approx", "≡": r"\equiv", "∝": r"\propto",
    "∈": r"\in", "∉": r"\notin", "⊂": r"\subset", "⊆": r"\subseteq",
    "⊃": r"\supset", "⊇": r"\supseteq", "∪": r"\cup", "∩": r"\cap",
    "∀": r"\forall", "∃": r"\exists", "∅": r"\emptyset", "∇": r"\nabla",
    "∂": r"\partial", "∫": r"\int", "∮": r"\oint", "∑": r"\sum",
    "∏": r"\prod", "→": r"\to", "←": r"\leftarrow", "↔": r"\leftrightarrow",
    "⇒": r"\Rightarrow", "⇐": r"\Leftarrow", "⇔": r"\Leftrightarrow",
    "¬": r"\neg", "∧": r"\land", "∨": r"\lor", "√": r"\sqrt",
    "°": r"^{\circ}", "′": r"'", "″": r"''",
    "⁡": "",  # invisible function application — drop, LaTeX doesn't need it
}


def _escape_latex_text(s: str) -> str:
    """Escape characters that have special meaning in LaTeX."""
    out = []
    for ch in s:
        if ch in _UNICODE_TO_LATEX:
            mapped = _UNICODE_TO_LATEX[ch]
            # Add a space after control-sequence-style escapes so they don't
            # eat the following character.
            if mapped.startswith("\\") and out and not out[-1].endswith(" "):
                out.append(mapped)
            else:
                out.append(mapped)
        elif ch in ("\\", "{", "}", "$", "&", "#", "^", "_", "%", "~"):
            out.append("\\" + ch)
        else:
            out.append(ch)
    return "".join(out)


def _local(el) -> str:
    return etree.QName(el.tag).localname


def _text(el) -> str:
    return "".join(el.itertext()) if el is not None else ""


def _child(el, name: str):
    return el.find(f"{{{_M_NS}}}{name}")


def _children(el, name: str):
    return el.findall(f"{{{_M_NS}}}{name}")


def _group(inner: str) -> str:
    """Wrap in braces unless already a single token."""
    if not inner:
        return "{}"
    # Single char that isn't a control sequence — no braces needed
    if len(inner) == 1 and inner not in ("\\",):
        return inner
    # Simple digit sequence — no braces needed for single-token things
    if inner.isalnum() and len(inner) < 4:
        # Still wrap in braces for safety in super/subscript contexts
        pass
    return "{" + inner + "}"


def _convert_children(elements) -> str:
    return "".join(_convert_element(el) for el in elements)


# ─── Element handlers ─────────────────────────────────────────────────────


def _convert_element(el) -> str:
    tag = _local(el)

    # Skip property elements (formatting metadata that doesn't affect content)
    if tag.endswith("Pr") or tag == "ctrlPr":
        return ""

    if tag == "r":
        parts = []
        for t in el.findall(f"{{{_M_NS}}}t"):
            parts.append(_escape_latex_text(_text(t)))
        return "".join(parts)

    if tag == "t":
        return _escape_latex_text(_text(el))

    if tag == "f":  # fraction
        num = _convert_children(list(_child(el, "num") if _child(el, "num") is not None else []))
        den = _convert_children(list(_child(el, "den") if _child(el, "den") is not None else []))
        return "\\frac" + _group(num) + _group(den)

    if tag == "sSup":  # superscript
        base = _convert_children(list(_child(el, "e") if _child(el, "e") is not None else []))
        sup = _convert_children(list(_child(el, "sup") if _child(el, "sup") is not None else []))
        return _group(base) + "^" + _group(sup)

    if tag == "sSub":  # subscript
        base = _convert_children(list(_child(el, "e") if _child(el, "e") is not None else []))
        sub = _convert_children(list(_child(el, "sub") if _child(el, "sub") is not None else []))
        return _group(base) + "_" + _group(sub)

    if tag == "sSubSup":  # both
        base = _convert_children(list(_child(el, "e") if _child(el, "e") is not None else []))
        sub = _convert_children(list(_child(el, "sub") if _child(el, "sub") is not None else []))
        sup = _convert_children(list(_child(el, "sup") if _child(el, "sup") is not None else []))
        return _group(base) + "_" + _group(sub) + "^" + _group(sup)

    if tag == "sPre":  # pre-scripts (approximation — LaTeX \sideset)
        sub = _convert_children(list(_child(el, "sub") if _child(el, "sub") is not None else []))
        sup = _convert_children(list(_child(el, "sup") if _child(el, "sup") is not None else []))
        base = _convert_children(list(_child(el, "e") if _child(el, "e") is not None else []))
        return "{}^" + _group(sup) + "_" + _group(sub) + _group(base)

    if tag == "rad":  # radical
        base = _convert_children(list(_child(el, "e") if _child(el, "e") is not None else []))
        deg_el = _child(el, "deg")
        deg = _convert_children(list(deg_el)) if deg_el is not None and len(list(deg_el)) else ""
        if deg:
            return "\\sqrt[" + deg + "]" + _group(base)
        return "\\sqrt" + _group(base)

    if tag == "d":  # delimited (parens, brackets, etc.)
        dpr = _child(el, "dPr")
        beg, end, sep = "(", ")", "|"
        if dpr is not None:
            beg_e = dpr.find(f"{{{_M_NS}}}begChr")
            end_e = dpr.find(f"{{{_M_NS}}}endChr")
            sep_e = dpr.find(f"{{{_M_NS}}}sepChr")
            if beg_e is not None:
                beg = beg_e.get(f"{{{_M_NS}}}val", beg)
            if end_e is not None:
                end = end_e.get(f"{{{_M_NS}}}val", end)
            if sep_e is not None:
                sep = sep_e.get(f"{{{_M_NS}}}val", sep)
        args = [_convert_children(list(e)) for e in _children(el, "e")]
        inner = sep.join(args)
        # Use \left...\right for stretchy delimiters. Fall back to raw for
        # unusual chars Mathlive might not accept in \left.
        _lefts = {"(", "[", "{", "|", "‖", "⟨", "⌊", "⌈", ""}
        _rights = {")", "]", "}", "|", "‖", "⟩", "⌋", "⌉", ""}
        beg_esc = "\\{" if beg == "{" else beg
        end_esc = "\\}" if end == "}" else end
        if beg in _lefts and end in _rights:
            beg_ltx = "." if beg == "" else beg_esc
            end_ltx = "." if end == "" else end_esc
            return f"\\left{beg_ltx} {inner} \\right{end_ltx}"
        return beg_esc + inner + end_esc

    if tag == "nary":  # n-ary op
        npr = _child(el, "naryPr")
        chr_val = "\\sum"
        sub_hide = sup_hide = False
        if npr is not None:
            chr_e = npr.find(f"{{{_M_NS}}}chr")
            if chr_e is not None:
                raw = chr_e.get(f"{{{_M_NS}}}val", "∑")
                chr_val = _UNICODE_TO_LATEX.get(raw, raw)
            sh = npr.find(f"{{{_M_NS}}}subHide")
            if sh is not None and sh.get(f"{{{_M_NS}}}val", "0") in ("1", "true", "on"):
                sub_hide = True
            sh = npr.find(f"{{{_M_NS}}}supHide")
            if sh is not None and sh.get(f"{{{_M_NS}}}val", "0") in ("1", "true", "on"):
                sup_hide = True
        sub_e = _child(el, "sub")
        sup_e = _child(el, "sup")
        e_e = _child(el, "e")
        parts = [chr_val]
        if sub_e is not None and not sub_hide:
            sub_latex = _convert_children(list(sub_e))
            if sub_latex:
                parts.append("_" + _group(sub_latex))
        if sup_e is not None and not sup_hide:
            sup_latex = _convert_children(list(sup_e))
            if sup_latex:
                parts.append("^" + _group(sup_latex))
        if e_e is not None:
            body = _convert_children(list(e_e))
            if body:
                parts.append(" " + body)
        return "".join(parts)

    if tag == "func":  # function like sin/cos/log
        fname_el = _child(el, "fName")
        e_el = _child(el, "e")
        fname_raw = _text(fname_el).strip() if fname_el is not None else ""
        # Map common function names to their LaTeX macros
        _KNOWN = {
            "sin", "cos", "tan", "cot", "sec", "csc",
            "arcsin", "arccos", "arctan",
            "sinh", "cosh", "tanh", "coth",
            "log", "ln", "lg", "exp",
            "lim", "sup", "inf", "min", "max", "det", "arg",
        }
        fname_latex = f"\\{fname_raw}" if fname_raw.lower() in _KNOWN else fname_raw
        arg = _convert_children(list(e_el)) if e_el is not None else ""
        return f"{fname_latex} {arg}".strip()

    if tag == "limLow":
        base = _convert_children(list(_child(el, "e") if _child(el, "e") is not None else []))
        lim = _convert_children(list(_child(el, "lim") if _child(el, "lim") is not None else []))
        return f"\\underset{_group(lim)}{_group(base)}"

    if tag == "limUpp":
        base = _convert_children(list(_child(el, "e") if _child(el, "e") is not None else []))
        lim = _convert_children(list(_child(el, "lim") if _child(el, "lim") is not None else []))
        return f"\\overset{_group(lim)}{_group(base)}"

    if tag == "m":  # matrix
        rows = []
        for r in _children(el, "mr"):
            cells = [_convert_children(list(c)) for c in _children(r, "e")]
            rows.append(" & ".join(cells))
        body = " \\\\ ".join(rows)
        return f"\\begin{{matrix}} {body} \\end{{matrix}}"

    if tag == "acc":  # accent
        apr = _child(el, "accPr")
        chr_val = "^"  # default hat
        raw = "̂"
        if apr is not None:
            chr_e = apr.find(f"{{{_M_NS}}}chr")
            if chr_e is not None:
                raw = chr_e.get(f"{{{_M_NS}}}val", raw)
        _ACC = {"̂": "\\hat", "̃": "\\tilde", "̄": "\\bar", "̇": "\\dot",
                "̈": "\\ddot", "́": "\\acute", "̀": "\\grave", "̆": "\\breve",
                "̌": "\\check", "⃗": "\\vec"}
        cmd = _ACC.get(raw, "\\hat")
        base = _convert_children(list(_child(el, "e") if _child(el, "e") is not None else []))
        return cmd + _group(base)

    if tag == "bar":
        base = _convert_children(list(_child(el, "e") if _child(el, "e") is not None else []))
        bpr = _child(el, "barPr")
        pos = "top"
        if bpr is not None:
            p = bpr.find(f"{{{_M_NS}}}pos")
            if p is not None:
                pos = p.get(f"{{{_M_NS}}}val", pos)
        return ("\\underline" if pos == "bot" else "\\overline") + _group(base)

    if tag in ("box", "e", "num", "den", "sub", "sup", "deg", "fName", "lim"):
        return _convert_children(list(el))

    if tag == "borderBox":
        base = _convert_children(list(_child(el, "e") if _child(el, "e") is not None else []))
        return "\\boxed" + _group(base)

    if tag == "phant":
        base = _convert_children(list(_child(el, "e") if _child(el, "e") is not None else []))
        return "\\phantom" + _group(base)

    if tag == "eqArr":
        rows = [_convert_children(list(r)) for r in _children(el, "e")]
        body = " \\\\ ".join(rows)
        return f"\\begin{{aligned}} {body} \\end{{aligned}}"

    if tag == "groupChr":
        gpr = _child(el, "groupChrPr")
        pos = "top"
        if gpr is not None:
            p = gpr.find(f"{{{_M_NS}}}pos")
            if p is not None:
                pos = p.get(f"{{{_M_NS}}}val", pos)
        base = _convert_children(list(_child(el, "e") if _child(el, "e") is not None else []))
        return ("\\underbrace" if pos == "bot" else "\\overbrace") + _group(base)

    # Unknown — recurse into children
    return _convert_children(list(el))


def convert_omml_to_latex(omml_el) -> str:
    """Convert an <m:oMath> or <m:oMathPara> lxml element to a LaTeX string."""
    tag = _local(omml_el)
    try:
        if tag == "oMathPara":
            body_parts = []
            for m in _children(omml_el, "oMath"):
                body_parts.append(_convert_children(list(m)))
            return " ".join(p for p in body_parts if p).strip()
        return _convert_children(list(omml_el)).strip()
    except Exception:
        # Last-resort: return the raw text content so the editor at least shows
        # something the user can start from.
        return _escape_latex_text(_text(omml_el).strip())
