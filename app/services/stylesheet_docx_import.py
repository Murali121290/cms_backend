"""Read edits made to an S4C Editorial Style Sheet (.docx) back into the stylesheet.

Flow
----
``preview_docx_changes(docx_bytes, current_data)`` returns the list of changes an editor
made in Word, compared with the stylesheet the .docx was exported from:

* The export (``stylesheet_docx_export``) marks every table with a hidden caption
  ("s4c:rules", "s4c:word_replacements", ...) and embeds the exported stylesheet
  (rules + profile) as a custom XML part.
* The edited .docx is parsed, and so is a fresh rendering of that embedded snapshot
  (the *baseline*). Comparing parsed-with-parsed means an unedited .docx always gives
  zero changes.
* Edits are applied on top of the *current* stylesheet, so changes made in the app after
  the export are kept; a field changed in both places is reported as a conflict.

``apply_docx_changes(current_data, changes, accepted, resolutions)`` returns the new
``ce_rules`` / ``style_profile``. The caller saves them with ``update_stylesheet``.

A .docx without S4C markers (a customer's own style sheet) is read with the existing
``DocxStylesheetParser`` and proposed as additions/changes to the current stylesheet.
"""
from __future__ import annotations

import io
import json
import re
from dataclasses import dataclass, field
from difflib import SequenceMatcher
from typing import Any

import docx
from docx.oxml.ns import qn

from app.services import stylesheet_docx_export as exp

LIST_KEYS = ("word_replacements", "org_names", "word_list", "acronyms_no_spellout", "registered_terms", "avoid_words")
SETTING_KEYS = ("book_type", "list_style")
LIST_TITLES = {
    "word_replacements": "Word list",
    "org_names": "Organization names",
    "word_list": "Approved terms",
    "acronyms_no_spellout": "Never spelled out at first use",
    "registered_terms": "Registration mark (®)",
    "avoid_words": "Words to avoid",
}
TABLE_OF = {
    "word_replacements": exp.CAP_WORDS, "org_names": exp.CAP_ORGS, "word_list": exp.CAP_WORD_LIST,
    "acronyms_no_spellout": exp.CAP_ACRONYMS, "registered_terms": exp.CAP_REGISTERED, "avoid_words": exp.CAP_AVOID,
}
SECTION_OF = {
    "word_replacements": "words", "word_list": "words", "org_names": "orgs",
    "acronyms_no_spellout": "abbr", "registered_terms": "abbr", "avoid_words": "abbr",
}
_HEADERS = {
    ("RULE", "TOPIC", "HOUSE STYLE", "HANDLING"): exp.CAP_RULES,
    ("USE", "NOT", "NOTE"): exp.CAP_WORDS,
    ("USE", "NOT"): exp.CAP_ORGS,
    ("AVOID", "USE"): exp.CAP_AVOID,
    ("SETTING", "HOUSE STYLE"): exp.CAP_UNITS,
    ("REFERENCE POINT", "HOUSE STYLE"): exp.CAP_REFS,
}
_REF_KEYS = {_norm_label: key for _norm_label, key in
             ((re.sub(r"\s+", " ", label).strip().lower(), key) for label, key in exp.REFERENCE_ROWS)}
_REF_INT_KEYS = {"list_all_authors_up_to", "et_al_after_first"}
_UNIT_SETTINGS = {"book type": "book_type", "list style": "list_style"}


class DocxImportError(ValueError):
    pass


# --------------------------------------------------------------------------- text helpers
_QUOTES = str.maketrans({"‘": "'", "’": "'", "“": '"', "”": '"', "–": "-", "—": "-",
                         "−": "-", " ": " ", " ": " ", " ": " "})


def _norm(text: str | None) -> str:
    return re.sub(r"\s+", " ", str(text or "").translate(_QUOTES)).strip().lower()


def _cell_lines(cell) -> list[str]:
    return [p.text.strip() for p in cell.paragraphs if p.text.strip()]


def _setting_value(text: str) -> str | None:
    t = _norm(text)
    return None if t in ("", "-", "—") else t.replace(" ", "_")


