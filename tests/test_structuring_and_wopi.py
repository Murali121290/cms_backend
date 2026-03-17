from pathlib import Path


def test_structuring_review_renders_error_template_when_processed_file_missing(
    auth_cookie_client,
    admin_user,
    file_record,
):
    client = auth_cookie_client(admin_user)

    response = client.get(f"/api/v1/files/{file_record.id}/structuring/review")

    assert response.status_code == 200
    assert "Processed file not found. Please run Structuring process first." in response.text


def test_structuring_review_loads_shell_when_processed_file_exists(
    monkeypatch,
    auth_cookie_client,
    admin_user,
    file_record_factory,
):
    monkeypatch.setattr("app.routers.structuring.extract_document_structure", lambda _path: [])

    class FakeRulesLoader:
        def get_paragraphs(self):
            return [{"style": "H1"}]

    monkeypatch.setattr("app.routers.structuring.get_rules_loader", lambda: FakeRulesLoader())

    original_file, _processed_file = file_record_factory(create_processed=True)
    client = auth_cookie_client(admin_user)

    response = client.get(f"/api/v1/files/{original_file.id}/structuring/review")

    assert response.status_code == 200
    assert "_Processed.docx" in response.text
    assert 'id="collaboraFrame"' in response.text
    assert "browser/dist/cool.html" in response.text
    assert "WOPISrc=" in response.text


def test_structuring_save_returns_success_and_targets_processed_document(
    monkeypatch,
    auth_cookie_client,
    admin_user,
    file_record_factory,
):
    original_file, _processed_file = file_record_factory(create_processed=True)
    calls = {}

    def _fake_update(source_path, output_path, modifications):
        calls["source_path"] = source_path
        calls["output_path"] = output_path
        calls["modifications"] = modifications
        return True

    monkeypatch.setattr("app.processing.structuring_lib.doc_utils.update_document_structure", _fake_update)

    client = auth_cookie_client(admin_user)
    response = client.post(
        f"/api/v1/files/{original_file.id}/structuring/save",
        json={"changes": {"node-1": "H1"}},
    )

    assert response.status_code == 200
    assert response.json() == {"status": "success"}
    assert calls["source_path"].endswith("_Processed.docx")
    assert calls["output_path"].endswith("_Processed.docx")
    assert calls["modifications"] == {"node-1": "H1"}


def test_structuring_export_downloads_processed_docx_with_expected_filename(
    auth_cookie_client,
    admin_user,
    file_record_factory,
):
    original_file, processed_file = file_record_factory(create_processed=True)
    client = auth_cookie_client(admin_user)

    response = client.get(f"/api/v1/files/{original_file.id}/structuring/review/export")

    assert response.status_code == 200
    assert processed_file.filename in response.headers.get("content-disposition", "")
    assert response.headers["content-type"].startswith(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    )


def test_editor_shell_requires_auth_and_wopi_original_roundtrip(
    client_factory,
    auth_cookie_client,
    admin_user,
    file_record,
):
    anonymous_client = client_factory()
    redirect_response = anonymous_client.get(f"/files/{file_record.id}/edit", follow_redirects=False)
    assert redirect_response.status_code in {302, 307}
    assert redirect_response.headers["location"] == "/login"

    client = auth_cookie_client(admin_user)
    shell_response = client.get(f"/files/{file_record.id}/edit")
    assert shell_response.status_code == 200
    assert file_record.filename in shell_response.text
    assert 'id="collaboraFrame"' in shell_response.text
    assert "browser/dist/cool.html" in shell_response.text
    assert "WOPISrc=" in shell_response.text

    info_response = client.get(f"/wopi/files/{file_record.id}")
    assert info_response.status_code == 200
    info_payload = info_response.json()
    assert info_payload["BaseFileName"] == file_record.filename
    assert info_payload["UserCanWrite"] is True

    file_response = client.get(f"/wopi/files/{file_record.id}/contents")
    assert file_response.status_code == 200
    original_bytes = Path(file_record.path).read_bytes()
    assert file_response.content == original_bytes

    put_response = client.post(f"/wopi/files/{file_record.id}/contents", content=b"updated-original")
    assert put_response.status_code == 200
    assert Path(file_record.path).read_bytes() == b"updated-original"

    noop_response = client.post(f"/wopi/files/{file_record.id}/contents", content=b"")
    assert noop_response.status_code == 200
    assert Path(file_record.path).read_bytes() == b"updated-original"


def test_wopi_structuring_routes_target_processed_file(
    auth_cookie_client,
    admin_user,
    file_record_factory,
):
    original_file, processed_file = file_record_factory(create_processed=True)
    client = auth_cookie_client(admin_user)

    info_response = client.get(f"/wopi/files/{original_file.id}/structuring")
    assert info_response.status_code == 200
    assert info_response.json()["BaseFileName"] == processed_file.filename

    get_response = client.get(f"/wopi/files/{original_file.id}/structuring/contents")
    assert get_response.status_code == 200
    assert get_response.content == Path(processed_file.path).read_bytes()

    put_response = client.post(
        f"/wopi/files/{original_file.id}/structuring/contents",
        content=b"updated-processed",
    )
    assert put_response.status_code == 200
    assert Path(processed_file.path).read_bytes() == b"updated-processed"
