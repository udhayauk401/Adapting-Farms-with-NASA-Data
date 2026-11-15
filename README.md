# AgriGuard AI

AgriGuard AI is a NASA Space Apps Challenge 2026 project exploring how NASA Earth observation data can support agricultural environmental monitoring and climate-resilient planning. The project is being built in staged increments; this first setup stage provides the web and API foundations.

## Project structure

The project is separated into a dedicated frontend app and a backend API:

```text
.
├── frontend/               # Vite + React application
│   ├── public/             # Frontend static assets
│   ├── src/               # React application
│   ├── index.html
│   ├── package.json
│   └── vite.config.js
├── backend/
│   ├── app/               # FastAPI application and future routers/services
│   ├── cache/             # Local API cache (ignored by Git)
│   └── requirements.txt
├── data/samples/          # Explicitly labeled sample datasets only
├── .env.example
├── .gitignore
├── README.md
└── .oxlintrc.json
```

## Requirements

- Node.js 20.19+ or 22.12+ and npm (required by the Vite 8 toolchain)
- Python 3.10+
- NASA API credentials only for sources that require them; see [NASA data access](#nasa-data-access).

## Local setup

### Frontend

From the repo root, change into the frontend app and install dependencies:

```sh
cd frontend
npm install
npm run dev
```

The Vite development server proxies `/api` requests to `http://127.0.0.1:8000`.

### Backend

Create and activate a virtual environment, then install the API requirements:

```sh
python -m venv .venv
# Windows PowerShell: .venv\Scripts\Activate.ps1
# macOS/Linux: source .venv/bin/activate
python -m pip install -r backend/requirements.txt
```

Copy `.env.example` to `.env` and fill in credentials only when needed. Start the API with:

```sh
uvicorn backend.app.main:app --reload --host 127.0.0.1 --port 8000
```

The API health endpoint is `http://127.0.0.1:8000/health`; interactive API documentation is at `/docs`.

The web application uses NASA POWER as its sole NASA data integration. Daily point observations for air temperature (`T2M`), wind speed (`WS2M`), corrected precipitation (`PRECTOTCORR`), solar radiation (`ALLSKY_SFC_SW_DWN`), and relative humidity (`RH2M`) are retrieved from `/api/nasa/power/daily`. The map offers OpenStreetMap and Esri World Imagery basemaps; neither is presented as NASA imagery. The assistant panel provides local, rule-based explanations of available observations and explicitly does not connect to a generative AI model.

## Environment variables

`VITE_API_BASE_URL` configures the browser-facing API base URL. NASA POWER does not require credentials. `.env` is ignored by Git.

| Variable | Purpose |
|---|---|
| `APP_ENV` | Backend environment name |
| `API_HOST`, `API_PORT` | Local API bind address |
| `CACHE_DIR`, `CACHE_TTL_SECONDS` | Local response-cache location and default lifetime |
| `CORS_ORIGINS` | Comma-separated browser origins permitted to call the backend; defaults include the deployed Vercel domains and local Vite origins |

## NASA data access

NASA POWER's public API does not require an API key or Earthdata Login. The Data Explorer displays the returned product, units, observation dates, and retrieval time; availability and latency depend on the selected parameter and period.

## Data integrity and limitations

- Never invent an observation. Show a real source response or explicitly labeled `SAMPLE DATA`.
- Label simulations `HYPOTHETICAL SCENARIO`; never present them as observations or verified forecasts.
- Show units, source, and observation timestamp/period for every displayed data value.
- Satellite observations alone do not establish yield, profit, soil nutrients, irrigation access, local crop variety, or agronomic certainty. The product must disclose assumptions and missing information.
- Dataset resolution, temporal coverage, latency, and update frequency vary by product and must be described accurately.

## NASA attribution

NASA POWER attribution and product metadata are displayed with observations. The web application does not request protected NASA products or substitute example observations for unavailable data.

## Current implementation stage

The frontend includes a responsive AgriGuard dashboard with a green labeled sidebar, agricultural-image header, selected-location/provenance panel, NASA-observation metric cards, environmental conditions, explicit unassessed-risk states, and a data-grounded observation summary. Hash-routed sidebar page views include `#dashboard`, `#global-map`, `#data-explorer`, `#climate-risk`, `#crop-rotation`, `#shock-replay`, `#decision-regret`, and `#about`; navigation supports browser back/forward. The global map supports address and coordinate selection. The NASA Data Explorer offers NASA POWER observations with charts, tables, date selection, and retry controls.

The Crop Rotation Intelligence view summarizes the seven selected-period NASA POWER variables and displays an evidence result for each crop in the app’s crop gallery. Crop-detail dialogs show the actual POWER observations, observation counts, and missing information needed for a suitability assessment. Crop photographs are illustrative and are not used as environmental evidence. “Use My Location” uses browser geolocation, updates the shared location, starts reverse-geocoding, navigates to Crop Rotation Intelligence, and automatically calls `GET /api/crops/analyze`. The endpoint retrieves selected-period NASA POWER daily observations and a 1991–2020 NASA POWER monthly baseline, and returns month-matched comparisons, monthly normals, precipitation percentiles, and source, unit, period, and observation-date metadata.

Crop suitability is reported as “Insufficient Evidence” unless validated crop-specific requirements and field conditions are available. No external crop requirements, crop rankings, assumed values, or suitability scores are used. NASA POWER observations describe environmental conditions only; missing values are shown as unavailable rather than estimated.
