import { useCallback, useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import {
  AlertTriangle,
  Activity,
  ArrowUpRight,
  CalendarDays,
  CheckCircle2,
  ChevronsUpDown,
  CircleAlert,
  CloudRain,
  CloudSun,
  Database,
  Droplets,
  Gauge,
  History,
  LayoutDashboard,
  Leaf,
  LocateFixed,
  LoaderCircle,
  MapPinned,
  Map as MapIcon,
  Menu,
  MessageCircle,
  Send,
  Search,
  Satellite,
  Scale,
  ShieldCheck,
  Sprout,
  Thermometer,
  UserRound,
  X,
  Wheat,
} from 'lucide-react'
import { LayersControl, MapContainer, Marker, Popup, TileLayer, useMap, useMapEvents } from 'react-leaflet'
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import 'leaflet/dist/leaflet.css'
import './App.css'
import {
  fetchCropAnalysis,
  fetchNasaPowerDaily,
} from './services/api.js'
import cropExamples from './cropExamples.js'

const mapMarkerIcon = L.divIcon({
  className: 'agri-map-marker',
  html: '<span></span>',
  iconSize: [24, 24],
  iconAnchor: [12, 12],
})

const sidebarNavigation = [
  { title: 'Dashboard', href: '#dashboard', icon: LayoutDashboard },
  { title: 'Global Map', href: '#global-map', icon: MapIcon },
  { title: 'NASA Data Explorer', href: '#data-explorer', icon: Database },
  { title: 'Climate Risk Analysis', href: '#climate-risk', icon: Activity },
  { title: 'Crop Rotation Intelligence', href: '#crop-rotation', icon: Wheat },
  { title: 'Climate Shock Replay', href: '#shock-replay', icon: History },
  { title: 'Decision Regret Engine', href: '#decision-regret', icon: Scale },
  { title: 'About', href: '#about', icon: UserRound },
]

const dataSources = [
  { name: 'NASA POWER', description: 'Meteorological and solar conditions for temperature, precipitation, and radiation.', badge: 'Global coverage' },
]

const locations = [
  {
    id: 'chennai',
    name: 'Chennai, India',
    coords: [13.0827, 80.2707],
    source: 'preset',
  },
  {
    id: 'nairobi',
    name: 'Nairobi, Kenya',
    coords: [-1.2864, 36.8172],
    source: 'preset',
  },
  {
    id: 'brazil',
    name: 'Cuiabá, Brazil',
    coords: [-15.5961, -56.0969],
    source: 'preset',
  },
  {
    id: 'india',
    name: 'Nagpur, India',
    coords: [21.1458, 79.0882],
    source: 'preset',
  },
]

const datasetOptions = [
  { name: 'NASA POWER', key: 'POWER', resolution: 'Source-native resolution varies by parameter', period: 'Daily UTC data available from 1981 to near real-time', update: 'Daily; latency varies', units: '°C, m/s, mm/day, MJ/m²/day, %', href: 'https://power.larc.nasa.gov/docs/services/api/temporal/daily/' },
]

const reverseGeocodeCache = new Map()

function toIsoDate(date) {
  return date.toISOString().slice(0, 10)
}

function defaultDateRange() {
  const end = new Date()
  end.setUTCDate(end.getUTCDate() - 3)
  const start = new Date(end)
  start.setUTCDate(start.getUTCDate() - 13)
  return { start: toIsoDate(start), end: toIsoDate(end) }
}

function getDailyValues(data, parameter) {
  return data?.observations?.[parameter]?.daily ?? []
}

function getLatestObservation(data, parameter) {
  const observations = getDailyValues(data, parameter)
  for (let index = observations.length - 1; index >= 0; index -= 1) {
    if (observations[index].value !== null) return observations[index]
  }
  return null
}

function getDatasetConnectionStatus(state) {
  if (state?.loading) return 'Loading'
  if (state?.error) {
    return /earthdata|credential|map_key|authentication|token/i.test(state.error)
      ? 'Authentication Required'
      : 'API Error'
  }
  if (!state?.data) return 'No Data Available'
  const observations = Object.values(state.data.observations ?? {})
  return observations.some((observation) => observation.daily?.some(
    (item) => typeof item.value === 'number' && Number.isFinite(item.value),
  ))
    ? 'Connected'
    : 'No Data Available'
}

function formatNominatimLocation(result) {
  const address = result.address ?? {}
  const city = address.city || address.town || address.village || address.municipality || address.hamlet
  const locality = address.neighbourhood || address.suburb || address.quarter || address.residential
  const district = address.city_district || address.district || address.county || address.state_district
  const street = [address.house_number, address.road].filter(Boolean).join(' ')
  const values = [
    street,
    address.neighbourhood,
    address.suburb,
    address.quarter,
    address.residential,
    city,
    address.city_district,
    address.district,
    address.county,
    address.state_district,
    address.state,
    address.country,
    address.postcode,
  ].filter(Boolean)
  const uniqueValues = values.filter((value, index) => values.findIndex((item) => item.toLowerCase() === value.toLowerCase()) === index)
  const nameParts = [city || locality || district, address.state, address.country].filter(Boolean)
  const uniqueNameParts = nameParts.filter((value, index) => nameParts.findIndex((item) => item.toLowerCase() === value.toLowerCase()) === index)

  return {
    name: uniqueNameParts.join(', ') || result.name || result.display_name || '',
    formattedAddress: uniqueValues.join(', ') || result.display_name || '',
    source: 'OpenStreetMap Nominatim',
  }
}

function locationKey(coords) {
  return `${coords[0].toFixed(5)},${coords[1].toFixed(5)}`
}

function formatCoordinate(value, axis) {
  const direction = axis === 'latitude'
    ? value < 0 ? 'S' : 'N'
    : value < 0 ? 'W' : 'E'
  return `${Math.abs(value).toFixed(4)}° ${direction}`
}

const climateRiskCards = [
  {
    key: 'rainfall',
    title: 'Rainfall Deficit Analysis',
    riskTitle: 'Rainfall Deficit Risk',
    icon: CloudRain,
    tone: 'rainfall',
    method: 'A validated long-term rainfall baseline is required to calculate a deficit.',
  },
  {
    key: 'temperature',
    title: 'Temperature Stress Analysis',
    riskTitle: 'Heat Stress Risk',
    icon: Thermometer,
    tone: 'temperature',
    method: 'Heat thresholds must be validated for a specific crop and growth stage.',
  },
  {
    key: 'soil',
    title: 'Soil Moisture Deficit Analysis',
    riskTitle: 'Soil Moisture Risk',
    icon: Droplets,
    tone: 'soil',
    method: 'NASA POWER does not include field soil-moisture measurements for this assessment.',
  },
  {
    key: 'vegetation',
    title: 'Vegetation Condition Analysis',
    riskTitle: 'Vegetation Risk',
    icon: Leaf,
    tone: 'vegetation',
    method: 'NASA POWER does not include vegetation-index measurements for this assessment.',
  },
]

const rotationSequences = [
  { name: 'Maize → Soybean → Sorghum' },
  { name: 'Wheat → Fallow → Millet' },
  { name: 'Rice → Cowpea → Maize' },
]

const hypotheticalScenarios = [
  { label: 'HYPOTHETICAL SCENARIO', title: 'Delayed monsoon onset', description: 'A dry-start rainfall pattern is simulated for a region with historically late seasonal rainfall. It is not an observed NASA event.' },
  { label: 'HYPOTHETICAL SCENARIO', title: 'Heatwave amplification', description: 'Air temperatures are increased by 3°C above the local baseline to test crop stress under a warmer anomaly case.' },
  { label: 'HYPOTHETICAL SCENARIO', title: 'Flash-flood rainfall burst', description: 'A short-duration extreme rain event is applied to compare runoff risk and connectivity losses across crop sequences.' },
]

function MapViewController({ location }) {
  const map = useMap()
  const latitude = location.coords[0]
  const longitude = location.coords[1]
  const zoom = location.zoom ?? 5

  useEffect(() => {
    const center = map.getCenter()
    if (Math.abs(center.lat - latitude) < 0.0000001 && Math.abs(center.lng - longitude) < 0.0000001) {
      if (map.getZoom() !== zoom) map.setZoom(zoom)
      return
    }
    map.flyTo([latitude, longitude], zoom, { duration: 0.8 })
  }, [latitude, longitude, zoom, map])

  useEffect(() => {
    const container = map.getContainer()
    const resizeObserver = new ResizeObserver(() => map.invalidateSize({ pan: false }))
    resizeObserver.observe(container)
    const resizeTimer = window.setTimeout(() => map.invalidateSize({ pan: false }), 100)

    return () => {
      resizeObserver.disconnect()
      window.clearTimeout(resizeTimer)
    }
  }, [map])

  return null
}

function MapClickSelector({ onSelect }) {
  useMapEvents({
    click(event) {
      const latitude = event.latlng.lat
      const longitude = event.latlng.lng
      onSelect({
        id: `point-${latitude.toFixed(5)}-${longitude.toFixed(5)}`,
        name: `Selected point (${latitude.toFixed(4)}, ${longitude.toFixed(4)})`,
        coords: [latitude, longitude],
        zoom: event.target.getZoom(),
        metrics: null,
      })
    },
  })

  return null
}

function LocationSummary({ location, geocodeState, onRetryGeocode }) {
  const key = locationKey(location.coords)
  const currentGeocodeState = geocodeState.key === key ? geocodeState : null

  return (
    <section className="map-location-summary" aria-label="Selected location summary">
      <div>
        <span>Location Summary</span>
        <strong>{location.name}</strong>
        {location.address?.formattedAddress && <small>{location.address.formattedAddress}</small>}
        <small>
          Latitude: {formatCoordinate(location.coords[0], 'latitude')} · Longitude: {formatCoordinate(location.coords[1], 'longitude')}
        </small>
        {currentGeocodeState?.status === 'loading' && <small role="status">Looking up address with OpenStreetMap Nominatim…</small>}
        {currentGeocodeState?.status === 'error' && (
          <small className="map-address-error" role="status">
            {currentGeocodeState.message}
            <button type="button" onClick={onRetryGeocode}>Retry address lookup</button>
          </small>
        )}
        {location.address?.source && <small>Address source: {location.address.source}</small>}
      </div>
      <MapPinned size={20} aria-hidden="true" />
    </section>
  )
}

function MapSelector({ selectedLocation, onSelect, geocodeState, onRetryGeocode }) {
  const [searchTerm, setSearchTerm] = useState('')
  const [searchMessage, setSearchMessage] = useState('')
  const [addressResults, setAddressResults] = useState([])
  const [isSearching, setIsSearching] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [tileStatus, setTileStatus] = useState('loading')
  const [tileRetry, setTileRetry] = useState(0)
  const tileFailed = useRef(false)
  const [latitude, setLatitude] = useState(String(selectedLocation.coords[0]))
  const [longitude, setLongitude] = useState(String(selectedLocation.coords[1]))
  const sampleResults = searchTerm.trim()
    ? locations.filter((location) => location.name.toLowerCase().includes(searchTerm.trim().toLowerCase()))
    : []

  useEffect(() => {
    setLatitude(String(selectedLocation.coords[0]))
    setLongitude(String(selectedLocation.coords[1]))
  }, [selectedLocation])

  useEffect(() => {
    const query = searchTerm.trim()
    if (query.length < 3 || query === selectedLocation.name) {
      setAddressResults([])
      setSearchError('')
      setIsSearching(false)
      return undefined
    }

    const controller = new AbortController()
    const timeoutId = window.setTimeout(async () => {
      setIsSearching(true)
      setSearchError('')
      try {
        const params = new URLSearchParams({
          q: query,
          format: 'jsonv2',
          limit: '5',
          addressdetails: '1',
        })
        const response = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
          signal: controller.signal,
          headers: { Accept: 'application/json' },
        })
        if (!response.ok) {
          throw new Error(`Address search failed (${response.status}). Please try again.`)
        }

        const results = await response.json()
        setAddressResults(results.map((result) => ({
          id: result.place_id,
          ...formatNominatimLocation(result),
          coords: [Number(result.lat), Number(result.lon)],
          zoom: 12,
          metrics: null,
        })))
      } catch (error) {
        if (error.name !== 'AbortError') {
          setAddressResults([])
          setSearchError(error.message || 'Address search is unavailable. Please try again.')
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsSearching(false)
        }
      }
    }, 1000)

    return () => {
      window.clearTimeout(timeoutId)
      controller.abort()
    }
  }, [searchTerm, selectedLocation.name])

  function selectLocation(location) {
    onSelect({ zoom: 10, ...location })
    setSearchTerm(location.name)
    setSearchMessage('')
    setAddressResults([])
  }

  function handleSearch(event) {
    event.preventDefault()
    if (sampleResults.length === 1) {
      selectLocation(sampleResults[0])
    } else if (sampleResults.length > 1) {
      setSearchMessage('Choose a matching sample location below.')
    } else if (addressResults.length === 1) {
      selectLocation(addressResults[0])
    } else if (addressResults.length > 1) {
      setSearchMessage('Choose a matching address below.')
    } else {
      setSearchMessage('Enter at least 3 characters and choose a suggested address or place.')
    }
  }

  function handleCoordinateSubmit(event) {
    event.preventDefault()
    const parsedLatitude = Number(latitude)
    const parsedLongitude = Number(longitude)
    if (
      !Number.isFinite(parsedLatitude) || parsedLatitude < -90 || parsedLatitude > 90
      || !Number.isFinite(parsedLongitude) || parsedLongitude < -180 || parsedLongitude > 180
    ) {
      setSearchMessage('Enter a latitude from −90 to 90 and a longitude from −180 to 180.')
      return
    }

    selectLocation({
      id: `point-${parsedLatitude}-${parsedLongitude}`,
      name: `Selected point (${parsedLatitude.toFixed(4)}, ${parsedLongitude.toFixed(4)})`,
      coords: [parsedLatitude, parsedLongitude],
      zoom: 10,
      metrics: null,
    })
  }

  return (
    <div className="map-panel panel" id="global-map">
      <div className="panel-header">
        <div>
          <p className="eyebrow"><MapPinned size={14} /> SELECT REGION</p>
          <h3>Global Agricultural Map</h3>
        </div>
      </div>
      <LocationSummary location={selectedLocation} geocodeState={geocodeState} onRetryGeocode={onRetryGeocode} />

      <form className="map-search" role="search" onSubmit={handleSearch}>
        <label className="visually-hidden" htmlFor="map-location-search">Search map locations</label>
        <div className="map-search-control">
          <Search size={17} aria-hidden="true" />
          <input
            id="map-location-search"
            type="search"
            placeholder="Search an address, city, or place"
            value={searchTerm}
            onChange={(event) => {
              setSearchTerm(event.target.value)
              setSearchMessage('')
            }}
            aria-describedby="map-search-help"
            autoComplete="off"
          />
          <button type="submit">Search</button>
        </div>
        <span id="map-search-help" className="map-search-help">Address suggestions use OpenStreetMap Nominatim. Your search text is sent to that service.</span>
        {(sampleResults.length > 0 || addressResults.length > 0) && (
          <ul className="map-search-results" aria-label="Matching locations">
            {sampleResults.map((location) => (
              <li key={location.id}>
                <button type="button" onClick={() => selectLocation(location)}>
                  <MapPinned size={14} aria-hidden="true" />
                  <span>{location.name}<small className="result-kind">SAMPLE LOCATION</small></span>
                </button>
              </li>
            ))}
            {addressResults.map((location) => (
              <li key={location.id}>
                <button type="button" onClick={() => selectLocation(location)}>
                  <MapPinned size={14} aria-hidden="true" />
                  <span>{location.name}<small className="result-kind">OPENSTREETMAP PLACE</small></span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {isSearching && <p className="map-search-message" role="status">Finding address suggestions…</p>}
        {searchError && <p className="map-search-message search-error" role="alert">{searchError}</p>}
        {searchMessage && <p className="map-search-message" role="status">{searchMessage}</p>}
      </form>

      <form className="coordinate-form" onSubmit={handleCoordinateSubmit}>
        <label>
          <span>Latitude</span>
          <input type="number" step="any" min="-90" max="90" value={latitude} onChange={(event) => setLatitude(event.target.value)} required />
        </label>
        <label>
          <span>Longitude</span>
          <input type="number" step="any" min="-180" max="180" value={longitude} onChange={(event) => setLongitude(event.target.value)} required />
        </label>
        <button type="submit">Use coordinates</button>
      </form>
      <p className="map-search-help">You can also click anywhere on the map to select a point.</p>
      <p className="selected-coordinates">
        Selected coordinates: <strong>{selectedLocation.coords[0].toFixed(4)}°, {selectedLocation.coords[1].toFixed(4)}°</strong>
      </p>

      <div className="map-frame">
        {tileStatus === 'loading' && (
          <div className="map-status map-loading" role="status">
            <LoaderCircle size={16} className="spin" /> Loading map tiles…
          </div>
        )}
        {tileStatus === 'error' && (
          <div className="map-status map-error" role="alert">
            Map tiles could not be loaded. Check your connection and try again.
            <button type="button" onClick={() => {
              tileFailed.current = false
              setTileStatus('loading')
              setTileRetry((attempt) => attempt + 1)
            }}>Retry map</button>
          </div>
        )}
        <MapContainer
          key={tileRetry}
          center={selectedLocation.coords}
          zoom={2}
          minZoom={2}
          maxZoom={18}
          scrollWheelZoom
          zoomControl
          className="leaflet-map"
          whenReady={() => setTileStatus((current) => current === 'error' ? 'error' : 'loaded')}
        >
        <MapViewController location={selectedLocation} />
        <MapClickSelector onSelect={selectLocation} />
        <LayersControl position="topright">
          <LayersControl.BaseLayer checked name="OpenStreetMap">
            <TileLayer
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              attribution="&copy; <a href=\"https://www.openstreetmap.org/copyright\">OpenStreetMap contributors</a>"
              eventHandlers={{
                loading: () => {
                  if (!tileFailed.current) {
                    setTileStatus((current) => current === 'loaded' ? 'loaded' : 'loading')
                  }
                },
                tileload: () => {
                  if (!tileFailed.current) setTileStatus('loaded')
                },
                tileerror: (event) => {
                  const errorText = event.error?.message?.toLowerCase() ?? ''
                  if (errorText.includes('abort')) return
                  tileFailed.current = true
                  setTileStatus('error')
                },
              }}
            />
          </LayersControl.BaseLayer>
          <LayersControl.BaseLayer name="Esri World Imagery">
            <TileLayer
              url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
              attribution="Tiles &copy; Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community"
              eventHandlers={{
            loading: () => {
              if (!tileFailed.current) {
                setTileStatus((current) => current === 'loaded' ? 'loaded' : 'loading')
              }
            },
            tileload: () => {
              if (!tileFailed.current) setTileStatus('loaded')
            },
            tileerror: (event) => {
              const errorText = event.error?.message?.toLowerCase() ?? ''
              if (errorText.includes('abort')) return
              tileFailed.current = true
              setTileStatus('error')
            },
              }}
            />
          </LayersControl.BaseLayer>
        </LayersControl>
        {locations.map((location) => (
          <Marker icon={mapMarkerIcon} title={location.name} key={location.id} position={location.coords} eventHandlers={{ click: () => selectLocation(location) }}>
            <Popup>
              <strong>{location.name}</strong>
            </Popup>
          </Marker>
        ))}
        {!locations.some((location) => (
          Math.abs(location.coords[0] - selectedLocation.coords[0]) < 0.0001
          && Math.abs(location.coords[1] - selectedLocation.coords[1]) < 0.0001
        )) && (
          <Marker icon={mapMarkerIcon} title={selectedLocation.name} position={selectedLocation.coords}>
            <Popup>{selectedLocation.name}</Popup>
          </Marker>
        )}
        </MapContainer>
      </div>
    </div>
  )
}

function DateRangeControls({ range, onChange, idPrefix }) {
  const [maxDate] = useState(() => toIsoDate(new Date()))
  return (
    <div className="date-range-controls">
      <label htmlFor={`${idPrefix}-start`}>Start date</label>
      <input
        id={`${idPrefix}-start`}
        type="date"
        min="1981-01-01"
        max={range.end || maxDate}
        value={range.start}
        onChange={(event) => onChange({ ...range, start: event.target.value })}
      />
      <label htmlFor={`${idPrefix}-end`}>End date</label>
      <input
        id={`${idPrefix}-end`}
        type="date"
        min={range.start || '1981-01-01'}
        max={maxDate}
        value={range.end}
        onChange={(event) => onChange({ ...range, end: event.target.value })}
      />
    </div>
  )
}

function PowerTrendChart({ powerData }) {
  const temperature = getDailyValues(powerData, 'T2M')
  const precipitation = getDailyValues(powerData, 'PRECTOTCORR')
  const rainfallByDate = new Map(precipitation.map((point) => [point.date, point.value]))
  const chartData = temperature
    .map((point) => ({ date: point.date, temperature: point.value, precipitation: rainfallByDate.get(point.date) ?? null }))
    .filter((point) => point.temperature !== null || point.precipitation !== null)

  if (!chartData.length) {
    return <p className="empty-chart">No NASA POWER observations are available for this location and period.</p>
  }

  return (
    <ResponsiveContainer width="100%" height={280}>
      <ComposedChart data={chartData} margin={{ top: 10, right: 12, left: 0, bottom: 8 }}>
        <CartesianGrid stroke="#dce7dc" strokeDasharray="3 3" />
        <XAxis dataKey="date" minTickGap={28} tick={{ fill: '#61766a', fontSize: 11 }} />
        <YAxis yAxisId="temperature" tick={{ fill: '#61766a', fontSize: 11 }} label={{ value: '°C', angle: -90, position: 'insideLeft', fill: '#61766a' }} />
        <YAxis yAxisId="precipitation" orientation="right" tick={{ fill: '#61766a', fontSize: 11 }} label={{ value: 'mm/day', angle: 90, position: 'insideRight', fill: '#61766a' }} />
        <Tooltip />
        <Legend />
        <Bar yAxisId="precipitation" dataKey="precipitation" name="Precipitation (mm/day)" fill="#72a9ca" />
        <Line yAxisId="temperature" dataKey="temperature" name="Air temperature (°C)" stroke="#b37c34" strokeWidth={2} dot={false} connectNulls={false} />
      </ComposedChart>
    </ResponsiveContainer>
  )
}

function PowerSparkline({ powerData, parameter, label }) {
  const points = getDailyValues(powerData, parameter).filter((point) => Number.isFinite(point.value))
  if (points.length < 2) return null

  const values = points.map((point) => point.value)
  const minimum = Math.min(...values)
  const maximum = Math.max(...values)
  const range = maximum - minimum || 1
  const path = values.map((value, index) => {
    const x = (index / (values.length - 1)) * 52
    const y = 18 - ((value - minimum) / range) * 15
    return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`
  }).join(' ')

  return (
    <svg className="metric-sparkline" viewBox="0 0 52 20" role="img" aria-label={`${label} NASA POWER observations trend`}>
      <path d={path} />
    </svg>
  )
}

function PowerObservationsTable({ powerData }) {
  const temperature = getDailyValues(powerData, 'T2M')
  const temperatureMaximum = new Map(getDailyValues(powerData, 'T2M_MAX').map((point) => [point.date, point.value]))
  const temperatureMinimum = new Map(getDailyValues(powerData, 'T2M_MIN').map((point) => [point.date, point.value]))
  const wind = new Map(getDailyValues(powerData, 'WS2M').map((point) => [point.date, point.value]))
  const precipitation = new Map(getDailyValues(powerData, 'PRECTOTCORR').map((point) => [point.date, point.value]))
  const solar = new Map(getDailyValues(powerData, 'ALLSKY_SFC_SW_DWN').map((point) => [point.date, point.value]))
  const humidity = new Map(getDailyValues(powerData, 'RH2M').map((point) => [point.date, point.value]))
  const display = (value) => value == null ? 'Unavailable' : value

  return (
    <div className="table-scroll">
      <table className="observation-table">
        <caption>NASA POWER observations in UTC. Fill values are displayed as unavailable.</caption>
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">Mean temperature (°C)</th>
            <th scope="col">Maximum temperature (°C)</th>
            <th scope="col">Minimum temperature (°C)</th>
            <th scope="col">Wind speed (m/s)</th>
            <th scope="col">Precipitation (mm/day)</th>
            <th scope="col">Solar radiation (MJ/m²/day)</th>
            <th scope="col">Relative humidity (%)</th>
          </tr>
        </thead>
        <tbody>
          {temperature.map((row) => (
            <tr key={row.date}>
              <th scope="row">{row.date}</th>
              <td>{display(row.value)}</td>
              <td>{display(temperatureMaximum.get(row.date))}</td>
              <td>{display(temperatureMinimum.get(row.date))}</td>
              <td>{display(wind.get(row.date))}</td>
              <td>{display(precipitation.get(row.date))}</td>
              <td>{display(solar.get(row.date))}</td>
              <td>{display(humidity.get(row.date))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function getAssistantReply(question, powerData, selectedLocation) {
  const prompt = question.toLowerCase()
  const temperature = getLatestObservation(powerData, 'T2M')
  const wind = getLatestObservation(powerData, 'WS2M')
  const precipitation = getLatestObservation(powerData, 'PRECTOTCORR')
  const locationName = selectedLocation.name

  if (/soil|moisture|ndvi|vegetation|nutrient|yield/.test(prompt)) {
    return `NASA POWER does not provide field soil-moisture, vegetation-index, soil-nutrient, or crop-yield measurements for ${locationName}, so I can't assess those conditions.`
  }

  if (/rain|precip|water/.test(prompt)) {
    if (!precipitation) return `There is no valid NASA POWER precipitation observation in the selected date range for ${locationName}. This is a data-availability note, not a rainfall forecast.`
    return `The latest valid NASA POWER precipitation observation for ${locationName} is ${precipitation.value} mm/day on ${precipitation.date}. This is a measured daily value; it does not by itself establish drought, flood, or crop-water stress.`
  }

  if (/wind/.test(prompt)) {
    if (!wind) return `There is no valid NASA POWER wind-speed observation in the selected date range for ${locationName}.`
    return `The latest valid NASA POWER wind-speed observation for ${locationName} is ${wind.value} m/s on ${wind.date}. This is a daily gridded observation, not a local sensor reading or forecast.`
  }

  if (/temp|heat|warm|cold/.test(prompt)) {
    if (!temperature) return `There is no valid NASA POWER air-temperature observation in the selected date range for ${locationName}. This is a data-availability note, not a temperature forecast.`
    return `The latest valid NASA POWER air-temperature observation for ${locationName} is ${temperature.value} °C on ${temperature.date}. It is a regional gridded observation and not a field-level crop stress diagnosis.`
  }

  if (/risk|climate|condition/.test(prompt)) {
    const observations = [
      temperature && `air temperature ${temperature.value} °C (${temperature.date})`,
      precipitation && `precipitation ${precipitation.value} mm/day (${precipitation.date})`,
    ].filter(Boolean)
    if (!observations.length) return `No valid temperature or precipitation observations are currently available for ${locationName}. I can't assess a local climate risk from the connected data.`
    return `For ${locationName}, the latest valid NASA POWER observations are ${observations.join(' and ')}. These are environmental measurements, not a crop-specific risk classification or forecast.`
  }

  if (/rotation|crop|plant|sow/.test(prompt)) {
    return 'Crop rotation depends on crop history, soil properties, local water access, pests, and market goals. This dashboard does not have those field-level inputs, so it cannot make a tailored rotation recommendation. NASA POWER weather observations alone are not sufficient.'
  }

  return 'I can explain the connected NASA POWER temperature and precipitation observations and clarify data limitations. I do not have a generative AI service connected, and I will not invent readings or crop outcomes.'
}

function AgriculturalAssistant({ powerData, selectedLocation }) {
  const [question, setQuestion] = useState('')
  const [messages, setMessages] = useState([])

  function submitQuestion(event) {
    event.preventDefault()
    const prompt = question.trim()
    if (!prompt) return
    const reply = getAssistantReply(prompt, powerData, selectedLocation)
    setMessages((current) => [...current, { question: prompt, reply }])
    setQuestion('')
  }

  return (
    <section className="assistant-card panel" aria-labelledby="assistant-heading">
      <div className="assistant-heading">
        <span className="assistant-icon"><MessageCircle size={18} /></span>
        <div>
          <p className="eyebrow">DATA EXPLAINER</p>
          <h3 id="assistant-heading">Agricultural Assistant</h3>
        </div>
      </div>
      <p className="assistant-disclosure">Local guided explanations only—not a connected AI model. Observations are attributed to NASA POWER; other guidance is general context.</p>
      <div className="assistant-messages" aria-live="polite">
        {messages.length === 0 ? (
          <p className="assistant-intro">Ask about this location’s retrieved temperature, rainfall, climate data, or data coverage.</p>
        ) : messages.map((message, index) => (
          <div className="assistant-exchange" key={`${index}-${message.question}`}>
            <p className="assistant-question">{message.question}</p>
            <p className="assistant-reply">{message.reply}</p>
          </div>
        ))}
      </div>
      <div className="assistant-prompts" aria-label="Suggested questions">
        {['Explain latest temperature', 'What rainfall is available?'].map((prompt) => (
          <button key={prompt} type="button" onClick={() => setQuestion(prompt)}>{prompt}</button>
        ))}
      </div>
      <form className="assistant-input" onSubmit={submitQuestion}>
        <label className="visually-hidden" htmlFor="assistant-question">Ask about NASA environmental data</label>
        <input id="assistant-question" value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Ask about this location…" />
        <button type="submit" aria-label="Send question" disabled={!question.trim()}><Send size={16} /></button>
      </form>
      <p className="assistant-footer-disclaimer">AI Assistant can make mistakes. Please double check</p>
    </section>
  )
}

function CropPhoto({ crop, className }) {
  const [imageUnavailable, setImageUnavailable] = useState(false)

  return (
    <div className={`crop-image-frame ${className}`}>
      {imageUnavailable ? (
        <div className="crop-image-fallback" role="img" aria-label={`${crop.name} photo unavailable`}>
          <Sprout size={24} aria-hidden="true" />
          <strong>{crop.name}</strong>
          <span>Photo unavailable</span>
        </div>
      ) : (
        <img
          src={crop.image}
          alt={crop.imageAlt}
          loading="lazy"
          onError={() => setImageUnavailable(true)}
        />
      )}
    </div>
  )
}

function CropDetailsDialog({ crop, powerFactors, dateRange, locationName, retrievedAt, onClose }) {
  const dialogRef = useRef(null)
  const observedFactorCount = powerFactors.filter((factor) => factor.observed).length

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog && !dialog.open) dialog.showModal()
  }, [])

  return (
    <dialog
      ref={dialogRef}
      className="crop-details-dialog"
      aria-labelledby="crop-details-title"
      onClose={onClose}
      onCancel={(event) => {
        event.preventDefault()
        event.currentTarget.close()
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          event.currentTarget.close()
        }
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) event.currentTarget.close()
      }}
    >
      <div className="crop-details-content">
        <button
          className="crop-dialog-close"
          type="button"
          aria-label="Close crop details"
          onClick={() => dialogRef.current?.close()}
        >
          <X size={19} aria-hidden="true" />
        </button>
        <CropPhoto crop={crop} className="crop-details-photo" />
        <div className="crop-details-heading">
          <div>
            <p className="eyebrow"><Sprout size={14} /> NASA POWER CROP EVIDENCE</p>
            <h2 id="crop-details-title">{crop.name}</h2>
          </div>
          <span className="crop-status-badge">Insufficient Evidence</span>
        </div>
        <p className="crop-details-disclaimer">
          NASA POWER provides environmental observations, not validated crop requirements. Suitability for {crop.name} cannot be determined from these observations alone.
        </p>
        <section className="crop-dialog-evidence" aria-labelledby="crop-dialog-evidence-title">
          <h3 id="crop-dialog-evidence-title">Observed environmental conditions</h3>
          <p>{locationName} · {dateRange.start} to {dateRange.end} · NASA POWER · Retrieved {retrievedAt || 'Unavailable'}</p>
          <dl className="crop-facts-grid">
            {powerFactors.map((factor) => (
              <div key={factor.parameter}>
                <dt>{factor.label}</dt>
                <dd>{factor.value}</dd>
                <small>{factor.detail}</small>
              </div>
            ))}
          </dl>
        </section>
        <section className="crop-dialog-evidence">
          <h3>Factors this evidence can assess</h3>
          <p>
            {observedFactorCount} of {powerFactors.length} NASA POWER factors have valid observations for this period. These describe weather and solar conditions at the selected grid location; they do not establish crop-specific tolerance or field conditions.
          </p>
        </section>
        <section className="crop-dialog-evidence">
          <h3>Additional information needed</h3>
          <ul>
            <li>Validated requirements for this crop and variety at each growth stage.</li>
            <li>Field soil properties, irrigation access, and planting or growth-stage dates.</li>
            <li>Season-long conditions and future weather; the selected observations are not a forecast.</li>
          </ul>
        </section>
        <p className="crop-analysis-result"><strong>Evidence-based result:</strong> Insufficient Evidence. No suitability score or crop recommendation is calculated.</p>
        <p className="crop-photo-credit">
          Photo: <a href={crop.imageSource} target="_blank" rel="noreferrer">{crop.imageCredit}</a>
          {' · '}
          <a href={crop.licenseUrl} target="_blank" rel="noreferrer">License</a>
          {' · Display cropped to fit'}
        </p>
      </div>
    </dialog>
  )
}

