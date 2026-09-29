"""Checks registered ahead of their implementation.

Structuring, references, technical and language are built in Week 2; xml in
Week 3. Until then the runner reports them as not implemented instead of
returning an empty (falsely clean) result.
"""
from app.domains.journals.checks.base import JournalCheck, register


@register
class StructuringCheck(JournalCheck):
    key = "structuring"
    name = "Structuring"
    implemented = False


@register
class ReferencesCheck(JournalCheck):
    key = "references"
    name = "Reference validation"
    implemented = False


@register
class TechnicalCheck(JournalCheck):
    key = "technical"
    name = "Technical editing"
    implemented = False


@register
class LanguageCheck(JournalCheck):
    key = "language"
    name = "Language editing"
    implemented = False


@register
class XmlCheck(JournalCheck):
    key = "xml"
    name = "XML & DTD validation"
    implemented = False
