"""Backend settings loaded from environment variables."""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_env: str = "development"
    api_host: str = "127.0.0.1"
    api_port: int = 8000
    cache_dir: str = "backend/cache"
    cache_ttl_seconds: int = 3600
    cors_origins: str = (
        "https://agriguard-nasa.vercel.app,"
        "https://agriguard-ai-sigma.vercel.app,"
        "https://agriguard-nasa-git-main-udhayakumar-ns-projects.vercel.app,"
        "http://localhost:5173,"
        "http://127.0.0.1:5173,"
        "http://localhost:4173,"
        "http://127.0.0.1:4173"
    )
    firms_map_key: str = ""
    earthdata_username: str = ""
    earthdata_password: str = ""
    earthdata_access_token: str = ""

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")


@lru_cache
def get_settings() -> Settings:
    """Return cached application settings."""
    return Settings()
