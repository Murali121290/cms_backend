"""Validator implementations.

Importing this package eagerly imports every rule module so their @rule
registrations are applied. Import order is explicit (not glob) to keep
registration deterministic.
"""

from . import (  # noqa: F401
    copyright,
    cover,
    css,
    epubcheck,
    filenaming,
    images,
    links,
    metadata,
    nav,
    notes,
    pagination,
    paragraph_merge,
    structure,
    style,
    style_mismatch,
    xhtml,
)


