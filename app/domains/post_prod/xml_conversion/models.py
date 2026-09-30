from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, JSON
from sqlalchemy.orm import relationship
from datetime import datetime

from app.database import Base

class PostProdXMLConversionProject(Base):
    __tablename__ = "post_prod_xmlConversion_projects"

    id = Column(Integer, primary_key=True, index=True)
    client_code = Column(String, index=True, nullable=False)
    project_name = Column(String, index=True, unique=True, nullable=False)
    status = Column(String, default="Active")
    assignee = Column(String, nullable=True)
    target_format = Column(String, nullable=True) # e.g., JATS, BITS
    filename = Column(String, nullable=False)
    filepath = Column(String, nullable=False)
    conversion_status = Column(String, default="YTS") # Overall status
    s4c_xml_status = Column(String, default="YTS")
    final_xml_status = Column(String, default="YTS")
    qc_status = Column(String, default="YTS")
    result_filepath = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    history = relationship("PostProdXMLConversionHistory", back_populates="project", cascade="all, delete-orphan")


class PostProdXMLConversionHistory(Base):
    __tablename__ = "post_prod_xmlConversion_history"

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("post_prod_xmlConversion_projects.id"), nullable=False)
    action = Column(String, nullable=False) # e.g., 'Assignee Changed', 'Processing Started'
    details = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    project = relationship("PostProdXMLConversionProject", back_populates="history")
