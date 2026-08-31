import os
import zipfile
import io
import shutil
import subprocess
import re
from lxml import etree
from app.core.config import get_settings
from app.integrations.pph.client import PPHClient
from app.database import SessionLocal
from app.models import ChapterInfo
from app.domains.projects.models import Project
from app.services.file_service import UPLOAD_DIR

class XMLEngine:
    def process_document(self, file_path: str) -> list[str]:
        """
        Runs the Word2XML conversion on the given document.
        Returns the generated XML and log file paths.
        Offloads to PPH Server if PPH_ENABLED is configured.
        """
        settings = get_settings()
        folder = os.path.dirname(file_path)
        chapter_folder = os.path.dirname(folder)
        xml_folder = os.path.join(chapter_folder, "XML")
        base_name = os.path.splitext(os.path.basename(file_path))[0]
        
        expected_xml_path = os.path.join(xml_folder, f"{base_name}.xml")
        expected_log_path = os.path.join(xml_folder, f"{base_name}.log")

        if settings.PPH_ENABLED:
            client = PPHClient()
            with open(file_path, "rb") as f:
                files = {
                    "files": (
                        os.path.basename(file_path),
                        f.read(),
                        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                    )
                }
            
            zip_bytes = client.submit_and_wait(
                endpoint="/word-to-xml",
                files=files
            )
            
            os.makedirs(xml_folder, exist_ok=True)
            generated_files = []
            
            with zipfile.ZipFile(io.BytesIO(zip_bytes)) as z:
                # Find XML file in zip and save it to expected_xml_path
                xml_files = [name for name in z.namelist() if name.endswith(".xml")]
                log_files = [name for name in z.namelist() if name.endswith(".log")]
                
                if xml_files:
                    with open(expected_xml_path, "wb") as out_f:
                        out_f.write(z.read(xml_files[0]))
                    generated_files.append(expected_xml_path)
                    
                    self._save_layout_html_file(expected_xml_path, file_path, xml_folder, base_name, generated_files)
                    
                    if log_files:
                        with open(expected_log_path, "wb") as out_f:
                            out_f.write(z.read(log_files[0]))
                        generated_files.append(expected_log_path)
                    else:
                        with open(expected_log_path, "w") as out_f:
                            out_f.write("PPH XML conversion succeeded.\n")
                        generated_files.append(expected_log_path)
                    return generated_files
                else:
                    # If not found directly, extract everything and try to find any XML
                    temp_extract_dir = os.path.join(xml_folder, "temp_extract")
                    z.extractall(temp_extract_dir)
                    for root, dirs, files_list in os.walk(temp_extract_dir):
                        for file in files_list:
                            if file.endswith(".xml"):
                                shutil.move(os.path.join(root, file), expected_xml_path)
                                generated_files.append(expected_xml_path)
                            elif file.endswith(".log"):
                                shutil.move(os.path.join(root, file), expected_log_path)
                                generated_files.append(expected_log_path)
                    
                    try:
                        shutil.rmtree(temp_extract_dir)
                    except Exception:
                        pass
                        
                    if not generated_files:
                        raise FileNotFoundError("XML output file not found in PPH response ZIP.")
                        
                    xml_in_gen = any(f.endswith(".xml") for f in generated_files)
                    log_in_gen = any(f.endswith(".log") for f in generated_files)
                    
                    if xml_in_gen:
                        self._save_layout_html_file(expected_xml_path, file_path, xml_folder, base_name, generated_files)
                        
                    if xml_in_gen and not log_in_gen:
                        with open(expected_log_path, "w") as out_f:
                            out_f.write("PPH XML conversion succeeded (after search).\n")
                        generated_files.append(expected_log_path)
                    return generated_files

        # Local fallback using perl
        legacy_dir = os.path.join(os.path.dirname(__file__), 'legacy')
        wordtoxml_dir = os.path.join(legacy_dir, 'wordtoxml')
        perl_script = os.path.join(wordtoxml_dir, 'Word2XML_Books.pl')
        
        if not os.path.exists(perl_script):
            raise FileNotFoundError(f"Perl script not found at {perl_script}")
            
        try:
            result = subprocess.run(
                ["perl", perl_script, folder],
                cwd=wordtoxml_dir,
                capture_output=True,
                text=True,
                check=True
            )
        except subprocess.CalledProcessError as e:
            print(f"Word2XML Error Output: {e.stderr}\nStdout: {e.stdout}")
            raise RuntimeError(f"XML conversion failed: {e.stderr}")
            
        src_xml_path = os.path.join(folder, "html", f"{base_name}.xml")
        src_log_path = os.path.join(folder, "html", f"{base_name}.log")
        
        os.makedirs(xml_folder, exist_ok=True)
        generated_files = []
        
        if os.path.exists(src_xml_path):
            shutil.move(src_xml_path, expected_xml_path)
            generated_files.append(expected_xml_path)
            self._save_layout_html_file(expected_xml_path, file_path, xml_folder, base_name, generated_files)
        else:
            raise FileNotFoundError(f"Expected XML output not found: {src_xml_path}\nStdout: {result.stdout}")
            
        if os.path.exists(src_log_path):
            shutil.move(src_log_path, expected_log_path)
            generated_files.append(expected_log_path)
        else:
            with open(expected_log_path, "w") as f:
                f.write("Local validation log could not be generated by DTDvalidate.")
            generated_files.append(expected_log_path)
            
        # Clean up temporary html folder
        html_dir = os.path.join(folder, "html")
        if os.path.exists(html_dir):
            try:
                shutil.rmtree(html_dir)
            except Exception as e:
                print(f"Error cleaning up temporary html folder: {e}")
                
        return generated_files

    def _save_layout_html_file(self, expected_xml_path: str, file_path: str, xml_folder: str, base_name: str, generated_files: list):
        try:
            folder = os.path.dirname(file_path)
            chapter_folder = os.path.basename(os.path.dirname(folder))
            project_code = os.path.basename(os.path.dirname(os.path.dirname(folder)))
            
            db_local = SessionLocal()
            try:
                project_rec = db_local.query(Project).filter(Project.code == project_code).first()
                chapter_rec = db_local.query(ChapterInfo).filter(
                    ChapterInfo.project == project_code,
                    ChapterInfo.chapters == chapter_folder
                ).first()
                
                if project_rec and chapter_rec:
                    html_content = self.generate_layout_html(db_local, expected_xml_path, project_rec, chapter_rec)
                    expected_html_path = os.path.join(xml_folder, f"{base_name}_layout.html")
                    with open(expected_html_path, "w", encoding="utf-8") as out_html:
                        out_html.write(html_content)
                    generated_files.append(expected_html_path)
            finally:
                db_local.close()
        except Exception as layout_err:
            print(f"Failed to generate layout HTML file: {layout_err}")

    @staticmethod
    def generate_layout_html(db, xml_file_path: str, project, chapter) -> str:
        """
        Transforms the given XML file into Layout HTML using style.xsl,
        injects layout CSS styling and hides query comment blocks.
        """
        with open(xml_file_path, "rb") as f:
            xml_content = f.read()
            
        legacy_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "legacy"))
        wordtoxml_dir = os.path.join(legacy_dir, "wordtoxml")
        xsl_path = os.path.join(wordtoxml_dir, "style.xsl")
        css_path = os.path.join(wordtoxml_dir, "style.css")
        
        if not os.path.exists(xsl_path):
            raise FileNotFoundError("XSLT style.xsl not found in server legacy directory")
            
        # Parse XML and transform
        if b"aid:" in xml_content and b"xmlns:aid=" not in xml_content:
            xml_content = re.sub(
                rb'(<[A-Za-z0-9_-]+)',
                rb'\1 xmlns:aid="http://ns.adobe.com/AdobeInDesign/4.0/"',
                xml_content,
                count=1
            )

        parser = etree.XMLParser(recover=True)
        xml_tree = etree.fromstring(xml_content, parser=parser)
        xsl_tree = etree.parse(xsl_path)
        transform = etree.XSLT(xsl_tree)
        result_tree = transform(xml_tree)
        html_str = etree.tostring(result_tree, encoding="utf-8", method="html").decode("utf-8")
        
        # 1. Ignore/Hide query comment blocks <!--<query>--> ... <!--/query>-->
        html_str = re.sub(r'<!--\s*<query>\s*-->.*?<!--\s*/query\s*-->', '', html_str, flags=re.DOTALL)
        
        # 2. Inject CSS stylesheets
        css_style_tag = ""
        if os.path.exists(css_path):
            try:
                with open(css_path, "r", encoding="utf-8") as css_f:
                    css_content = css_f.read()
                
                # Check current chapter first
                design_css_path = os.path.join(UPLOAD_DIR, project.code, chapter.chapters, "Misc", "layout_design.css")
                if not os.path.exists(design_css_path):
                    # Fallback: look for the Design template chapter in the same project
                    design_chapter = db.query(ChapterInfo).filter(
                        ChapterInfo.project == project.code,
                        ChapterInfo.chapters.ilike("Design%")
                    ).first()
                    if design_chapter:
                        design_css_path = os.path.join(UPLOAD_DIR, project.code, design_chapter.chapters, "Misc", "layout_design.css")
                
                if os.path.exists(design_css_path):
                    with open(design_css_path, "r", encoding="utf-8") as design_css_f:
                        design_css_content = design_css_f.read()
                    css_content += f"\n\n/* Custom Design Layout Styles */\n{design_css_content}"
                
                css_style_tag = f"<style>\n{css_content}\n</style>"
            except Exception:
                pass
                
        if css_style_tag:
            html_str = html_str.replace('<link rel="stylesheet" type="text/css" href="style.css">', "")
            html_str = html_str.replace('<link rel="stylesheet" type="text/css" href="style.css"/>', "")
            if "</head>" in html_str:
                html_str = html_str.replace("</head>", f"{css_style_tag}\n</head>")
            else:
                html_str = f"<html><head>{css_style_tag}</head><body>{html_str}</body></html>"
                
        # 3. Resolve and rewrite image paths to route to actual Art/Links download endpoints
        try:
            from bs4 import BeautifulSoup
            soup = BeautifulSoup(html_str, "html.parser")
            
            # Scan potential art/links directories for the chapter
            art_files = {}
            for sub_dir in ["Art", "Links"]:
                art_dir = os.path.join(UPLOAD_DIR, project.code, chapter.chapters, sub_dir)
                if os.path.exists(art_dir):
                    for f_name in os.listdir(art_dir):
                        art_files[f_name.lower()] = os.path.join(sub_dir, f_name)
            
            for img in soup.find_all("img"):
                src = img.get("src", "")
                if src:
                    base_src = os.path.basename(src).lower()
                    if base_src in art_files:
                        img["src"] = f"/api/uploads/{project.id}/chapter/{chapter.chapters}/{art_files[base_src]}"
            
            html_str = str(soup)
        except Exception:
            pass
            
        return html_str