function CropExampleCard({ crop, powerFactors, dateRange, locationName, onSelect }) {
  const observedFactorCount = powerFactors.filter((factor) => factor.observed).length
  return (
    <button
      className="crop-example-card panel"
      type="button"
      onClick={() => onSelect(crop)}
      aria-label={`View ${crop.name} NASA POWER evidence. Result: Insufficient Evidence.`}
    >
      <CropPhoto crop={crop} className="crop-card-photo" />
      <span className="crop-card-content">
        <span className="crop-card-heading">
          <span>
            <strong className="crop-card-name">{crop.name}</strong>
            <span className="crop-status-badge">Insufficient Evidence</span>
          </span>
          <span className="crop-example-label">Crop assessment</span>
        </span>
        <span className="crop-description">
          NASA POWER observed {observedFactorCount} of {powerFactors.length} environmental factors for {locationName} ({dateRange.start} to {dateRange.end}). Crop-specific requirements are not provided by this dataset.
        </span>
        <span className="crop-suitability-grid">
          <span className="crop-suitability-item">
            <span>POWER factors observed</span>
            <strong>{observedFactorCount} / {powerFactors.length}</strong>
          </span>
          <span className="crop-suitability-item">
            <span>Suitability score</span>
            <strong>Not calculated</strong>
          </span>
        </span>
        <span className="crop-profile-preview">
          <span>Evidence result</span>
          <strong>Insufficient Evidence</strong>
          <small>Validated crop requirements and field conditions are needed.</small>
        </span>
        <span className="crop-card-action">View NASA POWER observations <ArrowUpRight size={14} aria-hidden="true" /></span>
      </span>
    </button>
  )
}

