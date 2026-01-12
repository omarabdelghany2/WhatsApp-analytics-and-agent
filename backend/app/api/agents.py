from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.database import get_db
from app.models.user import User
from app.models.agent import Agent
from app.models.monitored_group import MonitoredGroup
from app.api.deps import get_current_user

router = APIRouter()


class AgentCreate(BaseModel):
    name: str
    api_url: str
    api_key: str
    input_token_limit: int = 4096
    output_token_limit: int = 1024
    system_prompt: Optional[str] = None


class AgentUpdate(BaseModel):
    name: Optional[str] = None
    api_url: Optional[str] = None
    api_key: Optional[str] = None
    input_token_limit: Optional[int] = None
    output_token_limit: Optional[int] = None
    system_prompt: Optional[str] = None


class AgentGroupsUpdate(BaseModel):
    enabled_group_ids: List[int]


@router.get("/")
def get_agents(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get all agents for the current user"""
    agents = db.query(Agent).filter(Agent.user_id == current_user.id).all()

    return {
        "agents": [
            {
                "id": agent.id,
                "name": agent.name,
                "api_url": agent.api_url,
                "api_key": agent.api_key[:10] + "..." if agent.api_key else None,  # Mask API key
                "input_token_limit": agent.input_token_limit,
                "output_token_limit": agent.output_token_limit,
                "system_prompt": agent.system_prompt,
                "is_active": agent.is_active,
                "enabled_group_ids": agent.enabled_group_ids or [],
                "created_at": agent.created_at.isoformat() if agent.created_at else None,
                "updated_at": agent.updated_at.isoformat() if agent.updated_at else None
            }
            for agent in agents
        ]
    }


@router.get("/{agent_id}")
def get_agent(
    agent_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get a specific agent"""
    agent = db.query(Agent).filter(
        Agent.id == agent_id,
        Agent.user_id == current_user.id
    ).first()

    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    return {
        "id": agent.id,
        "name": agent.name,
        "api_url": agent.api_url,
        "api_key": agent.api_key,  # Full key for editing
        "input_token_limit": agent.input_token_limit,
        "output_token_limit": agent.output_token_limit,
        "system_prompt": agent.system_prompt,
        "is_active": agent.is_active,
        "enabled_group_ids": agent.enabled_group_ids or [],
        "created_at": agent.created_at.isoformat() if agent.created_at else None,
        "updated_at": agent.updated_at.isoformat() if agent.updated_at else None
    }


@router.post("/")
def create_agent(
    request: AgentCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Create a new agent"""
    agent = Agent(
        user_id=current_user.id,
        name=request.name,
        api_url=request.api_url,
        api_key=request.api_key,
        input_token_limit=request.input_token_limit,
        output_token_limit=request.output_token_limit,
        system_prompt=request.system_prompt,
        is_active=False,
        enabled_group_ids=[]
    )

    db.add(agent)
    db.commit()
    db.refresh(agent)

    return {
        "success": True,
        "agent_id": agent.id,
        "name": agent.name
    }


@router.put("/{agent_id}")
def update_agent(
    agent_id: int,
    request: AgentUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Update an agent"""
    agent = db.query(Agent).filter(
        Agent.id == agent_id,
        Agent.user_id == current_user.id
    ).first()

    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    if request.name is not None:
        agent.name = request.name
    if request.api_url is not None:
        agent.api_url = request.api_url
    if request.api_key is not None:
        agent.api_key = request.api_key
    if request.input_token_limit is not None:
        agent.input_token_limit = request.input_token_limit
    if request.output_token_limit is not None:
        agent.output_token_limit = request.output_token_limit
    if request.system_prompt is not None:
        agent.system_prompt = request.system_prompt

    db.commit()

    return {
        "success": True,
        "agent_id": agent.id,
        "name": agent.name
    }


@router.delete("/{agent_id}")
def delete_agent(
    agent_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Delete an agent"""
    agent = db.query(Agent).filter(
        Agent.id == agent_id,
        Agent.user_id == current_user.id
    ).first()

    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    db.delete(agent)
    db.commit()

    return {"success": True, "message": "Agent deleted"}


@router.post("/{agent_id}/activate")
def activate_agent(
    agent_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Set an agent as active (deactivates other agents)"""
    agent = db.query(Agent).filter(
        Agent.id == agent_id,
        Agent.user_id == current_user.id
    ).first()

    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    # Deactivate all other agents for this user
    db.query(Agent).filter(
        Agent.user_id == current_user.id,
        Agent.id != agent_id
    ).update({"is_active": False})

    # Activate this agent
    agent.is_active = True
    db.commit()

    return {
        "success": True,
        "agent_id": agent.id,
        "name": agent.name,
        "is_active": True
    }


@router.post("/{agent_id}/deactivate")
def deactivate_agent(
    agent_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Deactivate an agent"""
    agent = db.query(Agent).filter(
        Agent.id == agent_id,
        Agent.user_id == current_user.id
    ).first()

    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    agent.is_active = False
    db.commit()

    return {
        "success": True,
        "agent_id": agent.id,
        "name": agent.name,
        "is_active": False
    }


@router.put("/{agent_id}/groups")
def update_agent_groups(
    agent_id: int,
    request: AgentGroupsUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Update which groups the agent is enabled for"""
    agent = db.query(Agent).filter(
        Agent.id == agent_id,
        Agent.user_id == current_user.id
    ).first()

    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    # Verify all group IDs belong to this user
    valid_groups = db.query(MonitoredGroup).filter(
        MonitoredGroup.id.in_(request.enabled_group_ids),
        MonitoredGroup.user_id == current_user.id,
        MonitoredGroup.is_active == True
    ).all()

    valid_group_ids = [g.id for g in valid_groups]

    agent.enabled_group_ids = valid_group_ids
    db.commit()

    return {
        "success": True,
        "agent_id": agent.id,
        "enabled_group_ids": valid_group_ids,
        "groups_count": len(valid_group_ids)
    }


@router.get("/{agent_id}/groups")
def get_agent_groups(
    agent_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get groups where agent is enabled with details"""
    agent = db.query(Agent).filter(
        Agent.id == agent_id,
        Agent.user_id == current_user.id
    ).first()

    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    # Get all user's groups
    all_groups = db.query(MonitoredGroup).filter(
        MonitoredGroup.user_id == current_user.id,
        MonitoredGroup.is_active == True
    ).all()

    enabled_ids = agent.enabled_group_ids or []

    return {
        "groups": [
            {
                "id": g.id,
                "group_name": g.group_name,
                "member_count": g.member_count,
                "enabled": g.id in enabled_ids
            }
            for g in all_groups
        ]
    }
