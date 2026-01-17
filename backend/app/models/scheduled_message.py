from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey, JSON, Index, Boolean
from sqlalchemy.orm import relationship
from datetime import datetime

from app.database import Base


class ScheduledMessage(Base):
    __tablename__ = "scheduled_messages"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)

    # Task type: 'broadcast', 'poll', 'open_group', 'close_group'
    task_type = Column(String(20), default='broadcast', nullable=False)

    # Recurring schedule support
    is_recurring = Column(Boolean, default=False)
    recurring_time = Column(String(5))  # "09:00" format for daily recurring
    parent_schedule_id = Column(Integer)  # Links open/close tasks together

    # Message content (optional for group settings tasks)
    content = Column(Text)
    media_path = Column(String(500))  # Path to uploaded media file (for media messages)

    # Poll-specific fields (for task_type='poll')
    poll_options = Column(JSON)  # List of poll option strings
    poll_allow_multiple = Column(Boolean, default=False)  # Allow multiple answers

    group_ids = Column(JSON, nullable=False)  # List of WhatsApp group IDs to send to
    group_names = Column(JSON)  # List of group names for display
    mention_type = Column(String(20), default='none')  # 'none', 'all', 'selected'
    mention_ids = Column(JSON)  # List of phone numbers to mention (for 'selected')
    scheduled_at = Column(DateTime, nullable=False)  # When to send
    status = Column(String(20), default='pending')  # pending, sending, sent, partially_sent, failed, cancelled
    sent_at = Column(DateTime)
    error_message = Column(Text)
    groups_sent = Column(Integer, default=0)  # Number of groups successfully sent to
    groups_failed = Column(Integer, default=0)  # Number of groups that failed
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    user = relationship("User", back_populates="scheduled_messages")

    # Indexes for efficient querying
    __table_args__ = (
        Index('idx_scheduled_status_time', 'status', 'scheduled_at'),
        Index('idx_scheduled_user', 'user_id'),
        Index('idx_scheduled_task_type', 'task_type', 'user_id'),
    )
