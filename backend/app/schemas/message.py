from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime


class MessageResponse(BaseModel):
    id: str
    user_id: int
    group_id: int
    whatsapp_group_id: str
    group_name: str
    sender_id: Optional[str]
    sender_name: str
    sender_phone: Optional[str]
    content: str
    message_type: str
    timestamp: datetime
    created_at: datetime

    class Config:
        from_attributes = True


class MessageList(BaseModel):
    messages: List[MessageResponse]
    total: int
    limit: int
    offset: int


class MessageSearch(BaseModel):
    query: str
    group_id: Optional[int] = None
    limit: int = 50
    offset: int = 0
