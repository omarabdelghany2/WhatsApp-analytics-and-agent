from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, Text, JSON
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.database import Base


class MonitoredGroup(Base):
    __tablename__ = "monitored_groups"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    whatsapp_group_id = Column(String(100), nullable=False)  # WhatsApp's internal ID
    group_name = Column(String(255), nullable=False)
    member_count = Column(Integer, default=0)
    is_active = Column(Boolean, default=True)
    added_at = Column(DateTime(timezone=True), server_default=func.now())

    # Welcome message settings
    welcome_enabled = Column(Boolean, default=False)
    welcome_threshold = Column(Integer, default=1)  # Number of consecutive joins to trigger message
    welcome_join_count = Column(Integer, default=0)  # Current counter
    welcome_pending_joiners = Column(JSON, default=list)  # List of joiner phone numbers waiting

    # Welcome Part 1: Mentions for joiners + text + extra mentions
    welcome_text = Column(Text)  # Custom welcome text
    welcome_extra_mentions = Column(JSON)  # Additional phone numbers to always mention

    # Welcome Part 2 (optional): Text + Image
    welcome_part2_enabled = Column(Boolean, default=False)
    welcome_part2_text = Column(Text)
    welcome_part2_image = Column(String(500))  # Path to uploaded image

    # Unique constraint: user can only monitor each group once
    __table_args__ = (
        {"sqlite_autoincrement": True},
    )

    # Relationships
    user = relationship("User", back_populates="monitored_groups")
    messages = relationship("Message", back_populates="group")
    events = relationship("Event", back_populates="group")
