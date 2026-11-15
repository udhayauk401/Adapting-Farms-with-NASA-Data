import unittest

from fastapi.testclient import TestClient

from backend.app.main import app


class CorsTests(unittest.TestCase):
    def test_preflight_allows_configured_vercel_origins(self):
        origins = (
            "https://agriguard-nasa.vercel.app",
            "https://agriguard-ai-sigma.vercel.app",
            "https://agriguard-nasa-git-main-udhayakumar-ns-projects.vercel.app",
        )

        with TestClient(app) as client:
            for origin in origins:
                response = client.options(
                    "/api/nasa/power/daily",
                    headers={
                        "Origin": origin,
                        "Access-Control-Request-Method": "GET",
                    },
                )

                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.headers["access-control-allow-origin"], origin)
                self.assertNotIn("access-control-allow-credentials", response.headers)


if __name__ == "__main__":
    unittest.main()
