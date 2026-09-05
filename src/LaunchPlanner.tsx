import { AlertTriangle, ArrowDownToLine, Check, CloudSun, Gauge, RotateCcw, Sparkles, Target } from 'lucide-react'
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
  const descentConditions = useMemo(() => ({ ...conditions, mass: result.status === 'ready' ? result.recommendedMass : conditions.mass, altitude: targetAltitude }), [conditions, result, targetAltitude])
  const descent = useMemo(() => predictionEngineV2.predictDescent(launches, descentConditions), [launches, descentConditions])
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
        <p className="planner-supporting">Every change recomputes the mass. With limited data, a conservative physics adjustment is used until a learned weather model qualifies.</p>
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
    <section className="planner-secondary-grid">
      <article className="planner-card planner-descent" aria-live="polite">
        <div className="planner-card-heading"><span className="planner-icon"><ArrowDownToLine size={20} /></span><div><p className="eyebrow">RECOVERY FORECAST</p><h2>Descent predictor</h2></div></div>
        <div className="descent-result"><strong>{format(descent.expectedSeconds, 1)} sec</strong><span>from {format(descentConditions.altitude * (metric ? .3048 : 1))} {metric ? 'm' : 'ft'} using a {format(descentConditions.parachuteSize * (metric ? 2.54 : 1), 1)} {metric ? 'cm' : 'in'} parachute</span></div>
        {descent.interval && <p className="planner-range">80% error range: {format(descent.interval[0], 1)}–{format(descent.interval[1], 1)} sec · MOE ±{format(descent.marginOfError ?? 0, 1)} sec</p>}
        <div className="planner-model"><Check size={16} /><span><b>{descent.methodLabel}</b><small>{descent.calibrationFlights ? `Calibrated with ${descent.calibrationFlights} complete flights` : 'Available before the first complete flight'}</small></span></div>
        {descent.warnings.map(warning => <p className="planner-warning" key={warning}><AlertTriangle size={15} />{warning}</p>)}
      </article>

      <article className="planner-card planner-comparisons">
        <div className="planner-card-heading"><span className="planner-icon purple"><Gauge size={20} /></span><div><p className="eyebrow">HELD-OUT VALIDATION</p><h2>All altitude methods</h2></div></div>
        {result.comparisons.length ? <div className="method-table-wrap"><table className="method-table"><thead><tr><th>Method</th><th>MAE</th><th>80% MOE</th><th>Coverage</th></tr></thead><tbody>{result.comparisons.map(comparison => <tr key={comparison.method} className={comparison.selected ? 'selected' : ''}><th>{comparison.methodLabel}{comparison.selected && <small>Selected</small>}{comparison.note && <small>{comparison.note}</small>}</th><td>{comparison.metrics ? `${format(comparison.metrics.mae * (metric ? .3048 : 1))} ${metric ? 'm' : 'ft'}` : '—'}</td><td>{comparison.marginOfError === null ? '—' : `±${format(comparison.marginOfError * (metric ? .3048 : 1))} ${metric ? 'm' : 'ft'}`}</td><td>{comparison.metrics ? `${Math.round(comparison.metrics.massCoverage * 100)}%` : '—'}</td></tr>)}</tbody></table></div> : <p className="planner-supporting">Log flights at different masses to compare prediction methods.</p>}
        <p className="comparison-help">MAE is the average held-out miss. MOE is the 80th-percentile absolute held-out error, used for the displayed prediction range. “Selected” also requires weather variation, mass coverage, and monotonic behavior.</p>
      </article>
    </section>
    <section className="planner-footnote"><b>Altitude and descent stay separate.</b> The mass recommendation optimizes altitude; the recovery forecast uses that recommended mass when available. Current v2 never recommends a mass outside your recorded data and configured safety limits.</section>
  </>
}
