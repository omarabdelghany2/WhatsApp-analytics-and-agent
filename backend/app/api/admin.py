from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import desc
from typing import List

from app.database import get_db
from app.models.user import User
from app.models.monitored_group import MonitoredGroup
from app.models.message import Message
from app.models.event import Event
from app.models.whatsapp_session import WhatsAppSession
from app.schemas.user import UserResponse
from app.schemas.group import GroupResponse
from app.schemas.message import MessageList
from app.api.deps import get_admin_user

router = APIRouter()


@router.get("/users")
def get_all_users(
    limit: int = Query(default=50, le=100),
    offset: int = 0,
    admin: User = Depends(get_admin_user),
    db: Session = Depends(get_db)
):
    """Get all users with WhatsApp status (admin only)"""
    users = db.query(User)\
        .order_by(desc(User.created_at))\
        .offset(offset)\
        .limit(limit)\
        .all()

    # Get WhatsApp session status for all users
    sessions = db.query(WhatsAppSession).all()
    session_map = {s.user_id: s for s in sessions}

    result = []
    for user in users:
        session = session_map.get(user.id)
        # Count user's data
        message_count = db.query(Message).filter(Message.user_id == user.id).count()
        group_count = db.query(MonitoredGroup).filter(
            MonitoredGroup.user_id == user.id,
            MonitoredGroup.is_active == True
        ).count()
        event_count = db.query(Event).filter(Event.user_id == user.id).count()
        certificate_count = db.query(Event).filter(
            Event.user_id == user.id,
            Event.event_type == "CERTIFICATE"
        ).count()

        result.append({
            "id": user.id,
            "username": user.username,
            "email": user.email,
            "is_admin": user.is_admin,
            "is_active": user.is_active,
            "created_at": user.created_at.isoformat() if user.created_at else None,
            "whatsapp_status": session.auth_status if session else "not_initialized",
            "whatsapp_connected": session.is_authenticated if session else False,
            "whatsapp_phone": session.phone_number if session else None,
            "message_count": message_count,
            "group_count": group_count,
            "event_count": event_count,
            "certificate_count": certificate_count
        })

    return result


@router.get("/users/{user_id}", response_model=UserResponse)
def get_user(
    user_id: int,
    admin: User = Depends(get_admin_user),
    db: Session = Depends(get_db)
):
    """Get a specific user (admin only)"""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user


@router.put("/users/{user_id}/admin")
def toggle_admin(
    user_id: int,
    admin: User = Depends(get_admin_user),
    db: Session = Depends(get_db)
):
    """Toggle admin status for a user"""
    if user_id == admin.id:
        raise HTTPException(
            status_code=400,
            detail="Cannot change your own admin status"
        )

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    user.is_admin = not user.is_admin
    db.commit()

    return {
        "success": True,
        "user_id": user_id,
        "is_admin": user.is_admin
    }


@router.delete("/users/{user_id}")
def delete_user(
    user_id: int,
    admin: User = Depends(get_admin_user),
    db: Session = Depends(get_db)
):
    """Delete a user and all their data (admin only)"""
    from app.models.scheduled_message import ScheduledMessage

    if user_id == admin.id:
        raise HTTPException(
            status_code=400,
            detail="Cannot delete your own account"
        )

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # Cancel any pending/sending scheduled messages first
    # This prevents the scheduler from processing them while we delete
    db.query(ScheduledMessage).filter(
        ScheduledMessage.user_id == user_id,
        ScheduledMessage.status.in_(['pending', 'sending'])
    ).update({'status': 'cancelled'}, synchronize_session=False)

    # Delete user (cascades to related records)
    db.delete(user)
    db.commit()

    return {"success": True, "message": f"User {user.username} deleted"}


@router.get("/users/{user_id}/groups", response_model=List[GroupResponse])
def get_user_groups(
    user_id: int,
    admin: User = Depends(get_admin_user),
    db: Session = Depends(get_db)
):
    """Get groups for a specific user (admin only)"""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    groups = db.query(MonitoredGroup).filter(
        MonitoredGroup.user_id == user_id,
        MonitoredGroup.is_active == True
    ).all()

    return groups


@router.get("/users/{user_id}/messages")
def get_user_messages(
    user_id: int,
    group_id: int = Query(None),
    limit: int = Query(default=50, le=100),
    offset: int = 0,
    admin: User = Depends(get_admin_user),
    db: Session = Depends(get_db)
):
    """Get messages for a specific user (admin only)"""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    query = db.query(Message).filter(Message.user_id == user_id)

    if group_id:
        query = query.filter(Message.group_id == group_id)

    total = query.count()

    messages = query.order_by(desc(Message.timestamp))\
        .offset(offset)\
        .limit(limit)\
        .all()

    return {
        "messages": [
            {
                "id": m.id,
                "group_name": m.group_name,
                "sender_name": m.sender_name,
                "sender_phone": m.sender_phone,
                "content": m.content,
                "timestamp": m.timestamp.isoformat() if m.timestamp else None
            }
            for m in messages
        ],
        "total": total,
        "limit": limit,
        "offset": offset
    }


