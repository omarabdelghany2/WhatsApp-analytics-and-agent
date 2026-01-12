from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, Text, JSON
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.database import Base


class Agent(Base):
    __tablename__ = "agents"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)

    # Agent settings
    name = Column(String(100), nullable=False)
    api_url = Column(String(500), nullable=False)
    api_key = Column(String(500), nullable=False)  # Store encrypted in production
    input_token_limit = Column(Integer, default=4096)
    output_token_limit = Column(Integer, default=1024)
    system_prompt = Column(Text)  # Personality/instructions for the agent

    # Status
    is_active = Column(Boolean, default=False)  # Only one agent can be active per user

    # Groups where agent is enabled (JSON array of group IDs)
    enabled_group_ids = Column(JSON, default=list)

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # Relationships
    user = relationship("User", back_populates="agents")