# --------------------------------------------------------------------------- parsing
@dataclass
class ParsedSheet:
    is_s4c: bool = False
    stylesheet_id: int | None = None
    base_hash: str | None = None
    snapshot: dict | None = None
    has_rule_tables: bool = False
    rules: dict[int, dict] = field(default_factory=dict)          # sno -> {lines, topic, handling}
    lists: dict[str, dict] = field(default_factory=lambda: {k: {} for k in LIST_KEYS})
    settings: dict[str, str | None] = field(default_factory=dict)  # book_type / list_style
    units: dict[str, str] = field(default_factory=dict)            # other unit rows (info only)
    references: dict[str, Any] = field(default_factory=dict)       # style_profile.reference_style
    found: set[str] = field(default_factory=set)                   # table keys present in the .docx
    warnings: list[str] = field(default_factory=list)


# Headerless tables, recognised by the subheading just above them when captions are lost
_SUBHEADINGS = (
    ("approved terms", exp.CAP_WORD_LIST),
    ("never spelled out", exp.CAP_ACRONYMS),
    ("registration mark", exp.CAP_REGISTERED),
)


def _table_key(table, heading: str = "") -> str | None:
    tbl_pr = table._tbl.tblPr
    cap = tbl_pr.find(qn("w:tblCaption")) if tbl_pr is not None else None
    if cap is not None and (cap.get(qn("w:val")) or "").startswith("s4c:"):
        return cap.get(qn("w:val"))
    if not table.rows:
        return None
    head = tuple(_norm(c.text).upper() for c in table.rows[0].cells)
    if head in _HEADERS:
        return _HEADERS[head]
    h = _norm(heading)
    return next((key for prefix, key in _SUBHEADINGS if h.startswith(prefix)), None)


def _headings_before_tables(document) -> dict:
    """Table element -> text of the closest non-empty paragraph before it."""
    out, last = {}, ""
    for el in document.element.body.iterchildren():
        if el.tag == qn("w:p"):
            text = "".join(t.text or "" for t in el.iter(qn("w:t"))).strip()
            if text:
                last = text
        elif el.tag == qn("w:tbl"):
            out[el] = last
    return out


def _snapshot(document) -> dict | None:
    for part in document.part.package.iter_parts():
        if not str(part.partname).startswith("/customXml/item"):
            continue
        blob = getattr(part, "blob", b"") or b""
        if exp.SNAPSHOT_NS.encode() not in blob:
            continue
        try:
            from xml.etree import ElementTree as ET
            root = ET.fromstring(blob)
            return json.loads(root.text or "{}")
        except Exception:
            return None
    return None


def _split_terms(text: str, key: str) -> list[str]:
    if key == exp.CAP_REGISTERED:
        parts = re.split(r"®|\n|;|,", text)
    elif key == exp.CAP_WORD_LIST:
        parts = re.split(r";|\n", text)
    else:
        parts = re.split(r"[\s,;]+", text)
    return [p.strip() for p in parts if p.strip()]


