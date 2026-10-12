"""Manuscript (MS) Analysis & Editorial Log (ELOG) module for Journal Production.

Implements Stage 1 of the 8-stage journal workflow:
- 7-step manuscript checklist:
  1. Overview & Frontmatter (words, paragraphs, pages, title, DOI)
  2. Structure & Hierarchy (headings, IMRAD sections)
  3. Mandatory Declarations (Funding, Ethics, Conflicts, Data availability, Consent)
  4. Asset Cross-Verification (figures/tables cited vs. art files/tables present)
  5. Citation & Reference Integrity (in-text citations vs. bibliography)
  6. Advisory Language Editing Level (3-level scale: Light, Medium, Heavy based on density / 1k words)
  7. Consolidated Author Queries (AQ) & Editorial Log (ELOG) report generation
"""
import os
import re
import json
import logging
from datetime import datetime
from typing import Dict, Any, List, Optional, Tuple

import docx
from sqlalchemy.orm import Session

from app.domains.journals.models import Journal, JournalArticle, JournalFile, JournalStageDetail, JournalClient
from app.domains.journals.service import MS_ANALYSIS, PRE_EDITING, advance_article_stage
from app.domains.journals.files import article_dir, save_version

logger = logging.getLogger(__name__)

# Advisory Language Editing thresholds per 1,000 words
LE_LIGHT_MAX = 10.0      # < 10 errors / 1,000 words: Level 1 – Light
LE_MEDIUM_MAX = 25.0     # 10 - 25 errors / 1,000 words: Level 2 – Medium
# > 25 errors / 1,000 words: Level 3 – Heavy


def _translate_path(path: Optional[str]) -> Optional[str]:
    if not path:
        return None
    if os.path.exists(path):
        return path
    # Container -> Host: /opt/cms_runtime/data -> D:/cms_backend/data/cms_runtime_data
    if path.startswith("/opt/cms_runtime/data"):
        win_path = path.replace("/opt/cms_runtime/data", "d:/cms_backend/data/cms_runtime_data").replace("/", os.sep)
        if os.path.exists(win_path):
            return win_path
    # Host -> Container: D:/cms_backend/data/cms_runtime_data -> /opt/cms_runtime/data
    if "cms_runtime_data" in path.replace("\\", "/"):
        sub = path.replace("\\", "/").split("cms_runtime_data")[-1]
        c_path = f"/opt/cms_runtime/data{sub}"
        if os.path.exists(c_path):
            return c_path
    return None


def resolve_manuscript_docx(db: Session, article: JournalArticle) -> Optional[str]:
    """Finds the actual manuscript DOCX file path on disk."""
    p = _translate_path(article.original_docx_path)
    if p:
        return p
    
    # Check journal_files
    manuscript_file = db.query(JournalFile).filter(
        JournalFile.article_id == article.id,
        JournalFile.category.in_(["Manuscript", "DOCX", "original"])
    ).order_by(JournalFile.version.desc()).first()

    if manuscript_file:
        p = _translate_path(manuscript_file.path)
        if p:
            return p

    return None


