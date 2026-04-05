import asyncio
import os
from datetime import datetime, timedelta, time
from typing import Optional, Dict, Callable, Any

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

    async def _check_client_health(self, user_id: int) -> bool:
        """Check if WhatsApp client is ready before sending"""
        try:
            status = await whatsapp_bridge.get_status(user_id)
            return status.get('status') == 'ready'
        except Exception as e:
            print(f"[SCHEDULER] Health check failed for user {user_id}: {e}", flush=True)
            return False

    async def _send_with_retry(self, send_func: Callable, max_retries: int = 3) -> Dict[str, Any]:
        """Execute send function with exponential backoff retry for timeout errors"""
        delays = [5, 10, 20]  # seconds between retries
        last_error = None

        for attempt in range(max_retries):
            try:
                result = await send_func()

                if result.get('success'):
                    return result

                error = result.get('error', '')
                last_error = error

                # Check if it's a timeout error worth retrying
                if 'timed out' in error.lower() or 'timeout' in error.lower():
                    if attempt < max_retries - 1:
                        delay = delays[attempt]
                        print(f"[SCHEDULER] Timeout error, retry {attempt + 1}/{max_retries} in {delay}s...", flush=True)
                        await asyncio.sleep(delay)
                        continue

                # Non-timeout errors - don't retry
                return result

            except Exception as e:
                last_error = str(e)
                if attempt < max_retries - 1:
                    delay = delays[attempt]
                    print(f"[SCHEDULER] Exception, retry {attempt + 1}/{max_retries} in {delay}s: {e}", flush=True)
                    await asyncio.sleep(delay)
                else:
                    break

        return {"success": False, "error": last_error or "Max retries exceeded"}

    async def _ensure_client_ready(self, user_id: int) -> bool:
        """Ensure client is ready, attempt recovery if not"""
        if await self._check_client_health(user_id):
            return True

        print(f"[SCHEDULER] Client not ready for user {user_id}, attempting recovery...", flush=True)

        # Try to reinitialize the client
        try:
            recovery = await whatsapp_bridge.init_client(user_id)
            if not recovery.get('success'):
                print(f"[SCHEDULER] Client recovery failed for user {user_id}: {recovery.get('error')}", flush=True)
                return False

            # Wait for client to stabilize
            print(f"[SCHEDULER] Recovery initiated, waiting 15s for client to stabilize...", flush=True)
            await asyncio.sleep(15)

            # Check again
            if await self._check_client_health(user_id):
                print(f"[SCHEDULER] Client recovered successfully for user {user_id}", flush=True)
                return True
            else:
                print(f"[SCHEDULER] Client still not ready after recovery for user {user_id}", flush=True)
                return False

        except Exception as e:
            print(f"[SCHEDULER] Recovery exception for user {user_id}: {e}", flush=True)
            return False

    async def process_due_tasks(self):
        """Process all tasks that are due — different users run in parallel"""
        db = SessionLocal()
        try:
            now = datetime.utcnow()
            # Get pending tasks that are due
            due_tasks = db.query(ScheduledMessage).filter(
                ScheduledMessage.status == 'pending',
                ScheduledMessage.scheduled_at <= now
            ).all()

            if not due_tasks:
                return

            print(f"[SCHEDULER] Found {len(due_tasks)} tasks to process at {now}", flush=True)

            # Group tasks by user for parallel processing
            tasks_by_user = {}
            for task in due_tasks:
                tasks_by_user.setdefault(task.user_id, []).append(task)

            async def process_user_tasks(user_tasks):
                """Process all tasks for a single user sequentially (they share one WhatsApp client)"""
                for task in user_tasks:
                    task_type = task.task_type or 'broadcast'
                    try:
                        if task_type == 'broadcast':
                            await self._process_broadcast(db, task)
                        elif task_type == 'poll':
                            await self._process_poll(db, task)
                        elif task_type == 'open_group':
                            await self._process_group_settings(db, task, admin_only=False)
                        elif task_type == 'close_group':
                            await self._process_group_settings(db, task, admin_only=True)
                        else:
                            print(f"[SCHEDULER] Unknown task type: {task_type}", flush=True)
                    except Exception as e:
                        print(f"[SCHEDULER] Error processing task {task.id}: {e}", flush=True)

            # Run different users' tasks in parallel
            await asyncio.gather(*[
                process_user_tasks(tasks) for tasks in tasks_by_user.values()
            ])

        except Exception as e:
            print(f"[SCHEDULER] Error processing due tasks: {e}", flush=True)
        finally:
            db.close()

    BATCH_SIZE = 5  # Send to 5 groups concurrently per batch

    async def _process_broadcast(self, db: Session, scheduled_msg: ScheduledMessage):
        """Send a scheduled message in batches of 5 groups"""
        print(f"[SCHEDULER] Processing message {scheduled_msg.id} for user {scheduled_msg.user_id}", flush=True)

        # Mark as sending
        scheduled_msg.status = 'sending'
        db.commit()

        try:
            group_ids = scheduled_msg.group_ids or []
            groups_sent = 0
            groups_failed = 0
            errors = []
            has_media = bool(scheduled_msg.media_path)

            # Health check once before starting
            if not await self._ensure_client_ready(scheduled_msg.user_id):
                errors.append("WhatsApp client not ready - recovery failed")
                groups_failed = len(group_ids)
                print(f"[SCHEDULER] Aborting broadcast - client not ready", flush=True)
            else:
                # Batch-load all groups upfront (1 query instead of N)
                all_groups = db.query(MonitoredGroup).filter(
                    MonitoredGroup.id.in_(group_ids),
                    MonitoredGroup.user_id == scheduled_msg.user_id
                ).all()
                groups_map = {g.id: g for g in all_groups}

                # Process in batches of 5
                for batch_start in range(0, len(group_ids), self.BATCH_SIZE):
                    batch = group_ids[batch_start:batch_start + self.BATCH_SIZE]

                    async def send_to_group(gid):
                        group = groups_map.get(gid)
                        if not group:
                            return {'group_id': gid, 'success': False, 'error': f'Group {gid} not found', 'group_name': None}
                        try:
                            if has_media:
                                result = await self._send_with_retry(
                                    lambda g=group: whatsapp_bridge.send_media_from_path(
                                        user_id=scheduled_msg.user_id, group_id=g.whatsapp_group_id,
                                        file_path=scheduled_msg.media_path, caption=scheduled_msg.content,
                                        mention_all=(scheduled_msg.mention_type == 'all'),
                                        mention_ids=scheduled_msg.mention_ids if scheduled_msg.mention_type == 'selected' else None
                                    )
                                )
                            else:
                                result = await self._send_with_retry(
                                    lambda g=group: whatsapp_bridge.send_message(
                                        user_id=scheduled_msg.user_id, group_id=g.whatsapp_group_id,
                                        content=scheduled_msg.content,
                                        mention_all=(scheduled_msg.mention_type == 'all'),
                                        mention_ids=scheduled_msg.mention_ids if scheduled_msg.mention_type == 'selected' else None
                                    )
                                )
                            return {'group_id': gid, 'group_name': group.group_name, **result}
                        except Exception as e:
                            return {'group_id': gid, 'success': False, 'error': str(e), 'group_name': group.group_name}

                    results = await asyncio.gather(*[send_to_group(gid) for gid in batch])

                    for r in results:
                        if r.get('success'):
                            groups_sent += 1
                            print(f"[SCHEDULER] Successfully sent to {r.get('group_name')}", flush=True)
                            await websocket_manager.send_to_user(scheduled_msg.user_id, {
                                'type': 'broadcast_progress',
                                'message_id': scheduled_msg.id,
                                'group_name': r.get('group_name'),
                                'groups_sent': groups_sent,
                                'total_groups': len(group_ids)
                            })
                        else:
                            groups_failed += 1
                            name = r.get('group_name') or r.get('group_id')
                            errors.append(f"{name}: {r.get('error', 'Unknown error')}")
                            print(f"[SCHEDULER] Failed to send to {name}: {r.get('error')}", flush=True)

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

            if has_media:
                try:
                    await whatsapp_bridge.delete_media(scheduled_msg.media_path)
                except Exception:
                    pass

            db.commit()

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

            await websocket_manager.send_to_user(scheduled_msg.user_id, {
                'type': 'broadcast_complete',
                'message_id': scheduled_msg.id,
                'status': 'failed',
                'error_message': str(e)
            })

    async def _process_poll(self, db: Session, scheduled_msg: ScheduledMessage):
        """Send a scheduled poll to all target groups with delays"""
        print(f"[SCHEDULER] Processing poll {scheduled_msg.id} for user {scheduled_msg.user_id}", flush=True)

        # Mark as sending
        scheduled_msg.status = 'sending'
        db.commit()

        try:
            group_ids = scheduled_msg.group_ids or []
            groups_sent = 0
            groups_failed = 0
            errors = []

            # Health check once before starting
            if not await self._ensure_client_ready(scheduled_msg.user_id):
                errors.append("WhatsApp client not ready - recovery failed")
                groups_failed = len(group_ids)
                print(f"[SCHEDULER] Aborting poll - client not ready", flush=True)
            else:
                # Batch-load all groups upfront
                all_groups = db.query(MonitoredGroup).filter(
                    MonitoredGroup.id.in_(group_ids),
                    MonitoredGroup.user_id == scheduled_msg.user_id
                ).all()
                groups_map = {g.id: g for g in all_groups}

                # Process in batches of 5
                for batch_start in range(0, len(group_ids), self.BATCH_SIZE):
                    batch = group_ids[batch_start:batch_start + self.BATCH_SIZE]

                    async def send_poll_to_group(gid):
                        group = groups_map.get(gid)
                        if not group:
                            return {'group_id': gid, 'success': False, 'error': f'Group {gid} not found', 'group_name': None}
                        try:
                            result = await self._send_with_retry(
                                lambda g=group: whatsapp_bridge.send_poll(
                                    user_id=scheduled_msg.user_id, group_id=g.whatsapp_group_id,
                                    question=scheduled_msg.content, options=scheduled_msg.poll_options or [],
                                    allow_multiple_answers=scheduled_msg.poll_allow_multiple or False,
                                    mention_all=(scheduled_msg.mention_type == 'all'),
                                    mention_ids=scheduled_msg.mention_ids if scheduled_msg.mention_type == 'selected' else None
                                )
                            )
                            return {'group_id': gid, 'group_name': group.group_name, **result}
                        except Exception as e:
                            return {'group_id': gid, 'success': False, 'error': str(e), 'group_name': group.group_name}

                    results = await asyncio.gather(*[send_poll_to_group(gid) for gid in batch])

                    for r in results:
                        if r.get('success'):
                            groups_sent += 1
                            print(f"[SCHEDULER] Successfully sent poll to {r.get('group_name')}", flush=True)
                            await websocket_manager.send_to_user(scheduled_msg.user_id, {
                                'type': 'poll_progress',
                                'message_id': scheduled_msg.id,
                                'group_name': r.get('group_name'),
                                'groups_sent': groups_sent,
                                'total_groups': len(group_ids)
                            })
                        else:
                            groups_failed += 1
                            name = r.get('group_name') or r.get('group_id')
                            errors.append(f"{name}: {r.get('error', 'Unknown error')}")
                            print(f"[SCHEDULER] Failed to send poll to {name}: {r.get('error')}", flush=True)

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

            await websocket_manager.send_to_user(scheduled_msg.user_id, {
                'type': 'poll_complete',
                'message_id': scheduled_msg.id,
                'status': scheduled_msg.status,
                'groups_sent': groups_sent,
                'groups_failed': groups_failed,
                'error_message': scheduled_msg.error_message
            })

            print(f"[SCHEDULER] Poll {scheduled_msg.id} completed: {scheduled_msg.status}", flush=True)

        except Exception as e:
            print(f"[SCHEDULER] Fatal error processing poll {scheduled_msg.id}: {e}", flush=True)
            scheduled_msg.status = 'failed'
            scheduled_msg.error_message = str(e)
            db.commit()

            await websocket_manager.send_to_user(scheduled_msg.user_id, {
                'type': 'poll_complete',
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

            # Health check once before starting
            if not await self._ensure_client_ready(task.user_id):
                errors.append("WhatsApp client not ready - recovery failed")
                groups_failed = len(group_ids)
                print(f"[SCHEDULER] Aborting group settings - client not ready", flush=True)
            else:
                # Batch-load all groups upfront
                all_groups = db.query(MonitoredGroup).filter(
                    MonitoredGroup.id.in_(group_ids),
                    MonitoredGroup.user_id == task.user_id
                ).all()
                groups_map = {g.id: g for g in all_groups}

                # Process in batches of 5
                for batch_start in range(0, len(group_ids), self.BATCH_SIZE):
                    batch = group_ids[batch_start:batch_start + self.BATCH_SIZE]

                    async def set_group_settings(gid):
                        group = groups_map.get(gid)
                        if not group:
                            return {'group_id': gid, 'success': False, 'error': f'Group {gid} not found', 'group_name': None}
                        try:
                            result = await self._send_with_retry(
                                lambda g=group: whatsapp_bridge.set_group_admin_only(
                                    user_id=task.user_id, group_id=g.whatsapp_group_id, admin_only=admin_only
                                )
                            )
                            if result.get('success') and task.content:
                                await self._send_with_retry(
                                    lambda g=group: whatsapp_bridge.send_message(
                                        user_id=task.user_id, group_id=g.whatsapp_group_id,
                                        content=task.content,
                                        mention_all=(task.mention_type == 'all'),
                                        mention_ids=task.mention_ids if task.mention_type == 'selected' else None
                                    )
                                )
                            return {'group_id': gid, 'group_name': group.group_name, **result}
                        except Exception as e:
                            return {'group_id': gid, 'success': False, 'error': str(e), 'group_name': group.group_name}

                    results = await asyncio.gather(*[set_group_settings(gid) for gid in batch])

                    for r in results:
                        if r.get('success'):
                            groups_success += 1
                            print(f"[SCHEDULER] Successfully set {action} for {r.get('group_name')}", flush=True)
                            await websocket_manager.send_to_user(task.user_id, {
                                'type': 'settings_progress',
                                'task_id': task.id,
                                'action': action,
                                'group_name': r.get('group_name'),
                                'groups_done': groups_success + groups_failed,
                                'total_groups': len(group_ids)
                            })
                        else:
                            groups_failed += 1
                            name = r.get('group_name') or r.get('group_id')
                            errors.append(f"{name}: {r.get('error', 'Unknown error')}")
                            print(f"[SCHEDULER] Failed to set {action} for {name}: {r.get('error')}", flush=True)

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
