import { useEffect, useMemo, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { AlertTriangle, ArrowDownToLine, ArrowUpRight, BarChart3, Bell, Check, ChevronDown, CloudSun, Database, Download, Gauge, Lightbulb, LogOut, Menu, Pencil, Plus, Rocket, Settings2, Sparkles, Sun, Target, Trash2, Wind, X, Activity, Upload } from 'lucide-react'
import { useTheme } from './useTheme'
import { CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis } from 'recharts'
import { adjustedAltitude, adjustedRegression, configurationGroups, descentRegression, linearRegression, median, movingAverage, nextExperiment, optimalRocketMass, predictAdjustedAltitude, predictDescentTime, residualDiagnostics, simpleTrend, totalMass, variableImpactConfidence, variableWeights, type DescentConditions, type Launch, type WeatherReference } from './analytics'
import { CloudConflictError, createLaunch, deleteLaunch, fetchWorkspace, importLaunches, savePreferences, updateLaunch, type CloudLaunchRow } from './cloud'
import { isCloudConfigured, supabase } from './supabase'
import { PredictionLab } from './PredictionLab'
import { MassRangeControl } from './MassRangeControl'
import { clampMassRange } from './massRange'
import { validConditions, conditionsFor } from './experiments'

const STORAGE_KEY = 'apexflite-launches-v1'
const PREF_KEY = 'apexflite-prefs-v1'
type Units = 'imperial' | 'metric'

type FormValues = Omit<Launch, 'id'>
type StoredLaunch = Record<string, unknown>

const DEFAULT_TEMPERATURE = 70
const emptyForm: FormValues = { date: new Date().toISOString().slice(0, 10), altitude: 800, flightTime: 0, descentTime: 0, parachuteSize: 18, rocketMass: 578, windSpeed: 4, airPressure: 29.92, humidity: 50, temperature: DEFAULT_TEMPERATURE, notes: '' }

const fahrenheitToCelsius = (value: number) => (value - 32) * 5 / 9
const celsiusToFahrenheit = (value: number) => value * 9 / 5 + 32

const extractTemperature = (notes: string) => {
  const match = notes.match(/(?:temperature|temp)\s*[:=]?\s*(-?\d+(?:\.\d+)?)\s*(?:°?\s*([FC]))?|(-?\d+(?:\.\d+)?)\s*°?\s*degrees?\s*([FC])|(-?\d+(?:\.\d+)?)\s*°\s*([FC])/i)
  if (!match) return null
  const value = Number(match[1] ?? match[3] ?? match[5])
  if (!Number.isFinite(value)) return null
  const unit = (match[2] ?? match[4] ?? match[6] ?? 'F').toUpperCase()
  return { temperature: unit === 'C' ? celsiusToFahrenheit(value) : value, notes: notes.replace(match[0], '').replace(/^\s*[-–—,:;]\s*/, '').replace(/\s{2,}/g, ' ').trim() }
}

const normalizeLaunches = (value: unknown, strictImport = false): Launch[] => {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const stored = item as StoredLaunch
    const rocketMass = Number(stored.rocketMass)
    if (!Number.isFinite(rocketMass)) return []
    const legacyMotorMass = Number(stored.motorMass)
    const storedNotes = typeof stored.notes === 'string' ? stored.notes : ''
    const storedTemperature = stored.temperature == null || stored.temperature === '' ? NaN : Number(stored.temperature)
    const extracted = Number.isFinite(storedTemperature) ? null : extractTemperature(storedNotes)
    const canonical = Object.fromEntries(Object.entries(stored).filter(([key]) => key !== 'motorMass'))
    const normalized = { ...canonical, rocketMass: rocketMass + (Number.isFinite(legacyMotorMass) ? legacyMotorMass : 0), temperature: Number.isFinite(storedTemperature) ? storedTemperature : extracted?.temperature ?? DEFAULT_TEMPERATURE, notes: extracted?.notes ?? storedNotes } as unknown as Launch
    // Existing local records keep the legacy migration behavior. Strict import
    // validation must never silently delete an older incomplete saved flight.
    if (!strictImport) return [normalized]
    const numericKeys = ['altitude', 'flightTime', 'descentTime', 'parachuteSize', 'windSpeed', 'airPressure', 'humidity'] as const
    if (numericKeys.some(key => stored[key] == null || stored[key] === '' || !Number.isFinite(Number(stored[key])))) return []
    const numbers = Object.fromEntries(numericKeys.map(key => [key, Number(stored[key])]))
    const launch = { ...normalized, ...numbers } as Launch
    if (typeof launch.id !== 'string' || !launch.id || typeof launch.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(launch.date) || !Number.isFinite(Date.parse(launch.date)) || !validConditions(conditionsFor(launch)) || launch.flightTime < 0 || launch.descentTime < 0 || launch.descentTime > launch.flightTime) return []
    return [launch]
  })
}

const formatNumber = (value: number, digits = 0) => new Intl.NumberFormat('en-US', { maximumFractionDigits: digits }).format(value)
const formatMass = (grams: number) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 20 }).format(grams)
const formatRecommendationMass = (grams: number) => new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(grams)
const formatTemperature = (fahrenheit: number, units: Units) => units === 'imperial' ? `${formatNumber(fahrenheit, 1)} °F` : `${formatNumber(fahrenheitToCelsius(fahrenheit), 1)} °C`

const equationNumber = (value: number, digits = 4) => Math.abs(value).toFixed(digits)
const equationTerm = (coefficient: number, label: string) => ` ${coefficient >= 0 ? '+' : '−'} ${equationNumber(coefficient)}·${label}`
const altitudePredictionEquation = (model: ReturnType<typeof adjustedRegression> | ReturnType<typeof linearRegression>) => {
  if (!model) return null
  const labels = model.coefficients.length === 1 ? ['mass'] : ['mass', 'wind', 'pressure', 'humidity', 'temperature']
  return `altitude = ${model.intercept.toFixed(2)}${model.coefficients.map((coefficient, index) => equationTerm(coefficient, labels[index])).join('')}`
}
const descentPredictionEquation = (model: ReturnType<typeof descentRegression>) => {
  if (!model) return null
  const labels = ['m', 'h', 'p', 'w', 'pr', 'hu', 't']
  return `descent = ${model.intercept.toFixed(2)}${model.coefficients.map((coefficient, index) => equationTerm(coefficient, `(${labels[index]}−${model.means[index].toFixed(1)})/${model.scales[index].toFixed(1)}`)).join('')}`
}

const ftToM = (value: number) => value / 3.28084
const mphToKmh = (value: number) => value * 1.60934

// TARC scoring: 1 point per 1 ft altitude deviation
// Descent: 4 points per second outside the 37-40s target window
// If descent time is between 37-40s, no descent penalty
const tarcScore = (altitude: number, descentTime: number, targetAltitude: number) => {
  const MIN_DESCENT = 37
  const MAX_DESCENT = 40

  const altitudeDeviation = Math.abs(Math.round(altitude) - Math.round(targetAltitude))

  // Calculate descent deviation: if within window, 0; otherwise distance to nearest boundary
  let descentDeviation = 0
  if (descentTime < MIN_DESCENT) {
    descentDeviation = MIN_DESCENT - descentTime
  } else if (descentTime > MAX_DESCENT) {
    descentDeviation = descentTime - MAX_DESCENT
  }

  const descentScore = descentDeviation * 4
  const total = altitudeDeviation + descentScore

  return Math.round(total * 100) / 100 // Round to 2 decimal places
}


