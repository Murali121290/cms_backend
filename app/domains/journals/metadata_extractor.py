import os
import re
import zipfile
import tempfile
from typing import Dict, Any, List, Optional
import docx


def extract_docx_metadata_advanced(docx_path: str) -> Dict[str, Any]:
    """
    Automated DOCX Metadata Extractor Module.
    Parses manuscript DOCX to extract:
    - Article Title
    - DOI
    - Authors & Affiliations
    - Corresponding Email
    - Abstract
    - Keywords
    - Word count & Page estimations
    """
    metadata: Dict[str, Any] = {
        "article_title": None,
        "article_doi": None,
        "lead_author": None,
        "co_authors": [],
        "affiliations": [],
        "corresponding_email": None,
        "abstract": None,
        "keywords": [],
        "word_count": 0,
        "estimated_pages": 1
    }

    if not os.path.exists(docx_path):
        return metadata

    try:
        doc = docx.Document(docx_path)
        paragraphs = [p.text.strip() for p in doc.paragraphs if p.text.strip()]
        if not paragraphs:
            return metadata

        # 1. Total Word Count & Page Estimation
        total_words = sum(len(p.split()) for p in paragraphs)
        metadata["word_count"] = total_words
        metadata["estimated_pages"] = max(1, round(total_words / 450))

        # 2. Extract DOI using Regex
        full_text = "\n".join(paragraphs)
        doi_match = re.search(r'10\.\d{4,9}/[-._;()/:A-Za-z0-9]+', full_text)
        if doi_match:
            metadata["article_doi"] = doi_match.group(0).rstrip('.,;')
        else:
            # Check text containing 'doi'
            doi_text_match = re.search(r'doi:\s*(10\.\S+)', full_text, re.IGNORECASE)
            if doi_text_match:
                metadata["article_doi"] = doi_text_match.group(1).rstrip('.,;')

        # 3. Extract Email using Regex
        email_match = re.search(r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}', full_text)
        if email_match:
            metadata["corresponding_email"] = email_match.group(0)

        # 4. Extract Article Title
        # Check paragraph style first (e.g., 'Title', 'Heading 1', 'Article Title')
        for p in doc.paragraphs:
            style_name = (p.style.name or '').lower() if p.style else ''
            if ('title' in style_name or 'heading 1' in style_name) and p.text.strip():
                metadata["article_title"] = p.text.strip()
                break

        # Fallback to first non-empty paragraph if no title style matched
        if not metadata["article_title"] and paragraphs:
            metadata["article_title"] = paragraphs[0]

        # 5. Extract Abstract Block
        abstract_lines = []
        in_abstract = False
        for p in paragraphs:
            p_lower = p.lower()
            if p_lower.startswith(('abstract', 'summary')):
                in_abstract = True
                # Include content after 'Abstract:' if present on same line
                after_header = re.sub(r'^(abstract|summary)[:\s\-]*', '', p, flags=re.IGNORECASE).strip()
                if after_header:
                    abstract_lines.append(after_header)
                continue

            if in_abstract:
                if p_lower.startswith(('keywords', 'key words', '1. introduction', '1. ', 'introduction')):
                    in_abstract = False
                    break
                abstract_lines.append(p)

        if abstract_lines:
            metadata["abstract"] = " ".join(abstract_lines)

        # 6. Extract Keywords
        for p in paragraphs:
            p_lower = p.lower()
            if p_lower.startswith(('keywords:', 'key words:', 'keywords', 'key words')):
                kw_str = re.sub(r'^(keywords|key words)[:\s\-]*', '', p, flags=re.IGNORECASE).strip()
                if kw_str:
                    raw_kws = re.split(r'[,;•\n]', kw_str)
                    metadata["keywords"] = [k.strip() for k in raw_kws if k.strip()]
                break

        # 7. Extract Authors & Affiliations
        # Usually between Title and Abstract
        first_few = paragraphs[1:8]
        author_candidates = []
        affiliation_candidates = []

        for p in first_few:
            p_lower = p.lower()
            if p_lower.startswith(('abstract', 'keywords', 'doi:')):
                break
            if any(term in p_lower for term in ['university', 'department', 'institute', 'hospital', 'college', 'school', 'center', 'centre', 'laboratory', 'inc.', 'ltd.']):
                affiliation_candidates.append(p)
            elif '@' not in p and len(p.split()) < 20:
                author_candidates.append(p)

        if author_candidates:
            metadata["lead_author"] = author_candidates[0]
            if len(author_candidates) > 1:
                metadata["co_authors"] = author_candidates[1:]

        metadata["affiliations"] = affiliation_candidates

    except Exception as e:
        print(f"Error parsing DOCX metadata: {e}")

    return metadata


def process_uploaded_zip_package(zip_path: str, extract_target_dir: str) -> Dict[str, Any]:
    """
    Extracts ZIP manuscript archive and processes contained DOCX files and art assets.
    Returns extracted metadata and list of unzipped asset files.
    """
    extracted_files: List[Dict[str, str]] = []
    primary_docx_path: Optional[str] = None
    result_metadata: Dict[str, Any] = {}

    if not zipfile.is_zipfile(zip_path):
        raise ValueError("Uploaded file is not a valid ZIP package")

    os.makedirs(extract_target_dir, exist_ok=True)

    with zipfile.ZipFile(zip_path, 'r') as zip_ref:
        zip_ref.extractall(extract_target_dir)

        for root, _, files in os.walk(extract_target_dir):
            for file in files:
                full_path = os.path.join(root, file)
                rel_path = os.path.relpath(full_path, extract_target_dir)
                ext = os.path.splitext(file)[1].lower()

                category = "Manuscript"
                if ext in ['.png', '.jpg', '.jpeg', '.tif', '.tiff', '.eps', '.svg']:
                    category = "Art"
                elif ext in ['.xml', '.jats']:
                    category = "XML"
                elif ext in ['.pdf']:
                    category = "Proof"

                extracted_files.append({
                    "filename": file,
                    "rel_path": rel_path,
                    "full_path": full_path,
                    "category": category,
                    "ext": ext
                })

                if ext == '.docx' and not file.startswith('~$'):
                    if not primary_docx_path or 'manuscript' in file.lower() or 'main' in file.lower():
                        primary_docx_path = full_path

    # Extract metadata from primary DOCX manuscript if found
    if primary_docx_path:
        result_metadata = extract_docx_metadata_advanced(primary_docx_path)

    result_metadata["primary_docx_path"] = primary_docx_path
    result_metadata["extracted_files"] = extracted_files
    return result_metadata
