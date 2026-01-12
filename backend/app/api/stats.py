from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import func, desc
from typing import Optional
from datetime import date, timedelta

from app.database import get_db
from app.models.user import User
from app.models.message import Message
from app.models.event import Event
from app.models.monitored_group import MonitoredGroup
from app.api.deps import get_current_user

router = APIRouter()


@router.get("/overview")
def get_overview(
    days: Optional[int] = Query(default=None, le=90),
    group_id: Optional[int] = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get overall statistics with optional filters"""
    # Build date filter if days specified
    date_filter = None
    if days:
        start_date = date.today() - timedelta(days=days)
        date_filter = start_date

    # Messages query
    msg_query = db.query(Message).filter(Message.user_id == current_user.id)
    if group_id:
        msg_query = msg_query.filter(Message.group_id == group_id)
    if date_filter:
        msg_query = msg_query.filter(func.date(Message.timestamp) >= date_filter)
    total_messages = msg_query.count()

    # Unique senders query
    senders_query = db.query(func.count(func.distinct(Message.sender_phone))).filter(
        Message.user_id == current_user.id
    )
    if group_id:
        senders_query = senders_query.filter(Message.group_id == group_id)
    if date_filter:
        senders_query = senders_query.filter(func.date(Message.timestamp) >= date_filter)
    unique_senders = senders_query.scalar() or 0

    # Groups count (not filtered by date, but by group_id if specified)
    if group_id:
        total_groups = 1
    else:
        total_groups = db.query(MonitoredGroup).filter(
            MonitoredGroup.user_id == current_user.id,
            MonitoredGroup.is_active == True
        ).count()

    # Joins query
    joins_query = db.query(Event).filter(
        Event.user_id == current_user.id,
        Event.event_type == "JOIN"
    )
    if group_id:
        joins_query = joins_query.filter(Event.group_id == group_id)
    if date_filter:
        joins_query = joins_query.filter(Event.event_date >= date_filter)
    total_joins = joins_query.count()

    # Leaves query
    leaves_query = db.query(Event).filter(
        Event.user_id == current_user.id,
        Event.event_type == "LEAVE"
    )
    if group_id:
        leaves_query = leaves_query.filter(Event.group_id == group_id)
    if date_filter:
        leaves_query = leaves_query.filter(Event.event_date >= date_filter)
    total_leaves = leaves_query.count()

    return {
        "total_messages": total_messages,
        "total_groups": total_groups,
        "total_joins": total_joins,
        "total_leaves": total_leaves,
        "net_member_change": total_joins - total_leaves,
        "unique_senders": unique_senders
    }


@router.get("/daily")
def get_daily_stats(
    days: int = Query(default=30, le=90),
    group_id: Optional[int] = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get daily message counts for charting"""
    end_date = date.today()
    start_date = end_date - timedelta(days=days)

    query = db.query(
        func.date(Message.timestamp).label("date"),
        func.count(Message.id).label("count")
    ).filter(
        Message.user_id == current_user.id,
        func.date(Message.timestamp) >= start_date,
        func.date(Message.timestamp) <= end_date
    )

    if group_id:
        query = query.filter(Message.group_id == group_id)

    results = query.group_by(func.date(Message.timestamp)).all()

    return [{"date": row.date.isoformat(), "count": row.count} for row in results]


@router.get("/top-senders")
def get_top_senders(
    limit: int = Query(default=10, le=50),
    group_id: Optional[int] = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get top message senders"""
    query = db.query(
        Message.sender_name,
        Message.sender_phone,
        func.count(Message.id).label("message_count")
    ).filter(
        Message.user_id == current_user.id
    )

    if group_id:
        query = query.filter(Message.group_id == group_id)

    results = query.group_by(Message.sender_name, Message.sender_phone)\
        .order_by(desc("message_count"))\
        .limit(limit)\
        .all()

    return [
        {
            "sender_name": row.sender_name,
            "sender_phone": row.sender_phone,
            "message_count": row.message_count
        }
        for row in results
    ]


@router.get("/activity-by-group")
def get_activity_by_group(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get message count per group"""
    results = db.query(
        MonitoredGroup.id,
        MonitoredGroup.group_name,
        func.count(Message.id).label("message_count")
    ).outerjoin(
        Message, MonitoredGroup.id == Message.group_id
    ).filter(
        MonitoredGroup.user_id == current_user.id,
        MonitoredGroup.is_active == True
    ).group_by(
        MonitoredGroup.id, MonitoredGroup.group_name
    ).all()

    return [
        {
            "group_id": row.id,
            "group_name": row.group_name,
            "message_count": row.message_count or 0
        }
        for row in results
    ]


@router.get("/member-changes")
def get_member_changes(
    days: int = Query(default=30, le=90),
    group_id: Optional[int] = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get member join/leave trends over time"""
    end_date = date.today()
    start_date = end_date - timedelta(days=days)

    query = db.query(
        Event.event_date,
        Event.event_type,
        func.count(Event.id).label("count")
    ).filter(
        Event.user_id == current_user.id,
        Event.event_date >= start_date,
        Event.event_date <= end_date
    )

    if group_id:
        query = query.filter(Event.group_id == group_id)

    results = query.group_by(Event.event_date, Event.event_type).all()

    # Transform into daily data
    daily_data = {}
    for row in results:
        date_str = row.event_date.isoformat()
        if date_str not in daily_data:
            daily_data[date_str] = {"date": date_str, "joins": 0, "leaves": 0}
        if row.event_type == "JOIN":
            daily_data[date_str]["joins"] = row.count
        else:
            daily_data[date_str]["leaves"] = row.count

    # Sort by date
    return sorted(daily_data.values(), key=lambda x: x["date"])
