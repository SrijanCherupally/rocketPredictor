import { useEffect, useMemo, useState } from 'react'
import { Area, Brush, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis } from 'recharts'
import { Activity, ArrowDownToLine, ArrowUpRight, BarChart3, Check, ChevronDown, CloudSun, Database, Download, Gauge, Menu, Pencil, Plus, Rocket, Settings2, Sparkles, Target, Trash2, Wind, X } from 'lucide-react'
import { adjustedAltitude, adjustedRegression, linearRegression, median, totalMass, type Launch } from './analytics'
import { seedLaunches } from './seed'

const STORAGE_KEY = 'apogee-launches-v1'
const PREF_KEY = 'apogee-prefs-v1'
type Units = 'imperial' | 'metric'

type FormValues = Omit<Launch, 'id'>
type StoredLaunch = Record<string, unknown>

const emptyForm: FormValues = { date: new Date().toISOString().slice(0, 10), altitude: 800, flightTime: 0, descentTime: 0, parachuteSize: 18, rocketMass: 578, windSpeed: 4, airPressure: 29.92, humidity: 50, notes: '' }

const normalizeLaunches = (value: unknown): Launch[] => {
  if (!Array.isArray(value)) return seedLaunches
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const stored = item as StoredLaunch
    const rocketMass = Number(stored.rocketMass)
    if (!Number.isFinite(rocketMass)) return []
    const legacyMotorMass = Number(stored.motorMass)
    const canonical = Object.fromEntries(Object.entries(stored).filter(([key]) => key !== 'motorMass'))
    return [{ ...canonical, rocketMass: rocketMass + (Number.isFinite(legacyMotorMass) ? legacyMotorMass : 0) } as unknown as Launch]
  })
}

const formatNumber = (value: number, digits = 0) => new Intl.NumberFormat('en-US', { maximumFractionDigits: digits }).format(value)
const formatMass = (grams: number) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 20 }).format(grams)
const formatRecommendationMass = (grams: number) => new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(grams)
const ftToM = (value: number) => value / 3.28084
const mphToKmh = (value: number) => value * 1.60934

