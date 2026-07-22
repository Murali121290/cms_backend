"""
epub_validate.py
----------------
A native (dependency-free) EPUB validator. It is not a full EPUBCheck
replacement, but covers the checks that actually break BoD flowable-book
deliveries and readers in practice:

  OCF   - mimetype, container.xml, rootfile resolution
  PKG   - OPF well-formedness, required metadata, unique-identifier wiring
  MAN   - manifest/file consistency (missing files, orphan files, dup ids, nav)
  SPN   - spine integrity (idrefs resolve, non-empty, content docs)
  XHT   - each content document is well-formed XML
  LNK   - internal hrefs / img src / fragments / CSS references resolve
  A11Y  - img alt text, document language, <title>, accessibility metadata
  ENC   - text resources are UTF-8

Each check yields an Issue(level, code, category, location, message). Levels are
"error" | "warning" | "info". Everything is read-only.
"""

from __future__ import annotations

import io
import posixpath
import re
import zipfile
from dataclasses import asdict, dataclass
from xml.etree import ElementTree as ET

from .epub_utils import decode_bytes

OPF_NS = "http://www.idpf.org/2007/opf"
DC_NS = "http://purl.org/dc/elements/1.1/"
CONTAINER_NS = "urn:oasis:names:tc:opendocument:xmlns:container"

TEXTUAL_EXT = (".xhtml", ".html", ".htm", ".css", ".opf", ".ncx", ".svg", ".xml")


@dataclass
class Issue:
    level: str
    code: str
    category: str
    location: str
    message: str


