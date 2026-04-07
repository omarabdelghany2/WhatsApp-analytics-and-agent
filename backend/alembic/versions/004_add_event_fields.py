"""Add event_data field to scheduled_messages

Revision ID: 004_add_event_fields
Revises: 003_add_performance_indexes
Create Date: 2026-04-06

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '004_add_event_fields'
down_revision = '003_add_performance_indexes'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('scheduled_messages', sa.Column('event_data', sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column('scheduled_messages', 'event_data')
