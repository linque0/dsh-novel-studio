export const DEFAULT_FLOW_SPEED = 1

export function normalizeFlowSpeed(value) {
  if (!Number.isFinite(value)) return DEFAULT_FLOW_SPEED
  return Math.round(Math.min(2, Math.max(0, value)) * 10) / 10
}

export function advanceFlowTime(time, elapsedMs, speed) {
  return time + Math.max(0, Math.min(64, elapsedMs)) / 1000 * speed
}

export function flowBufferSize(width, height, dpr, quality, maxEdge) {
  const pixelBudget = 2560 * 1440
  const ratio = Math.min(dpr, Math.sqrt(pixelBudget / (width * height)), maxEdge / Math.max(width, height)) * quality
  return [width, height].map(edge => Math.max(1, Math.floor(edge * ratio + 1e-9)))
}
