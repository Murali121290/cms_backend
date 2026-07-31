"""EPUB Validator v2 engine.

Loads rule metadata from split JSON files, dispatches to functions registered
via @rule(...), and returns a report that mirrors the legacy validate_service
response shape during migration.
"""
