import { AlertTriangle, Check, CloudSun, Gauge, RotateCcw, Sparkles, Target } from 'lucide-react'
import { useMemo } from 'react'
import type { DescentConditions, Launch } from './analytics'
import { predictionEngineV2 } from './predictionV2'
import type { Units } from './predictionTypes'

type Props = {
  launches: Launch[]
  targetAltitude: number
  conditions: DescentConditions
  setConditions: React.Dispatch<React.SetStateAction<DescentConditions>>
  units: Units
  massLimits: [number, number]
  onOpenLegacy: () => void
  onNewFlight: () => void
}

const format = (value: number, digits = 1) => new Intl.NumberFormat('en-US', { maximumFractionDigits: digits }).format(value)

export function LaunchPlanner({ launches, targetAltitude, conditions, setConditions, units, massLimits, onOpenLegacy, onNewFlight }: Props) {
  const result = useMemo(() => predictionEngineV2.recommend(launches, targetAltitude, conditions, massLimits), [launches, targetAltitude, conditions, massLimits])
  const metric = units === 'metric'
  const fields = [
    { key: 'wind' as const, label: 'Wind', unit: metric ? 'km/h' : 'mph', factor: metric ? 1.60934 : 1, min: 0, step: .1 },
    { key: 'temperature' as const, label: 'Temperature', unit: metric ? '°C' : '°F', factor: metric ? 5 / 9 : 1, offset: metric ? -32 * 5 / 9 : 0, step: .1 },
    { key: 'pressure' as const, label: 'Station pressure', unit: metric ? 'hPa' : 'inHg', factor: metric ? 33.8639 : 1, min: .1, step: .01 },
    { key: 'humidity' as const, label: 'Humidity', unit: '%', factor: 1, min: 0, max: 100, step: 1 },
  ]
  const targetDisplay = targetAltitude * (metric ? .3048 : 1)
  const resetWeather = () => setConditions(current => ({ ...current, wind: 4, temperature: 70, pressure: 29.92, humidity: 50 }))

  return <>
    <section className="page-heading planner-page-heading">
      <div><p className="eyebrow">ALTITUDE PLANNING · CURRENT V2</p><h1>Launch planner</h1><p className="subtitle">Set the expected weather and get a validated mass recommendation within your recorded range.</p></div>
      <div className="heading-actions"><button className="secondary-button" onClick={onOpenLegacy}><RotateCcw size={16} /> Legacy mode</button><button className="primary-button" onClick={onNewFlight}>Log a flight</button></div>
    </section>
    <section className="planner-layout">
      <article className="planner-card planner-conditions">
        <div className="planner-card-heading"><span className="planner-icon"><CloudSun size={20} /></span><div><p className="eyebrow">EXPECTED CONDITIONS</p><h2>Launch-day weather</h2></div><button className="text-button" onClick={resetWeather}>Reset</button></div>
        <p className="planner-supporting">These values affect the recommendation only when the selected model has enough varied weather data.</p>
        <div className="planner-field-grid">{fields.map(field => {
          const displayed = conditions[field.key] * field.factor + (field.offset ?? 0)
          return <label key={field.key}>{field.label}<span className="input-with-unit"><input type="number" aria-label={field.label} min={field.min} max={field.max} step={field.step} value={Number(displayed.toFixed(3))} onChange={event => {
            if (!Number.isFinite(event.target.valueAsNumber)) return
            setConditions(current => ({ ...current, [field.key]: (event.target.valueAsNumber - (field.offset ?? 0)) / field.factor }))
          }} /><span>{field.unit}</span></span></label>
        })}</div>
        <div className="planner-target"><Target size={18} /><span>Altitude target</span><strong>{format(targetDisplay)} {metric ? 'm' : 'ft'}</strong></div>
      </article>

      <article className={`planner-card planner-result ${result.status}`} aria-live="polite">
        <div className="planner-card-heading"><span className="planner-icon purple"><Sparkles size={20} /></span><div><p className="eyebrow">RECOMMENDATION</p><h2>Ideal launch mass</h2></div></div>
        {result.status === 'ready' ? <>
          <div className="planner-mass"><strong>{format(result.recommendedMass, 1)}</strong><span>grams</span></div>
          <p>Expected altitude: <b>{format(result.expectedAltitude * (metric ? .3048 : 1))} {metric ? 'm' : 'ft'}</b></p>
          {result.interval && <p className="planner-range">Observed-error range: {format(result.interval[0] * (metric ? .3048 : 1))}–{format(result.interval[1] * (metric ? .3048 : 1))} {metric ? 'm' : 'ft'}</p>}
          <div className="planner-model"><Check size={16} /><span><b>{result.methodLabel}</b><small>Automatically selected · uses {result.features.join(', ')}</small></span></div>
          {result.metrics.testedFlights > 0 && <div className="planner-metrics"><span><Gauge size={15} /> Held-out MAE <b>{format(result.metrics.mae * (metric ? .3048 : 1))} {metric ? 'm' : 'ft'}</b></span><span>{result.metrics.testedFlights} flights · {result.metrics.launchDays} days</span></div>}
          {result.warnings.map(warning => <p className="planner-warning" key={warning}><AlertTriangle size={15} />{warning}</p>)}
        </> : <div className="planner-empty"><AlertTriangle size={28} /><h3>{result.status === 'needs-data' ? 'More flights needed' : 'Target outside supported range'}</h3><p>{result.reason}</p>{result.warnings.map(warning => <small key={warning}>{warning}</small>)}<button className="primary-button" onClick={onNewFlight}>Log another flight</button></div>}
      </article>
    </section>
    <section className="planner-footnote"><b>Altitude-only planner.</b> Recovery duration is analyzed separately and is not optimized by this recommendation. Current v2 never recommends a mass outside your recorded data and configured safety limits.</section>
  </>
}