def parse_style_sheet_docx(content: bytes) -> ParsedSheet:
    try:
        document = docx.Document(io.BytesIO(content))
    except Exception as exc:
        raise DocxImportError(f"Not a readable Word document: {exc}") from exc

    out = ParsedSheet()
    props = document.core_properties
    ident = props.identifier or ""
    if ident.startswith(exp.IDENTIFIER_PREFIX):
        try:
            out.stylesheet_id = int(ident[len(exp.IDENTIFIER_PREFIX):])
        except ValueError:
            pass
    out.snapshot = _snapshot(document)
    out.base_hash = (out.snapshot or {}).get("content_hash") or props.version or None
    if out.stylesheet_id is None and out.snapshot and isinstance(out.snapshot.get("id"), int):
        out.stylesheet_id = out.snapshot["id"]

    found_any = False
    headings = _headings_before_tables(document)
    for table in document.tables:
        key = _table_key(table, headings.get(table._tbl, ""))
        if not key:
            continue
        found_any = True
        out.found.add(key)
        rows = list(table.rows)
        has_header = bool(rows) and tuple(_norm(c.text).upper() for c in rows[0].cells) in _HEADERS
        body = rows[1:] if has_header else rows

        if key == exp.CAP_RULES:
            out.has_rule_tables = True
            for row in body:
                cells = row.cells
                if len(cells) < 3:
                    continue
                rid = _norm(cells[0].text).replace(" ", "")
                m = re.fullmatch(r"r(\d+)", rid)
                if not m:
                    if any(c.text.strip() for c in cells):
                        out.warnings.append(f"A rule row without a rule number (\"{cells[0].text.strip() or cells[1].text.strip()}\") was ignored.")
                    continue
                sno = int(m.group(1))
                if sno in out.rules:
                    out.warnings.append(f"R{sno} appears more than once; the first row was used.")
                    continue
                out.rules[sno] = {
                    "lines": _cell_lines(cells[2]),
                    "topic": (_cell_lines(cells[1]) or [""])[0],
                    "handling": cells[3].text.strip() if len(cells) > 3 else "",
                }
        elif key in (exp.CAP_WORDS, exp.CAP_ORGS):
            target = "word_replacements" if key == exp.CAP_WORDS else "org_names"
            for row in body:
                cells = row.cells
                use, not_ = cells[0].text.strip(), (cells[1].text.strip() if len(cells) > 1 else "")
                if not use and not not_:
                    continue
                if not use or not not_:
                    out.warnings.append(f"{LIST_TITLES[target]}: the row \"{use or not_}\" needs both Use and Not; ignored.")
                    continue
                item = {"find": not_, "replace": use}
                if target == "word_replacements":
                    note = cells[2].text.strip() if len(cells) > 2 else ""
                    if note:
                        item["note"] = note
                out.lists[target][_norm(not_)] = item
        elif key == exp.CAP_WORD_LIST:
            for row in rows:
                for cell in row.cells:
                    lines = _cell_lines(cell)
                    text = "\n".join(lines[1:]) if len(lines) > 1 and len(lines[0]) <= 1 else "\n".join(lines)
                    for term in _split_terms(text, key):
                        out.lists["word_list"][_norm(term)] = term
        elif key in (exp.CAP_ACRONYMS, exp.CAP_REGISTERED):
            target = "acronyms_no_spellout" if key == exp.CAP_ACRONYMS else "registered_terms"
            text = "\n".join(c.text for r in rows for c in r.cells)
            for term in _split_terms(text, key):
                out.lists[target][_norm(term)] = term
        elif key == exp.CAP_AVOID:
            for row in body:
                cells = row.cells
                a, u = cells[0].text.strip(), (cells[1].text.strip() if len(cells) > 1 else "")
                if a and u:
                    out.lists["avoid_words"][_norm(a)] = {"avoid": a, "use": u}
                elif a or u:
                    out.warnings.append(f"Words to avoid: the row \"{a or u}\" needs both Avoid and Use; ignored.")
        elif key == exp.CAP_REFS:
            for row in body:
                cells = row.cells
                if len(cells) < 2:
                    continue
                ref_key = _REF_KEYS.get(_norm(cells[0].text))
                value = cells[1].text.strip()
                if not ref_key or not value:
                    continue
                if ref_key in _REF_INT_KEYS:
                    m = re.search(r"\d+", value)
                    if not m:
                        out.warnings.append(f"References: “{cells[0].text.strip()}” needs a number; ignored.")
                        continue
                    out.references[ref_key] = int(m.group(0))
                else:
                    out.references[ref_key] = value
        elif key == exp.CAP_UNITS:
            for row in body:
                cells = row.cells
                if len(cells) < 2:
                    continue
                name, value = cells[0].text.strip(), cells[1].text.strip()
                setting = _UNIT_SETTINGS.get(_norm(name))
                if setting:
                    out.settings[setting] = _setting_value(value)
                elif name:
                    out.units[_norm(name)] = value

    out.is_s4c = found_any and (out.has_rule_tables or out.stylesheet_id is not None
                                or (props.category or "") == exp.DOC_CATEGORY)
    return out


# --------------------------------------------------------------------------- rule options
def _rules():
    return exp._rules_module()


def option_candidates(sno: int) -> list[dict]:
    ce = _rules()
    rule = ce.by_sno().get(sno) or {}
    forms = rule.get("forms") or []
    options = rule.get("options") or []
    out = []
    for i in range(1, max(len(forms), len(options)) + 1):
        f = forms[i - 1] if i - 1 < len(forms) else {}
        label = f.get("label") or (options[i - 1] if i - 1 < len(options) else f"Option {i}")
        out.append({"option": i, "label": label, "preview": f.get("preview") or "",
                    "text": options[i - 1] if i - 1 < len(options) else ""})
    return out


def _display(sno: int, option: Any) -> str:
    """Short form of an option for the change list (the blue example, else the label)."""
    if option is None:
        return "Off"
    rule = _rules().by_sno().get(sno) or {}
    example, label = exp._house_style(rule, {"option": option})
    return example or label


