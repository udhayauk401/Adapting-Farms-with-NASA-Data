"""NASA FIRMS active-fire and thermal-anomaly area queries."""

import csv
import io
import math
from datetime import date, datetime, timedelta, timezone
from time import monotonic
from typing import Any

import httpx

from backend.app.config import get_settings

FIRMS_AREA_URL = "https://firms.modaps.eosdis.nasa.gov/api/area/csv"
SOURCE = "VIIRS_SNPP_SP"
_cache: dict[str, tuple[float, dict[str, Any]]] = {}


def _point_bbox(latitude: float, longitude: float, radius_km: float) -> tuple[float, float, float, float]:
    latitude_delta = radius_km / 111.32
    longitude_delta = radius_km / (111.32 * max(abs(math.cos(math.radians(latitude))), 0.05))
    west = max(-180.0, longitude - longitude_delta)
    south = max(-90.0, latitude - latitude_delta)
    east = min(180.0, longitude + longitude_delta)
    north = min(90.0, latitude + latitude_delta)
    return west, south, east, north


def parse_firms_csv(content: str) -> list[dict[str, Any]]:
    """Normalize FIRMS area CSV detections without treating them as temperatures."""
    reader = csv.DictReader(io.StringIO(content.lstrip("\ufeff")))
    fields = {_field.casefold(): _field for _field in (reader.fieldnames or [])}
    required = {"latitude", "longitude", "acq_date", "acq_time"}
    if not required.issubset(fields):
        raise RuntimeError("NASA FIRMS returned a CSV with an unrecognized schema.")

    detections = []
    for row in reader:
        try:
            latitude = float(row[fields["latitude"]])
            longitude = float(row[fields["longitude"]])
            observation_date = date.fromisoformat(row[fields["acq_date"]])
            time_value = row[fields["acq_time"]].strip().zfill(4)
            observation_time = f"{time_value[:2]}:{time_value[2:]} UTC"
        except (ValueError, TypeError, KeyError):
            continue
        if not math.isfinite(latitude) or not math.isfinite(longitude):
            continue
        detection = {
            "latitude": latitude,
            "longitude": longitude,
            "date": observation_date.isoformat(),
            "time_utc": observation_time,
            "satellite": row.get(fields.get("satellite", ""), ""),
            "instrument": row.get(fields.get("instrument", ""), ""),
            "confidence": row.get(fields.get("confidence", ""), ""),
            "frp_mw": _optional_float(row.get(fields.get("frp", ""))),
            "daynight": row.get(fields.get("daynight", ""), ""),
        }
        detections.append(detection)
    return detections


def _optional_float(value: str | None) -> float | None:
    try:
        result = float(value) if value else None
    except ValueError:
        return None
    return result if result is not None and math.isfinite(result) else None


async def fetch_fire_detections(
    latitude: float,
    longitude: float,
    start_date: date,
    end_date: date,
    radius_km: float,
) -> dict[str, Any]:
    """Fetch archived VIIRS fire detections for a radius around a selected point."""
    settings = get_settings()
    if not settings.firms_map_key:
        raise RuntimeError(
            "NASA FIRMS requires a free MAP_KEY. Set FIRMS_MAP_KEY in the backend .env and restart the API."
        )

    cache_key = f"{latitude:.4f}:{longitude:.4f}:{start_date}:{end_date}:{radius_km:.1f}"
    cached = _cache.get(cache_key)
    if cached and monotonic() - cached[0] < settings.cache_ttl_seconds:
        return cached[1]

    west, south, east, north = _point_bbox(latitude, longitude, radius_km)
    area = f"{west:.5f},{south:.5f},{east:.5f},{north:.5f}"
    detections = []
    request_start = start_date
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            while request_start <= end_date:
                day_range = min(5, (end_date - request_start).days + 1)
                url = (
                    f"{FIRMS_AREA_URL}/{settings.firms_map_key}/{SOURCE}/"
                    f"{area}/{day_range}/{request_start.isoformat()}"
                )
                response = await client.get(url)
                if response.status_code in (401, 403):
                    raise RuntimeError("NASA FIRMS rejected the configured MAP_KEY.")
                if response.is_error:
                    raise RuntimeError(f"NASA FIRMS returned HTTP {response.status_code}.")
                detections.extend(parse_firms_csv(response.text))
                request_start += timedelta(days=day_range)
    except httpx.TimeoutException as error:
        raise RuntimeError("NASA FIRMS timed out while retrieving fire detections.") from error
    except httpx.RequestError as error:
        raise RuntimeError("Could not connect to NASA FIRMS.") from error

    unique = {}
    for detection in detections:
        key = (
            detection["latitude"],
            detection["longitude"],
            detection["date"],
            detection["time_utc"],
            detection["satellite"],
        )
        unique[key] = detection
    ordered = sorted(unique.values(), key=lambda item: (item["date"], item["time_utc"]), reverse=True)

    result = {
        "source": "NASA FIRMS",
        "product": SOURCE,
        "resolution": "375 m",
        "temporal_granularity": "Detection time in UTC",
        "area": {"radius_km": radius_km, "bbox": [west, south, east, north]},
        "period": {"start": start_date.isoformat(), "end": end_date.isoformat()},
        "detections": ordered,
        "status": "available" if ordered else "no_observations",
        "availability_reason": None if ordered else "NASA FIRMS returned no VIIRS detections in the selected area and date range.",
        "retrieved_at": datetime.now(timezone.utc).isoformat(),
    }
    if settings.cache_ttl_seconds > 0:
        _cache[cache_key] = (monotonic(), result)
    return result
