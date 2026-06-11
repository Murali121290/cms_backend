from sqlalchemy import BigInteger, Boolean, Column, DateTime, ForeignKey, String, Text
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.database import Base


class Client(Base):
    __tablename__ = "clients"

    id                = Column(BigInteger, primary_key=True, autoincrement=True)
    category_type     = Column(String(20),  nullable=False)                  # "person" or "organization"
    contact_type      = Column(String(100), nullable=False)                  # Customer, Vendor, etc.
    first_name        = Column(String(150), nullable=True)                   # person only
    surname           = Column(String(150), nullable=True)                   # person only
    name_company      = Column(String(255), nullable=True)                   # organization only
    company           = Column(String(255), nullable=False)                   # client name
    division          = Column(String(150), nullable=False)                   # client code / division
    designation       = Column(String(150), nullable=True)                   # job title
    department        = Column(String(150), nullable=True)
    email             = Column(String(255), nullable=False)
    website           = Column(String(255), nullable=True)
    vendor_number     = Column(String(100), nullable=True)
    address1          = Column(Text,        nullable=True)
    address2          = Column(Text,        nullable=True)
    city              = Column(String(120), nullable=True)
    state             = Column(String(120), nullable=True)
    country           = Column(String(120), nullable=True)
    zip_code          = Column(String(20),  nullable=True)
    sub_specialisation = Column(String(255), nullable=True)
    working_hours     = Column(String(100), nullable=True)
    contact_hours     = Column(String(100), nullable=True)
    phone_main        = Column(String(50),  nullable=True)
    phone_additional  = Column(String(50),  nullable=True)
    active_status     = Column(Boolean,     nullable=False, default=True)
    created_by        = Column(BigInteger,  ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at        = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at        = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())

    projects = relationship("Project", back_populates="client", cascade="all, delete-orphan")