def resolve_option(sno: int, lines: list[str], changed: list[str] | None = None) -> tuple[int | str | None, list[dict], str]:
    """(option or None, scored candidates, how) for the house-style text of a rule row."""
    if lines and lines[0].lower().startswith("custom:"):
        custom = lines[0].split(":", 1)[1].strip()
        if custom:
            return custom, [], "custom"
    cands = option_candidates(sno)
    probes = [_norm(x) for x in (changed or lines) if _norm(x)]
    if not probes or not cands:
        return None, cands, "empty"

    def fields(c):
        return [f for f in (_norm(c["preview"]), _norm(c["label"]), _norm(c["text"])) if f]

    exact = [c for c in cands if any(p in fields(c) for p in probes)]
    if len(exact) > 1:  # prefer a match on the first (example) line
        first = [c for c in exact if probes[0] in fields(c)]
        if len(first) == 1:
            exact = first
    if len(exact) == 1:
        return exact[0]["option"], cands, "exact"

    joined = _norm(" ".join(changed or lines))
    scored = []
    for c in cands:
        s = max([SequenceMatcher(None, joined, f).ratio() for f in fields(c)] + [0.0])
        scored.append({**c, "score": round(s, 3)})
    scored.sort(key=lambda c: -c["score"])
    if exact:  # several exact matches: offer only those
        ids = {c["option"] for c in exact}
        scored = [c for c in scored if c["option"] in ids] + [c for c in scored if c["option"] not in ids]
        return None, scored, "ambiguous"
    best = scored[0]
    runner = scored[1]["score"] if len(scored) > 1 else 0.0
    if best["score"] >= 0.8 and best["score"] - runner >= 0.08:
        return best["option"], scored, "close"
    return None, scored, "unresolved"


# --------------------------------------------------------------------------- state helpers
def _rule_state(data: dict) -> dict[int, Any]:
    """sno -> option when the rule is on, None when off."""
    ce = _rules()
    resolved = ce.resolve_ce_config([], exp._clean_rules(data.get("ce_rules")))
    return {s: (c["option"] if c["enabled"] else None) for s, c in resolved.items()}


def _profile_lists(profile: dict) -> dict[str, dict]:
    out: dict[str, dict] = {k: {} for k in LIST_KEYS}
    for k in ("word_replacements", "org_names"):
        for item in profile.get(k) or []:
            if isinstance(item, dict) and item.get("find"):
                out[k][_norm(item["find"])] = {kk: v for kk, v in item.items() if v not in (None, "")}
    for k in ("word_list", "acronyms_no_spellout", "registered_terms"):
        for term in profile.get(k) or []:
            if term:
                out[k][_norm(term)] = str(term)
    for a, u in (profile.get("avoid_words") or {}).items():
        out["avoid_words"][_norm(a)] = {"avoid": a, "use": u}
    return out


def _item_text(key: str, item: Any) -> str:
    if key in ("word_replacements", "org_names"):
        return f"{item.get('replace', '')} (not {item.get('find', '')})"
    if key == "avoid_words":
        return f"{item['avoid']} → {item['use']}"
    return str(item)


def _same_item(key: str, a: Any, b: Any) -> bool:
    if key in ("word_replacements", "org_names"):
        fields = ("find", "replace", "note") if key == "word_replacements" else ("find", "replace")
        return all(_norm(a.get(f)) == _norm(b.get(f)) for f in fields)
    if key == "avoid_words":
        return _norm(a["use"]) == _norm(b["use"])
    return True


def _render_baseline(data: dict) -> ParsedSheet:
    return parse_style_sheet_docx(exp.build_style_sheet_docx(data, {}))


# --------------------------------------------------------------------------- diff
def _change(cid: str, section: str, kind: str, target: str, title: str, before: str | None, after: str | None,
            detail: str = "", selected: bool = True, **extra) -> dict:
    return {"id": cid, "section": section, "kind": kind, "target": target, "title": title, "before": before,
            "after": after, "detail": detail, "default_selected": selected, **extra}


