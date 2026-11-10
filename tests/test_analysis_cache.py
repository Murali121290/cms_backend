"""Regression tests for the Language Editing analysis cache layer.

The analyze POST endpoint keys a completed ``LanguageEditJob`` by
``(file_id, content_hash, rules_hash)``. A matching row short-circuits
the engine pass; a non-match triggers a fresh analyze that writes a
new cache row. These tests exercise the hashing helpers directly so
they catch any input that silently misses the hash, independent of the
heavier end-to-end router fixtures.

Covered:
  * ``_sha256_of_file`` detects any byte change
  * ``_sha256_of_rules_input`` is key-order-independent, covers every
    documented analysis input, and bumps on ``CACHE_VERSION``
  * ``_acquire_file_analysis_lock`` is a no-op on SQLite (tests here)
    and does not raise
  * ``_cached_job_response`` returns the agreed response shape
"""
from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.processing.language_editing import engine
from app.routers import language_edit as le_router


# ─── _sha256_of_file ────────────────────────────────────────────────

def test_file_hash_stable_across_reads(tmp_path):
    p = tmp_path / "doc.bin"
    p.write_bytes(b"hello world" * 1000)
    assert le_router._sha256_of_file(str(p)) == le_router._sha256_of_file(str(p))


def test_file_hash_changes_on_byte_edit(tmp_path):
    p = tmp_path / "doc.bin"
    p.write_bytes(b"version one")
    h1 = le_router._sha256_of_file(str(p))
    p.write_bytes(b"version two")
    h2 = le_router._sha256_of_file(str(p))
    assert h1 != h2


def test_file_hash_handles_large_file_in_chunks(tmp_path):
    """Files larger than the 1 MiB chunk still hash correctly."""
    p = tmp_path / "big.bin"
    p.write_bytes(b"a" * (2 * (1 << 20) + 17))  # 2 MiB + a bit
    expected = hashlib.sha256(p.read_bytes()).hexdigest()
    assert le_router._sha256_of_file(str(p)) == expected


# ─── _sha256_of_rules_input ─────────────────────────────────────────

_BASE_CFG = {
    "profile_key": "uk",
    "profile_keys": ["uk", "apa"],
    "dash_profile": "all",
    "audience": "general",
    "min_uses": 2,
    "scope_reset": False,
    "medical_style_profile": "All",
    "document_variant": "en-GB",
    "rules": [{"id": "G1", "enabled": True}],
    "custom_rules": [],
    "rule_overrides": {},
    "variant_to_canonical": {"colour": "color"},
}


def _hash(cfg: dict, term_list_ids=()) -> str:
    return le_router._sha256_of_rules_input(cfg, term_list_ids)


def test_rules_hash_identical_for_identical_inputs():
    assert _hash(_BASE_CFG, {1, 2}) == _hash(_BASE_CFG, {1, 2})


def test_rules_hash_independent_of_profile_keys_order():
    cfg_a = {**_BASE_CFG, "profile_keys": ["uk", "apa"]}
    cfg_b = {**_BASE_CFG, "profile_keys": ["apa", "uk"]}
    assert _hash(cfg_a) == _hash(cfg_b)


def test_rules_hash_independent_of_term_list_iter_order():
    assert _hash(_BASE_CFG, [3, 1, 2]) == _hash(_BASE_CFG, [1, 2, 3])


@pytest.mark.parametrize("field,new_value", [
    ("profile_key", "us"),
    ("profile_keys", ["us", "ama"]),
    ("dash_profile", "chicago_ama_apa"),
    ("audience", "professional"),
    ("min_uses", 3),
    ("scope_reset", True),
    ("medical_style_profile", "US spelling"),
    ("document_variant", "en-US"),
    ("rules", [{"id": "G2", "enabled": True}]),
    ("custom_rules", [{"id": "CUST-01", "pattern": "x"}]),
    ("rule_overrides", {"G1": {"enabled": False}}),
    ("variant_to_canonical", {"flavour": "flavor"}),
])
def test_rules_hash_changes_when_each_field_changes(field, new_value):
    """Twelve micro-tests — one per analysis-affecting field.
    Bumping any one of them must produce a different hash."""
    base = _hash(_BASE_CFG)
    mutated = _hash({**_BASE_CFG, field: new_value})
    assert base != mutated, f"changing {field} did not invalidate the cache"


