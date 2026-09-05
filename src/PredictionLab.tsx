import { useEffect, useMemo, useState } from 'react'
import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis } from 'recharts'
import type { DescentConditions, Launch } from './analytics'
import { bestResult, descriptions, methodNames, outsideCoverage, predictModel, solveMass, validConditions, type ExperimentResult, type Method, type Suite } from './experiments'
import { MassRangeControl } from './MassRangeControl'
import { clampMassRange } from './massRange'
import { seedLaunches } from './seed'

type Suites = { descent: Suite; altitude: Suite; error?: string }
type Props = { launches: Launch[]; conditions: DescentConditions; setConditions: React.Dispatch<React.SetStateAction<DescentConditions>>; targetAltitude: number; units: 'imperial' | 'metric' }
const number = (v: number | null | undefined, suffix = '') => v == null || !Number.isFinite(v) ? '—' : `${v.toFixed(1)}${suffix}`

export function PredictionLab({ launches, ...props }: Props) {
  const demoCount = launches.filter(launch => seedLaunches.some(seed => Object.entries(seed).every(([key, value]) => launch[key as keyof Launch] === value))).length
  const [result, setResult] = useState<{ source: Launch[]; suites?: Suites; error?: string } | null>(null)
  useEffect(() => {
    const worker = new Worker(new URL('./experiments.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (event: MessageEvent<Suites>) => setResult({ source: launches, suites: event.data.error ? undefined : event.data, error: event.data.error })
    worker.onerror = () => setResult({ source: launches, error: 'Prediction experiments could not load. Reload to retry; original models remain available.' })
    worker.postMessage(launches)
    return () => worker.terminate()
  }, [launches])
  const ready = result?.source === launches
  return <section className="prediction-lab" aria-busy={!ready}>
    <div className="lab-intro"><div><p className="eyebrow">EXPERIMENTAL MODELS · ORIGINALS PRESERVED</p><h2>Flight prediction lab</h2><p>Compare algorithms on the selected flight dates. Zoom changes the view; it never changes model training.</p></div><span className="lab-pill">{launches.length} logged flights</span></div>
    {demoCount > 0 && <p className="lab-notice">{demoCount} records match the bundled example flights. These results demonstrate the models; validate with your own comparable flights before using the estimates.</p>}
    {!ready ? <p role="status" className="lab-notice">Training models and testing unseen launch dates…</p> : result.error ? <p role="alert" className="lab-notice">{result.error}</p> : result.suites && <LabResults {...props} suites={result.suites} />}
  </section>
}

function LabResults({ suites, conditions, setConditions, targetAltitude, units }: Omit<Props, 'launches'> & { suites: Suites }) {
  const [descentMethod, setDescentMethod] = useState<Method>('physics')
  const [massMethod, setMassMethod] = useState<Method>('ridge')
  const [zoom, setZoom] = useState<[number, number] | null>(null)
  const descent = suites.descent.results.find(r => r.method === descentMethod)!
  const altitude = suites.altitude.results.find(r => r.method === massMethod)!
  const flights = suites.descent.flights
  const bounds: [number, number] = flights.length ? [Math.min(...flights.map(l => l.rocketMass)), Math.max(...flights.map(l => l.rocketMass))] : [0, 0]
  const range = clampMassRange(zoom, bounds)
  const visible = flights.filter(l => l.rocketMass >= range[0] && l.rocketMass <= range[1])
  const curve = useMemo(() => Array.from({ length: 65 }, (_, i) => {
    const mass = range[0] + (range[1] - range[0]) * i / 64
    const predicted = descent.model ? predictModel(descent.model, { ...conditions, mass }) : null
    return { mass, predicted, band: predicted !== null && descent.error80 !== null ? [Math.max(0, predicted - descent.error80), predicted + descent.error80] : undefined }
  }), [range, conditions, descent])
  const prediction = descent.model ? predictModel(descent.model, conditions) : null
  const low = curve[0].predicted; const high = curve.at(-1)?.predicted
  const coverage = outsideCoverage(flights, conditions, 'descent')
  const massCoverage = outsideCoverage(suites.altitude.flights, conditions, 'altitude')
  const masses = suites.altitude.flights.map(l => l.rocketMass)
  const solution = altitude.model && masses.length ? solveMass(altitude.model, targetAltitude, conditions, [Math.min(...masses), Math.max(...masses)]) : { mass: null, reason: 'Collect more valid flights to train this model.' }
  const metric = units === 'metric'
  const fields: Array<{ key: keyof Omit<DescentConditions, 'flightTime'>; label: string; unit: string; factor?: number; offset?: number; min?: number; max?: number }> = [
    { key: 'mass', label: 'Rocket mass', unit: 'g', min: .1 },
    { key: 'altitude', label: 'Descent altitude', unit: metric ? 'm' : 'ft', factor: metric ? .3048 : 1, min: .1 },
    { key: 'parachuteSize', label: 'Parachute diameter', unit: metric ? 'cm' : 'in', factor: metric ? 2.54 : 1, min: .1 },
    { key: 'wind', label: 'Wind', unit: metric ? 'km/h' : 'mph', factor: metric ? 1.60934 : 1, min: 0 },
    { key: 'temperature', label: 'Temperature', unit: metric ? '°C' : '°F', factor: metric ? 5 / 9 : 1, offset: metric ? -32 * 5 / 9 : 0 },
    { key: 'pressure', label: 'Station pressure', unit: metric ? 'hPa' : 'inHg', factor: metric ? 33.8639 : 1, min: .1 },
    { key: 'humidity', label: 'Humidity', unit: '%', min: 0, max: 100 },
  ]
  return <>
    <div className="lab-inputs">{fields.map(field => <label key={field.key}>{field.label}<span><input aria-label={field.label} type="number" step="any" min={field.min} max={field.max} value={Number((conditions[field.key] * (field.factor ?? 1) + (field.offset ?? 0)).toFixed(3))} onChange={e => { if (e.target.value !== '' && Number.isFinite(e.target.valueAsNumber)) setConditions(current => ({ ...current, [field.key]: (e.target.valueAsNumber - (field.offset ?? 0)) / (field.factor ?? 1) })) }} />{field.unit}</span></label>)}</div>
    {!validConditions(conditions) && <p className="lab-notice" role="alert">Enter positive mass, altitude, parachute diameter and pressure, nonnegative wind, and humidity from 0–100%.</p>}
    <div className="lab-section-heading"><div><h3>Descent sensitivity</h3><p>Change mass while holding the entered altitude, parachute and weather constant.</p></div><ModelSelect label="Descent algorithm" results={suites.descent.results} value={descentMethod} setValue={setDescentMethod} /></div>
    <div className="lab-summary" aria-live="polite"><div><span>At {number(conditions.mass, ' g')}</span><strong>{number(prediction, ' s')}</strong><small>{methodNames[descentMethod]}</small></div><div><span>Across {number(range[0])}–{number(range[1], ' g')}</span><strong>{low != null && high != null ? `${high - low >= 0 ? '+' : ''}${number(high - low, ' s')}` : '—'}</strong><small>Modeled change in descent time</small></div><div><span>Held-out mean error</span><strong>{number(descent.mae, ' s')}</strong><small>{descent.tested}/{descent.total} flights tested on unseen dates</small></div></div>
    {coverage.length > 0 && <p className="lab-notice">Outside logged coverage: {coverage.join(', ')}. This scenario is an extrapolation; error estimates may not transfer.</p>}
    <div className="lab-chart">{descent.model && prediction !== null ? <ResponsiveContainer width="100%" height="100%"><ComposedChart data={curve} margin={{ top: 20, right: 22, bottom: 16, left: 0 }}><CartesianGrid stroke="var(--color-border)" vertical={false} /><XAxis dataKey="mass" type="number" domain={range[0] === range[1] ? [range[0] - 1, range[1] + 1] : range} allowDataOverflow tickFormatter={v => `${Number(v).toFixed(0)} g`} /><YAxis domain={['auto', 'auto']} tickFormatter={v => `${v} s`} width={58} /><Tooltip content={({ active, payload }) => {
      if (!active || !payload?.length) return null
      const point = payload[0].payload as { mass: number; predicted?: number; observed?: number; date?: string; altitude?: number; parachuteSize?: number; band?: number[] }
      return <div className="chart-tooltip"><b>{number(point.mass, ' g')}{point.date ? ` · ${point.date}` : ''}</b>{point.observed != null ? <><span>Recorded descent: {number(point.observed, ' s')}</span><small>{number((point.altitude ?? 0) * (metric ? .3048 : 1), metric ? ' m' : ' ft')} · {number((point.parachuteSize ?? 0) * (metric ? 2.54 : 1), metric ? ' cm chute' : ' in chute')}</small></> : <><span>Scenario estimate: {number(point.predicted, ' s')}</span>{point.band && <small>Empirical error band: {number(point.band[0])}–{number(point.band[1], ' s')}</small>}</>}</div>
    }} /><Area dataKey="band" name="Empirical error band" stroke="none" fill="#7758d8" fillOpacity={.15} isAnimationActive={false} /><Line dataKey="predicted" name="Scenario prediction" stroke="#7758d8" strokeWidth={3} dot={false} isAnimationActive={false} /><Scatter data={visible.map(l => ({ mass: l.rocketMass, observed: l.descentTime, date: l.date, altitude: l.altitude, parachuteSize: l.parachuteSize }))} dataKey="observed" name="Recorded flights" fill="#3478f6" isAnimationActive={false} />{conditions.mass >= range[0] && conditions.mass <= range[1] && <ReferenceLine x={conditions.mass} stroke="var(--color-text-muted)" strokeDasharray="4 4" />}</ComposedChart></ResponsiveContainer> : <div className="empty-chart"><b>{descent.model ? 'Check the scenario inputs' : 'More complete flights needed'}</b><span>{descentMethod === 'neural' ? 'The neural network needs 24 valid flights to train.' : 'Log at least four complete flights with valid recovery times.'}</span></div>}</div>
    <div className="lab-chart-key"><span><i className="legend-dot target" />Scenario prediction</span><span><i className="legend-dot low" />Recorded flights · original conditions</span><span>{descent.error80 !== null ? 'Shading: 80th percentile of held-out absolute errors' : 'Error band needs at least 8 held-out predictions'}</span></div>
    <MassRangeControl bounds={bounds} value={range} onChange={setZoom} count={visible.length} total={flights.length} />
    <p className="lab-footnote">Dots retain each flight’s actual conditions, so distance to this scenario curve is not prediction error. The curve describes an association, not a controlled experiment. The error band is descriptive, not a calibrated probability guarantee.</p>
    <Comparison suite={suites.descent} selected={descentMethod} setSelected={setDescentMethod} metric={metric} />
    <div className="lab-section-heading"><div><h3>Experimental rocket mass prediction</h3><p>Target: {number(targetAltitude * (metric ? .3048 : 1), metric ? ' m' : ' ft')} · uses the weather entered above.</p></div><ModelSelect label="Mass algorithm" results={suites.altitude.results} value={massMethod} setValue={setMassMethod} /></div>
    <div className="lab-summary"><div><span>Mass for target altitude</span><strong>{number(solution.mass, ' g')}</strong><small>{solution.reason}</small></div><div><span>Held-out mass error</span><strong>{number(altitude.massMae, ' g')}</strong><small>{altitude.massCount}/{altitude.total} flights had a supported solution</small></div><div><span>Held-out altitude error</span><strong>{number(altitude.mae === null ? null : altitude.mae * (metric ? .3048 : 1), metric ? ' m' : ' ft')}</strong><small>{altitude.tested}/{altitude.total} flights tested</small></div></div>
    {massCoverage.length > 0 && <p className="lab-notice">Weather outside logged coverage: {massCoverage.join(', ')}. Treat this mass estimate as an extrapolation in weather.</p>}
    <Comparison suite={suites.altitude} selected={massMethod} setSelected={setMassMethod} metric={metric} />
    <details className="lab-methodology"><summary>How to interpret these experiments</summary><p>Every model is refitted in each fold, including scaling and physics calibration. Flights on the same launch date stay together; up to five date groups are held out in turn. This measures interpolation to unseen dates, not a prospective test on future flights. Scores used to compare models are not independent confirmation of the winner.</p><p>Only positive, finite measurements are used. Descent requires a measured recovery time no longer than total flight time. Altitude models never use descent time, flight time, or observed altitude as input. Mass errors include only held-out flights whose target can be reached within the training masses; always compare the coverage counts too.</p><p>Physics assumes comparable rockets, motors, deployment and parachute geometry. The log does not yet identify those configurations or recovery mass. Launch mass is a proxy; the fitted calibration absorbs stable differences. Dry-air density uses station pressure and temperature. Humidity and wind are learned only in the statistical variants. Import comparable real flights before drawing flight-planning conclusions.</p><p>Neural results require 24 training flights in each validation fold. Fixed architecture: six tanh hidden units, 240 full-batch gradient steps, deterministic initialization and L2 regularization. No external flight dataset or pretrained weights are included.</p></details>
  </>
}

function ModelSelect({ label, results, value, setValue }: { label: string; results: ExperimentResult[]; value: Method; setValue: (value: Method) => void }) {
  return <label className="lab-model-select">{label}<select value={value} onChange={e => setValue(e.target.value as Method)}>{results.map(r => <option key={r.method} value={r.method}>{methodNames[r.method]}{!r.model ? ' · needs data' : ''}</option>)}</select></label>
}
function Comparison({ suite, selected, setSelected, metric }: { suite: Suite; selected: Method; setSelected: (value: Method) => void; metric: boolean }) {
  const best = bestResult(suite); const factor = suite.task === 'altitude' && metric ? .3048 : 1; const unit = suite.task === 'descent' ? 's' : metric ? 'm' : 'ft'
  return <div className="lab-comparison"><p><b>{best ? `Lowest held-out error: ${methodNames[best.method]}` : 'No fully validated comparison yet'}</b> · {suite.folds} date groups · {suite.excluded} incomplete or invalid flights excluded</p><div className="lab-table-scroll"><table><caption>{suite.task === 'descent' ? 'Descent' : 'Altitude and mass'} algorithm validation · lower error is better</caption><thead><tr><th>Algorithm</th><th>Mean error ({unit})</th><th>RMSE ({unit})</th><th>Held-out R²</th><th>Tested</th>{suite.task === 'altitude' && <th>Mass error / coverage</th>}</tr></thead><tbody>{suite.results.map(r => <tr key={r.method} className={selected === r.method ? 'selected' : ''}><th><button type="button" aria-pressed={selected === r.method} onClick={() => setSelected(r.method)}>{methodNames[r.method]}</button></th><td>{number(r.mae === null ? null : r.mae * factor)}</td><td>{number(r.rmse === null ? null : r.rmse * factor)}</td><td>{r.r2 === null ? '—' : r.r2.toFixed(2)}</td><td>{r.tested}/{r.total}</td>{suite.task === 'altitude' && <td>{number(r.massMae, ' g')} · {r.massCount}/{r.total}</td>}</tr>)}</tbody></table></div><p className="lab-footnote">{descriptions[selected]} {suite.flights.length < 20 ? 'Small sample: rankings can change substantially with new flights.' : ''} R² can be negative when a model predicts worse than the held-out mean.</p><details><summary>Inspect held-out flight predictions</summary><div className="lab-table-scroll"><table><thead><tr><th>Flight / date</th><th>Recorded ({unit})</th><th>Predicted ({unit})</th><th>Actual − predicted</th></tr></thead><tbody>{suite.results.find(r => r.method === selected)?.rows.map(row => <tr key={row.id}><td>{row.id} · {row.date}</td><td>{number(row.actual * factor)}</td><td>{number(row.predicted * factor)}</td><td>{number(row.residual * factor)}</td></tr>)}</tbody></table></div></details></div>
}