def _diff_s4c(doc: ParsedSheet, current: dict, warnings: list[str]) -> list[dict]:
    ce = _rules()
    catalog = ce.by_sno()
    base_data = doc.snapshot if doc.snapshot and isinstance(doc.snapshot.get("ce_rules"), dict) else None
    if base_data is None:
        base_data = current
    base = _render_baseline({**base_data, "id": current.get("id")})
    base_opts, cur_opts = _rule_state(base_data), _rule_state(current)
    changes: list[dict] = []

    # Rules
    for sno in sorted(set(doc.rules) | {s for s, o in base_opts.items() if o is not None}):
        if sno not in catalog:
            warnings.append(f"R{sno} is not a known rule; the row was ignored.")
            continue
        name = catalog[sno]["name"]
        b, c = base_opts.get(sno), cur_opts.get(sno)
        row = doc.rules.get(sno)
        if row is not None:
            base_row = base.rules.get(sno)
            if base_row is not None:
                if _norm(row["topic"]) != _norm(base_row["topic"]):
                    warnings.append(f"R{sno}: the Topic was edited. Topics come from the rule catalog; the edit was ignored.")
                if _norm(row["handling"]) != _norm(base_row["handling"]):
                    warnings.append(f"R{sno}: Handling was changed (\"{base_row['handling']}\" → \"{row['handling']}\"). "
                                    "Handling follows the rule; change its house style instead. The edit was ignored.")
                if [_norm(x) for x in row["lines"]] == [_norm(x) for x in base_row["lines"]]:
                    continue  # house style not edited
                changed = [x for i, x in enumerate(row["lines"])
                           if i >= len(base_row["lines"]) or _norm(x) != _norm(base_row["lines"][i])]
            else:
                changed = None
            opt, cands, how = resolve_option(sno, row["lines"], changed)
            if opt is not None and opt == b:
                continue
            if opt is None:
                changes.append(_change(
                    f"rule:{sno}", "rules", "unresolved", f"R{sno}", name, _display(sno, c), None,
                    f"The .docx says “{' / '.join(row['lines'])}”. Choose the option it means.",
                    selected=True, sno=sno, option=None, docx_text=" / ".join(row["lines"]),
                    candidates=[{"option": x["option"], "label": x["label"], "preview": x["preview"],
                                 "score": x.get("score")} for x in cands],
                    best_option=(cands[0]["option"] if cands and cands[0].get("score", 0) >= 0.5 else None)))
                continue
            if opt == c:
                continue  # already the same in the app
            conflict = c != b
            kind = "conflict" if conflict else ("changed" if b is not None else "enabled")
            detail = {"exact": "Matched exactly.", "close": "Closest match to the edited text.",
                      "custom": "Custom house style."}.get(how, "")
            if b is None:
                detail = "Row added in the .docx; the rule is off in the stylesheet. " + detail
            if conflict:
                detail = (f"Changed in both places since the export: the app now has “{_display(sno, c)}”. "
                          "Tick to use the .docx value; leave unticked to keep the app value.")
            changes.append(_change(f"rule:{sno}", "rules", kind, f"R{sno}", name, _display(sno, c if c is not None else b),
                                   _display(sno, opt), detail.strip(), selected=not conflict, sno=sno, option=opt,
                                   current=_display(sno, c)))
        elif b is not None and doc.has_rule_tables:
            if c is None:
                continue  # already off in the app
            changes.append(_change(f"rule:{sno}", "rules", "disabled", f"R{sno}", name, _display(sno, c), "Off",
                                   "Row deleted from the .docx. Confirm the rule should stop running.",
                                   selected=False, sno=sno, option=None))
    if not doc.has_rule_tables and base.has_rule_tables:
        warnings.append("No house style rule tables were found in the .docx, so no rule was switched off.")

    # Lists
    cur_lists = _profile_lists(current.get("style_profile") or {})
    for key in LIST_KEYS:
        d, bl, cl = doc.lists.get(key, {}), base.lists.get(key, {}), cur_lists[key]
        title, section = LIST_TITLES[key], SECTION_OF[key]
        if TABLE_OF[key] not in doc.found:
            if bl:  # the table was not recognised (e.g. pasted into a new document): never treat as deleted
                warnings.append(f"{title}: the list was not found in the .docx, so it was left unchanged.")
            continue
        for k in sorted(set(d) - set(bl)):
            if k in cl and _same_item(key, cl[k], d[k]):
                continue
            kind = "edited" if k in cl else "added"
            changes.append(_change(f"{key}:add:{k}", section, kind, key, title,
                                   _item_text(key, cl[k]) if k in cl else None, _item_text(key, d[k]),
                                   "Already in the app with a different value." if k in cl else "",
                                   list=key, key=k, item=d[k]))
        for k in sorted(set(bl) - set(d)):
            if k not in cl:
                continue
            changes.append(_change(f"{key}:remove:{k}", section, "removed", key, title, _item_text(key, cl[k]), None,
                                   "Deleted from the .docx.", selected=False, list=key, key=k, item=cl[k]))
        for k in sorted(set(bl) & set(d)):
            if _same_item(key, bl[k], d[k]) or (k in cl and _same_item(key, cl[k], d[k])):
                continue
            conflict = k in cl and not _same_item(key, cl[k], bl[k])
            changes.append(_change(f"{key}:edit:{k}", section, "conflict" if conflict else "edited", key, title,
                                   _item_text(key, cl[k]) if k in cl else None, _item_text(key, d[k]),
                                   "Changed in both places since the export." if conflict else "",
                                   selected=not conflict, list=key, key=k, item=d[k]))

    # Settings (book type, list style)
    profile, base_profile = current.get("style_profile") or {}, base_data.get("style_profile") or {}
    for key in SETTING_KEYS:
        if key not in doc.settings:
            continue
        new, old, cur = doc.settings[key], base.settings.get(key), _setting_value(str(profile.get(key) or ""))
        if new == old or new == cur:
            continue
        title = key.replace("_", " ").capitalize()
        conflict = cur != _setting_value(str(base_profile.get(key) or ""))
        changes.append(_change(f"setting:{key}", "settings", "conflict" if conflict else "changed", key, title,
                               (cur or "—").replace("_", " ").title(), (new or "—").replace("_", " ").title(),
                               "Changed in both places since the export." if conflict else "",
                               selected=not conflict, setting=key, value=new))
    # Reference style (citation style, author list, order)
    if exp.CAP_REFS in doc.found:
        cur_ref = profile.get("reference_style") or {}
        base_ref = base_profile.get("reference_style") or {}
        for label, key in exp.REFERENCE_ROWS:
            new, old, cur = doc.references.get(key), base.references.get(key), cur_ref.get(key)
            if new is None and old is None:
                continue
            if _norm(new) == _norm(old) or _norm(new) == _norm(cur):
                continue
            conflict = _norm(cur) != _norm(base_ref.get(key))
            changes.append(_change(f"reference:{key}", "settings", "conflict" if conflict else
                                   ("removed" if new is None else "changed"), f"reference_style.{key}", label,
                                   None if cur is None else str(cur), None if new is None else str(new),
                                   "Changed in both places since the export." if conflict else "",
                                   selected=not conflict and new is not None, reference=key, value=new))
    for name, value in doc.units.items():
        if _norm(value) != _norm(base.units.get(name, value)):
            warnings.append(f"Units and conventions: “{name}” was edited. This row is information only; the edit was ignored.")
    return changes