def test_rules_hash_changes_when_term_list_ids_change():
    assert _hash(_BASE_CFG, {1, 2}) != _hash(_BASE_CFG, {1, 2, 3})
    assert _hash(_BASE_CFG, {1, 2}) != _hash(_BASE_CFG, set())


def test_rules_hash_changes_when_cache_version_bumps(monkeypatch):
    base = _hash(_BASE_CFG)
    monkeypatch.setattr(engine, "CACHE_VERSION", "v999-test")
    bumped = _hash(_BASE_CFG)
    assert base != bumped


def test_rules_hash_handles_missing_fields_as_none():
    """A sparse config (e.g. a newly-created project with defaults) is
    still hashable and does not raise."""
    sparse = {"rules": []}
    assert isinstance(_hash(sparse, []), str)
    assert len(_hash(sparse, [])) == 64


def test_rules_hash_canonical_blob_is_deterministic_json():
    """The hashed blob is sort_keys=True JSON so nested dict ordering
    (e.g. Python version differences) can't accidentally flip the hash."""
    cfg = {
        "profile_keys": ["uk", "apa"],
        "rule_overrides": {"z": {"enabled": True}, "a": {"enabled": False}},
        "rules": [],
    }
    # Same content, different key insertion order:
    reordered = {
        "rules": [],
        "rule_overrides": {"a": {"enabled": False}, "z": {"enabled": True}},
        "profile_keys": ["uk", "apa"],
    }
    assert _hash(cfg) == _hash(reordered)


# ─── _acquire_file_analysis_lock ────────────────────────────────────

def test_advisory_lock_noop_on_sqlite(tmp_path):
    """On SQLite the helper must be a no-op — tests use SQLite and
    pg_advisory_xact_lock would raise OperationalError otherwise."""
    db_path = tmp_path / "test.sqlite3"
    sa_engine = create_engine(f"sqlite:///{db_path.as_posix()}")
    Session = sessionmaker(bind=sa_engine)
    session = Session()
    try:
        # Must not raise. Idempotent — call twice.
        le_router._acquire_file_analysis_lock(session, file_id=42)
        le_router._acquire_file_analysis_lock(session, file_id=42)
    finally:
        session.close()


# ─── _cached_job_response ───────────────────────────────────────────

class _FakeTermList:
    def __init__(self, list_id, list_name):
        self.list_id = list_id
        self.list_name = list_name


class _FakeFile:
    def __init__(self, filename):
        self.filename = filename


def test_cached_job_response_shape(monkeypatch):
    """The cached response shape mirrors the fresh-analyze path with
    an added ``cached: true`` flag."""
    # Minimal fake Session that returns zero findings for the aggregate
    # query so we exercise the dict shaping without a real DB.
    class _FakeQuery:
        def filter(self, *a, **kw): return self
        def group_by(self, *a, **kw): return self
        def all(self): return []

    class _FakeSession:
        def query(self, *_cols): return _FakeQuery()

    class _FakeJob:
        job_id = "20261110000001_abc12345"
        total_findings = 42

    out = le_router._cached_job_response(
        db=_FakeSession(),
        job=_FakeJob(),
        file_record=_FakeFile("manuscript.docx"),
        compiled_term_lists=[_FakeTermList(7, "Project terms")],
        spell_checker=object(),
    )
    assert out["ok"] is True
    assert out["cached"] is True
    assert out["job_id"] == "20261110000001_abc12345"
    assert out["total_findings"] == 42
    assert out["spell_check_available"] is True
    assert out["term_lists_applied"] == [{"id": 7, "name": "Project terms"}]
    assert out["file_name"] == "manuscript.docx"


def test_cached_job_response_marks_spell_check_unavailable_when_none():
    class _FakeQuery:
        def filter(self, *a, **kw): return self
        def group_by(self, *a, **kw): return self
        def all(self): return []

    class _FakeSession:
        def query(self, *_cols): return _FakeQuery()

    class _FakeJob:
        job_id = "j"
        total_findings = 0

    out = le_router._cached_job_response(
        db=_FakeSession(),
        job=_FakeJob(),
        file_record=_FakeFile("x.docx"),
        compiled_term_lists=[],
        spell_checker=None,
    )
    assert out["spell_check_available"] is False
    assert out["term_lists_applied"] == []