def validate_epub(data: bytes) -> list:
    issues: list = []
    add = lambda l, c, cat, loc, m: issues.append(Issue(l, c, cat, loc, m))

    try:
        zf = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        add("error", "OCF-000", "OCF", "(archive)", "File is not a valid ZIP/EPUB archive.")
        return [asdict(i) for i in issues]

    infos = zf.infolist()
    names = [i.filename for i in infos if not i.filename.endswith("/")]
    nameset = set(names)

    # ---- OCF: mimetype -----------------------------------------------------
    if "mimetype" not in nameset:
        add("error", "OCF-001", "OCF", "mimetype", "Missing required 'mimetype' file.")
    else:
        first = next((i for i in infos if not i.filename.endswith("/")), None)
        if first is None or first.filename != "mimetype":
            add("error", "OCF-003a", "OCF", "mimetype",
                "'mimetype' must be the first entry in the archive.")
        mi = next(i for i in infos if i.filename == "mimetype")
        if mi.compress_type != zipfile.ZIP_STORED:
            add("error", "OCF-003b", "OCF", "mimetype",
                "'mimetype' must be stored uncompressed (no deflate).")
        content = zf.read("mimetype").decode("ascii", "replace").strip()
        if content != "application/epub+zip":
            add("error", "OCF-002", "OCF", "mimetype",
                f"'mimetype' content must be 'application/epub+zip' (found {content!r}).")

    # ---- OCF: container.xml -> rootfile (OPF) ------------------------------
    opf_path = None
    if "META-INF/container.xml" not in nameset:
        add("error", "OCF-004", "OCF", "META-INF/container.xml", "Missing META-INF/container.xml.")
    else:
        try:
            root = ET.fromstring(zf.read("META-INF/container.xml"))
            rf = root.find(f".//{{{CONTAINER_NS}}}rootfile")
            if rf is None or not rf.get("full-path"):
                add("error", "OCF-005", "OCF", "META-INF/container.xml",
                    "container.xml has no <rootfile full-path>.")
            else:
                opf_path = rf.get("full-path")
                if opf_path not in nameset:
                    add("error", "OCF-006", "OCF", opf_path,
                        "container.xml points to an OPF that does not exist in the archive.")
                    opf_path = None
        except ET.ParseError as e:
            add("error", "OCF-005x", "OCF", "META-INF/container.xml", f"container.xml is not well-formed XML: {e}")

    if opf_path is None:
        return [asdict(i) for i in issues]  # can't go further without the OPF

    opf_dir = posixpath.dirname(opf_path)

    # ---- PKG: parse OPF ----------------------------------------------------
    try:
        opf = ET.fromstring(zf.read(opf_path))
    except ET.ParseError as e:
        add("error", "PKG-001", "PKG", opf_path, f"OPF is not well-formed XML: {e}")
        return [asdict(i) for i in issues]

    version = opf.get("version", "")
    if version not in ("2.0", "3.0"):
        add("warning", "PKG-005", "PKG", opf_path, f"Unexpected package version {version!r}.")
    is_epub3 = version.startswith("3")

    meta = opf.find(f"{{{OPF_NS}}}metadata")
    def dc(tag):
        return meta.findall(f"{{{DC_NS}}}{tag}") if meta is not None else []

    if not dc("title"):
        add("error", "PKG-003", "PKG", opf_path, "Missing <dc:title>.")
    if not dc("language"):
        add("error", "PKG-004", "PKG", opf_path, "Missing <dc:language>.")

    uid = opf.get("unique-identifier")
    ids = {e.get("id") for e in dc("identifier")}
    if not uid:
        add("error", "PKG-002a", "PKG", opf_path, "package@unique-identifier attribute missing.")
    elif uid not in ids:
        add("error", "PKG-002b", "PKG", opf_path,
            f"unique-identifier {uid!r} does not match any <dc:identifier id>.")

    if is_epub3:
        mod = meta.findall(f"{{{OPF_NS}}}meta") if meta is not None else []
        if not any(m.get("property") == "dcterms:modified" for m in mod):
            add("warning", "PKG-006", "PKG", opf_path,
                "EPUB 3 should declare <meta property='dcterms:modified'>.")

    # ---- MAN: manifest -----------------------------------------------------
    manifest = opf.find(f"{{{OPF_NS}}}manifest")
    items = manifest.findall(f"{{{OPF_NS}}}item") if manifest is not None else []
    id_to_href, id_to_item, seen_ids = {}, {}, set()
    manifest_paths = set()
    nav_present = False

    for it in items:
        iid, href = it.get("id"), it.get("href")
        if iid in seen_ids:
            add("error", "MAN-003", "MAN", opf_path, f"Duplicate manifest id {iid!r}.")
        seen_ids.add(iid)
        if not href:
            continue
        full = posixpath.normpath(posixpath.join(opf_dir, href))
        id_to_href[iid] = full
        id_to_item[iid] = it
        manifest_paths.add(full)
        if full not in nameset:
            add("error", "MAN-001", "MAN", full,
                f"Manifest item {iid!r} references a file that is missing from the archive.")
        props = (it.get("properties") or "").split()
        if "nav" in props:
            nav_present = True

    if is_epub3 and not nav_present:
        add("error", "MAN-004", "MAN", opf_path, "EPUB 3 requires a nav document (item with properties='nav').")

    # orphan files not declared in manifest
    exempt = {"mimetype", opf_path}
    for n in names:
        if n in exempt or n.startswith("META-INF/"):
            continue
        if n not in manifest_paths:
            add("warning", "MAN-002", "MAN", n, "File is in the archive but not declared in the manifest.")

    # ---- SPN: spine --------------------------------------------------------
    spine = opf.find(f"{{{OPF_NS}}}spine")
    itemrefs = spine.findall(f"{{{OPF_NS}}}itemref") if spine is not None else []
    if not itemrefs:
        add("error", "SPN-001", "SPN", opf_path, "Spine is empty.")
    for ref in itemrefs:
        idref = ref.get("idref")
        if idref not in id_to_href:
            add("error", "SPN-002", "SPN", opf_path, f"Spine itemref idref {idref!r} does not resolve to a manifest item.")

    ncx_id = spine.get("toc") if spine is not None else None
    if ncx_id and ncx_id not in id_to_href:
        add("warning", "SPN-004", "SPN", opf_path, f"spine@toc {ncx_id!r} does not resolve to a manifest item.")

    # ---- collect content docs for XHT/LNK/A11Y -----------------------------
    content_docs = [
        (iid, path) for iid, path in id_to_href.items()
        if path.lower().endswith((".xhtml", ".html", ".htm")) and path in nameset
    ]

    # build id/anchor map per document for fragment resolution
    doc_anchors: dict = {}
    a11y_meta = _accessibility_metadata(meta)

    for iid, path in content_docs:
        raw = zf.read(path)
        text, enc, is_utf8 = decode_bytes(raw)
        if not is_utf8:
            add("warning", "ENC-001", "ENC", path, f"Not UTF-8 (decoded as {enc}); re-save as UTF-8.")

        # well-formedness
        try:
            tree = ET.fromstring(raw)
            well_formed = True
        except ET.ParseError as e:
            add("error", "XHT-001", "XHT", path, f"Content document is not well-formed XML: {e}")
            well_formed = False
            tree = None

        # anchors
        anchors = set(re.findall(r'\bid\s*=\s*"([^"]+)"', text))
        anchors |= set(re.findall(r'\bname\s*=\s*"([^"]+)"', text))
        doc_anchors[path] = anchors

        # A11Y: language
        if well_formed:
            lang = tree.get("lang") or tree.get("{http://www.w3.org/XML/1998/namespace}lang")
            if not lang:
                add("warning", "A11Y-002", "A11Y", path, "<html> has no lang / xml:lang attribute.")
            # title
            title = tree.find(".//{http://www.w3.org/1999/xhtml}title")
            if title is None or not (title.text or "").strip():
                add("warning", "A11Y-003", "A11Y", path, "Document has no non-empty <title>.")

        # A11Y: img alt
        for m in re.finditer(r"<img\b[^>]*>", text, re.I):
            tag = m.group(0)
            if not re.search(r'\balt\s*=', tag, re.I):
                src = re.search(r'src\s*=\s*"([^"]*)"', tag, re.I)
                add("error", "A11Y-001", "A11Y", path,
                    f"<img> without alt attribute (src={src.group(1) if src else '?'}).")

    # ---- LNK: resolve internal links & resources ---------------------------
    all_hrefs = re.compile(r'(?:href|src)\s*=\s*"([^"]+)"', re.I)
    for iid, path in content_docs:
        text, _, _ = decode_bytes(zf.read(path))
        base = posixpath.dirname(path)
        for ref in all_hrefs.findall(text):
            if ref.startswith(("http://", "https://", "mailto:", "tel:", "data:", "#")):
                if ref.startswith("#"):
                    frag = ref[1:]
                    if frag and frag not in doc_anchors.get(path, set()):
                        add("warning", "LNK-002", "LNK", path, f"In-page fragment '#{frag}' has no matching id.")
                continue
            target, _, frag = ref.partition("#")
            resolved = posixpath.normpath(posixpath.join(base, target)) if target else path
            if resolved not in nameset:
                add("error", "LNK-001", "LNK", path, f"Link/resource target does not exist: {ref}")
            elif frag and resolved in doc_anchors and frag not in doc_anchors[resolved]:
                add("warning", "LNK-002", "LNK", path, f"Fragment '#{frag}' not found in {resolved}.")

    # ---- A11Y: package-level accessibility metadata ------------------------
    if is_epub3:
        if not a11y_meta["features"]:
            add("warning", "A11Y-010", "A11Y", opf_path, "No schema:accessibilityFeature metadata declared.")
        if not a11y_meta["accessmode_sufficient"]:
            add("info", "A11Y-011", "A11Y", opf_path, "No schema:accessModeSufficient declared.")
        if not a11y_meta["conforms_to"]:
            add("info", "A11Y-012", "A11Y", opf_path, "No dcterms:conformsTo (EPUB Accessibility) declared.")

    return [asdict(i) for i in issues]


def _accessibility_metadata(meta) -> dict:
    out = {"features": [], "accessmode_sufficient": False, "conforms_to": False}
    if meta is None:
        return out
    for m in meta.findall(f"{{{OPF_NS}}}meta"):
        prop = m.get("property")
        if prop == "schema:accessibilityFeature":
            out["features"].append((m.text or "").strip())
        elif prop == "schema:accessModeSufficient":
            out["accessmode_sufficient"] = True
        elif prop == "dcterms:conformsTo":
            out["conforms_to"] = True
    return out


def summarize_validation(issues: list) -> dict:
    errors = sum(1 for i in issues if i["level"] == "error")
    warnings = sum(1 for i in issues if i["level"] == "warning")
    infos = sum(1 for i in issues if i["level"] == "info")
    by_cat: dict = {}
    for i in issues:
        by_cat[i["category"]] = by_cat.get(i["category"], 0) + 1
    return {
        "errors": errors,
        "warnings": warnings,
        "infos": infos,
        "by_category": by_cat,
        "status": "FAIL" if errors else ("REVIEW" if warnings else "PASS"),
    }