def _diff_foreign(content: bytes, current: dict, warnings: list[str]) -> list[dict]:
    """A customer's own style sheet: propose its rule options and list entries."""
    from app.processing.manuscript_core.parsers.docx_stylesheet_parser import DocxStylesheetParser

    parsed = DocxStylesheetParser().parse(content) or {}
    ce = _rules()
    catalog = ce.by_sno()
    cur_opts = _rule_state(current)
    changes: list[dict] = []
    for k, v in sorted((parsed.get("matched_ce_rules") or {}).items(), key=lambda kv: int(kv[0])):
        sno = int(k)
        if sno not in catalog or not isinstance(v, dict):
            continue
        opt = v.get("option", 1) if v.get("enabled", True) else None
        c = cur_opts.get(sno)
        if opt == c:
            continue
        kind = "disabled" if opt is None else ("enabled" if c is None else "changed")
        changes.append(_change(f"rule:{sno}", "rules", kind, f"R{sno}", catalog[sno]["name"], _display(sno, c),
                               _display(sno, opt), "From the customer style sheet.", selected=opt is not None,
                               sno=sno, option=opt))
    doc_lists = _profile_lists(parsed.get("style_profile") or {})
    cur_lists = _profile_lists(current.get("style_profile") or {})
    for key in LIST_KEYS:
        for k in sorted(set(doc_lists[key]) - set(cur_lists[key])):
            changes.append(_change(f"{key}:add:{k}", SECTION_OF[key], "added", key, LIST_TITLES[key], None,
                                   _item_text(key, doc_lists[key][k]), "From the customer style sheet.",
                                   list=key, key=k, item=doc_lists[key][k]))
    for u in parsed.get("unresolved_specs") or []:
        warnings.append(f"Not matched to a rule: {u if isinstance(u, str) else u.get('text', u)}")
    return changes


