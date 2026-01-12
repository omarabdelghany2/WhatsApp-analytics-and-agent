from datetime import datetime, timedelta, time
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy.orm import Session
from sqlalchemy import desc, and_, or_
from pydantic import BaseModel

from app.database import get_db
from app.models.user import User
from app.models.scheduled_message import ScheduledMessage
from app.models.monitored_group import MonitoredGroup
from app.api.deps import get_current_user
from app.services.whatsapp_bridge import whatsapp_bridge
from app.services.websocket_manager import websocket_manager

router = APIRouter()


class CreateScheduleRequest(BaseModel):
    group_ids: List[int]
    open_time: str  # "09:00" format
    close_time: str  # "21:00" format
    open_message: Optional[str] = None
    close_message: Optional[str] = None
    mention_type: str = 'none'  # 'none', 'all', 'selected'
    mention_ids: Optional[List[str]] = None


class ImmediateSettingsRequest(BaseModel):
    group_ids: List[int]
    admin_only: bool
    message: Optional[str] = None
    mention_type: str = 'none'
    mention_ids: Optional[List[str]] = None


def parse_time_string(time_str: str) -> tuple:
    """Parse time string 'HH:MM' and return (hour, minute)"""
    try:
        parts = time_str.split(':')
        hour = int(parts[0])
        minute = int(parts[1])
        if not (0 <= hour <= 23 and 0 <= minute <= 59):
            raise ValueError("Invalid time range")
        return hour, minute
    except (ValueError, IndexError):
        raise HTTPException(status_code=400, detail=f"Invalid time format: {time_str}. Use HH:MM format.")


def calculate_next_scheduled_time(time_str: str, timezone_offset_hours: int = 2) -> datetime:
    """
    Calculate next occurrence of the given time (today if not passed, tomorrow if passed).
    Converts from local time to UTC by subtracting the timezone offset.

    Args:
        time_str: Time in HH:MM format (user's local time)
        timezone_offset_hours: Hours ahead of UTC (default 2 for Egypt/UTC+2)
    """
    hour, minute = parse_time_string(time_str)
    now = datetime.utcnow()

    # Create datetime in user's local time, then convert to UTC
    local_scheduled = datetime.combine(now.date(), time(hour, minute))
    # Subtract timezone offset to convert local time to UTC
    scheduled_utc = local_scheduled - timedelta(hours=timezone_offset_hours)

    # If time has already passed today (in UTC), schedule for tomorrow
    if scheduled_utc <= now:
        scheduled_utc = scheduled_utc + timedelta(days=1)

    return scheduled_utc


