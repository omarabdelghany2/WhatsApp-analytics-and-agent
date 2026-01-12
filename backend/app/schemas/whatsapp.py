from pydantic import BaseModel
from typing import Optional
from datetime import datetime


class WhatsAppStatus(BaseModel):
    status: str  # not_initialized, initializing, qr_ready, authenticated, ready, disconnected
    is_authenticated: bool
    phone_number: Optional[str] = None
    has_qr: bool = False


class QRCodeResponse(BaseModel):
    qr: Optional[str] = None
    status: str
    has_qr: bool


class InitResponse(BaseModel):
    success: bool
    status: str
    message: Optional[str] = None


class WhatsAppSessionResponse(BaseModel):
    id: int
    user_id: int
    session_id: str
    phone_number: Optional[str]
    auth_status: str
    is_authenticated: bool
    last_connected_at: Optional[datetime]

    class Config:
        from_attributes = True
