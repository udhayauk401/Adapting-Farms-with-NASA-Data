const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '')

async function fetchJson(url, failureLabel, signal) {
  const response = await fetch(url, { signal })
  if (!response.ok) {
    let message = `${failureLabel} failed (${response.status}).`
    try {
      const body = await response.json()
      if (typeof body.detail === 'string') message = body.detail
    } catch {
      // Keep the HTTP status message when the server does not return JSON.
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

export async function fetchNasaPowerDaily({ latitude, longitude, start, end }, signal) {
  const params = locationDateParams({ latitude, longitude, start, end })
  return fetchJson(`${apiBaseUrl}/api/nasa/power/daily?${params}`, 'NASA POWER request', signal)
}

export async function fetchCropAnalysis({ latitude, longitude, start, end }, signal) {
  const params = locationDateParams({ latitude, longitude, start, end })
  return fetchJson(`${apiBaseUrl}/api/crops/analyze?${params}`, 'Crop analysis request', signal)
}