function App() {
  const { theme, setTheme } = useTheme()
  const [launches, setLaunches] = useState<Launch[]>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')
      return Array.isArray(stored) && stored.length > 0 ? normalizeLaunches(stored) : []
    } catch { return [] }
  })
  const [units, setUnits] = useState<Units>(() => {
    try { return (localStorage.getItem(PREF_KEY) as Units) ?? 'imperial' } catch { return 'imperial' }
  })
  const [targetAltitude, setTargetAltitude] = useState(800)
  const [dateWindow, setDateWindow] = useState<[number, number] | null>(null)
  const [zoomReset, setZoomReset] = useState(0)
  const [descentConditions, setDescentConditions] = useState<DescentConditions>({ mass: 578, altitude: 800, parachuteSize: 18, wind: 4, pressure: 29.92, humidity: 50, temperature: DEFAULT_TEMPERATURE })
  const simulatorWeather = useMemo(() => ({ wind: descentConditions.wind, pressure: descentConditions.pressure, humidity: descentConditions.humidity, temperature: descentConditions.temperature }), [descentConditions])
  const setSimulatorWeather: React.Dispatch<React.SetStateAction<WeatherReference>> = update => setDescentConditions(current => {
    const weather = { wind: current.wind, pressure: current.pressure, humidity: current.humidity, temperature: current.temperature }
    return { ...current, ...(typeof update === 'function' ? update(weather) : update) }
  })
  const [form, setForm] = useState<FormValues>(emptyForm)
  const [rocketMassInput, setRocketMassInput] = useState(String(emptyForm.rocketMass))
  const [showForm, setShowForm] = useState(false)
  const [editingLaunchId, setEditingLaunchId] = useState<string | null>(null)
  const [activeSection, setActiveSection] = useState<'overview' | 'flights' | 'insights' | 'experiments' | 'settings'>('overview')
  const [mobileNav, setMobileNav] = useState(false)
  const [toast, setToast] = useState('')
  const [session, setSession] = useState<Session | null>(null)
  const [authReady, setAuthReady] = useState(!isCloudConfigured)
  const [cloudLoading, setCloudLoading] = useState(false)
  const [cloudError, setCloudError] = useState('')
  const [versions, setVersions] = useState<Record<string, number>>({})
  const [preferencesReady, setPreferencesReady] = useState(false)
  const [pendingImport, setPendingImport] = useState<Launch[] | null>(null)
  const [authMode, setAuthMode] = useState<'sign-in' | 'sign-up' | 'reset'>('sign-in')
  const [authEmail, setAuthEmail] = useState('')
  const [authPassword, setAuthPassword] = useState('')
  const [authBusy, setAuthBusy] = useState(false)
  const [authMessage, setAuthMessage] = useState('')
  const [resendBusy, setResendBusy] = useState(false)
  const [resendEmail, setResendEmail] = useState('')
  const [migrationDismissed, setMigrationDismissed] = useState(false)

  const authRedirectUrl = () => {
    const configured = import.meta.env.VITE_AUTH_REDIRECT_URL ?? import.meta.env.NEXT_PUBLIC_DEV_SUPABASE_REDIRECT_URL
    if (configured) return configured
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
      return 'https://rocketpredictor.vercel.app'
    }
    return `${window.location.origin}${window.location.pathname}`
  }

  useEffect(() => {
    if (session && (!preferencesReady || pendingImport !== null)) return
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(launches)) } catch { /* storage may be unavailable */ }
  }, [launches, session, preferencesReady, pendingImport])
  useEffect(() => {
    try { localStorage.setItem(PREF_KEY, units) } catch { /* storage may be unavailable */ }
  }, [units])

  useEffect(() => { if (toast) { const timeout = window.setTimeout(() => setToast(''), 2600); return () => window.clearTimeout(timeout) } }, [toast])

  useEffect(() => {
    if (!supabase) return
    let mounted = true
    supabase.auth.getSession().then(({ data, error }) => {
      if (!mounted) return
      if (error) setCloudError(error.message)
      setSession(data.session)
      setAuthReady(true)
    })
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (mounted) setSession(nextSession)
    })
    return () => { mounted = false; listener.subscription.unsubscribe() }
  }, [])

  useEffect(() => {
    if (!session || !supabase) return
    let active = true
    fetchWorkspace(supabase, session.user.id).then((workspace) => {
      if (!active) return
      setCloudLoading(false)
      setCloudError('')
      setLaunches(workspace.launches)
      setVersions(workspace.versions)
      if (workspace.preferences) {
        setUnits(workspace.preferences.units)
        setTargetAltitude(workspace.preferences.targetAltitude)
      }
      setPreferencesReady(true)
      let local: Launch[] = []
      try {
        const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')
        local = Array.isArray(raw) ? normalizeLaunches(raw) : []
      } catch { /* ignore malformed local storage */ }
      const existingIds = new Set(workspace.launches.map((launch) => launch.id))
      const candidates = local.filter((launch) => !existingIds.has(launch.id))
      const marker = `apexFlite-migrated-${session.user.id}`
      let alreadyMigrated = false
      try { alreadyMigrated = localStorage.getItem(marker) === 'true' } catch { /* storage may be unavailable */ }
      if (!alreadyMigrated && candidates.length > 0) setPendingImport(candidates)
    }).catch((error: Error) => {
      if (active) { setCloudError(error.message); setCloudLoading(false) }
    })
    const channel = supabase.channel(`workspace-${session.user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'launches', filter: `user_id=eq.${session.user.id}` }, (payload) => {
        const row = payload.new as CloudLaunchRow
        const oldRow = payload.old as Partial<CloudLaunchRow>
        if (payload.eventType === 'DELETE') {
          setLaunches((current) => current.filter((launch) => launch.id !== oldRow.launch_id))
          setVersions((current) => { const next = { ...current }; delete next[oldRow.launch_id ?? '']; return next })
        } else {
          setLaunches((current) => { const next = current.filter((launch) => launch.id !== row.launch_id); return [...next, { id: row.launch_id, date: row.date, altitude: row.altitude, flightTime: row.flight_time, descentTime: row.descent_time, parachuteSize: row.parachute_size, rocketMass: row.rocket_mass, windSpeed: row.wind_speed, airPressure: row.air_pressure, humidity: row.humidity, temperature: row.temperature, notes: row.notes ?? '' }] })
          setVersions((current) => ({ ...current, [row.launch_id]: row.version }))
        }
      }).subscribe()
    return () => { active = false; if (supabase) void supabase.removeChannel(channel) }
  }, [session])

  const [today] = useState(() => new Date().setHours(12, 0, 0, 0))
  const graphBounds = useMemo(() => {
    const dates = launches.map((launch) => new Date(`${launch.date}T12:00:00`).getTime()).filter(Number.isFinite)
    return { minDate: dates.length ? Math.min(...dates) : today, maxDate: dates.length ? Math.max(...dates) : today }
  }, [launches, today])
  const selectedDateWindow = useMemo(() => clampMassRange(dateWindow, [graphBounds.minDate, graphBounds.maxDate]), [dateWindow, graphBounds])
  const graphLaunches = useMemo(() => launches.filter((launch) => { const date = new Date(`${launch.date}T12:00:00`).getTime(); return date >= selectedDateWindow[0] && date <= selectedDateWindow[1] }), [launches, selectedDateWindow])
  const rawModel = useMemo(() => linearRegression(graphLaunches.map((launch) => ({ x: totalMass(launch), y: launch.altitude }))), [graphLaunches])
  const adjustedModel = useMemo(() => adjustedRegression(graphLaunches), [graphLaunches])
  const descentModel = useMemo(() => descentRegression(graphLaunches), [graphLaunches])
  const altitudeConfidence = useMemo(() => variableImpactConfidence(adjustedModel, graphLaunches.map((launch) => [totalMass(launch), launch.windSpeed, launch.airPressure, launch.humidity, launch.temperature])), [adjustedModel, graphLaunches])
  const descentConfidence = useMemo(() => variableImpactConfidence(descentModel, [], true), [descentModel])
  const altitudeWeights = useMemo(() => variableWeights(adjustedModel, graphLaunches.map((launch) => [totalMass(launch), launch.windSpeed, launch.airPressure, launch.humidity, launch.temperature])), [adjustedModel, graphLaunches])
  const descentWeights = useMemo(() => variableWeights(descentModel, [], true), [descentModel])
  const predictedDescent = descentModel ? predictDescentTime(descentModel, descentConditions) : null
  const reference = simulatorWeather
  const rawRecommendation = rawModel && Math.abs(rawModel.coefficients[0]) > 0.01 ? (targetAltitude - rawModel.intercept) / rawModel.coefficients[0] : null
  const adjustedRecommendation = optimalRocketMass(adjustedModel, targetAltitude, reference)
  const simulatorMass = adjustedModel
    ? optimalRocketMass(adjustedModel, targetAltitude, simulatorWeather)
    : rawModel && Math.abs(rawModel.coefficients[0]) > 1e-8
      ? (targetAltitude - rawModel.intercept) / rawModel.coefficients[0]
      : null
  const simulatorPrediction = adjustedModel && simulatorMass !== null ? predictAdjustedAltitude(adjustedModel, simulatorMass, simulatorWeather) : rawModel && simulatorMass !== null ? rawModel.intercept + rawModel.coefficients[0] * simulatorMass : null
  const rawChart = useMemo(() => graphLaunches.map((launch) => ({ ...launch, mass: totalMass(launch), fitted: rawModel ? rawModel.intercept + rawModel.coefficients[0] * totalMass(launch) : 0 })).sort((a, b) => a.mass - b.mass), [graphLaunches, rawModel])
  const adjustedChart = useMemo(() => graphLaunches.map((launch) => ({ ...launch, mass: totalMass(launch), adjusted: adjustedModel ? adjustedAltitude(launch, adjustedModel, reference) : launch.altitude, fitted: adjustedModel ? adjustedModel.intercept + adjustedModel.coefficients[0] * totalMass(launch) + adjustedModel.coefficients[1] * reference.wind + adjustedModel.coefficients[2] * reference.pressure + adjustedModel.coefficients[3] * reference.humidity + adjustedModel.coefficients[4] * reference.temperature : 0 })).sort((a, b) => a.mass - b.mass), [graphLaunches, adjustedModel, reference])
  const avgAltitude = launches.length ? launches.reduce((sum, launch) => sum + launch.altitude, 0) / launches.length : 0
  const avgDescent = launches.length ? launches.reduce((sum, launch) => sum + launch.descentTime, 0) / launches.length : 0
  const targetGap = avgAltitude - targetAltitude
  const closeModal = () => { setForm(emptyForm); setRocketMassInput(String(emptyForm.rocketMass)); setEditingLaunchId(null); setShowForm(false) }
  const onSaveLaunch = async (event: React.FormEvent) => {
    event.preventDefault()
    const launch: Launch = { ...form, id: editingLaunchId ?? `flight-${Date.now()}` }
    if (!validConditions(conditionsFor(launch)) || !Number.isFinite(launch.flightTime) || launch.flightTime <= 0 || !Number.isFinite(launch.descentTime) || launch.descentTime <= 0 || launch.descentTime > launch.flightTime) { setToast('Check measurements: descent must be positive and no longer than total flight time.'); return }
    if (session && supabase) {
      try {
        const row = editingLaunchId
          ? await updateLaunch(supabase, session.user.id, launch, versions[launch.id] ?? 1)
          : await createLaunch(supabase, session.user.id, launch)
        setLaunches((current) => editingLaunchId ? current.map((item) => item.id === launch.id ? launch : item) : [...current, launch])
        setVersions((current) => ({ ...current, [launch.id]: row.version }))
        setToast(editingLaunchId ? 'Flight updated · synced online' : 'Flight saved · synced online')
        closeModal()
      } catch (error) {
        setToast(error instanceof CloudConflictError ? 'Conflict detected · reload this flight before editing' : `Save failed · ${error instanceof Error ? error.message : 'try again'}`)
      }
      return
    }
    setLaunches((current) => editingLaunchId ? current.map((item) => item.id === launch.id ? launch : item) : [...current, launch])
    setToast(editingLaunchId ? 'Flight updated locally' : 'Flight saved locally')
    closeModal()
  }
  const editLaunch = (launch: Launch) => {
    setForm({ ...launch })
    setRocketMassInput(String(launch.rocketMass))
    setEditingLaunchId(launch.id)
    setShowForm(true)
  }
  const openNewLaunch = () => {
    setForm(emptyForm)
    setRocketMassInput(String(emptyForm.rocketMass))
    setEditingLaunchId(null)
    setShowForm(true)
  }
  const removeLaunch = async (id: string) => {
    if (!window.confirm('Remove this flight from the workspace?')) return
    if (session && supabase) {
      try {
        await deleteLaunch(supabase, session.user.id, id, versions[id] ?? 1)
        setLaunches((current) => current.filter((launch) => launch.id !== id))
        setVersions((current) => { const next = { ...current }; delete next[id]; return next })
        setToast('Flight removed · synced online')
      } catch (error) {
        setToast(error instanceof CloudConflictError ? 'Conflict detected · flight was changed on another device' : `Delete failed · ${error instanceof Error ? error.message : 'try again'}`)
      }
      return
    }
    setLaunches((current) => current.filter((launch) => launch.id !== id))
    setToast('Flight removed locally')
  }
  const updateForm = (field: keyof FormValues, value: string) => setForm((current) => ({ ...current, [field]: value === '' ? 0 : Number(value) }))
  const displayMass = (grams: number) => `${formatMass(grams)} g`
  const displayAltitude = (feet: number) => units === 'imperial' ? `${formatNumber(feet)} ft` : `${formatNumber(ftToM(feet))} m`
  const displayWind = (mph: number) => units === 'imperial' ? `${formatNumber(mph, 1)} mph` : `${formatNumber(mphToKmh(mph), 1)} km/h`
  const displayTemperature = (fahrenheit: number) => formatTemperature(fahrenheit, units)
  const changeUnits = (next: Units) => {
    setUnits(next)
    if (session && supabase && preferencesReady) void savePreferences(supabase, session.user.id, { units: next, targetAltitude }).catch((error: Error) => setToast(`Preference sync failed · ${error.message}`))
  }
  const changeTargetAltitude = (next: number) => {
    setTargetAltitude(next)
    if (session && supabase && preferencesReady) void savePreferences(supabase, session.user.id, { units, targetAltitude: next }).catch((error: Error) => setToast(`Preference sync failed · ${error.message}`))
  }

  const exportData = () => {
    const blob = new Blob([JSON.stringify(launches, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = 'apexFlite-flights.json'; link.click(); URL.revokeObjectURL(url)
    setToast('Flight data exported')
  }
  const importData = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json,application/json'
    input.onchange = () => {
      const file = input.files?.[0]
      if (!file) return
      void file.text().then(async (contents) => {
        try {
          const parsed: unknown = JSON.parse(contents)
          const records = Array.isArray(parsed) ? parsed : (parsed && typeof parsed === 'object' ? (parsed as { launches?: unknown }).launches : undefined)
          if (!Array.isArray(records)) throw new Error('Expected an array of flights')
          const imported = normalizeLaunches(records, true)
          if (imported.length === 0) throw new Error('No valid flight records found')
          if (imported.length !== records.length) throw new Error('Some flights have missing or invalid measurements. Correct the file before importing.')
          if (new Set(imported.map(launch => launch.id)).size !== imported.length) throw new Error('Duplicate flight IDs in import file')
          const existingIds = new Set(launches.map((launch) => launch.id))
          const additions = imported.filter((launch) => !existingIds.has(launch.id))
          if (additions.length === 0) { setToast('No new flights to import'); return }
          if (session && supabase) {
            setCloudLoading(true)
            await importLaunches(supabase, session.user.id, additions)
            const workspace = await fetchWorkspace(supabase, session.user.id)
            setLaunches(workspace.launches); setVersions(workspace.versions)
          } else setLaunches((current) => [...current, ...additions])
          setToast(`${additions.length} flight${additions.length === 1 ? '' : 's'} imported`)
        } catch (error) { setToast(`Import failed · ${error instanceof Error ? error.message : 'invalid JSON file'}`) }
        finally { setCloudLoading(false) }
      })
    }
    input.click()
  }
  const signOut = () => {
    if (!supabase) return
    void supabase.auth.signOut().then(({ error }) => {
      if (error) setCloudError(error.message)
      else { setLaunches([]); setVersions({}); setPendingImport(null); setPreferencesReady(false); setToast('Signed out') }
    })
  }
  const submitAuth = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!supabase) return
    setAuthBusy(true); setAuthMessage(''); setCloudError('')
    try {
      if (authMode === 'reset') {
        const { error } = await supabase.auth.resetPasswordForEmail(authEmail, { redirectTo: authRedirectUrl() })
        if (error) throw error
        setAuthMessage('Password reset instructions sent.')
      } else {
        const result = authMode === 'sign-up'
          ? await supabase.auth.signUp({ email: authEmail, password: authPassword, options: { emailRedirectTo: authRedirectUrl() } })
          : await supabase.auth.signInWithPassword({ email: authEmail, password: authPassword })
        if (result.error) {
          if (authMode === 'sign-in' && /confirm|verified/i.test(result.error.message)) {
            setResendEmail(authEmail)
            setAuthMessage('Please confirm your email before signing in. You can resend the verification email below.')
            return
          }
          throw result.error
        }
        if (authMode === 'sign-up' && !result.data.session) { setResendEmail(authEmail); setAuthMessage('Check your email to confirm your account, then sign in.') }
      }
    } catch (error) {
      setAuthMessage(error instanceof Error ? error.message : 'Unable to authenticate.')
    } finally { setAuthBusy(false) }
  }
  const resendVerification = async () => {
    if (!supabase || !resendEmail) return
    setResendBusy(true); setAuthMessage('')
    try {
      const { error } = await supabase.auth.resend({ type: 'signup', email: resendEmail, options: { emailRedirectTo: authRedirectUrl() } })
      if (error) throw error
      setAuthMessage('A new verification email has been sent.')
    } catch (error) {
      setAuthMessage(/rate|limit/i.test(error instanceof Error ? error.message : '') ? 'Please wait before requesting another email.' : 'Unable to resend the verification email. Please try again.')
    } finally { setResendBusy(false) }
  }

  const importLocalData = async () => {
    if (!session || !supabase || !pendingImport) return
    try {
      await importLaunches(supabase, session.user.id, pendingImport)
      const workspace = await fetchWorkspace(supabase, session.user.id)
      setLaunches(workspace.launches); setVersions(workspace.versions)
      localStorage.setItem(`apexFlite-migrated-${session.user.id}`, 'true')
      setPendingImport(null); setToast(`${pendingImport.length} local flights transferred to the cloud`)
    } catch (error) { setToast(`Transfer failed · ${error instanceof Error ? error.message : 'try again'}`) }
  }

  if (!authReady) return <div className="auth-shell"><div className="auth-card"><div className="brand auth-brand"><div className="brand-mark"><Rocket size={20} /></div><strong>apexFlite</strong></div><h1>Connecting to your workspace…</h1><p>Restoring your secure cloud session.</p><div className="loading-line" /></div></div>
  if (isCloudConfigured && !session) return <AuthScreen mode={authMode} setMode={(mode) => { setAuthMode(mode); setAuthMessage(''); setCloudError(''); setResendEmail('') }} email={authEmail} setEmail={setAuthEmail} password={authPassword} setPassword={setAuthPassword} busy={authBusy} message={authMessage} error={cloudError} onSubmit={submitAuth} resendEmail={resendEmail} resendBusy={resendBusy} onResend={resendVerification} />
  const graphFilters = <section className="graph-filters"><div><span>GRAPH FILTERS</span><strong>Explore your launch envelope</strong></div><label className="date-filter"> <span className="date-filter-heading"><span>Launch date</span><b>{new Date(selectedDateWindow[0]).toLocaleDateString()} – {new Date(selectedDateWindow[1]).toLocaleDateString()}</b></span><span className="date-slider"><span className="date-slider-track" /><span className="date-slider-fill" style={{ left: `${((selectedDateWindow[0] - graphBounds.minDate) / Math.max(1, graphBounds.maxDate - graphBounds.minDate)) * 100}%`, right: `${100 - ((selectedDateWindow[1] - graphBounds.minDate) / Math.max(1, graphBounds.maxDate - graphBounds.minDate)) * 100}%` }} /><input aria-label="Start launch date" type="range" min={graphBounds.minDate} max={graphBounds.maxDate} value={selectedDateWindow[0]} onChange={(event) => setDateWindow([Math.min(Number(event.target.value), selectedDateWindow[1]), selectedDateWindow[1]])} /><input aria-label="End launch date" type="range" min={graphBounds.minDate} max={graphBounds.maxDate} value={selectedDateWindow[1]} onChange={(event) => setDateWindow([selectedDateWindow[0], Math.max(Number(event.target.value), selectedDateWindow[0])])} /></span></label><button className="text-button" onClick={() => { setZoomReset(current => current + 1); setDateWindow(null) }}>Reset</button></section>
  const syncStatus = cloudLoading ? 'Syncing…' : session ? 'Synced online' : 'Local preview mode'

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileNav ? 'mobile-open' : ''}`}>
        <div className="brand"><div className="brand-mark"><Rocket size={20} /></div><div><strong>apexFlite</strong><span>flight intelligence</span></div></div>
        <div className="workspace-switcher"><div className="workspace-icon">T</div><div><b>TARC Rocketry</b><span>{session ? 'Cloud workspace' : 'Local preview'}</span></div><ChevronDown size={16} /></div>
        <nav><button className={activeSection === 'overview' ? 'active' : ''} onClick={() => { setActiveSection('overview'); setMobileNav(false) }}><BarChart3 size={18} /> Overview</button><button className={activeSection === 'flights' ? 'active' : ''} onClick={() => { setActiveSection('flights'); setMobileNav(false) }}><Database size={18} /> Flights <em>{launches.length}</em></button><button className={activeSection === 'insights' ? 'active' : ''} onClick={() => { setActiveSection('insights'); setMobileNav(false) }}><Sparkles size={18} /> Insights <span className="new-pill">NEW</span></button><button className={activeSection === 'experiments' ? 'active' : ''} onClick={() => { setActiveSection('experiments'); setMobileNav(false) }}><Activity size={18} /> Experiments</button></nav>
        <div className="sidebar-bottom"><button className={activeSection === 'settings' ? 'active' : ''} onClick={() => { setActiveSection('settings'); setMobileNav(false) }}><Settings2 size={18} /> Settings</button><div className="profile"><div className="avatar">{session ? (session.user.email?.slice(0, 2).toUpperCase() ?? 'RT') : 'LP'}</div><div><b>{session?.user.email ?? 'Local preview'}</b><span>{session ? 'Synced team access' : 'Cloud not configured'}</span></div>{session ? <button className="profile-menu" onClick={signOut} aria-label="Sign out"><LogOut size={14} /></button> : <MoreDots />}</div></div>
      </aside>
      {mobileNav && <button className="sidebar-scrim" onClick={() => setMobileNav(false)} aria-label="Close navigation" />}
      <main className="main-content">
        <style>{`.graph-filters { max-width: 1346px; width: calc(100% - 94px); margin: 18px auto 0; padding: 14px 18px 16px; display: flex; align-items: center; gap: 24px; background: var(--color-bg-secondary); border: 1px solid var(--color-border); border-radius: 10px; box-shadow: 0 2px 5px var(--color-modal-shadow); } .graph-filters > div { display: grid; gap: 4px; min-width: 190px; } .graph-filters > div span { color: var(--color-text-muted); font: 8px 'DM Mono'; letter-spacing: .7px; } .graph-filters > div strong { color: var(--color-text-primary); font-size: 13px; } .graph-filters label { flex: 1; display: grid; gap: 7px; color: var(--color-text-secondary); font-size: 11px; } .graph-filters label b { color: var(--color-text-primary); font-size: 12px; } .graph-filters input[type=range] { width: 100%; accent-color: #3478f6; cursor: grab; } .graph-filters input[type=range]:active { cursor: grabbing; } .date-filter-heading { display: flex; justify-content: space-between; align-items: baseline; gap: 16px; } .date-filter-heading > span { color: var(--color-text-muted); font: 9px 'DM Mono'; letter-spacing: .55px; text-transform: uppercase; } .date-slider { position: relative; display: block; height: 22px; margin: 0 8px; } .date-slider-track, .date-slider-fill { position: absolute; top: 9px; height: 5px; border-radius: 99px; pointer-events: none; } .date-slider-track { left: 0; right: 0; background: var(--color-border-muted); box-shadow: inset 0 1px 2px #17233718; } .date-slider-fill { background: linear-gradient(90deg, #3478f6, #7758d8); box-shadow: 0 1px 4px #3478f638; } .date-slider input[type=range] { position: absolute; inset: 0; height: 22px; margin: 0; appearance: none; background: transparent; pointer-events: none; accent-color: transparent; } .date-slider input[type=range]::-webkit-slider-runnable-track { height: 5px; background: transparent; } .date-slider input[type=range]::-moz-range-track { height: 5px; background: transparent; } .date-slider input[type=range]::-webkit-slider-thumb { width: 16px; height: 16px; margin-top: -5.5px; appearance: none; border: 3px solid var(--color-bg-secondary); border-radius: 50%; background: #3478f6; box-shadow: 0 2px 6px #17233738, 0 0 0 1px #3478f655; pointer-events: auto; cursor: grab; transition: transform .14s ease, box-shadow .14s ease; } .date-slider input[type=range]::-moz-range-thumb { width: 11px; height: 11px; border: 3px solid var(--color-bg-secondary); border-radius: 50%; background: #3478f6; box-shadow: 0 2px 6px #17233738, 0 0 0 1px #3478f655; pointer-events: auto; cursor: grab; transition: transform .14s ease, box-shadow .14s ease; } .date-slider input[type=range]:hover::-webkit-slider-thumb, .date-slider input[type=range]:focus-visible::-webkit-slider-thumb { transform: scale(1.16); box-shadow: 0 3px 8px #17233745, 0 0 0 4px #3478f625; } .date-slider input[type=range]:hover::-moz-range-thumb, .date-slider input[type=range]:focus-visible::-moz-range-thumb { transform: scale(1.16); box-shadow: 0 3px 8px #17233745, 0 0 0 4px #3478f625; } .date-slider input[type=range]:active::-webkit-slider-thumb, .date-slider input[type=range]:active::-moz-range-thumb { cursor: grabbing; } @media (max-width: 760px) { .graph-filters { width: calc(100% - 36px); align-items: stretch; flex-direction: column; gap: 12px; } }`}</style>
        <header className="topbar"><button className="icon-button mobile-menu" onClick={() => setMobileNav(true)} aria-label="Open navigation"><Menu size={20} /></button><div className="breadcrumbs"><span>Workspace</span><span>/</span><b>{activeSection === 'overview' ? 'Overview' : activeSection === 'flights' ? 'Flights' : activeSection === 'insights' ? 'Insights' : activeSection === 'experiments' ? 'Experiments' : 'Settings'}</b></div><div className="top-actions"><button className="unit-select" onClick={() => changeUnits(units === 'imperial' ? 'metric' : 'imperial')}><span className="unit-dot" /> {units === 'imperial' ? 'Imperial' : 'Metric'} <ChevronDown size={14} /></button><button className="icon-button" onClick={() => setToast(syncStatus)} aria-label="Sync status"><Bell size={16} /></button>{session ? <button className="avatar small" onClick={signOut} aria-label="Sign out">{session.user.email?.slice(0, 2).toUpperCase() ?? 'RT'}</button> : <span className="local-badge">LOCAL</span>}</div></header>
        {cloudError && <div className="cloud-error"><span>{cloudError}</span><button onClick={() => setCloudError('')} aria-label="Dismiss cloud error"><X size={15} /></button></div>}
        {session && <div className={`sync-banner ${cloudLoading ? 'syncing' : ''}`}><span className="sync-dot" /> {syncStatus}<span>{session.user.email}</span></div>}
        {activeSection === 'settings' ? <SettingsPanel units={units} setUnits={changeUnits} targetAltitude={targetAltitude} setTargetAltitude={changeTargetAltitude} theme={theme} setTheme={setTheme} /> : activeSection === 'flights' ? <FlightsPanel launches={launches} targetAltitude={targetAltitude} displayAltitude={displayAltitude} displayMass={displayMass} displayWind={displayWind} displayTemperature={displayTemperature} exportData={exportData} importData={importData} onDelete={removeLaunch} onEdit={editLaunch} onNew={openNewLaunch} /> : activeSection === 'insights' ? <><InsightsPanel launches={launches} targetAltitude={targetAltitude} altitudeModel={adjustedModel} descentModel={descentModel} altitudeWeights={altitudeWeights} descentWeights={descentWeights} units={units} /><TarcOverPointsInsight launches={launches} targetAltitude={targetAltitude} /><InsightsLab launches={launches} targetAltitude={targetAltitude} altitudeModel={adjustedModel} /></> : activeSection === 'experiments' ? <><section className="page-heading"><div><p className="eyebrow">MODEL COMPARISON</p><h1>Experiments</h1><p className="subtitle">Descent sensitivity, alternative algorithms, and flight-by-flight validation.</p></div><button className="primary-button" onClick={openNewLaunch}><Plus size={17} /> Log a flight</button></section>{graphFilters}<PredictionLab launches={graphLaunches} conditions={descentConditions} setConditions={setDescentConditions} targetAltitude={targetAltitude} units={units} /></> : <>
        <section className="page-heading"><div><p className="eyebrow">{new Date(today).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).toUpperCase()} <span className="live-dot" /> LIVE MODEL</p><h1>Good morning, team.</h1><p className="subtitle">Your flight data is getting smarter with every launch.</p></div><button className="primary-button" onClick={openNewLaunch}><Plus size={17} /> Log a flight</button></section>
        {graphFilters}
        <section className="target-banner"><div className="target-icon"><Target size={20} /></div><div><span>Current target altitude</span><strong>{formatNumber(targetAltitude)} <small>ft</small></strong></div><div className="target-divider" /><div className="target-status"><Check size={15} /> <span>{Math.abs(targetGap) < 15 ? 'On target range' : targetGap > 0 ? 'Running high' : 'Running low'}</span></div><button onClick={() => setActiveSection('settings')}>Edit target <ArrowUpRight size={15} /></button></section>
        <section className="stats-grid"><StatCard label="FLIGHTS LOGGED" value={String(launches.length).padStart(2, '0')} note="Saved flight records" trend="up" icon={<Database size={18} />} /><StatCard label="AVG. ALTITUDE" value={formatNumber(avgAltitude)} unit="ft" note={`${targetGap >= 0 ? '+' : ''}${formatNumber(targetGap)} ft vs target`} trend={targetGap >= 0 ? 'up' : 'down'} icon={<ArrowUpRight size={18} />} /><StatCard label="AVG. DESCENT" value={formatNumber(avgDescent, 1)} unit="sec" note="Target: 34.0 sec" trend={Math.abs(avgDescent - 34) < 2 ? 'up' : 'down'} icon={<ArrowDownToLine size={18} />} /><StatCard label="BASELINE TRAINING FIT" value={adjustedModel ? formatNumber(adjustedModel.r2 * 100) : '—'} unit={adjustedModel ? '%' : ''} note={adjustedModel ? 'Training R², not forecast confidence' : 'Need 4+ flights'} trend="up" icon={<Gauge size={18} />} /></section>
        <section className="analysis-grid"><AnalysisCard title="Original mass-only model" subtitle="Altitude vs. total mass · no weather compensation" icon={<Activity size={18} />} accent="blue" model={rawModel} recommendation={rawRecommendation} chart={<RawChart key={zoomReset} data={rawChart} target={targetAltitude} units={units} />} /><AnalysisCard title="Original weather-aware model" subtitle="Adjusted to your entered weather · recommendation updates live" icon={<CloudSun size={18} />} accent="purple" model={adjustedModel} recommendation={adjustedRecommendation} chart={<AdjustedChart key={zoomReset} data={adjustedChart} target={targetAltitude} units={units} />} /></section>
        <AltitudePredictorWithConfidence units={units} model={adjustedModel} fallbackModel={rawModel} targetAltitude={targetAltitude} weather={simulatorWeather} setWeather={setSimulatorWeather} optimalMass={simulatorMass} predictedAltitude={simulatorPrediction} observedMasses={graphLaunches.map(totalMass)} confidence={altitudeConfidence} weights={altitudeWeights} />
        <DescentPredictorWithConfidence units={units} model={descentModel} conditions={descentConditions} setConditions={setDescentConditions} predictedDescent={predictedDescent} confidence={descentConfidence} weights={descentWeights} />
        <section className="recent-section"><div className="section-heading"><div><h2>Recent flights</h2><p>Latest performance from your team</p></div><button className="text-button" onClick={() => setActiveSection('flights')}>View all <ArrowUpRight size={15} /></button></div><FlightTable launches={launches.slice(-5).reverse()} targetAltitude={targetAltitude} displayAltitude={displayAltitude} displayMass={displayMass} displayWind={displayWind} displayTemperature={displayTemperature} onDelete={removeLaunch} onEdit={editLaunch} /></section>
        </>}
      </main>
      {showForm && <LaunchModal form={form} setForm={setForm} onClose={() => { setShowForm(false); setEditingLaunchId(null) }} onSubmit={onSaveLaunch} units={units} updateForm={updateForm} editing={Boolean(editingLaunchId)} rocketMassInput={rocketMassInput} setRocketMassInput={setRocketMassInput} />}
      {pendingImport && !migrationDismissed && <MigrationDialog count={pendingImport.length} busy={cloudLoading} onImport={async () => { setCloudLoading(true); await importLocalData(); setCloudLoading(false) }} onDismiss={() => setMigrationDismissed(true)} />}
      {toast && <div className="toast"><Check size={16} /> {toast}</div>}
    </div>
  )
}

