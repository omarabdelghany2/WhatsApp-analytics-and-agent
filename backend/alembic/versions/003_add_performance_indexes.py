"""Add performance indexes for stats queries

Revision ID: 003_add_performance_indexes
Revises: 002_add_channel_fields
Create Date: 2026-04-05

"""
from alembic import op


# revision identifiers, used by Alembic.
revision = '003_add_performance_indexes'
down_revision = '002_add_channel_fields'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Messages: compound indexes for stats queries
    op.create_index('idx_messages_user_timestamp', 'messages', ['user_id', 'timestamp'])
    op.create_index('idx_messages_user_group_timestamp', 'messages', ['user_id', 'group_id', 'timestamp'])

    # Events: compound index for user + type + date queries
    op.create_index('idx_events_user_type_date', 'events', ['user_id', 'event_type', 'event_date'])

    # MonitoredGroups: compound indexes for frequent lookups
    op.create_index('idx_monitored_group_user_active', 'monitored_groups', ['user_id', 'is_active'])
    op.create_index('idx_monitored_group_user_whatsapp_id', 'monitored_groups', ['user_id', 'whatsapp_group_id'])


def downgrade() -> None:
    op.drop_index('idx_monitored_group_user_whatsapp_id', 'monitored_groups')
    op.drop_index('idx_monitored_group_user_active', 'monitored_groups')
    op.drop_index('idx_events_user_type_date', 'events')
    op.drop_index('idx_messages_user_group_timestamp', 'messages')
    op.drop_index('idx_messages_user_timestamp', 'messages')
