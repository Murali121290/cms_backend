from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.domains.clients import crud
from app.domains.clients.schemas import ClientCreate, ClientListResponse, ClientResponse, ClientUpdate

router = APIRouter(prefix="/api/v1/clients", tags=["Clients"])


class StatusUpdate(BaseModel):
    active_status: bool


@router.post("/", response_model=ClientListResponse, status_code=status.HTTP_201_CREATED)
def create_client(client: ClientCreate, db: Session = Depends(get_db)):
    return crud.create_client(db, client)


@router.get("/", response_model=List[ClientListResponse])
def list_clients(skip: int = 0, limit: int = 500, db: Session = Depends(get_db)):
    return crud.get_clients(db, skip=skip, limit=limit)


@router.get("/active", response_model=List[ClientListResponse])
def list_active_clients(db: Session = Depends(get_db)):
    return crud.get_active_clients(db)


@router.get("/{client_id}", response_model=ClientResponse)
def get_client(client_id: int, db: Session = Depends(get_db)):
    client = crud.get_client(db, client_id)
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    return client


@router.put("/{client_id}", response_model=ClientListResponse)
def update_client(client_id: int, data: ClientUpdate, db: Session = Depends(get_db)):
    updated = crud.update_client(db, client_id, data)
    if not updated:
        raise HTTPException(status_code=404, detail="Client not found")
    return updated


@router.delete("/{client_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_client(client_id: int, db: Session = Depends(get_db)):
    if not crud.delete_client(db, client_id):
        raise HTTPException(status_code=404, detail="Client not found")


@router.patch("/{client_id}/status", response_model=ClientListResponse)
def set_client_status(client_id: int, body: StatusUpdate, db: Session = Depends(get_db)):
    updated = crud.set_client_active_status(db, client_id, body.active_status)
    if not updated:
        raise HTTPException(status_code=404, detail="Client not found")
    return updated