@router.get("/users/{user_id}/stats")
def get_user_stats(
    user_id: int,
    admin: User = Depends(get_admin_user),
    db: Session = Depends(get_db)
):
    """Get stats for a specific user (admin only)"""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    total_messages = db.query(Message).filter(Message.user_id == user_id).count()
    total_groups = db.query(MonitoredGroup).filter(
        MonitoredGroup.user_id == user_id,
        MonitoredGroup.is_active == True
    ).count()
    total_events = db.query(Event).filter(Event.user_id == user_id).count()

    # Get WhatsApp session status
    session = db.query(WhatsAppSession).filter(
        WhatsAppSession.user_id == user_id
    ).first()

    return {
        "user_id": user_id,
        "username": user.username,
        "email": user.email,
        "total_messages": total_messages,
        "total_groups": total_groups,
        "total_events": total_events,
        "whatsapp_status": session.auth_status if session else "not_initialized",
        "is_whatsapp_connected": session.is_authenticated if session else False
    }


@router.get("/users/{user_id}/stats/overview")
def get_user_overview(
    user_id: int,
    admin: User = Depends(get_admin_user),
    db: Session = Depends(get_db)
):
    """Get dashboard overview for a specific user (admin only)"""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    total_messages = db.query(Message).filter(Message.user_id == user_id).count()
    total_groups = db.query(MonitoredGroup).filter(
        MonitoredGroup.user_id == user_id,
        MonitoredGroup.is_active == True
    ).count()
    total_joins = db.query(Event).filter(
        Event.user_id == user_id,
        Event.event_type == "JOIN"
    ).count()
    total_leaves = db.query(Event).filter(
        Event.user_id == user_id,
        Event.event_type == "LEAVE"
    ).count()
    unique_senders = db.query(Message.sender_phone).filter(
        Message.user_id == user_id
    ).distinct().count()

    return {
        "total_messages": total_messages,
        "total_groups": total_groups,
        "total_joins": total_joins,
        "total_leaves": total_leaves,
        "net_member_change": total_joins - total_leaves,
        "unique_senders": unique_senders
    }


@router.get("/users/{user_id}/events")
def get_user_events(
    user_id: int,
    event_type: str = Query(None),
    date_from: str = Query(None),
    date_to: str = Query(None),
    member_name: str = Query(None),
    group_id: int = Query(None),
    limit: int = Query(default=50, le=100),
    offset: int = 0,
    admin: User = Depends(get_admin_user),
    db: Session = Depends(get_db)
):
    """Get events for a specific user (admin only)"""
    from datetime import datetime

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    query = db.query(Event).filter(Event.user_id == user_id)

    if event_type:
        query = query.filter(Event.event_type == event_type)
    if date_from:
        query = query.filter(Event.event_date >= datetime.fromisoformat(date_from).date())
    if date_to:
        query = query.filter(Event.event_date <= datetime.fromisoformat(date_to).date())
    if member_name:
        query = query.filter(Event.member_name.ilike(f"%{member_name}%"))
    if group_id:
        query = query.filter(Event.group_id == group_id)

    total = query.count()

    events = query.order_by(desc(Event.timestamp))\
        .offset(offset)\
        .limit(limit)\
        .all()

    return {
        "events": [
            {
                "id": e.id,
                "group_name": e.group_name,
                "member_name": e.member_name,
                "member_phone": e.member_phone,
                "event_type": e.event_type,
                "event_date": e.event_date.isoformat() if e.event_date else None,
                "timestamp": e.timestamp.isoformat() if e.timestamp else None
            }
            for e in events
        ],
        "total": total,
        "limit": limit,
        "offset": offset
    }


@router.get("/users/{user_id}/certificates")
def get_user_certificates(
    user_id: int,
    limit: int = Query(default=50, le=100),
    offset: int = 0,
    admin: User = Depends(get_admin_user),
    db: Session = Depends(get_db)
):
    """Get certificates for a specific user (admin only)"""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    query = db.query(Event).filter(
        Event.user_id == user_id,
        Event.event_type == "CERTIFICATE"
    )

    total = query.count()

    certificates = query.order_by(desc(Event.timestamp))\
        .offset(offset)\
        .limit(limit)\
        .all()

    return {
        "certificates": [
            {
                "id": c.id,
                "group_name": c.group_name,
                "member_name": c.member_name,
                "member_phone": c.member_phone,
                "event_date": c.event_date.isoformat() if c.event_date else None,
                "timestamp": c.timestamp.isoformat() if c.timestamp else None
            }
            for c in certificates
        ],
        "total": total,
        "limit": limit,
        "offset": offset
    }