function App() {
  const [launches, setLaunches] = useState<Launch[]>(() => {
    try { return normalizeLaunches(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')) } catch { return seedLaunches }
  })
  const [units, setUnits] = useState<Units>(() => {
    try { return (localStorage.getItem(PREF_KEY) as Units) ?? 'imperial' } catch { return 'imperial' }
  })
  const [targetAltitude, setTargetAltitude] = useState(800)
  const [form, setForm] = useState<FormValues>(emptyForm)
  const [rocketMassInput, setRocketMassInput] = useState(String(emptyForm.rocketMass))
  const [showForm, setShowForm] = useState(false)
  const [editingLaunchId, setEditingLaunchId] = useState<string | null>(null)
  const [activeSection, setActiveSection] = useState<'overview' | 'flights' | 'settings'>('overview')
  const [mobileNav, setMobileNav] = useState(false)
  const [toast, setToast] = useState('')

  useEffect(() => { localStorage.setItem(STORAGE_KEY, JSON.stringify(launches)) }, [launches])
  useEffect(() => { localStorage.setItem(PREF_KEY, units) }, [units])
  useEffect(() => { if (toast) { const timeout = window.setTimeout(() => setToast(''), 2600); return () => window.clearTimeout(timeout) } }, [toast])

  const rawModel = useMemo(() => linearRegression(launches.map((launch) => ({ x: totalMass(launch), y: launch.altitude }))), [launches])
  const adjustedModel = useMemo(() => adjustedRegression(launches), [launches])
  const reference = useMemo(() => ({ wind: median(launches.map((launch) => launch.windSpeed)), pressure: median(launches.map((launch) => launch.airPressure)), humidity: median(launches.map((launch) => launch.humidity)) }), [launches])
  const rawRecommendation = rawModel && Math.abs(rawModel.coefficients[0]) > 0.01 ? (targetAltitude - rawModel.intercept) / rawModel.coefficients[0] : null
  const adjustedRecommendation = adjustedModel && Math.abs(adjustedModel.coefficients[0]) > 0.01 ? (targetAltitude - adjustedModel.intercept - adjustedModel.coefficients[1] * reference.wind - adjustedModel.coefficients[2] * reference.pressure - adjustedModel.coefficients[3] * reference.humidity) / adjustedModel.coefficients[0] : null
  const rawChart = useMemo(() => launches.map((launch) => ({ ...launch, mass: totalMass(launch), fitted: rawModel ? rawModel.intercept + rawModel.coefficients[0] * totalMass(launch) : 0 })).sort((a, b) => a.mass - b.mass), [launches, rawModel])
  const adjustedChart = useMemo(() => launches.map((launch) => ({ ...launch, mass: totalMass(launch), adjusted: adjustedModel ? adjustedAltitude(launch, adjustedModel, reference) : launch.altitude, fitted: adjustedModel ? adjustedModel.intercept + adjustedModel.coefficients[0] * totalMass(launch) + adjustedModel.coefficients[1] * reference.wind + adjustedModel.coefficients[2] * reference.pressure + adjustedModel.coefficients[3] * reference.humidity : 0 })).sort((a, b) => a.mass - b.mass), [launches, adjustedModel, reference])
  const avgAltitude = launches.reduce((sum, launch) => sum + launch.altitude, 0) / launches.length
  const avgDescent = launches.reduce((sum, launch) => sum + launch.descentTime, 0) / launches.length
  const targetGap = avgAltitude - targetAltitude
  const onSaveLaunch = (event: React.FormEvent) => {
    event.preventDefault()
    if (editingLaunchId) {
      setLaunches((current) => current.map((launch) => launch.id === editingLaunchId ? { ...form, id: editingLaunchId } : launch))
      setToast('Flight updated · models recalculated')
    } else {
      const launch: Launch = { ...form, id: `flight-${Date.now()}` }
      setLaunches((current) => [...current, launch])
      setToast('Flight saved · models recalculated')
    }
    setForm(emptyForm)
    setRocketMassInput(String(emptyForm.rocketMass))
    setEditingLaunchId(null)
    setShowForm(false)
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
  const removeLaunch = (id: string) => { if (window.confirm('Remove this flight from the workspace?')) { setLaunches((current) => current.filter((launch) => launch.id !== id)); setToast('Flight removed') } }
  const updateForm = (field: keyof FormValues, value: string) => setForm((current) => ({ ...current, [field]: value === '' ? 0 : Number(value) }))
  const displayMass = (grams: number) => `${formatMass(grams)} g`
  const displayAltitude = (feet: number) => units === 'imperial' ? `${formatNumber(feet)} ft` : `${formatNumber(ftToM(feet))} m`
  const displayWind = (mph: number) => units === 'imperial' ? `${formatNumber(mph, 1)} mph` : `${formatNumber(mphToKmh(mph), 1)} km/h`

  const exportData = () => {
    const blob = new Blob([JSON.stringify(launches, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = 'apogee-flights.json'; link.click(); URL.revokeObjectURL(url)
    setToast('Flight data exported')
  }

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileNav ? 'mobile-open' : ''}`}>
        <div className="brand"><div className="brand-mark"><Rocket size={20} /></div><div><strong>apogee</strong><span>flight intelligence</span></div></div>
        <div className="workspace-switcher"><div className="workspace-icon">T</div><div><b>TARC Rocketry</b><span>Team workspace</span></div><ChevronDown size={16} /></div>
        <nav><button className={activeSection === 'overview' ? 'active' : ''} onClick={() => { setActiveSection('overview'); setMobileNav(false) }}><BarChart3 size={18} /> Overview</button><button className={activeSection === 'flights' ? 'active' : ''} onClick={() => { setActiveSection('flights'); setMobileNav(false) }}><Database size={18} /> Flights <em>{launches.length}</em></button><button onClick={() => setToast('Team insights are coming soon')}><Sparkles size={18} /> Insights <span className="new-pill">NEW</span></button></nav>
        <div className="sidebar-bottom"><button className={activeSection === 'settings' ? 'active' : ''} onClick={() => { setActiveSection('settings'); setMobileNav(false) }}><Settings2 size={18} /> Settings</button><div className="profile"><div className="avatar">SC</div><div><b>Rocket team</b><span>Member access</span></div><MoreDots /></div></div>
      </aside>
      {mobileNav && <button className="sidebar-scrim" onClick={() => setMobileNav(false)} aria-label="Close navigation" />}
      <main className="main-content">
        <header className="topbar"><button className="icon-button mobile-menu" onClick={() => setMobileNav(true)} aria-label="Open navigation"><Menu size={20} /></button><div className="breadcrumbs"><span>Workspace</span><span>/</span><b>{activeSection === 'overview' ? 'Overview' : activeSection === 'flights' ? 'Flights' : 'Settings'}</b></div><div className="top-actions"><button className="unit-select" onClick={() => setUnits(units === 'imperial' ? 'metric' : 'imperial')}><span className="unit-dot" /> {units === 'imperial' ? 'Imperial' : 'Metric'} <ChevronDown size={14} /></button><button className="icon-button" onClick={() => setToast('No new notifications')}><BellDot /></button><button className="avatar small">SC</button></div></header>
        {activeSection === 'settings' ? <SettingsPanel units={units} setUnits={setUnits} targetAltitude={targetAltitude} setTargetAltitude={setTargetAltitude} /> : activeSection === 'flights' ? <FlightsPanel launches={launches} displayAltitude={displayAltitude} displayMass={displayMass} displayWind={displayWind} exportData={exportData} onDelete={removeLaunch} onEdit={editLaunch} onNew={openNewLaunch} /> : <>
        <section className="page-heading"><div><p className="eyebrow">THURSDAY, AUGUST 27, 2026 <span className="live-dot" /> LIVE MODEL</p><h1>Good morning, team.</h1><p className="subtitle">Your flight data is getting smarter with every launch.</p></div><button className="primary-button" onClick={openNewLaunch}><Plus size={17} /> Log a flight</button></section>
        <section className="target-banner"><div className="target-icon"><Target size={20} /></div><div><span>Current target altitude</span><strong>{formatNumber(targetAltitude)} <small>ft</small></strong></div><div className="target-divider" /><div className="target-status"><Check size={15} /> <span>{Math.abs(targetGap) < 15 ? 'On target range' : targetGap > 0 ? 'Running high' : 'Running low'}</span></div><button onClick={() => setActiveSection('settings')}>Edit target <ArrowUpRight size={15} /></button></section>
        <section className="stats-grid"><StatCard label="FLIGHTS LOGGED" value={String(launches.length).padStart(2, '0')} note="+2 this month" trend="up" icon={<Database size={18} />} /><StatCard label="AVG. ALTITUDE" value={formatNumber(avgAltitude)} unit="ft" note={`${targetGap >= 0 ? '+' : ''}${formatNumber(targetGap)} ft vs target`} trend={targetGap >= 0 ? 'up' : 'down'} icon={<ArrowUpRight size={18} />} /><StatCard label="AVG. DESCENT" value={formatNumber(avgDescent, 1)} unit="sec" note="Target: 34.0 sec" trend={Math.abs(avgDescent - 34) < 2 ? 'up' : 'down'} icon={<ArrowDownToLine size={18} />} /><StatCard label="MODEL CONFIDENCE" value={adjustedModel ? formatNumber(adjustedModel.r2 * 100) : '—'} unit={adjustedModel ? '%' : ''} note={adjustedModel ? 'Weather model active' : 'Need 7+ flights'} trend="up" icon={<Gauge size={18} />} /></section>
        <section className="analysis-grid"><AnalysisCard title="Raw altitude model" subtitle="Altitude vs. total mass · no weather compensation" icon={<Activity size={18} />} accent="blue" model={rawModel} recommendation={rawRecommendation} chart={<RawChart data={rawChart} target={targetAltitude} />} /><AnalysisCard title="Adjusted altitude model" subtitle="Compensated for wind, pressure & humidity" icon={<CloudSun size={18} />} accent="purple" model={adjustedModel} recommendation={adjustedRecommendation} chart={<AdjustedChart data={adjustedChart} target={targetAltitude} />} /></section>
        <section className="recent-section"><div className="section-heading"><div><h2>Recent flights</h2><p>Latest performance from your team</p></div><button className="text-button" onClick={() => setActiveSection('flights')}>View all <ArrowUpRight size={15} /></button></div><FlightTable launches={launches.slice(-5).reverse()} displayAltitude={displayAltitude} displayMass={displayMass} displayWind={displayWind} onDelete={removeLaunch} onEdit={editLaunch} /></section>
        </>}
      </main>
      {showForm && <LaunchModal form={form} setForm={setForm} onClose={() => { setShowForm(false); setEditingLaunchId(null) }} onSubmit={onSaveLaunch} units={units} updateForm={updateForm} editing={Boolean(editingLaunchId)} rocketMassInput={rocketMassInput} setRocketMassInput={setRocketMassInput} />}
      {toast && <div className="toast"><Check size={16} /> {toast}</div>}
    </div>
  )
}

function StatCard({ label, value, unit, note, trend, icon }: { label: string; value: string; unit?: string; note: string; trend: 'up' | 'down'; icon: React.ReactNode }) { return <article className="stat-card"><div className="stat-top"><span>{label}</span><div className="stat-icon">{icon}</div></div><div className="stat-value">{value} <small>{unit}</small></div><div className={`stat-note ${trend}`}><span>{trend === 'up' ? '↗' : '↘'}</span> {note}</div></article> }
function MoreDots() { return <span className="more-dots">•••</span> }
function BellDot() { return <span className="bell-dot">◉</span> }

function AnalysisCard({ title, subtitle, icon, accent, model, recommendation, chart }: { title: string; subtitle: string; icon: React.ReactNode; accent: string; model: ReturnType<typeof linearRegression>; recommendation: number | null; chart: React.ReactNode }) { const rec = recommendation && recommendation > 0 ? `${formatRecommendationMass(recommendation)} g` : 'Collect more data'; return <article className={`analysis-card ${accent}`}><div className="card-heading"><div><div className="card-title"><span className="analysis-icon">{icon}</span><h2>{title}</h2></div><p>{subtitle}</p></div><button className="more-button"><MoreDots /></button></div><div className="chart-wrap">{model ? chart : <div className="empty-chart"><Sparkles size={25} /><b>Keep logging flights</b><span>We need more varied launches to build this model.</span></div>}</div>{model && <p className="chart-zoom-hint">Drag the handles below to zoom into a mass range</p>}<div className="model-footer"><div><span className="footer-label">MASS RECOMMENDATION</span><strong>{rec}</strong></div><div className="model-stat"><span>R² FIT</span><b>{model ? `${formatNumber(model.r2 * 100)}%` : '—'}</b></div><div className="model-stat"><span>MAE</span><b>{model ? `${formatNumber(model.mae)} ft` : '—'}</b></div><div className="model-stat"><span>FLIGHTS</span><b>{model?.sampleSize ?? 0}</b></div></div></article> }

function RawChart({ data, target }: { data: Array<Launch & { mass: number; fitted: number }>; target: number }) { return <ResponsiveContainer width="100%" height="100%"><ComposedChart data={data} margin={{ top: 14, right: 8, bottom: 0, left: -22 }}><CartesianGrid vertical={false} stroke="#e9edf3" /><XAxis dataKey="mass" type="number" domain={['dataMin - 8', 'dataMax + 8']} tickLine={false} axisLine={false} tick={{ fill: '#8791a4', fontSize: 11 }} tickFormatter={(value) => `${formatMass(Number(value))}g`} /><YAxis domain={['dataMin - 35', 'dataMax + 25']} tickLine={false} axisLine={false} tick={{ fill: '#8791a4', fontSize: 11 }} tickFormatter={(value) => `${value}`} /><Tooltip content={<ChartTooltip />} /><ReferenceLine y={target} stroke="#9da7b8" strokeDasharray="4 4" label={{ value: 'Target', fill: '#8791a4', fontSize: 11, position: 'insideTopRight' }} /><Scatter name="Flights" dataKey="altitude" fill="#3478f6" /><Line name="Best fit" dataKey="fitted" type="monotone" stroke="#3478f6" strokeWidth={2.5} dot={false} activeDot={false} /><Brush key={data.map((point) => `${point.id}-${point.mass}`).join('|')} dataKey="mass" height={18} stroke="#3478f6" fill="#f2f6ff" travellerWidth={10} startIndex={0} endIndex={data.length - 1} tickFormatter={(value) => `${formatMass(Number(value))}g`} /></ComposedChart></ResponsiveContainer> }
function AdjustedChart({ data, target }: { data: Array<Launch & { mass: number; adjusted: number; fitted: number }>; target: number }) { return <ResponsiveContainer width="100%" height="100%"><ComposedChart data={data} margin={{ top: 14, right: 8, bottom: 0, left: -22 }}><CartesianGrid vertical={false} stroke="#e9edf3" /><XAxis dataKey="mass" type="number" domain={['dataMin - 8', 'dataMax + 8']} tickLine={false} axisLine={false} tick={{ fill: '#8791a4', fontSize: 11 }} tickFormatter={(value) => `${formatMass(Number(value))}g`} /><YAxis domain={['dataMin - 35', 'dataMax + 25']} tickLine={false} axisLine={false} tick={{ fill: '#8791a4', fontSize: 11 }} tickFormatter={(value) => `${value}`} /><Tooltip content={<ChartTooltip adjusted />} /><ReferenceLine y={target} stroke="#9da7b8" strokeDasharray="4 4" label={{ value: 'Target', fill: '#8791a4', fontSize: 11, position: 'insideTopRight' }} /><Area name="Adjusted flights" dataKey="adjusted" fill="#f0eaff" stroke="none" fillOpacity={0.9} /><Scatter name="Adjusted flights" dataKey="adjusted" fill="#7758d8" /><Line name="Adjusted fit" dataKey="fitted" type="monotone" stroke="#7758d8" strokeWidth={2.5} dot={false} activeDot={false} /><Brush key={data.map((point) => `${point.id}-${point.mass}`).join('|')} dataKey="mass" height={18} stroke="#7758d8" fill="#f8f6ff" travellerWidth={10} startIndex={0} endIndex={data.length - 1} tickFormatter={(value) => `${formatMass(Number(value))}g`} /></ComposedChart></ResponsiveContainer> }
function ChartTooltip({ active, payload, adjusted }: { active?: boolean; payload?: Array<{ payload: Launch & { mass: number; adjusted?: number } }>; adjusted?: boolean }) { if (!active || !payload?.length) return null; const point = payload[0].payload; return <div className="chart-tooltip"><b>{point.date}</b><span>{formatMass(point.mass)} g · {formatNumber(adjusted ? point.adjusted ?? point.altitude : point.altitude)} ft</span><small>{formatNumber(point.windSpeed, 1)} mph wind</small></div> }

function FlightTable({ launches, displayAltitude, displayMass, displayWind, onDelete, onEdit }: { launches: Launch[]; displayAltitude: (v: number) => string; displayMass: (v: number) => string; displayWind: (v: number) => string; onDelete: (id: string) => void; onEdit: (launch: Launch) => void }) { return <div className="table-card"><div className="flight-table table-header"><span>DATE</span><span>ALTITUDE</span><span>TOTAL MASS</span><span>WIND</span><span>DESCENT</span><span>STATUS</span><span /></div>{launches.map((launch) => { const near = Math.abs(launch.altitude - 800) < 20; return <div className="flight-table" key={launch.id}><span className="date-cell"><b>{new Date(`${launch.date}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: '2-digit' })}</b><small>{launch.id.replace('flight-', 'Flight ')}</small></span><strong>{displayAltitude(launch.altitude)}</strong><span>{displayMass(totalMass(launch))}</span><span className="wind-cell"><Wind size={14} /> {displayWind(launch.windSpeed)}</span><span>{formatNumber(launch.descentTime, 1)} sec</span><span className={`status ${near ? 'on-target' : 'review'}`}><i /> {near ? 'On target' : 'Review'}</span><span className="row-actions"><button className="edit-button" onClick={() => onEdit(launch)} aria-label={`Edit ${launch.id}`}><Pencil size={14} /></button><button className="delete-button" onClick={() => onDelete(launch.id)} aria-label={`Delete ${launch.id}`}><Trash2 size={15} /></button></span></div>})}</div> }

