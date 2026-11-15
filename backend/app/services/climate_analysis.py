"""Historical climate summaries and current-period comparisons."""

import calendar
from collections import defaultdict
from datetime import date
from math import floor, isfinite
from statistics import mean, pstdev
from typing import Any


BASELINE_START_YEAR = 1991
BASELINE_END_YEAR = 2020
MONTH_NAMES = (
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
)


def _valid_values(items: list[dict[str, Any]]) -> list[float]:
    return [
        float(item["value"])
        for item in items
        if isinstance(item.get("value"), (int, float))
        and isfinite(float(item["value"]))
        and float(item["value"]) != -999
    ]


def _percentile(values: list[float], percentile: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    position = (len(ordered) - 1) * percentile
    lower = floor(position)
    upper = min(lower + 1, len(ordered) - 1)
    fraction = position - lower
    return ordered[lower] + (ordered[upper] - ordered[lower]) * fraction


def build_monthly_climatology(monthly_data: dict[str, Any]) -> list[dict[str, Any]]:
    """Aggregate annual monthly values into per-calendar-month normals."""
    observations = monthly_data["observations"]
    grouped: dict[int, dict[str, list[float]]] = defaultdict(
        lambda: defaultdict(list),
    )
    parameter_map = {
        "T2M": "temperature_c",
        "T2M_MAX": "temperature_max_c",
        "T2M_MIN": "temperature_min_c",
        "PRECTOTCORR": "precipitation_mm_day",
        "ALLSKY_SFC_SW_DWN": "solar_radiation_mj_m2_day",
        "RH2M": "relative_humidity_percent",
        "WS2M": "wind_speed_m_s",
    }

    for parameter, output_key in parameter_map.items():
        for item in observations.get(parameter, {}).get("monthly", []):
            value = item.get("value")
            month = item.get("month")
            year = item.get("year")
            if (
                isinstance(value, (int, float))
                and isfinite(float(value))
                and float(value) != -999
                and isinstance(month, int)
                and 1 <= month <= 12
                and isinstance(year, int)
            ):
                grouped[month][output_key].append(float(value))

    precipitation_by_month_year: dict[int, dict[int, float]] = defaultdict(dict)
    for item in observations.get("PRECTOTCORR", {}).get("monthly", []):
        value = item.get("value")
        month = item.get("month")
        year = item.get("year")
        if (
            isinstance(value, (int, float))
            and isfinite(float(value))
            and float(value) != -999
            and isinstance(month, int)
            and 1 <= month <= 12
            and isinstance(year, int)
        ):
            days = calendar.monthrange(year, month)[1]
            precipitation_by_month_year[month][year] = float(value) * days

    results = []
    for month in range(1, 13):
        values = grouped[month]
        yearly_rainfall = list(precipitation_by_month_year[month].values())
        mean_rainfall = mean(yearly_rainfall) if yearly_rainfall else None
        rainfall_variability = None
        if mean_rainfall and mean_rainfall > 0 and len(yearly_rainfall) > 1:
            rainfall_variability = pstdev(yearly_rainfall) / mean_rainfall * 100

        results.append({
            "month": month,
            "month_name": MONTH_NAMES[month - 1],
            "temperature_mean_c": mean(values["temperature_c"]) if values["temperature_c"] else None,
            "temperature_max_mean_c": mean(values["temperature_max_c"]) if values["temperature_max_c"] else None,
            "temperature_min_mean_c": mean(values["temperature_min_c"]) if values["temperature_min_c"] else None,
            "precipitation_mean_mm_day": mean(values["precipitation_mm_day"]) if values["precipitation_mm_day"] else None,
            "precipitation_mean_mm_month": mean_rainfall,
            "precipitation_p10_mm_month": _percentile(yearly_rainfall, 0.1),
            "precipitation_p90_mm_month": _percentile(yearly_rainfall, 0.9),
            "precipitation_cv_percent": rainfall_variability,
            "solar_radiation_mean_mj_m2_day": mean(values["solar_radiation_mj_m2_day"]) if values["solar_radiation_mj_m2_day"] else None,
            "relative_humidity_mean_percent": mean(values["relative_humidity_percent"]) if values["relative_humidity_percent"] else None,
            "wind_speed_mean_m_s": mean(values["wind_speed_m_s"]) if values["wind_speed_m_s"] else None,
            "temperature_year_count": len(values["temperature_c"]),
            "precipitation_year_count": len(yearly_rainfall),
        })
    return results


def summarize_current_period(
    daily_data: dict[str, Any],
    climatology: list[dict[str, Any]],
) -> dict[str, Any]:
    """Compare retrieved daily observations with month-matched climate normals."""
    normal_by_month = {item["month"]: item for item in climatology}
    observations = daily_data["observations"]
    parameter_codes = {
        "temperature_mean_c": "T2M",
        "temperature_max_mean_c": "T2M_MAX",
        "temperature_min_mean_c": "T2M_MIN",
        "precipitation_total_mm": "PRECTOTCORR",
        "solar_radiation_mean_mj_m2_day": "ALLSKY_SFC_SW_DWN",
        "relative_humidity_mean_percent": "RH2M",
        "wind_speed_mean_m_s": "WS2M",
    }
    valid_by_code: dict[str, list[dict[str, Any]]] = {}
    for code in parameter_codes.values():
        valid_by_code[code] = [
            item
            for item in observations.get(code, {}).get("daily", [])
            if item.get("value") is not None
            and isinstance(item.get("value"), (int, float))
            and isfinite(float(item["value"]))
        ]

    result: dict[str, Any] = {
        "period": daily_data.get("period"),
        "temperature_observation_days": len(valid_by_code["T2M"]),
        "precipitation_observation_days": len(valid_by_code["PRECTOTCORR"]),
    }
    for output_key, code in parameter_codes.items():
        values = _valid_values(valid_by_code[code])
        if not values:
            result[output_key] = None
        elif output_key == "precipitation_total_mm":
            result[output_key] = sum(values)
        else:
            result[output_key] = mean(values)

    temperature_anomalies = []
    expected_rainfall = 0.0
    expected_rainfall_days = 0
    for item in valid_by_code["T2M"]:
        observation_date = date.fromisoformat(item["date"])
        normal = normal_by_month.get(observation_date.month, {})
        normal_temperature = normal.get("temperature_mean_c")
        if normal_temperature is not None:
            temperature_anomalies.append(float(item["value"]) - normal_temperature)

    for item in valid_by_code["PRECTOTCORR"]:
        observation_date = date.fromisoformat(item["date"])
        normal = normal_by_month.get(observation_date.month, {})
        normal_precipitation = normal.get("precipitation_mean_mm_day")
        if normal_precipitation is not None:
            expected_rainfall += normal_precipitation
            expected_rainfall_days += 1

    observed_rainfall = result["precipitation_total_mm"]
    rainfall_anomaly_percent = None
    if observed_rainfall is not None and expected_rainfall > 0 and expected_rainfall_days:
        rainfall_anomaly_percent = (observed_rainfall - expected_rainfall) / expected_rainfall * 100

    result["temperature_anomaly_vs_monthly_normal_c"] = (
        mean(temperature_anomalies) if temperature_anomalies else None
    )
    result["precipitation_expected_for_observed_days_mm"] = (
        expected_rainfall if expected_rainfall_days else None
    )
    result["precipitation_anomaly_percent_vs_monthly_normal"] = rainfall_anomaly_percent
    result["baseline_period"] = {
        "start_year": BASELINE_START_YEAR,
        "end_year": BASELINE_END_YEAR,
        "method": "Month-matched NASA POWER monthly normals; daily precipitation rate summed over dates with valid observations.",
    }
    return result


def build_environmental_evidence(daily_data: dict[str, Any]) -> list[dict[str, Any]]:
    """Summarize each NASA POWER variable with its source and actual observation dates."""
    variables = (
        ("T2M", "Mean air temperature at 2 meters"),
        ("T2M_MAX", "Maximum air temperature at 2 meters"),
        ("T2M_MIN", "Minimum air temperature at 2 meters"),
        ("PRECTOTCORR", "Corrected precipitation"),
        ("ALLSKY_SFC_SW_DWN", "All-sky surface shortwave radiation"),
        ("RH2M", "Relative humidity at 2 meters"),
        ("WS2M", "Wind speed at 2 meters"),
    )
    observations = daily_data["observations"]
    results = []
    for code, label in variables:
        parameter = observations.get(code, {})
        valid = [
            item
            for item in parameter.get("daily", [])
            if isinstance(item.get("value"), (int, float))
            and isfinite(float(item["value"]))
            and float(item["value"]) != -999
        ]
        results.append({
            "parameter": code,
            "name": label,
            "source": daily_data["source"],
            "product": daily_data["product"],
            "units": parameter.get("units"),
            "status": "available" if valid else "unavailable",
            "observation_period": daily_data.get("period"),
            "observation_count": len(valid),
            "mean_value": mean(float(item["value"]) for item in valid) if valid else None,
            "latest_value": float(valid[-1]["value"]) if valid else None,
            "latest_observation_date": valid[-1]["date"] if valid else None,
        })
    return results


def analyze_climate(
    daily_data: dict[str, Any],
    monthly_data: dict[str, Any],
) -> dict[str, Any]:
    """Build climate context without turning observations into forecasts."""
    climatology = build_monthly_climatology(monthly_data)
    history_source = {
        "source": monthly_data["source"],
        "product": monthly_data["product"],
        "api": monthly_data["api"],
        "coordinates": monthly_data["coordinates"],
        "period": monthly_data["period"],
        "resolution": monthly_data["resolution"],
        "update_frequency": monthly_data["update_frequency"],
        "time_standard": monthly_data["time_standard"],
        "retrieved_at": monthly_data["retrieved_at"],
        "units": {
            code: item["units"]
            for code, item in monthly_data["observations"].items()
        },
    }
    return {
        "current_period": summarize_current_period(daily_data, climatology),
        "historical_climatology": {
            "baseline_period": {
                "start_year": BASELINE_START_YEAR,
                "end_year": BASELINE_END_YEAR,
            },
            "method": (
                "Per-calendar-month means and rainfall percentiles from NASA POWER "
                "monthly values for the 1991–2020 baseline. Precipitation totals "
                "are computed from the monthly mean daily rate and calendar month length."
            ),
            "monthly": climatology,
            "source": history_source,
        },
        "future_forecast": {
            "status": "unavailable",
            "label": "Future forecast unavailable",
            "reason": (
                "No verified seasonal forecast provider is connected. NASA POWER "
                "historical and near-real-time observations are not forecasts."
            ),
        },
        "limitations": [
            "NASA SMAP and NASA MODIS observations are available through separate dashboard APIs but are not included in this POWER-only analysis.",
            "Historical daily extremes and dry-spell durations are not calculated by monthly normals.",
            "A grid-cell observation is not a field-level diagnosis.",
        ],
    }
