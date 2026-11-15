"""NASA Earthdata point samples for SMAP soil moisture and MODIS NDVI."""

import asyncio
import csv
import io
import math
import re
from datetime import date, datetime, timezone
from time import monotonic
from typing import Any

import httpx

from backend.app.config import get_settings

APPEEARS_URL = "https://appeears.earthdatacloud.nasa.gov/api"
PRODUCTS = {
    "SMAP_SOIL_MOISTURE": {
        "source": "NASA SMAP",
        "product": "SPL3SMP_E.006",
        "layer": "Soil_Moisture_Retrieval_Data_AM_soil_moisture",
        "units": "m³/m³",
        "resolution": "9 km",
        "temporal_granularity": "Daily",
        "valid_min": 0.02,
        "valid_max": 0.5,
    },
    "MODIS_NDVI": {
        "source": "NASA MODIS",
        "product": "MOD13Q1.061",
        "layer": "_250m_16_days_NDVI",
        "units": "NDVI",
        "resolution": "250 m",
        "temporal_granularity": "16-day composite",
        "valid_min": -0.2,
        "valid_max": 1.0,
    },
}

_cache: dict[str, tuple[float, dict[str, Any]]] = {}


class EarthdataCredentialsMissing(RuntimeError):
    """Raised when Earthdata Login is required but not configured."""


def _normalized_name(value: str) -> str:
    return re.sub(r"[^a-z0-9]", "", value.casefold())


def parse_point_csv(
    content: str,
    layer: str,
    valid_min: float,
    valid_max: float,
) -> list[dict[str, Any]]:
    """Normalize one AppEEARS point-result CSV into dated numeric samples."""
    reader = csv.DictReader(io.StringIO(content.lstrip("\ufeff")))
    headers = reader.fieldnames or []
    date_column = next(
        (header for header in headers if _normalized_name(header) in {"date", "calendar_date"}),
        None,
    )
    layer_name = _normalized_name(layer)
    value_column = next(
        (header for header in headers if layer_name in _normalized_name(header)),
        None,
    )
    if date_column is None or value_column is None:
        raise RuntimeError("NASA AppEEARS returned a point CSV with an unrecognized schema.")

    observations = []
    for row in reader:
        raw_date = (row.get(date_column) or "").strip()[:10]
        raw_value = (row.get(value_column) or "").strip()
        try:
            observation_date = date.fromisoformat(raw_date)
            value = float(raw_value)
        except (ValueError, TypeError):
            continue

        if not math.isfinite(value):
            continue
        if layer == PRODUCTS["MODIS_NDVI"]["layer"] and abs(value) > 1:
            value *= 0.0001
        if not valid_min <= value <= valid_max:
            continue
        observations.append({"date": observation_date.isoformat(), "value": value})

    observations.sort(key=lambda item: item["date"])
    return observations


async def _appeears_json(
    client: httpx.AsyncClient,
    method: str,
    path: str,
    token: str | None = None,
    **kwargs: Any,
) -> Any:
    headers = {"Authorization": f"Bearer {token}"} if token else None
    try:
        response = await client.request(method, f"{APPEEARS_URL}{path}", headers=headers, **kwargs)
    except httpx.TimeoutException as error:
        raise RuntimeError(f"NASA AppEEARS timed out while {method} {path}.") from error
    except httpx.RequestError as error:
        raise RuntimeError("Could not connect to NASA AppEEARS.") from error

    if response.status_code in (401, 403):
        raise RuntimeError("NASA Earthdata Login was rejected or AppEEARS access is not authorized.")
    if response.is_error:
        raise RuntimeError(f"NASA AppEEARS returned HTTP {response.status_code}.")
    try:
        return response.json()
    except ValueError as error:
        raise RuntimeError("NASA AppEEARS returned an invalid JSON response.") from error


async def _download_csv(
    client: httpx.AsyncClient,
    task_id: str,
    file_id: str,
    token: str,
) -> str:
    try:
        response = await client.get(
            f"{APPEEARS_URL}/bundle/{task_id}/{file_id}",
            headers={"Authorization": f"Bearer {token}"},
            follow_redirects=True,
        )
    except httpx.TimeoutException as error:
        raise RuntimeError("NASA AppEEARS timed out while downloading point observations.") from error
    except httpx.RequestError as error:
        raise RuntimeError("Could not download point observations from NASA AppEEARS.") from error

    if response.status_code in (401, 403):
        raise RuntimeError("NASA Earthdata Login expired while downloading the point observations.")
    if response.is_error:
        raise RuntimeError(f"NASA AppEEARS returned HTTP {response.status_code} for a point-result file.")
    return response.text


