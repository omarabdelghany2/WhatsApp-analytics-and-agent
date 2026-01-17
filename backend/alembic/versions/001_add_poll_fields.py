"""Add poll fields to scheduled_messages

Revision ID: 001_add_poll_fields
Revises:
Create Date: 2025-01-17

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '001_add_poll_fields'
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    # Add poll_options column (JSON for storing poll options list)
    op.add_column('scheduled_messages', sa.Column('poll_options', sa.JSON(), nullable=True))

    # Add poll_allow_multiple column (Boolean for allowing multiple answers)
    op.add_column('scheduled_messages', sa.Column('poll_allow_multiple', sa.Boolean(), server_default='false', nullable=True))


def downgrade():
    op.drop_column('scheduled_messages', 'poll_allow_multiple')
    op.drop_column('scheduled_messages', 'poll_options')
