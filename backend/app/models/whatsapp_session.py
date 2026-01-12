from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.database import Base


class WhatsAppSession(Base):
    __tablename__ = "whatsapp_sessions"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), unique=True, nullable=False)
    session_id = Column(String(100), unique=True, nullable=False)  # format: "user_{user_id}"
    phone_number = Column(String(20), nullable=True)
    auth_status = Column(String(50), default="not_initialized")
    # Statuses: not_initialized, initializing, qr_ready, authenticating, authenticated, disconnected, failed
    is_authenticated = Column(Boolean, default=False)
    last_connected_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # Relationships
    user = relationship("User", back_populates="whatsapp_session")