@router.get("/users/{user_id}/certificates/summary")
def get_user_certificates_summary(
    user_id: int,
    date_from: str = Query(None),
    date_to: str = Query(None),
    group_id: int = Query(None),
    admin: User = Depends(get_admin_user),
    db: Session = Depends(get_db)
):
    """Get certificates summary for a specific user (admin only)"""
    from datetime import datetime
    from sqlalchemy import func, String
    from sqlalchemy.sql.expression import cast

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    query = db.query(Event).filter(
        Event.user_id == user_id,
        Event.event_type == "CERTIFICATE"
    )

    if date_from:
        query = query.filter(Event.event_date >= datetime.fromisoformat(date_from).date())
    if date_to:
        query = query.filter(Event.event_date <= datetime.fromisoformat(date_to).date())
    if group_id:
        query = query.filter(Event.group_id == group_id)

    # Get summary grouped by member
    summary_query = db.query(
        Event.member_name,
        Event.member_phone,
        func.count(Event.id).label("certificate_count"),
        func.string_agg(func.distinct(Event.group_name), ', ').label("groups")
    ).filter(
        Event.user_id == user_id,
        Event.event_type == "CERTIFICATE"
    )

    if date_from:
        summary_query = summary_query.filter(Event.event_date >= datetime.fromisoformat(date_from).date())
    if date_to:
        summary_query = summary_query.filter(Event.event_date <= datetime.fromisoformat(date_to).date())
    if group_id:
        summary_query = summary_query.filter(Event.group_id == group_id)

    results = summary_query.group_by(Event.member_name, Event.member_phone).all()

    summary = [
        {
            "member_name": row.member_name,
            "member_phone": row.member_phone,
            "certificate_count": row.certificate_count,
            "groups": row.groups
        }
        for row in results
    ]

    total_certificates = sum(item["certificate_count"] for item in summary)
    unique_members = len(summary)

    return {
        "summary": summary,
        "total_certificates": total_certificates,
        "unique_members": unique_members,
        "period_start": date_from,
        "period_end": date_to
    }


@router.get("/stats/overview")
def get_admin_overview(
    admin: User = Depends(get_admin_user),
    db: Session = Depends(get_db)
):
    """Get admin dashboard overview"""
    total_users = db.query(User).count()
    active_users = db.query(User).filter(User.is_active == True).count()
    admin_users = db.query(User).filter(User.is_admin == True).count()
    total_messages = db.query(Message).count()
    total_groups = db.query(MonitoredGroup).filter(MonitoredGroup.is_active == True).count()
    total_certificates = db.query(Event).filter(Event.event_type == "CERTIFICATE").count()

    connected_sessions = db.query(WhatsAppSession).filter(
        WhatsAppSession.is_authenticated == True
    ).count()

    return {
        "total_users": total_users,
        "active_users": active_users,
        "admin_users": admin_users,
        "connected_whatsapp_sessions": connected_sessions,
        "total_messages": total_messages,
        "total_groups": total_groups,
        "total_certificates": total_certificates
    }


@router.get("/users/{user_id}/stats/daily")
def get_user_daily_stats(
    user_id: int,
    days: int = Query(default=30, le=90),
    group_id: int = Query(None),
    admin: User = Depends(get_admin_user),
    db: Session = Depends(get_db)
):
    """Get daily message counts for a specific user (admin only)"""
    from datetime import date, timedelta
    from sqlalchemy import func

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    end_date = date.today()
    start_date = end_date - timedelta(days=days)

    query = db.query(
        func.date(Message.timestamp).label("date"),
        func.count(Message.id).label("count")
    ).filter(
        Message.user_id == user_id,
        func.date(Message.timestamp) >= start_date,
        func.date(Message.timestamp) <= end_date
    )

    if group_id:
        query = query.filter(Message.group_id == group_id)

    results = query.group_by(func.date(Message.timestamp)).all()

    return [{"date": row.date.isoformat(), "count": row.count} for row in results]


@router.get("/users/{user_id}/stats/top-senders")
def get_user_top_senders(
    user_id: int,
    limit: int = Query(default=10, le=50),
    group_id: int = Query(None),
    admin: User = Depends(get_admin_user),
    db: Session = Depends(get_db)
):
    """Get top message senders for a specific user (admin only)"""
    from sqlalchemy import func

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    query = db.query(
        Message.sender_name,
        Message.sender_phone,
        func.count(Message.id).label("message_count")
    ).filter(
        Message.user_id == user_id
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


@router.get("/users/{user_id}/stats/member-changes")
def get_user_member_changes(
    user_id: int,
    days: int = Query(default=30, le=90),
    group_id: int = Query(None),
    admin: User = Depends(get_admin_user),
    db: Session = Depends(get_db)
):
    """Get member join/leave trends for a specific user (admin only)"""
    from datetime import date, timedelta
    from sqlalchemy import func

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    end_date = date.today()
    start_date = end_date - timedelta(days=days)

    query = db.query(
        Event.event_date,
        Event.event_type,
        func.count(Event.id).label("count")
    ).filter(
        Event.user_id == user_id,
        Event.event_date >= start_date,
        Event.event_date <= end_date,
        Event.event_type.in_(["JOIN", "LEAVE"])
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

    return sorted(daily_data.values(), key=lambda x: x["date"])
