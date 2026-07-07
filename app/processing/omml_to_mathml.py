"""OMML (Office Math Markup) → MathML converter.

Handles the OMML shapes that appear in real-world Word documents: fractions,
sub/superscripts, radicals, delimiters, n-ary operators (∑/∫), matrices,
accents, bars, functions (sin/cos/log), and grouping. Unknown constructs are
wrapped in an <mrow> with best-effort child conversion so the display degrades
gracefully instead of throwing away content.

The raw OMML is preserved separately by the caller (base64 on the editor node)
so lossless round-trip is guaranteed regardless of what this converter emits —
this module only powers on-screen rendering.
"""

from __future__ import annotations

from lxml import etree

_M_NS = "http://schemas.openxmlformats.org/officeDocument/2006/math"
_MATHML_NS = "http://www.w3.org/1998/Math/MathML"


def _local(el) -> str:
    return etree.QName(el.tag).localname


def _text(el) -> str:
    return "".join(el.itertext()) if el is not None else ""


def _child(el, name: str):
    return el.find(f"{{{_M_NS}}}{name}")


def _children(el, name: str):
    return el.findall(f"{{{_M_NS}}}{name}")


def _mk(tag: str, *children, **attrs):
    e = etree.Element(f"{{{_MATHML_NS}}}{tag}", nsmap={None: _MATHML_NS})
    for k, v in attrs.items():
        e.set(k, v)
    for c in children:
        if c is None:
            continue
        if isinstance(c, str):
            if len(e) == 0:
                e.text = (e.text or "") + c
            else:
                e[-1].tail = (e[-1].tail or "") + c
        else:
            e.append(c)
    return e


# ─── Character classification for m:t → mi/mn/mo ──────────────────────────

_OPERATOR_CHARS = set("+-−*/=<>≤≥≠±×÷·∓∘∙∗⋅∘⊕⊖⊗⊘⊙∩∪∈∉⊂⊆⊃⊇∀∃∅∇∂∫∮∑∏∐→←↔⇒⇐⇔⟶⟵⟷¬∧∨→≡≈≜≃≅∼∝⟂∠°′″()[]{}⟨⟩|‖,;:.")


def _classify_char(ch: str) -> str:
    if ch.isdigit() or ch == ".":
        return "mn"
    if ch.isalpha():
        return "mi"
    if ch.isspace():
        return "mtext"
    if ch in _OPERATOR_CHARS:
        return "mo"
    return "mo"


def _split_text_to_mathml(text: str):
    """Split a raw run string into a sequence of MathML tokens."""
    tokens = []
    if not text:
        return tokens
    i = 0
    while i < len(text):
        ch = text[i]
        kind = _classify_char(ch)
        if kind == "mn":
            j = i
            while j < len(text) and (text[j].isdigit() or text[j] == "."):
                j += 1
            tokens.append(_mk("mn", text[i:j]))
            i = j
        elif kind == "mi":
            # keep multi-letter identifiers (sin/cos/log) as one mi so they
            # display as function names rather than a spaced product.
            j = i
            while j < len(text) and text[j].isalpha():
                j += 1
            word = text[i:j]
            if len(word) == 1:
                tokens.append(_mk("mi", word))
            else:
                tokens.append(_mk("mi", word))
            i = j
        elif kind == "mtext":
            j = i
            while j < len(text) and text[j].isspace():
                j += 1
            tokens.append(_mk("mtext", text[i:j]))
            i = j
        else:
            tokens.append(_mk("mo", ch))
            i += 1
    return tokens


# ─── Element handlers ─────────────────────────────────────────────────────


def _convert_children(elements):
    """Convert a sequence of OMML elements into a flat list of MathML nodes."""
    out = []
    for el in elements:
        result = _convert_element(el)
        if result is None:
            continue
        if isinstance(result, list):
            out.extend(result)
        else:
            out.append(result)
    return out


def _row(elements):
    """Wrap a sequence of OMML elements as an <mrow>."""
    children = _convert_children(elements)
    if len(children) == 1:
        return children[0]
    return _mk("mrow", *children)


