"""NASA data endpoints."""

from datetime import date

from fastapi import APIRouter, HTTPException, Query

from backend.app.services.nasa_earthdata import (
    EarthdataCredentialsMissing,
    fetch_point_observations,
)
from backend.app.services.nasa_firms import fetch_fire_detections
from backend.app.services.nasa_gpm import fetch_daily_precipitation
from backend.app.services.nasa_power import fetch_daily_observations, fetch_monthly_observations

router = APIRouter(prefix="/api/nasa", tags=["NASA data"])


@router.get("/gpm/daily")
async def nasa_gpm_daily(
    latitude: float = Query(ge=-90, le=90),
    longitude: float = Query(ge=-180, le=180),
    start_date: date = Query(alias="start"),
    end_date: date = Query(alias="end"),
) -> dict:
    """Return NASA GPM IMERG Late Run daily precipitation point samples."""
    if end_date < start_date:
        raise HTTPException(status_code=422, detail="End date must be on or after start date.")
    if (end_date - start_date).days > 30:
        raise HTTPException(status_code=422, detail="GPM IMERG requests may cover at most 31 days.")
    if end_date > date.today():
        raise HTTPException(status_code=422, detail="End date cannot be in the future.")

    try:
        return await fetch_daily_precipitation(latitude, longitude, start_date, end_date)
    except RuntimeError as error:
        status_code = 503 if "EARTHDATA_ACCESS_TOKEN" in str(error) else 502
        raise HTTPException(status_code=status_code, detail=str(error)) from error


@router.get("/firms/area")
async def nasa_firms_area(
    latitude: float = Query(ge=-90, le=90),
    longitude: float = Query(ge=-180, le=180),
    start_date: date = Query(alias="start"),
    end_date: date = Query(alias="end"),
    radius_km: float = Query(default=10, ge=1, le=100),
) -> dict:
    """Return NASA FIRMS VIIRS detections in a radius around the selected point."""
    if end_date < start_date:
        raise HTTPException(status_code=422, detail="End date must be on or after start date.")
    if (end_date - start_date).days > 89:
        raise HTTPException(status_code=422, detail="NASA FIRMS requests may cover at most 90 days.")
    if end_date > date.today():
        raise HTTPException(status_code=422, detail="End date cannot be in the future.")

    try:
        return await fetch_fire_detections(latitude, longitude, start_date, end_date, radius_km)
    except RuntimeError as error:
        status_code = 503 if "FIRMS_MAP_KEY" in str(error) else 502
        raise HTTPException(status_code=status_code, detail=str(error)) from error


@router.get("/earthdata/point")
async def nasa_earthdata_point(
    latitude: float = Query(ge=-90, le=90),
    longitude: float = Query(ge=-180, le=180),
    start_date: date = Query(alias="start"),
    end_date: date = Query(alias="end"),
) -> dict:
    """Return NASA SMAP soil moisture and MODIS NDVI point observations."""
    if end_date < start_date:
        raise HTTPException(status_code=422, detail="End date must be on or after start date.")
    if (end_date - start_date).days > 365:
        raise HTTPException(status_code=422, detail="A request may cover at most 366 days.")
    if end_date > date.today():
        raise HTTPException(status_code=422, detail="End date cannot be in the future.")

    try:
        return await fetch_point_observations(latitude, longitude, start_date, end_date)
    except EarthdataCredentialsMissing as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    except RuntimeError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error


@router.get("/smap/point")
async def nasa_smap_point(
    latitude: float = Query(ge=-90, le=90),
    longitude: float = Query(ge=-180, le=180),
    start_date: date = Query(alias="start"),
    end_date: date = Query(alias="end"),
) -> dict:
    """Return NASA SMAP soil-moisture point samples."""
    return await _nasa_earthdata_dataset(
        "SMAP_SOIL_MOISTURE",
        latitude,
        longitude,
        start_date,
        end_date,
    )


@router.get("/modis/point")
async def nasa_modis_point(
    latitude: float = Query(ge=-90, le=90),
    longitude: float = Query(ge=-180, le=180),
    start_date: date = Query(alias="start"),
    end_date: date = Query(alias="end"),
) -> dict:
    """Return NASA MODIS vegetation-index point samples."""
    return await _nasa_earthdata_dataset(
        "MODIS_NDVI",
        latitude,
        longitude,
        start_date,
        end_date,
    )


async def _nasa_earthdata_dataset(
    dataset_code: str,
    latitude: float,
    longitude: float,
    start_date: date,
    end_date: date,
) -> dict:
    if end_date < start_date:
        raise HTTPException(status_code=422, detail="End date must be on or after start date.")
    if (end_date - start_date).days > 365:
        raise HTTPException(status_code=422, detail="A request may cover at most 366 days.")
    if end_date > date.today():
        raise HTTPException(status_code=422, detail="End date cannot be in the future.")

    try:
        return await fetch_point_observations(
            latitude,
            longitude,
            start_date,
            end_date,
            dataset_code,
        )
    except EarthdataCredentialsMissing as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    except RuntimeError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error


@router.get("/power/daily")
async def nasa_power_daily(
    latitude: float = Query(ge=-90, le=90),
    longitude: float = Query(ge=-180, le=180),
    start_date: date = Query(alias="start"),
    end_date: date = Query(alias="end"),
) -> dict:
    """Return NASA POWER daily observations for a coordinate and date range."""
    today = date.today()
    if start_date < date(1981, 1, 1):
        raise HTTPException(status_code=422, detail="NASA POWER daily data begins on 1981-01-01.")
    if end_date > today:
        raise HTTPException(status_code=422, detail="End date cannot be in the future.")
    if end_date < start_date:
        raise HTTPException(status_code=422, detail="End date must be on or after start date.")
    if (end_date - start_date).days > 365:
        raise HTTPException(status_code=422, detail="A request may cover at most 366 days.")

    try:
        return await fetch_daily_observations(
            latitude,
            longitude,
            start_date.isoformat(),
            end_date.isoformat(),
        )
    except RuntimeError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error


@router.get("/power/monthly")
async def nasa_power_monthly(
    latitude: float = Query(ge=-90, le=90),
    longitude: float = Query(ge=-180, le=180),
    start_year: int = Query(ge=1981),
    end_year: int = Query(ge=1981),
) -> dict:
    """Return NASA POWER monthly observations for a coordinate and year range."""
    if start_year > end_year:
        raise HTTPException(status_code=422, detail="Start year must be on or before end year.")
    if end_year > date.today().year:
        raise HTTPException(status_code=422, detail="End year cannot be in the future.")
    if end_year - start_year > 39:
        raise HTTPException(status_code=422, detail="A request may cover at most 40 years.")

    try:
        return await fetch_monthly_observations(latitude, longitude, start_year, end_year)
    except RuntimeError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error
