from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from sqlalchemy import desc, func, distinct
from sqlalchemy.dialects.postgresql import array_agg
from typing import Optional
from datetime import date
import csv
import io

from app.database import get_db
from app.models.user import User
from app.models.event import Event
from app.models.monitored_group import MonitoredGroup
from app.api.deps import get_current_user

router = APIRouter()


@router.get("/")
def get_certificates(
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    member_name: Optional[str] = None,
    group_id: Optional[int] = None,
    limit: int = Query(default=50, le=100),
    offset: int = 0,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get certificates with optional filtering"""
    query = db.query(Event).filter(
        Event.user_id == current_user.id,
        Event.event_type == "CERTIFICATE"
    )

    # Apply filters
    if date_from:
        query = query.filter(Event.event_date >= date_from)

    if date_to:
        query = query.filter(Event.event_date <= date_to)

    if member_name:
        query = query.filter(Event.member_name.ilike(f"%{member_name}%"))

    if group_id:
        query = query.filter(Event.group_id == group_id)

    total = query.count()

    certificates = query.order_by(desc(Event.timestamp))\
        .offset(offset)\
        .limit(limit)\
        .all()

    return {
        "certificates": [
            {
                "id": cert.id,
                "group_id": cert.group_id,
                "group_name": cert.group_name,
                "member_name": cert.member_name,
                "member_phone": cert.member_phone,
                "event_date": cert.event_date.isoformat(),
                "timestamp": cert.timestamp.isoformat()
            }
            for cert in certificates
        ],
        "total": total,
        "limit": limit,
        "offset": offset
    }


@router.get("/summary")
def get_certificates_summary(
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    group_id: Optional[int] = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get certificate counts per member for a period"""
    query = db.query(
        Event.member_name,
        Event.member_phone,
        func.count(Event.id).label("certificate_count"),
        func.string_agg(distinct(Event.group_name), ', ').label("groups")
    ).filter(
        Event.user_id == current_user.id,
        Event.event_type == "CERTIFICATE"
    )

    # Apply filters
    if date_from:
        query = query.filter(Event.event_date >= date_from)

    if date_to:
        query = query.filter(Event.event_date <= date_to)

    if group_id:
        query = query.filter(Event.group_id == group_id)

    results = query.group_by(Event.member_phone, Event.member_name)\
        .order_by(desc("certificate_count"))\
        .all()

    # Calculate totals
    total_certificates = sum(r.certificate_count for r in results)
    unique_members = len(results)

    return {
        "summary": [
            {
                "member_name": r.member_name,
                "member_phone": r.member_phone,
                "certificate_count": r.certificate_count,
                "groups": r.groups
            }
            for r in results
        ],
        "total_certificates": total_certificates,
        "unique_members": unique_members,
        "period_start": date_from.isoformat() if date_from else None,
        "period_end": date_to.isoformat() if date_to else None
    }


@router.get("/export/csv")
def export_certificates_csv(
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    member_name: Optional[str] = None,
    group_id: Optional[int] = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Export certificates summary to CSV file"""
    # Get summary data
    query = db.query(
        Event.member_name,
        Event.member_phone,
        func.count(Event.id).label("certificate_count"),
        func.string_agg(distinct(Event.group_name), ', ').label("groups")
    ).filter(
        Event.user_id == current_user.id,
        Event.event_type == "CERTIFICATE"
    )

    # Apply filters
    if date_from:
        query = query.filter(Event.event_date >= date_from)

    if date_to:
        query = query.filter(Event.event_date <= date_to)

    if member_name:
        query = query.filter(Event.member_name.ilike(f"%{member_name}%"))

    if group_id:
        query = query.filter(Event.group_id == group_id)

    results = query.group_by(Event.member_phone, Event.member_name)\
        .order_by(desc("certificate_count"))\
        .all()

    # Create CSV in memory
    output = io.StringIO()
    writer = csv.writer(output)

    # Write header
    writer.writerow([
        "Member Name",
        "Phone Number",
        "Total Certificates",
        "Groups"
    ])

    # Write data rows
    for r in results:
        writer.writerow([
            r.member_name,
            r.member_phone or "",
            r.certificate_count,
            r.groups or ""
        ])

    output.seek(0)

    # Generate filename with date range
    filename = "certificates"
    if date_from:
        filename += f"_from_{date_from.isoformat()}"
    if date_to:
        filename += f"_to_{date_to.isoformat()}"
    filename += ".csv"

    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )
