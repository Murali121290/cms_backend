"""SQLAlchemy models for parsed Art Assessment data.

Persists the output of
``app.domains.post_prod.figure_pdf.assessment_parser.parse_assessment_workbook``.
Shape intentionally mirrors the dataclasses in that module so the mapping is
one-to-one: an :class:`ArtAssessment` row carries the sheet-level metadata, and
each :class:`ArtAssessmentRow` row carries one figure's canonical + unmapped
data plus (later) image-derived enrichment.

The alias registry produces up to ~15 canonical fields; each becomes its own
nullable text column here so the review UI can filter / sort without parsing
JSON. Anything *not* in the alias registry survives in
:attr:`ArtAssessmentRow.extras_json` keyed by the raw client header.

No defaults are applied in this layer: an empty Excel cell becomes ``NULL``.
"""

from __future__ import annotations

from sqlalchemy import (
    Column,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import relationship
from sqlalchemy.types import JSON, TypeDecorator

from app.database import Base


class _DialectJSONB(TypeDecorator):
    """JSONB on PostgreSQL, plain JSON (TEXT) on SQLite / others.

    Kept local to this module so the file has no cross-domain imports. The
    pattern matches ``app.domains.auth.models.DialectJSONB``.
    """

    impl = JSON
    cache_ok = True

    def load_dialect_impl(self, dialect):
        if dialect.name == "postgresql":
            from sqlalchemy.dialects.postgresql import JSONB

            return dialect.type_descriptor(JSONB())
        return dialect.type_descriptor(JSON())


# ---------------------------------------------------------------------------
# Tables
# ---------------------------------------------------------------------------


class ArtAssessment(Base):
    """One parsed-or-generated Art Assessment artefact for a chapter."""

    __tablename__ = "art_assessments"

    id = Column(Integer, primary_key=True)
    project_id = Column(
        Integer,
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    chapter_id = Column(
        Integer,
        ForeignKey("chapter_details.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Link back to the physical files on disk:
    #   source_excel_file_id = the uploaded client workbook (NULL when the
    #       images-only fallback ran).
    #   output_excel_file_id = the regenerated workbook (NULL until the
    #       generator writes it).
    source_excel_file_id = Column(
        Integer,
        ForeignKey("files.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    output_excel_file_id = Column(
        Integer,
        ForeignKey("files.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    # 'excel' (client Excel was the source of truth)
    # or 'images' (fallback, built from image metadata only).
    source_mode = Column(String(length=16), nullable=False)

    data_sheet_name = Column(Text, nullable=True)
    header_row_index = Column(Integer, nullable=True)  # 1-based

    # Parser side-channel data. Kept as structured JSON so the review UI can
    # render the full mapping table without re-parsing the workbook.
    project_info_json = Column(_DialectJSONB, nullable=False, default=dict)
    canonical_columns_json = Column(_DialectJSONB, nullable=False, default=dict)
    unmapped_columns_json = Column(_DialectJSONB, nullable=False, default=list)
    warnings_json = Column(_DialectJSONB, nullable=False, default=list)

    created_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    created_by_id = Column(
        Integer,
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    rows = relationship(
        "ArtAssessmentRow",
        back_populates="assessment",
        cascade="all, delete-orphan",
        order_by="ArtAssessmentRow.row_index",
    )


class ArtAssessmentRow(Base):
    """One figure row from the parsed workbook."""

    __tablename__ = "art_assessment_rows"
    __table_args__ = (
        UniqueConstraint(
            "assessment_id",
            "row_index",
            name="uq_art_assessment_rows_assessment_row_index",
        ),
    )

    id = Column(Integer, primary_key=True)
    assessment_id = Column(
        Integer,
        ForeignKey("art_assessments.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    row_index = Column(Integer, nullable=False)  # 1-based within the data region

    # Canonical fields (see assessment_parser.ALIAS_REGISTRY). Every column is
    # nullable text — the parser never invents a value, so a blank Excel cell
    # stays NULL on the row.
    chapter_label = Column(Text, nullable=True)
    figure_no = Column(Text, nullable=True, index=True)
    art_name = Column(Text, nullable=True)
    source_status = Column(Text, nullable=True)
    output_color = Column(Text, nullable=True)  # verbatim: "4 Color Halftone", "b/w halftone", "RGB", "CMYK", …
    classification = Column(Text, nullable=True)
    editorial_instructions = Column(Text, nullable=True)
    suggested_sizing = Column(Text, nullable=True)
    billing_status = Column(Text, nullable=True)
    complexity = Column(Text, nullable=True)
    queries = Column(Text, nullable=True)
    queries_detail = Column(Text, nullable=True)
    query_replies = Column(Text, nullable=True)
    batch_no = Column(Text, nullable=True)
    remarks = Column(Text, nullable=True)
    status = Column(Text, nullable=True)
    part_no = Column(Text, nullable=True)
    type = Column(Text, nullable=True)

    # Any header the alias registry did not match. Keyed by the raw client
    # header exactly as it appeared. Never null — defaults to empty object.
    extras_json = Column(_DialectJSONB, nullable=False, default=dict)

    # Image-derived enrichment populated in Phase 4. Keys are a stable schema
    # (e.g. ``supplied_file_id``, ``pil_mode``, ``color_space``, ``format``,
    # ``size_bytes``, ``dpi_x``, ``dpi_y``). NULL until enrichment runs.
    image_meta_json = Column(_DialectJSONB, nullable=True)

    # Finalization-Fix F2: distinguishes Excel-sourced rows from synthetic
    # rows appended for images in the Art folder that did not match any
    # Excel row. NULL = row came from the Excel; "unmatched" = synthetic.
    match_status = Column(String(length=32), nullable=True)

    assessment = relationship("ArtAssessment", back_populates="rows")


__all__ = ["ArtAssessment", "ArtAssessmentRow"]
