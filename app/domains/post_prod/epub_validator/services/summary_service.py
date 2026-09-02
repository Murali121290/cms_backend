import os
import json
from pathlib import Path
from bs4 import BeautifulSoup
import re

from .upload_service import UPLOAD_DIR, EXTRACT_DIR

def extract_epub_summary(folder_name: str, refresh: bool = False) -> dict:
    """
    Scans the extracted EPUB directory for tables, figures, and chapters,
    and returns a summary report. Caches the result to avoid re-parsing.
    """
    base_path = Path(UPLOAD_DIR) / folder_name / EXTRACT_DIR
    cache_path = Path(UPLOAD_DIR) / folder_name / "summary_cache.json"
    
    if cache_path.exists() and not refresh:
        try:
            with open(cache_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    
    total_chapters = 0
    total_figures = 0
    total_tables = 0
    figure_labels = []
    chapter_labels = []
    table_labels = []
    
    if not base_path.exists():
        return {
            "total_chapters": 0,
            "total_figures": 0,
            "total_tables": 0,
            "figure_labels": [],
            "chapter_labels": [],
            "table_labels": [],
            "error": "EPUB folder not found."
        }
        
    for root, _, files in os.walk(base_path):
        for file in sorted(files):
            # We treat .xhtml files as chapters/sections
            if file.endswith((".xhtml", ".html")):
                filepath = Path(root) / file
                
                # Rule: count .xhtml files as chapters only if filename has chapter_ or ch_
                is_chapter = "chapter_" in file.lower() or "ch_" in file.lower()
                
                # Rule: figure and table only check on chapter files
                if not is_chapter:
                    continue
                    
                total_chapters += 1
                
                try:
                    with open(filepath, "r", encoding="utf-8") as f:
                        soup = BeautifulSoup(f, "html.parser")
                        
                        # Just use the filename for the chapter label
                        chapter_labels.append(file)

                        # Find all tables and figures
                        tables = soup.find_all("table")
                        figures = soup.find_all("figure")
                        
                        # Process tables
                        for table in tables:
                            caption = table.find("caption")
                            if caption and caption.get_text(strip=True):
                                text = re.sub(r'\s+', ' ', caption.get_text(separator=" ", strip=True))
                                total_tables += 1
                                table_labels.append(f"[{file}] {text}")
                            else:
                                # Fallback to previous p tag starting with Tab or Fig
                                prev_element = table.find_previous_sibling(["p", "table"])
                                if prev_element and prev_element.name == "table":
                                    continue # Ignore consecutive split tables
                                
                                if prev_element and prev_element.name == "p":
                                    prev_text = prev_element.get_text(strip=True)
                                    if prev_text.startswith("Tab") or prev_text.startswith("Fig"):
                                        text = re.sub(r'\s+', ' ', prev_text)
                                        total_tables += 1
                                        table_labels.append(f"[{file}] {text}")
                                    else:
                                        total_tables += 1
                                        table_labels.append(f"[{file}] Table (No caption found)")
                                else:
                                    total_tables += 1
                                    table_labels.append(f"[{file}] Table (No caption found)")
                        
                        # Process figures
                        for fig in figures:
                            caption = fig.find("figcaption")
                            if caption and caption.get_text(strip=True):
                                text = re.sub(r'\s+', ' ', caption.get_text(separator=" ", strip=True))
                                total_figures += 1
                                figure_labels.append(f"[{file}] {text}")
                            else:
                                prev_element = fig.find_previous_sibling(["p", "figure"])
                                if prev_element and prev_element.name == "figure":
                                    continue # Ignore consecutive split figures
                                
                                if prev_element and prev_element.name == "p":
                                    prev_text = prev_element.get_text(strip=True)
                                    if prev_text.startswith("Tab") or prev_text.startswith("Fig"):
                                        text = re.sub(r'\s+', ' ', prev_text)
                                        total_figures += 1
                                        figure_labels.append(f"[{file}] {text}")
                                    else:
                                        total_figures += 1
                                        figure_labels.append(f"[{file}] Figure (No figcaption found)")
                                else:
                                    total_figures += 1
                                    figure_labels.append(f"[{file}] Figure (No figcaption found)")
                                    
                except Exception as e:
                    print(f"Error parsing {file} for summary: {e}")
                    
    result = {
        "total_chapters": total_chapters,
        "total_figures": total_figures,
        "total_tables": total_tables,
        "figure_labels": figure_labels,
        "chapter_labels": chapter_labels,
        "table_labels": table_labels
    }
    
    try:
        with open(cache_path, "w", encoding="utf-8") as f:
            json.dump(result, f)
    except Exception as e:
        print(f"Error writing summary cache: {e}")
        
    return result