def preview_docx_changes(content: bytes, current: dict) -> dict:
    """{format, stylesheet_id, base_hash, stale, changes, warnings} for an edited .docx."""
    doc = parse_style_sheet_docx(content)
    warnings = list(doc.warnings)
    cur_hash = current.get("content_hash")
    if not doc.is_s4c:
        changes = _diff_foreign(content, current, warnings)
        return {"format": "customer", "stylesheet_id": None, "base_hash": None, "stale": False,
                "snapshot": False, "changes": changes, "warnings": warnings}
    if doc.stylesheet_id is not None and current.get("id") is not None and doc.stylesheet_id != current.get("id"):
        warnings.insert(0, f"This .docx was exported from stylesheet #{doc.stylesheet_id}, not from "
                           f"#{current.get('id')} ({current.get('name')}). Check the changes carefully.")
    stale = bool(doc.base_hash and cur_hash and doc.base_hash != cur_hash)
    if not doc.snapshot:
        warnings.insert(0, "The .docx does not carry the version it was exported from, so it was compared with "
                           "the current stylesheet." + (" It was exported from an older version." if stale else ""))
    changes = _diff_s4c(doc, current, warnings)
    return {"format": "s4c", "stylesheet_id": doc.stylesheet_id, "base_hash": doc.base_hash, "stale": stale,
            "snapshot": bool(doc.snapshot), "changes": changes, "warnings": warnings}


# --------------------------------------------------------------------------- apply
def apply_docx_changes(current: dict, changes: list[dict], accepted: list[str],
                       resolutions: dict[str, Any] | None = None) -> tuple[dict, dict, list[dict]]:
    """(ce_rules, style_profile, applied changes) after applying the accepted changes to ``current``."""
    resolutions = {str(k): v for k, v in (resolutions or {}).items()}
    accepted_ids = set(accepted)
    ce_rules = {str(k): dict(v) for k, v in (current.get("ce_rules") or {}).items() if isinstance(v, dict)}
    profile = json.loads(json.dumps(current.get("style_profile") or {}))
    applied: list[dict] = []

    for ch in changes:
        if ch["id"] not in accepted_ids:
            continue
        if ch["section"] == "rules":
            sno = str(ch["sno"])
            entry = ce_rules.get(sno, {})
            if ch["kind"] == "disabled":
                entry = {**entry, "enabled": False}
            else:
                opt = ch.get("option")
                if ch["kind"] == "unresolved":
                    opt = resolutions.get(sno)
                    if opt in (None, ""):
                        raise DocxImportError(f"Choose an option for R{sno} before applying.")
                    if isinstance(opt, str) and opt.isdigit():
                        opt = int(opt)
                    valid = {c["option"] for c in ch.get("candidates") or []}
                    if isinstance(opt, int) and valid and opt not in valid:
                        raise DocxImportError(f"Option {opt} is not an option of R{sno}.")
                entry = {**entry, "enabled": True, "option": opt}
            ce_rules[sno] = entry
        elif ch["section"] == "settings" and ch.get("reference"):
            ref = dict(profile.get("reference_style") or {})
            if ch["value"] is None:
                ref.pop(ch["reference"], None)
            else:
                ref[ch["reference"]] = ch["value"]
            profile["reference_style"] = ref
        elif ch["section"] == "settings":
            profile[ch["setting"]] = ch["value"]
        else:
            key, k, item = ch["list"], ch["key"], ch["item"]
            removing = ch["kind"] == "removed"
            if key in ("word_replacements", "org_names"):
                items = [x for x in profile.get(key) or [] if not (isinstance(x, dict) and _norm(x.get("find")) == k)]
                if not removing:
                    items.append(item)
                profile[key] = items
            elif key == "avoid_words":
                avoid = {a: u for a, u in (profile.get(key) or {}).items() if _norm(a) != k}
                if not removing:
                    avoid[item["avoid"]] = item["use"]
                profile[key] = avoid
            else:
                terms = [t for t in profile.get(key) or [] if _norm(t) != k]
                if not removing:
                    terms.append(item)
                profile[key] = terms
        applied.append(ch)
    return ce_rules, profile, applied
