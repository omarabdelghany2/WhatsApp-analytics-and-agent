import asyncio
import json
import redis.asyncio as redis
from datetime import datetime, date
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from app.config import settings
from app.database import SessionLocal
from app.models.whatsapp_session import WhatsAppSession
from app.models.message import Message
from app.models.event import Event
from app.models.monitored_group import MonitoredGroup
from app.models.agent import Agent
from app.services.websocket_manager import websocket_manager
from app.services.whatsapp_bridge import whatsapp_bridge
from app.services.agent_service import agent_service


class RedisSubscriber:
    """Subscribe to Redis pub/sub for WhatsApp events"""

    def __init__(self):
        self.redis = None
        self.pubsub = None
        self.running = False

    async def connect(self):
        self.redis = redis.from_url(settings.redis_url)
        self.pubsub = self.redis.pubsub()
        await self.pubsub.subscribe("whatsapp:events")

    async def start(self):
        """Start listening for events"""
        if not self.redis:
            await self.connect()

        self.running = True
        print("Redis subscriber started")

        while self.running:
            try:
                message = await self.pubsub.get_message(ignore_subscribe_messages=True, timeout=1.0)
                if message:
                    await self.handle_message(message)
            except Exception as e:
                print(f"Redis subscriber error: {e}")
                await asyncio.sleep(1)

    async def stop(self):
        """Stop the subscriber"""
        self.running = False
        if self.pubsub:
            await self.pubsub.unsubscribe("whatsapp:events")
        if self.redis:
            await self.redis.close()

    async def handle_message(self, message):
        """Handle incoming Redis message"""
        try:
            data = json.loads(message["data"])
            event_type = data.get("type")
            user_id = data.get("userId")

            if not user_id:
                return

            # Get database session
            db = SessionLocal()
            try:
                if event_type == "qr":
                    await self.handle_qr(db, user_id, data)
                elif event_type == "authenticated":
                    await self.handle_authenticated(db, user_id, data)
                elif event_type == "ready":
                    await self.handle_ready(db, user_id, data)
                elif event_type == "disconnected":
                    await self.handle_disconnected(db, user_id, data)
                elif event_type == "message":
                    await self.handle_new_message(db, user_id, data)
                elif event_type == "member_join":
                    await self.handle_member_event(db, user_id, data, "JOIN")
                elif event_type == "member_leave":
                    await self.handle_member_event(db, user_id, data, "LEAVE")
                elif event_type == "certificate":
                    await self.handle_certificate_event(db, user_id, data)
            finally:
                db.close()

        except Exception as e:
            print(f"Error handling message: {e}")

    async def handle_qr(self, db: Session, user_id: int, data: dict):
        """Handle QR code event"""
        session = db.query(WhatsAppSession).filter(
            WhatsAppSession.user_id == user_id
        ).first()

        if session:
            session.auth_status = "qr_ready"
            db.commit()

        # Forward to WebSocket
        await websocket_manager.send_to_user(user_id, {
            "type": "qr",
            "qr": data.get("qr")
        })

    async def handle_authenticated(self, db: Session, user_id: int, data: dict):
        """Handle authenticated event"""
        session = db.query(WhatsAppSession).filter(
            WhatsAppSession.user_id == user_id
        ).first()

        if session:
            session.auth_status = "authenticated"
            db.commit()

        await websocket_manager.send_to_user(user_id, {
            "type": "authenticated"
        })

    async def handle_ready(self, db: Session, user_id: int, data: dict):
        """Handle ready event"""
        session = db.query(WhatsAppSession).filter(
            WhatsAppSession.user_id == user_id
        ).first()

        if session:
            session.auth_status = "ready"
            session.is_authenticated = True
            session.phone_number = data.get("phoneNumber")
            session.last_connected_at = datetime.utcnow()
            db.commit()

        await websocket_manager.send_to_user(user_id, {
            "type": "ready",
            "phoneNumber": data.get("phoneNumber")
        })

    async def handle_disconnected(self, db: Session, user_id: int, data: dict):
        """Handle disconnected event"""
        session = db.query(WhatsAppSession).filter(
            WhatsAppSession.user_id == user_id
        ).first()

        if session:
            session.auth_status = "disconnected"
            session.is_authenticated = False
            db.commit()

        await websocket_manager.send_to_user(user_id, {
            "type": "disconnected",
            "reason": data.get("reason")
        })

    async def handle_new_message(self, db: Session, user_id: int, data: dict):
        """Handle new message event"""
        msg_data = data.get("message", {})
        group_id_wa = msg_data.get("groupId")

        print(f"[REDIS] New message for user {user_id} in group {group_id_wa}")

        # Find monitored group
        group = db.query(MonitoredGroup).filter(
            MonitoredGroup.user_id == user_id,
            MonitoredGroup.whatsapp_group_id == group_id_wa,
            MonitoredGroup.is_active == True
        ).first()

        if not group:
            print(f"[REDIS] Group {group_id_wa} not monitored by user {user_id}")
            return  # Not monitoring this group

        print(f"[REDIS] Group found: {group.group_name} (id: {group.id})")

        # Check if message already exists
        existing = db.query(Message).filter(Message.id == msg_data.get("id")).first()
        if existing:
            return

        # Create message record
        message = Message(
            id=msg_data.get("id"),
            user_id=user_id,
            group_id=group.id,
            whatsapp_group_id=group_id_wa,
            group_name=msg_data.get("groupName", group.group_name),
            sender_id=msg_data.get("senderId"),
            sender_name=msg_data.get("senderName", "Unknown"),
            sender_phone=msg_data.get("senderPhone", ""),
            content=msg_data.get("content", ""),
            message_type=msg_data.get("messageType", "text"),
            timestamp=datetime.fromtimestamp(msg_data.get("timestamp", datetime.utcnow().timestamp()))
        )
        db.add(message)
        db.commit()

        # Forward to WebSocket
        print(f"[REDIS] Sending message to WebSocket for user {user_id}")
        await websocket_manager.send_to_user(user_id, {
            "type": "new_message",
            "message": {
                "id": message.id,
                "group_name": message.group_name,
                "sender_name": message.sender_name,
                "sender_phone": message.sender_phone,
                "content": message.content,
                "timestamp": message.timestamp.isoformat()
            }
        })
        print(f"[REDIS] Message sent to WebSocket")

        # Check if user is mentioned and should trigger agent response
        await self.check_agent_mention(db, user_id, group, msg_data)

    async def check_agent_mention(self, db: Session, user_id: int, group: MonitoredGroup, msg_data: dict):
        """Check if the user is mentioned and trigger agent response if applicable"""
        try:
            content = msg_data.get("content", "")
            sender_name = msg_data.get("senderName", "Unknown")
            mentioned_phones = msg_data.get("mentionedPhones", [])

            # Get user's phone number from WhatsApp session
            session = db.query(WhatsAppSession).filter(
                WhatsAppSession.user_id == user_id
            ).first()

            if not session or not session.phone_number:
                return

            user_phone = session.phone_number

            print(f"[AGENT] Checking mentions - user phone: {user_phone}, mentioned phones: {mentioned_phones}")

            # Check if user is mentioned in the message
            # The mentionedPhones list contains phone numbers of all mentioned contacts
            is_mentioned = user_phone in mentioned_phones

            # Also check if phone number appears in content (for fallback)
            if not is_mentioned:
                is_mentioned = user_phone in content

            if not is_mentioned:
                print(f"[AGENT] User {user_id} NOT mentioned in this message")
                return

            print(f"[AGENT] User {user_id} mentioned in {group.group_name}")

            # Get active agent for this user
            agent = db.query(Agent).filter(
                Agent.user_id == user_id,
                Agent.is_active == True
            ).first()

            if not agent:
                print(f"[AGENT] No active agent for user {user_id}")
                return

            # Check if agent is enabled for this group
            enabled_groups = agent.enabled_group_ids or []
            if group.id not in enabled_groups:
                print(f"[AGENT] Agent not enabled for group {group.group_name}")
                return

            print(f"[AGENT] Generating response using agent '{agent.name}'")

            # Remove the mention from the message to get the actual question
            # The content now contains processed mentions like "@Name (phone)"
            import re
            clean_message = content

            # Remove mentions that contain the user's phone number (e.g., "@Name (1234567890)")
            pattern = rf'@[^@\n]+\({user_phone}\)'
            clean_message = re.sub(pattern, '', clean_message).strip()

            # Also try to remove plain phone number mentions as fallback
            clean_message = clean_message.replace(f"@{user_phone}", "").strip()
            clean_message = clean_message.replace(user_phone, "").strip()

            if not clean_message:
                clean_message = "Hello"

            # Generate response using the agent
            response_text = await agent_service.generate_response(
                agent=agent,
                user_message=clean_message,
                sender_name=sender_name,
                group_name=group.group_name
            )

            if response_text:
                print(f"[AGENT] Got response: {response_text[:100]}...")

                # Send the response to the group
                result = await whatsapp_bridge.send_message(
                    user_id=user_id,
                    group_id=group.whatsapp_group_id,
                    content=response_text
                )

                if result.get("success"):
                    print(f"[AGENT] Response sent successfully to {group.group_name}")

                    # Notify via WebSocket
                    await websocket_manager.send_to_user(user_id, {
                        "type": "agent_response",
                        "agent_name": agent.name,
                        "group_name": group.group_name,
                        "response": response_text[:200] + "..." if len(response_text) > 200 else response_text
                    })
                else:
                    print(f"[AGENT] Failed to send response: {result.get('error')}")
            else:
                print(f"[AGENT] No response generated")

        except Exception as e:
            print(f"[AGENT] Error in check_agent_mention: {e}")

    async def handle_member_event(self, db: Session, user_id: int, data: dict, event_type: str):
        """Handle member join/leave event"""
        event_data = data.get("event", {})
        group_id_wa = event_data.get("groupId")

        # Find monitored group
        group = db.query(MonitoredGroup).filter(
            MonitoredGroup.user_id == user_id,
            MonitoredGroup.whatsapp_group_id == group_id_wa,
            MonitoredGroup.is_active == True
        ).first()

        if not group:
            return  # Not monitoring this group

        # Create event record
        event = Event(
            user_id=user_id,
            group_id=group.id,
            whatsapp_group_id=group_id_wa,
            group_name=event_data.get("groupName", group.group_name),
            member_id=event_data.get("memberId", ""),
            member_name=event_data.get("memberName", "Unknown"),
            member_phone=event_data.get("memberPhone"),
            event_type=event_type,
            event_date=date.today(),
            timestamp=datetime.fromtimestamp(event_data.get("timestamp", datetime.utcnow().timestamp()))
        )
        db.add(event)
        db.commit()

        # Forward to WebSocket
        await websocket_manager.send_to_user(user_id, {
            "type": f"member_{event_type.lower()}",
            "event": {
                "id": event.id,
                "group_id": event.group_id,
                "group_name": event.group_name,
                "member_name": event.member_name,
                "member_phone": event.member_phone,
                "event_type": event_type,
                "event_date": event.event_date.isoformat(),
                "timestamp": event.timestamp.isoformat()
            }
        })

        # Handle welcome message for JOIN events
        if event_type == "JOIN" and group.welcome_enabled:
            await self.process_welcome_message(db, user_id, group, event_data)

    async def process_welcome_message(self, db: Session, user_id: int, group: MonitoredGroup, event_data: dict):
        """Process welcome message logic when a member joins"""
        member_phone = event_data.get("memberPhone", "")

        if not member_phone:
            print(f"[WELCOME] No phone number for joiner, skipping")
            return

        # IMPORTANT: Refresh group from DB to get latest state (prevents race conditions)
        db.refresh(group)

        # Get current pending joiners list (create a NEW list to ensure mutation detection)
        existing_joiners = group.welcome_pending_joiners or []
        if not isinstance(existing_joiners, list):
            existing_joiners = []

        # Create a new list (important for SQLAlchemy JSON mutation detection)
        pending_joiners = list(existing_joiners)

        # Add this joiner to pending list if not already there
        if member_phone not in pending_joiners:
            pending_joiners.append(member_phone)

        # Increment join count
        current_count = (group.welcome_join_count or 0) + 1
        threshold = group.welcome_threshold or 1

        print(f"[WELCOME] Group {group.group_name}: join count {current_count}/{threshold}, pending: {pending_joiners}")

        # Update group with new count and pending joiners
        group.welcome_join_count = current_count
        group.welcome_pending_joiners = pending_joiners
        # Flag the JSON field as modified (SQLAlchemy sometimes doesn't detect list changes)
        flag_modified(group, 'welcome_pending_joiners')
        db.commit()

        # Check if threshold is met
        if current_count >= threshold:
            print(f"[WELCOME] Threshold met for {group.group_name}, sending welcome message")
            # Pass a copy of the list before resetting
            joiners_to_mention = list(pending_joiners)

            # Reset counter and pending joiners FIRST (in case send takes time)
            group.welcome_join_count = 0
            group.welcome_pending_joiners = []
            flag_modified(group, 'welcome_pending_joiners')
            db.commit()

            await self.send_welcome_message(db, user_id, group, joiners_to_mention)

    async def send_welcome_message(self, db: Session, user_id: int, group: MonitoredGroup, joiner_phones: list):
        """Send the welcome message with mentions"""
        try:
            # Get extra mention phones from group settings (configurable)
            extra_mention_phones = group.welcome_extra_mentions or []

            # Remove duplicates from joiner phones while preserving order
            seen = set()
            unique_joiner_phones = []
            for phone in joiner_phones:
                if phone and phone not in seen:
                    seen.add(phone)
                    unique_joiner_phones.append(phone)

            # Remove extra mentions from joiners if present
            for extra_phone in extra_mention_phones:
                if extra_phone in unique_joiner_phones:
                    unique_joiner_phones.remove(extra_phone)

            print(f"[WELCOME] Sending Part 1 to {group.group_name} with joiner mentions: {unique_joiner_phones}, extra mentions: {extra_mention_phones}")

            # Part 1: Joiner Mentions + Text + Extra Mentions
            welcome_text = group.welcome_text or "Welcome!"

            result = await whatsapp_bridge.send_welcome_message(
                user_id=user_id,
                group_id=group.whatsapp_group_id,
                content=welcome_text,
                joiner_phones=unique_joiner_phones,
                extra_mention_phones=extra_mention_phones
            )

            if result.get('success'):
                print(f"[WELCOME] Part 1 sent successfully to {group.group_name}")
            else:
                print(f"[WELCOME] Part 1 failed for {group.group_name}: {result.get('error')}")

            # Part 2: Optional Text + Image
            if group.welcome_part2_enabled:
                print(f"[WELCOME] Sending Part 2 to {group.group_name}")

                if group.welcome_part2_image:
                    # Send image with optional caption
                    result2 = await whatsapp_bridge.send_media_message(
                        user_id=user_id,
                        group_id=group.whatsapp_group_id,
                        file_path=group.welcome_part2_image,
                        caption=group.welcome_part2_text or ""
                    )
                elif group.welcome_part2_text:
                    # Send text only
                    result2 = await whatsapp_bridge.send_message(
                        user_id=user_id,
                        group_id=group.whatsapp_group_id,
                        content=group.welcome_part2_text
                    )
                else:
                    result2 = {'success': True}  # Nothing to send for Part 2

                if result2.get('success'):
                    print(f"[WELCOME] Part 2 sent successfully to {group.group_name}")
                else:
                    print(f"[WELCOME] Part 2 failed for {group.group_name}: {result2.get('error')}")

            # Notify via WebSocket
            await websocket_manager.send_to_user(user_id, {
                "type": "welcome_sent",
                "group_id": group.id,
                "group_name": group.group_name,
                "joiners_count": len(joiner_phones)
            })

        except Exception as e:
            print(f"[WELCOME] Error sending welcome message: {e}")

    async def handle_certificate_event(self, db: Session, user_id: int, data: dict):
        """Handle certificate event (voice message) with deduplication"""
        event_data = data.get("event", {})
        group_id_wa = event_data.get("groupId")
        member_phone = event_data.get("memberPhone", "")

        # Find monitored group
        group = db.query(MonitoredGroup).filter(
            MonitoredGroup.user_id == user_id,
            MonitoredGroup.whatsapp_group_id == group_id_wa,
            MonitoredGroup.is_active == True
        ).first()

        if not group:
            return  # Not monitoring this group

        # Deduplication: Check if certificate already exists for this member today in this group
        today = date.today()
        existing = db.query(Event).filter(
            Event.user_id == user_id,
            Event.group_id == group.id,
            Event.member_phone == member_phone,
            Event.event_type == "CERTIFICATE",
            Event.event_date == today
        ).first()

        if existing:
            print(f"[CERTIFICATE] Already recorded for {member_phone} today in {group.group_name}")
            return  # Already has certificate for today

        # Create certificate event record
        event = Event(
            user_id=user_id,
            group_id=group.id,
            whatsapp_group_id=group_id_wa,
            group_name=event_data.get("groupName", group.group_name),
            member_id=event_data.get("memberId", ""),
            member_name=event_data.get("memberName", "Unknown"),
            member_phone=member_phone,
            event_type="CERTIFICATE",
            event_date=today,
            timestamp=datetime.fromtimestamp(event_data.get("timestamp", datetime.utcnow().timestamp()))
        )
        db.add(event)
        db.commit()

        print(f"[CERTIFICATE] Recorded for {event.member_name} ({member_phone}) in {group.group_name}")

        # Forward to WebSocket
        await websocket_manager.send_to_user(user_id, {
            "type": "certificate",
            "event": {
                "id": event.id,
                "group_id": event.group_id,
                "group_name": event.group_name,
                "member_name": event.member_name,
                "member_phone": event.member_phone,
                "event_type": "CERTIFICATE",
                "event_date": event.event_date.isoformat(),
                "timestamp": event.timestamp.isoformat()
            }
        })


# Singleton instance
redis_subscriber = RedisSubscriber()
