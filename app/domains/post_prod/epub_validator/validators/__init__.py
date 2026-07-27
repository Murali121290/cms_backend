"""Validator implementations.

Importing this package eagerly imports every rule module so their @rule
registrations are applied. Import order is explicit (not glob) to keep
registration deterministic.
"""

from .general import css, links, nav, pagination, style  # noqa: F401
from .customers import aspen  # noqa: F401
