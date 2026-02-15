import httpx
import json
import os
from typing import Optional, List, Dict, Any
from app.config import settings


class WhatsAppBridge:
    """Bridge to communicate with Node.js WhatsApp service"""

    def __init__(self):
        self.base_url = settings.whatsapp_service_url

    async def init_client(self, user_id: int) -> Dict[str, Any]:
        """Initialize WhatsApp client for a user"""
        async with httpx.AsyncClient() as client:
            try:
                response = await client.post(
                    f"{self.base_url}/api/clients/{user_id}/init",
                    timeout=30.0
                )
                return response.json()
            except httpx.RequestError as e:
                return {"success": False, "error": str(e), "status": "error"}

    async def get_status(self, user_id: int) -> Dict[str, Any]:
        """Get WhatsApp client status"""
        async with httpx.AsyncClient() as client:
            try:
                response = await client.get(
                    f"{self.base_url}/api/clients/{user_id}/status",
                    timeout=10.0
                )
                return response.json()
            except httpx.RequestError as e:
                return {"status": "not_initialized", "hasQR": False, "error": str(e)}

    async def get_qr_code(self, user_id: int) -> Dict[str, Any]:
        """Get current QR code for user"""
        async with httpx.AsyncClient() as client:
            try:
                response = await client.get(
                    f"{self.base_url}/api/clients/{user_id}/qr",
                    timeout=10.0
                )
                return response.json()
            except httpx.RequestError as e:
                return {"qr": None, "status": "error", "hasQR": False, "error": str(e)}

    async def get_groups(self, user_id: int) -> Dict[str, Any]:
        """Get all WhatsApp groups for user"""
        async with httpx.AsyncClient() as client:
            try:
                response = await client.get(
                    f"{self.base_url}/api/clients/{user_id}/groups",
                    timeout=120.0  # Increased timeout - groups fetch can take a while with operation queue
                )
                return response.json()
            except httpx.ReadTimeout:
                return {"success": False, "groups": [], "error": "Request timed out - WhatsApp service is busy. Please try again."}
            except httpx.RequestError as e:
                return {"success": False, "groups": [], "error": str(e)}

    async def logout_client(self, user_id: int) -> Dict[str, Any]:
        """Logout and destroy WhatsApp client"""
        async with httpx.AsyncClient() as client:
            try:
                response = await client.post(
                    f"{self.base_url}/api/clients/{user_id}/logout",
                    timeout=30.0
                )
                return response.json()
            except httpx.RequestError as e:
                return {"success": False, "error": str(e)}

    async def get_group_members(self, user_id: int, group_id: str) -> Dict[str, Any]:
        """Get members of a specific group"""
        async with httpx.AsyncClient() as client:
            try:
                response = await client.get(
                    f"{self.base_url}/api/clients/{user_id}/groups/{group_id}/members",
                    timeout=120.0  # Increased timeout for operation queue
                )
                return response.json()
            except httpx.ReadTimeout:
                return {"success": False, "members": [], "error": "Request timed out - WhatsApp service is busy. Please try again."}
            except httpx.RequestError as e:
                return {"success": False, "members": [], "error": str(e)}

    async def send_message(
        self,
        user_id: int,
        group_id: str,
        content: str,
        mention_all: bool = False,
        mention_ids: Optional[List[str]] = None
    ) -> Dict[str, Any]:
        """Send a message to a group with optional mentions"""
        async with httpx.AsyncClient() as client:
            try:
                response = await client.post(
                    f"{self.base_url}/api/clients/{user_id}/groups/{group_id}/send",
                    json={
                        "content": content,
                        "mentionAll": mention_all,
                        "mentionIds": mention_ids or []
                    },
                    timeout=60.0  # Longer timeout for sending
                )
                return response.json()
            except httpx.ReadTimeout:
                return {"success": False, "error": "Request timed out - WhatsApp service is busy"}
            except httpx.RequestError as e:
                return {"success": False, "error": str(e)}

    async def send_media_message(
        self,
        user_id: int,
        group_id: str,
        file_path: str,
        caption: str = "",
        mention_all: bool = False,
        mention_ids: Optional[List[str]] = None
    ) -> Dict[str, Any]:
        """Send a media message to a group with optional caption and mentions"""
        async with httpx.AsyncClient() as client:
            try:
                # Prepare the file upload
                filename = os.path.basename(file_path)
                with open(file_path, 'rb') as f:
                    files = {'media': (filename, f, 'application/octet-stream')}
                    data = {
                        'caption': caption,
                        'mentionAll': str(mention_all).lower(),
                        'mentionIds': json.dumps(mention_ids or [])
                    }

                    response = await client.post(
                        f"{self.base_url}/api/clients/{user_id}/groups/{group_id}/send-media",
                        files=files,
                        data=data,
                        timeout=120.0  # Longer timeout for media uploads
                    )
                    return response.json()
            except httpx.RequestError as e:
                return {"success": False, "error": str(e)}

    async def set_group_admin_only(
        self,
        user_id: int,
        group_id: str,
        admin_only: bool
    ) -> Dict[str, Any]:
        """Set whether only admins can send messages in a group"""
        async with httpx.AsyncClient() as client:
            try:
                response = await client.post(
                    f"{self.base_url}/api/clients/{user_id}/groups/{group_id}/settings",
                    json={"messagesAdminOnly": admin_only},
                    timeout=120.0  # Increased timeout for operation queue
                )
                return response.json()
            except httpx.ReadTimeout:
                return {"success": False, "error": "Request timed out - WhatsApp service is busy. Please try again."}
            except httpx.RequestError as e:
                return {"success": False, "error": str(e)}

    async def send_welcome_message(
        self,
        user_id: int,
        group_id: str,
        content: str,
        joiner_phones: List[str],
        extra_mention_phones: Optional[List[str]] = None
    ) -> Dict[str, Any]:
        """Send a welcome message with clickable mentions by phone numbers"""
        async with httpx.AsyncClient() as client:
            try:
                response = await client.post(
                    f"{self.base_url}/api/clients/{user_id}/groups/{group_id}/send-welcome",
                    json={
                        "content": content,
                        "joinerPhones": joiner_phones,
                        "extraMentionPhones": extra_mention_phones or []
                    },
                    timeout=60.0
                )
                return response.json()
            except httpx.RequestError as e:
                return {"success": False, "error": str(e)}

    async def send_poll(
        self,
        user_id: int,
        group_id: str,
        question: str,
        options: List[str],
        allow_multiple_answers: bool = False,
        mention_all: bool = False,
        mention_ids: Optional[List[str]] = None
    ) -> Dict[str, Any]:
        """Send a poll to a group with optional mentions"""
        async with httpx.AsyncClient() as client:
            try:
                response = await client.post(
                    f"{self.base_url}/api/clients/{user_id}/groups/{group_id}/send-poll",
                    json={
                        "question": question,
                        "options": options,
                        "allowMultipleAnswers": allow_multiple_answers,
                        "mentionAll": mention_all,
                        "mentionIds": mention_ids or []
                    },
                    timeout=60.0
                )
                return response.json()
            except httpx.ReadTimeout:
                return {"success": False, "error": "Request timed out - WhatsApp service is busy"}
            except httpx.RequestError as e:
                return {"success": False, "error": str(e)}

    async def upload_media(self, file_path: str) -> Dict[str, Any]:
        """Upload media to WhatsApp service's persistent volume for scheduled broadcasts"""
        async with httpx.AsyncClient() as client:
            try:
                filename = os.path.basename(file_path)
                with open(file_path, 'rb') as f:
                    files = {'media': (filename, f, 'application/octet-stream')}
                    response = await client.post(
                        f"{self.base_url}/api/clients/upload-media",
                        files=files,
                        timeout=120.0
                    )
                    return response.json()
            except httpx.RequestError as e:
                return {"success": False, "error": str(e)}

    async def send_media_from_path(
        self,
        user_id: int,
        group_id: str,
        file_path: str,
        caption: str = "",
        mention_all: bool = False,
        mention_ids: Optional[List[str]] = None
    ) -> Dict[str, Any]:
        """Send media from a stored path on WhatsApp service"""
        async with httpx.AsyncClient() as client:
            try:
                response = await client.post(
                    f"{self.base_url}/api/clients/{user_id}/groups/{group_id}/send-media-from-path",
                    json={
                        "filePath": file_path,
                        "caption": caption,
                        "mentionAll": mention_all,
                        "mentionIds": mention_ids or []
                    },
                    timeout=120.0
                )
                return response.json()
            except httpx.ReadTimeout:
                return {"success": False, "error": "Request timed out - WhatsApp service is busy"}
            except httpx.RequestError as e:
                return {"success": False, "error": str(e)}

    async def delete_media(self, file_path: str) -> Dict[str, Any]:
        """Delete media file from WhatsApp service after broadcast"""
        async with httpx.AsyncClient() as client:
            try:
                response = await client.request(
                    "DELETE",
                    f"{self.base_url}/api/clients/media",
                    json={"filePath": file_path},
                    timeout=30.0
                )
                return response.json()
            except httpx.RequestError as e:
                return {"success": False, "error": str(e)}

    async def delete_user_session(self, user_id: int) -> Dict[str, Any]:
        """Delete user session files from WhatsApp service (for user deletion)"""
        async with httpx.AsyncClient() as client:
            try:
                response = await client.delete(
                    f"{self.base_url}/api/clients/{user_id}/session",
                    timeout=30.0
                )
                return response.json()
            except httpx.RequestError as e:
                return {"success": False, "error": str(e)}

    # ==================== CHANNEL METHODS ====================

    async def get_channels(self, user_id: int) -> Dict[str, Any]:
        """Get all WhatsApp channels for user"""
        async with httpx.AsyncClient() as client:
            try:
                response = await client.get(
                    f"{self.base_url}/api/clients/{user_id}/channels",
                    timeout=120.0
                )
                return response.json()
            except httpx.ReadTimeout:
                return {"success": False, "channels": [], "error": "Request timed out - WhatsApp service is busy. Please try again."}
            except httpx.RequestError as e:
                return {"success": False, "channels": [], "error": str(e)}

    async def send_channel_message(
        self,
        user_id: int,
        channel_id: str,
        content: str
    ) -> Dict[str, Any]:
        """Send a message to a channel"""
        async with httpx.AsyncClient() as client:
            try:
                response = await client.post(
                    f"{self.base_url}/api/clients/{user_id}/channels/{channel_id}/send",
                    json={"content": content},
                    timeout=60.0
                )
                return response.json()
            except httpx.RequestError as e:
                return {"success": False, "error": str(e)}

    async def send_channel_media_from_path(
        self,
        user_id: int,
        channel_id: str,
        file_path: str,
        caption: str = ""
    ) -> Dict[str, Any]:
        """Send media from a stored path to a channel"""
        async with httpx.AsyncClient() as client:
            try:
                response = await client.post(
                    f"{self.base_url}/api/clients/{user_id}/channels/{channel_id}/send-media-from-path",
                    json={
                        "filePath": file_path,
                        "caption": caption
                    },
                    timeout=120.0
                )
                return response.json()
            except httpx.RequestError as e:
                return {"success": False, "error": str(e)}

    async def send_channel_poll(
        self,
        user_id: int,
        channel_id: str,
        question: str,
        options: List[str],
        allow_multiple_answers: bool = False
    ) -> Dict[str, Any]:
        """Send a poll to a channel"""
        async with httpx.AsyncClient() as client:
            try:
                response = await client.post(
                    f"{self.base_url}/api/clients/{user_id}/channels/{channel_id}/send-poll",
                    json={
                        "question": question,
                        "options": options,
                        "allowMultipleAnswers": allow_multiple_answers
                    },
                    timeout=60.0
                )
                return response.json()
            except httpx.RequestError as e:
                return {"success": False, "error": str(e)}


# Singleton instance
whatsapp_bridge = WhatsAppBridge()
