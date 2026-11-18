"""Regression tests for the ``client_name`` field on Term Library rows.

The Term Library card at ``/settings/term-lists`` used to show a plain
``Client`` badge on every client-scoped list. The frontend now reads
``list.client_name`` from the API response and renders the actual
client's name (``Client.company`` on the backend) instead; this file
locks the server contract that supplies that string.

Covers:
  * client-scoped list exposes the client's ``company`` as
    ``client_name``,
  * generic list has ``client_name = None``,
  * client-scoped list whose ``client_id`` points at a deleted client
    (``ON DELETE SET NULL`` cleared the FK) degrades gracefully to
    ``client_name = None`` — the card then falls back to the generic
    ``Client`` label rather than printing an empty name.

Everything runs inside the per-test SQLite DB from
``conftest.app_env``; existing user data is never touched.
"""
from __future__ import annotations

import pytest

from app.domains.clients.models import Client
from app.domains.term_lists.models import TermList


def _login(client, username: str, password: str = "Password123!") -> None:
    resp = client.post(
        "/api/v2/session/login",
        json={"username": username, "password": password},
    )
    assert resp.status_code == 200, resp.text


def _mk_client(db_session, *, company: str, division: str) -> Client:
    """Minimal Client row satisfying the schema's NOT NULL columns.

    ``company`` is the inline-comment-marked "client name" column the
    serializer surfaces; ``division`` is the "client code" NOT NULL.
    """
    c = Client(
        category_type="organization",
        contact_type="Customer",
        company=company,
        division=division,
        email=f"{division.lower()}@example.com",
    )
    db_session.add(c)
    db_session.commit()
    db_session.refresh(c)
    return c


def test_client_scoped_list_exposes_client_company_as_client_name(
    client, admin_user, db_session,
):
    _login(client, admin_user.username)
    aspen = _mk_client(db_session, company="Aspen Publishing", division="ASPEN")

    tl = TermList(
        name="Aspen Macro",
        scope="client",
        client_id=aspen.id,
        term_count=0,
        is_active=True,
    )
    db_session.add(tl)
    db_session.commit()
    db_session.refresh(tl)

    resp = client.get("/api/v2/term-lists")
    assert resp.status_code == 200, resp.text
    rows = {r["id"]: r for r in resp.json()["items"]}
    row = rows[tl.id]
    assert row["client_id"] == aspen.id
    assert row["client_name"] == "Aspen Publishing"
    assert row["scope"] == "client"


def test_generic_list_has_null_client_name(client, admin_user, db_session):
    _login(client, admin_user.username)
    tl = TermList(
        name="APA Bias-Free",
        scope="generic",
        client_id=None,
        term_count=0,
        is_active=True,
    )
    db_session.add(tl)
    db_session.commit()

    resp = client.get("/api/v2/term-lists")
    assert resp.status_code == 200
    rows = {r["id"]: r for r in resp.json()["items"]}
    row = rows[tl.id]
    assert row["scope"] == "generic"
    assert row["client_id"] is None
    assert row["client_name"] is None, (
        "generic lists must not fabricate a client_name — the card "
        "shows the 'Generic' badge in that branch"
    )


def test_client_scoped_list_with_missing_client_degrades_to_null(
    client, admin_user, db_session,
):
    """When a client row is removed, ``ON DELETE SET NULL`` clears
    ``TermList.client_id``. The serializer must return
    ``client_name = None`` for any row where the relationship fails to
    resolve — the frontend card then falls back to the plain ``Client``
    badge instead of displaying an empty or stale name."""
    _login(client, admin_user.username)
    # Create + delete the client; also null out the FK to mimic
    # ON DELETE SET NULL (SQLite respects the clause when FK enforcement
    # is enabled, which conftest.app_env does via PRAGMA foreign_keys=ON).
    orphan = _mk_client(db_session, company="Deleted House", division="DEAD")
    tl = TermList(
        name="Orphan Terms",
        scope="client",
        client_id=orphan.id,
        term_count=0,
        is_active=True,
    )
    db_session.add(tl)
    db_session.commit()
    db_session.delete(orphan)
    db_session.commit()
    db_session.refresh(tl)

    resp = client.get("/api/v2/term-lists")
    assert resp.status_code == 200
    rows = {r["id"]: r for r in resp.json()["items"]}
    row = rows[tl.id]
    # The FK got set to NULL by the delete cascade.
    assert row["client_id"] is None
    assert row["client_name"] is None
