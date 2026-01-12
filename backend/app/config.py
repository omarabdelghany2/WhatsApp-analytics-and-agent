from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # Database
    database_url: str = "postgresql://whatsapp:whatsapp_pass@localhost:5432/whatsapp_analytics"

    # Redis
    redis_url: str = "redis://localhost:6379"

    # JWT
    jwt_secret: str = "your-super-secret-key-change-in-production"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 10080  # 7 days

    # WhatsApp Service
    whatsapp_service_url: str = "http://localhost:3001"

    class Config:
        env_file = ".env"
        case_sensitive = False


# Create settings instance (reads from .env)
settings = Settings()

# Debug: print JWT secret (first 10 chars only)
print(f"[CONFIG] JWT Secret loaded: {settings.jwt_secret[:10]}...")
