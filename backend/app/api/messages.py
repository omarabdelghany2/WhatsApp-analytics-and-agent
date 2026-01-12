from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import desc
from typing import List, Optional

from app.database import get_db
from app.models.user import User
from app.models.message import Message
from app.models.monitored_group import MonitoredGroup
from app.schemas.message import MessageResponse, MessageList
from app.api.deps import get_current_user

router = APIRouter()


@router.get("/", response_model=MessageList)
def get_messages(
    group_id: Optional[int] = None,
    limit: int = Query(default=50, le=100),
    offset: int = 0,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get messages for current user (optionally filtered by group)"""
    query = db.query(Message).filter(Message.user_id == current_user.id)

    if group_id:
        query = query.filter(Message.group_id == group_id)

    total = query.count()

    messages = query.order_by(desc(Message.timestamp))\
        .offset(offset)\
        .limit(limit)\
        .all()

    return MessageList(
        messages=messages,
        total=total,
        limit=limit,
        offset=offset
    )


@router.get("/group/{group_id}", response_model=MessageList)
def get_group_messages(
    group_id: int,
    limit: int = Query(default=50, le=100),
    offset: int = 0,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get messages for a specific group"""
    # Verify group belongs to user
    group = db.query(MonitoredGroup).filter(
        MonitoredGroup.id == group_id,
        MonitoredGroup.user_id == current_user.id
    ).first()

    if not group:
        raise HTTPException(status_code=404, detail="Group not found")

    query = db.query(Message).filter(
        Message.user_id == current_user.id,
        Message.group_id == group_id
    )

    total = query.count()

    messages = query.order_by(desc(Message.timestamp))\
        .offset(offset)\
        .limit(limit)\
        .all()

    return MessageList(
        messages=messages,
        total=total,
        limit=limit,
        offset=offset
    )


@router.get("/search", response_model=MessageList)
def search_messages(
    q: str = Query(..., min_length=1),
    group_id: Optional[int] = None,
    limit: int = Query(default=50, le=100),
    offset: int = 0,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Search messages by content"""
    query = db.query(Message).filter(
        Message.user_id == current_user.id,
        Message.content.ilike(f"%{q}%")
    )

    if group_id:
        query = query.filter(Message.group_id == group_id)

    total = query.count()

    messages = query.order_by(desc(Message.timestamp))\
        .offset(offset)\
        .limit(limit)\
        .all()

    return MessageList(
        messages=messages,
        total=total,
        limit=limit,
        offset=offset
    )


@router.get("/{message_id}", response_model=MessageResponse)
def get_message(
    message_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get a specific message"""
    message = db.query(Message).filter(
        Message.id == message_id,
        Message.user_id == current_user.id
    ).first()

    if not message:
        raise HTTPException(status_code=404, detail="Message not found")

    return message
