import asyncio
import os
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, BackgroundTasks, File, UploadFile, Form
from sqlalchemy.orm import Session
from sqlalchemy import desc
from pydantic import BaseModel

from app.database import get_db
from app.models.user import User
from app.models.scheduled_message import ScheduledMessage
from app.models.monitored_group import MonitoredGroup
from app.api.deps import get_current_user
from app.services.whatsapp_bridge import whatsapp_bridge
from app.services.websocket_manager import websocket_manager

router = APIRouter()


class SendBroadcastRequest(BaseModel):
    content: str
    group_ids: List[int]  # List of MonitoredGroup IDs
    mention_type: str = 'none'  # 'none', 'all', 'selected'
    mention_ids: Optional[List[str]] = None  # Phone numbers for 'selected' mentions
    scheduled_at: Optional[datetime] = None  # If None, send immediately


class SendPollRequest(BaseModel):
    question: str
    options: List[str]
    allow_multiple_answers: bool = False
    group_ids: List[int]  # List of MonitoredGroup IDs
    mention_type: str = 'none'  # 'none', 'all', 'selected'
    mention_ids: Optional[List[str]] = None  # Phone numbers for 'selected' mentions
    scheduled_at: Optional[datetime] = None  # If None, send immediately


class ScheduledMessageResponse(BaseModel):
    id: int
    content: str
    group_names: List[str]
    mention_type: str
    scheduled_at: datetime
    status: str
    groups_sent: int
    groups_failed: int
    error_message: Optional[str]
    created_at: datetime
    sent_at: Optional[datetime]


async def send_immediate_broadcast(
    user_id: int,
    scheduled_msg: ScheduledMessage,
    db: Session
):
    """Send broadcast immediately with 30-second delays between groups"""
    try:
        group_ids = scheduled_msg.group_ids or []
        groups_sent = 0
        groups_failed = 0
        errors = []
        has_media = bool(scheduled_msg.media_path)  # Media is on WhatsApp service's volume

        # Mark as sending
        scheduled_msg.status = 'sending'
        db.commit()

        for i, group_id in enumerate(group_ids):
            # 30-second delay between groups (except first)
            if i > 0:
                await asyncio.sleep(30)

            try:
                # Get the WhatsApp group ID
                group = db.query(MonitoredGroup).filter(
                    MonitoredGroup.id == group_id,
                    MonitoredGroup.user_id == user_id
                ).first()

                if not group:
                    errors.append(f"Group {group_id} not found")
                    groups_failed += 1
                    continue

                # Send the message (with or without media)
                if has_media:
                    # Media is on WhatsApp service's volume, use send_media_from_path
                    result = await whatsapp_bridge.send_media_from_path(
                        user_id=user_id,
                        group_id=group.whatsapp_group_id,
                        file_path=scheduled_msg.media_path,
                        caption=scheduled_msg.content,
                        mention_all=(scheduled_msg.mention_type == 'all'),
                        mention_ids=scheduled_msg.mention_ids if scheduled_msg.mention_type == 'selected' else None
                    )
                else:
                    result = await whatsapp_bridge.send_message(
                        user_id=user_id,
                        group_id=group.whatsapp_group_id,
                        content=scheduled_msg.content,
                        mention_all=(scheduled_msg.mention_type == 'all'),
                        mention_ids=scheduled_msg.mention_ids if scheduled_msg.mention_type == 'selected' else None
                    )

                if result.get('success'):
                    groups_sent += 1

                    # Notify progress via WebSocket
                    await websocket_manager.send_to_user(user_id, {
                        'type': 'broadcast_progress',
                        'message_id': scheduled_msg.id,
                        'group_name': group.group_name,
                        'groups_sent': groups_sent,
                        'total_groups': len(group_ids)
                    })
                else:
                    groups_failed += 1
                    error_msg = result.get('error', 'Unknown error')
                    errors.append(f"{group.group_name}: {error_msg}")

            except Exception as e:
                groups_failed += 1
                errors.append(f"Group {group_id}: {str(e)}")

        # Update final status
        scheduled_msg.groups_sent = groups_sent
        scheduled_msg.groups_failed = groups_failed
        scheduled_msg.sent_at = datetime.utcnow()

        if groups_failed == 0:
            scheduled_msg.status = 'sent'
        elif groups_sent == 0:
            scheduled_msg.status = 'failed'
        else:
            scheduled_msg.status = 'partially_sent'

        if errors:
            scheduled_msg.error_message = "; ".join(errors)

        # Clean up media file on WhatsApp service after broadcast
        if has_media:
            try:
                await whatsapp_bridge.delete_media(scheduled_msg.media_path)
            except Exception:
                pass

        db.commit()

        # Notify completion via WebSocket
        await websocket_manager.send_to_user(user_id, {
            'type': 'broadcast_complete',
            'message_id': scheduled_msg.id,
            'status': scheduled_msg.status,
            'groups_sent': groups_sent,
            'groups_failed': groups_failed,
            'error_message': scheduled_msg.error_message
        })

    except Exception as e:
        scheduled_msg.status = 'failed'
        scheduled_msg.error_message = str(e)
        db.commit()

        await websocket_manager.send_to_user(user_id, {
            'type': 'broadcast_complete',
            'message_id': scheduled_msg.id,
            'status': 'failed',
            'error_message': str(e)
        })


