"""NASA POWER daily point-data client."""

from datetime import datetime, timezone
from time import monotonic
from typing import Any

import httpx

from backend.app.config import get_settings

NASA_POWER_URL = "https://power.larc.nasa.gov/api/temporal/daily/point"
NASA_POWER_MONTHLY_URL = "https://power.larc.nasa.gov/api/temporal/monthly/point"
PARAMETERS = {
    "T2M": ("°C", "Air temperature at 2 meters"),
    "T2M_MAX": ("°C", "Maximum air temperature at 2 meters"),
    "T2M_MIN": ("°C", "Minimum air temperature at 2 meters"),
    "WS2M": ("m/s", "Wind speed at 2 meters"),
    "PRECTOTCORR": ("mm/day", "Corrected precipitation"),
    "ALLSKY_SFC_SW_DWN": ("MJ/m²/day", "All-sky surface shortwave downward irradiance"),
    "RH2M": ("%", "Relative humidity at 2 meters"),
}
MONTHLY_PARAMETERS = {
    "T2M": ("°C", "Mean air temperature at 2 meters"),
    "T2M_MAX": ("°C", "Mean daily maximum air temperature at 2 meters"),
    "T2M_MIN": ("°C", "Mean daily minimum air temperature at 2 meters"),
    "WS2M": ("m/s", "Mean wind speed at 2 meters"),
    "PRECTOTCORR": ("mm/day", "Mean corrected precipitation per day"),
    "ALLSKY_SFC_SW_DWN": ("MJ/m²/day", "Mean all-sky surface shortwave downward irradiance"),
    "RH2M": ("%", "Mean relative humidity at 2 meters"),
}
_cache: dict[str, tuple[float, dict[str, Any]]] = {}


async def fetch_daily_observations(
    latitude: float,
    longitude: float,
    start_date: str,
    end_date: str,
) -> dict[str, Any]:
    """Fetch and normalize daily observations for a single point."""
    cache_key = f"{latitude:.4f}:{longitude:.4f}:{start_date}:{end_date}"
    cached = _cache.get(cache_key)
    if cached and monotonic() - cached[0] < get_settings().cache_ttl_seconds:
        return cached[1]

    params = {
        "parameters": ",".join(PARAMETERS),
        "community": "AG",
        "longitude": longitude,
        "latitude": latitude,
        "start": start_date.replace("-", ""),
        "end": end_date.replace("-", ""),
        "format": "JSON",
        "time-standard": "UTC",
    }

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(NASA_POWER_URL, params=params)
            response.raise_for_status()
    except httpx.TimeoutException as error:
        raise RuntimeError("NASA POWER did not respond before the 30-second timeout.") from error
    except httpx.HTTPStatusError as error:
        raise RuntimeError(f"NASA POWER returned HTTP {error.response.status_code}.") from error
    except httpx.RequestError as error:
        raise RuntimeError("Could not connect to NASA POWER.") from error

    try:
        payload = response.json()
        properties = payload["properties"]
        parameter_values = properties["parameter"]
        parameter_metadata = payload["parameters"]
        header = payload["header"]
    except (ValueError, KeyError, TypeError) as error:
        raise RuntimeError("NASA POWER returned an unrecognized response.") from error

    observations = {}
    for code, (fallback_unit, fallback_description) in PARAMETERS.items():
        values = parameter_values.get(code, {})
        metadata = parameter_metadata.get(code, {})
        fill_value = header.get("fill_value", -999)
        observations[code] = {
            "units": metadata.get("units", fallback_unit),
            "description": metadata.get("longname", fallback_description),
            "daily": [
                {
                    "date": f"{date[:4]}-{date[4:6]}-{date[6:]}",
                    "value": None if value == fill_value else value,
                }
                for date, value in sorted(values.items())
            ],
        }

    geometry = payload.get("geometry", {}).get("coordinates", [])
    result = {
        "source": "NASA POWER",
        "product": header.get("title", "NASA/POWER Daily Data"),
        "api": header.get("api", {}).get("name", "POWER Daily API"),
        "coordinates": {
            "requested": {"latitude": latitude, "longitude": longitude},
            "grid": {
                "longitude": geometry[0] if len(geometry) > 0 else None,
                "latitude": geometry[1] if len(geometry) > 1 else None,
                "elevation_m": geometry[2] if len(geometry) > 2 else None,
            },
        },
        "period": {"start": start_date, "end": end_date},
        "resolution": "NASA POWER source-native resolution; varies by parameter",
        "update_frequency": "Daily product; near-real-time availability and latency vary.",
        "time_standard": header.get("time_standard", "UTC"),
        "observations": observations,
        "retrieved_at": datetime.now(timezone.utc).isoformat(),
    }
    if get_settings().cache_ttl_seconds > 0:
        if len(_cache) >= 512:
            oldest_key = min(_cache, key=lambda key: _cache[key][0])
            del _cache[oldest_key]
        _cache[cache_key] = (monotonic(), result)
    return result


