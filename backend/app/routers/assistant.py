"""FastAPI router for the Local AI Guide & Persistent Curated Memory."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies.auth import get_current_user_from_token
from app.dependencies.permissions import (
    require_user_permission,
    user_has_permission,
)
from app.models import User
from app.services import assistant_service

router = APIRouter(prefix="/assistant", tags=["AI Assistant"])


class AskAssistantRequest(BaseModel):
    question: str = Field(..., min_length=1, max_length=500)
    route: str = Field(default="", max_length=200)
    location_code: str | None = Field(default=None, max_length=100)


class AssistantMemoryCreateRequest(BaseModel):
    memory_key: str | None = Field(default=None, max_length=100)
    title: str = Field(..., min_length=2, max_length=200)
    category: str = Field(default="policy", max_length=50)
    keywords: str = Field(default="", max_length=500)
    body: str = Field(..., min_length=2)
    steps: list[str] | str = Field(default_factory=list)
    route: str = Field(default="", max_length=200)
    location_code: str | None = Field(default=None, max_length=100)
    permission: str = Field(default="", max_length=120)
    is_active: bool = True
    sort_order: int = 120


class AssistantMemoryUpdateRequest(BaseModel):
    title: str | None = Field(default=None, max_length=200)
    category: str | None = Field(default=None, max_length=50)
    keywords: str | None = Field(default=None, max_length=500)
    body: str | None = None
    steps: list[str] | str | None = None
    route: str | None = Field(default=None, max_length=200)
    location_code: str | None = Field(default=None, max_length=100)
    permission: str | None = Field(default=None, max_length=120)
    is_active: bool | None = None
    sort_order: int | None = None


@router.get("/overview")
def assistant_overview(
    route: str = Query(default=""),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_from_token),
):
    require_user_permission(current_user, "View AI Assistant", db)
    return assistant_service.get_assistant_overview(db, current_user, route=route)


@router.post("/ask")
def ask_assistant(
    body: AskAssistantRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_from_token),
):
    require_user_permission(current_user, "View AI Assistant", db)
    return assistant_service.ask_assistant(
        db,
        current_user,
        body.question,
        route=body.route,
        location_code=body.location_code,
    )


@router.get("/history")
def assistant_history(
    limit: int = Query(default=30, ge=1, le=50),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_from_token),
):
    require_user_permission(current_user, "View AI Assistant", db)
    return {"items": assistant_service.get_user_history(db, current_user, limit=limit)}


@router.get("/memory")
def list_assistant_memory(
    include_inactive: bool = Query(default=False),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_from_token),
):
    if not (
        user_has_permission(current_user, "View Assistant Memory", db)
        or user_has_permission(current_user, "View AI Assistant", db)
    ):
        raise HTTPException(status_code=403, detail="Permission required: View Assistant Memory")
    items = assistant_service.list_memory(db, include_inactive=include_inactive)
    return {"items": items}


@router.post("/memory", status_code=201)
def create_assistant_memory(
    body: AssistantMemoryCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_from_token),
):
    require_user_permission(current_user, "Create Assistant Memory", db)
    try:
        return assistant_service.create_memory(db, current_user, body.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.put("/memory/{memory_id}")
def update_assistant_memory(
    memory_id: int,
    body: AssistantMemoryUpdateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_from_token),
):
    require_user_permission(current_user, "Edit Assistant Memory", db)
    try:
        return assistant_service.update_memory(
            db,
            current_user,
            memory_id,
            body.model_dump(exclude_unset=True),
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.delete("/memory/{memory_id}", status_code=204)
def delete_assistant_memory(
    memory_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_from_token),
):
    require_user_permission(current_user, "Delete Assistant Memory", db)
    try:
        assistant_service.delete_memory(db, current_user, memory_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return None
