from datetime import datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import relationship
from sqlalchemy.types import JSON, TypeDecorator

from app.database import Base


class _DialectJSONB(TypeDecorator):
    impl = JSON
    cache_ok = True

    def load_dialect_impl(self, dialect):
        if dialect.name == "postgresql":
            from sqlalchemy.dialects.postgresql import JSONB
            return dialect.type_descriptor(JSONB)
        return dialect.type_descriptor(JSON)


class EpubBook(Base):
    __tablename__ = "epub_validator_books"

    id = Column(Integer, primary_key=True, autoincrement=True)
    folder_name = Column(String(255), unique=True, nullable=False, index=True)
    title = Column(String(500), nullable=True)
    customer = Column(String(255), nullable=True)
    epub_path = Column(Text, nullable=False)
    total_files = Column(Integer, nullable=False, default=0)
    # uploaded → validating → validated | failed
    status = Column(String(50), nullable=False, default="uploaded")
    # pass | fail | mixed | null
    validation_status = Column(String(50), nullable=True)
    uploaded_by_id = Column(BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    uploaded_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)
    is_deleted = Column(Boolean, nullable=False, default=False)

    uploaded_by = relationship("User", foreign_keys=[uploaded_by_id])
    events = relationship(
        "EpubBookEvent",
        back_populates="book",
        cascade="all, delete-orphan",
        order_by="EpubBookEvent.created_at.desc()",
    )


class EpubBookEvent(Base):
    __tablename__ = "epub_validator_book_events"

    id = Column(Integer, primary_key=True, autoincrement=True)
    book_id = Column(
        Integer,
        ForeignKey("epub_validator_books.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id = Column(BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    # upload | validate | edit | delete
    action = Column(String(50), nullable=False, index=True)
    # Structured diff: {"field": {"old": ..., "new": ...}, ...} or free-form summary.
    changes = Column(_DialectJSONB, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow, index=True)

    book = relationship("EpubBook", back_populates="events")
    user = relationship("User", foreign_keys=[user_id])