async def send_immediate_poll(
    user_id: int,
    scheduled_msg: ScheduledMessage,
    db: Session
):
    """Send poll immediately with 30-second delays between groups"""
    try:
        group_ids = scheduled_msg.group_ids or []
        groups_sent = 0
        groups_failed = 0
        errors = []

        # Mark as sending
        scheduled_msg.status = 'sending'
        db.commit()

        for i, group_id in enumerate(group_ids):
            # 30-second delay between groups (except first)
            if i > 0:
                await asyncio.sleep(30)

            try:
                # Get the WhatsApp group ID
                group = db.query(MonitoredGroup).filter(
                    MonitoredGroup.id == group_id,
                    MonitoredGroup.user_id == user_id
                ).first()

                if not group:
                    errors.append(f"Group {group_id} not found")
                    groups_failed += 1
                    continue

                # Send the poll with mention support
                result = await whatsapp_bridge.send_poll(
                    user_id=user_id,
                    group_id=group.whatsapp_group_id,
                    question=scheduled_msg.content,  # Poll question stored in content
                    options=scheduled_msg.poll_options or [],
                    allow_multiple_answers=scheduled_msg.poll_allow_multiple or False,
                    mention_all=(scheduled_msg.mention_type == 'all'),
                    mention_ids=scheduled_msg.mention_ids if scheduled_msg.mention_type == 'selected' else None
                )

                if result.get('success'):
                    groups_sent += 1

                    # Notify progress via WebSocket
                    await websocket_manager.send_to_user(user_id, {
                        'type': 'poll_progress',
                        'message_id': scheduled_msg.id,
                        'group_name': group.group_name,
                        'groups_sent': groups_sent,
                        'total_groups': len(group_ids)
                    })
                else:
                    groups_failed += 1
                    error_msg = result.get('error', 'Unknown error')
                    errors.append(f"{group.group_name}: {error_msg}")

            except Exception as e:
                groups_failed += 1
                errors.append(f"Group {group_id}: {str(e)}")

        # Update final status
        scheduled_msg.groups_sent = groups_sent
        scheduled_msg.groups_failed = groups_failed
        scheduled_msg.sent_at = datetime.utcnow()

        if groups_failed == 0:
            scheduled_msg.status = 'sent'
        elif groups_sent == 0:
            scheduled_msg.status = 'failed'
        else:
            scheduled_msg.status = 'partially_sent'

        if errors:
            scheduled_msg.error_message = "; ".join(errors)

        db.commit()

        # Notify completion via WebSocket
        await websocket_manager.send_to_user(user_id, {
            'type': 'poll_complete',
            'message_id': scheduled_msg.id,
            'status': scheduled_msg.status,
            'groups_sent': groups_sent,
            'groups_failed': groups_failed,
            'error_message': scheduled_msg.error_message
        })

    except Exception as e:
        scheduled_msg.status = 'failed'
        scheduled_msg.error_message = str(e)
        db.commit()

        await websocket_manager.send_to_user(user_id, {
            'type': 'poll_complete',
            'message_id': scheduled_msg.id,
            'status': 'failed',
            'error_message': str(e)
        })


