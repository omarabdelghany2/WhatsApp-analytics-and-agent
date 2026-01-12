from sqlalchemy import Column, Integer, String, Boolean, DateTime
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(100), unique=True, nullable=False, index=True)
    email = Column(String(255), unique=True, nullable=False, index=True)
    password_hash = Column(String(255), nullable=False)
    is_admin = Column(Boolean, default=False)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # Relationships
    whatsapp_session = relationship("WhatsAppSession", back_populates="user", uselist=False)
    monitored_groups = relationship("MonitoredGroup", back_populates="user")
    messages = relationship("Message", back_populates="user")
    events = relationship("Event", back_populates="user")
    scheduled_messages = relationship("ScheduledMessage", back_populates="user")
    agents = relationship("Agent", back_populates="user")