def _convert_element(el):
    tag = _local(el)

    if tag in ("ctrlPr", "argPr", "fPr", "sSubPr", "sSupPr", "sSubSupPr",
               "radPr", "dPr", "naryPr", "mPr", "mrPr", "accPr", "barPr",
               "limLowPr", "limUppPr", "funcPr", "eqArrPr", "boxPr",
               "groupChrPr", "sPrePr", "borderBoxPr", "phantPr"):
        return None

    if tag == "r":
        # m:r → text run; children include m:t
        parts = []
        for t in el.findall(f"{{{_M_NS}}}t"):
            parts.extend(_split_text_to_mathml(_text(t)))
        return parts

    if tag == "t":
        return _split_text_to_mathml(_text(el))

    if tag == "f":  # fraction
        num = _child(el, "num")
        den = _child(el, "den")
        return _mk(
            "mfrac",
            _row(list(num) if num is not None else []),
            _row(list(den) if den is not None else []),
        )

    if tag == "sSup":  # superscript
        base = _child(el, "e")
        sup = _child(el, "sup")
        return _mk(
            "msup",
            _row(list(base) if base is not None else []),
            _row(list(sup) if sup is not None else []),
        )

    if tag == "sSub":  # subscript
        base = _child(el, "e")
        sub = _child(el, "sub")
        return _mk(
            "msub",
            _row(list(base) if base is not None else []),
            _row(list(sub) if sub is not None else []),
        )

    if tag == "sSubSup":
        base = _child(el, "e")
        sub = _child(el, "sub")
        sup = _child(el, "sup")
        return _mk(
            "msubsup",
            _row(list(base) if base is not None else []),
            _row(list(sub) if sub is not None else []),
            _row(list(sup) if sup is not None else []),
        )

    if tag == "sPre":  # pre-scripts
        sub = _child(el, "sub")
        sup = _child(el, "sup")
        base = _child(el, "e")
        return _mk(
            "mmultiscripts",
            _row(list(base) if base is not None else []),
            _mk("mprescripts"),
            _row(list(sub) if sub is not None else []),
            _row(list(sup) if sup is not None else []),
        )

    if tag == "rad":  # radical
        base = _child(el, "e")
        deg = _child(el, "deg")
        base_row = _row(list(base) if base is not None else [])
        if deg is not None and len(list(deg)) > 0:
            return _mk("mroot", base_row, _row(list(deg)))
        return _mk("msqrt", base_row)

    if tag == "d":  # delimited (parentheses etc.)
        # dPr may specify begChr/endChr; default is ()
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
        # multiple m:e children get separated by sep
        args = _children(el, "e")
        row_children = [_mk("mo", beg)]
        for i, e in enumerate(args):
            if i > 0:
                row_children.append(_mk("mo", sep))
            row_children.append(_row(list(e)))
        row_children.append(_mk("mo", end))
        return _mk("mrow", *row_children)

    if tag == "nary":  # n-ary op (∑, ∫, ∏, etc.)
        npr = _child(el, "naryPr")
        chr_val = "∑"  # default ∑
        sub_hide = sup_hide = False
        lim_loc = None  # 'undOvr' or 'subSup'
        if npr is not None:
            chr_e = npr.find(f"{{{_M_NS}}}chr")
            if chr_e is not None:
                chr_val = chr_e.get(f"{{{_M_NS}}}val", chr_val)
            sh = npr.find(f"{{{_M_NS}}}subHide")
            if sh is not None and sh.get(f"{{{_M_NS}}}val", "0") in ("1", "true", "on"):
                sub_hide = True
            sh = npr.find(f"{{{_M_NS}}}supHide")
            if sh is not None and sh.get(f"{{{_M_NS}}}val", "0") in ("1", "true", "on"):
                sup_hide = True
            ll = npr.find(f"{{{_M_NS}}}limLoc")
            if ll is not None:
                lim_loc = ll.get(f"{{{_M_NS}}}val")

        base = _mk("mo", chr_val)
        sub_e = _child(el, "sub")
        sup_e = _child(el, "sup")
        e_e = _child(el, "e")

        # Default limit placement: sum/prod → underover, integral → subsup
        if lim_loc is None:
            lim_loc = "undOvr" if chr_val in ("∑", "∏", "∐") else "subSup"

        sub_row = None if sub_hide or sub_e is None else _row(list(sub_e))
        sup_row = None if sup_hide or sup_e is None else _row(list(sup_e))

        if lim_loc == "undOvr":
            if sub_row is not None and sup_row is not None:
                op = _mk("munderover", base, sub_row, sup_row)
            elif sub_row is not None:
                op = _mk("munder", base, sub_row)
            elif sup_row is not None:
                op = _mk("mover", base, sup_row)
            else:
                op = base
        else:
            if sub_row is not None and sup_row is not None:
                op = _mk("msubsup", base, sub_row, sup_row)
            elif sub_row is not None:
                op = _mk("msub", base, sub_row)
            elif sup_row is not None:
                op = _mk("msup", base, sup_row)
            else:
                op = base

        body = _row(list(e_e) if e_e is not None else [])
        return _mk("mrow", op, body)

    if tag == "func":  # function application: fName(e)
        fname = _child(el, "fName")
        e_e = _child(el, "e")
        return _mk(
            "mrow",
            _row(list(fname) if fname is not None else []),
            _mk("mo", "⁡"),  # invisible function application
            _row(list(e_e) if e_e is not None else []),
        )

    if tag == "limLow":  # base under lim
        base = _child(el, "e")
        lim = _child(el, "lim")
        return _mk(
            "munder",
            _row(list(base) if base is not None else []),
            _row(list(lim) if lim is not None else []),
        )

    if tag == "limUpp":
        base = _child(el, "e")
        lim = _child(el, "lim")
        return _mk(
            "mover",
            _row(list(base) if base is not None else []),
            _row(list(lim) if lim is not None else []),
        )

    if tag == "m":  # matrix
        rows = _children(el, "mr")
        mrows = []
        for r in rows:
            cells = _children(r, "e")
            mrows.append(_mk("mtr", *[_mk("mtd", _row(list(c))) for c in cells]))
        return _mk("mtable", *mrows)

    if tag == "acc":  # accent
        apr = _child(el, "accPr")
        chr_val = "̂"  # default hat
        if apr is not None:
            chr_e = apr.find(f"{{{_M_NS}}}chr")
            if chr_e is not None:
                chr_val = chr_e.get(f"{{{_M_NS}}}val", chr_val)
        base = _child(el, "e")
        return _mk(
            "mover",
            _row(list(base) if base is not None else []),
            _mk("mo", chr_val),
            accent="true",
        )

    if tag == "bar":  # bar over/under
        bpr = _child(el, "barPr")
        pos = "top"
        if bpr is not None:
            p = bpr.find(f"{{{_M_NS}}}pos")
            if p is not None:
                pos = p.get(f"{{{_M_NS}}}val", pos)
        base = _child(el, "e")
        base_row = _row(list(base) if base is not None else [])
        bar_op = _mk("mo", "¯")
        if pos == "bot":
            return _mk("munder", base_row, bar_op, accentunder="true")
        return _mk("mover", base_row, bar_op, accent="true")

    if tag == "box":  # grouping
        base = _child(el, "e")
        return _row(list(base) if base is not None else [])

    if tag == "borderBox":
        base = _child(el, "e")
        return _mk("menclose", _row(list(base) if base is not None else []), notation="box")

    if tag == "phant":
        base = _child(el, "e")
        return _mk("mphantom", _row(list(base) if base is not None else []))

    if tag == "groupChr":
        gpr = _child(el, "groupChrPr")
        chr_val = "⏞"
        pos = "top"
        if gpr is not None:
            c = gpr.find(f"{{{_M_NS}}}chr")
            if c is not None:
                chr_val = c.get(f"{{{_M_NS}}}val", chr_val)
            p = gpr.find(f"{{{_M_NS}}}pos")
            if p is not None:
                pos = p.get(f"{{{_M_NS}}}val", pos)
        base = _child(el, "e")
        base_row = _row(list(base) if base is not None else [])
        op = _mk("mo", chr_val)
        return _mk("munder" if pos == "bot" else "mover", base_row, op)

    if tag == "eqArr":  # aligned equations
        rows = _children(el, "e")
        return _mk("mtable", *[_mk("mtr", _mk("mtd", _row(list(r)))) for r in rows])

    if tag in ("e", "num", "den", "sub", "sup", "deg", "fName", "lim"):
        return _row(list(el))

    # Fallback: unknown tag — try children
    kids = _convert_children(list(el))
    if not kids:
        return None
    return _mk("mrow", *kids) if len(kids) > 1 else kids[0]


def convert_omml_element(omml_el) -> str:
    """Convert an <m:oMath> or <m:oMathPara> lxml element to a MathML string.

    Returns a serialized <math xmlns="...MathML..."> element. Never raises —
    on any failure returns a minimal fallback with the raw text so the editor
    still shows *something*.
    """
    tag = _local(omml_el)
    try:
        if tag == "oMathPara":
            # Concatenate every oMath inside; render as display-mode math.
            body_children = []
            for m in _children(omml_el, "oMath"):
                body_children.extend(_convert_children(list(m)))
            root = _mk("math", _mk("mrow", *body_children))
            root.set("display", "block")
            return etree.tostring(root, encoding="unicode")

        body_children = _convert_children(list(omml_el))
        root = _mk("math", _mk("mrow", *body_children))
        return etree.tostring(root, encoding="unicode")
    except Exception:
        # Last-resort fallback so the editor still receives *some* MathML.
        txt = _text(omml_el).strip() or "?"
        root = _mk("math", _mk("mtext", txt))
        return etree.tostring(root, encoding="unicode")