function AuthScreen({ mode, setMode, email, setEmail, password, setPassword, busy, message, error, onSubmit, resendEmail, resendBusy, onResend }: { mode: 'sign-in' | 'sign-up' | 'reset'; setMode: (mode: 'sign-in' | 'sign-up' | 'reset') => void; email: string; setEmail: (value: string) => void; password: string; setPassword: (value: string) => void; busy: boolean; message: string; error: string; onSubmit: (event: React.FormEvent) => void; resendEmail: string; resendBusy: boolean; onResend: () => void }) {
  const reset = mode === 'reset'
  const signUp = mode === 'sign-up'
  return <div className="auth-shell"><div className="auth-card"><div className="brand auth-brand"><div className="brand-mark"><Rocket size={20} /></div><div><strong>apexFlite</strong><span>flight intelligence</span></div></div><p className="eyebrow">SECURE TEAM WORKSPACE</p><h1>{reset ? 'Reset your password' : signUp ? 'Create your account' : 'Welcome back'}</h1><p className="auth-copy">{reset ? 'We will send a secure link to your email address.' : 'Sign in to sync your launch history across every device.'}</p><form className="auth-form" onSubmit={onSubmit}><label>Email address<input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" /></label>{!reset && <label>Password<input type="password" autoComplete={signUp ? 'new-password' : 'current-password'} required minLength={6} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 6 characters" /></label>}{(message || error) && <p className={error ? 'auth-feedback error' : 'auth-feedback'}>{error || message}</p>}<button type="submit" className="primary-button auth-submit" disabled={busy}>{busy ? 'Working…' : reset ? 'Send reset link' : signUp ? 'Create account' : 'Sign in'}</button></form>{resendEmail && !reset && <button type="button" className="secondary-button auth-resend" onClick={onResend} disabled={resendBusy}>{resendBusy ? 'Sending…' : 'Resend verification email'}</button>}<div className="auth-links">{reset ? <button onClick={() => setMode('sign-in')}>Back to sign in</button> : <><button onClick={() => setMode(signUp ? 'sign-in' : 'sign-up')}>{signUp ? 'Already have an account? Sign in' : 'Create an account'}</button>{!signUp && <button onClick={() => setMode('reset')}>Forgot password?</button>}</>}</div><small className="auth-note">Your launch data is private to your authenticated account.</small></div></div>
}

