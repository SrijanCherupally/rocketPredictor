import { useEffect, useMemo, useState } from 'react'
import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis } from 'recharts'
import type { DescentConditions, Launch } from './analytics'
import { bestResult, descriptions, methodNames, modelLabel, massWeatherEffect, usesWeather, outsideCoverage, predictModel, solveMass, validConditions, type ExperimentResult, type Method, type Suite, type Task } from './experiments'
import { MassRangeControl } from './MassRangeControl'
import { clampMassRange } from './massRange'
import { seedLaunches } from './seed'
import { legacyEngine } from './legacyEngine'

type Suites = { descent: Suite; altitude: Suite; error?: string }
type Props = { launches: Launch[]; conditions: DescentConditions; setConditions: React.Dispatch<React.SetStateAction<DescentConditions>>; targetAltitude: number; units: 'imperial' | 'metric' }
type ConditionField = { key: keyof Omit<DescentConditions, 'flightTime'>; label: string; unit: string; factor?: number; offset?: number; min?: number; max?: number }
const number = (v: number | null | undefined, suffix = '') => v == null || !Number.isFinite(v) ? '—' : `${v.toFixed(1)}${suffix}`

function ConditionFields({ fields, conditions, setConditions, className = '' }: { fields: ConditionField[]; conditions: DescentConditions; setConditions: Props['setConditions']; className?: string }) {
  return <div className={`lab-inputs ${className}`.trim()}>{fields.map(field => <label key={field.key}>{field.label}<span><input aria-label={field.label} type="number" step="any" min={field.min} max={field.max} value={Number((conditions[field.key] * (field.factor ?? 1) + (field.offset ?? 0)).toFixed(3))} onChange={e => { if (e.target.value !== '' && Number.isFinite(e.target.valueAsNumber)) setConditions(current => ({ ...current, [field.key]: (e.target.valueAsNumber - (field.offset ?? 0)) / (field.factor ?? 1) })) }} />{field.unit}</span></label>)}</div>
}

