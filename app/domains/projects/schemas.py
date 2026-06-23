from pydantic import BaseModel
from typing import Optional

class ProjectCreate(BaseModel):
    code: str
    title: str
    xml_standard: str
    client_name: Optional[str] = None
