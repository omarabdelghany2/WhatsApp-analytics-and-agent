"""Add channel fields to scheduled_messages

Revision ID: 002_add_channel_fields
Revises: 001_add_poll_fields
Create Date: 2025-02-03

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '002_add_channel_fields'
down_revision = '001_add_poll_fields'
branch_labels = None
depends_on = None


def upgrade():
    # Add channel_ids column (JSON for storing channel IDs list)
    op.add_column('scheduled_messages', sa.Column('channel_ids', sa.JSON(), nullable=True))

    # Add channel_names column (JSON for storing channel names list)
    op.add_column('scheduled_messages', sa.Column('channel_names', sa.JSON(), nullable=True))

    # Make group_ids nullable (since channel broadcasts don't have groups)
    op.alter_column('scheduled_messages', 'group_ids',
                    existing_type=sa.JSON(),
                    nullable=True)


def downgrade():
    op.drop_column('scheduled_messages', 'channel_names')
    op.drop_column('scheduled_messages', 'channel_ids')
    op.alter_column('scheduled_messages', 'group_ids',
                    existing_type=sa.JSON(),
                    nullable=False)