function MigrationDialog({ count, busy, onImport, onDismiss }: { count: number; busy: boolean; onImport: () => void | Promise<void>; onDismiss: () => void }) {
  return <div className="modal-backdrop migration-backdrop"><div className="migration-dialog"><div className="migration-icon"><ArrowUpRight size={20} /></div><p className="eyebrow">FIRST CLOUD SIGN-IN</p><h2>Transfer your local flights?</h2><p>We found <strong>{count} {count === 1 ? 'flight' : 'flights'}</strong> saved in this browser. Transfer them to your online workspace so they are available on every signed-in device.</p><ul><li>Existing cloud flights will not be duplicated.</li><li>Your local backup stays in this browser.</li></ul><div className="migration-actions"><button className="secondary-button" onClick={onDismiss} disabled={busy}>Not now</button><button className="primary-button" onClick={onImport} disabled={busy}>{busy ? 'Transferring…' : 'Transfer to cloud'}</button></div></div></div>
}

function StatCard({ label, value, unit, note, trend, icon }: { label: string; value: string; unit?: string; note: string; trend: 'up' | 'down'; icon: React.ReactNode }) { return <article className="stat-card"><div className="stat-top"><span>{label}</span><div className="stat-icon">{icon}</div></div><div className="stat-value">{value} <small>{unit}</small></div><div className={`stat-note ${trend}`}><span>{trend === 'up' ? 'UP' : 'DOWN'}</span> {note}</div></article> } /*
񟿿
*/
function MoreDots() { return <span className="more-dots">...</span> }

