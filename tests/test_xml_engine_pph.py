import os
import zipfile
import io
import pytest
from unittest.mock import MagicMock, patch
from app.processing.xml_engine import XMLEngine

def test_xml_engine_pph_success(tmp_path, monkeypatch):
    """Test XMLEngine uses PPH server when PPH_ENABLED=True and PPH responds successfully."""
    # Setup test file structure: chapter_folder/Word/sample.docx
    chapter_dir = tmp_path / "project" / "chapter1"
    word_dir = chapter_dir / "Word"
    word_dir.mkdir(parents=True)
    doc_path = word_dir / "sample.docx"
    doc_path.write_bytes(b"dummy docx content")

    # Create dummy ZIP in memory with XML and log
    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, "w") as zf:
        zf.writestr("sample.xml", "<article>PPH Output</article>")
        zf.writestr("sample.log", "PPH Success Log")
    zip_bytes = zip_buffer.getvalue()

    # Mock PPH Settings and Client
    fake_settings = MagicMock()
    fake_settings.PPH_ENABLED = True
    monkeypatch.setattr("app.processing.xml_engine.get_settings", lambda: fake_settings)

    mock_client_cls = MagicMock()
    mock_client_inst = MagicMock()
    mock_client_inst.submit_and_wait.return_value = zip_bytes
    mock_client_cls.return_value = mock_client_inst
    monkeypatch.setattr("app.processing.xml_engine.PPHClient", mock_client_cls)

    # Disable layout HTML generation db query for unit test simplicity
    monkeypatch.setattr(XMLEngine, "_save_layout_html_file", lambda self, *args: None)

    engine = XMLEngine()
    files = engine.process_document(str(doc_path))

    # Assert PPH submit_and_wait was called with /word-to-xml endpoint
    mock_client_inst.submit_and_wait.assert_called_once()
    assert mock_client_inst.submit_and_wait.call_args[1]["endpoint"] == "/word-to-xml"

    # Assert output files exist in XML folder
    xml_folder = chapter_dir / "XML"
    expected_xml = xml_folder / "sample.xml"
    expected_log = xml_folder / "sample.log"
    assert expected_xml.exists()
    assert expected_xml.read_text() == "<article>PPH Output</article>"
    assert expected_log.exists()
    assert expected_log.read_text() == "PPH Success Log"
    assert str(expected_xml) in files

def test_xml_engine_pph_fallback_on_error(tmp_path, monkeypatch):
    """Test XMLEngine falls back to local Perl script when PPH server fails."""
    chapter_dir = tmp_path / "project" / "chapter1"
    word_dir = chapter_dir / "Word"
    word_dir.mkdir(parents=True)
    doc_path = word_dir / "sample.docx"
    doc_path.write_bytes(b"dummy docx content")

    fake_settings = MagicMock()
    fake_settings.PPH_ENABLED = True
    monkeypatch.setattr("app.processing.xml_engine.get_settings", lambda: fake_settings)

    # Mock PPHClient to raise Exception (simulating PPH server down)
    mock_client_cls = MagicMock()
    mock_client_inst = MagicMock()
    mock_client_inst.submit_and_wait.side_effect = Exception("PPH Server Connection Timeout (503 Service Unavailable)")
    mock_client_cls.return_value = mock_client_inst
    monkeypatch.setattr("app.processing.xml_engine.PPHClient", mock_client_cls)

    # Mock Perl script check & subprocess execution for fallback
    original_exists = os.path.exists
    def fake_exists(path):
        if "Word2XML_Books.pl" in str(path):
            return True
        return original_exists(path)

    monkeypatch.setattr("os.path.exists", fake_exists)
    
    perl_called = []
    def fake_subprocess_run(*args, **kwargs):
        perl_called.append(args)
        # Create output in html folder as expected by local Perl script
        html_dir = word_dir / "html"
        html_dir.mkdir(parents=True, exist_ok=True)
        (html_dir / "sample.xml").write_text("<article>Local Perl Output</article>")
        (html_dir / "sample.log").write_text("Local Perl Log")
        res = MagicMock()
        res.stdout = "OK"
        return res

    monkeypatch.setattr("subprocess.run", fake_subprocess_run)
    monkeypatch.setattr(XMLEngine, "_save_layout_html_file", lambda self, *args: None)

    engine = XMLEngine()
    files = engine.process_document(str(doc_path))

    # Assert fallback occurred: PPH failed and local Perl was invoked
    assert len(perl_called) == 1
    expected_xml = chapter_dir / "XML" / "sample.xml"
    assert expected_xml.exists()
    assert expected_xml.read_text() == "<article>Local Perl Output</article>"
