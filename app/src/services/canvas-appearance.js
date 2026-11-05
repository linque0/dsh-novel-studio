export function normalizeCanvasOpacity(value) {
  if (value == null || value === '') return 100
  const numeric = Number(value)
  return Number.isFinite(numeric) ? Math.min(100, Math.max(0, Math.round(numeric))) : 100
}
