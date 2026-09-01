import { useEffect, useMemo, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { ArrowDownToLine, ArrowUpRight, BarChart3, Bell, Check, ChevronDown, CloudSun, Database, Download, Gauge, LogOut, Menu, Moon, Pencil, Plus, Rocket, Settings2, Sparkles, Sun, Target, Trash2, Wind, X, Activity, Upload } from 'lucide-react'
import { useTheme } from './useTheme'
import { Area, Brush, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis } from 'recharts'
import { adjustedAltitude, adjustedRegression, linearRegression, median, totalMass, type Launch } from './analytics'
import { CloudConflictError, createLaunch, deleteLaunch, fetchWorkspace, importLaunches, savePreferences, updateLaunch, type CloudLaunchRow } from './cloud'
import { isCloudConfigured, supabase } from './supabase'
import { seedLaunches } from './seed'

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

const normalizeLaunches = (value: unknown): Launch[] => {
  if (!Array.isArray(value)) return seedLaunches
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const stored = item as StoredLaunch
    const rocketMass = Number(stored.rocketMass)
    if (!Number.isFinite(rocketMass)) return []
    const legacyMotorMass = Number(stored.motorMass)
    const storedNotes = typeof stored.notes === 'string' ? stored.notes : ''
    const storedTemperature = Number(stored.temperature)
    const extracted = Number.isFinite(storedTemperature) ? null : extractTemperature(storedNotes)
    const canonical = Object.fromEntries(Object.entries(stored).filter(([key]) => key !== 'motorMass'))
    return [{ ...canonical, rocketMass: rocketMass + (Number.isFinite(legacyMotorMass) ? legacyMotorMass : 0), temperature: Number.isFinite(storedTemperature) ? storedTemperature : extracted?.temperature ?? DEFAULT_TEMPERATURE, notes: extracted?.notes ?? storedNotes } as unknown as Launch]
  })
}

const formatNumber = (value: number, digits = 0) => new Intl.NumberFormat('en-US', { maximumFractionDigits: digits }).format(value)
const formatMass = (grams: number) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 20 }).format(grams)
const formatRecommendationMass = (grams: number) => new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(grams)
const formatTemperature = (fahrenheit: number, units: Units) => units === 'imperial' ? `${formatNumber(fahrenheit, 1)} °F` : `${formatNumber(fahrenheitToCelsius(fahrenheit), 1)} °C`

const ftToM = (value: number) => value / 3.28084
const mphToKmh = (value: number) => value * 1.60934

