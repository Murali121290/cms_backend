from pathlib import Path


def test_api_v2_structuring_review_requires_cookie_auth(client, file_record):
    response = client.get(f"/api/v2/files/{file_record.id}/structuring-review")

    assert response.status_code == 401
    assert response.json() == {
        "status": "error",
        "code": "AUTH_REQUIRED",
        "message": "Not authenticated",
        "field_errors": None,
        "details": None,
    }


def test_api_v2_structuring_review_returns_stable_metadata_and_shell_support(
    monkeypatch,
    auth_cookie_client,
    admin_user,
    file_record_factory,
):
    monkeypatch.setattr("app.routers.api_v2.extract_document_structure", lambda _path: [])

    class FakeRulesLoader:
        def get_paragraphs(self):
            return [{"style": "H1"}]

    monkeypatch.setattr("app.routers.api_v2.get_rules_loader", lambda: FakeRulesLoader())

    original_file, processed_file = file_record_factory(create_processed=True)
    client = auth_cookie_client(admin_user)

    response = client.get(f"/api/v2/files/{original_file.id}/structuring-review")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["viewer"]["username"] == admin_user.username
    assert body["file"]["id"] == original_file.id
    assert body["file"]["filename"] == original_file.filename
    assert body["processed_file"] == {
        "filename": processed_file.filename,
        "exists": True,
    }
    assert body["editor"]["mode"] == "structuring"
    assert body["editor"]["wopi_mode"] == "structuring"
    assert body["editor"]["save_mode"] == "wopi_autosave"
    assert "browser/dist/cool.html" in body["editor"]["collabora_url"]
    assert "WOPISrc=" in body["editor"]["collabora_url"]
    assert body["actions"] == {
        "save_endpoint": f"/api/v2/files/{original_file.id}/structuring-review/save",
        "export_href": f"/api/v2/files/{original_file.id}/structuring-review/export",
        "return_href": (
            f"/projects/{original_file.project_id}/chapter/{original_file.chapter_id}?tab=Manuscript"
        ),
        "return_mode": "route",
    }
    assert "H1" in body["styles"]
    assert "Normal" in body["styles"]
    assert "Body Text" in body["styles"]


def test_api_v2_structuring_review_maps_missing_processed_file_to_stable_error(
    auth_cookie_client,
    admin_user,
    file_record,
):
    client = auth_cookie_client(admin_user)

    response = client.get(f"/api/v2/files/{file_record.id}/structuring-review")

    assert response.status_code == 404
    assert response.json() == {
        "status": "error",
        "code": "PROCESSED_FILE_MISSING",
        "message": "Processed file not found. Please run Structuring process first.",
        "field_errors": None,
        "details": None,
    }


def test_api_v2_structuring_save_returns_normalized_contract_and_targets_processed_file(
    monkeypatch,
    auth_cookie_client,
    admin_user,
    file_record_factory,
):
    original_file, processed_file = file_record_factory(create_processed=True)
    calls = {}

    def _fake_update(source_path, output_path, modifications):
        calls["source_path"] = source_path
        calls["output_path"] = output_path
        calls["modifications"] = modifications
        return True

    monkeypatch.setattr("app.routers.api_v2.update_document_structure", _fake_update)

    client = auth_cookie_client(admin_user)
    response = client.post(
        f"/api/v2/files/{original_file.id}/structuring-review/save",
        json={"changes": {"node-1": "H1", "node-2": "TXT"}},
    )

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "file_id": original_file.id,
        "saved_change_count": 2,
        "target_filename": processed_file.filename,
    }
    assert calls["source_path"].endswith("_Processed.docx")
    assert calls["output_path"].endswith("_Processed.docx")
    assert calls["modifications"] == {"node-1": "H1", "node-2": "TXT"}


def test_api_v2_structuring_export_downloads_processed_docx_with_expected_filename(
    auth_cookie_client,
    admin_user,
    file_record_factory,
):
    original_file, processed_file = file_record_factory(create_processed=True)
    client = auth_cookie_client(admin_user)

    response = client.get(f"/api/v2/files/{original_file.id}/structuring-review/export")

    assert response.status_code == 200
    assert processed_file.filename in response.headers.get("content-disposition", "")
    assert response.headers["content-type"].startswith(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    )
    assert response.content == Path(processed_file.path).read_bytes()