def calculate_le_density(text: str, total_words: int) -> Tuple[int, float, str, List[Dict[str, Any]]]:
    """
    Computes linguistic errors/issues count and density per 1,000 words.
    Returns: (error_count, density, recommended_level, sample_issues)
    """
    if not text or total_words == 0:
        return 0, 0.0, "Level 1 – Light", []

    issues: List[Dict[str, Any]] = []

    # 1. Punctuation spacing errors (space before comma/period or missing space after)
    space_before_punct = re.finditer(r'\s+([,;:.!?])', text)
    for m in space_before_punct:
        issues.append({
            "type": "punctuation_spacing",
            "message": f"Unwanted space before punctuation '{m.group(1)}'",
            "snippet": text[max(0, m.start() - 15):min(len(text), m.end() + 15)]
        })

    missing_space_after = re.finditer(r'([,;:])(?=[A-Za-z])', text)
    for m in missing_space_after:
        issues.append({
            "type": "missing_space",
            "message": f"Missing space after punctuation '{m.group(1)}'",
            "snippet": text[max(0, m.start() - 15):min(len(text), m.end() + 15)]
        })

    # 2. Multiple consecutive spaces
    multi_spaces = re.finditer(r'[ \t]{2,}', text)
    for m in multi_spaces:
        issues.append({
            "type": "multiple_spaces",
            "message": "Multiple consecutive spaces found",
            "snippet": text[max(0, m.start() - 15):min(len(text), m.end() + 15)]
        })

    # 3. Long rambling sentences (> 40 words)
    sentences = re.split(r'[.!?]+\s+', text)
    for s in sentences:
        words = s.strip().split()
        if len(words) > 40:
            issues.append({
                "type": "long_sentence",
                "message": f"Long sentence ({len(words)} words) may require syntactic restructuring",
                "snippet": " ".join(words[:15]) + "..."
            })

    # 4. Repeated adjacent words (e.g., "the the", "in in")
    repeated_words = re.finditer(r'\b([a-zA-Z]{2,})\s+\1\b', text, re.IGNORECASE)
    for m in repeated_words:
        issues.append({
            "type": "repeated_word",
            "message": f"Repeated word '{m.group(1)}'",
            "snippet": text[max(0, m.start() - 15):min(len(text), m.end() + 15)]
        })

    # 5. Common confusing pairs / passive voice markers
    confused_patterns = [
        (r'\bwhich\b(?=[^,]*\bthat\b)', "Possible restrictive clause misuse ('which' vs 'that')"),
        (r'\bthere\s+is\s+a\s+need\s+to\b', "Wordy passive phrasing ('there is a need to')"),
        (r'\bin\s+order\s+to\b', "Wordy phrasing ('in order to' -> 'to')"),
        (r'\bdue\s+to\s+the\s+fact\s+that\b', "Wordy phrase ('due to the fact that' -> 'because')"),
    ]
    for pattern, msg in confused_patterns:
        for m in re.finditer(pattern, text, re.IGNORECASE):
            issues.append({
                "type": "style_refinement",
                "message": msg,
                "snippet": text[max(0, m.start() - 15):min(len(text), m.end() + 15)]
            })

    total_issues = len(issues)
    density = round((total_issues / max(1, total_words)) * 1000.0, 1)

    if density < LE_LIGHT_MAX:
        recommended = "Level 1 – Light"
    elif density <= LE_MEDIUM_MAX:
        recommended = "Level 2 – Medium"
    else:
        recommended = "Level 3 – Heavy"

    return total_issues, density, recommended, issues[:30]