@router.post("/send")
async def send_broadcast(
    request: SendBroadcastRequest,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Send a broadcast message to multiple groups (immediate or scheduled)"""

    if not request.content:
        raise HTTPException(status_code=400, detail="Message content is required")

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

    # Determine scheduled time
    if request.scheduled_at:
        # Convert to naive datetime for comparison
        scheduled_at = request.scheduled_at.replace(tzinfo=None) if request.scheduled_at.tzinfo else request.scheduled_at
        # Validate scheduled time is in the future
        if scheduled_at <= datetime.utcnow():
            raise HTTPException(status_code=400, detail="Scheduled time must be in the future")
        status = 'pending'
    else:
        # Immediate send - set status to 'sending' so scheduler doesn't pick it up
        scheduled_at = datetime.utcnow()
        status = 'sending'

    # Create scheduled message record
    scheduled_msg = ScheduledMessage(
        user_id=current_user.id,
        content=request.content,
        group_ids=request.group_ids,
        group_names=group_names,
        mention_type=request.mention_type,
        mention_ids=request.mention_ids,
        scheduled_at=scheduled_at,
        status=status
    )
    db.add(scheduled_msg)
    db.commit()
    db.refresh(scheduled_msg)

    # If immediate send, execute in background
    if not request.scheduled_at:
        background_tasks.add_task(
            send_immediate_broadcast,
            current_user.id,
            scheduled_msg,
            db
        )

    return {
        "success": True,
        "message_id": scheduled_msg.id,
        "scheduled": request.scheduled_at is not None,
        "scheduled_at": scheduled_at.isoformat() if request.scheduled_at else None,
        "groups": group_names
    }


@router.post("/send-media")
async def send_broadcast_with_media(
    background_tasks: BackgroundTasks,
    media: UploadFile = File(...),
    content: str = Form(default=""),
    group_ids: str = Form(...),
    mention_type: str = Form(default="none"),
    mention_ids: Optional[str] = Form(default=None),
    scheduled_at: Optional[str] = Form(default=None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Send a broadcast message with media to multiple groups (immediate or scheduled)"""
    import json
    import tempfile
    import shutil

    # Parse group_ids from JSON string
    try:
        parsed_group_ids = json.loads(group_ids)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid group_ids format")

    if not parsed_group_ids:
        raise HTTPException(status_code=400, detail="At least one group is required")

    if mention_type not in ['none', 'all', 'selected']:
        raise HTTPException(status_code=400, detail="Invalid mention_type")

    # Parse mention_ids if provided
    parsed_mention_ids = None
    if mention_ids:
        try:
            parsed_mention_ids = json.loads(mention_ids)
        except json.JSONDecodeError:
            parsed_mention_ids = None

    if mention_type == 'selected' and not parsed_mention_ids:
        raise HTTPException(status_code=400, detail="mention_ids required for 'selected' mention_type")

    # Validate groups belong to user
    groups = db.query(MonitoredGroup).filter(
        MonitoredGroup.id.in_(parsed_group_ids),
        MonitoredGroup.user_id == current_user.id,
        MonitoredGroup.is_active == True
    ).all()

    if len(groups) != len(parsed_group_ids):
        raise HTTPException(status_code=400, detail="One or more groups not found or not active")

    group_names = [g.group_name for g in groups]

    # Save uploaded file temporarily
    file_extension = os.path.splitext(media.filename)[1] if media.filename else ""
    with tempfile.NamedTemporaryFile(delete=False, suffix=file_extension) as temp_file:
        shutil.copyfileobj(media.file, temp_file)
        temp_filepath = temp_file.name

    # Upload media to WhatsApp service's persistent volume
    try:
        upload_result = await whatsapp_bridge.upload_media(temp_filepath)
        if not upload_result.get('success'):
            os.remove(temp_filepath)
            raise HTTPException(status_code=500, detail=f"Failed to upload media: {upload_result.get('error')}")

        # Get the path on WhatsApp service's volume
        remote_media_path = upload_result.get('filePath')
        print(f"[BROADCAST] Media uploaded to WhatsApp service: {remote_media_path}", flush=True)
    finally:
        # Clean up local temp file
        if os.path.exists(temp_filepath):
            os.remove(temp_filepath)

    # Determine scheduled time
    parsed_scheduled_at = None
    if scheduled_at:
        try:
            # Parse and convert to naive UTC datetime for comparison
            parsed_scheduled_at = datetime.fromisoformat(scheduled_at.replace('Z', '+00:00'))
            # Remove timezone info for consistent comparison with utcnow()
            parsed_scheduled_at = parsed_scheduled_at.replace(tzinfo=None)
            if parsed_scheduled_at <= datetime.utcnow():
                # Clean up remote media
                await whatsapp_bridge.delete_media(remote_media_path)
                raise HTTPException(status_code=400, detail="Scheduled time must be in the future")
        except ValueError:
            await whatsapp_bridge.delete_media(remote_media_path)
            raise HTTPException(status_code=400, detail="Invalid scheduled_at format")

    final_scheduled_at = parsed_scheduled_at if parsed_scheduled_at else datetime.utcnow()
    # Set status to 'sending' for immediate sends so scheduler doesn't pick it up
    status_val = 'pending' if parsed_scheduled_at else 'sending'

    # Create scheduled message record with remote path
    scheduled_msg = ScheduledMessage(
        user_id=current_user.id,
        content=content or "",
        media_path=remote_media_path,  # Store path on WhatsApp service's volume
        group_ids=parsed_group_ids,
        group_names=group_names,
        mention_type=mention_type,
        mention_ids=parsed_mention_ids,
        scheduled_at=final_scheduled_at,
        status=status_val
    )
    db.add(scheduled_msg)
    db.commit()
    db.refresh(scheduled_msg)

    # If immediate send, execute in background
    if not parsed_scheduled_at:
        background_tasks.add_task(
            send_immediate_broadcast,
            current_user.id,
            scheduled_msg,
            db
        )

    return {
        "success": True,
        "message_id": scheduled_msg.id,
        "scheduled": parsed_scheduled_at is not None,
        "scheduled_at": final_scheduled_at.isoformat() if parsed_scheduled_at else None,
        "groups": group_names,
        "has_media": True
    }


@router.get("/scheduled")
def get_scheduled_messages(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get all pending scheduled broadcast messages for the current user"""
    from sqlalchemy import or_
    messages = db.query(ScheduledMessage).filter(
        ScheduledMessage.user_id == current_user.id,
        ScheduledMessage.status == 'pending',
        or_(
            ScheduledMessage.task_type == 'broadcast',
            ScheduledMessage.task_type == 'poll',
            ScheduledMessage.task_type.is_(None)
        )
    ).order_by(ScheduledMessage.scheduled_at).all()

    return [
        {
            "id": msg.id,
            "task_type": msg.task_type or 'broadcast',
            "content": (msg.content[:100] + "..." if len(msg.content) > 100 else msg.content) if msg.content else "",
            "group_names": msg.group_names or [],
            "mention_type": msg.mention_type,
            "scheduled_at": msg.scheduled_at.isoformat() if msg.scheduled_at else None,
            "status": msg.status,
            "created_at": msg.created_at.isoformat() if msg.created_at else None,
            "poll_options": msg.poll_options if msg.task_type == 'poll' else None
        }
        for msg in messages
    ]


@router.get("/history")
def get_broadcast_history(
    limit: int = Query(default=50, le=100),
    offset: int = 0,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get broadcast history (sent, failed, partially_sent)"""
    from sqlalchemy import or_
    query = db.query(ScheduledMessage).filter(
        ScheduledMessage.user_id == current_user.id,
        ScheduledMessage.status.in_(['sent', 'failed', 'partially_sent', 'cancelled']),
        or_(
            ScheduledMessage.task_type == 'broadcast',
            ScheduledMessage.task_type == 'poll',
            ScheduledMessage.task_type.is_(None)
        )
    )

    total = query.count()

    messages = query.order_by(desc(ScheduledMessage.sent_at))\
        .offset(offset)\
        .limit(limit)\
        .all()

    return {
        "broadcasts": [
            {
                "id": msg.id,
                "task_type": msg.task_type or 'broadcast',
                "content": (msg.content[:100] + "..." if len(msg.content) > 100 else msg.content) if msg.content else "",
                "group_names": msg.group_names or [],
                "mention_type": msg.mention_type,
                "scheduled_at": msg.scheduled_at.isoformat() if msg.scheduled_at else None,
                "sent_at": msg.sent_at.isoformat() if msg.sent_at else None,
                "status": msg.status,
                "groups_sent": msg.groups_sent or 0,
                "groups_failed": msg.groups_failed or 0,
                "error_message": msg.error_message,
                "created_at": msg.created_at.isoformat() if msg.created_at else None,
                "poll_options": msg.poll_options if msg.task_type == 'poll' else None
            }
            for msg in messages
        ],
        "total": total
    }


@router.delete("/scheduled/{message_id}")
def cancel_scheduled_message(
    message_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Cancel a pending scheduled message"""
    message = db.query(ScheduledMessage).filter(
        ScheduledMessage.id == message_id,
        ScheduledMessage.user_id == current_user.id
    ).first()

    if not message:
        raise HTTPException(status_code=404, detail="Scheduled message not found")

    if message.status != 'pending':
        raise HTTPException(
            status_code=400,
            detail=f"Cannot cancel message with status '{message.status}'"
        )

    message.status = 'cancelled'
    db.commit()

    return {"success": True, "message": "Scheduled message cancelled"}


@router.post("/send-poll")
async def send_poll_broadcast(
    request: SendPollRequest,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Send a poll to multiple groups (immediate or scheduled)"""

    if not request.question:
        raise HTTPException(status_code=400, detail="Poll question is required")

    if not request.options or len(request.options) < 2:
        raise HTTPException(status_code=400, detail="Poll must have at least 2 options")

    if len(request.options) > 12:
        raise HTTPException(status_code=400, detail="Poll cannot have more than 12 options")

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

    # Determine scheduled time
    if request.scheduled_at:
        # Convert to naive datetime for comparison
        scheduled_at = request.scheduled_at.replace(tzinfo=None) if request.scheduled_at.tzinfo else request.scheduled_at
        # Validate scheduled time is in the future
        if scheduled_at <= datetime.utcnow():
            raise HTTPException(status_code=400, detail="Scheduled time must be in the future")
        status = 'pending'
    else:
        # Immediate send - set status to 'sending' so scheduler doesn't pick it up
        scheduled_at = datetime.utcnow()
        status = 'sending'

    # Create scheduled message record with task_type='poll'
    scheduled_msg = ScheduledMessage(
        user_id=current_user.id,
        task_type='poll',
        content=request.question,  # Store poll question in content
        poll_options=request.options,
        poll_allow_multiple=request.allow_multiple_answers,
        group_ids=request.group_ids,
        group_names=group_names,
        mention_type=request.mention_type,
        mention_ids=request.mention_ids,
        scheduled_at=scheduled_at,
        status=status
    )
    db.add(scheduled_msg)
    db.commit()
    db.refresh(scheduled_msg)

    # If immediate send, execute in background
    if not request.scheduled_at:
        background_tasks.add_task(
            send_immediate_poll,
            current_user.id,
            scheduled_msg,
            db
        )

    return {
        "success": True,
        "message_id": scheduled_msg.id,
        "scheduled": request.scheduled_at is not None,
        "scheduled_at": scheduled_at.isoformat() if request.scheduled_at else None,
        "groups": group_names
    }


@router.get("/{message_id}")
def get_broadcast_details(
    message_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get details of a specific broadcast message"""
    message = db.query(ScheduledMessage).filter(
        ScheduledMessage.id == message_id,
        ScheduledMessage.user_id == current_user.id
    ).first()

    if not message:
        raise HTTPException(status_code=404, detail="Message not found")

    return {
        "id": message.id,
        "content": message.content,
        "group_names": message.group_names or [],
        "mention_type": message.mention_type,
        "mention_ids": message.mention_ids,
        "scheduled_at": message.scheduled_at.isoformat() if message.scheduled_at else None,
        "sent_at": message.sent_at.isoformat() if message.sent_at else None,
        "status": message.status,
        "groups_sent": message.groups_sent or 0,
        "groups_failed": message.groups_failed or 0,
        "error_message": message.error_message,
        "created_at": message.created_at.isoformat() if message.created_at else None
    }
