export function clampMassRange(value: [number, number] | null, bounds: [number, number]): [number, number] {
  const [min, max] = bounds
  if (!value || value.some(v => !Number.isFinite(v)) || value[1] < min || value[0] > max) return bounds
  return [Math.max(min, Math.min(value[0], max)), Math.max(min, Math.min(Math.max(value[0], value[1]), max))]
}

