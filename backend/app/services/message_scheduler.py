import asyncio
import os
from datetime import datetime, timedelta, time
from typing import Optional

from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.models.scheduled_message import ScheduledMessage
from app.models.monitored_group import MonitoredGroup
from app.services.whatsapp_bridge import whatsapp_bridge
from app.services.websocket_manager import websocket_manager


class MessageScheduler:
    """Unified background service that processes all scheduled tasks (broadcasts + group settings)"""

    def __init__(self):
        self.running = False
        self.check_interval = 60  # Check every 60 seconds for low CPU usage

    async def start(self):
        """Start the scheduler loop"""
        self.running = True
        print("[SCHEDULER] Unified scheduler started", flush=True)

        while self.running:
            try:
                await self.process_due_tasks()
            except Exception as e:
                print(f"[SCHEDULER] Error in scheduler loop: {e}", flush=True)

            await asyncio.sleep(self.check_interval)

    def stop(self):
        """Stop the scheduler"""
        self.running = False
        print("[SCHEDULER] Scheduler stopped", flush=True)

    async def process_due_tasks(self):
        """Process all tasks that are due"""
        db = SessionLocal()
        try:
            now = datetime.utcnow()
            # Get pending tasks that are due
            due_tasks = db.query(ScheduledMessage).filter(
                ScheduledMessage.status == 'pending',
                ScheduledMessage.scheduled_at <= now
            ).all()

            if due_tasks:
                print(f"[SCHEDULER] Found {len(due_tasks)} tasks to process at {now}", flush=True)

            for task in due_tasks:
                # Route to appropriate handler based on task_type
                task_type = task.task_type or 'broadcast'

                if task_type == 'broadcast':
                    await self._process_broadcast(db, task)
                elif task_type == 'open_group':
                    await self._process_group_settings(db, task, admin_only=False)
                elif task_type == 'close_group':
                    await self._process_group_settings(db, task, admin_only=True)
                else:
                    print(f"[SCHEDULER] Unknown task type: {task_type}", flush=True)

        except Exception as e:
            print(f"[SCHEDULER] Error processing due tasks: {e}", flush=True)
        finally:
            db.close()

    async def _process_broadcast(self, db: Session, scheduled_msg: ScheduledMessage):
        """Send a scheduled message to all target groups with delays"""
        print(f"[SCHEDULER] Processing message {scheduled_msg.id} for user {scheduled_msg.user_id}", flush=True)

        # Mark as sending
        scheduled_msg.status = 'sending'
        db.commit()

        try:
            group_ids = scheduled_msg.group_ids or []
            groups_sent = 0
            groups_failed = 0
            errors = []
            has_media = scheduled_msg.media_path and os.path.exists(scheduled_msg.media_path)

            for i, group_id in enumerate(group_ids):
                # 30-second delay between groups (except first)
                if i > 0:
                    print(f"[SCHEDULER] Waiting 30 seconds before next group...", flush=True)
                    await asyncio.sleep(30)

                try:
                    # Get the WhatsApp group ID from the monitored group
                    group = db.query(MonitoredGroup).filter(
                        MonitoredGroup.id == group_id,
                        MonitoredGroup.user_id == scheduled_msg.user_id
                    ).first()

                    if not group:
                        errors.append(f"Group {group_id} not found")
                        groups_failed += 1
                        continue

                    print(f"[SCHEDULER] Sending to group: {group.group_name}", flush=True)

                    # Send the message (with or without media)
                    if has_media:
                        result = await whatsapp_bridge.send_media_message(
                            user_id=scheduled_msg.user_id,
                            group_id=group.whatsapp_group_id,
                            file_path=scheduled_msg.media_path,
                            caption=scheduled_msg.content,
                            mention_all=(scheduled_msg.mention_type == 'all'),
                            mention_ids=scheduled_msg.mention_ids if scheduled_msg.mention_type == 'selected' else None
                        )
                    else:
                        result = await whatsapp_bridge.send_message(
                            user_id=scheduled_msg.user_id,
                            group_id=group.whatsapp_group_id,
                            content=scheduled_msg.content,
                            mention_all=(scheduled_msg.mention_type == 'all'),
                            mention_ids=scheduled_msg.mention_ids if scheduled_msg.mention_type == 'selected' else None
                        )

                    if result.get('success'):
                        groups_sent += 1
                        print(f"[SCHEDULER] Successfully sent to {group.group_name}", flush=True)

                        # Notify user of progress via WebSocket
                        await websocket_manager.send_to_user(scheduled_msg.user_id, {
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
                        print(f"[SCHEDULER] Failed to send to {group.group_name}: {error_msg}", flush=True)

                except Exception as e:
                    groups_failed += 1
                    errors.append(f"Group {group_id}: {str(e)}")
                    print(f"[SCHEDULER] Error sending to group {group_id}: {e}", flush=True)

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

            # Clean up media file after broadcast
            if has_media:
                try:
                    os.remove(scheduled_msg.media_path)
                except Exception:
                    pass

            db.commit()

            # Notify user of completion via WebSocket
            await websocket_manager.send_to_user(scheduled_msg.user_id, {
                'type': 'broadcast_complete',
                'message_id': scheduled_msg.id,
                'status': scheduled_msg.status,
                'groups_sent': groups_sent,
                'groups_failed': groups_failed,
                'error_message': scheduled_msg.error_message
            })

            print(f"[SCHEDULER] Message {scheduled_msg.id} completed: {scheduled_msg.status}", flush=True)

        except Exception as e:
            print(f"[SCHEDULER] Fatal error processing message {scheduled_msg.id}: {e}", flush=True)
            scheduled_msg.status = 'failed'
            scheduled_msg.error_message = str(e)
            db.commit()

            # Notify user of failure
            await websocket_manager.send_to_user(scheduled_msg.user_id, {
                'type': 'broadcast_complete',
                'message_id': scheduled_msg.id,
                'status': 'failed',
                'error_message': str(e)
            })

    async def _process_group_settings(self, db: Session, task: ScheduledMessage, admin_only: bool):
        """Process group settings change task (open or close groups)"""
        action = 'close' if admin_only else 'open'
        print(f"[SCHEDULER] Processing {action} groups for task {task.id}, user {task.user_id}", flush=True)

        task.status = 'sending'
        db.commit()

        try:
            group_ids = task.group_ids or []
            groups_success = 0
            groups_failed = 0
            errors = []

            for i, group_id in enumerate(group_ids):
                # 30-second delay between groups (except first)
                if i > 0:
                    print(f"[SCHEDULER] Waiting 30 seconds before next group...", flush=True)
                    await asyncio.sleep(30)

                try:
                    # Get the WhatsApp group ID from the monitored group
                    group = db.query(MonitoredGroup).filter(
                        MonitoredGroup.id == group_id,
                        MonitoredGroup.user_id == task.user_id
                    ).first()

                    if not group:
                        errors.append(f"Group {group_id} not found")
                        groups_failed += 1
                        continue

                    print(f"[SCHEDULER] Setting {action} for group: {group.group_name}", flush=True)

                    # Change group settings
                    result = await whatsapp_bridge.set_group_admin_only(
                        user_id=task.user_id,
                        group_id=group.whatsapp_group_id,
                        admin_only=admin_only
                    )

                    if result.get('success'):
                        groups_success += 1
                        print(f"[SCHEDULER] Successfully set {action} for {group.group_name}", flush=True)

                        # Send optional message if configured
                        if task.content:
                            await whatsapp_bridge.send_message(
                                user_id=task.user_id,
                                group_id=group.whatsapp_group_id,
                                content=task.content,
                                mention_all=(task.mention_type == 'all'),
                                mention_ids=task.mention_ids if task.mention_type == 'selected' else None
                            )

                        # Notify user of progress via WebSocket
                        await websocket_manager.send_to_user(task.user_id, {
                            'type': 'settings_progress',
                            'task_id': task.id,
                            'action': action,
                            'group_name': group.group_name,
                            'groups_done': groups_success + groups_failed,
                            'total_groups': len(group_ids)
                        })
                    else:
                        groups_failed += 1
                        error_msg = result.get('error', 'Unknown error')
                        errors.append(f"{group.group_name}: {error_msg}")
                        print(f"[SCHEDULER] Failed to set {action} for {group.group_name}: {error_msg}", flush=True)

                except Exception as e:
                    groups_failed += 1
                    errors.append(f"Group {group_id}: {str(e)}")
                    print(f"[SCHEDULER] Error setting {action} for group {group_id}: {e}", flush=True)

            # Update task status
            task.groups_sent = groups_success
            task.groups_failed = groups_failed
            task.sent_at = datetime.utcnow()

            if groups_failed == 0:
                task.status = 'sent'
            elif groups_success == 0:
                task.status = 'failed'
            else:
                task.status = 'partially_sent'

            if errors:
                task.error_message = "; ".join(errors)

            # If recurring, schedule next occurrence for tomorrow
            if task.is_recurring and task.recurring_time:
                next_run = self._calculate_next_run(task.recurring_time)
                new_task = ScheduledMessage(
                    user_id=task.user_id,
                    task_type=task.task_type,
                    is_recurring=True,
                    recurring_time=task.recurring_time,
                    parent_schedule_id=task.parent_schedule_id or task.id,
                    content=task.content,
                    group_ids=task.group_ids,
                    group_names=task.group_names,
                    mention_type=task.mention_type,
                    mention_ids=task.mention_ids,
                    scheduled_at=next_run,
                    status='pending'
                )
                db.add(new_task)
                print(f"[SCHEDULER] Created recurring task for {next_run}", flush=True)

            db.commit()

            # Notify user of completion via WebSocket
            await websocket_manager.send_to_user(task.user_id, {
                'type': 'settings_complete',
                'task_id': task.id,
                'action': action,
                'status': task.status,
                'groups_success': groups_success,
                'groups_failed': groups_failed,
                'error_message': task.error_message
            })

            print(f"[SCHEDULER] Task {task.id} ({action}) completed: {task.status}")

        except Exception as e:
            print(f"[SCHEDULER] Fatal error processing task {task.id}: {e}", flush=True)
            task.status = 'failed'
            task.error_message = str(e)
            db.commit()

            # Notify user of failure
            await websocket_manager.send_to_user(task.user_id, {
                'type': 'settings_complete',
                'task_id': task.id,
                'action': action,
                'status': 'failed',
                'error_message': str(e)
            })

    def _calculate_next_run(self, time_str: str, timezone_offset_hours: int = 2) -> datetime:
        """
        Calculate next occurrence (tomorrow at the same time).
        Converts from local time to UTC by subtracting the timezone offset.

        Args:
            time_str: Time in HH:MM format (user's local time)
            timezone_offset_hours: Hours ahead of UTC (default 2 for Egypt/UTC+2)
        """
        tomorrow = datetime.utcnow().date() + timedelta(days=1)
        hour, minute = map(int, time_str.split(':'))
        # Create datetime in user's local time, then convert to UTC
        local_time = datetime.combine(tomorrow, time(hour, minute))
        return local_time - timedelta(hours=timezone_offset_hours)


# Singleton instance
message_scheduler = MessageScheduler()
