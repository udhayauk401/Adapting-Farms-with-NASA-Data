"""FastAPI application entry point."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.app.config import get_settings
from backend.app.routers.crops import router as crops_router
from backend.app.routers.nasa import router as nasa_router

settings = get_settings()

app = FastAPI(
    title="AgriGuard AI API",
    description="NASA Earth observation data services for AgriGuard AI.",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in settings.cors_origins.split(",") if origin.strip()],
    allow_credentials=False,
    allow_methods=["GET", "OPTIONS"],
    allow_headers=["*"],
)

app.include_router(nasa_router)
app.include_router(crops_router)


@app.get("/health", tags=["health"])
async def health() -> dict[str, str]:
    """Report that the API process is available."""
    return {"status": "ok"}