def analyze_manuscript(db: Session, article: JournalArticle) -> Dict[str, Any]:
    """Runs the full 7-step MS Analysis & ELOG engine on an article."""
    docx_path = resolve_manuscript_docx(db, article)
    journal = db.query(Journal).filter(Journal.id == article.journal_id).first()
    client = db.query(JournalClient).filter(JournalClient.id == journal.client_id).first() if journal else None

    # Default baseline stats if no docx is available
    paragraphs_text: List[str] = []
    paragraph_meta: List[Dict[str, Any]] = []
    headings: List[Dict[str, Any]] = []
    table_count = 0

    if docx_path and os.path.exists(docx_path):
        try:
            doc = docx.Document(docx_path)
            table_count = len(doc.tables)
            for idx, p in enumerate(doc.paragraphs):
                txt = p.text.strip()
                style_name = (p.style.name if p.style else "").lower()
                has_num_pr = False
                try:
                    has_num_pr = bool(p._p.pPr is not None and p._p.pPr.numPr is not None)
                except Exception:
                    pass

                superscripts = []
                try:
                    for r in p.runs:
                        if (r.font.superscript or (r.style and 'superscript' in r.style.name.lower())) and r.text.strip():
                            superscripts.append(r.text.strip())
                except Exception:
                    pass

                if txt:
                    paragraphs_text.append(txt)
                    paragraph_meta.append({
                        "index": idx,
                        "text": txt,
                        "style": style_name,
                        "has_num_pr": has_num_pr,
                        "superscripts": superscripts
                    })
                    if "heading 1" in style_name or "heading 2" in style_name or "title" in style_name:
                        headings.append({"index": idx, "style": p.style.name if p.style else "Heading", "text": txt[:80]})
                    elif len(txt) < 80 and txt.isupper() and len(txt.split()) < 8:
                        headings.append({"index": idx, "style": "Heading (Caps)", "text": txt})
        except Exception as e:
            logger.warning("Could not parse DOCX for MS analysis: %s", e)

    full_text = "\n".join(paragraphs_text)
    total_words = sum(len(p.split()) for p in paragraphs_text) if paragraphs_text else (article.word_count or 0)
    total_paras = len(paragraphs_text)
    estimated_pages = max(1, round(total_words / 450)) if total_words else 1

    # Update article basic word count if missing
    if not article.word_count and total_words:
        article.word_count = total_words

    # 1. Overview & Frontmatter
    title = article.article_title or (paragraphs_text[0] if paragraphs_text else "Untitled Article")
    doi = article.article_doi or "Pending Assignment"
    lead_author = article.lead_author or (paragraphs_text[1] if len(paragraphs_text) > 1 else "Unknown")
    
    # 2. Section Structure (IMRAD)
    imrad_sections = {
        "Abstract": bool(re.search(r'\babstract\b', full_text, re.I)),
        "Introduction": bool(re.search(r'\bintroduction\b', full_text, re.I)),
        "Methods": bool(re.search(r'\b(methods|methodology|materials\s+and\s+methods)\b', full_text, re.I)),
        "Results": bool(re.search(r'\bresults\b', full_text, re.I)),
        "Discussion": bool(re.search(r'\bdiscussion\b', full_text, re.I)),
        "Conclusion": bool(re.search(r'\b(conclusion|conclusions)\b', full_text, re.I)),
        "References": bool(re.search(r'\b(references|bibliography|works\s+cited)\b', full_text, re.I)),
    }

    # 3. Mandatory Declarations
    def _extract_declaration(kw_regex: str, label: str) -> Dict[str, Any]:
        found = False
        snippet = ""
        for p in paragraphs_text:
            if re.search(kw_regex, p, re.I):
                found = True
                snippet = p[:250] + ("..." if len(p) > 250 else "")
                break
        return {
            "present": found,
            "label": label,
            "snippet": snippet if found else None,
            "status": "pass" if found else "warning",
            "message": f"{label} is provided." if found else f"Missing mandatory {label} statement."
        }

    declarations = {
        "funding": _extract_declaration(r'\b(funding|grant\s+support|financial\s+support|funded\s+by)\b', "Funding Statement"),
        "ethics": _extract_declaration(r'\b(ethic(?:al)?\s+approval|ethics\s+committee|institutional\s+review\s+board|irb\b|declaration\s+of\s+helsinki)\b', "Ethical Approval"),
        "conflicts": _extract_declaration(r'\b(conflict(?:s)?\s+of\s+interest|competing\s+interest(?:s)?|financial\s+interest)\b', "Conflict of Interest"),
        "data_availability": _extract_declaration(r'\b(data\s+availability|data\s+sharing|raw\s+data|repository)\b', "Data Availability Statement"),
        "consent": _extract_declaration(r'\b(informed\s+consent|patient\s+consent|consent\s+to\s+participate|consent\s+for\s+publication)\b', "Informed Consent"),
    }

    # 4. Asset Cross-Verification (Figures & Tables)
    fig_matches = set(re.findall(r'\b(?:fig(?:ure)?\.?\s*(\d+[a-z]?))\b', full_text, re.I))
    table_matches = set(re.findall(r'\b(?:table\s*(\d+[a-z]?))\b', full_text, re.I))

    # Art files attached
    art_files = db.query(JournalFile).filter(
        JournalFile.article_id == article.id,
        JournalFile.category.in_(["Art", "Figure", "image"])
    ).all()

    figures_list: List[Dict[str, Any]] = []
    for fnum in sorted(fig_matches, key=lambda x: (int(re.findall(r'\d+', x)[0]) if re.findall(r'\d+', x) else 0, x)):
        matched = next((f.filename for f in art_files if f"fig{fnum}" in f.filename.lower() or f"figure_{fnum}" in f.filename.lower() or f"figure{fnum}" in f.filename.lower() or (f.figure_number and str(f.figure_number) == str(fnum))), None)
        figures_list.append({
            "label": f"Figure {fnum}",
            "number": fnum,
            "called_in_text": True,
            "matched_file": matched,
            "status": "ok" if matched else "missing_file"
        })

    tables_list: List[Dict[str, Any]] = []
    for tnum in sorted(table_matches, key=lambda x: (int(re.findall(r'\d+', x)[0]) if re.findall(r'\d+', x) else 0, x)):
        tables_list.append({
            "label": f"Table {tnum}",
            "number": tnum,
            "called_in_text": True,
            "status": "ok"
        })

    # 5. Citation & Reference Integrity
    ref_entries: List[str] = []
    in_ref_section = False
    ref_heading_idx = -1

    for p in paragraph_meta:
        txt = p["text"]
        p_style = p["style"]

        is_ref_heading = False
        if p_style in ['refh', 'reference heading', 'reference_heading', 'references heading']:
            is_ref_heading = True
        elif re.search(r'^(?:\d+[\.\s]+|[IVXLCDM]+[\.\s]+)?(references|bibliography|literature\s+cited|works\s+cited)\b[:\s]*$', txt, re.I):
            is_ref_heading = True

        if is_ref_heading:
            in_ref_section = True
            ref_heading_idx = p["index"]
            continue

        if in_ref_section:
            is_exit = False
            if p_style in ['adrf', 'heading 1', 'heading 2', 'heading 3']:
                is_exit = True
            elif re.search(r'^(correspondence|author\s+details|figure\s+\d+|table\s+\d+|appendix|supplementary\s+material|biographical\s+note)\b[:\s]*', txt, re.I):
                is_exit = True

            if is_exit:
                in_ref_section = False
            else:
                has_num_prefix = bool(re.match(r'^\s*(?:\[\d+\]|\d+[\.\)]|\(\d+\)|\d+\t)\s*', txt))
                is_ref_style = ('ref' in p_style or 'biblio' in p_style) and not is_ref_heading
                has_year_or_doi = bool(re.search(r'\b(19|20)\d{2}\b|doi:\s*10\.\d+', txt, re.I))
                
                if p["has_num_pr"] or has_num_prefix or is_ref_style or (has_year_or_doi and len(txt) > 25) or len(txt) > 30:
                    ref_entries.append(txt)

    if not ref_entries:
        for p in paragraph_meta:
            if ('ref' in p["style"] or 'biblio' in p["style"]) and p["style"] not in ['refh', 'reference heading']:
                ref_entries.append(p["text"])

    ref_count = len(ref_entries)

    # B. Identify Citations called in text (prior to reference section)
    citation_numbers: set = set()
    citation_author_years: set = set()

    for p in paragraph_meta:
        if ref_heading_idx != -1 and p["index"] >= ref_heading_idx:
            break

        txt = p["text"]

        for m in re.finditer(r'\[(\d+(?:[–\-,;\s]+\d+)*)\]|(?<!\w)\((\d+(?:[–\-,;\s]+\d+)*)\)(?!\w)', txt):
            is_bracket = bool(m.group(1))
            group = m.group(1) or m.group(2) or ''
            start = m.start()
            preceding = txt[max(0, start - 15):start]

            if not is_bracket and re.search(r'[\d%=\~±\+\-]\s*$', preceding):
                continue

            for chunk in re.split(r'[,;]', group):
                chunk = chunk.strip()
                range_match = re.match(r'^(\d+)[–\-](\d+)$', chunk)
                if range_match:
                    start_n, end_n = int(range_match.group(1)), int(range_match.group(2))
                    if 0 < start_n <= end_n <= 500:
                        if ref_count == 0 or end_n <= ref_count + 5:
                            citation_numbers.update(range(start_n, end_n + 1))
                elif chunk.isdigit():
                    num = int(chunk)
                    if 0 < num <= 500:
                        if is_bracket or ref_count == 0 or num <= ref_count:
                            citation_numbers.add(num)

        for s_txt in p["superscripts"]:
            for m in re.finditer(r'(\d+(?:[–\-,;\s]+\d+)*)', s_txt):
                for chunk in re.split(r'[,;]', m.group(1)):
                    chunk = chunk.strip()
                    range_match = re.match(r'^(\d+)[–\-](\d+)$', chunk)
                    if range_match:
                        start_n, end_n = int(range_match.group(1)), int(range_match.group(2))
                        if 0 < start_n <= end_n <= 500:
                            citation_numbers.update(range(start_n, end_n + 1))
                    elif chunk.isdigit():
                        num = int(chunk)
                        if 0 < num <= 500:
                            citation_numbers.add(num)

        for m in re.finditer(r'(?<!\w)\(([A-Z][a-zA-Z\s.,&–-]+?(?:19|20)\d{2}[a-z]?(?:;\s*[A-Z][a-zA-Z\s.,&–-]+?(?:19|20)\d{2}[a-z]?)*)\)', txt):
            group = m.group(1).strip()
            if re.search(r'\b(19|20)\d{2}\b', group):
                citation_author_years.add(group)

    if ref_count == 0 and citation_numbers:
        ref_count = max(citation_numbers)

    citations_count = len(citation_numbers) if citation_numbers else len(citation_author_years)

    # 6. Advisory Language Editing Level Calculation
    err_count, density, recommended_level, sample_issues = calculate_le_density(full_text, total_words)
    
    # Check if manual override exists
    existing_meta = article.extracted_metadata or {}
    chosen_level = existing_meta.get("le_level") or article.complexity_level or recommended_level
    if chosen_level not in ["Level 1 – Light", "Level 2 – Medium", "Level 3 – Heavy"]:
        chosen_level = recommended_level

    # 7. Author Queries (AQ) Generation
    author_queries: List[Dict[str, Any]] = []
    aq_idx = 1

    if not declarations["funding"]["present"]:
        author_queries.append({
            "id": f"AQ-{aq_idx:02d}",
            "category": "Declarations",
            "query": "Please provide a formal Funding statement detailing grant numbers and sponsors, or confirm that this research received no external funding.",
            "status": "Open"
        })
        aq_idx += 1

    if not declarations["ethics"]["present"]:
        author_queries.append({
            "id": f"AQ-{aq_idx:02d}",
            "category": "Declarations",
            "query": "Please provide the Ethics Committee or Institutional Review Board (IRB) approval name and reference number, or state if ethics approval was exempt.",
            "status": "Open"
        })
        aq_idx += 1

    if not declarations["conflicts"]["present"]:
        author_queries.append({
            "id": f"AQ-{aq_idx:02d}",
            "category": "Declarations",
            "query": "Please confirm whether any authors have competing financial or non-financial conflicts of interest.",
            "status": "Open"
        })
        aq_idx += 1

    if not declarations["data_availability"]["present"]:
        author_queries.append({
            "id": f"AQ-{aq_idx:02d}",
            "category": "Declarations",
            "query": "Please provide a Data Availability Statement specifying repository URL/accession codes or state that data is available upon request.",
            "status": "Open"
        })
        aq_idx += 1

    for fig in figures_list:
        if fig["status"] == "missing_file":
            author_queries.append({
                "id": f"AQ-{aq_idx:02d}",
                "category": "Artwork",
                "query": f"{fig['label']} is cited in text but no corresponding artwork file was provided in the package. Please supply high-resolution image file (TIFF/EPS/PNG >= 300 DPI).",
                "status": "Open"
            })
            aq_idx += 1

    if chosen_level == "Level 3 – Heavy":
        author_queries.append({
            "id": f"AQ-{aq_idx:02d}",
            "category": "Language Editing",
            "query": f"Manuscript language density ({density} issues/1k words) indicates Level 3 (Heavy) language editing is advised. Authors will receive edited phrasing for verification.",
            "status": "Open"
        })
        aq_idx += 1

    if citation_numbers and ref_count > 0:
        missing_in_biblio = [c for c in citation_numbers if c > ref_count]
        if missing_in_biblio:
            author_queries.append({
                "id": f"AQ-{aq_idx:02d}",
                "category": "Citations & References",
                "query": f"Citation(s) [{', '.join(str(c) for c in sorted(missing_in_biblio)[:5])}] are called in text but exceed the {ref_count} reference entries present in the bibliography. Please supply missing reference details.",
                "status": "Open"
            })
            aq_idx += 1

    # 7-Step Checklist State
    missing_decls = sum(1 for d in declarations.values() if not d["present"])
    missing_figs = sum(1 for f in figures_list if f["status"] == "missing_file")

    checklist = [
        {
            "step": 1,
            "title": "Manuscript Overview & Frontmatter",
            "status": "pass" if (total_words > 0 and title) else "warning",
            "details": f"{total_words:,} words · ~{estimated_pages} pages · {total_paras} paragraphs"
        },
        {
            "step": 2,
            "title": "Section Structure & Hierarchy",
            "status": "pass" if (imrad_sections["Introduction"] and imrad_sections["Methods"]) else "warning",
            "details": f"{sum(1 for v in imrad_sections.values() if v)} of {len(imrad_sections)} key IMRAD sections identified"
        },
        {
            "step": 3,
            "title": "Mandatory Declarations & Compliance",
            "status": "pass" if missing_decls == 0 else "warning",
            "details": f"{len(declarations) - missing_decls} of {len(declarations)} declarations verified" + (f" ({missing_decls} missing)" if missing_decls else "")
        },
        {
            "step": 4,
            "title": "Asset & Callout Cross-Verification",
            "status": "pass" if missing_figs == 0 else "warning",
            "details": f"{len(figures_list)} figure(s) called · {len(tables_list)} table(s) called" + (f" · {missing_figs} figure art file(s) missing" if missing_figs else "")
        },
        {
            "step": 5,
            "title": "Citation & Reference Integrity",
            "status": "pass" if (citations_count > 0 or ref_count > 0) else "warning",
            "details": f"{citations_count} citations called in-text · {ref_count} reference entries listed"
        },
        {
            "step": 6,
            "title": "Advisory Language Editing (LE) Level",
            "status": "pass",
            "details": f"{chosen_level} (Score: {density}/1k words; {err_count} detected issues)"
        },
        {
            "step": 7,
            "title": "Author Queries & Editorial Log (ELOG)",
            "status": "pass",
            "details": f"{len(author_queries)} Author Query item(s) logged · ELOG report ready"
        }
    ]

    analysis_data = {
        "article_id": article.id,
        "title": title,
        "doi": doi,
        "lead_author": lead_author,
        "journal_code": journal.journal_code if journal else "Unknown",
        "journal_title": journal.journal_title if journal else "Unknown",
        "client_code": client.client_code if client else "Unknown",
        "publisher_name": client.publisher_name if client else "Unknown",
        "word_count": total_words,
        "estimated_pages": estimated_pages,
        "paragraphs_count": total_paras,
        "table_count": table_count,
        "imrad_sections": imrad_sections,
        "headings": headings[:20],
        "declarations": declarations,
        "figures": figures_list,
        "tables": tables_list,
        "citations_count": citations_count,
        "references_count": ref_count,
        "le_error_count": err_count,
        "le_density": density,
        "le_recommended_level": recommended_level,
        "le_chosen_level": chosen_level,
        "sample_language_issues": sample_issues,
        "author_queries": author_queries,
        "checklist": checklist,
        "analyzed_at": datetime.utcnow().isoformat()
    }

    # Generate ELOG HTML
    analysis_data["elog_html"] = generate_elog_html(article, analysis_data)

    # Persist in article metadata
    meta = dict(article.extracted_metadata or {})
    meta["ms_analysis"] = analysis_data
    meta["le_level"] = chosen_level
    article.extracted_metadata = meta
    article.complexity_level = chosen_level
    db.commit()

    # Save ELOG file
    _save_elog_file(db, article, analysis_data["elog_html"])

    return analysis_data