// CLEANED


function AnalysisCard({ title, subtitle, icon, accent, model, recommendation, chart }: { title: string; subtitle: string; icon: React.ReactNode; accent: string; model: ReturnType<typeof linearRegression>; recommendation: number | null; chart: React.ReactNode }) { const rec = recommendation && recommendation > 0 ? `${formatRecommendationMass(recommendation)} g` : 'Collect more data'; const slope = model?.coefficients[0]; return <article className={`analysis-card ${accent}`}><div className="card-heading"><div><div className="card-title"><span className="analysis-icon">{icon}</span><h2>{title}</h2></div><p>{subtitle}</p></div><button className="more-button"><MoreDots /></button></div><div className="altitude-chart-content">{model ? chart : <div className="empty-chart"><Sparkles size={25} /><b>Keep logging flights</b><span>We need more varied launches to build this model.</span></div>}</div><div className="model-footer"><div><span className="footer-label">MASS RECOMMENDATION</span><strong>{rec}</strong></div><div className="model-stat"><span>SLOPE</span><b>{slope !== undefined ? `${slope >= 0 ? '+' : '−'}${equationNumber(slope)} ft/g` : '—'}</b></div><div className="model-stat"><span>R² FIT</span><b>{model ? `${formatNumber(model.r2 * 100)}%` : '—'}</b></div><div className="model-stat"><span>TRAIN MAE</span><b>{model ? `${formatNumber(model.mae)} ft` : '—'}</b></div><div className="model-stat"><span>FLIGHTS</span><b>{model?.sampleSize ?? 0}</b></div></div></article> }

function RawChart({ data, target, units }: { data: Array<Launch & { mass: number; fitted: number }>; target: number; units: Units }) {
  return <AltitudeChart data={data} target={target} units={units} />
}
function AdjustedChart({ data, target, units }: { data: Array<Launch & { mass: number; adjusted: number; fitted: number }>; target: number; units: Units }) {
  return <AltitudeChart data={data} target={target} units={units} adjusted />
}
function AltitudeChart({ data, target, units, adjusted = false }: { data: Array<Launch & { mass: number; adjusted?: number; fitted: number }>; target: number; units: Units; adjusted?: boolean }) {
  const [zoom, setZoom] = useState<[number, number] | null>(null)
  const bounds: [number, number] = data.length ? [data[0].mass, data[data.length - 1].mass] : [0, 0]
  const range = clampMassRange(zoom, bounds)
  const visible = data.filter(point => point.mass >= range[0] && point.mass <= range[1])
  const color = adjusted ? '#7758d8' : '#3478f6'
  const altitudeUnit = units === 'metric' ? 'm' : 'ft'
  return <><div className="chart-wrap"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={data} margin={{ top: 14, right: 18, bottom: 10, left: 0 }}><CartesianGrid vertical={false} stroke="var(--color-border)" /><XAxis dataKey="mass" type="number" domain={range[0] === range[1] ? [range[0] - 1, range[1] + 1] : range} allowDataOverflow tickLine={false} axisLine={false} tick={{ fill: 'var(--color-text-muted)', fontSize: 11 }} tickFormatter={value => formatNumber(Number(value), 1) + 'g'} /><YAxis domain={['auto', 'auto']} tickLine={false} axisLine={false} tick={{ fill: 'var(--color-text-muted)', fontSize: 11 }} tickFormatter={value => formatNumber(units === 'metric' ? ftToM(Number(value)) : Number(value)) + ' ' + altitudeUnit} width={65} /><Tooltip content={<ChartTooltip adjusted={adjusted} units={units} />} /><ReferenceLine y={target} stroke="var(--color-text-muted)" strokeDasharray="4 4" label={{ value: 'Target', fill: 'var(--color-text-muted)', fontSize: 11, position: 'insideTopRight' }} /><Scatter name="Flights" dataKey={adjusted ? 'adjusted' : 'altitude'} fill={color} isAnimationActive={false} /><Line name="Original fit" dataKey="fitted" type="linear" stroke={color} strokeWidth={2.5} dot={false} activeDot={false} isAnimationActive={false} /></ComposedChart></ResponsiveContainer></div><MassRangeControl bounds={bounds} value={range} onChange={setZoom} count={visible.length} total={data.length} /></>
}

function ImpactField({ label, confidence, weight, children }: { label: string; confidence?: number; weight?: number; children: React.ReactNode }) {
  return <label className="impact-field"><span>{label}</span>{children}<small>{confidence === undefined ? 'Impact confidence: learning' : `Impact confidence: ${confidence}%`}</small><small className="variable-weight">{weight === undefined ? 'Variable weight: learning' : `Variable weight: ${weight}%`}</small></label>
}

function AltitudePredictorWithConfidence({ units, model, fallbackModel, weather, setWeather, optimalMass, predictedAltitude, observedMasses, confidence, weights }: { units: Units; model: ReturnType<typeof adjustedRegression>; fallbackModel: ReturnType<typeof linearRegression>; targetAltitude: number; weather: WeatherReference; setWeather: React.Dispatch<React.SetStateAction<WeatherReference>>; optimalMass: number | null; predictedAltitude: number | null; observedMasses: number[]; confidence: number[]; weights: number[] }) {
  const update = (field: keyof WeatherReference, value: number) => setWeather((current) => ({ ...current, [field]: value }))
  const minObserved = observedMasses.length ? Math.min(...observedMasses) : 0
  const maxObserved = observedMasses.length ? Math.max(...observedMasses) : 0
  const outsideRange = optimalMass !== null && observedMasses.length > 0 && (optimalMass < minObserved || optimalMass > maxObserved)
  const fields = [
    { label: 'WIND', field: 'wind' as const, value: weather.wind * (units === 'imperial' ? 1 : 1.60934), unit: units === 'imperial' ? 'mph' : 'km/h', confidence: confidence[1], min: 0, step: 0.1, convert: (value: number) => value / (units === 'imperial' ? 1 : 1.60934) },
    { label: 'TEMPERATURE', field: 'temperature' as const, value: units === 'imperial' ? weather.temperature : fahrenheitToCelsius(weather.temperature), unit: units === 'imperial' ? '°F' : '°C', confidence: confidence[4], step: 0.1, convert: (value: number) => units === 'imperial' ? value : celsiusToFahrenheit(value) },
    { label: 'AIR PRESSURE', field: 'pressure' as const, value: units === 'imperial' ? weather.pressure : weather.pressure * 33.8639, unit: units === 'imperial' ? 'inHg' : 'hPa', confidence: confidence[2], min: 0, step: 0.01, convert: (value: number) => units === 'imperial' ? value : value / 33.8639 },
    { label: 'HUMIDITY', field: 'humidity' as const, value: weather.humidity, unit: '%', confidence: confidence[3], min: 0, step: 1, convert: (value: number) => value },
  ]
  const weightByField: Record<string, number | undefined> = { wind: weights[1], temperature: weights[4], pressure: weights[2], humidity: weights[3] }
  const equation = altitudePredictionEquation(model ?? fallbackModel)
  return <section className="mass-simulator"><div className="simulator-heading"><div><p className="eyebrow">FLIGHT CONFIGURATION</p><h2>Rocket mass simulator</h2><p>Weather changes update this result and the weather-aware chart above. The same weather is shared with Experiments.</p></div><div className="simulator-badge">{model ? 'WEATHER MODEL' : fallbackModel ? 'RAW MODEL' : 'NEEDS 3 FLIGHTS'}</div></div><div className="simulator-body"><div className="simulator-inputs">{fields.map((input) => <ImpactField key={input.field} label={input.label} confidence={input.confidence} weight={weightByField[input.field]}><div className="simulator-input"><input aria-label={input.label} type="number" min={input.min} step={input.step} value={input.value} onChange={(event) => update(input.field, input.convert(Number(event.target.value)))} /><span>{input.unit}</span></div></ImpactField>)}</div><div className="simulator-result"><span className="footer-label">OPTIMAL ROCKET MASS</span><strong>{optimalMass !== null && optimalMass > 0 ? `${formatRecommendationMass(optimalMass)} g` : 'Collect more data'}</strong><span>{predictedAltitude !== null ? `Predicted ${formatNumber(predictedAltitude)} ft at target conditions` : model || fallbackModel ? 'Model needs a meaningful mass trend' : 'Log at least 3 flights to simulate'}</span>{equation && <code className="prediction-equation">{equation}</code>}{model && <small>Mass impact confidence: {confidence[0]}%</small>}{model && <small>Mass variable weight: {weights[0]}%</small>}{outsideRange && <small>Recommendation is outside your logged mass range ({formatMass(minObserved)}–{formatMass(maxObserved)} g).</small>}</div></div></section>
}

