import os
import zipfile
import io
import subprocess
from app.core.config import get_settings
from app.integrations.pph.client import PPHClient

class XMLEngine:
    def process_document(self, file_path: str) -> list[str]:
        """
        Runs the Word2XML conversion on the given document.
        Returns the generated XML file path.
        Offloads to PPH Server if PPH_ENABLED is configured.
        """
        settings = get_settings()
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
            
            folder = os.path.dirname(file_path)
            base_name = os.path.splitext(os.path.basename(file_path))[0]
            expected_xml_path = os.path.join(folder, "html", f"{base_name}.xml")
            os.makedirs(os.path.dirname(expected_xml_path), exist_ok=True)
            
            with zipfile.ZipFile(io.BytesIO(zip_bytes)) as z:
                # Find XML file in zip and save it to expected_xml_path
                xml_files = [name for name in z.namelist() if name.endswith(".xml")]
                if xml_files:
                    with open(expected_xml_path, "wb") as out_f:
                        out_f.write(z.read(xml_files[0]))
                    return [expected_xml_path]
                else:
                    # If not found directly, extract everything and try to find any XML
                    z.extractall(folder)
                    for root, dirs, files_list in os.walk(folder):
                        for file in files_list:
                            if file.endswith(".xml"):
                                return [os.path.join(root, file)]
                    raise FileNotFoundError("XML output file not found in PPH response ZIP.")

        # Local fallback using perl
        folder = os.path.dirname(file_path)
        base_name = os.path.splitext(os.path.basename(file_path))[0]
        
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
            
        expected_xml_path = os.path.join(folder, "html", f"{base_name}.xml")
        if os.path.exists(expected_xml_path):
            return [expected_xml_path]
        else:
            raise FileNotFoundError(f"Expected XML output not found: {expected_xml_path}\nStdout: {result.stdout}")
