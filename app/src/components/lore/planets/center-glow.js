export const CENTER_GLOW_EFFECTS = Object.freeze({
  ripple: '波纹', breathe: '呼吸', pulse: '脉动', sweep: '流光', rainbow: '虹彩'
})

export const CENTER_GLOW_COLOR_MODES = Object.freeze({
  solid: '单色', cycle: '整圈逐色', zones: '分区错峰'
})

const CYCLE_SECONDS = { breathe: 3.6, pulse: 2.6 }
const TAU = 2 * Math.PI

export function hasCenterColorModes(effect) {
  return effect === 'breathe' || effect === 'pulse'
}

export const DEFAULT_CENTER_GLOW = Object.freeze({
  color: '#edb56d', brightness: 100, effect: 'ripple', speed: 100, colorMode: 'solid'
})

function percent(value, fallback, max) {
  return Number.isFinite(value) ? Math.round(Math.max(0, Math.min(max, value))) : fallback
}

export function normalizeCenterGlow(value) {
  const { color, brightness, effect, speed, colorMode } = value || {}
  const mode = effect === 'twinkle' ? 'pulse' : effect
  return {
    color: typeof color === 'string' && /^#[\da-f]{6}$/i.test(color) ? color.toLowerCase() : DEFAULT_CENTER_GLOW.color,
    brightness: percent(brightness, DEFAULT_CENTER_GLOW.brightness, 150),
    effect: typeof mode === 'string' && Object.hasOwn(CENTER_GLOW_EFFECTS, mode) ? mode : DEFAULT_CENTER_GLOW.effect,
    speed: percent(speed, DEFAULT_CENTER_GLOW.speed, 200),
    colorMode: typeof colorMode === 'string' && Object.hasOwn(CENTER_GLOW_COLOR_MODES, colorMode) ? colorMode : 'solid'
  }
}

export function advanceCenterGlow(time, delta, speed) {
  return time + Math.max(0, Math.min(40, delta)) * speed / 100
}

function fraction(value) {
  return value - Math.floor(value)
}

export function centerGlowSample(effect, colorMode, time, angle = 0) {
  const cycles = time / (CYCLE_SECONDS[effect] || 1)
  const phase = fraction(cycles)
  if (colorMode === 'zones') {
    const turn = fraction(angle / TAU)
    return { phase: fraction(cycles - turn), hueOffset: turn * 360 }
  }
  if (colorMode === 'cycle') {
    // The color crossfade starts once this breath or pulse has mostly faded.
    const next = Math.max(0, (phase - .78) / .22)
    const mix = next * next * (3 - 2 * next)
    return { phase, hueOffset: (Math.floor(cycles) % 6 + mix) * 60 }
  }
  return { phase, hueOffset: 0 }
}

export function centerGlowPulse(phase) {
  return .43 + .77 * Math.sin(Math.PI * phase) ** 2
}

export function centerGlowWave(phase) {
  return phase < .82 ? Math.sin(Math.PI * phase / .82) * (1 - phase) : 0
}

export function centerGlowEdge(effect, angle, time) {
  switch (effect) {
    case 'sweep': return .06 + .94 * ((1 + Math.cos(angle - time * 1.42)) / 2) ** 4
    case 'rainbow': return .53 + .26 * Math.sin(angle * 2 - time * 1.1)
    case 'pulse':
    case 'breathe': return .62
    default: return (1 + Math.sin(angle * 4 - time * 1.55) * Math.cos(angle * 3 + time * .82)) / 2
  }
}

export function glowRgb(hex) {
  return [1, 3, 5].map(offset => Number.parseInt(hex.slice(offset, offset + 2), 16))
}

export function glowHue([r, g, b]) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const delta = max - min
  if (!delta) return 0
  const sector = max === r ? (g - b) / delta : max === g ? 2 + (b - r) / delta : 4 + (r - g) / delta
  return (sector * 60 + 360) % 360
}