function formatClimateValue(value, unit = '') {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'Unavailable'
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value)}${unit ? ` ${unit}` : ''}`
}

function summarizePowerPeriod(data, parameter, startDate, endDate, operation = 'mean') {
  const values = getDailyValues(data, parameter)
    .filter((point) => point.date >= startDate && point.date <= endDate && Number.isFinite(point.value))
    .map((point) => point.value)
  if (!values.length) return { value: null, count: 0 }

  const value = operation === 'sum'
    ? values.reduce((total, item) => total + item, 0)
    : values.reduce((total, item) => total + item, 0) / values.length
  return { value, count: values.length }
}

function CropWeatherChart({ powerData, dateRange }) {
  const parameters = ['T2M', 'T2M_MAX', 'T2M_MIN']
  const chartByDate = new Map()
  parameters.forEach((parameter) => {
    getDailyValues(powerData, parameter)
      .filter((point) => point.date >= dateRange.start && point.date <= dateRange.end)
      .forEach((point) => {
        const row = chartByDate.get(point.date) || { date: point.date }
        row[parameter] = Number.isFinite(point.value) ? point.value : null
        chartByDate.set(point.date, row)
      })
  })
  const chartData = [...chartByDate.values()].sort((left, right) => left.date.localeCompare(right.date))

  if (!chartData.some((row) => parameters.some((parameter) => Number.isFinite(row[parameter])))) {
    return <p className="crop-rotation-unavailable">No NASA POWER temperature observations are available for this period.</p>
  }

  return (
    <div className="crop-weather-chart">
      <ResponsiveContainer width="100%" height={250}>
        <LineChart data={chartData} margin={{ top: 8, right: 12, bottom: 6, left: 0 }}>
          <CartesianGrid stroke="#e4ece4" strokeDasharray="3 3" />
          <XAxis dataKey="date" minTickGap={28} tick={{ fill: '#617267', fontSize: 10 }} />
          <YAxis tick={{ fill: '#617267', fontSize: 10 }} width={42} label={{ value: '°C', angle: -90, position: 'insideLeft', fill: '#617267' }} />
          <Tooltip formatter={(value) => [`${formatClimateValue(Number(value), '°C')}`, '']} />
          <Legend />
          <Line dataKey="T2M" name="Mean" stroke="#388b59" strokeWidth={2} dot={false} connectNulls={false} />
          <Line dataKey="T2M_MAX" name="Daily maximum" stroke="#d28545" strokeWidth={1.7} dot={false} connectNulls={false} />
          <Line dataKey="T2M_MIN" name="Daily minimum" stroke="#568eb3" strokeWidth={1.7} dot={false} connectNulls={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

function HistoricalClimateChart({ monthly }) {
  const chartData = monthly.map((month) => ({
    ...month,
    month_label: month.month_name.slice(0, 3),
  }))

  return (
    <div className="crop-history-chart">
      <ResponsiveContainer width="100%" height={260}>
        <ComposedChart data={chartData} margin={{ top: 10, right: 12, bottom: 4, left: 0 }}>
          <CartesianGrid stroke="#e4ece4" strokeDasharray="3 3" />
          <XAxis dataKey="month_label" tick={{ fill: '#617267', fontSize: 11 }} />
          <YAxis yAxisId="rainfall" tick={{ fill: '#617267', fontSize: 10 }} width={42} />
          <YAxis yAxisId="temperature" orientation="right" tick={{ fill: '#617267', fontSize: 10 }} width={42} />
          <Tooltip
            formatter={(value, name) => [
              `${formatClimateValue(Number(value), name === 'Mean temperature' ? '°C' : 'mm')}`,
              name,
            ]}
          />
          <Legend />
          <Bar
            yAxisId="rainfall"
            dataKey="precipitation_mean_mm_month"
            name="Average rainfall"
            fill="#6ba77d"
            radius={[4, 4, 0, 0]}
          />
          <Line
            yAxisId="temperature"
            dataKey="temperature_mean_c"
            name="Mean temperature"
            type="monotone"
            stroke="#d9834d"
            strokeWidth={2}
            dot={{ r: 2 }}
            connectNulls={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}

function CropAnalysisResults({ analysis }) {
  const current = analysis.current_period
  const history = analysis.historical_climatology
  const readiness = analysis.recommendation_readiness
  const recommendations = analysis.recommendations
  const environmentalEvidence = analysis.environmental_evidence ?? []
  const cropAssessments = analysis.crop_assessments ?? []

  return (
    <div className="crop-analysis-results">
      <section className="crop-recommendation-status" aria-labelledby="crop-recommendation-title">
        <div className="crop-results-heading">
          <div>
            <p className="eyebrow"><Sprout size={14} /> LOCATION-BASED CROP ASSESSMENT</p>
            <h4 id="crop-recommendation-title">Crop evidence for your location</h4>
          </div>
          <span className="crop-outlook-status unavailable">Insufficient Evidence</span>
        </div>
        <p>{recommendations.reason}</p>
        {recommendations.missing_inputs.length > 0 && (
          <ul className="crop-missing-evidence">
            {recommendations.missing_inputs.map((input) => <li key={input}>{input}</li>)}
          </ul>
        )}
      </section>

      <section className="crop-best-candidate" aria-labelledby="best-crop-title">
        <p className="eyebrow"><ShieldCheck size={14} /> DECISION SUPPORT</p>
        <h4 id="best-crop-title">Evidence result</h4>
        <p><strong>Insufficient Evidence.</strong> NASA POWER observations describe environmental conditions but do not provide validated crop-specific requirements or field conditions.</p>
        <p className="crop-method-note">
          No crop ranking, suitability score, or recommendation is produced. Required crop and field information has not been validated in this analysis.
        </p>
      </section>

      <section className="crop-evidence-panel" aria-labelledby="crop-evidence-title">
        <div className="crop-results-heading">
          <div>
            <p className="eyebrow"><Database size={14} /> ENVIRONMENTAL EVIDENCE</p>
            <h4 id="crop-evidence-title">Available observations and provenance</h4>
          </div>
          <span>Source-specific data status</span>
        </div>
        <div className="crop-table-scroll">
          <table>
            <thead>
            <tr><th>Variable</th><th>Units</th><th>Mean</th><th>Latest value</th><th>Observation date / period (UTC)</th><th>Source and availability</th></tr>
            </thead>
            <tbody>
              {environmentalEvidence.map((item) => (
                <tr key={item.parameter}>
                  <th scope="row">{item.name}</th>
                <td>{item.units ?? 'Unavailable'}</td>
                  <td>{formatClimateValue(item.mean_value, item.units)}</td>
                  <td>{formatClimateValue(item.latest_value, item.units)}</td>
                <td>{item.latest_observation_date
                  ? `${item.latest_observation_date} · ${item.observation_period.start}–${item.observation_period.end}`
                  : `Unavailable${item.observation_period ? ` · ${item.observation_period.start}–${item.observation_period.end}` : ''}`}</td>
                  <td>{item.source} · {item.status} · {item.observation_count} valid days</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="crop-current-summary">
        <div>
          <span>Mean temperature</span>
          <strong>{formatClimateValue(current.temperature_mean_c, '°C')}</strong>
          <small>NASA POWER · {current.temperature_observation_days} valid daily observations</small>
        </div>
        <div>
          <span>Mean daily maximum</span>
          <strong>{formatClimateValue(current.temperature_max_mean_c, '°C')}</strong>
          <small>NASA POWER · selected observation window</small>
        </div>
        <div>
          <span>Mean daily minimum</span>
          <strong>{formatClimateValue(current.temperature_min_mean_c, '°C')}</strong>
          <small>NASA POWER · selected observation window</small>
        </div>
        <div>
          <span>Precipitation total</span>
          <strong>{formatClimateValue(current.precipitation_total_mm, 'mm')}</strong>
          <small>NASA POWER · {current.precipitation_observation_days} valid daily observations</small>
        </div>
        <div>
          <span>Temperature difference vs normal</span>
          <strong>{formatClimateValue(current.temperature_anomaly_vs_monthly_normal_c, '°C')}</strong>
          <small>Matched monthly 1991–2020 baseline</small>
        </div>
        <div>
          <span>Rainfall difference vs normal</span>
          <strong>{formatClimateValue(current.precipitation_anomaly_percent_vs_monthly_normal, '%')}</strong>
          <small>For dates with valid precipitation data</small>
        </div>
      </div>

      <section className="crop-history-panel" aria-labelledby="crop-history-title">
        <div className="crop-results-heading">
          <div>
            <p className="eyebrow"><History size={14} /> HISTORICAL CLIMATE</p>
            <h4 id="crop-history-title">Monthly climate normals · {history.baseline_period.start_year}–{history.baseline_period.end_year}</h4>
          </div>
          <span>{history.source.source} · {history.source.product}</span>
        </div>
        <HistoricalClimateChart monthly={history.monthly} />
        <p className="crop-method-note">
          Bars show average monthly precipitation; the line shows mean air temperature. Rainfall variability is summarized from the same month across baseline years. These are historical climate summaries, not field measurements or forecasts.
        </p>
        <details className="crop-monthly-data">
          <summary>View monthly values and rainfall range</summary>
          <div className="crop-table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Month</th>
                  <th>Mean temp (°C)</th>
                  <th>Mean max (°C)</th>
                  <th>Mean min (°C)</th>
                  <th>Rain (mm/month)</th>
                  <th>Rain P10–P90 (mm)</th>
                  <th>Rain CV (%)</th>
                </tr>
              </thead>
              <tbody>
                {history.monthly.map((month) => (
                  <tr key={month.month}>
                    <th scope="row">{month.month_name}</th>
                    <td>{formatClimateValue(month.temperature_mean_c)}</td>
                    <td>{formatClimateValue(month.temperature_max_mean_c)}</td>
                    <td>{formatClimateValue(month.temperature_min_mean_c)}</td>
                    <td>{formatClimateValue(month.precipitation_mean_mm_month)}</td>
                    <td>{formatClimateValue(month.precipitation_p10_mm_month)}–{formatClimateValue(month.precipitation_p90_mm_month)}</td>
                    <td>{formatClimateValue(month.precipitation_cv_percent)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
        <p className="crop-provenance-note">
          Baseline method: {history.method} Retrieved {history.source.retrieved_at}. Time standard: {history.source.time_standard}. Grid point: {analysis.location.grid.latitude}°, {analysis.location.grid.longitude}°.
        </p>
      </section>

      <div className="crop-outlook-grid">
        {[
          ['Best crops for current season', readiness.current_season],
          ['Best crops for upcoming season', readiness.upcoming_season],
          ['Climate-resilient alternatives', readiness.climate_resilient_alternatives],
        ].map(([title, item]) => (
          <section className="crop-outlook-card" key={title}>
            <span className={`crop-outlook-status ${item.status}`}>{item.status === 'incomplete' ? 'Incomplete assessment' : 'Unavailable'}</span>
            <h4>{title}</h4>
            <p>{item.reason}</p>
          </section>
        ))}
      </div>

      <section className="crop-comparison-panel" aria-labelledby="crop-comparison-title">
        <div className="crop-results-heading">
          <div>
            <p className="eyebrow"><Scale size={14} /> CROP COMPARISON</p>
            <h4 id="crop-comparison-title">Evidence result for each crop</h4>
          </div>
          <span>No scores calculated</span>
        </div>
        <div className="crop-table-scroll">
          <table>
            <thead>
              <tr>
                <th>Crop</th>
                <th>Result</th>
                <th>NASA POWER factors observed</th>
                <th>Explanation and additional information needed</th>
              </tr>
            </thead>
            <tbody>
              {cropAssessments.map((crop) => (
                <tr key={crop.id}>
                  <th scope="row">{crop.name}</th>
                  <td>Insufficient Evidence</td>
                  <td>{(crop.observed_factors ?? []).join(', ') || 'No valid NASA POWER factors available'}</td>
                  <td>{crop.explanation} {(crop.missing_inputs ?? []).join(' ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="crop-provenance-note">{readiness.scoring.reason} This is not a probability of yield, crop success, or profit.</p>
      </section>

      <div className="crop-forecast-unavailable" role="note">
        <CloudSun size={18} aria-hidden="true" />
        <div>
          <strong>{analysis.future_forecast.label}</strong>
          <span>{analysis.future_forecast.reason}</span>
        </div>
      </div>

      <div className="crop-data-availability">
        <strong>Data availability</strong>
        {Object.entries(analysis.data_availability).map(([name, value]) => (
          <span key={name}><b>{name}:</b> {value}</span>
        ))}
      </div>
    </div>
  )
}

function DashboardPage({
  selectedLocation,
  powerData,
  powerLoading,
  powerError,
  locationStatus,
  locationRequesting,
  geocodeState,
  onUseLocation,
  onRetryPower,
  onRetryGeocode,
}) {
  const temperature = getLatestObservation(powerData, 'T2M')
  const precipitation = getLatestObservation(powerData, 'PRECTOTCORR')
  const windSpeed = getLatestObservation(powerData, 'WS2M')
  const humidity = getLatestObservation(powerData, 'RH2M')
  const retrievedAt = powerData?.retrieved_at
  const locationKeyForSelection = locationKey(selectedLocation.coords)
  const isGeocoding = geocodeState.key === locationKeyForSelection && geocodeState.status === 'loading'
  const hasGeocodeError = geocodeState.key === locationKeyForSelection && geocodeState.status === 'error'
  const metricCards = [
    {
      label: 'Temperature',
      value: temperature ? `${temperature.value} °C` : powerLoading ? 'Retrieving…' : 'Data unavailable',
      details: temperature
        ? `NASA POWER · Observed ${temperature.date} UTC${retrievedAt ? ` · Retrieved ${retrievedAt}` : ''}`
        : `NASA POWER · ${powerError || 'No valid observation in the selected period'}`,
      icon: Thermometer,
      tone: 'temperature',
      observation: temperature,
    },
    {
      label: 'Precipitation',
      value: precipitation
        ? `${precipitation.value} mm/day`
        : powerLoading ? 'Retrieving…' : 'Data unavailable',
      details: precipitation
        ? `NASA POWER · PRECTOTCORR · Observed ${precipitation.date} UTC · Retrieved ${retrievedAt}`
        : `NASA POWER · ${powerError || 'No valid precipitation observation in the selected period'}`,
      icon: CloudRain,
      tone: 'precipitation',
      observation: precipitation,
    },
    {
      label: 'Wind Speed',
      value: windSpeed ? `${windSpeed.value} m/s` : powerLoading ? 'Retrieving…' : 'Data unavailable',
      details: windSpeed
        ? `NASA POWER · WS2M · Observed ${windSpeed.date} UTC · Retrieved ${retrievedAt}`
        : `NASA POWER · ${powerError || 'No valid wind-speed observation in the selected period'}`,
      icon: CloudSun,
      tone: 'soil',
      observation: windSpeed,
    },
    {
      label: 'Relative Humidity',
      value: humidity ? `${humidity.value}%` : powerLoading ? 'Retrieving…' : 'Data unavailable',
      details: humidity
        ? `NASA POWER · RH2M · Observed ${humidity.date} UTC · Retrieved ${retrievedAt}`
        : `NASA POWER · ${powerError || 'No valid humidity observation in the selected period'}`,
      icon: Droplets,
      tone: 'vegetation',
      observation: humidity,
    },
  ]
  const conditionRows = [
    {
      label: 'Temperature',
      value: temperature ? `${temperature.value} °C` : 'Data unavailable',
      status: temperature ? 'Observed' : 'Unavailable',
      source: temperature ? `NASA POWER · T2M · Observed ${temperature.date} UTC` : 'NASA POWER · No valid observation',
      icon: Thermometer,
    },
    {
      label: 'Precipitation',
      value: precipitation ? `${precipitation.value} mm/day` : powerLoading ? 'Retrieving…' : 'Data unavailable',
      status: precipitation ? 'Observed' : powerError ? 'Unavailable' : 'Not available',
      source: precipitation
        ? `NASA POWER · PRECTOTCORR · Observed ${precipitation.date} UTC`
        : `NASA POWER · ${powerError || 'No valid precipitation observation'}`,
      icon: CloudRain,
    },
    {
      label: 'Wind Speed',
      value: windSpeed ? `${windSpeed.value} m/s` : powerLoading ? 'Retrieving…' : 'Data unavailable',
      status: windSpeed ? 'Observed' : powerError ? 'Unavailable' : 'Not available',
      source: windSpeed
        ? `NASA POWER · WS2M · Observed ${windSpeed.date} UTC`
        : `NASA POWER · ${powerError || 'No valid wind-speed observation'}`,
      icon: CloudSun,
    },
    {
      label: 'Relative Humidity',
      value: humidity ? `${humidity.value}%` : powerLoading ? 'Retrieving…' : 'Data unavailable',
      status: humidity ? 'Observed' : powerError ? 'Unavailable' : 'Not available',
      source: humidity
        ? `NASA POWER · RH2M · Observed ${humidity.date} UTC · Retrieved ${retrievedAt}`
        : `NASA POWER · ${powerError || 'No valid humidity observation'}`,
      icon: Sprout,
    },
  ]
  const riskRows = [
    { label: 'Drought Risk', source: 'Validated historical baseline not configured' },
    { label: 'Heat Stress', source: 'Crop-specific threshold required' },
    { label: 'Excess Rainfall', source: 'Validated threshold not configured' },
    { label: 'Overall Risk', source: 'Risk model not configured' },
  ]

  return (
    <div className="dashboard-page-content">
      <header className="dashboard-hero">
        <div className="dashboard-hero-copy">
          <p className="dashboard-hero-kicker"><Satellite size={14} /> NASA-POWERED AGRICULTURAL INTELLIGENCE</p>
          <h1>Agricultural Intelligence Dashboard</h1>
          <p>Earth observation data for agricultural monitoring and climate resilience.</p>
        </div>
        <div className="profile-pill">
          <span className="profile-avatar"><UserRound size={18} /></span>
          <span><strong>AgriGuard AI</strong><small>NASA Earth data workspace · Guest</small></span>
          <ChevronsUpDown size={15} aria-hidden="true" />
        </div>
      </header>

      <section className="location-summary-card" aria-label="Selected location and data provenance">
        <div className="location-summary-main">
          <div className="location-summary-icon"><MapPinned size={21} /></div>
          <div className="location-summary-copy">
            <span>{selectedLocation.source === 'browser-geolocation' ? 'Current Location' : 'Selected Location'}</span>
            <strong>{selectedLocation.name}</strong>
            {selectedLocation.address?.formattedAddress && <small>{selectedLocation.address.formattedAddress}</small>}
            <small>Latitude: {formatCoordinate(selectedLocation.coords[0], 'latitude')} · Longitude: {formatCoordinate(selectedLocation.coords[1], 'longitude')}</small>
          </div>
          <button type="button" className="use-location-button" onClick={onUseLocation} disabled={locationRequesting}>
            {locationRequesting ? <LoaderCircle size={14} className="spin" /> : <LocateFixed size={14} />}
            {locationRequesting ? 'Locating…' : 'Use My Location'}
          </button>
        </div>
        <div className="location-provenance">
          <div><Sprout size={19} /><span>Data Source</span><strong>NASA POWER</strong></div>
          <div><Activity size={18} /><span>Observation Date</span><strong>{temperature?.date ?? 'Unavailable'} (UTC)</strong></div>
          <div><History size={18} /><span>Update Frequency</span><strong>{powerData?.update_frequency ?? (powerLoading ? 'Retrieving…' : 'Daily product; latency varies')}</strong></div>
        </div>
        {retrievedAt && <small className="location-retrieval">Updated {retrievedAt} · Source: {powerData.source}</small>}
        {isGeocoding && <p className="location-status" role="status">Looking up the selected address…</p>}
        {locationStatus && <p className="location-status" role="status">{locationStatus}</p>}
        {hasGeocodeError && (
          <p className="location-status location-address-error" role="status">
            {geocodeState.message}
            <button type="button" onClick={onRetryGeocode}>Retry address lookup</button>
          </p>
        )}
        {powerError && (
          <div className="location-error" role="alert">
            <span>{powerError}</span>
            <button type="button" onClick={onRetryPower}>Retry NASA POWER request</button>
          </div>
        )}
      </section>

      <section className="environment-metric-grid" aria-label="Environmental measurements">
        {metricCards.map(({ label, value, details, icon: Icon, tone }) => (
          <article className={`environment-metric-card ${tone}`} key={label}>
            <span className="environment-metric-icon"><Icon size={20} aria-hidden="true" /></span>
            <div className="environment-metric-copy">
              <h2>{label}</h2>
              <strong>{value}</strong>
              <small>{details}</small>
            </div>
          </article>
        ))}
      </section>

      <div className="agriculture-overview-grid">
        <section className="overview-panel">
          <header className="overview-panel-header">
            <span className="overview-panel-icon conditions"><Leaf size={22} /></span>
            <div><h2>Agricultural Conditions</h2><p>NASA observations for {selectedLocation.name}</p></div>
          </header>
          <div className="condition-rows">
            {conditionRows.map(({ label, value, status, source, icon: Icon }) => (
              <div className="condition-row" key={label}>
                <span className="condition-row-icon"><Icon size={16} aria-hidden="true" /></span>
                <strong>{label}</strong>
                <span className="condition-value">{value}</span>
                <span className={`condition-status ${status === 'Observed' ? 'is-observed' : ''}`}>{status}</span>
                <small>{source}</small>
              </div>
            ))}
          </div>
        </section>

        <section className="overview-panel risk-panel">
          <header className="overview-panel-header">
            <span className="overview-panel-icon risk"><AlertTriangle size={22} /></span>
            <div><h2>Climate Risk Overview</h2><p>No risk categories are inferred without validated models and inputs.</p></div>
          </header>
          <div className="risk-rows">
            {riskRows.map(({ label, source }) => (
              <div className="risk-row" key={label}>
                <span className="risk-row-icon"><CircleAlert size={16} /></span>
                <strong>{label}</strong>
                <span className="risk-unavailable" title={source}>Not assessed</span>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="observation-insight">
        <div className="insight-intro">
          <span className="insight-icon"><CloudSun size={23} /></span>
          <strong>Observation Summary</strong>
        </div>
        <div className="insight-copy">
          <h2>{temperature ? `NASA POWER: ${temperature.value} °C` : 'NASA observation unavailable'}</h2>
          <p>{temperature
            ? `Daily air temperature at ${selectedLocation.name} on ${temperature.date} (UTC).${humidity ? ` Relative humidity: ${humidity.value}% on ${humidity.date} (UTC).` : ''} These measurements alone do not determine crop suitability or climate risk.`
            : `No valid NASA POWER temperature observation is available for ${selectedLocation.name} in the selected period.`}</p>
        </div>
        <a href="#data-explorer" className="insight-link">View Data Explorer <ArrowUpRight size={16} /></a>
      </section>
    </div>
  )
}

function ClimateRiskPage({
  selectedLocation,
  onSelectLocation,
  dateRange,
  onDateRangeChange,
  powerData,
  powerLoading,
  powerError,
}) {
  const [selectedMetricKey, setSelectedMetricKey] = useState('power-temperature')
  const isInPeriod = (point) => point.date >= dateRange.start && point.date <= dateRange.end
  const createSeries = (key, label, data, code, fallbackSource, fallbackUnits, color) => {
    const observation = data?.observations?.[code]
    const points = (observation?.daily ?? [])
      .filter((point) => isInPeriod(point) && Number.isFinite(point.value))
    if (!points.length) return null

    return {
      key,
      label,
      source: data.source || fallbackSource,
      product: observation.product || data.product || fallbackSource,
      units: observation.units || fallbackUnits,
      resolution: observation.resolution || data.resolution || 'Unavailable',
      retrievedAt: data.retrieved_at || 'Unavailable',
      color,
      points,
    }
  }
  const powerTemperature = createSeries(
    'power-temperature',
    'Maximum air temperature',
    powerData,
    'T2M_MAX',
    'NASA POWER',
    '°C',
    '#d66345',
  )
  const powerRainfall = createSeries(
    'power-rainfall',
    'Precipitation',
    powerData,
    'PRECTOTCORR',
    'NASA POWER',
    'mm/day',
    '#3198c6',
  )
  const seriesOptions = [
    powerTemperature,
    createSeries('power-mean-temperature', 'Mean air temperature', powerData, 'T2M', 'NASA POWER', '°C', '#b37735'),
    powerRainfall,
  ].filter(Boolean)
  const selectedSeries = seriesOptions.find((series) => series.key === selectedMetricKey) || seriesOptions[0]
  const latestObservation = (series) => series?.points[series.points.length - 1] || null
  const measurements = {
    rainfall: {
      series: powerRainfall,
      sourceFallback: 'NASA POWER precipitation',
      loading: powerLoading,
      error: powerError,
    },
    temperature: {
      series: powerTemperature,
      sourceFallback: 'NASA POWER maximum air temperature',
      loading: powerLoading,
      error: powerError,
    },
    soil: {
      series: null,
      sourceFallback: 'Soil-moisture data is not provided by NASA POWER.',
      loading: false,
      error: '',
    },
    vegetation: {
      series: null,
      sourceFallback: 'Vegetation-index data is not provided by NASA POWER.',
      loading: false,
      error: '',
    },
  }
  const anyLoading = powerLoading
  const formatValue = (value) => Number(value).toLocaleString(undefined, { maximumFractionDigits: 4 })
  const selectedLocationIsPreset = locations.some((location) => location.id === selectedLocation.id)

  return (
    <section className="route-page climate-risk-page">
      <header className="climate-risk-hero">
        <div className="climate-risk-hero-copy">
          <span className="climate-risk-eyebrow"><Activity size={14} /> NASA EARTH OBSERVATIONS</span>
          <h1>Climate Risk Analysis</h1>
          <p>Assess climate-related risks using available NASA observations.</p>
        </div>
        <label className="climate-location-picker">
          <MapPinned size={20} aria-hidden="true" />
          <span>
            <small>Location</small>
            <select
              aria-label="Select analysis location"
              value={selectedLocation.id}
              onChange={(event) => {
                const nextLocation = locations.find((location) => location.id === event.target.value)
                if (nextLocation) onSelectLocation(nextLocation)
              }}
            >
              {!selectedLocationIsPreset && <option value={selectedLocation.id}>{selectedLocation.name}</option>}
              {locations.map((location) => <option value={location.id} key={location.id}>{location.name}</option>)}
            </select>
          </span>
        </label>
      </header>

      <div className="climate-risk-controls">
        <div className="climate-location-coordinates">
          <span>SELECTED COORDINATES</span>
          <strong>{formatCoordinate(selectedLocation.coords[0], 'latitude')} · {formatCoordinate(selectedLocation.coords[1], 'longitude')}</strong>
        </div>
        <div className="climate-period-control">
          <span>OBSERVATION PERIOD</span>
          <DateRangeControls range={dateRange} onChange={onDateRangeChange} idPrefix="climate-risk-date" />
        </div>
      </div>

      <section className="climate-risk-summary-grid" aria-label="Climate risk summary">
        {climateRiskCards.map((indicator) => {
          const Icon = indicator.icon
          const measurement = measurements[indicator.key]
          const point = latestObservation(measurement.series)
          return (
            <article className={`climate-risk-summary-card climate-tone-${indicator.tone}`} key={indicator.key}>
              <span className="climate-summary-icon"><Icon size={20} aria-hidden="true" /></span>
              <div className="climate-summary-copy">
                <span>{indicator.riskTitle}</span>
                <strong>{point ? 'Risk not assessed' : measurement.loading ? 'Loading observations' : 'Data unavailable'}</strong>
                <small>
                  {point
                    ? `${formatValue(point.value)} ${measurement.series.units} · ${point.date} · ${measurement.series.source}`
                    : measurement.error || measurement.sourceFallback}
                </small>
              </div>
            </article>
          )
        })}
      </section>

      <div className="climate-risk-overview-grid">
        <section className="climate-risk-panel climate-overall-panel">
          <header className="climate-panel-heading">
            <span className="climate-panel-icon"><Gauge size={19} aria-hidden="true" /></span>
            <div><h2>Risk Overview</h2><p>Overall climate risk</p></div>
          </header>
          <div className="climate-risk-gauge" role="img" aria-label="Overall climate risk is not assessed; no validated score is configured">
            <svg viewBox="0 0 240 140" aria-hidden="true">
              <path d="M 28 120 A 92 92 0 0 1 212 120" />
            </svg>
            <div className="climate-risk-gauge-label">
              <span>Overall climate risk</span>
              <strong>Not assessed</strong>
            </div>
          </div>
          <p className="climate-risk-disclaimer"><CircleAlert size={16} aria-hidden="true" /> No validated scoring rules and baselines are configured. Measurements are shown without a risk classification.</p>
        </section>

        <section className="climate-risk-panel climate-trend-panel">
          <header className="climate-trend-heading">
            <div className="climate-panel-heading">
              <span className="climate-panel-icon"><Activity size={19} aria-hidden="true" /></span>
              <div><h2>Climate Trends</h2><p>Observed NASA measurements · selected period</p></div>
            </div>
            <label className="climate-trend-picker">
              <span>Variable</span>
              <select
                aria-label="Select climate observation for trend chart"
                value={selectedSeries?.key || ''}
                onChange={(event) => setSelectedMetricKey(event.target.value)}
                disabled={!seriesOptions.length}
              >
                {seriesOptions.map((series) => (
                  <option value={series.key} key={series.key}>{series.source} · {series.label} ({series.units})</option>
                ))}
              </select>
            </label>
          </header>
          {selectedSeries ? (
            <div className="climate-trend-chart">
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={selectedSeries.points} margin={{ top: 10, right: 12, left: 4, bottom: 8 }}>
                  <CartesianGrid stroke="#e4ece4" strokeDasharray="3 3" />
                  <XAxis dataKey="date" minTickGap={24} tick={{ fill: '#66766b', fontSize: 11 }} />
                  <YAxis
                    tick={{ fill: '#66766b', fontSize: 11 }}
                    label={{ value: selectedSeries.units, angle: -90, position: 'insideLeft', fill: '#66766b' }}
                  />
                  <Tooltip formatter={(value) => [`${value} ${selectedSeries.units}`, selectedSeries.label]} />
                  <Line dataKey="value" name={selectedSeries.label} stroke={selectedSeries.color} strokeWidth={2.5} dot={false} connectNulls={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="climate-trend-unavailable" role="status">
              <Activity size={24} aria-hidden="true" />
              <strong>{anyLoading ? 'Loading NASA observations…' : 'Data unavailable'}</strong>
              <span>No valid observations are available for the selected location and period.</span>
            </div>
          )}
          {selectedSeries && (
            <div className="climate-trend-provenance">
              <span>{selectedSeries.source} · {selectedSeries.product}</span>
              <span>{selectedSeries.units} · {dateRange.start} — {dateRange.end}</span>
              <span>Retrieved {selectedSeries.retrievedAt}</span>
            </div>
          )}
        </section>
      </div>

      <section className="climate-analysis-grid" aria-label="Climate analysis details">
        {climateRiskCards.map((indicator) => {
          const Icon = indicator.icon
          const measurement = measurements[indicator.key]
          const point = latestObservation(measurement.series)
          return (
            <article className={`climate-analysis-card climate-tone-${indicator.tone}`} key={indicator.key}>
              <div className="climate-analysis-image"><Icon size={25} aria-hidden="true" /></div>
              <div className="climate-analysis-content">
                <div className="climate-analysis-title">
                  <Icon size={19} aria-hidden="true" />
                  <h2>{indicator.title}</h2>
                </div>
                <span className="climate-risk-unscored">Risk not assessed</span>
                <p>{indicator.method}</p>
                <div className="climate-analysis-observation">
                  <span>{point ? measurement.series.source : measurement.sourceFallback}</span>
                  <strong>{point ? `${formatValue(point.value)} ${measurement.series.units}` : measurement.loading ? 'Loading observations…' : 'Data unavailable'}</strong>
                  <small>{point ? `Observed ${point.date} · ${dateRange.start} to ${dateRange.end}` : measurement.error || 'No valid observations in the selected period.'}</small>
                </div>
                <p className="climate-analysis-method"><CalendarDays size={15} aria-hidden="true" /> {indicator.method}</p>
              </div>
            </article>
          )
        })}
      </section>
    </section>
  )
}

function CropRotationPage({
  selectedLocation,
  onSelectLocation,
  dateRange,
  onDateRangeChange,
  powerData,
  powerLoading,
  powerError,
  analysisState,
  onRefresh,
  selectedCrop,
  onSelectCrop,
  onCloseCrop,
}) {
  const [latitude, longitude] = selectedLocation.coords
  const selectedLocationIsPreset = locations.some((location) => location.id === selectedLocation.id)
  const withinRange = (point) => point.date >= dateRange.start && point.date <= dateRange.end
  const analysisPeriod = analysisState.data?.current_period?.period
  const analysisMatchesSelection = analysisState.status === 'ready'
    && analysisState.key === locationKey(selectedLocation.coords)
    && analysisPeriod?.start === dateRange.start
    && analysisPeriod?.end === dateRange.end
  const analysis = analysisMatchesSelection ? analysisState.data : null
  const evidenceSources = [
    { key: 'POWER', label: 'NASA POWER', detail: 'Weather & climate', state: { data: powerData, loading: powerLoading, error: powerError }, parameter: 'T2M' },
  ]
  const statusForPeriod = (state, parameter) => {
    const status = getDatasetConnectionStatus(state)
    if (status !== 'Connected') return status
    return getDailyValues(state.data, parameter).some(
      (point) => withinRange(point) && Number.isFinite(point.value),
    ) ? 'Connected' : 'No Data Available'
  }
  const summaryMetrics = [
    { parameter: 'T2M', label: 'Mean Temperature', unit: '°C', icon: Thermometer, tone: 'temperature', operation: 'mean' },
    { parameter: 'T2M_MAX', label: 'Mean Maximum Temperature', unit: '°C', icon: Thermometer, tone: 'temperature', operation: 'mean' },
    { parameter: 'T2M_MIN', label: 'Mean Minimum Temperature', unit: '°C', icon: Thermometer, tone: 'temperature', operation: 'mean' },
    { parameter: 'PRECTOTCORR', label: 'Total Precipitation', unit: 'mm', icon: CloudRain, tone: 'rainfall', operation: 'sum' },
    { parameter: 'WS2M', label: 'Average Wind Speed', unit: 'm/s', icon: CloudSun, tone: 'temperature', operation: 'mean' },
    { parameter: 'ALLSKY_SFC_SW_DWN', label: 'Average Solar Radiation', unit: 'MJ/m²/day', icon: CloudSun, tone: 'history', operation: 'mean' },
    { parameter: 'RH2M', label: 'Average Relative Humidity', unit: '%', icon: Droplets, tone: 'soil', operation: 'mean' },
  ].map((metric) => {
    const summary = summarizePowerPeriod(powerData, metric.parameter, dateRange.start, dateRange.end, metric.operation)
    const sourceUnit = metric.unit
    return {
      ...metric,
      value: summary.value === null
        ? powerLoading ? 'Loading observations…' : 'Data unavailable'
        : formatClimateValue(summary.value, sourceUnit),
      observed: summary.value !== null,
      count: summary.count,
      detail: summary.value === null
        ? `NASA POWER · ${powerError || 'No valid observations in this period'}`
        : `NASA POWER · ${summary.count} valid daily observations`,
    }
  })
  const overallSourceState = {
    data: powerData,
    loading: powerLoading,
    error: powerError,
  }
  const overallSourceStatus = statusForPeriod(overallSourceState, 'T2M')

  return (
    <section className="route-page crop-rotation-page">
      <header className="crop-rotation-hero">
        <div className="crop-rotation-hero-copy">
          <span className="crop-rotation-eyebrow"><Wheat size={14} /> NASA EARTH OBSERVATIONS</span>
          <h1>Crop Rotation Intelligence</h1>
          <p>Explore climate evidence and crop references for your selected location.</p>
        </div>
        <div className="crop-rotation-data-identity">
          <span><Database size={15} /> NASA EARTH DATA</span>
          <strong>NASA POWER</strong>
        </div>
      </header>

      <div className="crop-rotation-controls">
        <label className="crop-rotation-location">
          <MapPinned size={18} aria-hidden="true" />
          <span>
            <small>Location</small>
            <select
              aria-label="Select crop analysis location"
              value={selectedLocation.id}
              onChange={(event) => {
                const nextLocation = locations.find((location) => location.id === event.target.value)
                if (nextLocation) onSelectLocation(nextLocation)
              }}
            >
              {!selectedLocationIsPreset && <option value={selectedLocation.id}>{selectedLocation.name}</option>}
              {locations.map((location) => <option value={location.id} key={location.id}>{location.name}</option>)}
            </select>
            <em>{formatCoordinate(latitude, 'latitude')} · {formatCoordinate(longitude, 'longitude')}</em>
          </span>
        </label>
        <div className="crop-rotation-period">
          <span>Observation period</span>
          <DateRangeControls range={dateRange} onChange={onDateRangeChange} idPrefix="crop-rotation-date" />
        </div>
        <button
          className="crop-rotation-refresh"
          type="button"
          onClick={onRefresh}
          disabled={analysisState.status === 'loading'}
        >
          {analysisState.status === 'loading' ? <LoaderCircle size={15} className="spin" /> : <History size={15} />}
          {analysisState.status === 'loading' ? 'Analyzing…' : 'Analyze Evidence'}
        </button>
      </div>

      <section className="crop-rotation-summary-grid" aria-label="Climate observation summary">
        {summaryMetrics.map((metric) => {
          const Icon = metric.icon
          return (
            <article className={`crop-rotation-summary-card crop-tone-${metric.tone}`} key={metric.label}>
              <span className="crop-rotation-summary-icon"><Icon size={20} aria-hidden="true" /></span>
              <div>
                <span>{metric.label}</span>
                <strong>{metric.value}</strong>
                <small>{metric.detail}</small>
              </div>
            </article>
          )
        })}
      </section>

      <div className="crop-rotation-main-grid">
        <section className="crop-rotation-panel crop-climate-panel">
          <header className="crop-rotation-section-heading">
            <div>
              <span><Activity size={17} /> CLIMATE OVERVIEW</span>
              <h2>Observed conditions <small>· selected period</small></h2>
            </div>
            <span className={`crop-source-status status-${overallSourceStatus.toLowerCase().replace(/\s+/g, '-')}`}>{overallSourceStatus}</span>
          </header>
          {powerLoading ? <p className="crop-rotation-state" role="status"><LoaderCircle size={15} className="spin" /> Retrieving NASA POWER observations…</p>
            : powerError ? <div className="crop-rotation-error" role="alert">{powerError}</div>
              : powerData ? <CropWeatherChart powerData={powerData} dateRange={dateRange} />
                : <div className="crop-rotation-unavailable">Data unavailable · NASA POWER observations have not been retrieved.</div>}
          <p className="crop-rotation-chart-note">NASA POWER daily mean, maximum, and minimum temperatures for the selected period. These observations are not a forecast or crop recommendation.</p>
        </section>

        <section className="crop-rotation-panel crop-plan-panel">
          <header className="crop-rotation-section-heading">
            <div>
              <span><Sprout size={17} /> CROP ANALYSIS</span>
              <h2>Environmental factors assessed</h2>
            </div>
            <span className="crop-plan-badge unavailable">NASA POWER only</span>
          </header>
          <div className="crop-plan-unavailable">
            <span className="crop-plan-icon"><CircleAlert size={20} aria-hidden="true" /></span>
            <div>
              <strong>Insufficient Evidence for crop suitability</strong>
              <p>NASA POWER observations can describe the selected location and period. Without validated crop-specific requirements, they cannot establish suitability or support a crop recommendation.</p>
            </div>
          </div>
          <div className="crop-power-factor-list" aria-label="NASA POWER environmental factors for the selected period">
            {summaryMetrics.map((factor) => (
              <div className="crop-power-factor-row" key={factor.parameter}>
                <span>{factor.label}</span>
                <strong>{factor.value}</strong>
                <small>{factor.detail}</small>
              </div>
            ))}
          </div>
          <p className="crop-rotation-chart-note">
            Selected location: {selectedLocation.name} · Observation period: {dateRange.start} to {dateRange.end} (UTC). Valid values are summarized from the NASA POWER response; unavailable values are not estimated.
          </p>
          <ul className="crop-plan-requirements">
            <li>Available: mean, maximum, and minimum temperature; precipitation; wind speed; solar radiation; and relative humidity, when returned by NASA POWER.</li>
            <li>Not supplied by these observations: crop- and variety-specific tolerances by growth stage, field soil conditions, and irrigation availability.</li>
            <li>Results describe observed weather only; no crop ranking or suitability score is calculated.</li>
          </ul>
        </section>
      </div>

      <div className="crop-rotation-secondary-grid">
        <section className="crop-rotation-panel crop-options-panel">
          <header className="crop-rotation-section-heading">
            <div>
              <span><Leaf size={17} /> CROP REFERENCES</span>
              <h2>Crop evidence results</h2>
            </div>
            <small>Actual NASA POWER observations · selected period</small>
          </header>
          <div className="crop-example-grid">
            {cropExamples.map((crop) => (
              <CropExampleCard
                key={crop.id}
                crop={crop}
                powerFactors={summaryMetrics}
                dateRange={dateRange}
                locationName={selectedLocation.name}
                onSelect={onSelectCrop}
              />
            ))}
          </div>
        </section>

        <section className="crop-rotation-panel crop-evidence-status-panel">
          <header className="crop-rotation-section-heading">
            <div>
              <span><Database size={17} /> DATA PROVENANCE</span>
              <h2>NASA Environmental Evidence</h2>
            </div>
            <a href="#data-explorer">Open Data Explorer <ArrowUpRight size={13} /></a>
          </header>
          <div className="crop-evidence-status-list">
            {evidenceSources.map((source) => {
              const status = statusForPeriod(source.state, source.parameter)
              const rows = getDailyValues(source.state.data, source.parameter)
                .filter((point) => withinRange(point) && Number.isFinite(point.value))
              const last = rows[rows.length - 1]
              const observation = source.state.data?.observations?.[source.parameter]
              const description = last
                ? `${formatClimateValue(last.value, observation?.units ? ` ${observation.units}` : '')} · ${last.date}`
                : source.state.loading
                  ? 'Loading observations…'
                  : source.state.error || 'No observation in this period'
              return (
                <div className="crop-evidence-status-row" key={source.key}>
                  <span className="crop-evidence-name">{source.label}<small>{source.detail}</small></span>
                  <span className={`crop-source-status status-${status.toLowerCase().replace(/\s+/g, '-')}`}>{status}</span>
                  <small className="crop-evidence-detail">{description}</small>
                </div>
              )
            })}
          </div>
          <p className="crop-evidence-period">
            Selected period: {dateRange.start} — {dateRange.end} · {powerData?.time_standard || 'UTC'}
            <br />NASA POWER source: {powerData?.source || 'Unavailable'} · Retrieved: {powerData?.retrieved_at || 'Unavailable'}
            {' · '}<a href="https://power.larc.nasa.gov/" target="_blank" rel="noreferrer">NASA POWER portal</a>
          </p>
        </section>
      </div>

      <div className="crop-rotation-secondary-grid crop-rotation-bottom-grid">
        <section className="crop-rotation-panel crop-comparison-panel">
          <header className="crop-rotation-section-heading">
            <div>
              <span><Scale size={17} /> EVIDENCE LIMITATIONS</span>
              <h2>Additional information needed</h2>
            </div>
            <span className="crop-plan-badge unavailable">Insufficient Evidence</span>
          </header>
          <p className="crop-rotation-chart-note">
            Each listed crop has the same observed NASA POWER conditions for this selected location and period. Suitability cannot be determined without validated crop-specific reference information.
          </p>
          <ul className="crop-plan-requirements">
            <li>Crop- and variety-specific temperature, precipitation, wind, radiation, and humidity ranges by growth stage.</li>
            <li>Field measurements such as soil type, moisture, pH, drainage, and nutrient status.</li>
            <li>Irrigation access, planting date, crop duration, and full-season conditions.</li>
          </ul>
        </section>

        <aside className="crop-rotation-panel crop-important-notes">
          <header className="crop-rotation-section-heading">
            <div><span><CircleAlert size={17} /> IMPORTANT NOTES</span><h2>Use evidence carefully</h2></div>
          </header>
          <ul>
            <li>NASA POWER observations describe past and near-real-time conditions; they are not seasonal forecasts.</li>
            <li>Crop photos are illustrative only and are not observations from the selected field.</li>
            <li>No external crop requirements or crop suitability thresholds are used in this analysis.</li>
            <li>Soil moisture and vegetation-index measurements are not supplied by NASA POWER and are not assessed.</li>
          </ul>
        </aside>
      </div>

      {analysisMatchesSelection && (
        <details className="crop-rotation-full-analysis">
          <summary>View historical climate baseline and full analysis evidence</summary>
          <CropAnalysisResults analysis={analysis} />
        </details>
      )}
      {selectedCrop && (
        <CropDetailsDialog
          crop={selectedCrop}
          powerFactors={summaryMetrics}
          dateRange={dateRange}
          locationName={selectedLocation.name}
          retrievedAt={powerData?.retrieved_at}
          onClose={onCloseCrop}
        />
      )}
    </section>
  )
}

function ClimateShockReplayPage({
  selectedLocation,
  onSelectLocation,
  dateRange,
  onDateRangeChange,
  powerData,
  powerLoading,
  powerError,
  onRunReplay,
}) {
  const [latitude, longitude] = selectedLocation.coords
  const selectedLocationIsPreset = locations.some((location) => location.id === selectedLocation.id)
  const isInPeriod = (point) => point.date >= dateRange.start && point.date <= dateRange.end
  const getPeriodRows = (data, parameter) => getDailyValues(data, parameter)
    .filter((point) => isInPeriod(point) && Number.isFinite(point.value))
  const maxTemperatureRows = getPeriodRows(powerData, 'T2M_MAX')
  const powerRainRows = getPeriodRows(powerData, 'PRECTOTCORR')
  const totalPowerRain = powerRainRows.length
    ? powerRainRows.reduce((total, point) => total + point.value, 0)
    : null
  const periodSources = [
    { key: 'POWER', label: 'NASA POWER', variable: 'Temperature, precipitation', state: { data: powerData, loading: powerLoading, error: powerError }, parameter: 'T2M_MAX', href: 'https://power.larc.nasa.gov/docs/services/api/temporal/daily/' },
  ]
  const statusForPeriod = (state, parameter) => {
    const status = getDatasetConnectionStatus(state)
    if (status !== 'Connected') return status
    return getPeriodRows(state.data, parameter).length ? 'Connected' : 'No Data Available'
  }
  const periodStart = new Date(`${dateRange.start}T00:00:00Z`)
  const periodEnd = new Date(`${dateRange.end}T00:00:00Z`)
  const monthBuckets = []
  if (Number.isFinite(periodStart.getTime()) && Number.isFinite(periodEnd.getTime()) && periodStart <= periodEnd) {
    const month = new Date(Date.UTC(periodStart.getUTCFullYear(), periodStart.getUTCMonth(), 1))
    while (month <= periodEnd) {
      const key = `${month.getUTCFullYear()}-${String(month.getUTCMonth() + 1).padStart(2, '0')}`
      const dayCount = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0)).getUTCDate()
      monthBuckets.push({
        key,
        label: month.toLocaleString('en', { month: 'short', timeZone: 'UTC' }),
        daysInRange: Math.min(
          dayCount,
          Math.max(0, Math.floor((periodEnd.getTime() - Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), 1)) / 86400000) + 1),
        ) - (month.getTime() < periodStart.getTime()
          ? Math.floor((periodStart.getTime() - month.getTime()) / 86400000)
          : 0),
      })
      month.setUTCMonth(month.getUTCMonth() + 1)
    }
  }
  const byMonth = new Map(monthBuckets.map((bucket) => [bucket.key, {
    ...bucket,
    temperatureValues: [],
    rainfallTotal: 0,
    rainfallDays: 0,
    temperatureDays: 0,
  }]))
  for (const point of maxTemperatureRows) {
    const bucket = byMonth.get(point.date.slice(0, 7))
    if (bucket) {
      bucket.temperatureValues.push(point.value)
      bucket.temperatureDays += 1
    }
  }
  for (const point of powerRainRows) {
    const bucket = byMonth.get(point.date.slice(0, 7))
    if (bucket) {
      bucket.rainfallTotal += point.value
      bucket.rainfallDays += 1
    }
  }
  const chartData = [...byMonth.values()].map((bucket) => ({
    ...bucket,
    temperature: bucket.temperatureValues.length
      ? bucket.temperatureValues.reduce((sum, value) => sum + value, 0) / bucket.temperatureValues.length
      : null,
    rainfall: bucket.rainfallDays ? bucket.rainfallTotal : null,
  }))
  const maxObservationDate = maxTemperatureRows[maxTemperatureRows.length - 1]?.date
  const retrievalTime = powerData?.retrieved_at
  const periodIsLoading = powerLoading
  const powerStatus = statusForPeriod({ data: powerData, loading: powerLoading, error: powerError }, 'T2M_MAX')

  return (
    <section className="route-page shock-replay-page">
      <header className="shock-replay-hero">
        <div>
          <span className="shock-replay-eyebrow"><History size={14} /> HISTORICAL CLIMATE ANALYSIS</span>
          <h1>Climate Shock Replay</h1>
          <p>Review observed climate conditions and assess historical events without inventing missing thresholds.</p>
        </div>
        <div className="shock-replay-identity">
          <span><Satellite size={16} /> NASA EARTH DATA</span>
          <strong>NASA POWER</strong>
        </div>
      </header>

      <div className="shock-replay-controls">
        <label className="shock-replay-location">
          <MapPinned size={18} aria-hidden="true" />
          <span>
            <small>Location</small>
            <select
              aria-label="Select replay location"
              value={selectedLocation.id}
              onChange={(event) => {
                const nextLocation = locations.find((location) => location.id === event.target.value)
                if (nextLocation) onSelectLocation(nextLocation)
              }}
            >
              {!selectedLocationIsPreset && <option value={selectedLocation.id}>{selectedLocation.name}</option>}
              {locations.map((location) => <option value={location.id} key={location.id}>{location.name}</option>)}
            </select>
            <em>{formatCoordinate(latitude, 'latitude')} · {formatCoordinate(longitude, 'longitude')}</em>
          </span>
        </label>
        <div className="shock-replay-period">
          <span>Event period</span>
          <DateRangeControls range={dateRange} onChange={onDateRangeChange} idPrefix="shock-replay-date" />
        </div>
        <button className="shock-replay-run" type="button" onClick={onRunReplay} disabled={periodIsLoading}>
          {periodIsLoading ? <LoaderCircle size={15} className="spin" /> : <Activity size={15} />}
          {periodIsLoading ? 'Loading observations…' : 'Run Replay'}
        </button>
      </div>

      <section className="shock-replay-metrics" aria-label="Historical observation summary">
        <article className="shock-metric-card shock-metric-heat">
          <span className="shock-metric-icon"><Thermometer size={21} /></span>
          <div><small>Heatwave days</small><strong>Not assessed</strong><em>No validated heatwave threshold is configured.</em></div>
        </article>
        <article className="shock-metric-card shock-metric-rain">
          <span className="shock-metric-icon"><CloudRain size={21} /></span>
          <div><small>Heavy rainfall days</small><strong>Not assessed</strong><em>No validated heavy-rain threshold is configured.</em></div>
        </article>
        <article className="shock-metric-card shock-metric-dry">
          <span className="shock-metric-icon"><Sprout size={21} /></span>
          <div><small>Dry spell events</small><strong>Not assessed</strong><em>No validated dry-spell rule is configured.</em></div>
        </article>
        <article className="shock-metric-card shock-metric-total">
          <span className="shock-metric-icon"><CloudRain size={21} /></span>
          <div>
            <small>Observed rainfall total</small>
            <strong>{totalPowerRain === null ? powerLoading ? 'Loading…' : 'Data unavailable' : formatClimateValue(totalPowerRain, 'mm')}</strong>
            <em>{totalPowerRain === null ? powerError || 'NASA POWER precipitation has no valid observations in this period.' : `NASA POWER · ${powerRainRows.length} valid daily observations`}</em>
          </div>
        </article>
      </section>

      <div className="shock-replay-analysis-grid">
        <section className="shock-replay-panel shock-replay-chart-panel">
          <header className="shock-replay-panel-heading">
            <div><span><Activity size={16} /> OBSERVED CONDITIONS</span><h2>Monthly climate replay</h2></div>
            <span className={`shock-replay-status shock-status-${powerStatus.toLowerCase().replace(/\s+/g, '-')}`}>{powerStatus}</span>
          </header>
          {powerLoading ? <div className="shock-replay-empty" role="status"><LoaderCircle size={16} className="spin" /> Loading NASA POWER observations…</div>
            : powerError ? <div className="shock-replay-error" role="alert">{powerError}</div>
              : chartData.some((item) => item.temperature !== null || item.rainfall !== null) ? (
                <div className="shock-replay-chart">
                  <ResponsiveContainer width="100%" height={265}>
                    <ComposedChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
                      <CartesianGrid stroke="#e5eee4" strokeDasharray="3 3" />
                      <XAxis dataKey="label" tick={{ fill: '#66766b', fontSize: 11 }} />
                      <YAxis yAxisId="temperature" tick={{ fill: '#b56c25', fontSize: 10 }} width={40} />
                      <YAxis yAxisId="rainfall" orientation="right" tick={{ fill: '#2b83ac', fontSize: 10 }} width={40} />
                      <Tooltip
                        formatter={(value, name) => [
                          `${formatClimateValue(Number(value), name === 'Mean daily maximum temperature' ? '°C' : 'mm')}`,
                          name,
                        ]}
                        labelFormatter={(label, payload) => payload?.[0]?.payload?.key || label}
                      />
                      <Legend />
                      <Line yAxisId="temperature" type="monotone" dataKey="temperature" name="Mean daily maximum temperature" stroke="#dc7c2d" strokeWidth={2.5} dot={{ r: 3 }} connectNulls={false} />
                      <Bar yAxisId="rainfall" dataKey="rainfall" name="NASA POWER precipitation total" fill="#35a7df" radius={[3, 3, 0, 0]} />
                    </ComposedChart>
                  </ResponsiveContainer>
                  <p>Temperature is the monthly mean of observed daily maxima (°C); rainfall is the sum of valid NASA POWER daily precipitation (mm). No event threshold is applied.</p>
                </div>
              ) : <div className="shock-replay-empty">No NASA POWER observations are available for this location and period.</div>}
        </section>

        <section className="shock-replay-panel shock-events-panel">
          <header className="shock-replay-panel-heading">
            <div><span><AlertTriangle size={16} /> EVENT CLASSIFICATION</span><h2>Detected climate shocks</h2></div>
            <span className="shock-replay-status shock-status-unavailable">Not assessed</span>
          </header>
          <div className="shock-event-list">
            {[
              ['Heatwave', 'Daily maximum temperature threshold not configured', Thermometer, 'heat'],
              ['Heavy rainfall', 'Daily precipitation threshold not configured', CloudRain, 'rain'],
              ['Dry spell', 'Consecutive dry-day rule not configured', Sprout, 'dry'],
            ].map(([name, reason, Icon, tone]) => (
              <article className={`shock-event-row shock-event-${tone}`} key={name}>
                <span><Icon size={17} /></span>
                <div><strong>{name}</strong><small>{reason}</small></div>
                <b>Not assessed</b>
              </article>
            ))}
          </div>
          <p className="shock-method-note">Event dates and durations are intentionally withheld until a documented method and thresholds are configured.</p>
        </section>
      </div>

      <div className="shock-replay-lower-grid">
        <section className="shock-replay-panel shock-timeline-panel">
          <header className="shock-replay-panel-heading">
            <div><span><CalendarDays size={16} /> OBSERVATION COVERAGE</span><h2>Replay timeline</h2></div>
            <small>{dateRange.start} — {dateRange.end}</small>
          </header>
          {chartData.length ? (
            <div className="shock-month-coverage">
              {chartData.map((month) => {
                const count = month.temperatureDays
                const fraction = month.daysInRange ? Math.min(1, count / month.daysInRange) : 0
                return (
                  <div className="shock-month-item" key={month.key} title={`${month.key}: ${count} valid temperature observations out of ${month.daysInRange} days`}>
                    <span className="shock-month-track"><i style={{ width: `${fraction * 100}%` }} /></span>
                    <strong>{month.label}</strong>
                    <small>{count}/{month.daysInRange} days</small>
                  </div>
                )
              })}
            </div>
          ) : <div className="shock-replay-empty">Observation coverage is unavailable until NASA POWER data is retrieved.</div>}
          <p className="shock-coverage-note">Coverage counts valid NASA POWER daily maximum-temperature observations; it does not represent event severity.</p>
        </section>

        <section className="shock-replay-panel shock-source-panel">
          <header className="shock-replay-panel-heading">
            <div><span><Database size={16} /> NASA DATA SOURCES</span><h2>Availability for this period</h2></div>
          </header>
          <div className="shock-source-table-wrap">
            <table className="shock-source-table">
              <thead><tr><th>Dataset</th><th>Variable</th><th>Status</th><th>Observation period</th></tr></thead>
              <tbody>
                {periodSources.map((source) => {
                  const status = statusForPeriod(source.state, source.parameter)
                  const rows = getPeriodRows(source.state.data, source.parameter)
                  const firstDate = rows[0]?.date
                  const lastDate = rows[rows.length - 1]?.date
                  return (
                    <tr key={source.key}>
                      <th scope="row"><a href={source.href} target="_blank" rel="noreferrer">{source.label}</a></th>
                      <td>{source.variable}</td>
                      <td><span className={`shock-replay-status shock-status-${status.toLowerCase().replace(/\s+/g, '-')}`}>{status}</span></td>
                      <td>{firstDate && lastDate ? `${firstDate} to ${lastDate}` : source.state.loading ? 'Loading…' : 'No observations'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="shock-retrieval-note">Latest POWER observation: {maxObservationDate || 'Unavailable'} · Retrieved: {retrievalTime || 'Not retrieved'} · Time standard: {powerData?.time_standard || 'UTC'}</p>
        </section>
      </div>

      <section className="shock-replay-insights">
        <h2><CheckCircle2 size={17} /> Evidence summary</h2>
        <ul>
          <li>{maxTemperatureRows.length
            ? `NASA POWER supplied ${maxTemperatureRows.length} valid daily maximum-temperature observations${maxObservationDate ? ` through ${maxObservationDate}` : ''}.`
            : `NASA POWER maximum-temperature observations are unavailable${powerError ? `: ${powerError}` : ' for the selected period'}.`}</li>
          <li>{powerRainRows.length
            ? `NASA POWER supplied ${powerRainRows.length} precipitation observations totaling ${formatClimateValue(totalPowerRain, 'mm')} for this period.`
            : 'No valid NASA POWER precipitation observations are available for the selected period.'}</li>
          <li>Heatwave, heavy-rainfall, and dry-spell events are not classified because their validated thresholds are not configured.</li>
          <li>Observed historical conditions are not a forecast and do not establish agricultural impact or crop loss.</li>
        </ul>
      </section>
    </section>
  )
}

function DataExplorerPage({
  selectedLocation,
  dateRange,
  onDateRangeChange,
  powerData,
  powerLoading,
  powerError,
  onRetry,
}) {
  const selectedDatasetInfo = datasetOptions[0]
  const selectedDatasetStatus = getDatasetConnectionStatus({
    data: powerData,
    loading: powerLoading,
    error: powerError,
  })
  const [latitude, longitude] = selectedLocation.coords
  const retrievedAt = powerData?.retrieved_at

  return (
    <section className="route-page data-explorer-page">
      <header className="route-page-heading explorer-hero">
        <div className="explorer-hero-copy">
          <span className="explorer-eyebrow"><Satellite size={14} /> NASA EARTH OBSERVATIONS</span>
          <h1>NASA Data Explorer</h1>
          <p>Explore retrieved Earth observations for the selected location.</p>
        </div>
        <div className="explorer-identity" aria-label="Available NASA data sources">
          <span>NASA DATA SOURCE</span>
          <strong>NASA POWER</strong>
        </div>
      </header>

      <div className="dataset-selector" role="group" aria-label="Select NASA dataset">
          {datasetOptions.map((dataset) => (
            <article key={dataset.key} className="explorer-dataset-card is-selected">
              <span className="explorer-dataset-icon"><CloudSun size={18} /></span>
              <span className="explorer-dataset-copy">
                <strong>{dataset.name}</strong>
                <small>Weather and climate observations</small>
              </span>
              <span className="explorer-status status-connected">Active</span>
            </article>
          ))}
      </div>

      <div className="explorer-controls-panel">
        <div className="explorer-location">
          <MapPinned size={20} aria-hidden="true" />
          <div>
            <span>SELECTED LOCATION</span>
            <strong>{selectedLocation.name}</strong>
            <small>{Math.abs(latitude).toFixed(4)}° {latitude >= 0 ? 'N' : 'S'}, {Math.abs(longitude).toFixed(4)}° {longitude >= 0 ? 'E' : 'W'}</small>
          </div>
        </div>
        <DateRangeControls range={dateRange} onChange={onDateRangeChange} idPrefix="explorer-date" />
        <button
          type="button"
          className="explorer-fetch-button"
          onClick={onRetry}
          disabled={powerLoading}
        >
          {powerLoading ? <LoaderCircle size={16} className="spin" /> : <Satellite size={16} />}
          {powerLoading ? 'Fetching…' : 'Fetch Data'}
        </button>
      </div>

      <article className="route-page-card explorer-observation-card">
        <div className="explorer-observation-heading">
          <div className="explorer-observation-title">
            <span className="explorer-observation-icon"><CloudSun size={18} /></span>
            <div>
              <span className="explorer-section-kicker">SELECTED DATASET</span>
              <h2>{selectedDatasetInfo.name}</h2>
            </div>
          </div>
          <span className={`explorer-status status-${selectedDatasetStatus.toLowerCase().replace(/\s+/g, '-')}`}>{selectedDatasetStatus}</span>
        </div>
        {powerLoading ? <p className="request-state" role="status"><LoaderCircle size={16} className="spin" /> Retrieving NASA POWER observations…</p>
          : powerError ? <div className="request-error" role="alert"><span>{powerError}</span><button type="button" onClick={onRetry}>Retry NASA POWER request</button></div>
            : powerData ? <><PowerTrendChart powerData={powerData} /><PowerObservationsTable powerData={powerData} /></>
              : <p className="empty-chart">No NASA POWER observations are available for this location and period.</p>}

        <div className="explorer-source-details">
          <div>
            <span className="explorer-section-kicker">DATA SOURCE</span>
            <strong>{powerData?.product || selectedDatasetInfo.name}</strong>
          </div>
          <div><span className="explorer-section-kicker">SPATIAL RESOLUTION</span><strong>{selectedDatasetInfo.resolution}</strong></div>
          <div><span className="explorer-section-kicker">OBSERVATION PERIOD</span><strong>{dateRange.start} — {dateRange.end}</strong></div>
          <div><span className="explorer-section-kicker">RETRIEVED</span><strong>{retrievedAt || 'Not retrieved'}</strong></div>
          <a href={selectedDatasetInfo.href} target="_blank" rel="noreferrer">Open NASA source <ArrowUpRight size={14} /></a>
        </div>
      </article>
    </section>
  )
}

function App() {
  const [selectedLocation, setSelectedLocation] = useState(locations[0])
  const [dateRange, setDateRange] = useState(defaultDateRange)
  const [powerData, setPowerData] = useState(null)
  const [powerLoading, setPowerLoading] = useState(false)
  const [powerError, setPowerError] = useState('')
  const [retryCount, setRetryCount] = useState(0)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [activeSection, setActiveSection] = useState(() => window.location.hash.slice(1) || 'dashboard')
  const [locationStatus, setLocationStatus] = useState('')
  const [locationRequesting, setLocationRequesting] = useState(false)
  const [geocodeState, setGeocodeState] = useState({ key: '', status: 'idle', message: '' })
  const [geocodeRetry, setGeocodeRetry] = useState(0)
  const [selectedCrop, setSelectedCrop] = useState(null)
  const [cropAnalysisState, setCropAnalysisState] = useState({ key: '', status: 'idle', data: null, error: '' })
  const cropAnalysisController = useRef(null)
  const cropAnalysisRequestId = useRef(0)
  const selectedLatitude = selectedLocation.coords[0]
  const selectedLongitude = selectedLocation.coords[1]
  const selectedLocationKey = locationKey(selectedLocation.coords)
  const currentCropAnalysisState = cropAnalysisState.key === selectedLocationKey
    ? cropAnalysisState
    : { key: selectedLocationKey, status: 'idle', data: null, error: '' }
  const dashboardRecommendations = currentCropAnalysisState.data?.recommendations
  const dashboardBestCrop = dashboardRecommendations?.best_crop ?? null
  const dashboardTopCrops = dashboardRecommendations?.items ?? []

  const analyzeCropsForLocation = useCallback(async (location, observationRange, navigateToCropPage = true) => {
    cropAnalysisController.current?.abort()
    const controller = new AbortController()
    const requestId = cropAnalysisRequestId.current + 1
    cropAnalysisRequestId.current = requestId
    cropAnalysisController.current = controller
    const requestLocationKey = locationKey(location.coords)
    setCropAnalysisState({ key: requestLocationKey, status: 'loading', data: null, error: '' })
    if (navigateToCropPage) window.location.hash = '#crop-rotation'

    try {
      const data = await fetchCropAnalysis({
        latitude: location.coords[0],
        longitude: location.coords[1],
        start: observationRange.start,
        end: observationRange.end,
      }, controller.signal)
      if (requestId === cropAnalysisRequestId.current) {
        setCropAnalysisState({ key: requestLocationKey, status: 'ready', data, error: '' })
      }
    } catch (error) {
      if (error.name !== 'AbortError' && requestId === cropAnalysisRequestId.current) {
        setCropAnalysisState({
          key: requestLocationKey,
          status: 'error',
          data: null,
          error: error.message || 'Crop analysis could not be completed.',
        })
      }
    } finally {
      if (requestId === cropAnalysisRequestId.current) {
        cropAnalysisController.current = null
        setCropAnalysisState((current) => current.status === 'loading'
          ? { ...current, status: 'idle' }
          : current)
      }
    }
  }, [])

  useEffect(() => {
    const updateActiveSection = () => {
      const nextSection = window.location.hash.slice(1) || 'dashboard'
      setActiveSection(nextSection)
      window.requestAnimationFrame(() => window.scrollTo(0, 0))
    }
    window.addEventListener('hashchange', updateActiveSection)
    return () => window.removeEventListener('hashchange', updateActiveSection)
  }, [])

  useEffect(() => {
    const key = locationKey(selectedLocation.coords)
    if (selectedLocation.address?.formattedAddress) {
      return undefined
    }

    const controller = new AbortController()
    const timeoutId = window.setTimeout(async () => {
      setGeocodeState({ key, status: 'loading', message: '' })
      try {
        const cachedAddress = reverseGeocodeCache.get(key)
        if (cachedAddress) {
          setSelectedLocation((current) => locationKey(current.coords) === key
            ? { ...current, name: cachedAddress.name || current.name, address: cachedAddress }
            : current)
          setGeocodeState({ key, status: 'ready', message: '' })
          return
        }

        const params = new URLSearchParams({
          format: 'jsonv2',
          lat: String(selectedLocation.coords[0]),
          lon: String(selectedLocation.coords[1]),
          zoom: '18',
          addressdetails: '1',
        })
        const response = await fetch(`https://nominatim.openstreetmap.org/reverse?${params}`, {
          signal: controller.signal,
          headers: { Accept: 'application/json' },
        })
        if (!response.ok) {
          throw new Error(`Address lookup failed (${response.status}).`)
        }

        const result = await response.json()
        const address = formatNominatimLocation(result)
        if (!address.formattedAddress) {
          throw new Error('No readable address was returned for these coordinates.')
        }
        reverseGeocodeCache.set(key, address)
        setSelectedLocation((current) => locationKey(current.coords) === key
          ? { ...current, name: address.name || current.name, address }
          : current)
        setGeocodeState({ key, status: 'ready', message: '' })
        setLocationStatus((current) => current.startsWith('Location detected')
          ? 'Location detected. NASA POWER observations are being retrieved.'
          : current)
      } catch (error) {
        if (error.name !== 'AbortError') {
          setGeocodeState({
            key,
            status: 'error',
            message: 'Address lookup failed. The selected coordinates remain available; try again or search for a place.',
          })
        }
      }
    }, 1100)

    return () => {
      window.clearTimeout(timeoutId)
      controller.abort()
    }
  }, [selectedLocation, geocodeRetry])

  useEffect(() => {
    if (!dateRange.start || !dateRange.end) {
      setPowerData(null)
      setPowerError('Select both a start and end date.')
      setPowerLoading(false)
      return undefined
    }

    const controller = new AbortController()
    setPowerLoading(true)
    setPowerError('')
    setPowerData(null)
    fetchNasaPowerDaily({
      latitude: selectedLatitude,
      longitude: selectedLongitude,
      start: dateRange.start,
      end: dateRange.end,
    }, controller.signal)
      .then((data) => {
        setPowerData(data)
        setLocationStatus('')
      })
      .catch((error) => {
        if (error.name !== 'AbortError') {
          setPowerError(error.message || 'NASA POWER data could not be retrieved.')
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setPowerLoading(false)
      })

    return () => controller.abort()
  }, [selectedLatitude, selectedLongitude, dateRange, retryCount])

  function useMyLocation() {
    if (!navigator.geolocation) {
      setLocationStatus('This browser does not support location access. Search for a place or select a point on the map.')
      return
    }

    setLocationStatus('Waiting for location permission…')
    setLocationRequesting(true)
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const latitude = coords.latitude
        const longitude = coords.longitude
        const detectedLocationKey = locationKey([latitude, longitude])
        const detectedLocation = {
          id: `device-${detectedLocationKey}`,
          name: 'Current location',
          coords: [latitude, longitude],
          zoom: 15,
          source: 'browser-geolocation',
          address: null,
          metrics: null,
        }
        setSelectedLocation(detectedLocation)
        setGeocodeState({ key: detectedLocationKey, status: 'loading', message: '' })
        setLocationStatus('Location detected. Looking up its address and retrieving NASA POWER observations…')
        setLocationRequesting(false)
        window.location.hash = '#global-map'
      },
      (error) => {
        const message = error.code === error.PERMISSION_DENIED
          ? 'Please allow location access to detect your current location. You can also search for a place or select a map point.'
          : error.code === error.POSITION_UNAVAILABLE
            ? 'Your location is unavailable. Search for a place or select a map point instead.'
            : 'Location request timed out. Try again or select a map point.'
        setLocationStatus(message)
        setLocationRequesting(false)
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
    )
  }

  const activePage = sidebarNavigation.some((item) => item.href === `#${activeSection}`)
    ? activeSection
    : 'dashboard'

  if (activePage !== 'legacy-dashboard') {
    return (
      <div className="site-shell screenshot-dashboard-shell">
        <div className="app-frame screenshot-dashboard-frame">
          <aside className="site-header screenshot-sidebar" aria-label="AgriGuard navigation">
            <a className="screenshot-sidebar-logo" href="#dashboard" aria-label="AgriGuard AI dashboard">
              <Leaf size={21} strokeWidth={2.2} aria-hidden="true" />
            </a>
            <nav className="screenshot-sidebar-nav" aria-label="Dashboard navigation">
              {sidebarNavigation.map(({ title, href, icon: Icon }, index) => (
                <a
                  key={title}
                  className={`screenshot-sidebar-link ${activePage === href.slice(1) ? 'is-active' : ''} ${index === 4 || index === 7 ? 'has-divider' : ''}`}
                  href={href}
                  title={title}
                  aria-label={title}
                  aria-current={activePage === href.slice(1) ? 'page' : undefined}
                >
                  <Icon size={18} aria-hidden="true" />
                  <span>{title}</span>
                </a>
              ))}
            </nav>
          </aside>

          <main className="site-main screenshot-dashboard-main" id="main-content">
            {activePage === 'dashboard' && (
              <DashboardPage
                selectedLocation={selectedLocation}
                powerData={powerData}
                powerLoading={powerLoading}
                powerError={powerError}
                locationStatus={locationStatus}
                locationRequesting={locationRequesting}
                geocodeState={geocodeState}
                onUseLocation={useMyLocation}
                onRetryPower={() => setRetryCount((count) => count + 1)}
                onRetryGeocode={() => setGeocodeRetry((count) => count + 1)}
              />
            )}

            {activePage === 'global-map' && (
              <section className="route-page global-map-view">
                <header className="route-page-heading">
                  <h1>Global Agricultural Map</h1>
                  <p>Search for a place, enter coordinates, or select a point on the map.</p>
                </header>
                <MapSelector
                  selectedLocation={selectedLocation}
                  onSelect={setSelectedLocation}
                  geocodeState={geocodeState}
                  onRetryGeocode={() => setGeocodeRetry((count) => count + 1)}
                />
              </section>
            )}

            {activePage === 'data-explorer' && (
              <DataExplorerPage
                selectedLocation={selectedLocation}
                dateRange={dateRange}
                onDateRangeChange={setDateRange}
                powerData={powerData}
                powerLoading={powerLoading}
                powerError={powerError}
                onRetry={() => setRetryCount((count) => count + 1)}
              />
            )}

            {activePage === 'climate-risk' && (
              <ClimateRiskPage
                selectedLocation={selectedLocation}
                onSelectLocation={setSelectedLocation}
                dateRange={dateRange}
                onDateRangeChange={setDateRange}
                powerData={powerData}
                powerLoading={powerLoading}
                powerError={powerError}
              />
            )}

            {activePage === 'crop-rotation' && (
              <CropRotationPage
                selectedLocation={selectedLocation}
                onSelectLocation={setSelectedLocation}
                dateRange={dateRange}
                onDateRangeChange={setDateRange}
                powerData={powerData}
                powerLoading={powerLoading}
                powerError={powerError}
                analysisState={currentCropAnalysisState}
                onRefresh={() => void analyzeCropsForLocation(selectedLocation, dateRange, false)}
                selectedCrop={selectedCrop}
                onSelectCrop={setSelectedCrop}
                onCloseCrop={() => setSelectedCrop(null)}
              />
            )}

            {activePage === 'shock-replay' && (
              <ClimateShockReplayPage
                selectedLocation={selectedLocation}
                onSelectLocation={setSelectedLocation}
                dateRange={dateRange}
                onDateRangeChange={setDateRange}
                powerData={powerData}
                powerLoading={powerLoading}
                powerError={powerError}
                onRunReplay={() => {
                  setRetryCount((count) => count + 1)
                }}
              />
            )}

            {activePage === 'decision-regret' && (
              <section className="route-page">
                <header className="route-page-heading"><h1>Decision Regret Engine</h1><p>Plan comparison requires validated scenario scores that are not configured.</p></header>
                <div className="route-page-card"><strong>Decision scores unavailable</strong><p>No yield, income, profit, or regret scores are generated without evidence-based scores for each plan and scenario.</p><p className="method-note">Regret = best documented score under a scenario − documented score of the selected plan.</p></div>
              </section>
            )}

            {activePage === 'about' && (
              <section className="route-page">
                <header className="route-page-heading"><h1>About AgriGuard AI</h1><p>NASA Earth observation data for agricultural monitoring and climate resilience.</p></header>
                <div className="route-card-grid">
                  <article className="route-page-card"><h2>Mission</h2><p>Make Earth-observation data easier to explore while clearly distinguishing measurements from analysis.</p></article>
                  <article className="route-page-card"><h2>Data transparency</h2><p>NASA POWER supplies the weather and climate observations shown in AgriGuard AI. Data values retain their source, units, and observation period; missing values are not replaced with sample observations.</p></article>
                  <article className="route-page-card"><h2>Current location</h2><p>{selectedLocation.name} · {selectedLocation.coords[0].toFixed(4)}°, {selectedLocation.coords[1].toFixed(4)}°</p></article>
                </div>
              </section>
            )}
          </main>
        </div>
      </div>
    )
  }

  return (
    <div className="reference-dashboard-shell">
      <div className="reference-dashboard-card">
        <header className="reference-header">
          <div className="reference-greeting">
            <div className="reference-logo" aria-hidden="true">
              <Leaf size={20} strokeWidth={2.2} />
            </div>
            <div>
              <h1>Hi, Emura!</h1>
              <p>Your farm performance is stable. Here&apos;s today&apos;s overview.</p>
            </div>
          </div>

          <div className="reference-user-pill">
            <div className="reference-avatar">E</div>
            <div className="reference-user-copy">
              <strong>Emura Studio</strong>
              <small>hello@emura.studio</small>
            </div>
            <ChevronsUpDown size={16} aria-hidden="true" />
          </div>
        </header>

        <div className="reference-content">
          <div className="reference-left-panel">
            <div className="reference-stats-grid">
              <article className="reference-stat-card climate-card">
                <div className="reference-stat-top">
                  <span>Partly Cloudy</span>
                  <span className="reference-tag">Temperature</span>
                </div>
                <div className="reference-stat-main">
                  <div className="reference-stat-icon"><CloudSun size={26} /></div>
                  <div className="reference-stat-value">
                    <strong>24</strong>
                    <span>°C</span>
                  </div>
                </div>
              </article>

              <article className="reference-stat-card">
                <div className="reference-stat-top">
                  <span>Wind</span>
                  <span className="reference-tag">3 m/s</span>
                </div>
                <div className="reference-stat-main compact-main">
                  <div className="reference-stat-icon"><Gauge size={20} /></div>
                  <div className="reference-stat-value small-value">
                    <strong>3</strong>
                    <span>m/s</span>
                  </div>
                </div>
              </article>

              <article className="reference-stat-card">
                <div className="reference-stat-top">
                  <span>Humidity</span>
                  <span className="reference-tag">80%</span>
                </div>
                <div className="reference-stat-main compact-main">
                  <div className="reference-stat-icon"><Droplets size={20} /></div>
                  <div className="reference-stat-value small-value">
                    <strong>80</strong>
                    <span>%</span>
                  </div>
                </div>
              </article>

              <article className="reference-stat-card">
                <div className="reference-stat-top">
                  <span>Plant Health</span>
                  <span className="reference-tag subtle-tag">Excellent</span>
                </div>
                <div className="reference-stat-main compact-main">
                  <div className="reference-stat-icon green-icon"><Leaf size={20} /></div>
                  <div className="reference-stat-value small-value">
                    <strong>95</strong>
                    <span>%</span>
                  </div>
                </div>
                <div className="reference-trend-text">Excellent</div>
              </article>

              <article className="reference-stat-card">
                <div className="reference-stat-top">
                  <span>Active Crop Zones</span>
                </div>
                <div className="reference-stat-main compact-main">
                  <div className="reference-stat-icon muted-icon"><MapPinned size={20} /></div>
                  <div className="reference-stat-value small-value">
                    <strong>9</strong>
                    <span>zones</span>
                  </div>
                </div>
                <div className="reference-trend-text positive">+2 from yesterday</div>
              </article>

              <article className="reference-stat-card soil-card">
                <div className="reference-stat-top">
                  <span>Soil Nutrient Status</span>
                </div>
                <div className="reference-stat-main compact-main">
                  <div className="reference-stat-icon muted-icon"><Sprout size={20} /></div>
                  <div className="reference-stat-value small-value larger-footnote">
                    <strong>Optimal</strong>
                  </div>
                </div>
                <div className="reference-soil-bar" aria-hidden="true">
                  <span />
                </div>
              </article>
            </div>

            <div className="reference-lower-row">
              <div className="reference-mini-panel">
                <div className="reference-panel-header small-header">
                  <span className="reference-panel-icon"><Droplets size={18} /></span>
                  <span>Auto Watering</span>
                </div>
                <div className="reference-toggle-row">
                  <strong>Watering every 3 hours</strong>
                  <button type="button" className="reference-toggle on" aria-label="Auto watering enabled">
                    <span />
                  </button>
                </div>
                <div className="reference-toggle-state">On</div>
              </div>

              <div className="reference-mini-panel">
                <div className="reference-panel-header small-header">
                  <span className="reference-panel-icon"><Activity size={18} /></span>
                  <span>pH Balancer</span>
                </div>
                <div className="reference-toggle-row">
                  <strong>Status: Stable</strong>
                  <button type="button" className="reference-toggle on" aria-label="pH balancing enabled">
                    <span />
                  </button>
                </div>
                <div className="reference-figure">6.4</div>
              </div>
            </div>

            <div className="reference-fertilizer-panel">
              <div className="reference-panel-header">
                <span>Fertilizer Application Level</span>
                <span className="reference-level-label">Moderate - High</span>
              </div>
              <div className="reference-fert-bars" aria-hidden="true">
                <span />
                <span />
                <span />
                <span />
                <span />
                <span />
                <span />
                <span />
                <span />
                <span />
                <span />
                <span />
                <span />
                <span />
                <span />
                <span />
              </div>
            </div>
          </div>

          <div className="reference-right-panel">
            <div className="reference-map-panel">
              <div className="reference-map-surface" aria-label="Rice field map overview">
                <div className="reference-map-toolbar">
                  <button type="button" aria-label="Zoom in">+</button>
                  <button type="button" aria-label="Zoom out">−</button>
                </div>

                <div className="reference-map-card">
                  <h2>Area 1: Rice Field</h2>
                  <div className="reference-field-meta">
                    <div>
                      <span>Planting date</span>
                      <strong>24 Aug 25</strong>
                    </div>
                    <div>
                      <span>Harvest Date</span>
                      <strong>12 Dec 25</strong>
                    </div>
                  </div>
                  <div className="reference-health-meter">
                    <span>Crop health</span>
                    <strong>87 %</strong>
                  </div>
                  <div className="reference-progress-bar" aria-hidden="true"><span /></div>
                  <div className="reference-sensor-box">
                    <div className="reference-sensor-row">
                      <span>Temperature</span>
                      <strong>24 °C</strong>
                    </div>
                    <div className="reference-sensor-row">
                      <span>Humidity</span>
                      <strong>80 %</strong>
                    </div>
                    <div className="reference-sensor-row">
                      <span>Soil Moisture</span>
                      <strong>68 %</strong>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="reference-bottom-row">
              <div className="reference-growth-card">
                <div className="reference-growth-header">
                  <span>Growth Analytics</span>
                  <span className="reference-growth-status">Strong nutrient balance</span>
                </div>

                <div className="reference-growth-visual">
                  <div className="reference-gauge" aria-label="Growth level 87 percent">
                    <div className="reference-gauge-center">
                      <strong>87%</strong>
                      <small>Growth Level</small>
                    </div>
                  </div>
                  <div className="reference-gauge-foot">
                    <span>92 <small>Max</small></span>
                    <span>72 <small>Min</small></span>
                    <span>64 <small>Avg</small></span>
                  </div>
                </div>
              </div>

              <aside className="reference-assistant-card">
                <div className="reference-assistant-header">
                  <span>AI Assistant</span>
                  <button type="button" aria-label="Assistant options">…</button>
                </div>
                <div className="reference-chat-box primary-chat">
                  Give me recommendation for Area 1
                </div>
                <div className="reference-chat-box assistant-reply">
                  <p>Sure, here are my recommendations for your Area 1 (Rice Field):</p>
                  <ul>
                    <li>Monitor soil moisture over next 48 hours</li>
                    <li>Maintain current fertilization level</li>
                    <li>Prepare for mid-season pest inspection</li>
                    <li>Keep the water auto watering on</li>
                    <li>Please check again after 2 days</li>
                  </ul>
                </div>
                <div className="reference-chat-ask">
                  <span>Ask anything</span>
                  <button type="button" aria-label="Send"> <Send size={14} /></button>
                </div>
              </aside>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default App
