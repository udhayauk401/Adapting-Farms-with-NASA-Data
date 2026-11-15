"""Evidence-gated crop recommendation readiness."""

from typing import Any


CROP_CANDIDATES = (
    {"id": "rice", "name": "Rice"},
    {"id": "maize", "name": "Maize"},
    {"id": "sorghum", "name": "Sorghum"},
    {"id": "finger-millet", "name": "Finger Millet"},
    {"id": "pearl-millet", "name": "Pearl Millet"},
    {"id": "wheat", "name": "Wheat"},
    {"id": "groundnut", "name": "Groundnut"},
    {"id": "soybean", "name": "Soybean"},
)

MISSING_CROP_INPUTS = (
    "Validated temperature, precipitation, wind, solar-radiation, and humidity requirements for this crop variety at each growth stage.",
    "Crop variety, planting date, and growth-stage timing.",
    "Field soil properties, including texture, drainage, pH, and nutrients.",
    "Irrigation availability and field soil-moisture measurements.",
    "Full-season weather context and future conditions; selected-period observations are not a forecast.",
    "A validated method for comparing crop requirements with the available evidence.",
)


def build_crop_assessments(
    environmental_evidence: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    """Report observed NASA POWER factors without inventing crop requirements or scores."""
    observed_factors = [
        item["name"]
        for item in environmental_evidence or []
        if item.get("source") == "NASA POWER" and item.get("status") == "available"
    ]
    return [
        {
            **crop,
            "score": None,
            "confidence": None,
            "category": "Insufficient Evidence",
            "status": "insufficient_evidence",
            "result": "Insufficient Evidence",
            "observed_factors": observed_factors,
            "missing_inputs": list(MISSING_CROP_INPUTS),
            "explanation": (
                f"NASA POWER observations describe environmental conditions but do not "
                f"provide validated requirements for {crop['name']} or field-specific "
                "conditions. Suitability cannot be determined and no score is calculated."
            ),
        }
        for crop in CROP_CANDIDATES
    ]


def build_crop_recommendations(climate_analysis: dict[str, Any]) -> dict[str, Any]:
    """Return no ranking until local season, profile, forecast, and field evidence exist."""
    current_period = climate_analysis["current_period"]
    climate_observed = (
        current_period["temperature_mean_c"] is not None
        or current_period["precipitation_total_mm"] is not None
    )
    missing_inputs = list(MISSING_CROP_INPUTS)
    if not climate_observed:
        missing_inputs.insert(0, "Valid current-period temperature or precipitation observations.")

    return {
        "status": "insufficient_data",
        "label": "Insufficient Evidence",
        "items": [],
        "best_crop": None,
        "preliminary_candidates": [],
        "reason": (
            "Available NASA POWER climate observations provide historical context, "
            "but do not establish crop suitability for an upcoming local growing season. "
            "No crop is recommended or ranked."
        ),
        "missing_inputs": missing_inputs,
        "method": None,
    }


def build_recommendation_readiness(climate_analysis: dict[str, Any]) -> dict[str, Any]:
    """Separate evidence availability for current, upcoming, and resilience views."""
    historical_months = climate_analysis["historical_climatology"]["monthly"]
    historical_available = any(
        month["temperature_mean_c"] is not None
        or month["precipitation_mean_mm_day"] is not None
        for month in historical_months
    )
    current_period = climate_analysis["current_period"]
    current_available = (
        current_period["temperature_mean_c"] is not None
        or current_period["precipitation_total_mm"] is not None
    )
    future_available = climate_analysis["future_forecast"]["status"] == "available"

    def category(status: str, reason: str) -> dict[str, str]:
        return {"status": status, "reason": reason}

    return {
        "current_season": category(
            "incomplete" if current_available else "unavailable",
            "Current NASA POWER observations are available, but source-reviewed crop requirements, field soil conditions, and irrigation inputs are not verified.",
        ),
        "upcoming_season": category(
            "incomplete" if historical_available and future_available else "unavailable",
            "A future-season forecast and validated crop-specific requirements are unavailable; historical climate summaries cannot forecast the upcoming growing season.",
        ),
        "climate_resilient_alternatives": category(
            "incomplete" if historical_available else "unavailable",
            "Historical climate context alone cannot establish future resilience. Forecasts and source-reviewed crop requirements are unavailable.",
        ),
        "scoring": {
            "status": "not_configured",
            "score_type": None,
            "method": None,
            "reason": (
                "No crop suitability score is calculated until crop requirement "
                "profiles and a validated scoring method are available."
            ),
        },
    }