function FlightsPanel({ launches, displayAltitude, displayMass, displayWind, exportData, onDelete, onEdit, onNew }: { launches: Launch[]; displayAltitude: (v: number) => string; displayMass: (v: number) => string; displayWind: (v: number) => string; exportData: () => void; onDelete: (id: string) => void; onEdit: (launch: Launch) => void; onNew: () => void }) { return <><section className="page-heading"><div><p className="eyebrow">FLIGHT LOGBOOK</p><h1>All flights</h1><p className="subtitle">Review, export, and manage your team's launch history.</p></div><div className="heading-actions"><button className="secondary-button" onClick={exportData}><Download size={16} /> Export</button><button className="primary-button" onClick={onNew}><Plus size={17} /> Log a flight</button></div></section><section className="full-table-section"><div className="section-heading"><div><h2>{launches.length} launches</h2><p>Sorted by most recent</p></div></div><FlightTable launches={[...launches].reverse()} displayAltitude={displayAltitude} displayMass={displayMass} displayWind={displayWind} onDelete={onDelete} onEdit={onEdit} /></section></> }

function SettingsPanel({ units, setUnits, targetAltitude, setTargetAltitude }: { units: Units; setUnits: (u: Units) => void; targetAltitude: number; setTargetAltitude: (n: number) => void }) { return <><section className="page-heading"><div><p className="eyebrow">WORKSPACE PREFERENCES</p><h1>Settings</h1><p className="subtitle">Tune your display and prediction defaults.</p></div></section><section className="settings-grid"><div className="settings-card"><div className="settings-card-heading"><div className="settings-big-icon"><Target size={20} /></div><div><h2>Target altitude</h2><p>Used for recommendations and chart reference lines.</p></div></div><label>DEFAULT TARGET <div className="input-with-unit"><input type="number" min="1" value={targetAltitude} onChange={(event) => setTargetAltitude(Number(event.target.value))} /><span>ft</span></div></label><p className="field-help">You can change the target any time without changing historical flight data.</p></div><div className="settings-card"><div className="settings-card-heading"><div className="settings-big-icon purple"><Settings2 size={20} /></div><div><h2>Display units</h2><p>Choose how measurements appear throughout the app.</p></div></div><div className="unit-options"><button className={units === 'imperial' ? 'selected' : ''} onClick={() => setUnits('imperial')}><b>Imperial</b><span>ft · g · mph · inHg</span>{units === 'imperial' && <Check size={16} />}</button><button className={units === 'metric' ? 'selected' : ''} onClick={() => setUnits('metric')}><b>Metric</b><span>m · g · km/h · hPa</span>{units === 'metric' && <Check size={16} />}</button></div><p className="field-help">Your preference is saved automatically on this device.</p></div></section></> }

function LaunchModal({ form, setForm, onClose, onSubmit, units, updateForm, editing, rocketMassInput, setRocketMassInput }: { form: FormValues; setForm: React.Dispatch<React.SetStateAction<FormValues>>; onClose: () => void; onSubmit: (e: React.FormEvent) => void; units: Units; updateForm: (field: keyof FormValues, value: string) => void; editing: boolean; rocketMassInput: string; setRocketMassInput: (value: string) => void }) { const field = (name: keyof FormValues, label: string, unit: string, step = '1', inputValue?: string, onInputChange?: (value: string) => void) => <label className="form-field">{label}<div className="input-with-unit"><input required={name !== 'notes'} type={name === 'date' ? 'date' : name === 'notes' ? 'text' : 'number'} step={step} value={inputValue ?? form[name] as string | number} onChange={(event) => name === 'date' || name === 'notes' ? setForm((current) => ({ ...current, [name]: event.target.value })) : onInputChange ? (onInputChange(event.target.value), updateForm(name, event.target.value)) : updateForm(name, event.target.value)} /><span>{unit}</span></div></label>; return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><div className="modal"><div className="modal-heading"><div><p className="eyebrow">{editing ? 'EDIT FLIGHT RECORD' : 'NEW FLIGHT RECORD'}</p><h2>{editing ? 'Edit flight' : 'Log a flight'}</h2><p>Capture the conditions while they are still fresh.</p></div><button className="icon-button" onClick={onClose} aria-label="Close"><X size={19} /></button></div><form onSubmit={onSubmit}><div className="form-section"><h3>Flight performance</h3><div className="form-grid">{field('date', 'Launch date', '', '1')}{field('altitude', 'Peak altitude', units === 'imperial' ? 'ft' : 'm')}{field('flightTime', 'Total flight time', 'sec', '0.1')}{field('descentTime', 'Descent time', 'sec', '0.1')}</div></div><div className="form-section"><h3>Configuration</h3><div className="form-grid">{field('rocketMass', 'Rocket mass (including motor)', 'g', 'any', rocketMassInput, setRocketMassInput)}{field('parachuteSize', 'Parachute size', units === 'imperial' ? 'in' : 'cm')}{field('windSpeed', 'Wind speed', units === 'imperial' ? 'mph' : 'km/h', '0.1')}</div></div><div className="form-section"><h3>Atmospheric conditions</h3><div className="form-grid">{field('airPressure', 'Air pressure', units === 'imperial' ? 'inHg' : 'hPa', '0.01')}{field('humidity', 'Humidity', '%', '1')}<label className="form-field full-field">Notes <input type="text" placeholder="Anything worth remembering?" value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} /></label></div></div><div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button type="submit" className="primary-button"><Check size={16} /> {editing ? 'Update flight' : 'Save flight'}</button></div></form></div></div> }

export default App
