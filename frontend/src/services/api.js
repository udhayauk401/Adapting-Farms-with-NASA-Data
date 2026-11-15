
const configuredApiBaseUrl = (import.meta.env.VITE_API_BASE_URL || '').trim()
const productionApiBaseUrl = 'https://adapting-farms-with-nasa-data.onrender.com'
const apiBaseUrl = (configuredApiBaseUrl || (import.meta.env.PROD ? productionApiBaseUrl : ''))
  .trim()
  .replace(/\/+$/, '')

async function fetchJson(url, failureLabel, signal) {
  const response = await fetch(url, { signal })

  if (!response.ok) {
    let message = `${failureLabel} failed (${response.status}).`

    try {
      const body = await response.json()
      if (typeof body.detail === 'string') {
        message = body.detail
      }
    } catch {
      // Keep the HTTP status message.
    }

    throw new Error(message)
  }

  return response.json()
}

function locationDateParams({ latitude, longitude, start, end }) {
  return new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    start,
    end,
  })
}

function getApiUrl(path) {
  if (!apiBaseUrl) {
    throw new Error(
      'API URL is missing. Configure VITE_API_BASE_URL in Vercel Production environment and redeploy.'
    )
  }

  return `${apiBaseUrl}${path}`
}

export async function fetchNasaPowerDaily(
  { latitude, longitude, start, end },
  signal
) {
  const params = locationDateParams({ latitude, longitude, start, end })

  return fetchJson(
    getApiUrl(`/api/nasa/power/daily?${params}`),
    'NASA POWER request',
    signal
  )
}

export async function fetchCropAnalysis(
  { latitude, longitude, start, end },
  signal
) {
  const params = locationDateParams({ latitude, longitude, start, end })

  return fetchJson(
    getApiUrl(`/api/crops/analyze?${params}`),
    'Crop analysis request',
    signal
  )
}
