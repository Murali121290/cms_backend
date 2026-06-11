from pydantic import BaseModel
from typing import Optional

class UserCreate(BaseModel):
    username: str
    email: str
    password: str

class ProjectCreate(BaseModel):
    team: Optional[str] = "General"
    code: str
    title: str
    xml_standard: str
    client_name: Optional[str] = None
