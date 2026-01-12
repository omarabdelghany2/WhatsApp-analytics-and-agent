from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime


class GroupCreate(BaseModel):
    whatsapp_group_id: str
    group_name: str
    member_count: int = 0


class GroupResponse(BaseModel):
    id: int
    user_id: int
    whatsapp_group_id: str
    group_name: str
    member_count: int
    is_active: bool
    added_at: datetime

    class Config:
        from_attributes = True


class AvailableGroup(BaseModel):
    id: str  # WhatsApp group ID
    name: str
    participant_count: int


class AvailableGroupsResponse(BaseModel):
    success: bool
    groups: List[AvailableGroup]
