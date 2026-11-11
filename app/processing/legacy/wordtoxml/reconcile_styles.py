#!/usr/bin/env python3
import argparse
import sys
import zipfile
from lxml import etree

W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
NSMAP = {"w": W_NS}


def is_toggle_on(elem):
    """Evaluates OpenXML toggle properties like <w:b/> or <w:b w:val="0"/>

    If tag is present and val is absent -> True
    If val is '1', 'true', 'on'        -> True
    If val is '0', 'false', 'off'       -> False
    """
    if elem is None:
        return None
    val = elem.attrib.get(f"{{{W_NS}}}val")
    if val is None:
        return True
    return val.lower() not in ["0", "false", "off"]


def parse_style_definitions(styles_tree):
    """Extracts base typographic attributes for all character styles."""
    style_specs = {}
    for style in styles_tree.xpath(
        "//w:style[@w:type='character']", namespaces=NSMAP
    ):
        style_id = style.attrib.get(f"{{{W_NS}}}styleId", "")
        rPr = style.find(f"{{{W_NS}}}rPr")

        spec = {
            "bold": False,
            "italic": False,
            "underline": None,
            "vertAlign": None,
        }

        if rPr is not None:
            spec["bold"] = is_toggle_on(rPr.find(f"{{{W_NS}}}b")) is True
            spec["italic"] = is_toggle_on(rPr.find(f"{{{W_NS}}}i")) is True

            u = rPr.find(f"{{{W_NS}}}u")
            if (
                u is not None
                and u.attrib.get(f"{{{W_NS}}}val", "none").lower() != "none"
            ):
                spec["underline"] = u.attrib.get(f"{{{W_NS}}}val", "single")

            va = rPr.find(f"{{{W_NS}}}vertAlign")
            if va is not None:
                spec["vertAlign"] = va.attrib.get(f"{{{W_NS}}}val", None)

        style_specs[style_id] = spec
    return style_specs


def resolve_run_properties(rPr, style_spec):
    """Calculates the net formatting by evaluating direct overrides over style specs."""
    # 1. Resolve Bold
    run_b = is_toggle_on(rPr.find(f"{{{W_NS}}}b"))
    effective_bold = run_b if run_b is not None else style_spec["bold"]

    # 2. Resolve Italic
    run_i = is_toggle_on(rPr.find(f"{{{W_NS}}}i"))
    effective_italic = run_i if run_i is not None else style_spec["italic"]

    # 3. Resolve Underline
    run_u = rPr.find(f"{{{W_NS}}}u")
    if run_u is not None:
        u_val = run_u.attrib.get(f"{{{W_NS}}}val", "none").lower()
        effective_u = None if u_val == "none" else u_val
    else:
        effective_u = style_spec["underline"]

    # 4. Resolve Vertical Alignment (superscript / subscript)
    run_va = rPr.find(f"{{{W_NS}}}vertAlign")
    if run_va is not None:
        effective_va = run_va.attrib.get(f"{{{W_NS}}}val", None)
    else:
        effective_va = style_spec["vertAlign"]

    return {
        "bold": effective_bold,
        "italic": effective_italic,
        "underline": effective_u,
        "vertAlign": effective_va,
    }


def update_run_xml(rPr, rStyle, effective):
    """Sets explicit formatting on the run and removes the character style."""
    # Strip the style
    rPr.remove(rStyle)

    # 1. Bold: enforce true or wipe negation
    b_tag = rPr.find(f"{{{W_NS}}}b")
    if effective["bold"]:
        if b_tag is None:
            rPr.append(etree.Element(f"{{{W_NS}}}b"))
        else:
            b_tag.attrib.pop(f"{{{W_NS}}}val", None)
    elif b_tag is not None:
        rPr.remove(b_tag)

    # 2. Italic: enforce true or wipe negation
    i_tag = rPr.find(f"{{{W_NS}}}i")
    if effective["italic"]:
        if i_tag is None:
            rPr.append(etree.Element(f"{{{W_NS}}}i"))
        else:
            i_tag.attrib.pop(f"{{{W_NS}}}val", None)
    elif i_tag is not None:
        rPr.remove(i_tag)

    # 3. Underline
    u_tag = rPr.find(f"{{{W_NS}}}u")
    if effective["underline"]:
        if u_tag is None:
            u_elem = etree.Element(f"{{{W_NS}}}u")
            u_elem.attrib[f"{{{W_NS}}}val"] = effective["underline"]
            rPr.append(u_elem)
        else:
            u_tag.attrib[f"{{{W_NS}}}val"] = effective["underline"]
    elif u_tag is not None:
        rPr.remove(u_tag)

    # 4. Vertical Alignment (Superscript / Subscript)
    va_tag = rPr.find(f"{{{W_NS}}}vertAlign")
    if effective["vertAlign"]:
        if va_tag is None:
            va_elem = etree.Element(f"{{{W_NS}}}vertAlign")
            va_elem.attrib[f"{{{W_NS}}}val"] = effective["vertAlign"]
            rPr.append(va_elem)
        else:
            va_tag.attrib[f"{{{W_NS}}}val"] = effective["vertAlign"]
    elif va_tag is not None:
        rPr.remove(va_tag)


