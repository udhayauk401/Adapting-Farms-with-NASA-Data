import unittest

from backend.app.services.climate_analysis import (
    build_environmental_evidence,
    build_monthly_climatology,
    summarize_current_period,
)
from backend.app.services.crop_suitability import (
    build_crop_assessments,
    build_crop_recommendations,
    build_recommendation_readiness,
)


def monthly_observation(year, month, value):
    return {"year": year, "month": month, "value": value}


class ClimateAnalysisTests(unittest.TestCase):
    def setUp(self):
        self.monthly_data = {
            "observations": {
                "T2M": {
                    "monthly": [
                        monthly_observation(2019, 1, 10.0),
                        monthly_observation(2020, 1, 20.0),
                        monthly_observation(2020, 13, 30.0),
                    ],
                },
                "PRECTOTCORR": {
                    "monthly": [
                        monthly_observation(2019, 1, 1.0),
                        monthly_observation(2020, 1, 3.0),
                        monthly_observation(2020, 13, 99.0),
                    ],
                },
            },
        }

    def test_climatology_aggregates_calendar_month_and_ignores_annual_record(self):
        january = build_monthly_climatology(self.monthly_data)[0]

        self.assertEqual(january["temperature_mean_c"], 15.0)
        self.assertEqual(january["precipitation_mean_mm_day"], 2.0)
        self.assertEqual(january["precipitation_mean_mm_month"], 62.0)
        self.assertEqual(january["precipitation_year_count"], 2)

    def test_current_period_compares_with_matching_month_normal(self):
        climatology = build_monthly_climatology(self.monthly_data)
        daily_data = {
            "period": {"start": "2020-01-01", "end": "2020-01-02"},
            "observations": {
                "T2M": {
                    "daily": [
                        {"date": "2020-01-01", "value": 15.0},
                        {"date": "2020-01-02", "value": 17.0},
                    ],
                },
                "PRECTOTCORR": {
                    "daily": [
                        {"date": "2020-01-01", "value": 1.0},
                        {"date": "2020-01-02", "value": 2.0},
                    ],
                },
            },
        }

        result = summarize_current_period(daily_data, climatology)

        self.assertEqual(result["temperature_anomaly_vs_monthly_normal_c"], 1.0)
        self.assertEqual(result["precipitation_total_mm"], 3.0)
        self.assertEqual(result["precipitation_expected_for_observed_days_mm"], 4.0)
        self.assertEqual(result["precipitation_anomaly_percent_vs_monthly_normal"], -25.0)

    def test_crop_scores_are_not_fabricated_without_reviewed_profiles(self):
        assessments = build_crop_assessments()
        readiness = build_recommendation_readiness({
            "historical_climatology": {
                "monthly": [{"temperature_mean_c": 25, "precipitation_mean_mm_day": 1}],
            },
            "current_period": {"temperature_mean_c": 25, "precipitation_total_mm": 4},
            "future_forecast": {"status": "unavailable"},
        })

        self.assertEqual(len(assessments), 8)
        self.assertTrue(all(item["score"] is None for item in assessments))
        self.assertTrue(all(item["result"] == "Insufficient Evidence" for item in assessments))
        self.assertEqual(readiness["current_season"]["status"], "incomplete")
        self.assertEqual(readiness["upcoming_season"]["status"], "unavailable")
        self.assertEqual(readiness["scoring"]["status"], "not_configured")

    def test_environmental_evidence_preserves_units_source_and_latest_date(self):
        daily_data = {
            "source": "NASA POWER",
            "product": "Daily product",
            "period": {"start": "2024-01-01", "end": "2024-01-03"},
            "observations": {
                "T2M": {
                    "units": "°C",
                    "daily": [
                        {"date": "2024-01-01", "value": 20.0},
                        {"date": "2024-01-02", "value": None},
                        {"date": "2024-01-03", "value": 24.0},
                    ],
                },
            },
        }

        evidence = build_environmental_evidence(daily_data)
        temperature = next(item for item in evidence if item["parameter"] == "T2M")
        precipitation = next(item for item in evidence if item["parameter"] == "PRECTOTCORR")

        self.assertEqual(temperature["source"], "NASA POWER")
        self.assertEqual(temperature["units"], "°C")
        self.assertEqual(temperature["mean_value"], 22.0)
        self.assertEqual(temperature["latest_observation_date"], "2024-01-03")
        self.assertEqual(precipitation["status"], "unavailable")
        self.assertIsNone(precipitation["latest_value"])
        self.assertEqual(len(evidence), 7)
        self.assertTrue(all(item["source"] == "NASA POWER" for item in evidence))
        self.assertNotIn("SMAP_SOIL_MOISTURE", {item["parameter"] for item in evidence})

        assessments = build_crop_assessments(evidence)
        self.assertTrue(all(item["result"] == "Insufficient Evidence" for item in assessments))
        self.assertTrue(all(item["score"] is None for item in assessments))
        self.assertTrue(all(item["observed_factors"] == [temperature["name"]] for item in assessments))

    def test_recommendations_are_withheld_without_forecast_and_crop_requirements(self):
        recommendations = build_crop_recommendations({
            "current_period": {
                "temperature_mean_c": 24.0,
                "precipitation_total_mm": 16.0,
            },
        })

        self.assertEqual(recommendations["status"], "insufficient_data")
        self.assertEqual(recommendations["items"], [])
        self.assertIsNone(recommendations["best_crop"])
        self.assertTrue(any("future conditions" in item for item in recommendations["missing_inputs"]))


if __name__ == "__main__":
    unittest.main()
