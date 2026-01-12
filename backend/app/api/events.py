from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from sqlalchemy import desc, and_
from typing import List, Optional
from datetime import date
import csv
import io

from app.database import get_db
from app.models.user import User
from app.models.event import Event
from app.models.monitored_group import MonitoredGroup
from app.schemas.event import EventResponse, EventList, EventFilter
from app.api.deps import get_current_user

router = APIRouter()


@router.get("/", response_model=EventList)
def get_events(
    event_type: Optional[str] = None,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    member_name: Optional[str] = None,
    group_id: Optional[int] = None,
    limit: int = Query(default=50, le=100),
    offset: int = 0,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get events with optional filtering"""
    query = db.query(Event).filter(Event.user_id == current_user.id)

    # Apply filters
    if event_type:
        query = query.filter(Event.event_type == event_type.upper())

    if date_from:
        query = query.filter(Event.event_date >= date_from)

    if date_to:
        query = query.filter(Event.event_date <= date_to)

    if member_name:
        query = query.filter(Event.member_name.ilike(f"%{member_name}%"))

    if group_id:
        query = query.filter(Event.group_id == group_id)

    total = query.count()

    events = query.order_by(desc(Event.timestamp))\
        .offset(offset)\
        .limit(limit)\
        .all()

    return EventList(
        events=events,
        total=total,
        limit=limit,
        offset=offset
    )


@router.get("/group/{group_id}", response_model=EventList)
def get_group_events(
    group_id: int,
    event_type: Optional[str] = None,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    limit: int = Query(default=50, le=100),
    offset: int = 0,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get events for a specific group"""
    # Verify group belongs to user
    group = db.query(MonitoredGroup).filter(
        MonitoredGroup.id == group_id,
        MonitoredGroup.user_id == current_user.id
    ).first()

    if not group:
        raise HTTPException(status_code=404, detail="Group not found")

    query = db.query(Event).filter(
        Event.user_id == current_user.id,
        Event.group_id == group_id
    )

    # Apply filters
    if event_type:
        query = query.filter(Event.event_type == event_type.upper())

    if date_from:
        query = query.filter(Event.event_date >= date_from)

    if date_to:
        query = query.filter(Event.event_date <= date_to)

    total = query.count()

    events = query.order_by(desc(Event.timestamp))\
        .offset(offset)\
        .limit(limit)\
        .all()

    return EventList(
        events=events,
        total=total,
        limit=limit,
        offset=offset
    )


@router.get("/summary")
def get_events_summary(
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    group_id: Optional[int] = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get summary of join/leave events"""
    base_query = db.query(Event).filter(Event.user_id == current_user.id)

    if date_from:
        base_query = base_query.filter(Event.event_date >= date_from)

    if date_to:
        base_query = base_query.filter(Event.event_date <= date_to)

    if group_id:
        base_query = base_query.filter(Event.group_id == group_id)

    total_joins = base_query.filter(Event.event_type == "JOIN").count()
    total_leaves = base_query.filter(Event.event_type == "LEAVE").count()

    return {
        "total_joins": total_joins,
        "total_leaves": total_leaves,
        "net_change": total_joins - total_leaves,
        "period_start": date_from,
        "period_end": date_to
    }


@router.get("/daily")
def get_daily_events(
    days: int = Query(default=30, le=90),
    group_id: Optional[int] = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get daily event counts for charting"""
    from datetime import timedelta
    from sqlalchemy import func

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

    return list(daily_data.values())


@router.get("/export/csv")
def export_events_csv(
    event_type: Optional[str] = None,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    member_name: Optional[str] = None,
    group_id: Optional[int] = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Export filtered events to CSV file"""
    query = db.query(Event).filter(Event.user_id == current_user.id)

    # Apply filters
    if event_type:
        query = query.filter(Event.event_type == event_type.upper())

    if date_from:
        query = query.filter(Event.event_date >= date_from)

    if date_to:
        query = query.filter(Event.event_date <= date_to)

    if member_name:
        query = query.filter(Event.member_name.ilike(f"%{member_name}%"))

    if group_id:
        query = query.filter(Event.group_id == group_id)

    events = query.order_by(desc(Event.timestamp)).all()

    # Create CSV in memory
    output = io.StringIO()
    writer = csv.writer(output)

    # Write header
    writer.writerow([
        "Member Name",
        "Phone Number",
        "Event Type",
        "Event Date",
        "Group Name",
        "Timestamp"
    ])

    # Write data rows
    for event in events:
        writer.writerow([
            event.member_name,
            event.member_phone or "",
            event.event_type,
            event.event_date.isoformat(),
            event.group_name,
            event.timestamp.isoformat()
        ])

    output.seek(0)

    # Generate filename with date range
    filename = "events"
    if date_from:
        filename += f"_from_{date_from.isoformat()}"
    if date_to:
        filename += f"_to_{date_to.isoformat()}"
    if event_type:
        filename += f"_{event_type.lower()}"
    filename += ".csv"

    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )
