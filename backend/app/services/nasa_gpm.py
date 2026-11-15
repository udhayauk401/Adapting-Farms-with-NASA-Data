"""NASA GPM IMERG daily precipitation point sampling."""

import asyncio
import io
import math
from datetime import date, datetime, timezone
from time import monotonic
from typing import Any
from urllib.parse import urlparse

import h5py
import httpx
import numpy as np

from backend.app.config import get_settings

CMR_GRANULES_URL = "https://cmr.earthdata.nasa.gov/search/granules.json"
PRODUCT = "GPM_3IMERGDL.07"
_cache: dict[str, tuple[float, dict[str, Any]]] = {}


def _read_point_sample(content: bytes, latitude: float, longitude: float) -> float | None:
    try:
        with h5py.File(io.BytesIO(content), "r") as granule:
            grid = granule["Grid"]
            latitudes = np.asarray(grid["lat"]).reshape(-1)
            longitudes = np.asarray(grid["lon"]).reshape(-1)
            precipitation = grid["precipitation"]
            row = int(np.abs(latitudes - latitude).argmin())
            column = int(np.abs(longitudes - longitude).argmin())
            grid_shape = precipitation.shape[-2:]
            if grid_shape == (len(latitudes), len(longitudes)):
                grid_index = (row, column)
            elif grid_shape == (len(longitudes), len(latitudes)):
                grid_index = (column, row)
            else:
                raise RuntimeError("NASA GPM IMERG returned inconsistent coordinate and raster dimensions.")
            index = (0, *grid_index) if precipitation.ndim == 3 else grid_index
            value = float(precipitation[index])
            fill_value = precipitation.attrs.get("_FillValue")
            missing_value = precipitation.attrs.get("missing_value")
            raw_units = precipitation.attrs.get("units", precipitation.attrs.get("Units", "mm/day"))
    except (KeyError, OSError, TypeError, ValueError, IndexError) as error:
        raise RuntimeError("NASA GPM IMERG returned an unrecognized daily granule.") from error

    if not math.isfinite(value) or value < 0:
        return None
    for missing in (fill_value, missing_value):
        if missing is not None and value == float(np.asarray(missing).reshape(-1)[0]):
            return None

    if isinstance(raw_units, bytes):
        raw_units = raw_units.decode("utf-8", errors="replace")
    units = str(raw_units).casefold().replace(" ", "")
    if "mm/hr" in units or "mmh-1" in units or "mmhour-1" in units:
        return value * 24
    if units in {"mm/day", "mmd-1", "mm", "millimeter", "millimeters", "millimetre", "millimetres"}:
        return value
    raise RuntimeError(f"NASA GPM IMERG returned unsupported precipitation units: {raw_units}.")


async def fetch_daily_precipitation(
    latitude: float,
    longitude: float,
    start_date: date,
    end_date: date,
) -> dict[str, Any]:
    """Fetch IMERG Late Run daily precipitation samples for a coordinate."""
    settings = get_settings()
    if not settings.earthdata_access_token:
        raise RuntimeError(
            "NASA GPM IMERG requires an Earthdata Login user token. "
            "Set EARTHDATA_ACCESS_TOKEN in the backend .env and restart the API."
        )

    cache_key = f"{latitude:.4f}:{longitude:.4f}:{start_date}:{end_date}"
    cached = _cache.get(cache_key)
    if cached and monotonic() - cached[0] < settings.cache_ttl_seconds:
        return cached[1]

    client = httpx.AsyncClient(timeout=60.0)
    try:
        try:
            metadata_response = await client.get(
                CMR_GRANULES_URL,
                params={
                    "short_name": "GPM_3IMERGDL",
                    "version": "07",
                    "temporal": f"{start_date.isoformat()}T00:00:00Z,{end_date.isoformat()}T23:59:59Z",
                    "page_size": 1000,
                },
                headers={"Accept": "application/json"},
            )
            metadata_response.raise_for_status()
            entries = metadata_response.json().get("feed", {}).get("entry", [])
        except httpx.TimeoutException as error:
            raise RuntimeError("NASA CMR timed out while searching GPM IMERG granules.") from error
        except httpx.HTTPStatusError as error:
            raise RuntimeError(f"NASA CMR returned HTTP {error.response.status_code} for GPM IMERG.") from error
        except httpx.RequestError as error:
            raise RuntimeError("Could not connect to NASA CMR for GPM IMERG.") from error
        except (ValueError, TypeError, AttributeError) as error:
            raise RuntimeError("NASA CMR returned an unrecognized GPM IMERG catalog response.") from error

        granules = []
        for entry in entries:
            timestamp = entry.get("time_start", "")
            try:
                observation_date = date.fromisoformat(timestamp[:10])
            except ValueError:
                continue
            if observation_date < start_date or observation_date > end_date:
                continue
            data_url = next(
                (
                    link.get("href") for link in entry.get("links", [])
                    if link.get("href", "").endswith(".nc4")
                ),
                None,
            )
            if data_url:
                granules.append((observation_date, data_url))

        semaphore = asyncio.Semaphore(3)

        async def retrieve_granule(observation_date: date, data_url: str) -> dict[str, Any]:
            parsed_url = urlparse(data_url)
            if (
                parsed_url.scheme != "https"
                or not parsed_url.hostname
                or not parsed_url.hostname.endswith(".earthdata.nasa.gov")
            ):
                raise RuntimeError("NASA CMR returned a GPM granule link outside the Earthdata domain.")
            async with semaphore:
                try:
                    response = await client.get(
                        data_url,
                        headers={"Authorization": f"Bearer {settings.earthdata_access_token}"},
                    )
                except httpx.TimeoutException as error:
                    raise RuntimeError(f"NASA GPM IMERG granule timed out for {observation_date}.") from error
                except httpx.RequestError as error:
                    raise RuntimeError(f"Could not download NASA GPM IMERG granule for {observation_date}.") from error

            if response.status_code in (401, 403):
                raise RuntimeError("NASA Earthdata access token was rejected for GPM IMERG. Check that it is valid.")
            if response.is_error:
                raise RuntimeError(f"NASA GPM IMERG returned HTTP {response.status_code} for {observation_date}.")
            if len(response.content) > 80 * 1024 * 1024:
                raise RuntimeError(f"NASA GPM IMERG granule for {observation_date} exceeded the size limit.")
            value = _read_point_sample(response.content, latitude, longitude)
            return {"date": observation_date.isoformat(), "value": value}

        samples = await asyncio.gather(
            *(retrieve_granule(observation_date, data_url) for observation_date, data_url in granules)
        ) if granules else []
    finally:
        await client.aclose()

    samples.sort(key=lambda item: item["date"])
    result = {
        "source": "NASA GPM IMERG",
        "product": PRODUCT,
        "run": "Late Run",
        "units": "mm/day",
        "resolution": "0.1° (approximately 10 km)",
        "temporal_granularity": "Daily",
        "period": {"start": start_date.isoformat(), "end": end_date.isoformat()},
        "coordinates": {"latitude": latitude, "longitude": longitude},
        "observations": {"GPM_IMERG": {"units": "mm/day", "daily": samples}},
        "availability_reason": None if samples else (
            "No GPM IMERG Late Run daily granules are available for this date range; "
            "recent data can be delayed while NASA processes the product."
        ),
        "retrieved_at": datetime.now(timezone.utc).isoformat(),
    }
    if settings.cache_ttl_seconds > 0:
        _cache[cache_key] = (monotonic(), result)
    return result
