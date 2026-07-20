from typing import TypeVar, Generic, Optional
from pydantic import BaseModel

T = TypeVar("T")


class PaginationParams(BaseModel):
    skip: int = 0
    limit: int = 50
    search: Optional[str] = None


class PaginatedResponse(BaseModel, Generic[T]):
    items: list[T]
    total: int
    skip: int
    limit: int
    has_more: bool


def paginate_query(query, skip: int = 0, limit: int = 50):
    total = query.count()
    items = query.offset(skip).limit(limit).all()
    return {
        "items": items,
        "total": total,
        "skip": skip,
        "limit": limit,
        "has_more": (skip + limit) < total,
    }
