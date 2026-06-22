from sqlalchemy import Column, String, DateTime, Boolean, BigInteger, Text, func
from sqlalchemy.orm import synonym
from sqlalchemy.types import TypeDecorator, JSON
from app.database import Base

class DialectJSONB(TypeDecorator):
    impl = JSON
    cache_ok = True

    def load_dialect_impl(self, dialect):
        if dialect.name == "postgresql":
            from sqlalchemy.dialects.postgresql import JSONB
            return dialect.type_descriptor(JSONB)
        return dialect.type_descriptor(JSON)

class CompatibilityRoleItem:
    def __init__(self, name: str, role_id: int = 1):
        self.name = name
        self.id = role_id

    def __repr__(self):
        return f"<CompatibilityRoleItem name={self.name}>"

    def __eq__(self, other):
        if isinstance(other, str):
            return self.name.lower() == other.lower()
        if isinstance(other, CompatibilityRoleItem):
            return self.name.lower() == other.name.lower()
        return False

class CompatibilityRolesList(list):
    def __contains__(self, item):
        if isinstance(item, str):
            return any(r.name.lower() == item.lower() for r in self)
        return super().__contains__(item)

ROLE_MAP = {
    "admin": "Admin",
    "viewer": "Viewer",
    "manager": "ProjectManager",
    "copyeditor": "CopyEditor",
    "technical_copyeditor": "TechnicalCopyEditor",
    "typesetter": "Typesetter",
    "pereditor": "PreEditor",
    "qa_reviewer": "QAReviewer",
    "operations_manager": "OperationsManager",
    "finance_analyst": "FinanceAnalyst",
    "support": "Support",
    "developer": "Developer",
    "analyst": "Analyst",
    "designer": "Designer"
}

def map_role_to_capitalized(role_name: str) -> str:
    if not role_name:
        return "Viewer"
    return ROLE_MAP.get(role_name.lower(), role_name.capitalize())

class User(Base):
    __tablename__ = "users"
    id              = Column(BigInteger, primary_key=True, autoincrement=True)
    username        = Column(String(150),  unique=True, nullable=False, index=True)
    email           = Column(String(255),  unique=True, nullable=False, index=True)
    password_hash   = Column(Text,         nullable=False)
    role            = Column(String(50),   nullable=False)
    team            = Column(String(50),   nullable=False)
    customer_access = Column(DialectJSONB,  nullable=False, default=list)
    active_status   = Column(Boolean,      nullable=False, default=True)
    created_at      = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at      = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())

    is_active       = synonym("active_status")

    @property
    def roles(self):
        if not self.role:
            return CompatibilityRolesList()
        cap_role = map_role_to_capitalized(self.role)
        role_id = 1
        if self.role.lower() == "admin":
            role_id = 4
        elif self.role.lower() == "viewer":
            role_id = 1
        elif self.role.lower() == "manager":
            role_id = 3
        return CompatibilityRolesList([CompatibilityRoleItem(cap_role, role_id)])
