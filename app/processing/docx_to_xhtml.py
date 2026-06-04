"""Convert DOCX to XHTML using pandoc or LibreOffice."""

import os
import subprocess
import shutil
import logging
from pathlib import Path

logger = logging.getLogger("app.processing.docx_to_xhtml")


class DocxToXhtmlEngine:
    """Converts DOCX files to XHTML with embedded styles."""

    def convert(self, docx_path: str, out_html_path: str) -> str:
        """
        Convert DOCX to XHTML. Tries pandoc first, falls back to LibreOffice.

        Args:
            docx_path: Absolute path to input DOCX file
            out_html_path: Absolute path to output HTML file

        Returns:
            Path to the written HTML file

        Raises:
            RuntimeError: If both pandoc and LibreOffice fail
        """
        if not os.path.exists(docx_path):
            raise RuntimeError(f"Input DOCX not found: {docx_path}")

        os.makedirs(os.path.dirname(out_html_path), exist_ok=True)

        res_path = None
        if shutil.which("pandoc"):
            try:
                res_path = self._pandoc(docx_path, out_html_path)
            except Exception as e:
                logger.warning(f"pandoc failed, trying LibreOffice: {e}")

        if not res_path:
            try:
                res_path = self._libreoffice(docx_path, out_html_path)
            except Exception as e:
                raise RuntimeError(f"Both pandoc and LibreOffice failed: {e}")

        # Enrich the generated HTML with accurate paragraph style mappings from the DOCX file
        self._enrich_html_with_docx_styles(docx_path, out_html_path)
        return res_path

    def _enrich_html_with_docx_styles(self, docx_path: str, html_path: str) -> None:
        """
        Extract native paragraph style names from docx_path and inject them as
        data-style-label and class attributes into the HTML elements inside html_path.
        Uses a sequential greedy sliding-window sequence alignment algorithm to prevent drift.
        """
        try:
            import lxml.html
            from docx import Document
            from docx.oxml.ns import qn

            def clean_text(t):
                return "".join(c for c in t if c.isalnum()).lower()

            doc = Document(docx_path)

            # 1. Collect DOCX paragraphs in order
            docx_paras = []
            for p_el in doc.element.body.iter(qn("w:p")):
                text = "".join(node.text or "" for node in p_el.iter(qn("w:t"))).strip()
                if not text:
                    continue
                style_id = p_el.pPr.pStyle.get(qn("w:val")) if p_el.pPr is not None and p_el.pPr.pStyle is not None else None
                style_name = "Normal"
                if style_id:
                    try:
                        style_name = doc.styles[style_id].name
                    except Exception:
                        style_name = style_id
                docx_paras.append({
                    "clean": clean_text(text),
                    "style": style_name,
                })

            if not docx_paras:
                return

            # 2. Parse HTML file
            if not os.path.exists(html_path):
                return
            with open(html_path, "r", encoding="utf-8") as f:
                html_content = f.read()

            root = lxml.html.fromstring(html_content)
            html_paras = root.xpath("//p | //h1 | //h2 | //h3 | //h4 | //h5 | //h6")

            # 3. Align and Inject
            docx_idx = 0
            n_docx = len(docx_paras)

            for html_el in html_paras:
                html_text = html_el.text_content().strip()
                if not html_text:
                    continue
                html_clean = clean_text(html_text)

                matched_style = "Normal"
                best_idx = -1

                # Sliding window search (15 elements)
                for offset in range(15):
                    i = docx_idx + offset
                    if i >= n_docx:
                        break
                    docx_clean = docx_paras[i]["clean"]
                    if html_clean == docx_clean or html_clean in docx_clean or docx_clean in html_clean:
                        best_idx = i
                        matched_style = docx_paras[i]["style"]
                        break

                if best_idx != -1:
                    docx_idx = best_idx + 1
                else:
                    if docx_idx < n_docx:
                        matched_style = docx_paras[docx_idx]["style"]

                html_el.set("data-style-label", matched_style)
                html_el.set("class", matched_style)

            # 4. Save enriched HTML
            enriched_content = lxml.html.tostring(root, encoding="utf-8", method="html").decode("utf-8")
            if not enriched_content.lstrip().lower().startswith("<!doctype"):
                enriched_content = "<!DOCTYPE html>\n" + enriched_content

            with open(html_path, "w", encoding="utf-8") as f:
                f.write(enriched_content)

            logger.info(f"Enriched converted HTML {html_path} with accurate DOCX style mappings successfully.")

        except Exception as e:
            logger.warning(f"Failed to enrich converted HTML with DOCX style mapping: {e}")

    def _pandoc(self, docx_path: str, out_html_path: str) -> str:
        """Convert DOCX to XHTML using pandoc."""
        tmp_path = out_html_path + ".tmp"

        try:
            result = subprocess.run(
                [
                    "pandoc",
                    docx_path,
                    "-f", "docx",
                    "-t", "html",
                    "--mathml",
                    "--standalone",
                    "--output", tmp_path,
                ],
                capture_output=True,
                text=True,
                timeout=120,
                check=True,
            )

            if not os.path.exists(tmp_path):
                raise RuntimeError(f"pandoc produced no output: {result.stderr}")

            os.replace(tmp_path, out_html_path)
            logger.info(f"pandoc conversion succeeded: {out_html_path}")
            return out_html_path

        except subprocess.TimeoutExpired:
            raise RuntimeError("pandoc conversion timed out (>120s)")
        except subprocess.CalledProcessError as e:
            raise RuntimeError(f"pandoc failed: {e.stderr}")
        finally:
            if os.path.exists(tmp_path):
                os.remove(tmp_path)

    def _libreoffice(self, docx_path: str, out_html_path: str) -> str:
        """Convert DOCX to XHTML using LibreOffice headless."""
        out_dir = os.path.dirname(out_html_path)
        base_name = Path(docx_path).stem

        try:
            result = subprocess.run(
                [
                    "libreoffice",
                    "--headless",
                    "--convert-to", "html",
                    "--outdir", out_dir,
                    docx_path,
                ],
                capture_output=True,
                text=True,
                timeout=120,
                check=True,
            )

            # LibreOffice produces <input_name>.html in the output directory
            produced = os.path.join(out_dir, f"{base_name}.html")

            if not os.path.exists(produced):
                raise RuntimeError(
                    f"LibreOffice produced no output at {produced}: {result.stderr}"
                )

            # Rename to target path if different
            if produced != out_html_path:
                os.replace(produced, out_html_path)

            logger.info(f"LibreOffice conversion succeeded: {out_html_path}")
            return out_html_path

        except subprocess.TimeoutExpired:
            raise RuntimeError("LibreOffice conversion timed out (>120s)")
        except subprocess.CalledProcessError as e:
            raise RuntimeError(f"LibreOffice failed: {e.stderr}")
