"""Validator implementations.

Importing this package eagerly imports every rule module so their @rule
registrations are applied. Import order is explicit (not glob) to keep
registration deterministic.
"""

from .general import css, epubcheck, links, metadata, nav, notes, pagination, structure, style, xhtml  # noqa: F401
from . import copyright, cover, filenaming, images, links as cust_links, metadata as cust_meta, nav as cust_nav, pagination as cust_pag  # noqa: F401

