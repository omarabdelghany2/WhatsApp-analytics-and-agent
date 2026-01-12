from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime, date


class EventResponse(BaseModel):
    id: int
    user_id: int
    group_id: int
    whatsapp_group_id: str
    group_name: str
    member_id: str
    member_name: str
    member_phone: Optional[str]
    event_type: str  # JOIN, LEAVE
    event_date: date
    timestamp: datetime
    created_at: datetime

    class Config:
        from_attributes = True


class EventFilter(BaseModel):
    event_type: Optional[str] = None  # JOIN, LEAVE
    date_from: Optional[date] = None
    date_to: Optional[date] = None
    member_name: Optional[str] = None
    group_id: Optional[int] = None
    limit: int = 50
    offset: int = 0


class EventList(BaseModel):
    events: List[EventResponse]
    total: int
    limit: int
    offset: int


class EventStats(BaseModel):
    total_joins: int
    total_leaves: int
    net_change: int
    period_start: Optional[date]
    period_end: Optional[date]