def reconcile_xml_part(xml_bytes, style_specs, target_styles, mode="all"):
    """mode='mismatch_only': strips style only if author overrode formatting.

    mode='all': strips target styles completely, preserving net visual appearance.
    """
    tree = etree.fromstring(xml_bytes)
    runs = tree.xpath(".//w:r[w:rPr/w:rStyle]", namespaces=NSMAP)
    modified_count = 0

    for r in runs:
        rPr = r.find(f"{{{W_NS}}}rPr")
        rStyle = rPr.find(f"{{{W_NS}}}rStyle")
        style_id = rStyle.attrib.get(f"{{{W_NS}}}val")

        if style_id not in style_specs:
            continue

        # If a filter list is passed, skip styles not in target list
        if target_styles and style_id not in target_styles:
            continue

        spec = style_specs[style_id]
        effective = resolve_run_properties(rPr, spec)

        is_mismatched = (
            (spec["bold"] != effective["bold"])
            or (spec["italic"] != effective["italic"])
            or (spec["underline"] != effective["underline"])
            or (spec["vertAlign"] != effective["vertAlign"])
        )

        if mode == "mismatch_only" and not is_mismatched:
            continue

        # Synchronize run tags and drop w:rStyle
        update_run_xml(rPr, rStyle, effective)
        modified_count += 1

    return (
        etree.tostring(tree, xml_declaration=True, encoding="utf-8"),
        modified_count,
    )


def reconcile_docx(input_file, output_file, target_styles=None, mode="all"):
    with zipfile.ZipFile(input_file, "r") as zin:
        styles_tree = etree.fromstring(zin.read("word/styles.xml"))
        style_specs = parse_style_definitions(styles_tree)

        with zipfile.ZipFile(
            output_file, "w", zipfile.ZIP_DEFLATED
        ) as zout:
            for item in zin.infolist():
                content = zin.read(item.filename)

                if (
                    item.filename == "word/document.xml"
                    or item.filename.startswith("word/header")
                    or item.filename.startswith("word/footer")
                    or item.filename.startswith("word/footnotes")
                    or item.filename.startswith("word/endnotes")
                ):
                    content, count = reconcile_xml_part(
                        content, style_specs, target_styles, mode
                    )
                    if count > 0:
                        print(f"Reconciled {count} runs in {item.filename}")

                zout.writestr(item, content)

    print(f"Cleaned file generated: {output_file}")


def main():
    parser = argparse.ArgumentParser(
        description="Reconcile Word character styles against effective visual properties."
    )
    parser.add_argument("-i", "--input", required=True, help="Input .docx path")
    parser.add_argument(
        "-o", "--output", required=True, help="Output .docx path"
    )
    parser.add_argument(
        "-s",
        "--styles",
        nargs="*",
        default=[],
        help="Optional: Specific style IDs to target. If omitted, evaluates all character styles.",
    )
    parser.add_argument(
        "-m",
        "--mode",
        choices=["all", "mismatch_only"],
        default="all",
        help="'all': Strips targeted styles and locks in exact visual formatting.\n"
        "'mismatch_only': Strips the style ONLY when author overrode formatting (e.g. bold style with bold removed).",
    )

    args = parser.parse_args()
    reconcile_docx(args.input, args.output, set(args.styles), args.mode)


if __name__ == "__main__":
    main()