export function PredictionLab({ launches, ...props }: Props) {
  const legacyLaunches = useMemo(() => legacyEngine.toLegacyLaunches(launches), [launches])
  const demoCount = legacyLaunches.filter(launch => seedLaunches.some(seed => Object.entries(seed).every(([key, value]) => launch[key as keyof Launch] === value))).length
  const [result, setResult] = useState<{ source: Launch[]; suites?: Suites; error?: string } | null>(null)
  useEffect(() => {
    const worker = new Worker(new URL('./experiments.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (event: MessageEvent<Suites>) => setResult({ source: legacyLaunches, suites: event.data.error ? undefined : event.data, error: event.data.error })
    worker.onerror = () => setResult({ source: legacyLaunches, error: 'Prediction experiments could not load. Reload to retry; original models remain available.' })
    worker.postMessage(legacyLaunches)
    return () => worker.terminate()
  }, [legacyLaunches])
  const ready = result?.source === legacyLaunches
  return <section className="prediction-lab" aria-busy={!ready}>
    <div className="lab-intro"><div><p className="eyebrow">EXPERIMENTAL MODELS · ORIGINALS PRESERVED</p><h2>Flight prediction lab</h2><p>Compare algorithms on the selected flight dates. Zoom changes the view; it never changes model training.</p></div><span className="lab-pill">{legacyLaunches.length} logged flights</span></div>
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
  const weatherEffect = altitude.model ? massWeatherEffect(altitude.model, suites.altitude.flights, targetAltitude, conditions) : { referenceMass: null, delta: null }
  const metric = units === 'metric'
  const recoveryFields: ConditionField[] = [
    { key: 'mass', label: 'Rocket mass', unit: 'g', min: .1 },
    { key: 'altitude', label: 'Descent altitude', unit: metric ? 'm' : 'ft', factor: metric ? .3048 : 1, min: .1 },
    { key: 'parachuteSize', label: 'Parachute diameter', unit: metric ? 'cm' : 'in', factor: metric ? 2.54 : 1, min: .1 },
  ]
  const weatherFields: ConditionField[] = [
    { key: 'wind', label: 'Wind', unit: metric ? 'km/h' : 'mph', factor: metric ? 1.60934 : 1, min: 0 },
    { key: 'temperature', label: 'Temperature', unit: metric ? '°C' : '°F', factor: metric ? 5 / 9 : 1, offset: metric ? -32 * 5 / 9 : 0 },
    { key: 'pressure', label: 'Station pressure', unit: metric ? 'hPa' : 'inHg', factor: metric ? 33.8639 : 1, min: .1 },
    { key: 'humidity', label: 'Humidity', unit: '%', min: 0, max: 100 },
  ]
  return <>
    {!validConditions(conditions) && <p className="lab-notice" role="alert">Enter positive mass, altitude, parachute diameter and pressure, nonnegative wind, and humidity from 0–100%.</p>}
    <section className="lab-stage lab-stage-mass" aria-labelledby="mass-planner-heading">
      <div className="lab-section-heading"><div><p className="lab-step">01 · PLAN THE FLIGHT</p><h3 id="mass-planner-heading">Ideal launch mass</h3><p>Adjust the expected weather to calculate a launch mass for {number(targetAltitude * (metric ? .3048 : 1), metric ? ' m' : ' ft')}.</p></div><ModelSelect task="altitude" label="Mass algorithm" results={suites.altitude.results} value={massMethod} setValue={setMassMethod} /></div>
      <div className="lab-mass-planner">
        <div className="lab-control-card"><div className="lab-control-heading"><div><span>Launch conditions</span><b>Weather adjustment</b></div><em>{usesWeather(massMethod, 'altitude') ? 'Used by this model' : 'Not used by this model'}</em></div><ConditionFields fields={weatherFields} conditions={conditions} setConditions={setConditions} className="lab-weather-inputs" /><p>Changes update the ideal mass immediately and also carry into the descent estimate.</p></div>
        <div className="lab-primary-result lab-mass-result" aria-live="polite"><span>Recommended launch mass</span><strong>{number(solution.mass, ' g')}</strong><small>{solution.reason}</small></div>
      </div>
      <div className="lab-summary lab-validation-summary"><div><span>Held-out mass error</span><strong>{number(altitude.massMae, ' g')}</strong><small>{altitude.massCount}/{altitude.total} flights had a supported solution</small></div><div><span>Held-out altitude error</span><strong>{number(altitude.mae === null ? null : altitude.mae * (metric ? .3048 : 1), metric ? ' m' : ' ft')}</strong><small>{altitude.tested}/{altitude.total} flights tested</small></div></div>
      <div className="lab-weather-effect" aria-live="polite"><b>{usesWeather(massMethod, 'altitude') ? 'Weather adjustment is active' : 'This algorithm is mass-only'}</b><p>{usesWeather(massMethod, 'altitude') ? weatherEffect.delta === null ? 'Weather effect cannot be compared: the current or median-weather scenario has no supported mass solution.' : `${weatherEffect.delta >= 0 ? '+' : ''}${weatherEffect.delta.toFixed(2)} g versus ${number(weatherEffect.referenceMass, ' g')} at median logged weather. A zero change can mean the log has not learned a weather effect.` : 'These conditions still affect the descent estimate, but this mass algorithm ignores them. Choose Original weather regression, Regularized regression, Nearest flights, or Neural network for a weather-adjusted mass.'}</p><small>Scenario edits do not change validation scores; each validation flight uses its own recorded weather.</small></div>
      {usesWeather(massMethod, 'altitude') && massCoverage.length > 0 && <p className="lab-notice">Weather outside logged coverage: {massCoverage.join(', ')}. Treat this mass estimate as an extrapolation in weather.</p>}
      <ComparisonDisclosure suite={suites.altitude} selected={massMethod} setSelected={setMassMethod} metric={metric} />
    </section>
    <section className="lab-stage lab-stage-descent" aria-labelledby="descent-heading">
    <div className="lab-section-heading"><div><p className="lab-step">02 · CHECK RECOVERY</p><h3 id="descent-heading">Descent sensitivity</h3><p>Adjust the rocket and recovery setup while holding the launch weather above constant.</p></div><ModelSelect task="descent" label="Descent algorithm" results={suites.descent.results} value={descentMethod} setValue={setDescentMethod} /></div>
    <div className="lab-control-card lab-recovery-card"><div className="lab-control-heading"><div><span>Recovery setup</span><b>Rocket and parachute</b></div></div><ConditionFields fields={recoveryFields} conditions={conditions} setConditions={setConditions} className="lab-recovery-inputs" /></div>
    <div className="lab-summary" aria-live="polite"><div><span>At {number(conditions.mass, ' g')}</span><strong>{number(prediction, ' s')}</strong><small>{methodNames[descentMethod]}</small></div><div><span>Across {number(range[0])}–{number(range[1], ' g')}</span><strong>{low != null && high != null ? `${high - low >= 0 ? '+' : ''}${number(high - low, ' s')}` : '—'}</strong><small>Modeled change in descent time</small></div><div><span>Held-out mean error</span><strong>{number(descent.mae, ' s')}</strong><small>{descent.tested}/{descent.total} flights tested on unseen dates</small></div></div>
    {coverage.length > 0 && <p className="lab-notice">Outside logged coverage: {coverage.join(', ')}. This scenario is an extrapolation; error estimates may not transfer.</p>}
    <div className="lab-chart">{descent.model && prediction !== null ? <ResponsiveContainer width="100%" height="100%"><ComposedChart data={curve} margin={{ top: 20, right: 22, bottom: 16, left: 0 }}><CartesianGrid stroke="var(--color-border)" vertical={false} /><XAxis dataKey="mass" type="number" domain={range[0] === range[1] ? [range[0] - 1, range[1] + 1] : range} allowDataOverflow tickFormatter={v => `${Number(v).toFixed(0)} g`} /><YAxis domain={['auto', 'auto']} tickFormatter={v => `${v} s`} width={58} /><Tooltip content={({ active, payload }) => {
      if (!active || !payload?.length) return null
      const point = payload[0].payload as { mass: number; predicted?: number; observed?: number; date?: string; altitude?: number; parachuteSize?: number; band?: number[] }
      return <div className="chart-tooltip"><b>{number(point.mass, ' g')}{point.date ? ` · ${point.date}` : ''}</b>{point.observed != null ? <><span>Recorded descent: {number(point.observed, ' s')}</span><small>{number((point.altitude ?? 0) * (metric ? .3048 : 1), metric ? ' m' : ' ft')} · {number((point.parachuteSize ?? 0) * (metric ? 2.54 : 1), metric ? ' cm chute' : ' in chute')}</small></> : <><span>Scenario estimate: {number(point.predicted, ' s')}</span>{point.band && <small>Empirical error band: {number(point.band[0])}–{number(point.band[1], ' s')}</small>}</>}</div>
    }} /><Area dataKey="band" name="Empirical error band" stroke="none" fill="#7758d8" fillOpacity={.15} isAnimationActive={false} /><Line dataKey="predicted" name="Scenario prediction" stroke="#7758d8" strokeWidth={3} dot={false} isAnimationActive={false} /><Scatter data={visible.map(l => ({ mass: l.rocketMass, observed: l.descentTime, date: l.date, altitude: l.altitude, parachuteSize: l.parachuteSize }))} dataKey="observed" name="Recorded flights" fill="#3478f6" isAnimationActive={false} />{conditions.mass >= range[0] && conditions.mass <= range[1] && <ReferenceLine x={conditions.mass} stroke="var(--color-text-muted)" strokeDasharray="4 4" />}</ComposedChart></ResponsiveContainer> : <div className="empty-chart"><b>{descent.model ? 'Check the scenario inputs' : 'More complete flights needed'}</b><span>{descentMethod === 'neural' ? 'The small-data neural network needs four valid flights to train.' : 'Log at least four complete flights with valid recovery times.'}</span></div>}</div>
    <div className="lab-chart-key"><span><i className="legend-dot target" />Scenario prediction</span><span><i className="legend-dot low" />Recorded flights · original conditions</span><span>{descent.error80 !== null ? 'Shading: 80th percentile of held-out absolute errors' : 'Error band needs at least 8 held-out predictions'}</span></div>
    <MassRangeControl bounds={bounds} value={range} onChange={setZoom} count={visible.length} total={flights.length} />
    <p className="lab-footnote">Dots retain each flight’s actual conditions, so distance to this scenario curve is not prediction error. The curve describes an association, not a controlled experiment. The error band is descriptive, not a calibrated probability guarantee.</p>
    <ComparisonDisclosure suite={suites.descent} selected={descentMethod} setSelected={setDescentMethod} metric={metric} />
    </section>
    <details className="lab-methodology"><summary>How to interpret these experiments</summary><p>Every model is refitted in each fold, including scaling and physics calibration. Flights on the same launch date stay together; up to five date groups are held out in turn. This measures interpolation to unseen dates, not a prospective test on future flights. Scores used to compare models are not independent confirmation of the winner.</p><p>Only positive, finite measurements are used. Descent requires a measured recovery time no longer than total flight time. Altitude models never use descent time, flight time, or observed altitude as input. Mass errors include only held-out flights whose target can be reached within the training masses; always compare the coverage counts too.</p><p>Physics assumes comparable rockets, motors, deployment and parachute geometry. The log does not yet identify those configurations or recovery mass. Launch mass is a proxy; the fitted calibration absorbs stable differences. Dry-air density uses station pressure and temperature. Humidity and wind are learned only in the statistical variants. Import comparable real flights before drawing flight-planning conclusions.</p><p>The small-data neural network trains from four flights, including four-flight validation folds in an eight-flight log. Three tanh hidden units learn weather corrections to a physical prior fitted only on the training flights. Training uses 320 gradient steps, deterministic initialization, L2 regularization, bounded weather inputs and a bounded log correction (±0.2). Unvaried weather inputs have zero learned influence. This is a hybrid model, not a large pretrained network; small-sample results remain exploratory.</p></details>
  </>
}

function ModelSelect({ label, results, value, setValue, task }: { label: string; results: ExperimentResult[]; value: Method; setValue: (value: Method) => void; task: Task }) {
  return <label className="lab-model-select">{label}<select value={value} onChange={e => setValue(e.target.value as Method)}>{results.map(r => <option key={r.method} value={r.method}>{modelLabel(r.method, task)}{task === 'altitude' && !usesWeather(r.method, task) ? ' · no weather' : ''}{!r.model ? ' · needs data' : ''}</option>)}</select></label>
}

function exportValidation(suite: Suite) {
  const report = { engineVersion: 'legacy-v1', units: { altitude: 'ft', mass: 'g', descent: 's', wind: 'mph', pressure: 'inHg', temperature: 'F', parachute: 'in', humidity: '%' }, validation: 'Grouped by launch date; scaling and fitting use training folds only. Finite nonpositive forecasts count as errors.', ...suite }
  const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }))
  const link = document.createElement('a'); link.href = url; link.download = `apexFlite-${suite.task}-validation.json`; link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function ComparisonDisclosure(props: { suite: Suite; selected: Method; setSelected: (value: Method) => void; metric: boolean }) {
  const best = bestResult(props.suite)
  return <details className="lab-comparison-disclosure"><summary><span>{props.suite.task === 'altitude' ? 'Compare mass algorithms' : 'Compare descent algorithms'}</span><small>{best ? `Best held-out result: ${modelLabel(best.method, props.suite.task)}` : 'Validation details and flight-by-flight audit'}</small></summary><Comparison {...props} /></details>
}

