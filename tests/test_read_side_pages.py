from app import models


def test_dashboard_renders_current_template_context_and_stats(
    auth_cookie_client,
    admin_user,
    project_factory,
):
    project_factory(code="BOOK100", title="Alpha Project")
    project_factory(code="BOOK200", title="Beta Project")
    client = auth_cookie_client(admin_user)

    response = client.get("/dashboard")

    assert response.status_code == 200
    assert response.template.name == "dashboard.html"
    assert response.context["user"] == {
        "username": admin_user.username,
        "roles": ["Admin"],
        "email": admin_user.email,
        "id": admin_user.id,
    }
    assert sorted(project.title for project in response.context["projects"]) == ["Alpha Project", "Beta Project"]
    assert response.context["dashboard_stats"] == {
        "total_projects": 2,
        "on_time_rate": 94,
        "on_time_trend": "+12%",
        "avg_days": 8.5,
        "avg_days_trend": "-2 days",
        "delayed_count": 0,
        "delayed_trend": "0",
    }


def test_projects_list_renders_current_template_context(
    auth_cookie_client,
    admin_user,
    project_factory,
):
    project_factory(code="BOOK100", title="Alpha Project", client_name="Client A")
    project_factory(code="BOOK200", title="Beta Project", client_name="Client B")
    client = auth_cookie_client(admin_user)

    response = client.get("/projects")

    assert response.status_code == 200
    assert response.template.name == "projects.html"
    assert response.context["user"] == {
        "username": admin_user.username,
        "roles": ["Admin"],
        "id": admin_user.id,
    }
    assert sorted(project.code for project in response.context["projects"]) == ["BOOK100", "BOOK200"]


def test_admin_dashboard_preserves_current_stats_and_non_admin_redirect(
    auth_cookie_client,
    admin_user,
    viewer_user,
    file_record_factory,
):
    file_record_factory(filename="admin_stats.docx")

    admin_client = auth_cookie_client(admin_user)
    viewer_client = auth_cookie_client(viewer_user)

    admin_response = admin_client.get("/admin")

    assert admin_response.status_code == 200
    assert admin_response.template.name == "admin_dashboard.html"
    assert admin_response.context["user"] == {
        "username": admin_user.username,
        "roles": ["Admin"],
        "id": admin_user.id,
    }
    assert admin_response.context["admin_stats"] == {
        "total_users": 2,
        "total_files": 1,
        "total_validations": 0,
        "total_macro": 0,
    }

    viewer_response = viewer_client.get("/admin", follow_redirects=False)

    assert viewer_response.status_code == 302
    assert viewer_response.headers["location"] == "/dashboard"


def test_admin_users_page_preserves_listing_context_and_redirects_anonymous(
    auth_cookie_client,
    admin_user,
    viewer_user,
    client,
):
    admin_client = auth_cookie_client(admin_user)

    response = admin_client.get("/admin/users")

    assert response.status_code == 200
    assert response.template.name == "admin_users.html"
    assert response.context["user"] == {
        "username": admin_user.username,
        "roles": ["Admin"],
        "email": admin_user.email,
        "id": admin_user.id,
    }
    assert response.context["current_user"].id == admin_user.id
    assert sorted(user.username for user in response.context["users"]) == ["admin", "viewer"]
    assert "Admin" in {role.name for role in response.context["all_roles"]}
    assert "Viewer" in {role.name for role in response.context["all_roles"]}

    anonymous_response = client.get("/admin/users", follow_redirects=False)

    assert anonymous_response.status_code == 302
    assert anonymous_response.headers["location"] == "/login"


def test_project_chapters_routes_preserve_template_context_flags_and_alias(
    auth_cookie_client,
    admin_user,
    project_record,
    chapter_record,
    chapter_factory,
    file_record_factory,
    client,
):
    second_chapter = chapter_factory(project=project_record, number="02", title="Chapter 02")
    file_record_factory(project=project_record, chapter=chapter_record, filename="manuscript.docx", category="Manuscript")
    file_record_factory(project=project_record, chapter=second_chapter, filename="art.jpg", category="Art")

    auth_client = auth_cookie_client(admin_user)
    root_response = auth_client.get(f"/projects/{project_record.id}")
    alias_response = auth_client.get(f"/projects/{project_record.id}/chapters")

    for response in [root_response, alias_response]:
        assert response.status_code == 200
        assert response.template.name == "project_chapters.html"
        assert response.context["project"].id == project_record.id
        assert response.context["user"] == {
            "username": admin_user.username,
            "roles": ["Admin"],
            "id": admin_user.id,
        }
        chapters = {chapter.number: chapter for chapter in response.context["chapters"]}
        assert chapters["01"].has_ms is True
        assert chapters["01"].has_art is False
        assert chapters["02"].has_art is True
        assert chapters["02"].has_ms is False

    anonymous_response = client.get(f"/projects/{project_record.id}", follow_redirects=False)

    assert anonymous_response.status_code == 307
    assert anonymous_response.headers["location"] == "/login"


def test_chapter_detail_preserves_context_active_tab_and_anonymous_redirect(
    auth_cookie_client,
    admin_user,
    project_record,
    chapter_record,
    file_record_factory,
    client,
):
    file_record, _ = file_record_factory(
        project=project_record,
        chapter=chapter_record,
        filename="detail.docx",
        category="Manuscript",
    )
    auth_client = auth_cookie_client(admin_user)

    response = auth_client.get(f"/projects/{project_record.id}/chapter/{chapter_record.id}?tab=XML")

    assert response.status_code == 200
    assert response.template.name == "chapter_detail.html"
    assert response.context["project"].id == project_record.id
    assert response.context["chapter"].id == chapter_record.id
    assert response.context["active_tab"] == "XML"
    assert [record.id for record in response.context["files"]] == [file_record.id]
    assert response.context["user"] == {
        "username": admin_user.username,
        "roles": ["Admin"],
        "id": admin_user.id,
    }

    anonymous_response = client.get(
        f"/projects/{project_record.id}/chapter/{chapter_record.id}",
        follow_redirects=False,
    )

    assert anonymous_response.status_code == 307
    assert anonymous_response.headers["location"] == "/login"
