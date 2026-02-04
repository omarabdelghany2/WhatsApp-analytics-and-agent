from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from datetime import datetime

from app.database import get_db
from app.models.user import User
from app.models.whatsapp_session import WhatsAppSession
from app.schemas.whatsapp import WhatsAppStatus, QRCodeResponse, InitResponse
from app.schemas.group import AvailableGroup, AvailableGroupsResponse
from app.api.deps import get_current_user
from app.services.whatsapp_bridge import whatsapp_bridge

router = APIRouter()


@router.get("/status", response_model=WhatsAppStatus)
async def get_status(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get WhatsApp connection status"""
    # Check local database first
    session = db.query(WhatsAppSession).filter(
        WhatsAppSession.user_id == current_user.id
    ).first()

    if not session:
        return WhatsAppStatus(
            status="not_initialized",
            is_authenticated=False,
            phone_number=None,
            has_qr=False
        )

    # Get real-time status from WhatsApp service
    status_data = await whatsapp_bridge.get_status(current_user.id)

    return WhatsAppStatus(
        status=status_data.get("status", session.auth_status),
        is_authenticated=session.is_authenticated,
        phone_number=session.phone_number,
        has_qr=status_data.get("hasQR", False)
    )


@router.post("/init", response_model=InitResponse)
async def init_whatsapp(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Initialize WhatsApp client"""
    # Create or update session record
    session = db.query(WhatsAppSession).filter(
        WhatsAppSession.user_id == current_user.id
    ).first()

    if not session:
        session = WhatsAppSession(
            user_id=current_user.id,
            session_id=f"user_{current_user.id}",
            auth_status="initializing"
        )
        db.add(session)
        db.commit()
    else:
        session.auth_status = "initializing"
        db.commit()

    # Initialize client in WhatsApp service
    result = await whatsapp_bridge.init_client(current_user.id)

    if result.get("success"):
        session.auth_status = result.get("status", "initializing")
        db.commit()

    return InitResponse(
        success=result.get("success", False),
        status=result.get("status", "error"),
        message=result.get("message")
    )


@router.get("/qr", response_model=QRCodeResponse)
async def get_qr_code(
    current_user: User = Depends(get_current_user)
):
    """Get current QR code for scanning"""
    result = await whatsapp_bridge.get_qr_code(current_user.id)

    return QRCodeResponse(
        qr=result.get("qr"),
        status=result.get("status", "unknown"),
        has_qr=result.get("hasQR", False)
    )


@router.post("/logout")
async def logout_whatsapp(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Logout from WhatsApp"""
    # Logout from WhatsApp service
    result = await whatsapp_bridge.logout_client(current_user.id)

    # Update session status
    session = db.query(WhatsAppSession).filter(
        WhatsAppSession.user_id == current_user.id
    ).first()

    if session:
        session.auth_status = "disconnected"
        session.is_authenticated = False
        db.commit()

    return {"success": result.get("success", False)}


@router.get("/available-groups", response_model=AvailableGroupsResponse)
async def get_available_groups(
    current_user: User = Depends(get_current_user)
):
    """Get all WhatsApp groups available for monitoring"""
    result = await whatsapp_bridge.get_groups(current_user.id)

    if not result.get("success"):
        raise HTTPException(
            status_code=400,
            detail=result.get("error", "Failed to get groups")
        )

    groups = [
        AvailableGroup(
            id=g["id"],
            name=g["name"],
            participant_count=g.get("participantCount", 0)
        )
        for g in result.get("groups", [])
    ]

    return AvailableGroupsResponse(success=True, groups=groups)


@router.get("/groups/{whatsapp_group_id}/members")
async def get_group_members(
    whatsapp_group_id: str,
    current_user: User = Depends(get_current_user)
):
    """Get members of a specific WhatsApp group"""
    result = await whatsapp_bridge.get_group_members(current_user.id, whatsapp_group_id)

    if not result.get("success"):
        raise HTTPException(
            status_code=400,
            detail=result.get("error", "Failed to get group members")
        )

    return {
        "success": True,
        "members": result.get("members", [])
    }


@router.get("/channels")
async def get_channels(
    current_user: User = Depends(get_current_user)
):
    """Get all WhatsApp channels the user follows or owns"""
    result = await whatsapp_bridge.get_channels(current_user.id)

    if not result.get("success"):
        raise HTTPException(
            status_code=400,
            detail=result.get("error", "Failed to get channels")
        )

    return {
        "success": True,
        "channels": result.get("channels", [])
    }