@router.post("/schedules")
def create_settings_schedule(
    request: CreateScheduleRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Create a recurring schedule for opening and closing groups"""

    # Validate times
    parse_time_string(request.open_time)
    parse_time_string(request.close_time)

    if not request.group_ids:
        raise HTTPException(status_code=400, detail="At least one group is required")

    if request.mention_type not in ['none', 'all', 'selected']:
        raise HTTPException(status_code=400, detail="Invalid mention_type")

    if request.mention_type == 'selected' and not request.mention_ids:
        raise HTTPException(status_code=400, detail="mention_ids required for 'selected' mention_type")

    # Validate groups belong to user
    groups = db.query(MonitoredGroup).filter(
        MonitoredGroup.id.in_(request.group_ids),
        MonitoredGroup.user_id == current_user.id,
        MonitoredGroup.is_active == True
    ).all()

    if len(groups) != len(request.group_ids):
        raise HTTPException(status_code=400, detail="One or more groups not found or not active")

    group_names = [g.group_name for g in groups]

    # Calculate scheduled times for open and close tasks
    open_scheduled_at = calculate_next_scheduled_time(request.open_time)
    close_scheduled_at = calculate_next_scheduled_time(request.close_time)

    # Create the "open" task first
    open_task = ScheduledMessage(
        user_id=current_user.id,
        task_type='open_group',
        is_recurring=True,
        recurring_time=request.open_time,
        content=request.open_message,
        group_ids=request.group_ids,
        group_names=group_names,
        mention_type=request.mention_type if request.open_message else 'none',
        mention_ids=request.mention_ids if request.open_message else None,
        scheduled_at=open_scheduled_at,
        status='pending'
    )
    db.add(open_task)
    db.flush()  # Get the ID

    # Use the open task's ID as parent_schedule_id for linking
    parent_id = open_task.id
    open_task.parent_schedule_id = parent_id

    # Create the "close" task linked to the open task
    close_task = ScheduledMessage(
        user_id=current_user.id,
        task_type='close_group',
        is_recurring=True,
        recurring_time=request.close_time,
        parent_schedule_id=parent_id,
        content=request.close_message,
        group_ids=request.group_ids,
        group_names=group_names,
        mention_type=request.mention_type if request.close_message else 'none',
        mention_ids=request.mention_ids if request.close_message else None,
        scheduled_at=close_scheduled_at,
        status='pending'
    )
    db.add(close_task)
    db.commit()

    return {
        "success": True,
        "schedule_id": parent_id,
        "open_time": request.open_time,
        "close_time": request.close_time,
        "next_open": open_scheduled_at.isoformat(),
        "next_close": close_scheduled_at.isoformat(),
        "groups": group_names
    }


@router.get("/schedules")
def get_settings_schedules(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get all recurring group settings schedules for current user"""

    # Find all unique parent_schedule_ids for recurring tasks
    recurring_tasks = db.query(ScheduledMessage).filter(
        ScheduledMessage.user_id == current_user.id,
        ScheduledMessage.is_recurring == True,
        ScheduledMessage.task_type.in_(['open_group', 'close_group'])
    ).all()

    # Group tasks by parent_schedule_id
    schedules_map = {}
    for task in recurring_tasks:
        parent_id = task.parent_schedule_id
        if parent_id not in schedules_map:
            schedules_map[parent_id] = {
                'open_task': None,
                'close_task': None,
                'group_names': task.group_names,
                'group_ids': task.group_ids
            }

        if task.task_type == 'open_group':
            # Keep the pending one or the most recent
            if schedules_map[parent_id]['open_task'] is None or task.status == 'pending':
                schedules_map[parent_id]['open_task'] = task
        elif task.task_type == 'close_group':
            if schedules_map[parent_id]['close_task'] is None or task.status == 'pending':
                schedules_map[parent_id]['close_task'] = task

    # Build response
    schedules = []
    for parent_id, data in schedules_map.items():
        open_task = data['open_task']
        close_task = data['close_task']

        # Skip if no tasks exist
        if not open_task and not close_task:
            continue

        # Check if schedule is active (has pending tasks)
        is_active = (open_task and open_task.status == 'pending') or \
                    (close_task and close_task.status == 'pending')

        # Skip schedules where all tasks are cancelled/completed (deleted schedules)
        if not is_active:
            continue

        schedules.append({
            "id": parent_id,
            "group_ids": data['group_ids'] or [],
            "group_names": data['group_names'] or [],
            "open_time": open_task.recurring_time if open_task else None,
            "close_time": close_task.recurring_time if close_task else None,
            "open_message": open_task.content if open_task else None,
            "close_message": close_task.content if close_task else None,
            "is_active": is_active,
            "next_open": open_task.scheduled_at.isoformat() if open_task and open_task.status == 'pending' else None,
            "next_close": close_task.scheduled_at.isoformat() if close_task and close_task.status == 'pending' else None
        })

    return {"schedules": schedules}


@router.delete("/schedules/{schedule_id}")
def delete_schedule(
    schedule_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Delete a schedule (cancels all related pending tasks)"""

    # Find all tasks with this parent_schedule_id
    tasks = db.query(ScheduledMessage).filter(
        ScheduledMessage.parent_schedule_id == schedule_id,
        ScheduledMessage.user_id == current_user.id
    ).all()

    if not tasks:
        raise HTTPException(status_code=404, detail="Schedule not found")

    cancelled_count = 0
    for task in tasks:
        if task.status == 'pending':
            task.status = 'cancelled'
            cancelled_count += 1

    db.commit()

    return {
        "success": True,
        "message": f"Schedule cancelled ({cancelled_count} pending tasks cancelled)"
    }


@router.post("/schedules/{schedule_id}/toggle")
def toggle_schedule(
    schedule_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Enable/disable a schedule"""

    # Find tasks with this parent_schedule_id
    tasks = db.query(ScheduledMessage).filter(
        ScheduledMessage.parent_schedule_id == schedule_id,
        ScheduledMessage.user_id == current_user.id,
        ScheduledMessage.is_recurring == True
    ).all()

    if not tasks:
        raise HTTPException(status_code=404, detail="Schedule not found")

    # Check current state (active if any pending tasks exist)
    pending_tasks = [t for t in tasks if t.status == 'pending']
    is_currently_active = len(pending_tasks) > 0

    if is_currently_active:
        # Disable: cancel all pending tasks
        for task in pending_tasks:
            task.status = 'cancelled'
        db.commit()
        return {"success": True, "is_active": False, "message": "Schedule disabled"}
    else:
        # Enable: create new pending tasks based on the most recent completed/cancelled tasks
        # Find one open and one close task to use as templates
        open_template = None
        close_template = None

        for task in tasks:
            if task.task_type == 'open_group' and (open_template is None or task.id > open_template.id):
                open_template = task
            elif task.task_type == 'close_group' and (close_template is None or task.id > close_template.id):
                close_template = task

        if not open_template or not close_template:
            raise HTTPException(status_code=400, detail="Cannot enable schedule: missing task templates")

        # Create new pending tasks
        open_scheduled_at = calculate_next_scheduled_time(open_template.recurring_time)
        close_scheduled_at = calculate_next_scheduled_time(close_template.recurring_time)

        new_open = ScheduledMessage(
            user_id=current_user.id,
            task_type='open_group',
            is_recurring=True,
            recurring_time=open_template.recurring_time,
            parent_schedule_id=schedule_id,
            content=open_template.content,
            group_ids=open_template.group_ids,
            group_names=open_template.group_names,
            mention_type=open_template.mention_type,
            mention_ids=open_template.mention_ids,
            scheduled_at=open_scheduled_at,
            status='pending'
        )

        new_close = ScheduledMessage(
            user_id=current_user.id,
            task_type='close_group',
            is_recurring=True,
            recurring_time=close_template.recurring_time,
            parent_schedule_id=schedule_id,
            content=close_template.content,
            group_ids=close_template.group_ids,
            group_names=close_template.group_names,
            mention_type=close_template.mention_type,
            mention_ids=close_template.mention_ids,
            scheduled_at=close_scheduled_at,
            status='pending'
        )

        db.add(new_open)
        db.add(new_close)
        db.commit()

        return {
            "success": True,
            "is_active": True,
            "message": "Schedule enabled",
            "next_open": open_scheduled_at.isoformat(),
            "next_close": close_scheduled_at.isoformat()
        }


async def execute_immediate_settings(
    user_id: int,
    group_ids: List[int],
    admin_only: bool,
    message: Optional[str],
    mention_type: str,
    mention_ids: Optional[List[str]],
    db: Session
):
    """Execute group settings change immediately"""
    action = 'close' if admin_only else 'open'
    groups_success = 0
    groups_failed = 0
    errors = []

    for i, group_id in enumerate(group_ids):
        # 30-second delay between groups (except first)
        if i > 0:
            import asyncio
            await asyncio.sleep(30)

        try:
            group = db.query(MonitoredGroup).filter(
                MonitoredGroup.id == group_id,
                MonitoredGroup.user_id == user_id
            ).first()

            if not group:
                groups_failed += 1
                errors.append(f"Group {group_id} not found")
                continue

            # Change group settings
            result = await whatsapp_bridge.set_group_admin_only(
                user_id=user_id,
                group_id=group.whatsapp_group_id,
                admin_only=admin_only
            )

            if result.get('success'):
                groups_success += 1

                # Send optional message if configured
                if message:
                    await whatsapp_bridge.send_message(
                        user_id=user_id,
                        group_id=group.whatsapp_group_id,
                        content=message,
                        mention_all=(mention_type == 'all'),
                        mention_ids=mention_ids if mention_type == 'selected' else None
                    )

                # Notify progress
                await websocket_manager.send_to_user(user_id, {
                    'type': 'immediate_settings_progress',
                    'action': action,
                    'group_name': group.group_name,
                    'groups_done': groups_success + groups_failed,
                    'total_groups': len(group_ids)
                })
            else:
                groups_failed += 1
                errors.append(f"{group.group_name}: {result.get('error', 'Unknown error')}")

        except Exception as e:
            groups_failed += 1
            errors.append(f"Group {group_id}: {str(e)}")

    # Notify completion
    await websocket_manager.send_to_user(user_id, {
        'type': 'immediate_settings_complete',
        'action': action,
        'groups_success': groups_success,
        'groups_failed': groups_failed,
        'errors': errors if errors else None
    })


@router.post("/immediate")
async def set_group_settings_now(
    request: ImmediateSettingsRequest,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Immediately change group settings (manual control)"""

    if not request.group_ids:
        raise HTTPException(status_code=400, detail="At least one group is required")

    if request.mention_type not in ['none', 'all', 'selected']:
        raise HTTPException(status_code=400, detail="Invalid mention_type")

    if request.mention_type == 'selected' and not request.mention_ids:
        raise HTTPException(status_code=400, detail="mention_ids required for 'selected' mention_type")

    # Validate groups belong to user
    groups = db.query(MonitoredGroup).filter(
        MonitoredGroup.id.in_(request.group_ids),
        MonitoredGroup.user_id == current_user.id,
        MonitoredGroup.is_active == True
    ).all()

    if len(groups) != len(request.group_ids):
        raise HTTPException(status_code=400, detail="One or more groups not found or not active")

    group_names = [g.group_name for g in groups]
    action = 'close' if request.admin_only else 'open'

    # Execute in background
    background_tasks.add_task(
        execute_immediate_settings,
        current_user.id,
        request.group_ids,
        request.admin_only,
        request.message,
        request.mention_type,
        request.mention_ids,
        db
    )

    return {
        "success": True,
        "action": action,
        "groups": group_names,
        "message": f"Setting groups to {action} in background"
    }


@router.get("/history")
def get_settings_history(
    limit: int = 50,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get history of group settings changes"""

    tasks = db.query(ScheduledMessage).filter(
        ScheduledMessage.user_id == current_user.id,
        ScheduledMessage.task_type.in_(['open_group', 'close_group']),
        ScheduledMessage.status.in_(['sent', 'failed', 'partially_sent'])
    ).order_by(desc(ScheduledMessage.sent_at)).limit(limit).all()

    return {
        "history": [
            {
                "id": task.id,
                "task_type": task.task_type,
                "action": "close" if task.task_type == "close_group" else "open",
                "group_names": task.group_names or [],
                "scheduled_at": task.scheduled_at.isoformat() if task.scheduled_at else None,
                "sent_at": task.sent_at.isoformat() if task.sent_at else None,
                "status": task.status,
                "groups_success": task.groups_sent or 0,
                "groups_failed": task.groups_failed or 0,
                "error_message": task.error_message,
                "is_recurring": task.is_recurring,
                "message_sent": task.content is not None
            }
            for task in tasks
        ]
    }
