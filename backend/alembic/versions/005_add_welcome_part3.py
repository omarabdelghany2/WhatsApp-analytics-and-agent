"""Add welcome message Part 3 fields

Revision ID: 005_add_welcome_part3
Revises: 004_add_event_fields
Create Date: 2026-04-06

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '005_add_welcome_part3'
down_revision = '004_add_event_fields'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('monitored_groups', sa.Column('welcome_part3_enabled', sa.Boolean(), server_default='false'))
    op.add_column('monitored_groups', sa.Column('welcome_part3_text', sa.Text(), nullable=True))
    op.add_column('monitored_groups', sa.Column('welcome_part3_image', sa.String(500), nullable=True))


def downgrade() -> None:
    op.drop_column('monitored_groups', 'welcome_part3_image')
    op.drop_column('monitored_groups', 'welcome_part3_text')
    op.drop_column('monitored_groups', 'welcome_part3_enabled')