function Comparison({ suite, selected, setSelected, metric }: { suite: Suite; selected: Method; setSelected: (value: Method) => void; metric: boolean }) {
  const best = bestResult(suite)
  const factor = suite.task === 'altitude' && metric ? .3048 : 1
  const unit = suite.task === 'descent' ? 's' : metric ? 'm' : 'ft'
  const result = suite.results.find(r => r.method === selected)!
  const error = (v: number | null) => v === null ? '—' : (v * factor).toFixed(2)
  const minTraining = result.validationFolds.length ? Math.min(...result.validationFolds.map(f => f.trainingCount)) : 0
  const parameterCount = result.model?.legacy ? result.model.legacy.coefficients.length + 1 : null
  const sumErrors = result.rows.reduce((sum, row) => sum + Math.abs(row.residual), 0)
  return <div className="lab-comparison">
    <div className="lab-comparison-heading"><p><b>{best ? `Lowest held-out error: ${modelLabel(best.method, suite.task)}` : 'No fully validated comparison yet'}</b> · {suite.folds} validation folds grouped by launch date · {suite.excluded} invalid/incomplete flights excluded</p><button type="button" className="text-button" onClick={() => exportValidation(suite)}>Export validation details</button></div>
    <p className="lab-footnote"><b>Training MAE</b> measures the fitted model on flights it has seen. <b>Held-out MAE</b> measures refitted models on flights excluded from training. These are different tests; the original Overview cards show training MAE.</p>
    <div className="lab-table-scroll"><table>
      <caption>{suite.task === 'descent' ? 'Descent' : 'Altitude and mass'} algorithm validation · lower error is better</caption>
      <thead><tr><th>Algorithm</th><th>Training MAE ({unit})</th><th>Held-out MAE ({unit})</th><th>Held-out RMSE ({unit})</th><th>Held-out R²</th><th>Scored flights</th>{suite.task === 'altitude' && <th>Mass MAE / solved flights</th>}</tr></thead>
      <tbody>{suite.results.map(r => <tr key={r.method} className={selected === r.method ? 'selected' : ''}>
        <th><button type="button" aria-pressed={selected === r.method} onClick={() => setSelected(r.method)}>{modelLabel(r.method, suite.task)}</button></th>
        <td title={`${r.trainingCount}/${r.total} training predictions`}>{error(r.trainingMae)}</td><td>{error(r.mae)}</td><td>{error(r.rmse)}</td><td>{r.r2 === null ? '—' : r.r2.toFixed(2)}</td><td>{r.tested}/{r.total}</td>{suite.task === 'altitude' && <td>{number(r.massMae, ' g')} · {r.massCount}/{r.total}</td>}
      </tr>)}</tbody>
    </table></div>
    {parameterCount !== null && minTraining > 0 && minTraining <= parameterCount + 1 && <p className="lab-notice">Sparse regression fit: the smallest training fold has {minTraining} flights for {parameterCount} fitted parameters, including the intercept. Training error can look small while held-out predictions are unstable. The original algorithm is unchanged.</p>}
    {result.r2 !== null && result.r2 < 0 && <p className="lab-notice">This model generalizes poorly on these held-out flights: its squared error is {(1 - result.r2).toFixed(2)}× the error of predicting the scored flights’ mean. Negative R² is valid and is not a percentage. Inspect the flight rows below for the large misses.</p>}
    {selected === 'neural' && result.model && <p className="lab-notice">Small-data neural model active · {result.model.sampleSize} training flights · {result.tested}/{result.total} held-out predictions. A physical trend anchors the prediction; a three-unit neural network learns a bounded weather correction. Eight flights can run the model, but do not establish reliable future accuracy.</p>}
    <p className="lab-footnote">{descriptions[selected]} {suite.flights.length < 20 ? 'Small sample: rankings can change substantially with new flights.' : ''} Mass MAE uses only flights with a supported mass solution; its denominator can be smaller than the altitude score’s.</p>
    <details><summary>Inspect held-out flight predictions · {modelLabel(selected, suite.task)}</summary>
      <p className="lab-footnote">MAE = sum of absolute errors / scored flights = {error(sumErrors)} {unit} / {result.tested} = {error(result.mae)} {unit}. RMSE = square root of mean squared error. Displayed rows are rounded; calculations use full precision. Finite negative forecasts remain in these scores.</p>
      <div className="lab-table-scroll"><table><thead><tr><th>Flight / date</th><th>Fold / training flights</th><th>Recorded ({unit})</th><th>Held-out prediction ({unit})</th><th>Absolute error ({unit})</th><th>Outside training range</th>{suite.task === 'altitude' && <><th>Recorded mass (g)</th><th>Predicted mass (g)</th><th>Mass error / reason</th></>}</tr></thead><tbody>
        {result.rows.map(row => <tr key={row.id}><td>{row.id} · {row.date}</td><td>{row.fold} / {row.trainingCount}</td><td>{error(row.actual)}</td><td>{error(row.predicted)}{row.predicted <= 0 ? ' · nonphysical' : ''}</td><td>{error(Math.abs(row.residual))}</td><td>{row.outsideTraining.join(', ') || 'None'}</td>{suite.task === 'altitude' && <><td>{number(row.recordedMass)}</td><td>{number(row.predictedMass)}</td><td className="lab-reason">{row.massError === null ? row.massReason : number(row.massError, ' g')}</td></>}</tr>)}
      </tbody></table></div>
      <div className="lab-table-scroll lab-fold-table"><table><thead><tr><th>Fold</th><th>Training flights</th><th>Held-out flights</th><th>Scored flights</th><th>Status</th></tr></thead><tbody>{result.validationFolds.map(fold => <tr key={fold.fold}><td>{fold.fold}</td><td>{fold.trainingCount}</td><td>{fold.testCount}</td><td>{fold.scoredCount}</td><td>{fold.reason || 'All held-out flights scored'}</td></tr>)}</tbody></table></div>
    </details>
  </div>
}
