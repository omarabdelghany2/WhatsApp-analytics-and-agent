from sqlalchemy import Column, Integer, String, DateTime, Date, ForeignKey, Index
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.database import Base


class Event(Base):
    __tablename__ = "events"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    group_id = Column(Integer, ForeignKey("monitored_groups.id", ondelete="CASCADE"), nullable=False, index=True)
    whatsapp_group_id = Column(String(100), nullable=False)
    group_name = Column(String(255), nullable=False)
    member_id = Column(String(100), nullable=False)
    member_name = Column(String(255), nullable=False)
    member_phone = Column(String(50), nullable=True)
    event_type = Column(String(50), nullable=False)  # JOIN, LEAVE
    event_date = Column(Date, nullable=False, index=True)  # For filtering by date
    timestamp = Column(DateTime(timezone=True), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # Indexes for fast filtering
    __table_args__ = (
        Index('idx_events_type_date', 'event_type', 'event_date'),
        Index('idx_events_user_group', 'user_id', 'group_id'),
    )

    # Relationships
    user = relationship("User", back_populates="events")
    group = relationship("MonitoredGroup", back_populates="events")
