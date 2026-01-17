from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query
from fastapi.middleware.cors import CORSMiddleware
from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware
from contextlib import asynccontextmanager
import asyncio
import redis.asyncio as redis
import os

from app.config import settings
from app.database import engine, Base, get_db
from app.api import auth, whatsapp, groups, messages, events, stats, admin, certificates, broadcast, group_settings, welcome, agents
from app.services.websocket_manager import websocket_manager
from app.services.redis_subscriber import redis_subscriber
from app.services.message_scheduler import message_scheduler
from app.core.security import decode_token
from app.models.user import User


def run_migrations():
    """Run Alembic migrations on startup"""
    from alembic.config import Config
    from alembic import command

    # Get the directory where alembic.ini is located
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    alembic_ini = os.path.join(base_dir, "alembic.ini")

    if os.path.exists(alembic_ini):
        alembic_cfg = Config(alembic_ini)
        alembic_cfg.set_main_option("script_location", os.path.join(base_dir, "alembic"))
        try:
            command.upgrade(alembic_cfg, "head")
            print("[Startup] Alembic migrations completed")
        except Exception as e:
            print(f"[Startup] Alembic migration error: {e}")
            # Fall back to create_all for new deployments
            Base.metadata.create_all(bind=engine)
    else:
        # No alembic.ini, use create_all
        Base.metadata.create_all(bind=engine)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    # Run database migrations
    run_migrations()

    # Initialize Redis connection
    app.state.redis = redis.from_url(settings.redis_url)

    # Start Redis subscriber in background
    asyncio.create_task(redis_subscriber.start())

    # Start message scheduler for scheduled broadcasts
    asyncio.create_task(message_scheduler.start())

    yield

    # Shutdown
    message_scheduler.stop()
    await redis_subscriber.stop()
    await app.state.redis.close()


app = FastAPI(
    title="WhatsApp Analytics API",
    description="Multi-tenant WhatsApp group monitoring platform",
    version="1.0.0",
    lifespan=lifespan
)

# Trust proxy headers (Railway uses X-Forwarded-Proto for HTTPS)
app.add_middleware(ProxyHeadersMiddleware, trusted_hosts=["*"])

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:3000",
        "https://frontend-production-a19b.up.railway.app",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(auth.router, prefix="/api/auth", tags=["Authentication"])
app.include_router(whatsapp.router, prefix="/api/whatsapp", tags=["WhatsApp"])
app.include_router(groups.router, prefix="/api/groups", tags=["Groups"])
app.include_router(messages.router, prefix="/api/messages", tags=["Messages"])
app.include_router(events.router, prefix="/api/events", tags=["Events"])
app.include_router(stats.router, prefix="/api/stats", tags=["Statistics"])
app.include_router(admin.router, prefix="/api/admin", tags=["Admin"])
app.include_router(certificates.router, prefix="/api/certificates", tags=["Certificates"])
app.include_router(broadcast.router, prefix="/api/broadcast", tags=["Broadcast"])
app.include_router(group_settings.router, prefix="/api/group-settings", tags=["Group Settings"])
app.include_router(welcome.router, prefix="/api/welcome", tags=["Welcome Messages"])
app.include_router(agents.router, prefix="/api/agents", tags=["AI Agents"])


@app.get("/")
async def root():
    return {"message": "WhatsApp Analytics API", "version": "1.0.0"}


@app.get("/health")
async def health_check():
    return {"status": "healthy"}


@app.websocket("/ws")
async def websocket_endpoint(
    websocket: WebSocket,
    token: str = Query(None)
):
    """WebSocket endpoint for real-time updates"""
    if not token:
        await websocket.close(code=4001)
        return

    # Validate token
    payload = decode_token(token)
    if not payload:
        await websocket.close(code=4001)
        return

    user_id_str = payload.get("sub")
    if not user_id_str:
        await websocket.close(code=4001)
        return

    try:
        user_id = int(user_id_str)
    except (ValueError, TypeError):
        await websocket.close(code=4001)
        return

    print(f"[WS] User {user_id} connected")

    # Connect
    await websocket_manager.connect(websocket, user_id)

    try:
        while True:
            # Keep connection alive, handle any incoming messages
            data = await websocket.receive_text()
            print(f"[WS] Received from user {user_id}: {data}")
    except WebSocketDisconnect:
        print(f"[WS] User {user_id} disconnected")
        websocket_manager.disconnect(websocket, user_id)