function App() {
  const { theme, setTheme } = useTheme()
  const [launches, setLaunches] = useState<Launch[]>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')
      return Array.isArray(stored) && stored.length > 0 ? normalizeLaunches(stored) : []
    } catch { return [] }
  })
  const [massRange, setMassRange] = useState({ startIndex: 0, endIndex: 0 })
  const [units, setUnits] = useState<Units>(() => {
    try { return (localStorage.getItem(PREF_KEY) as Units) ?? 'imperial' } catch { return 'imperial' }
  })
  const [targetAltitude, setTargetAltitude] = useState(800)
  const [massWindow, setMassWindow] = useState<[number, number] | null>(null)
  const [dateWindow, setDateWindow] = useState<[number, number] | null>(null)
  const [form, setForm] = useState<FormValues>(emptyForm)
  const [rocketMassInput, setRocketMassInput] = useState(String(emptyForm.rocketMass))
  const [showForm, setShowForm] = useState(false)
  const [editingLaunchId, setEditingLaunchId] = useState<string | null>(null)
  const [activeSection, setActiveSection] = useState<'overview' | 'flights' | 'settings'>('overview')
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
      // If not signed in and no local launches, show seed launches for preview
      if (!data.session && launches.length === 0) {
        setLaunches(seedLaunches)
      }
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

  const graphBounds = useMemo(() => {
    const masses = launches.map(totalMass)
    const dates = launches.map((launch) => new Date(`${launch.date}T12:00:00`).getTime())
    return { minMass: Math.min(...masses, 0), maxMass: Math.max(...masses, 1000), minDate: Math.min(...dates, 0), maxDate: Math.max(...dates, 1) }
  }, [launches])
  const selectedMassWindow = massWindow ?? [graphBounds.minMass, graphBounds.maxMass]
  const selectedDateWindow = dateWindow ?? [graphBounds.minDate, graphBounds.maxDate]
  const graphLaunches = useMemo(() => launches.filter((launch) => { const mass = totalMass(launch); const date = new Date(`${launch.date}T12:00:00`).getTime(); return mass >= selectedMassWindow[0] && mass <= selectedMassWindow[1] && date >= selectedDateWindow[0] && date <= selectedDateWindow[1] }), [launches, selectedMassWindow, selectedDateWindow])
  const rawModel = useMemo(() => linearRegression(graphLaunches.map((launch) => ({ x: totalMass(launch), y: launch.altitude }))), [graphLaunches])
  const adjustedModel = useMemo(() => adjustedRegression(graphLaunches), [graphLaunches])
  const reference = useMemo(() => ({ wind: median(launches.map((launch) => launch.windSpeed)), pressure: median(launches.map((launch) => launch.airPressure)), humidity: median(launches.map((launch) => launch.humidity)) }), [launches])
  const rawRecommendation = rawModel && Math.abs(rawModel.coefficients[0]) > 0.01 ? (targetAltitude - rawModel.intercept) / rawModel.coefficients[0] : null
  const adjustedRecommendation = adjustedModel && Math.abs(adjustedModel.coefficients[0]) > 0.01 ? (targetAltitude - adjustedModel.intercept - adjustedModel.coefficients[1] * reference.wind - adjustedModel.coefficients[2] * reference.pressure - adjustedModel.coefficients[3] * reference.humidity) / adjustedModel.coefficients[0] : null
  const rawChart = useMemo(() => graphLaunches.map((launch) => ({ ...launch, mass: totalMass(launch), fitted: rawModel ? rawModel.intercept + rawModel.coefficients[0] * totalMass(launch) : 0 })).sort((a, b) => a.mass - b.mass), [graphLaunches, rawModel])
  const adjustedChart = useMemo(() => graphLaunches.map((launch) => ({ ...launch, mass: totalMass(launch), adjusted: adjustedModel ? adjustedAltitude(launch, adjustedModel, reference) : launch.altitude, fitted: adjustedModel ? adjustedModel.intercept + adjustedModel.coefficients[0] * totalMass(launch) + adjustedModel.coefficients[1] * reference.wind + adjustedModel.coefficients[2] * reference.pressure + adjustedModel.coefficients[3] * reference.humidity : 0 })).sort((a, b) => a.mass - b.mass), [graphLaunches, adjustedModel, reference])
  const avgAltitude = launches.length ? launches.reduce((sum, launch) => sum + launch.altitude, 0) / launches.length : 0
  const avgDescent = launches.length ? launches.reduce((sum, launch) => sum + launch.descentTime, 0) / launches.length : 0
  const targetGap = avgAltitude - targetAltitude
  const closeModal = () => { setForm(emptyForm); setRocketMassInput(String(emptyForm.rocketMass)); setEditingLaunchId(null); setShowForm(false) }
  const onSaveLaunch = async (event: React.FormEvent) => {
    event.preventDefault()
    const launch: Launch = { ...form, id: editingLaunchId ?? `flight-${Date.now()}` }
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
          const imported = normalizeLaunches(records)
          if (imported.length === 0) throw new Error('No valid flight records found')
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
  const syncStatus = cloudLoading ? 'Syncing…' : session ? 'Synced online' : 'Local preview mode'

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileNav ? 'mobile-open' : ''}`}>
        <div className="brand"><div className="brand-mark"><Rocket size={20} /></div><div><strong>apexFlite</strong><span>flight intelligence</span></div></div>
        <div className="workspace-switcher"><div className="workspace-icon">T</div><div><b>TARC Rocketry</b><span>{session ? 'Cloud workspace' : 'Local preview'}</span></div><ChevronDown size={16} /></div>
        <nav><button className={activeSection === 'overview' ? 'active' : ''} onClick={() => { setActiveSection('overview'); setMobileNav(false) }}><BarChart3 size={18} /> Overview</button><button className={activeSection === 'flights' ? 'active' : ''} onClick={() => { setActiveSection('flights'); setMobileNav(false) }}><Database size={18} /> Flights <em>{launches.length}</em></button><button onClick={() => setToast('Team insights are coming soon')}><Sparkles size={18} /> Insights <span className="new-pill">NEW</span></button></nav>
        <div className="sidebar-bottom"><button className={activeSection === 'settings' ? 'active' : ''} onClick={() => { setActiveSection('settings'); setMobileNav(false) }}><Settings2 size={18} /> Settings</button><div className="profile"><div className="avatar">{session ? (session.user.email?.slice(0, 2).toUpperCase() ?? 'RT') : 'LP'}</div><div><b>{session?.user.email ?? 'Local preview'}</b><span>{session ? 'Synced team access' : 'Cloud not configured'}</span></div>{session ? <button className="profile-menu" onClick={signOut} aria-label="Sign out"><LogOut size={14} /></button> : <MoreDots />}</div></div>
      </aside>
      {mobileNav && <button className="sidebar-scrim" onClick={() => setMobileNav(false)} aria-label="Close navigation" />}
      <main className="main-content">
        <header className="topbar"><button className="icon-button mobile-menu" onClick={() => setMobileNav(true)} aria-label="Open navigation"><Menu size={20} /></button><div className="breadcrumbs"><span>Workspace</span><span>/</span><b>{activeSection === 'overview' ? 'Overview' : activeSection === 'flights' ? 'Flights' : 'Settings'}</b></div><div className="top-actions"><button className="unit-select" onClick={() => changeUnits(units === 'imperial' ? 'metric' : 'imperial')}><span className="unit-dot" /> {units === 'imperial' ? 'Imperial' : 'Metric'} <ChevronDown size={14} /></button><button className="icon-button" onClick={() => setToast(syncStatus)} aria-label="Sync status"><Bell size={16} /></button>{session ? <button className="avatar small" onClick={signOut} aria-label="Sign out">{session.user.email?.slice(0, 2).toUpperCase() ?? 'RT'}</button> : <span className="local-badge">LOCAL</span>}</div></header>
        {cloudError && <div className="cloud-error"><span>{cloudError}</span><button onClick={() => setCloudError('')} aria-label="Dismiss cloud error"><X size={15} /></button></div>}
        {session && <div className={`sync-banner ${cloudLoading ? 'syncing' : ''}`}><span className="sync-dot" /> {syncStatus}<span>{session.user.email}</span></div>}
        {activeSection === 'settings' ? <SettingsPanel units={units} setUnits={changeUnits} targetAltitude={targetAltitude} setTargetAltitude={changeTargetAltitude} theme={theme} setTheme={setTheme} /> : activeSection === 'flights' ? <FlightsPanel launches={launches} displayAltitude={displayAltitude} displayMass={displayMass} displayWind={displayWind} displayTemperature={displayTemperature} exportData={exportData} importData={importData} onDelete={removeLaunch} onEdit={editLaunch} onNew={openNewLaunch} /> : <>
        <section className="page-heading"><div><p className="eyebrow">THURSDAY, AUGUST 27, 2026 <span className="live-dot" /> LIVE MODEL</p><h1>Good morning, team.</h1><p className="subtitle">Your flight data is getting smarter with every launch.</p></div><button className="primary-button" onClick={openNewLaunch}><Plus size={17} /> Log a flight</button></section>
        <section className="graph-filters"><div><span>GRAPH FILTERS</span><strong>Explore your launch envelope</strong></div><label>Mass <b>{formatMass(selectedMassWindow[0])}–{formatMass(selectedMassWindow[1])} g</b><input type="range" min={graphBounds.minMass} max={graphBounds.maxMass} value={selectedMassWindow[0]} onChange={(event) => setMassWindow([Math.min(Number(event.target.value), selectedMassWindow[1]), selectedMassWindow[1]])} /><input type="range" min={graphBounds.minMass} max={graphBounds.maxMass} value={selectedMassWindow[1]} onChange={(event) => setMassWindow([selectedMassWindow[0], Math.max(Number(event.target.value), selectedMassWindow[0])])} /></label><label>Launch date <b>{new Date(selectedDateWindow[0]).toLocaleDateString()}–{new Date(selectedDateWindow[1]).toLocaleDateString()}</b><input type="range" min={graphBounds.minDate} max={graphBounds.maxDate} value={selectedDateWindow[0]} onChange={(event) => setDateWindow([Math.min(Number(event.target.value), selectedDateWindow[1]), selectedDateWindow[1]])} /><input type="range" min={graphBounds.minDate} max={graphBounds.maxDate} value={selectedDateWindow[1]} onChange={(event) => setDateWindow([selectedDateWindow[0], Math.max(Number(event.target.value), selectedDateWindow[0])])} /></label><button className="text-button" onClick={() => { setMassWindow(null); setDateWindow(null) }}>Reset</button></section>
        <section className="target-banner"><div className="target-icon"><Target size={20} /></div><div><span>Current target altitude</span><strong>{formatNumber(targetAltitude)} <small>ft</small></strong></div><div className="target-divider" /><div className="target-status"><Check size={15} /> <span>{Math.abs(targetGap) < 15 ? 'On target range' : targetGap > 0 ? 'Running high' : 'Running low'}</span></div><button onClick={() => setActiveSection('settings')}>Edit target <ArrowUpRight size={15} /></button></section>
        <section className="stats-grid"><StatCard label="FLIGHTS LOGGED" value={String(launches.length).padStart(2, '0')} note="+2 this month" trend="up" icon={<Database size={18} />} /><StatCard label="AVG. ALTITUDE" value={formatNumber(avgAltitude)} unit="ft" note={`${targetGap >= 0 ? '+' : ''}${formatNumber(targetGap)} ft vs target`} trend={targetGap >= 0 ? 'up' : 'down'} icon={<ArrowUpRight size={18} />} /><StatCard label="AVG. DESCENT" value={formatNumber(avgDescent, 1)} unit="sec" note="Target: 34.0 sec" trend={Math.abs(avgDescent - 34) < 2 ? 'up' : 'down'} icon={<ArrowDownToLine size={18} />} /><StatCard label="MODEL CONFIDENCE" value={adjustedModel ? formatNumber(adjustedModel.r2 * 100) : '—'} unit={adjustedModel ? '%' : ''} note={adjustedModel ? 'Weather model active' : 'Need 7+ flights'} trend="up" icon={<Gauge size={18} />} /></section>
        <section className="analysis-grid"><AnalysisCard title="Raw altitude model" subtitle="Altitude vs. total mass · no weather compensation" icon={<Activity size={18} />} accent="blue" model={rawModel} recommendation={rawRecommendation} chart={<RawChart data={rawChart} target={targetAltitude} units={units} />} /><AnalysisCard title="Adjusted altitude model" subtitle="Compensated for wind, pressure & humidity" icon={<CloudSun size={18} />} accent="purple" model={adjustedModel} recommendation={adjustedRecommendation} chart={<AdjustedChart data={adjustedChart} target={targetAltitude} units={units} />} /></section>
        <section className="recent-section"><div className="section-heading"><div><h2>Recent flights</h2><p>Latest performance from your team</p></div><button className="text-button" onClick={() => setActiveSection('flights')}>View all <ArrowUpRight size={15} /></button></div><FlightTable launches={launches.slice(-5).reverse()} displayAltitude={displayAltitude} displayMass={displayMass} displayWind={displayWind} displayTemperature={displayTemperature} onDelete={removeLaunch} onEdit={editLaunch} /></section>
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


function AnalysisCard({ title, subtitle, icon, accent, model, recommendation, chart }: { title: string; subtitle: string; icon: React.ReactNode; accent: string; model: ReturnType<typeof linearRegression>; recommendation: number | null; chart: React.ReactNode }) { const rec = recommendation && recommendation > 0 ? `${formatRecommendationMass(recommendation)} g` : 'Collect more data'; return <article className={`analysis-card ${accent}`}><div className="card-heading"><div><div className="card-title"><span className="analysis-icon">{icon}</span><h2>{title}</h2></div><p>{subtitle}</p></div><button className="more-button"><MoreDots /></button></div><div className="chart-wrap">{model ? chart : <div className="empty-chart"><Sparkles size={25} /><b>Keep logging flights</b><span>We need more varied launches to build this model.</span></div>}</div>{model && <p className="chart-zoom-hint">Drag the handles below to zoom into a mass range</p>}<div className="model-footer"><div><span className="footer-label">MASS RECOMMENDATION</span><strong>{rec}</strong></div><div className="model-stat"><span>R² FIT</span><b>{model ? `${formatNumber(model.r2 * 100)}%` : '—'}</b></div><div className="model-stat"><span>MAE</span><b>{model ? `${formatNumber(model.mae)} ft` : '—'}</b></div><div className="model-stat"><span>FLIGHTS</span><b>{model?.sampleSize ?? 0}</b></div></div></article> }

function RawChart({ data, target, units }: { data: Array<Launch & { mass: number; fitted: number }>; target: number; units: Units }) { return <ResponsiveContainer width="100%" height="100%"><ComposedChart data={data} margin={{ top: 14, right: 8, bottom: 0, left: -22 }}><CartesianGrid vertical={false} stroke="#e9edf3" /><XAxis dataKey="mass" type="number" domain={['dataMin - 8', 'dataMax + 8']} tickLine={false} axisLine={false} tick={{ fill: '#8791a4', fontSize: 11 }} tickFormatter={(value) => `${formatMass(Number(value))}g`} /><YAxis domain={['dataMin - 35', 'dataMax + 25']} tickLine={false} axisLine={false} tick={{ fill: '#8791a4', fontSize: 11 }} tickFormatter={(value) => `${value}`} /><Tooltip content={<ChartTooltip units={units} />} /><ReferenceLine y={target} stroke="#9da7b8" strokeDasharray="4 4" label={{ value: 'Target', fill: '#8791a4', fontSize: 11, position: 'insideTopRight' }} /><Scatter name="Flights" dataKey="altitude" fill="#3478f6" /><Line name="Best fit" dataKey="fitted" type="monotone" stroke="#3478f6" strokeWidth={2.5} dot={false} activeDot={false} /><Brush key={data.map((point) => `${point.id}-${point.mass}`).join('|')} dataKey="mass" height={18} stroke="#3478f6" fill="#f2f6ff" travellerWidth={10} startIndex={0} endIndex={data.length - 1} tickFormatter={(value) => `${formatMass(Number(value))}g`} /></ComposedChart></ResponsiveContainer> }
function AdjustedChart({ data, target, units }: { data: Array<Launch & { mass: number; adjusted: number; fitted: number }>; target: number; units: Units }) { return <ResponsiveContainer width="100%" height="100%"><ComposedChart data={data} margin={{ top: 14, right: 8, bottom: 0, left: -22 }}><CartesianGrid vertical={false} stroke="#e9edf3" /><XAxis dataKey="mass" type="number" domain={['dataMin - 8', 'dataMax + 8']} tickLine={false} axisLine={false} tick={{ fill: '#8791a4', fontSize: 11 }} tickFormatter={(value) => `${formatMass(Number(value))}g`} /><YAxis domain={['dataMin - 35', 'dataMax + 25']} tickLine={false} axisLine={false} tick={{ fill: '#8791a4', fontSize: 11 }} tickFormatter={(value) => `${value}`} /><Tooltip content={<ChartTooltip adjusted units={units} />} /><ReferenceLine y={target} stroke="#9da7b8" strokeDasharray="4 4" label={{ value: 'Target', fill: '#8791a4', fontSize: 11, position: 'insideTopRight' }} /><Area name="Adjusted flights" dataKey="adjusted" fill="#f0eaff" stroke="none" fillOpacity={0.9} /><Scatter name="Adjusted flights" dataKey="adjusted" fill="#7758d8" /><Line name="Adjusted fit" dataKey="fitted" type="monotone" stroke="#7758d8" strokeWidth={2.5} dot={false} activeDot={false} /><Brush key={data.map((point) => `${point.id}-${point.mass}`).join('|')} dataKey="mass" height={18} stroke="#7758d8" fill="#f8f6ff" travellerWidth={10} startIndex={0} endIndex={data.length - 1} tickFormatter={(value) => `${formatMass(Number(value))}g`} /></ComposedChart></ResponsiveContainer> }
function ChartTooltip({ active, payload, adjusted, units = 'imperial' }: { active?: boolean; payload?: Array<{ payload: Launch & { mass: number; adjusted?: number } }>; adjusted?: boolean; units?: Units }) { if (!active || !payload?.length) return null; const point = payload[0].payload; return <div className="chart-tooltip"><b>{point.date}</b><span>{formatMass(point.mass)} g · {formatNumber(adjusted ? point.adjusted ?? point.altitude : point.altitude)} ft</span><small>{formatNumber(point.windSpeed, 1)} mph wind · {formatTemperature(point.temperature, units)}</small></div> }

function FlightTable({ launches, displayAltitude, displayMass, displayWind, displayTemperature, onDelete, onEdit }: { launches: Launch[]; displayAltitude: (v: number) => string; displayMass: (v: number) => string; displayWind: (v: number) => string; displayTemperature: (v: number) => string; onDelete: (id: string) => void; onEdit: (launch: Launch) => void }) { return <div className="table-card"><div className="flight-table table-header"><span>DATE</span><span>ALTITUDE</span><span>TOTAL MASS</span><span>WIND</span><span>TEMP</span><span>DESCENT</span><span>STATUS</span><span /></div>{launches.map((launch) => { const near = Math.abs(launch.altitude - 800) < 20; return <div className="flight-table" key={launch.id}><span className="date-cell"><b>{new Date(`${launch.date}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: '2-digit' })}</b><small>{launch.id.replace('flight-', 'Flight ')}</small></span><strong>{displayAltitude(launch.altitude)}</strong><span>{displayMass(totalMass(launch))}</span><span className="wind-cell"><Wind size={14} /> {displayWind(launch.windSpeed)}</span><span>{displayTemperature(launch.temperature)}</span><span>{formatNumber(launch.descentTime, 1)} sec</span><span className={`status ${near ? 'on-target' : 'review'}`}><i /> {near ? 'On target' : 'Review'}</span><span className="row-actions"><button className="edit-button" onClick={() => onEdit(launch)} aria-label={`Edit ${launch.id}`}><Pencil size={14} /></button><button className="delete-button" onClick={() => onDelete(launch.id)} aria-label={`Delete ${launch.id}`}><Trash2 size={15} /></button></span></div>})}</div> }

