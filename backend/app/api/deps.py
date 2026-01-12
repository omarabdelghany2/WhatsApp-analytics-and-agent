from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session
from typing import Optional

from app.database import get_db
from app.models.user import User
from app.core.security import decode_token
from app.core.exceptions import CredentialsException, ForbiddenException

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")


def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db)
) -> User:
    """Get the current authenticated user"""
    print(f"[AUTH] Token received: {token[:20]}..." if token and len(token) > 20 else f"[AUTH] Token: {token}")

    payload = decode_token(token)
    if payload is None:
        print("[AUTH] Failed to decode token")
        raise CredentialsException()

    user_id_str = payload.get("sub")
    print(f"[AUTH] Decoded user_id: {user_id_str}")

    if user_id_str is None:
        print("[AUTH] No user_id in payload")
        raise CredentialsException()

    try:
        user_id = int(user_id_str)
    except (ValueError, TypeError):
        print(f"[AUTH] Invalid user_id format: {user_id_str}")
        raise CredentialsException()

    user = db.query(User).filter(User.id == user_id).first()
    if user is None:
        print(f"[AUTH] User {user_id} not found in database")
        raise CredentialsException("User not found")

    if not user.is_active:
        print(f"[AUTH] User {user_id} is inactive")
        raise CredentialsException("User is inactive")

    print(f"[AUTH] User authenticated: {user.email}")
    return user


def get_current_active_user(
    current_user: User = Depends(get_current_user)
) -> User:
    """Get current user and verify they are active"""
    if not current_user.is_active:
        raise HTTPException(status_code=400, detail="Inactive user")
    return current_user


def get_admin_user(
    current_user: User = Depends(get_current_user)
) -> User:
    """Get current user and verify they are an admin"""
    if not current_user.is_admin:
        raise ForbiddenException("Admin access required")
    return current_user


def get_optional_user(
    token: Optional[str] = Depends(oauth2_scheme),
    db: Session = Depends(get_db)
) -> Optional[User]:
    """Get the current user if authenticated, otherwise return None"""
    if not token:
        return None

    payload = decode_token(token)
    if payload is None:
        return None

    user_id_str = payload.get("sub")
    if user_id_str is None:
        return None

    try:
        user_id = int(user_id_str)
    except (ValueError, TypeError):
        return None

    user = db.query(User).filter(User.id == user_id).first()
    return user
