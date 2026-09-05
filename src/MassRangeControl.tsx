import { useId, type CSSProperties } from 'react'

import { clampMassRange } from './massRange'

export function MassRangeControl({ bounds, value, onChange, count, total }: {
  bounds: [number, number]; value: [number, number]; onChange: (value: [number, number] | null) => void; count: number; total: number
}) {
  const id = useId(); const [min, max] = bounds; const [low, high] = clampMassRange(value, bounds)
  const disabled = max <= min; const span = max - min || 1
  const update = (index: 0 | 1, number: number) => {
    if (!Number.isFinite(number)) return
    const bounded = Math.max(min, Math.min(max, number))
    onChange(index === 0 ? [Math.min(bounded, high), high] : [low, Math.max(bounded, low)])
  }
  return <div className="mass-range-control" role="group" aria-label="Mass range zoom">
    <div className="mass-range-heading"><span><b>Mass range</b> · {count} of {total} flights visible</span><button type="button" className="text-button" onClick={() => onChange(null)} disabled={low === min && high === max}>Reset zoom</button></div>
    <div className="mass-range-inputs"><label htmlFor={`${id}-min`}>From <input id={`${id}-min`} aria-label="Minimum visible mass" type="number" min={min} max={high} step="any" disabled={disabled} value={Number(low.toFixed(2))} onChange={e => { if (e.target.value !== '') update(0, e.target.valueAsNumber) }} /> g</label><span aria-hidden="true">—</span><label htmlFor={`${id}-max`}>To <input id={`${id}-max`} aria-label="Maximum visible mass" type="number" min={low} max={max} step="any" disabled={disabled} value={Number(high.toFixed(2))} onChange={e => { if (e.target.value !== '') update(1, e.target.valueAsNumber) }} /> g</label></div>
    <div className="mass-range-track" style={{ '--range-start': `${100 * (low - min) / span}%`, '--range-end': `${100 * (high - min) / span}%` } as CSSProperties}>
      <div className="mass-range-rail" /><div className="mass-range-fill" />
      <input aria-label="Lower mass handle" aria-valuetext={`${low.toFixed(1)} grams`} type="range" min={min} max={max} step="any" value={low} disabled={disabled} onChange={e => update(0, e.target.valueAsNumber)} />
      <input aria-label="Upper mass handle" aria-valuetext={`${high.toFixed(1)} grams`} type="range" min={min} max={max} step="any" value={high} disabled={disabled} onChange={e => update(1, e.target.valueAsNumber)} />
    </div>
    <div className="mass-range-ticks"><span>{min.toFixed(1)} g</span><span>{disabled ? 'One recorded mass' : 'Drag either handle or enter exact bounds'}</span><span>{max.toFixed(1)} g</span></div>
  </div>
}
