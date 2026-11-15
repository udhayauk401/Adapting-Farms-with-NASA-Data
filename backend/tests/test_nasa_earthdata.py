"""Tests for normalizing NASA AppEEARS point samples."""

import unittest
from datetime import date
from unittest.mock import patch

from backend.app.services.nasa_earthdata import (
    EarthdataCredentialsMissing,
    fetch_point_observations,
    parse_point_csv,
)


class NasaEarthdataTests(unittest.IsolatedAsyncioTestCase):
    def test_modis_ndvi_samples_are_scaled_and_fill_values_are_excluded(self):
        samples = parse_point_csv(
            "\ufeffDate,MOD13Q1.061__250m_16_days_NDVI\n"
            "2026-03-01,4500\n"
            "2026-03-17,-3000\n"
            "2026-04-02,0.68\n",
            "_250m_16_days_NDVI",
            -0.2,
            1.0,
        )

        self.assertEqual(samples, [
            {"date": "2026-03-01", "value": 0.45},
            {"date": "2026-04-02", "value": 0.68},
        ])

    def test_smap_volumetric_samples_exclude_invalid_values(self):
        samples = parse_point_csv(
            "Date,SPL3SMP_E.006_Soil_Moisture_Retrieval_Data_AM_soil_moisture\n"
            "2026-03-01,0.31\n"
            "2026-03-02,-9999\n"
            "2026-03-03,0.8\n",
            "Soil_Moisture_Retrieval_Data_AM_soil_moisture",
            0.02,
            0.5,
        )

        self.assertEqual(samples, [{"date": "2026-03-01", "value": 0.31}])

    def test_unrecognized_result_columns_raise_an_explicit_error(self):
        with self.assertRaisesRegex(RuntimeError, "unrecognized schema"):
            parse_point_csv(
                "observation,value\n2026-03-01,0.4\n",
                "_250m_16_days_NDVI",
                -0.2,
                1.0,
            )

    async def test_missing_earthdata_credentials_are_reported(self):
        settings = type("Settings", (), {"earthdata_username": "", "earthdata_password": ""})()
        with patch("backend.app.services.nasa_earthdata.get_settings", return_value=settings):
            with self.assertRaises(EarthdataCredentialsMissing):
                await fetch_point_observations(
                    13.0827,
                    80.2707,
                    date(2026, 3, 1),
                    date(2026, 3, 14),
                )


if __name__ == "__main__":
    unittest.main()