function DescentPredictorWithConfidence({ units, model, conditions, setConditions, predictedDescent, confidence, weights }: { units: Units; model: ReturnType<typeof descentRegression>; conditions: DescentConditions; setConditions: React.Dispatch<React.SetStateAction<DescentConditions>>; predictedDescent: number | null; confidence: number[]; weights: number[] }) {
  const update = (field: keyof DescentConditions, value: number) => setConditions((current) => ({ ...current, [field]: value }))
  const fields: Array<{ label: string; field: keyof DescentConditions; value: number; unit: string; confidence?: number; weight?: number; min?: number; step?: number; convert?: (value: number) => number }> = [
    { label: 'MASS', field: 'mass', value: conditions.mass, unit: 'g', confidence: confidence[0], min: 1 }, { label: 'ALTITUDE', field: 'altitude', value: conditions.altitude, unit: 'ft', confidence: confidence[1], min: 1 }, { label: 'PARACHUTE', field: 'parachuteSize', value: conditions.parachuteSize, unit: 'in', confidence: confidence[2], min: 1, step: 0.1 }, { label: 'WIND', field: 'wind', value: conditions.wind * (units === 'imperial' ? 1 : 1.60934), unit: units === 'imperial' ? 'mph' : 'km/h', confidence: confidence[3], min: 0, step: 0.1, convert: (value) => value / (units === 'imperial' ? 1 : 1.60934) }, { label: 'TEMPERATURE', field: 'temperature', value: units === 'imperial' ? conditions.temperature : fahrenheitToCelsius(conditions.temperature), unit: units === 'imperial' ? '°F' : '°C', confidence: confidence[6], step: 0.1, convert: (value) => units === 'imperial' ? value : celsiusToFahrenheit(value) }, { label: 'AIR PRESSURE', field: 'pressure', value: units === 'imperial' ? conditions.pressure : conditions.pressure * 33.8639, unit: units === 'imperial' ? 'inHg' : 'hPa', confidence: confidence[4], min: 0, step: 0.01, convert: (value) => units === 'imperial' ? value : value / 33.8639 }, { label: 'HUMIDITY', field: 'humidity', value: conditions.humidity, unit: '%', confidence: confidence[5], min: 0, step: 1 },
  ]
  const weightByField: Record<string, number | undefined> = { mass: weights[0], altitude: weights[1], parachuteSize: weights[2], wind: weights[3], temperature: weights[6], pressure: weights[4], humidity: weights[5] }
  const equation = descentPredictionEquation(model)
  return <section className="mass-simulator descent-simulator"><div className="simulator-heading"><div><p className="eyebrow">DESCENT CONFIGURATION</p><h2>Descent time predictor</h2><p>Predict descent time before launch from configuration and weather. The model retrains as flights are added.</p></div><div className="simulator-badge">{model ? `${model.sampleSize} FLIGHT MODEL` : 'NEEDS 4 FLIGHTS'}</div></div><div className="simulator-body"><div className="simulator-inputs descent-inputs">{fields.map((input) => <ImpactField key={input.field} label={input.label} confidence={input.confidence} weight={weightByField[input.field]}><div className="simulator-input"><input aria-label={input.label} type="number" min={input.min} step={input.step ?? 1} value={input.value} onChange={(event) => { const value = Number(event.target.value); update(input.field, input.convert ? input.convert(value) : value) }} /><span>{input.unit}</span></div></ImpactField>)}</div><div className="simulator-result"><span className="footer-label">PREDICTED DESCENT TIME</span><strong>{predictedDescent !== null ? `${formatNumber(predictedDescent, 1)} sec` : 'Collect more data'}</strong><span>{model ? `Training mean absolute error: ${formatNumber(model.mae, 1)} sec` : 'Log 4 complete flights to activate predictions'}</span>{equation && <code className="prediction-equation">{equation}</code>}</div></div></section>
}
function ChartTooltip({ active, payload, adjusted, units = 'imperial' }: { active?: boolean; payload?: Array<{ payload: Launch & { mass: number; adjusted?: number } }>; adjusted?: boolean; units?: Units }) { if (!active || !payload?.length) return null; const point = payload[0].payload; return <div className="chart-tooltip"><b>{point.date}</b><span>{formatMass(point.mass)} g · {formatNumber(adjusted ? point.adjusted ?? point.altitude : point.altitude)} ft</span><small>{formatNumber(point.windSpeed, 1)} mph wind · {formatTemperature(point.temperature, units)}</small></div> }