def generate_elog_html(article: JournalArticle, data: Dict[str, Any]) -> str:
    """Generates a professional, print-ready HTML Editorial Log (ELOG) document."""
    queries_rows = ""
    for q in data.get("author_queries", []):
        queries_rows += f"""
        <tr style="border-bottom: 1px solid #e2e8f0;">
          <td style="padding: 10px 12px; font-weight: 700; color: #0284c7; font-family: monospace;">{q['id']}</td>
          <td style="padding: 10px 12px; font-size: 13px; color: #475569;"><span style="background: #f1f5f9; padding: 2px 6px; border-radius: 4px; font-size: 11px;">{q['category']}</span></td>
          <td style="padding: 10px 12px; font-size: 13px; color: #1e293b;">{q['query']}</td>
          <td style="padding: 10px 12px; font-size: 12px; color: #64748b; min-width: 140px; border-left: 1px dashed #cbd5e1;">[ Author response here ]</td>
        </tr>
        """

    decls_rows = ""
    for k, d in data.get("declarations", {}).items():
        status_color = "#16a34a" if d["present"] else "#dc2626"
        status_badge = "CONFIRMED" if d["present"] else "MISSING"
        decls_rows += f"""
        <tr style="border-bottom: 1px solid #e2e8f0;">
          <td style="padding: 8px 12px; font-weight: 600; color: #334155;">{d['label']}</td>
          <td style="padding: 8px 12px;"><span style="color: {status_color}; font-weight: 700; font-size: 12px;">● {status_badge}</span></td>
          <td style="padding: 8px 12px; font-size: 12px; color: #64748b;">{d['snippet'] or 'None provided in manuscript.'}</td>
        </tr>
        """

    figures_rows = ""
    for f in data.get("figures", []):
        status_badge = "<span style='color: #16a34a;'>Matched</span>" if f["status"] == "ok" else "<span style='color: #dc2626; font-weight: 700;'>Missing Art File</span>"
        figures_rows += f"""
        <tr style="border-bottom: 1px solid #e2e8f0;">
          <td style="padding: 6px 12px; font-weight: 600;">{f['label']}</td>
          <td style="padding: 6px 12px; font-size: 12px;">{status_badge}</td>
          <td style="padding: 6px 12px; font-size: 12px; color: #64748b; font-family: monospace;">{f.get('matched_file') or 'No file found in package'}</td>
        </tr>
        """

    checklist_cards = ""
    for c in data.get("checklist", []):
        icon = "✓" if c["status"] == "pass" else "⚠"
        color = "#16a34a" if c["status"] == "pass" else "#d97706"
        checklist_cards += f"""
        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 10px 14px; margin-bottom: 8px;">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <div style="font-weight: 600; font-size: 13px; color: #1e293b;">
              <span style="color: {color}; margin-right: 6px; font-weight: 800;">{icon}</span> Step {c['step']}: {c['title']}
            </div>
            <div style="font-size: 12px; color: #64748b;">{c['details']}</div>
          </div>
        </div>
        """

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Editorial Log (ELOG) - {data.get('doi')}</title>
  <style>
    body {{
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      margin: 0; padding: 40px; background: #ffffff; color: #0f172a; line-height: 1.5;
    }}
    .header {{
      display: flex; justify-content: space-between; align-items: flex-start;
      border-bottom: 3px solid #0284c7; padding-bottom: 20px; margin-bottom: 30px;
    }}
    .brand {{ font-size: 24px; font-weight: 800; color: #0f172a; letter-spacing: -0.5px; }}
    .subtitle {{ font-size: 13px; color: #0284c7; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; }}
    .meta-grid {{
      display: grid; grid-template-columns: repeat(6, 1fr); gap: 12px; margin-bottom: 28px;
    }}
    .meta-card {{
      background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 14px;
    }}
    .meta-label {{ font-size: 11px; text-transform: uppercase; color: #64748b; font-weight: 700; margin-bottom: 4px; }}
    .meta-val {{ font-size: 14px; font-weight: 700; color: #0f172a; }}
    .section-title {{
      font-size: 16px; font-weight: 700; color: #0f172a; margin: 24px 0 12px 0; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px;
    }}
    table {{ width: 100%; border-collapse: collapse; margin-bottom: 20px; }}
    th {{ background: #f1f5f9; text-align: left; padding: 10px 12px; font-size: 12px; text-transform: uppercase; color: #475569; letter-spacing: 0.5px; }}
    .badge {{ display: inline-block; padding: 3px 10px; border-radius: 12px; font-size: 12px; font-weight: 700; }}
    .badge-level {{ background: #e0f2fe; color: #0369a1; border: 1px solid #bae6fd; }}
  </style>
</head>
<body>
  <div class="header">
    <div>
      <div class="brand">PA Editorial Ltd. · Editorial Log (ELOG)</div>
      <div class="subtitle">Stage 1 Manuscript Analysis & Compliance Dossier</div>
    </div>
    <div style="text-align: right;">
      <div style="font-size: 13px; font-weight: 600;">{data.get('client_code')} / {data.get('journal_code')}</div>
      <div style="font-size: 12px; color: #64748b;">Generated: {datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')}</div>
    </div>
  </div>

  <div style="margin-bottom: 24px;">
    <h1 style="font-size: 20px; margin: 0 0 8px 0; color: #0f172a;">{data.get('title')}</h1>
    <div style="font-size: 13px; color: #475569;">
      <strong>Lead Author:</strong> {data.get('lead_author')} &nbsp;|&nbsp;
      <strong>DOI:</strong> {data.get('doi')} &nbsp;|&nbsp;
      <strong>Publisher:</strong> {data.get('publisher_name')}
    </div>
  </div>

  <div class="meta-grid">
    <div class="meta-card">
      <div class="meta-label">Total Words</div>
      <div class="meta-val">{data.get('word_count'):,}</div>
    </div>
    <div class="meta-card">
      <div class="meta-label">Est. Pages</div>
      <div class="meta-val">~{data.get('estimated_pages')} pp</div>
    </div>
    <div class="meta-card">
      <div class="meta-label">Advisory LE Level</div>
      <div class="meta-val"><span class="badge badge-level">{data.get('le_chosen_level')}</span></div>
    </div>
    <div class="meta-card">
      <div class="meta-label">LE Density Score</div>
      <div class="meta-val">{data.get('le_density')} / 1k</div>
    </div>
    <div class="meta-card">
      <div class="meta-label">Tables &amp; Figs</div>
      <div class="meta-val">{len(data.get('tables', []))} tbl / {len(data.get('figures', []))} fig</div>
    </div>
    <div class="meta-card">
      <div class="meta-label">Refs &amp; Citations</div>
      <div class="meta-val">{data.get('references_count', 0)} refs / {data.get('citations_count', 0)} cited</div>
    </div>
  </div>

  <div class="section-title">1. 7-Step Manuscript Analysis Checklist</div>
  <div style="margin-bottom: 20px;">
    {checklist_cards}
  </div>

  <div class="section-title">2. Mandatory Declarations & Ethics Compliance</div>
  <table>
    <thead>
      <tr>
        <th style="width: 28%;">Declaration Type</th>
        <th style="width: 18%;">Status</th>
        <th style="width: 54%;">Detected Manuscript Statement</th>
      </tr>
    </thead>
    <tbody>
      {decls_rows}
    </tbody>
  </table>

  <div class="section-title">3. Asset Cross-Verification (Artwork & Tables)</div>
  <table>
    <thead>
      <tr>
        <th style="width: 28%;">Asset</th>
        <th style="width: 25%;">Package Status</th>
        <th style="width: 47%;">Matched Artwork File</th>
      </tr>
    </thead>
    <tbody>
      {figures_rows or '<tr><td colspan="3" style="padding: 10px; color: #64748b;">No figures called in manuscript text.</td></tr>'}
    </tbody>
  </table>

  <div class="section-title">4. Consolidated Author Queries (AQ) ({len(data.get('author_queries', []))} items)</div>
  <table>
    <thead>
      <tr>
        <th style="width: 10%;">Query ID</th>
        <th style="width: 16%;">Category</th>
        <th style="width: 48%;">Query Text</th>
        <th style="width: 26%;">Author Response</th>
      </tr>
    </thead>
    <tbody>
      {queries_rows or '<tr><td colspan="4" style="padding: 10px; color: #16a34a; font-weight: 600;">No author queries required. All compliance and asset checks passed!</td></tr>'}
    </tbody>
  </table>

  <div style="margin-top: 40px; padding-top: 15px; border-top: 1px solid #cbd5e1; font-size: 11px; color: #94a3b8; text-align: center;">
    PA Editorial Ltd. · NinjaInkflow Publishing Platform · Manuscript Analysis & Editorial Log Standard
  </div>
</body>
</html>
"""
    return html


def _save_elog_file(db: Session, article: JournalArticle, html_content: str) -> None:
    """Saves the ELOG HTML report into the article working directory as a JournalFile."""
    try:
        slug = f"article_{article.id}_ELOG.html"
        save_version(db, article, "ELOG", slug, html_content.encode("utf-8"), "elog")
        db.commit()
    except Exception as e:
        logger.warning("Could not persist ELOG file to disk: %s", e)


def get_ms_analysis(db: Session, article: JournalArticle) -> Dict[str, Any]:
    """Retrieves cached MS Analysis data or runs analysis on demand."""
    meta = article.extracted_metadata or {}
    analysis = meta.get("ms_analysis")
    if analysis and isinstance(analysis, dict):
        return analysis
    return analyze_manuscript(db, article)


def set_le_level(db: Session, article: JournalArticle, level: str, reason: Optional[str] = None) -> Dict[str, Any]:
    """Sets the Language Editing (LE) Level manually (Light, Medium, Heavy)."""
    valid = ["Level 1 – Light", "Level 2 – Medium", "Level 3 – Heavy"]
    if level not in valid:
        # Match fuzzy
        if "light" in level.lower() or "1" in level:
            level = "Level 1 – Light"
        elif "heavy" in level.lower() or "3" in level:
            level = "Level 3 – Heavy"
        else:
            level = "Level 2 – Medium"

    meta = dict(article.extracted_metadata or {})
    meta["le_level"] = level
    if reason:
        meta["le_level_reason"] = reason

    if "ms_analysis" in meta and isinstance(meta["ms_analysis"], dict):
        meta["ms_analysis"]["le_chosen_level"] = level
        # Update checklist step 6
        for c in meta["ms_analysis"].get("checklist", []):
            if c.get("step") == 6:
                density = meta["ms_analysis"].get("le_density", 0.0)
                err_count = meta["ms_analysis"].get("le_error_count", 0)
                c["details"] = f"{level} (Score: {density}/1k words; {err_count} detected issues)"
        meta["ms_analysis"]["elog_html"] = generate_elog_html(article, meta["ms_analysis"])
        _save_elog_file(db, article, meta["ms_analysis"]["elog_html"])

    article.extracted_metadata = meta
    article.complexity_level = level
    db.commit()

    return {
        "status": "success",
        "article_id": article.id,
        "le_level": level,
        "reason": reason
    }


def complete_ms_analysis_stage(db: Session, article: JournalArticle, user_id: Optional[int] = None, remarks: Optional[str] = None) -> Dict[str, Any]:
    """
    Completes Stage 1 (MS Analysis & ELOG) and advances to Stage 2 (Pre-Editing).
    Ensures analysis and ELOG are generated before advancing.
    """
    analysis = get_ms_analysis(db, article)
    adv_remarks = remarks or f"MS Analysis & ELOG completed. LE Level: {analysis.get('le_chosen_level')}, {len(analysis.get('author_queries', []))} AQs logged."
    
    res = advance_article_stage(db, article.id, adv_remarks)
    return {
        **res,
        "ms_analysis": analysis
    }
