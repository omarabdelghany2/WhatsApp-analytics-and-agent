import os
import shutil
import uuid
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, File, UploadFile, Form
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.database import get_db
from app.models.user import User
from app.models.monitored_group import MonitoredGroup
from app.api.deps import get_current_user

router = APIRouter()

# Directory for welcome images
WELCOME_IMAGE_DIR = "/tmp/welcome_images"
os.makedirs(WELCOME_IMAGE_DIR, exist_ok=True)


class WelcomeSettingsUpdate(BaseModel):
    group_ids: List[int]  # Groups to apply settings to
    enabled: bool
    threshold: int = 1  # Number of consecutive joins to trigger
    text: Optional[str] = None  # Part 1 text
    extra_mentions: Optional[List[str]] = None  # Phone numbers to mention at end
    part2_enabled: bool = False
    part2_text: Optional[str] = None
    # part2_image is handled separately via upload


class WelcomeSettingsResponse(BaseModel):
    id: int
    group_name: str
    whatsapp_group_id: str
    welcome_enabled: bool
    welcome_threshold: int
    welcome_join_count: int
    welcome_text: Optional[str]
    welcome_part2_enabled: bool
    welcome_part2_text: Optional[str]
    welcome_part2_image: Optional[str]


@router.get("/")
def get_all_welcome_settings(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get welcome settings for all monitored groups"""
    groups = db.query(MonitoredGroup).filter(
        MonitoredGroup.user_id == current_user.id,
        MonitoredGroup.is_active == True
    ).all()

    return {
        "groups": [
            {
                "id": g.id,
                "group_name": g.group_name,
                "whatsapp_group_id": g.whatsapp_group_id,
                "welcome_enabled": g.welcome_enabled or False,
                "welcome_threshold": g.welcome_threshold or 1,
                "welcome_join_count": g.welcome_join_count or 0,
                "welcome_text": g.welcome_text,
                "welcome_extra_mentions": g.welcome_extra_mentions or [],
                "welcome_part2_enabled": g.welcome_part2_enabled or False,
                "welcome_part2_text": g.welcome_part2_text,
                "welcome_part2_image": g.welcome_part2_image
            }
            for g in groups
        ]
    }


@router.get("/{group_id}")
def get_welcome_settings(
    group_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get welcome settings for a specific group"""
    group = db.query(MonitoredGroup).filter(
        MonitoredGroup.id == group_id,
        MonitoredGroup.user_id == current_user.id
    ).first()

    if not group:
        raise HTTPException(status_code=404, detail="Group not found")

    return {
        "id": group.id,
        "group_name": group.group_name,
        "whatsapp_group_id": group.whatsapp_group_id,
        "welcome_enabled": group.welcome_enabled or False,
        "welcome_threshold": group.welcome_threshold or 1,
        "welcome_join_count": group.welcome_join_count or 0,
        "welcome_pending_joiners": group.welcome_pending_joiners or [],
        "welcome_text": group.welcome_text,
        "welcome_extra_mentions": group.welcome_extra_mentions or [],
        "welcome_part2_enabled": group.welcome_part2_enabled or False,
        "welcome_part2_text": group.welcome_part2_text,
        "welcome_part2_image": group.welcome_part2_image
    }


@router.put("/bulk")
def update_welcome_settings_bulk(
    request: WelcomeSettingsUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Update welcome settings for multiple groups at once"""
    if not request.group_ids:
        raise HTTPException(status_code=400, detail="At least one group is required")

    if request.threshold < 1:
        raise HTTPException(status_code=400, detail="Threshold must be at least 1")

    # Verify all groups belong to user
    groups = db.query(MonitoredGroup).filter(
        MonitoredGroup.id.in_(request.group_ids),
        MonitoredGroup.user_id == current_user.id,
        MonitoredGroup.is_active == True
    ).all()

    if len(groups) != len(request.group_ids):
        raise HTTPException(status_code=400, detail="One or more groups not found")

    updated_count = 0
    for group in groups:
        group.welcome_enabled = request.enabled
        group.welcome_threshold = request.threshold
        group.welcome_text = request.text
        group.welcome_extra_mentions = request.extra_mentions or []
        group.welcome_part2_enabled = request.part2_enabled
        group.welcome_part2_text = request.part2_text
        # Reset counters when settings change
        group.welcome_join_count = 0
        group.welcome_pending_joiners = []
        updated_count += 1

    db.commit()

    return {
        "success": True,
        "updated_count": updated_count,
        "groups": [g.group_name for g in groups]
    }


@router.put("/{group_id}")
def update_welcome_settings(
    group_id: int,
    enabled: Optional[bool] = None,
    threshold: Optional[int] = None,
    text: Optional[str] = None,
    part2_enabled: Optional[bool] = None,
    part2_text: Optional[str] = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Update welcome settings for a specific group"""
    group = db.query(MonitoredGroup).filter(
        MonitoredGroup.id == group_id,
        MonitoredGroup.user_id == current_user.id
    ).first()

    if not group:
        raise HTTPException(status_code=404, detail="Group not found")

    if enabled is not None:
        group.welcome_enabled = enabled
    if threshold is not None:
        if threshold < 1:
            raise HTTPException(status_code=400, detail="Threshold must be at least 1")
        group.welcome_threshold = threshold
    if text is not None:
        group.welcome_text = text
    if part2_enabled is not None:
        group.welcome_part2_enabled = part2_enabled
    if part2_text is not None:
        group.welcome_part2_text = part2_text

    db.commit()

    return {
        "success": True,
        "group_name": group.group_name,
        "welcome_enabled": group.welcome_enabled
    }


@router.post("/upload-image")
async def upload_welcome_image(
    group_ids: str = Form(...),  # Comma-separated group IDs
    image: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Upload welcome image for Part 2 and apply to multiple groups"""
    # Parse group IDs
    try:
        parsed_group_ids = [int(gid.strip()) for gid in group_ids.split(",")]
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid group_ids format")

    if not parsed_group_ids:
        raise HTTPException(status_code=400, detail="At least one group is required")

    # Verify groups belong to user
    groups = db.query(MonitoredGroup).filter(
        MonitoredGroup.id.in_(parsed_group_ids),
        MonitoredGroup.user_id == current_user.id
    ).all()

    if len(groups) != len(parsed_group_ids):
        raise HTTPException(status_code=400, detail="One or more groups not found")

    # Validate file type
    allowed_types = ["image/jpeg", "image/png", "image/gif", "image/webp"]
    if image.content_type not in allowed_types:
        raise HTTPException(status_code=400, detail="Only image files are allowed")

    # Save the image
    file_extension = os.path.splitext(image.filename)[1] if image.filename else ".jpg"
    unique_filename = f"welcome_{current_user.id}_{uuid.uuid4()}{file_extension}"
    file_path = os.path.join(WELCOME_IMAGE_DIR, unique_filename)

    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(image.file, buffer)

    # Update all selected groups with the new image path
    for group in groups:
        # Delete old image if exists
        if group.welcome_part2_image and os.path.exists(group.welcome_part2_image):
            try:
                os.remove(group.welcome_part2_image)
            except Exception:
                pass
        group.welcome_part2_image = file_path

    db.commit()

    return {
        "success": True,
        "image_path": file_path,
        "groups_updated": len(groups)
    }


@router.delete("/{group_id}/image")
def delete_welcome_image(
    group_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Delete welcome image for a group"""
    group = db.query(MonitoredGroup).filter(
        MonitoredGroup.id == group_id,
        MonitoredGroup.user_id == current_user.id
    ).first()

    if not group:
        raise HTTPException(status_code=404, detail="Group not found")

    if group.welcome_part2_image:
        if os.path.exists(group.welcome_part2_image):
            try:
                os.remove(group.welcome_part2_image)
            except Exception:
                pass
        group.welcome_part2_image = None
        db.commit()

    return {"success": True}


@router.post("/{group_id}/reset-counter")
def reset_welcome_counter(
    group_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Reset the join counter for a group"""
    group = db.query(MonitoredGroup).filter(
        MonitoredGroup.id == group_id,
        MonitoredGroup.user_id == current_user.id
    ).first()

    if not group:
        raise HTTPException(status_code=404, detail="Group not found")

    group.welcome_join_count = 0
    group.welcome_pending_joiners = []
    db.commit()

    return {"success": True, "message": "Counter reset"}


@router.post("/disable-all")
def disable_all_welcome_messages(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Disable welcome messages for all groups"""
    groups = db.query(MonitoredGroup).filter(
        MonitoredGroup.user_id == current_user.id,
        MonitoredGroup.welcome_enabled == True
    ).all()

    for group in groups:
        group.welcome_enabled = False

    db.commit()

    return {"success": True, "disabled_count": len(groups)}