function FlightTable({ launches, targetAltitude, displayAltitude, displayMass, displayWind, displayTemperature, onDelete, onEdit }: { launches: Launch[]; targetAltitude: number; displayAltitude: (v: number) => string; displayMass: (v: number) => string; displayWind: (v: number) => string; displayTemperature: (v: number) => string; onDelete: (id: string) => void; onEdit: (launch: Launch) => void }) { return <div className="table-card"><div className="flight-table table-header"><span>DATE</span><span>ALTITUDE</span><span>TARC SCORE</span><span>TOTAL MASS</span><span>WIND</span><span>TEMP</span><span>DESCENT</span><span>STATUS</span><span /></div>{launches.map((launch) => { const score = tarcScore(launch.altitude, launch.descentTime, targetAltitude); const near = Math.abs(launch.altitude - targetAltitude) < 20; return <div className="flight-table" key={launch.id}><span className="date-cell"><b>{new Date(`${launch.date}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: '2-digit' })}</b><small>{launch.id.replace('flight-', 'Flight ')}</small></span><strong>{displayAltitude(launch.altitude)}</strong><span className={score ? 'tarc-score' : 'tarc-score zero'} title={`TARC score: ${score} pts (altitude + 4× descent deviation)`}>{score} pts</span><span>{displayMass(totalMass(launch))}</span><span className="wind-cell"><Wind size={14} /> {displayWind(launch.windSpeed)}</span><span>{displayTemperature(launch.temperature)}</span><span>{formatNumber(launch.descentTime, 1)} sec</span><span className={`status ${near ? 'on-target' : 'review'}`}><i /> {near ? 'On target' : 'Review'}</span><span className="row-actions"><button className="edit-button" onClick={() => onEdit(launch)} aria-label={`Edit ${launch.id}`}><Pencil size={14} /></button><button className="delete-button" onClick={() => onDelete(launch.id)} aria-label={`Delete ${launch.id}`}><Trash2 size={15} /></button></span></div>})}</div> }

function FlightsPanel({ launches, targetAltitude, displayAltitude, displayMass, displayWind, displayTemperature, exportData, importData, onDelete, onEdit, onNew }: { launches: Launch[]; targetAltitude: number; displayAltitude: (v: number) => string; displayMass: (v: number) => string; displayWind: (v: number) => string; displayTemperature: (v: number) => string; exportData: () => void; importData: () => void; onDelete: (id: string) => void; onEdit: (launch: Launch) => void; onNew: () => void }) { return <><section className="page-heading"><div><p className="eyebrow">FLIGHT LOGBOOK</p><h1>All flights</h1><p className="subtitle">Review, export, and manage your team's launch history.</p></div><div className="heading-actions"><button className="secondary-button" onClick={importData}><Upload size={16} /> Import</button><button className="secondary-button" onClick={exportData}><Download size={16} /> Export</button><button className="primary-button" onClick={onNew}><Plus size={17} /> Log a flight</button></div></section><section className="full-table-section"><div className="section-heading"><div><h2>{launches.length} launches</h2><p>Sorted by most recent</p></div></div><FlightTable launches={[...launches].reverse()} targetAltitude={targetAltitude} displayAltitude={displayAltitude} displayMass={displayMass} displayWind={displayWind} displayTemperature={displayTemperature} onDelete={onDelete} onEdit={onEdit} /></section></> }

const Card = ({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) => <article className="insight-card"><div className="insight-heading">{icon}<div><h2>{title}</h2></div></div>{children}</article>
const DriverList = ({ items, color = '' }: { items: Array<{ label: string; weight: number }>; color?: string }) => <div className="driver-list">{items.map((item) => <div key={item.label}><span>{item.label}</span><i><em className={color} style={{ width: `${item.weight}%` }} /></i><b>{item.weight}%</b></div>)}</div>

function InsightsPanel({ launches, targetAltitude, altitudeModel, descentModel, altitudeWeights, descentWeights, units }: { launches: Launch[]; targetAltitude: number; altitudeModel: ReturnType<typeof adjustedRegression>; descentModel: ReturnType<typeof descentRegression>; altitudeWeights: number[]; descentWeights: number[]; units: Units }) {
  const altitudeLabels = ['Rocket mass', 'Wind', 'Air pressure', 'Humidity', 'Temperature']; const descentLabels = ['Rocket mass', 'Altitude', 'Parachute', 'Wind', 'Air pressure', 'Humidity', 'Temperature']
  const targetHits = launches.filter((launch) => Math.abs(launch.altitude - targetAltitude) <= 20).length; const ordered = [...launches].sort((a, b) => a.date.localeCompare(b.date)); const split = Math.ceil(ordered.length / 2)
  const early = ordered.slice(0, split).reduce((sum, launch) => sum + launch.altitude, 0) / Math.max(1, split); const recent = ordered.slice(split).reduce((sum, launch) => sum + launch.altitude, 0) / Math.max(1, ordered.length - split)
  const drivers = (weights: number[], labels: string[]) => weights.map((weight, index) => ({ label: labels[index], weight })).sort((a, b) => b.weight - a.weight)
  const altitudeDrivers = drivers(altitudeWeights, altitudeLabels); const descentDrivers = drivers(descentWeights, descentLabels)
  const residuals = altitudeModel ? launches.map((launch) => ({ launch, error: launch.altitude - predictAdjustedAltitude(altitudeModel, totalMass(launch), { wind: launch.windSpeed, pressure: launch.airPressure, humidity: launch.humidity, temperature: launch.temperature }) })).sort((a, b) => Math.abs(b.error) - Math.abs(a.error)) : []
  const range = (values: number[]) => values.length ? Math.max(...values) - Math.min(...values) : 0; const readiness = Math.min(100, Math.round(Math.min(launches.length, 12) / 12 * 60 + (altitudeModel?.r2 ?? 0) * 25 + (descentModel?.r2 ?? 0) * 15)); const windRange = range(launches.map((launch) => launch.windSpeed)) * (units === 'imperial' ? 1 : 1.60934)
  return <><section className="page-heading"><div><p className="eyebrow">MODEL INTELLIGENCE</p><h1>Flight insights</h1><p className="subtitle">Patterns, confidence, and the most useful next experiments from your flight log.</p></div></section><section className="stats-grid insight-stats"><StatCard label="TARGET HIT RATE" value={launches.length ? `${Math.round(targetHits / launches.length * 100)}` : '—'} unit={launches.length ? '%' : ''} note={`${targetHits} of ${launches.length} within ±20 ft`} trend={targetHits / Math.max(1, launches.length) >= .5 ? 'up' : 'down'} icon={<Target size={18} />} /><StatCard label="MODEL READINESS" value={`${readiness}`} unit="%" note={launches.length < 12 ? `${12 - launches.length} more flights improve confidence` : 'Strong sample depth'} trend={readiness >= 70 ? 'up' : 'down'} icon={<Gauge size={18} />} /><StatCard label="ALTITUDE TREND" value={ordered.length > 2 ? `${recent - early >= 0 ? '+' : ''}${formatNumber(recent - early)}` : '—'} unit={ordered.length > 2 ? 'ft' : ''} note="Later flights versus earlier flights" trend={Math.abs(recent - targetAltitude) <= Math.abs(early - targetAltitude) ? 'up' : 'down'} icon={<Activity size={18} />} /><StatCard label="TYPICAL ERROR" value={altitudeModel ? `±${formatNumber(altitudeModel.mae)}` : '—'} unit={altitudeModel ? 'ft' : ''} note={altitudeModel ? `${Math.round(altitudeModel.r2 * 100)}% altitude variation explained` : 'Need 4 flights for weather model'} trend={altitudeModel && altitudeModel.mae <= 20 ? 'up' : 'down'} icon={<AlertTriangle size={18} />} /></section><section className="insights-grid"><Card title="Altitude drivers" icon={<Lightbulb size={18} />}>{altitudeModel ? <><p className="insight-copy"><b>{altitudeDrivers[0]?.label}</b> is the largest modeled contributor to altitude in your logged conditions.</p><DriverList items={altitudeDrivers} /><small className="insight-note">Relative influence, not a causal guarantee. Keep predictions within observed ranges.</small></> : <InsightEmpty text="Log 4 flights with conditions to identify altitude drivers." />}</Card><Card title="Descent drivers" icon={<ArrowDownToLine size={18} />}>{descentModel ? <><p className="insight-copy"><b>{descentDrivers[0]?.label}</b> has the strongest current relationship to recovery time.</p><DriverList items={descentDrivers} color="purple-bar" /><small className="insight-note">Typical descent error: ±{formatNumber(descentModel.mae, 1)} sec across {descentModel.sampleSize} flights.</small></> : <InsightEmpty text="Log 4 complete flights to learn recovery-time drivers." />}</Card><Card title="Flights worth reviewing" icon={<AlertTriangle size={18} />}>{residuals.length ? <div className="review-list">{residuals.slice(0, 3).map(({ launch, error }) => <div key={launch.id}><span><b>{new Date(`${launch.date}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</b><small>{formatMass(totalMass(launch))} g · {formatNumber(launch.windSpeed, 1)} mph wind</small></span><strong className={error >= 0 ? 'positive' : 'negative'}>{error >= 0 ? '+' : ''}{formatNumber(error)} ft</strong></div>)}</div> : <InsightEmpty text="The adjusted model will flag unusual flights once it has enough data." />}</Card><Card title="Data coverage" icon={<Database size={18} />}><div className="coverage-grid"><div><span>Mass range</span><b>{formatMass(range(launches.map(totalMass)))} g</b></div><div><span>Wind range</span><b>{formatNumber(windRange, 1)} {units === 'imperial' ? 'mph' : 'km/h'}</b></div><div><span>Temperature span</span><b>{formatNumber(range(launches.map((launch) => units === 'imperial' ? launch.temperature : fahrenheitToCelsius(launch.temperature))), 1)}°</b></div><div><span>Parachute range</span><b>{formatNumber(range(launches.map((launch) => launch.parachuteSize)), 1)} in</b></div></div><small className="insight-note">Vary one input at a time on future launches to make cause-and-effect easier for the models to learn.</small></Card></section></> }

function TarcOverPointsInsight({ launches, targetAltitude }: { launches: Launch[]; targetAltitude: number }) {
  const scores = launches.map((launch) => tarcScore(launch.altitude, launch.descentTime, targetAltitude))
  const nonZeroScores = scores.filter((score) => score > 0)
  const average = nonZeroScores.length ? nonZeroScores.reduce((sum, score) => sum + score, 0) / nonZeroScores.length : 0
  const bestScore = nonZeroScores.length ? Math.min(...nonZeroScores) : null
  const worstScore = nonZeroScores.length ? Math.max(...nonZeroScores) : null
  const flightsWithScores = nonZeroScores.length

  return <section className="insights-grid tarc-insights"><article className="insight-card"><div className="insight-heading"><Target size={18} /><div><h2>TARC scoring</h2></div></div>{launches.length ? <><p className="insight-copy">Your flights average <b>{formatNumber(average, 1)} points</b> across {flightsWithScores} measurable flights (target: {formatNumber(targetAltitude)} ft altitude, 37-40s descent).</p><div className="coverage-grid"><div><span>Best score</span><b>{bestScore !== null ? bestScore : '—'} pts</b></div><div><span>Worst score</span><b>{worstScore !== null ? worstScore : '—'} pts</b></div></div><small className="insight-note">1 point per ft altitude deviation + 4 points per second outside the 37-40s target descent window. Flights with missing descent time show as 0 and are excluded.</small></> : <InsightEmpty text="Log a flight to calculate TARC scores." />}</article></section>
}

function InsightEmpty({ text }: { text: string }) { return <div className="insight-empty"><Sparkles size={22} /><span>{text}</span></div> }

type TimelineMetric = 'altitude' | 'descent' | 'flightTime'
type ConditionMetric = 'wind' | 'temperature' | 'humidity' | 'pressure'

function InsightsLab({ launches, targetAltitude, altitudeModel }: { launches: Launch[]; targetAltitude: number; altitudeModel: ReturnType<typeof adjustedRegression> }) {
  const [timelineMetric, setTimelineMetric] = useState<TimelineMetric>('altitude')
  const [condition, setCondition] = useState<ConditionMetric>('wind')
  const ordered = [...launches].sort((a, b) => a.date.localeCompare(b.date))
  const timeline = ordered.map((launch, index) => ({ ...launch, index: index + 1, moving: movingAverage(ordered.map((flight) => flight.altitude))[index], deviation: launch.altitude - targetAltitude }))
  const raw = linearRegression(launches.map((launch) => ({ x: totalMass(launch), y: launch.altitude })))
  const diagnostics = altitudeModel ? residualDiagnostics(ordered, altitudeModel) : null
  const groups = configurationGroups(launches, targetAltitude); const repeatable = groups.filter((group) => group.count >= 2)[0]
  const suggestion = nextExperiment(launches)
  const reference = { wind: median(launches.map((launch) => launch.windSpeed)), pressure: median(launches.map((launch) => launch.airPressure)), humidity: median(launches.map((launch) => launch.humidity)), temperature: median(launches.map((launch) => launch.temperature)) }
  const coefficientText = (value: number) => `${value >= 0 ? '+' : '−'} ${Math.abs(value).toFixed(4)}`
  const massEquation = altitudeModel ? `mass₈₀₀ = (800 − ${altitudeModel.intercept.toFixed(4)} ${coefficientText(altitudeModel.coefficients[1])}·wind ${coefficientText(altitudeModel.coefficients[2])}·pressure ${coefficientText(altitudeModel.coefficients[3])}·humidity ${coefficientText(altitudeModel.coefficients[4])}·temperature) ÷ ${altitudeModel.coefficients[0].toFixed(4)}` : null
  const altitudeEquation = altitudeModel ? `altitude = ${altitudeModel.intercept.toFixed(4)} ${coefficientText(altitudeModel.coefficients[0])}·mass ${coefficientText(altitudeModel.coefficients[1])}·wind ${coefficientText(altitudeModel.coefficients[2])}·pressure ${coefficientText(altitudeModel.coefficients[3])}·humidity ${coefficientText(altitudeModel.coefficients[4])}·temperature` : null
  const mass800 = altitudeModel ? (800 - altitudeModel.intercept - altitudeModel.coefficients[1] * reference.wind - altitudeModel.coefficients[2] * reference.pressure - altitudeModel.coefficients[3] * reference.humidity - altitudeModel.coefficients[4] * reference.temperature) / altitudeModel.coefficients[0] : null
  const conditionMeta: Record<ConditionMetric, { label: string; get: (launch: Launch) => number; unit: string }> = { wind: { label: 'Wind', get: (launch) => launch.windSpeed, unit: 'mph' }, temperature: { label: 'Temperature', get: (launch) => launch.temperature, unit: '°F' }, humidity: { label: 'Humidity', get: (launch) => launch.humidity, unit: '%' }, pressure: { label: 'Air pressure', get: (launch) => launch.airPressure, unit: 'inHg' } }
  const selected = conditionMeta[condition]; const conditionPoints = launches.map((launch) => ({ x: selected.get(launch), y: launch.altitude - targetAltitude, launch })); const trend = simpleTrend(conditionPoints)
  const best = launches.length ? launches.reduce((winner, launch) => launch.altitude > winner.altitude ? launch : winner) : null; const closest = launches.length ? launches.reduce((winner, launch) => Math.abs(launch.altitude - targetAltitude) < Math.abs(winner.altitude - targetAltitude) ? launch : winner) : null
  const latest = ordered.at(-1); const seasonAverage = launches.length ? launches.reduce((sum, launch) => sum + launch.altitude, 0) / launches.length : 0
  const chartValue = (launch: Launch) => timelineMetric === 'altitude' ? launch.altitude : timelineMetric === 'descent' ? launch.descentTime : launch.flightTime
  const chartLabel = timelineMetric === 'altitude' ? 'Altitude (ft)' : timelineMetric === 'descent' ? 'Descent time (sec)' : 'Flight time (sec)'
  return <section className="insights-lab">
    <div className="section-heading"><div><h2>Data science lab</h2><p>Season trends, model diagnostics, and repeatability from your complete flight log.</p></div></div>
    <div className="lab-grid lab-wide"><article className="lab-card"><div className="lab-heading"><div><h3>Season performance timeline</h3><p>{chartLabel} across logged launch dates.</p></div><div className="segmented">{(['altitude', 'descent', 'flightTime'] as TimelineMetric[]).map((metric) => <button key={metric} className={timelineMetric === metric ? 'selected' : ''} onClick={() => setTimelineMetric(metric)}>{metric === 'flightTime' ? 'Flight' : metric}</button>)}</div></div><div className="lab-chart"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={timeline} margin={{ top: 16, right: 16, bottom: 0, left: -18 }}><CartesianGrid vertical={false} stroke="#e9edf3" /><XAxis dataKey="date" tickLine={false} axisLine={false} tick={{ fill: '#8791a4', fontSize: 10 }} tickFormatter={(value) => String(value).slice(5)} /><YAxis tickLine={false} axisLine={false} tick={{ fill: '#8791a4', fontSize: 10 }} /><Tooltip /><ReferenceLine y={timelineMetric === 'altitude' ? targetAltitude : undefined} stroke="#9da7b8" strokeDasharray="4 4" /><Line dataKey={(row) => chartValue(row)} name={chartLabel} stroke="#3478f6" strokeWidth={2.5} dot={{ r: 3 }} /><Line hide={timelineMetric !== 'altitude'} dataKey="moving" name="3-flight average" stroke="#7758d8" strokeWidth={2} dot={false} /></ComposedChart></ResponsiveContainer></div><div className="season-highlights"><span><b>Best</b>{best ? `${formatNumber(best.altitude)} ft` : '—'}</span><span><b>Closest</b>{closest ? `${formatNumber(closest.altitude)} ft` : '—'}</span><span><b>Latest vs avg.</b>{latest ? `${latest.altitude - seasonAverage >= 0 ? '+' : ''}${formatNumber(latest.altitude - seasonAverage)} ft` : '—'}</span></div></article>
      <article className="lab-card"><div className="lab-heading"><div><h3>Model diagnostics</h3><p>Does weather compensation improve your altitude fit?</p></div></div>{altitudeModel && raw ? <div className="diagnostic-grid"><div><span>Raw MAE</span><b>{formatNumber(raw.mae)} ft</b></div><div><span>Adjusted MAE</span><b>{formatNumber(altitudeModel.mae)} ft</b></div><div><span>Error change</span><b className={altitudeModel.mae <= raw.mae ? 'positive' : 'negative'}>{formatNumber((raw.mae - altitudeModel.mae) / Math.max(raw.mae, 1) * 100)}%</b></div><div><span>Fit change</span><b>{formatNumber((altitudeModel.r2 - raw.r2) * 100)} pts</b></div>{diagnostics && <><div><span>Signed error</span><b>{formatNumber(diagnostics.mean, 1)} ft</b></div><div><span>Within ±MAE</span><b>{formatNumber(diagnostics.rows.filter((row) => Math.abs(row.residual) <= altitudeModel.mae).length / diagnostics.rows.length * 100)}%</b></div></>}</div> : <InsightEmpty text="Log 4 varied flights to compare the raw and weather-adjusted models." />}<small className="insight-note">Fit is observational: it describes the history you logged, not a guarantee for a future launch.</small></article></div>
    <div className="lab-grid"><article className="lab-card"><div className="lab-heading"><div><h3>Consistency control chart</h3><p>Residuals outside the bands deserve a closer look.</p></div></div>{diagnostics ? <><div className="lab-chart compact"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={diagnostics.rows.map((row, index) => ({ ...row, index: index + 1, upper: diagnostics.upperControl, lower: diagnostics.lowerControl, mean: diagnostics.mean }))} margin={{ top: 16, right: 8, bottom: 0, left: -18 }}><CartesianGrid vertical={false} stroke="#e9edf3" /><XAxis dataKey="index" tickLine={false} axisLine={false} /><YAxis tickLine={false} axisLine={false} tickFormatter={(value) => `${value} ft`} /><Tooltip formatter={(value) => `${formatNumber(Number(value), 1)} ft`} /><ReferenceLine y={0} stroke="#9da7b8" /><Line dataKey="upper" stroke="#dc8d63" strokeDasharray="4 4" dot={false} /><Line dataKey="lower" stroke="#dc8d63" strokeDasharray="4 4" dot={false} /><Scatter dataKey="residual" fill="#3478f6" /></ComposedChart></ResponsiveContainer></div><small className="insight-note">{diagnostics.rows.filter((row) => row.review).length} flight(s) outside ±2σ control bands.</small></> : <InsightEmpty text="Weather-adjusted residuals appear after the altitude model has four flights." />}</article>
      <article className="lab-card"><div className="lab-heading"><div><h3>Repeatability explorer</h3><p>Matched mass and parachute configurations.</p></div></div>{groups.length ? <><div className="repeatability-list">{groups.slice(0, 4).map((group) => <div key={group.label}><span><b>{group.label}</b><small>{group.count} flight{group.count === 1 ? '' : 's'} · {formatNumber(group.averageAltitude)} ft avg.</small></span><strong>{group.count > 1 ? `±${formatNumber(group.altitudeSpread)} ft` : '1 sample'}</strong></div>)}</div><small className="insight-note">{repeatable ? `${repeatable.label} is currently the most repeatable multi-flight setup.` : 'Repeat a configuration at least once to measure consistency.'}</small></> : <InsightEmpty text="Log flights to compare recurring configurations." />}</article>
      <article className="lab-card"><div className="lab-heading"><div><h3>Condition trend explorer</h3><p>Altitude deviation versus a selected condition.</p></div><select value={condition} onChange={(event) => setCondition(event.target.value as ConditionMetric)}>{Object.entries(conditionMeta).map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}</select></div><div className="lab-chart compact"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={conditionPoints} margin={{ top: 16, right: 8, bottom: 0, left: -18 }}><CartesianGrid vertical={false} stroke="#e9edf3" /><XAxis dataKey="x" type="number" tickLine={false} axisLine={false} tick={{ fill: '#8791a4', fontSize: 10 }} unit={selected.unit} /><YAxis dataKey="y" tickLine={false} axisLine={false} tickFormatter={(value) => `${value} ft`} /><Tooltip formatter={(value) => `${formatNumber(Number(value), 1)} ft`} /><ReferenceLine y={0} stroke="#9da7b8" /><Scatter dataKey="y" fill="#7758d8" /></ComposedChart></ResponsiveContainer></div><small className="insight-note">{trend ? `${selected.label} trend: ${trend.slope >= 0 ? '+' : ''}${formatNumber(trend.slope, 1)} ft per ${selected.unit} (R² ${formatNumber(trend.r2 * 100)}%).` : `Need three distinct ${selected.label.toLowerCase()} values for a trendline.`}</small></article>
      <article className="lab-card experiment-card"><div className="lab-heading"><div><h3>Next experiment</h3><p>One data-collection test to broaden coverage.</p></div></div>{suggestion ? <div className="experiment-copy"><Lightbulb size={23} /><div><b>Try a {suggestion.direction} {suggestion.field} setting near {formatNumber(suggestion.value, 1)}.</b><p>Your logged {suggestion.field} range is {formatNumber(suggestion.observedMin, 1)}–{formatNumber(suggestion.observedMax, 1)}, the narrowest tracked input range. Hold other conditions as steady as practical.</p></div></div> : <InsightEmpty text="Log at least four flights before generating an experiment suggestion." />}</article></div>
    <article className="lab-card equation-card"><div className="lab-heading"><div><h3>Rocket mass equations</h3><p>Coefficients learned from your log, evaluated at median logged weather.</p></div></div>{massEquation ? <><div className="equation-block"><span>Mass required for 800 ft</span><code>{massEquation}</code><b>≈ {formatNumber(mass800 ?? 0, 2)} g</b></div><div className="equation-block"><span>Adjusted altitude equation</span><code>{altitudeEquation}</code></div><small className="insight-note">The 800 ft result uses median wind, pressure, humidity, and temperature from your log. Use the simulator for another weather scenario.</small></> : <InsightEmpty text="Log at least four flights to generate a mass equation." />}</article>
  </section>
}

function SettingsPanel({ units, setUnits, targetAltitude, setTargetAltitude, theme, setTheme }: { units: Units; setUnits: (u: Units) => void; targetAltitude: number; setTargetAltitude: (n: number) => void; theme: 'light' | 'dark'; setTheme: (t: 'light' | 'dark') => void }) { return <><section className="page-heading"><div><p className="eyebrow">WORKSPACE PREFERENCES</p><h1>Settings</h1><p className="subtitle">Tune your display and prediction defaults.</p></div></section><section className="settings-grid"><div className="settings-card"><div className="settings-card-heading"><div className="settings-big-icon"><Target size={20} /></div><div><h2>Target altitude</h2><p>Used for recommendations and chart reference lines.</p></div></div><label>DEFAULT TARGET <div className="input-with-unit"><input type="number" min="1" value={targetAltitude} onChange={(event) => setTargetAltitude(Number(event.target.value))} /><span>ft</span></div></label><p className="field-help">You can change the target any time without changing historical flight data.</p></div><div className="settings-card"><div className="settings-card-heading"><div className="settings-big-icon purple"><Settings2 size={20} /></div><div><h2>Display units</h2><p>Choose how measurements appear throughout the app.</p></div></div><div className="unit-options"><button className={units === 'imperial' ? 'selected' : ''} onClick={() => setUnits('imperial')}><b>Imperial</b><span>ft · g · mph · inHg</span>{units === 'imperial' && <Check size={16} />}</button><button className={units === 'metric' ? 'selected' : ''} onClick={() => setUnits('metric')}><b>Metric</b><span>m · g · km/h · hPa</span>{units === 'metric' && <Check size={16} />}</button></div><p className="field-help">Your preference is saved automatically.</p></div><div className="settings-card"><div className="settings-card-heading"><div className="settings-big-icon"><Sun size={20} /></div><div><h2>Theme</h2><p>Choose your preferred color scheme.</p></div></div><div className="unit-options"><button className={theme === 'light' ? 'selected' : ''} onClick={() => setTheme('light')}><b>Light</b><span>Bright and clean</span>{theme === 'light' && <Check size={16} />}</button><button className={theme === 'dark' ? 'selected' : ''} onClick={() => setTheme('dark')}><b>Dark</b><span>Easy on the eyes</span>{theme === 'dark' && <Check size={16} />}</button></div><p className="field-help">Your theme preference is saved automatically.</p></div></section></> }

function LaunchModal({ form, setForm, onClose, onSubmit, units, updateForm, editing, rocketMassInput, setRocketMassInput }: { form: FormValues; setForm: React.Dispatch<React.SetStateAction<FormValues>>; onClose: () => void; onSubmit: (e: React.FormEvent) => void; units: Units; updateForm: (field: keyof FormValues, value: string) => void; editing: boolean; rocketMassInput: string; setRocketMassInput: (value: string) => void }) { const field = (name: keyof FormValues, label: string, unit: string, step = '1', inputValue?: string, onInputChange?: (value: string) => void) => <label className="form-field">{label}<div className="input-with-unit"><input required={name !== 'notes'} type={name === 'date' ? 'date' : name === 'notes' ? 'text' : 'number'} step={step} value={inputValue ?? (typeof form[name] === 'number' ? Number(((form[name] as number) * (units === 'metric' ? ({ altitude: .3048, parachuteSize: 2.54, windSpeed: 1.60934, airPressure: 33.8639 } as Record<string, number>)[name] ?? 1 : 1)).toFixed(3)) : form[name])} onChange={(event) => name === 'date' || name === 'notes' ? setForm((current) => ({ ...current, [name]: event.target.value })) : onInputChange ? onInputChange(event.target.value) : updateForm(name, String(Number(event.target.value) / (units === 'metric' ? ({ altitude: .3048, parachuteSize: 2.54, windSpeed: 1.60934, airPressure: 33.8639 } as Record<string, number>)[name] ?? 1 : 1)))} /><span>{unit}</span></div></label>; const temperatureInputValue = units === 'imperial' ? String(form.temperature) : String(fahrenheitToCelsius(form.temperature)); const updateTemperature = (value: string) => updateForm('temperature', value === '' ? '' : String(units === 'imperial' ? Number(value) : celsiusToFahrenheit(Number(value)))); return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><div className="modal"><div className="modal-heading"><div><p className="eyebrow">{editing ? 'EDIT FLIGHT RECORD' : 'NEW FLIGHT RECORD'}</p><h2>{editing ? 'Edit flight' : 'Log a flight'}</h2><p>Capture the conditions while they are still fresh.</p></div><button className="icon-button" onClick={onClose} aria-label="Close"><X size={19} /></button></div><form onSubmit={onSubmit}><div className="form-section"><h3>Flight performance</h3><div className="form-grid">{field('date', 'Launch date', '', '1')}{field('altitude', 'Peak altitude', units === 'imperial' ? 'ft' : 'm')}{field('flightTime', 'Total flight time', 'sec', '0.1')}{field('descentTime', 'Descent time', 'sec', '0.1')}</div></div><div className="form-section"><h3>Configuration</h3><div className="form-grid">{field('rocketMass', 'Rocket mass (including motor)', 'g', 'any', rocketMassInput, (value) => { setRocketMassInput(value); updateForm('rocketMass', value) })}{field('parachuteSize', 'Parachute size', units === 'imperial' ? 'in' : 'cm')}{field('windSpeed', 'Wind speed', units === 'imperial' ? 'mph' : 'km/h', '0.1')}</div></div><div className="form-section"><h3>Atmospheric conditions</h3><div className="form-grid">{field('airPressure', 'Air pressure', units === 'imperial' ? 'inHg' : 'hPa', '0.01')}{field('humidity', 'Humidity', '%', '1')}{field('temperature', 'Temperature', units === 'imperial' ? '°F' : '°C', '0.1', temperatureInputValue, updateTemperature)}<label className="form-field full-field">Notes <input type="text" placeholder="Anything worth remembering?" value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} /></label></div></div><div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button type="submit" className="primary-button"><Check size={16} /> {editing ? 'Update flight' : 'Save flight'}</button></div></form></div></div> }

export default App
