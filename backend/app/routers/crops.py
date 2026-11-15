"""Location-based climate and crop assessment endpoint."""

import asyncio
from datetime import date

from fastapi import APIRouter, HTTPException, Query

from backend.app.services.climate_analysis import (
    BASELINE_END_YEAR,
    BASELINE_START_YEAR,
    analyze_climate,
    build_environmental_evidence,
)
from backend.app.services.crop_suitability import (
    build_crop_assessments,
    build_crop_recommendations,
    build_recommendation_readiness,
)
from backend.app.services.nasa_power import (
    fetch_daily_observations,
    fetch_monthly_observations,
)

router = APIRouter(prefix="/api/crops", tags=["crop assessment"])


@router.get("/analyze")
async def analyze_crops_for_location(
    latitude: float = Query(ge=-90, le=90),
    longitude: float = Query(ge=-180, le=180),
    start_date: date = Query(alias="start"),
    end_date: date = Query(alias="end"),
) -> dict:
    """Analyze current observations against a historical climate baseline."""
    today = date.today()
    if start_date < date(1981, 1, 1):
        raise HTTPException(status_code=422, detail="NASA POWER daily data begins on 1981-01-01.")
    if end_date > today:
        raise HTTPException(status_code=422, detail="End date cannot be in the future.")
    if end_date < start_date:
        raise HTTPException(status_code=422, detail="End date must be on or after start date.")
    if (end_date - start_date).days > 365:
        raise HTTPException(status_code=422, detail="A current-observation period may cover at most 366 days.")

    try:
        daily_data, monthly_data = await asyncio.gather(
            fetch_daily_observations(
                latitude,
                longitude,
                start_date.isoformat(),
                end_date.isoformat(),
            ),
            fetch_monthly_observations(
                latitude,
                longitude,
                BASELINE_START_YEAR,
                BASELINE_END_YEAR,
            ),
        )
    except RuntimeError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error

    climate = analyze_climate(daily_data, monthly_data)
    environmental_evidence = build_environmental_evidence(daily_data)
    return {
        "location": {
            "coordinates": daily_data["coordinates"]["requested"],
            "grid": daily_data["coordinates"]["grid"],
        },
        "generated_at": daily_data["retrieved_at"],
        "current_observation_source": {
            "source": daily_data["source"],
            "product": daily_data["product"],
            "api": daily_data["api"],
            "period": daily_data["period"],
            "resolution": daily_data["resolution"],
            "update_frequency": daily_data["update_frequency"],
            "time_standard": daily_data["time_standard"],
            "retrieved_at": daily_data["retrieved_at"],
            "units": {
                code: item["units"]
                for code, item in daily_data["observations"].items()
            },
        },
        "historical_climatology": climate["historical_climatology"],
        "current_period": climate["current_period"],
        "environmental_evidence": environmental_evidence,
        "future_forecast": climate["future_forecast"],
        "data_availability": {
            "NASA POWER daily": "available",
            "NASA POWER historical monthly": "available",
            "future seasonal forecast": "unavailable from this NASA POWER observations workflow",
            "historical_baseline": f"{BASELINE_START_YEAR}–{BASELINE_END_YEAR}",
        },
        "recommendation_readiness": build_recommendation_readiness(climate),
        "recommendations": build_crop_recommendations(climate),
        "crop_assessments": build_crop_assessments(environmental_evidence),
        "limitations": climate["limitations"],
    }
