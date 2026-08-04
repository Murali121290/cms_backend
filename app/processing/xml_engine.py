import os
import zipfile
import io
import shutil
import subprocess
from app.core.config import get_settings
from app.integrations.pph.client import PPHClient

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
