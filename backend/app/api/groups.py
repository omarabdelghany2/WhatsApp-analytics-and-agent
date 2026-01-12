import os
import shutil
import uuid
from fastapi import APIRouter, Depends, HTTPException, status, File, UploadFile, Form
from sqlalchemy.orm import Session
from typing import List, Optional
from pydantic import BaseModel

from app.database import get_db
from app.models.user import User
from app.models.monitored_group import MonitoredGroup
from app.schemas.group import GroupCreate, GroupResponse
from app.api.deps import get_current_user
from app.services.whatsapp_bridge import whatsapp_bridge

# Create uploads directory
UPLOAD_DIR = "/tmp/whatsapp_uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)


class SendMessageRequest(BaseModel):
    content: str
    mention_all: bool = False
    mention_ids: Optional[List[str]] = None

router = APIRouter()


@router.get("/", response_model=List[GroupResponse])
def get_groups(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get all monitored groups for current user"""
    groups = db.query(MonitoredGroup).filter(
        MonitoredGroup.user_id == current_user.id,
        MonitoredGroup.is_active == True
    ).all()
    return groups


@router.post("/", response_model=GroupResponse, status_code=status.HTTP_201_CREATED)
def add_group(
    group_data: GroupCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Add a group to monitoring"""
    # Check if group already monitored
    existing = db.query(MonitoredGroup).filter(
        MonitoredGroup.user_id == current_user.id,
        MonitoredGroup.whatsapp_group_id == group_data.whatsapp_group_id
    ).first()

    if existing:
        if existing.is_active:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Group is already being monitored"
            )
        # Reactivate the group
        existing.is_active = True
        existing.group_name = group_data.group_name
        existing.member_count = group_data.member_count
        db.commit()
        db.refresh(existing)
        return existing

    # Create new monitored group
    group = MonitoredGroup(
        user_id=current_user.id,
        whatsapp_group_id=group_data.whatsapp_group_id,
        group_name=group_data.group_name,
        member_count=group_data.member_count
    )
    db.add(group)
    db.commit()
    db.refresh(group)

    return group


@router.delete("/{group_id}")
def remove_group(
    group_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Remove a group from monitoring"""
    group = db.query(MonitoredGroup).filter(
        MonitoredGroup.id == group_id,
        MonitoredGroup.user_id == current_user.id
    ).first()

    if not group:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Group not found"
        )

    # Soft delete
    group.is_active = False
    db.commit()

    return {"success": True, "message": "Group removed from monitoring"}


@router.get("/{group_id}", response_model=GroupResponse)
def get_group(
    group_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get a specific group"""
    group = db.query(MonitoredGroup).filter(
        MonitoredGroup.id == group_id,
        MonitoredGroup.user_id == current_user.id
    ).first()

    if not group:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Group not found"
        )

    return group


@router.get("/{group_id}/members")
async def get_group_members(
    group_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get members of a specific group"""
    group = db.query(MonitoredGroup).filter(
        MonitoredGroup.id == group_id,
        MonitoredGroup.user_id == current_user.id
    ).first()

    if not group:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Group not found"
        )

    result = await whatsapp_bridge.get_group_members(
        current_user.id,
        group.whatsapp_group_id
    )

    return result


@router.post("/{group_id}/send")
async def send_message_to_group(
    group_id: int,
    request: SendMessageRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Send a text message to a group"""
    group = db.query(MonitoredGroup).filter(
        MonitoredGroup.id == group_id,
        MonitoredGroup.user_id == current_user.id,
        MonitoredGroup.is_active == True
    ).first()

    if not group:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Group not found"
        )

    result = await whatsapp_bridge.send_message(
        user_id=current_user.id,
        group_id=group.whatsapp_group_id,
        content=request.content,
        mention_all=request.mention_all,
        mention_ids=request.mention_ids
    )

    if not result.get('success'):
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=result.get('error', 'Failed to send message')
        )

    return result


@router.post("/{group_id}/send-media")
async def send_media_to_group(
    group_id: int,
    media: UploadFile = File(...),
    caption: Optional[str] = Form(default=""),
    mention_all: bool = Form(default=False),
    mention_ids: Optional[str] = Form(default=None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Send a media message to a group"""
    group = db.query(MonitoredGroup).filter(
        MonitoredGroup.id == group_id,
        MonitoredGroup.user_id == current_user.id,
        MonitoredGroup.is_active == True
    ).first()

    if not group:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Group not found"
        )

    # Save uploaded file temporarily
    file_extension = os.path.splitext(media.filename)[1] if media.filename else ""
    temp_filename = f"{uuid.uuid4()}{file_extension}"
    temp_filepath = os.path.join(UPLOAD_DIR, temp_filename)

    try:
        with open(temp_filepath, "wb") as buffer:
            shutil.copyfileobj(media.file, buffer)

        # Parse mention_ids if provided
        parsed_mention_ids = None
        if mention_ids:
            import json
            try:
                parsed_mention_ids = json.loads(mention_ids)
            except json.JSONDecodeError:
                parsed_mention_ids = None

        result = await whatsapp_bridge.send_media_message(
            user_id=current_user.id,
            group_id=group.whatsapp_group_id,
            file_path=temp_filepath,
            caption=caption or "",
            mention_all=mention_all,
            mention_ids=parsed_mention_ids
        )

        if not result.get('success'):
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=result.get('error', 'Failed to send media')
            )

        return result
    finally:
        # Clean up temp file
        if os.path.exists(temp_filepath):
            try:
                os.remove(temp_filepath)
            except Exception:
                pass