async def fetch_monthly_observations(
    latitude: float,
    longitude: float,
    start_year: int,
    end_year: int,
) -> dict[str, Any]:
    """Fetch and normalize NASA POWER monthly observations for a point."""
    cache_key = f"monthly:{latitude:.4f}:{longitude:.4f}:{start_year}:{end_year}"
    cached = _cache.get(cache_key)
    if cached and monotonic() - cached[0] < get_settings().cache_ttl_seconds:
        return cached[1]

    params = {
        "parameters": ",".join(MONTHLY_PARAMETERS),
        "community": "AG",
        "longitude": longitude,
        "latitude": latitude,
        "start": start_year,
        "end": end_year,
        "format": "JSON",
        "time-standard": "UTC",
    }

    try:
        async with httpx.AsyncClient(timeout=45.0) as client:
            response = await client.get(NASA_POWER_MONTHLY_URL, params=params)
            response.raise_for_status()
    except httpx.TimeoutException as error:
        raise RuntimeError("NASA POWER monthly data did not respond before the 45-second timeout.") from error
    except httpx.HTTPStatusError as error:
        raise RuntimeError(f"NASA POWER monthly data returned HTTP {error.response.status_code}.") from error
    except httpx.RequestError as error:
        raise RuntimeError("Could not connect to NASA POWER monthly data.") from error

    try:
        payload = response.json()
        properties = payload["properties"]
        parameter_values = properties["parameter"]
        parameter_metadata = payload["parameters"]
        header = payload["header"]
    except (ValueError, KeyError, TypeError) as error:
        raise RuntimeError("NASA POWER monthly data returned an unrecognized response.") from error

    fill_value = header.get("fill_value", -999)
    observations = {}
    for code, (fallback_unit, fallback_description) in MONTHLY_PARAMETERS.items():
        values = parameter_values.get(code, {})
        metadata = parameter_metadata.get(code, {})
        monthly = []
        for date_key, value in sorted(values.items()):
            if len(date_key) != 6 or not date_key.isdigit():
                continue
            month = int(date_key[4:6])
            if month < 1 or month > 12:
                continue
            monthly.append({
                "year": int(date_key[:4]),
                "month": month,
                "value": None if value == fill_value else value,
            })
        observations[code] = {
            "units": metadata.get("units", fallback_unit),
            "description": metadata.get("longname", fallback_description),
            "monthly": monthly,
        }

    geometry = payload.get("geometry", {}).get("coordinates", [])
    result = {
        "source": "NASA POWER",
        "product": header.get("title", "NASA/POWER Monthly and Annual Data"),
        "api": header.get("api", {}).get("name", "POWER Monthly and Annual API"),
        "coordinates": {
            "requested": {"latitude": latitude, "longitude": longitude},
            "grid": {
                "longitude": geometry[0] if len(geometry) > 0 else None,
                "latitude": geometry[1] if len(geometry) > 1 else None,
                "elevation_m": geometry[2] if len(geometry) > 2 else None,
            },
        },
        "period": {"start_year": start_year, "end_year": end_year},
        "resolution": "NASA POWER source-native resolution; varies by parameter",
        "update_frequency": "Monthly product; coverage and latency vary by parameter.",
        "time_standard": header.get("time_standard", "UTC"),
        "observations": observations,
        "retrieved_at": datetime.now(timezone.utc).isoformat(),
    }
    if get_settings().cache_ttl_seconds > 0:
        if len(_cache) >= 512:
            oldest_key = min(_cache, key=lambda key: _cache[key][0])
            del _cache[oldest_key]
        _cache[cache_key] = (monotonic(), result)
    return result
