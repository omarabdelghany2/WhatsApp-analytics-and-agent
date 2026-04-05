from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey, Index
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.database import Base


class Message(Base):
    __tablename__ = "messages"

    id = Column(String(100), primary_key=True)  # WhatsApp message ID
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    group_id = Column(Integer, ForeignKey("monitored_groups.id", ondelete="CASCADE"), nullable=False, index=True)
    whatsapp_group_id = Column(String(100), nullable=False)
    group_name = Column(String(255), nullable=False)
    sender_id = Column(String(100), nullable=True)
    sender_name = Column(String(255), nullable=False)
    sender_phone = Column(String(50), nullable=True)
    content = Column(Text, nullable=False)
    message_type = Column(String(50), default="text")  # text, image, video, audio, document
    timestamp = Column(DateTime(timezone=True), nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # Compound indexes for stats queries
    __table_args__ = (
        Index('idx_messages_user_timestamp', 'user_id', 'timestamp'),
        Index('idx_messages_user_group_timestamp', 'user_id', 'group_id', 'timestamp'),
    )

    # Relationships
    user = relationship("User", back_populates="messages")
    group = relationship("MonitoredGroup", back_populates="messages")