function FlightsPanel({ launches, displayAltitude, displayMass, displayWind, displayTemperature, exportData, importData, onDelete, onEdit, onNew }: { launches: Launch[]; displayAltitude: (v: number) => string; displayMass: (v: number) => string; displayWind: (v: number) => string; displayTemperature: (v: number) => string; exportData: () => void; importData: () => void; onDelete: (id: string) => void; onEdit: (launch: Launch) => void; onNew: () => void }) { return <><section className="page-heading"><div><p className="eyebrow">FLIGHT LOGBOOK</p><h1>All flights</h1><p className="subtitle">Review, export, and manage your team's launch history.</p></div><div className="heading-actions"><button className="secondary-button" onClick={importData}><Upload size={16} /> Import</button><button className="secondary-button" onClick={exportData}><Download size={16} /> Export</button><button className="primary-button" onClick={onNew}><Plus size={17} /> Log a flight</button></div></section><section className="full-table-section"><div className="section-heading"><div><h2>{launches.length} launches</h2><p>Sorted by most recent</p></div></div><FlightTable launches={[...launches].reverse()} displayAltitude={displayAltitude} displayMass={displayMass} displayWind={displayWind} displayTemperature={displayTemperature} onDelete={onDelete} onEdit={onEdit} /></section></> }

function SettingsPanel({ units, setUnits, targetAltitude, setTargetAltitude, theme, setTheme }: { units: Units; setUnits: (u: Units) => void; targetAltitude: number; setTargetAltitude: (n: number) => void; theme: 'light' | 'dark'; setTheme: (t: 'light' | 'dark') => void }) { return <><section className="page-heading"><div><p className="eyebrow">WORKSPACE PREFERENCES</p><h1>Settings</h1><p className="subtitle">Tune your display and prediction defaults.</p></div></section><section className="settings-grid"><div className="settings-card"><div className="settings-card-heading"><div className="settings-big-icon"><Target size={20} /></div><div><h2>Target altitude</h2><p>Used for recommendations and chart reference lines.</p></div></div><label>DEFAULT TARGET <div className="input-with-unit"><input type="number" min="1" value={targetAltitude} onChange={(event) => setTargetAltitude(Number(event.target.value))} /><span>ft</span></div></label><p className="field-help">You can change the target any time without changing historical flight data.</p></div><div className="settings-card"><div className="settings-card-heading"><div className="settings-big-icon purple"><Settings2 size={20} /></div><div><h2>Display units</h2><p>Choose how measurements appear throughout the app.</p></div></div><div className="unit-options"><button className={units === 'imperial' ? 'selected' : ''} onClick={() => setUnits('imperial')}><b>Imperial</b><span>ft · g · mph · inHg</span>{units === 'imperial' && <Check size={16} />}</button><button className={units === 'metric' ? 'selected' : ''} onClick={() => setUnits('metric')}><b>Metric</b><span>m · g · km/h · hPa</span>{units === 'metric' && <Check size={16} />}</button></div><p className="field-help">Your preference is saved automatically.</p></div><div className="settings-card"><div className="settings-card-heading"><div className="settings-big-icon"><Sun size={20} /></div><div><h2>Theme</h2><p>Choose your preferred color scheme.</p></div></div><div className="unit-options"><button className={theme === 'light' ? 'selected' : ''} onClick={() => setTheme('light')}><b>Light</b><span>Bright and clean</span>{theme === 'light' && <Check size={16} />}</button><button className={theme === 'dark' ? 'selected' : ''} onClick={() => setTheme('dark')}><b>Dark</b><span>Easy on the eyes</span>{theme === 'dark' && <Check size={16} />}</button></div><p className="field-help">Your theme preference is saved automatically.</p></div></section></> }

function LaunchModal({ form, setForm, onClose, onSubmit, units, updateForm, editing, rocketMassInput, setRocketMassInput }: { form: FormValues; setForm: React.Dispatch<React.SetStateAction<FormValues>>; onClose: () => void; onSubmit: (e: React.FormEvent) => void; units: Units; updateForm: (field: keyof FormValues, value: string) => void; editing: boolean; rocketMassInput: string; setRocketMassInput: (value: string) => void }) { const field = (name: keyof FormValues, label: string, unit: string, step = '1', inputValue?: string, onInputChange?: (value: string) => void) => <label className="form-field">{label}<div className="input-with-unit"><input required={name !== 'notes'} type={name === 'date' ? 'date' : name === 'notes' ? 'text' : 'number'} step={step} value={inputValue ?? form[name] as string | number} onChange={(event) => name === 'date' || name === 'notes' ? setForm((current) => ({ ...current, [name]: event.target.value })) : onInputChange ? onInputChange(event.target.value) : updateForm(name, event.target.value)} /><span>{unit}</span></div></label>; const temperatureInputValue = units === 'imperial' ? String(form.temperature) : String(fahrenheitToCelsius(form.temperature)); const updateTemperature = (value: string) => updateForm('temperature', value === '' ? '' : String(units === 'imperial' ? Number(value) : celsiusToFahrenheit(Number(value)))); return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><div className="modal"><div className="modal-heading"><div><p className="eyebrow">{editing ? 'EDIT FLIGHT RECORD' : 'NEW FLIGHT RECORD'}</p><h2>{editing ? 'Edit flight' : 'Log a flight'}</h2><p>Capture the conditions while they are still fresh.</p></div><button className="icon-button" onClick={onClose} aria-label="Close"><X size={19} /></button></div><form onSubmit={onSubmit}><div className="form-section"><h3>Flight performance</h3><div className="form-grid">{field('date', 'Launch date', '', '1')}{field('altitude', 'Peak altitude', units === 'imperial' ? 'ft' : 'm')}{field('flightTime', 'Total flight time', 'sec', '0.1')}{field('descentTime', 'Descent time', 'sec', '0.1')}</div></div><div className="form-section"><h3>Configuration</h3><div className="form-grid">{field('rocketMass', 'Rocket mass (including motor)', 'g', 'any', rocketMassInput, (value) => { setRocketMassInput(value); updateForm('rocketMass', value) })}{field('parachuteSize', 'Parachute size', units === 'imperial' ? 'in' : 'cm')}{field('windSpeed', 'Wind speed', units === 'imperial' ? 'mph' : 'km/h', '0.1')}</div></div><div className="form-section"><h3>Atmospheric conditions</h3><div className="form-grid">{field('airPressure', 'Air pressure', units === 'imperial' ? 'inHg' : 'hPa', '0.01')}{field('humidity', 'Humidity', '%', '1')}{field('temperature', 'Temperature', units === 'imperial' ? '°F' : '°C', '0.1', temperatureInputValue, updateTemperature)}<label className="form-field full-field">Notes <input type="text" placeholder="Anything worth remembering?" value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} /></label></div></div><div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button type="submit" className="primary-button"><Check size={16} /> {editing ? 'Update flight' : 'Save flight'}</button></div></form></div></div> }

export default App