async def fetch_point_observations(
    latitude: float,
    longitude: float,
    start_date: date,
    end_date: date,
    dataset_code: str | None = None,
) -> dict[str, Any]:
    """Fetch cached SMAP and MODIS point observations through NASA AppEEARS."""
    settings = get_settings()
    if not settings.earthdata_username or not settings.earthdata_password:
        raise EarthdataCredentialsMissing(
            "NASA SMAP and MODIS observations require Earthdata Login. "
            "Set EARTHDATA_USERNAME and EARTHDATA_PASSWORD in the backend .env, then restart the API."
        )

    if dataset_code is not None and dataset_code not in PRODUCTS:
        raise RuntimeError(f"Unsupported NASA AppEEARS point dataset: {dataset_code}.")
    selected_products = (
        {dataset_code: PRODUCTS[dataset_code]}
        if dataset_code
        else PRODUCTS
    )
    cache_key = f"{dataset_code or 'all'}:{latitude:.4f}:{longitude:.4f}:{start_date}:{end_date}"
    cached = _cache.get(cache_key)
    if cached and monotonic() - cached[0] < settings.cache_ttl_seconds:
        return cached[1]

    async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
        token_response = await _appeears_json(
            client,
            "POST",
            "/login",
            auth=(settings.earthdata_username, settings.earthdata_password),
        )
        token = token_response.get("token") if isinstance(token_response, dict) else None
        if not token:
            raise RuntimeError("NASA AppEEARS login did not return an access token.")

        task_payload = {
            "task_type": "point",
            "task_name": "AgriGuard point observations",
            "params": {
                "dates": [{
                    "startDate": start_date.strftime("%m-%d-%Y"),
                    "endDate": end_date.strftime("%m-%d-%Y"),
                }],
                "layers": [
                    {"product": product["product"], "layer": product["layer"]}
                    for product in selected_products.values()
                ],
                "coordinates": [{"latitude": latitude, "longitude": longitude}],
            },
        }
        task_response = await _appeears_json(
            client,
            "POST",
            "/task",
            token,
            json=task_payload,
        )
        task_id = task_response.get("task_id") if isinstance(task_response, dict) else None
        if not task_id:
            raise RuntimeError("NASA AppEEARS did not return a point-sample task ID.")

        deadline = monotonic() + 120
        while True:
            task = await _appeears_json(client, "GET", f"/task/{task_id}", token)
            status = task.get("status") if isinstance(task, dict) else None
            if status == "done":
                break
            if status == "error":
                raise RuntimeError("NASA AppEEARS could not process the SMAP/MODIS point request.")
            if monotonic() >= deadline:
                raise RuntimeError("NASA AppEEARS is still processing this point request. Retry shortly.")
            await asyncio.sleep(3)

        bundle = await _appeears_json(client, "GET", f"/bundle/{task_id}", token)
        files = bundle.get("files", []) if isinstance(bundle, dict) else []
        observations = {}
        for code, product in selected_products.items():
            product_id = _normalized_name(product["product"])
            result_file = next(
                (
                    item for item in files
                    if item.get("file_type") == "csv"
                    and product_id in _normalized_name(item.get("file_name", ""))
                ),
                None,
            )
            samples = []
            if result_file:
                csv_content = await _download_csv(
                    client,
                    task_id,
                    result_file["file_id"],
                    token,
                )
                samples = parse_point_csv(
                    csv_content,
                    product["layer"],
                    product["valid_min"],
                    product["valid_max"],
                )
            observations[code] = {
                **{key: value for key, value in product.items() if key not in {"valid_min", "valid_max"}},
                "daily": samples,
            }

    result = {
        "source": "NASA AppEEARS",
        "coordinates": {"latitude": latitude, "longitude": longitude},
        "period": {"start": start_date.isoformat(), "end": end_date.isoformat()},
        "observations": observations,
        "retrieved_at": datetime.now(timezone.utc).isoformat(),
        "sampling_method": "NASA AppEEARS point sample at the selected coordinates; grid-cell values are not field-level measurements.",
    }
    if settings.cache_ttl_seconds > 0:
        if len(_cache) >= 512:
            oldest_key = min(_cache, key=lambda key: _cache[key][0])
            del _cache[oldest_key]
        _cache[cache_key] = (monotonic(), result)
    return result
