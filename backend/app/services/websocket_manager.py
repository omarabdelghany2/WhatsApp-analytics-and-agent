from typing import Dict, List, Set
from fastapi import WebSocket
import json


class WebSocketManager:
    """Manage WebSocket connections for real-time updates"""

    def __init__(self):
        # Map user_id to set of active connections
        self.active_connections: Dict[int, Set[WebSocket]] = {}

    async def connect(self, websocket: WebSocket, user_id: int):
        """Accept a new WebSocket connection"""
        await websocket.accept()
        if user_id not in self.active_connections:
            self.active_connections[user_id] = set()
        self.active_connections[user_id].add(websocket)

    def disconnect(self, websocket: WebSocket, user_id: int):
        """Remove a WebSocket connection"""
        if user_id in self.active_connections:
            self.active_connections[user_id].discard(websocket)
            if not self.active_connections[user_id]:
                del self.active_connections[user_id]

    async def send_to_user(self, user_id: int, message: dict):
        """Send a message to all connections for a specific user"""
        if user_id in self.active_connections:
            disconnected = set()
            for connection in self.active_connections[user_id]:
                try:
                    await connection.send_json(message)
                except Exception:
                    disconnected.add(connection)

            # Clean up disconnected connections
            for conn in disconnected:
                self.active_connections[user_id].discard(conn)

    async def broadcast(self, message: dict):
        """Broadcast a message to all connected users"""
        for user_id in list(self.active_connections.keys()):
            await self.send_to_user(user_id, message)

    def get_connected_users(self) -> List[int]:
        """Get list of connected user IDs"""
        return list(self.active_connections.keys())

    def is_user_connected(self, user_id: int) -> bool:
        """Check if a user has any active connections"""
        return user_id in self.active_connections and len(self.active_connections[user_id]) > 0


# Singleton instance
websocket_manager = WebSocketManager()
