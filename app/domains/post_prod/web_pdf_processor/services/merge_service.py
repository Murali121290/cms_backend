import os
import re
import fitz
from typing import List, Tuple

def categorize_file(filepath: str) -> Tuple[str, int]:
    """
    Categorizes a PDF file based on its filename and content.
    Returns: 'FC' (0), 'FM' (1), 'TEXT' (2), 'BM' (3), 'BC' (4)
    and the sort order integer.
    """
    basename = os.path.basename(filepath).lower()
    
    # Check if it's an image file; if so, assume it's the front cover
    if basename.endswith(('.jpg', '.jpeg', '.png')):
        return 'FC', 0
    
    # Check filename first with boundary or underscore delimiters
    if re.search(r'(\b|_)(fc)(\b|_)|^cover|^front[\s_]*cover', basename):
        return 'FC', 0
    elif re.search(r'(\b|_)bc(\b|_)|^back[\s_]*cover', basename):
        return 'BC', 4
    elif re.search(r'(\b|_)fm(\b|_)|^front[\s_]*matter', basename):
        return 'FM', 1
    elif re.search(r'(\b|_)(bm|ata)(\b|_)|^back[\s_]*matter|index|bibliography|references', basename):
        return 'BM', 3
        
    # If naming isn't obvious, open and check content
    try:
        doc = fitz.open(filepath)
        if len(doc) > 0:
            # Check page labels or text of first page
            first_page_text = doc[0].get_text("text").strip().lower()
            
            # If the first page has just a small roman numeral at the bottom/top
            if len(first_page_text) < 50 and re.match(r'^(i|ii|iii|iv|v|vi|vii|viii|ix|x)\b', first_page_text):
                doc.close()
                return 'FM', 1
            
            # Check if it has an index or bibliography at the start (Back Matter)
            if re.search(r'\b(index|bibliography|references)\b', first_page_text[:100]):
                doc.close()
                return 'BM', 3
                
        doc.close()
    except Exception:
        pass
        
    # Default to main text block
    return 'TEXT', 2

def merge_pdfs(input_files: List[dict], output_path: str) -> dict:
    """
    Merge PDFs and return result with total_pages count.
    input_files expects a list of dicts: [{'absolute_path': str, 'category': str}]
    Returns: {'success': bool, 'total_pages': int, 'error': str (if failed)}
    """
    print("Preparing to merge files in the exact order provided by the UI...")

    ordered_files = []
    categories = []
    
    for f in input_files:
        filepath = f.get('absolute_path')
        cat = f.get('category', 'TEXT')
        
        if not os.path.exists(filepath):
            print(f"Error: File not found: {filepath}")
            return {'success': False, 'total_pages': 0, 'error': f'File not found: {filepath}'}
            
        ordered_files.append(filepath)
        categories.append(cat)

    print("\nMerge Order (As specified by user):")
    for cat, f in zip(categories, ordered_files):
        print(f" [{cat}] -> {os.path.basename(f)}")

    # Missing section warnings
    if 'FC' not in categories:
        print("⚠️ Warning: No Front Cover (FC) detected.")
    if 'BC' not in categories:
        print("⚠️ Warning: No Back Cover (BC) detected.")

    print("\nMerging files...")

    final_doc = fitz.open()
    global_toc = []
    page_labels = []
    current_page_offset = 0

    first_metadata = None

    for cat, filepath in zip(categories, ordered_files):
        try:
            if filepath.lower().endswith(('.jpg', '.jpeg', '.png')):
                img_doc = fitz.open(filepath)
                pdf_bytes = img_doc.convert_to_pdf()
                doc = fitz.open("pdf", pdf_bytes)
                img_doc.close()
            else:
                doc = fitz.open(filepath)

            # Preserve metadata from FM/TEXT which has the book title
            if not first_metadata and doc.metadata and doc.metadata.get('title'):
                if cat in ('FM', 'TEXT'):
                    first_metadata = doc.metadata

            # Extract TOC and shift page numbers
            toc = doc.get_toc()
            for item in toc:
                item[2] += current_page_offset
                global_toc.append(item)

            # Assign Page Labels based on category
            if cat == 'FC':
                page_labels.append({'startpage': current_page_offset, 'prefix': 'Cover', 'firstpagenum': 1})
            elif cat == 'TEXT':
                # Start arabic numbering from 1 at the beginning of the text block
                page_labels.append({'startpage': current_page_offset, 'prefix': '', 'style': 'D', 'firstpagenum': 1})
            elif cat == 'FM':
                # Roman numerals for front matter
                page_labels.append({'startpage': current_page_offset, 'prefix': '', 'style': 'r', 'firstpagenum': 1})
            elif cat == 'BC':
                # Back cover
                page_labels.append({'startpage': current_page_offset, 'prefix': 'BackCover', 'firstpagenum': 1})

            # Insert the PDF
            final_doc.insert_pdf(doc, links=True, annots=True)

            current_page_offset += len(doc)
            doc.close()

        except Exception as e:
            print(f"Error merging {filepath}: {e}")
            return {'success': False, 'total_pages': 0, 'error': str(e)}

    # Apply combined TOC, Page Labels, and Metadata
    final_doc.set_toc(global_toc)
    if page_labels:
        final_doc.set_page_labels(page_labels)
    if first_metadata:
        final_doc.set_metadata(first_metadata)

    # Save final book
    total_pages = len(final_doc)
    print(f"Saving merged book with {total_pages} pages...")
    final_doc.save(output_path, garbage=3, deflate=True)
    final_doc.close()

    print(f"✅ Successfully created {output_path}")
    return {'success': True, 'total_pages': total_pages, 'error': None}
