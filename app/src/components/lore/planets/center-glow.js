/**
 * 星系中心恒星辉光与棱镜色散光谱计算模块：
 * 支持跟随流动背景、星仪原色与自定义三类数据源，以及欧泊/双色流转/分层折射/棱镜色散/单色五种着色模式，
 * 负责旧版设置迁移、跨主题光谱插值与每帧边缘/脉动采样。
 */
export const CENTER_GLOW_COLOR_SOURCES = Object.freeze({
  backdrop: '跟随背景',
  classic: '星仪原色',
  custom: '自定义'
})

export const CENTER_GLOW_EFFECTS = Object.freeze({
  ripple: '谐波',
  breathe: '呼吸',
  pulse: '脉动',
  sweep: '流光'
})

export const CENTER_GLOW_COLOR_MODES = Object.freeze({
  opal: '欧泊三彩',
  flow: '双色流转',
  layered: '分层折射',
  prism: '棱镜色散',
  solid: '纯净单色'
})

export const FALLBACK_BACKDROP_PALETTE = Object.freeze({
  a: [0.18, 0.22, 0.5],
  b: [0.85, 0.4, 0.35],
  c: [0.06, 0.07, 0.16]
})

export const CLASSIC_PRISM_SPECTRUM = Object.freeze({
  primary: Object.freeze([71, 215, 232]),    // #47D7E8 冰川青
  accent: Object.freeze([140, 123, 255]),    // #8C7BFF 星渊紫
  deep: Object.freeze([43, 76, 126]),        // #2B4C7E 深空折射蓝
  platinum: Object.freeze([234, 243, 255]),  // #EAF3FF 冷铂白
  highlight: Object.freeze([234, 243, 255]), // 兼容别名
  coreGlow: Object.freeze([145, 236, 248])   // 极亮冰青内光
})

const LEGACY_DEFAULT_COLOR = '#47d7e8'
const HEX_COLOR_RE = /^#[\da-f]{6}$/i
const LEGACY_COLOR_MODE_MAP = Object.freeze({
  cycle: 'flow',
  zones: 'layered',
  solid: 'solid'
})
const CYCLE_SECONDS = Object.freeze({
  ripple: 4.2,
  breathe: 3.8,
  pulse: 2.8,
  sweep: 3.2
})
const TAU = 2 * Math.PI
const PLATINUM_BASE = Object.freeze([238, 246, 255])

export const DEFAULT_CENTER_GLOW = Object.freeze({
  colorSource: 'backdrop',
  color: '#47d7e8',
  accentColor: '#8c7bff',
  brightness: 100,
  effect: 'ripple',
  speed: 100,
  colorMode: 'opal'
})

export function hasCenterColorModes() {
  return true
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function percent(value, fallback, max) {
  return Number.isFinite(value) ? Math.round(clamp(value, 0, max)) : fallback
}

function fraction(value) {
  return value - Math.floor(value)
}

export function hueDiff(h1, h2) {
  return ((h2 - h1 + 540) % 360) - 180
}

function pickRefractionHue(primaryHue, accentHue) {
  const delta = hueDiff(primaryHue, accentHue)
  if (Math.abs(delta) >= 48) return ((accentHue % 360) + 360) % 360
  const span = 60
  const candPlus = (primaryHue + span) % 360
  const candMinus = (primaryHue - span + 360) % 360
  // Avoid pushing warm/green palettes into muddy chartreuse-olive hues on deep space dark.
  const isMuddy = h => h >= 62 && h <= 122
  if (isMuddy(candPlus) && !isMuddy(candMinus)) return candMinus
  if (isMuddy(candMinus) && !isMuddy(candPlus)) return candPlus
  const dir = Math.abs(delta) > 3 ? Math.sign(delta) : 1
  return (primaryHue + dir * span + 360) % 360
}

export function glowRgb(hex) {
  const raw = typeof hex === 'string' && HEX_COLOR_RE.test(hex) ? hex : LEGACY_DEFAULT_COLOR
  return [1, 3, 5].map(offset => Number.parseInt(raw.slice(offset, offset + 2), 16))
}

export function rgbToHex(rgb) {
  return '#' + rgb.map(channel => Math.round(clamp(channel, 0, 255)).toString(16).padStart(2, '0')).join('')
}

export function rgbaString(rgb, alpha = 1) {
  const r = Math.round(clamp(rgb?.[0] ?? 71, 0, 255))
  const g = Math.round(clamp(rgb?.[1] ?? 215, 0, 255))
  const b = Math.round(clamp(rgb?.[2] ?? 232, 0, 255))
  const a = clamp(Number.isFinite(alpha) ? alpha : 1, 0, 1)
  return `rgba(${r}, ${g}, ${b}, ${Math.round(a * 1000) / 1000})`
}

export function mixRgb(a, b, t) {
  const k = clamp(t, 0, 1)
  return [
    a[0] + (b[0] - a[0]) * k,
    a[1] + (b[1] - a[1]) * k,
    a[2] + (b[2] - a[2]) * k
  ]
}

export function rgbToHsl([r, g, b]) {
  const nr = clamp(r, 0, 255) / 255
  const ng = clamp(g, 0, 255) / 255
  const nb = clamp(b, 0, 255) / 255
  const max = Math.max(nr, ng, nb)
  const min = Math.min(nr, ng, nb)
  const l = (max + min) / 2
  const delta = max - min
  if (!delta) return { h: 0, s: 0, l }
  const s = delta / (1 - Math.abs(2 * l - 1))
  const sector = max === nr ? (ng - nb) / delta : max === ng ? 2 + (nb - nr) / delta : 4 + (nr - ng) / delta
  return { h: (sector * 60 + 360) % 360, s, l }
}

export function hslToRgb(h, s, l) {
  const hue = ((h % 360) + 360) % 360
  const sat = clamp(s, 0, 1)
  const light = clamp(l, 0, 1)
  const c = (1 - Math.abs(2 * light - 1)) * sat
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1))
  const m = light - c / 2
  let r = 0, g = 0, b = 0
  if (hue < 60) [r, g, b] = [c, x, 0]
  else if (hue < 120) [r, g, b] = [x, c, 0]
  else if (hue < 180) [r, g, b] = [0, c, x]
  else if (hue < 240) [r, g, b] = [0, x, c]
  else if (hue < 300) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255]
}

export function glowHue(rgb) {
  return rgbToHsl(rgb).h
}

export function deriveAccentHex(hex) {
  const { h, s } = rgbToHsl(glowRgb(hex))
  const shiftedHue = pickRefractionHue(h, (h + 1) % 360)
  const nextS = s < 0.06 ? s : clamp(Math.max(s * 1.15, 0.80), 0.80, 0.94)
  return rgbToHex(hslToRgb(shiftedHue, nextS, 0.66))
}

function tuneJewelRgb(rgb255, { minL, maxL, minS, maxS, satBoost = 1.32 }) {
  const { h, s, l } = rgbToHsl(rgb255)
  const neutral = s < 0.06
  const nextS = neutral ? s : clamp(Math.max(s * satBoost, minS), minS, maxS)
  const nextL = clamp(l, minL, maxL)
  return hslToRgb(h, nextS, nextL)
}

function channelTriplet(raw, fallback) {
  if (!Array.isArray(raw) || raw.length < 3) return fallback.map(v => v * 255)
  const nums = raw.slice(0, 3).map(Number)
  if (!nums.every(Number.isFinite)) return fallback.map(v => v * 255)
  const scale = nums.some(v => v > 1.01) ? 1 : 255
  return nums.map(v => clamp(v * scale, 0, 255))
}

function buildSpectrum(primary, accent, deep, platinumOverride = null) {
  const platinum = platinumOverride || mixRgb(PLATINUM_BASE, primary, 0.08)
  const coreGlow = mixRgb(primary, [242, 250, 255], 0.34)
  return { primary, accent, deep, platinum, highlight: platinum, coreGlow }
}

export function deriveBackdropSpectrum(palette) {
  const source = palette && typeof palette === 'object' ? palette : FALLBACK_BACKDROP_PALETTE
  const a255 = channelTriplet(source.a, FALLBACK_BACKDROP_PALETTE.a)
  const b255 = channelTriplet(source.b, FALLBACK_BACKDROP_PALETTE.b)
  const c255 = channelTriplet(source.c, FALLBACK_BACKDROP_PALETTE.c)

  const primary = tuneJewelRgb(a255, { minL: 0.54, maxL: 0.62, minS: 0.78, maxS: 0.94 })
  let accent = tuneJewelRgb(b255, { minL: 0.60, maxL: 0.71, minS: 0.80, maxS: 0.96 })

  const pHsl = rgbToHsl(primary)
  const aHsl = rgbToHsl(accent)
  const targetAccentHue = pickRefractionHue(pHsl.h, aHsl.h)
  if (Math.abs(hueDiff(aHsl.h, targetAccentHue)) > 0.5) {
    accent = hslToRgb(
      targetAccentHue,
      aHsl.s < 0.06 ? aHsl.s : clamp(Math.max(aHsl.s, 0.82), 0.82, 0.96),
      clamp(aHsl.l, 0.60, 0.71)
    )
  }

  const deep = tuneJewelRgb(mixRgb(c255, a255, 0.45), { minL: 0.30, maxL: 0.44, minS: 0.58, maxS: 0.84, satBoost: 1.2 })
  return buildSpectrum(primary, accent, deep)
}

export function deriveCustomSpectrum(colorHex, accentHex, colorMode = 'opal') {
  const primary = tuneJewelRgb(glowRgb(colorHex), { minL: 0.50, maxL: 0.68, minS: 0.66, maxS: 0.96, satBoost: 1.1 })
  if (colorMode === 'solid') {
    const accent = mixRgb(primary, PLATINUM_BASE, 0.24)
    const deep = mixRgb(primary, [12, 18, 36], 0.48)
    return buildSpectrum(primary, accent, deep)
  }
  const rawAccent = typeof accentHex === 'string' && HEX_COLOR_RE.test(accentHex)
    ? glowRgb(accentHex)
    : glowRgb(deriveAccentHex(colorHex))
  const accent = tuneJewelRgb(rawAccent, { minL: 0.55, maxL: 0.74, minS: 0.68, maxS: 0.96, satBoost: 1.1 })
  const deep = mixRgb(primary, [12, 18, 36], 0.46)
  return buildSpectrum(primary, accent, deep)
}

export function resolveCenterSpectrum(glow, backdropPalette) {
  const normalized = normalizeCenterGlow(glow)
  if (normalized.colorSource === 'classic') {
    if (normalized.colorMode === 'solid') {
      const p = [...CLASSIC_PRISM_SPECTRUM.primary]
      return buildSpectrum(p, mixRgb(p, PLATINUM_BASE, 0.24), [...CLASSIC_PRISM_SPECTRUM.deep], [...CLASSIC_PRISM_SPECTRUM.platinum])
    }
    return {
      primary: [...CLASSIC_PRISM_SPECTRUM.primary],
      accent: [...CLASSIC_PRISM_SPECTRUM.accent],
      deep: [...CLASSIC_PRISM_SPECTRUM.deep],
      platinum: [...CLASSIC_PRISM_SPECTRUM.platinum],
      highlight: [...CLASSIC_PRISM_SPECTRUM.platinum],
      coreGlow: [...CLASSIC_PRISM_SPECTRUM.coreGlow]
    }
  }
  if (normalized.colorSource === 'custom') {
    return deriveCustomSpectrum(normalized.color, normalized.accentColor, normalized.colorMode)
  }
  const backdrop = deriveBackdropSpectrum(backdropPalette)
  if (normalized.colorMode === 'solid') {
    const unified = mixRgb(backdrop.primary, backdrop.accent, 0.35)
    return buildSpectrum(unified, mixRgb(unified, PLATINUM_BASE, 0.24), backdrop.deep, backdrop.platinum)
  }
  return backdrop
}

export function blendCenterSpectrum(from, to, t) {
  if (!from) return to
  if (!to) return from
  const platinum = mixRgb(from.platinum || from.highlight, to.platinum || to.highlight, t)
  return {
    primary: mixRgb(from.primary, to.primary, t),
    accent: mixRgb(from.accent, to.accent, t),
    deep: mixRgb(from.deep, to.deep, t),
    platinum,
    highlight: platinum,
    coreGlow: mixRgb(from.coreGlow || from.primary, to.coreGlow || to.primary, t)
  }
}

export function spectrumDistance(a, b) {
  if (!a || !b) return Infinity
  let maxDiff = 0
  for (const key of ['primary', 'accent', 'deep', 'platinum', 'coreGlow']) {
    const ca = a[key] || a.highlight
    const cb = b[key] || b.highlight
    if (!ca || !cb) continue
    for (let i = 0; i < 3; i++) {
      const d = Math.abs(ca[i] - cb[i])
      if (d > maxDiff) maxDiff = d
    }
  }
  return maxDiff
}

export function normalizeCenterGlow(value) {
  const raw = value && typeof value === 'object' ? value : {}
  const hasValidColor = typeof raw.color === 'string' && HEX_COLOR_RE.test(raw.color)
  const color = hasValidColor ? raw.color.toLowerCase() : DEFAULT_CENTER_GLOW.color

  let colorSource
  if (typeof raw.colorSource === 'string' && Object.hasOwn(CENTER_GLOW_COLOR_SOURCES, raw.colorSource)) {
    colorSource = raw.colorSource
  } else if (hasValidColor && color !== LEGACY_DEFAULT_COLOR) {
    // Preserve explicit custom colors saved before backdrop sync existed.
    colorSource = 'custom'
  } else {
    colorSource = DEFAULT_CENTER_GLOW.colorSource
  }

  const hasValidAccent = typeof raw.accentColor === 'string' && HEX_COLOR_RE.test(raw.accentColor)
  const accentColor = hasValidAccent
    ? raw.accentColor.toLowerCase()
    : (colorSource === 'custom' && color !== LEGACY_DEFAULT_COLOR ? deriveAccentHex(color) : DEFAULT_CENTER_GLOW.accentColor)

  const isLegacyRainbow = raw.effect === 'rainbow'
  const mappedEffect = raw.effect === 'twinkle' ? 'pulse' : isLegacyRainbow ? 'sweep' : raw.effect
  const effect = typeof mappedEffect === 'string' && Object.hasOwn(CENTER_GLOW_EFFECTS, mappedEffect)
    ? mappedEffect
    : DEFAULT_CENTER_GLOW.effect

  let colorMode
  if (typeof raw.colorMode === 'string' && Object.hasOwn(CENTER_GLOW_COLOR_MODES, raw.colorMode)) {
    colorMode = raw.colorMode
  } else if (typeof raw.colorMode === 'string' && Object.hasOwn(LEGACY_COLOR_MODE_MAP, raw.colorMode)) {
    colorMode = LEGACY_COLOR_MODE_MAP[raw.colorMode]
  } else if (isLegacyRainbow) {
    colorMode = 'prism'
  } else {
    colorMode = DEFAULT_CENTER_GLOW.colorMode
  }

  return {
    colorSource,
    color,
    accentColor,
    brightness: percent(raw.brightness, DEFAULT_CENTER_GLOW.brightness, 150),
    effect,
    speed: percent(raw.speed, DEFAULT_CENTER_GLOW.speed, 200),
    colorMode
  }
}

export function advanceCenterGlow(time, delta, speed) {
  return time + Math.max(0, Math.min(40, delta)) * speed / 100
}

export function centerGlowSample(effect, colorMode, time, angle = 0) {
  const period = CYCLE_SECONDS[effect] || 3.6
  const cycles = time / period
  const phase = fraction(cycles)
  const wave = 0.5 - 0.5 * Math.cos(phase * TAU)
  if (colorMode === 'layered') {
    const turn = fraction(angle / TAU)
    const localPhase = fraction(cycles - turn * 0.5)
    return { phase: localPhase, mix: 0.5 - 0.5 * Math.cos((localPhase + turn) * TAU), hueOffset: 0 }
  }
  if (colorMode === 'prism') {
    const turn = fraction(angle / TAU)
    const offset = Math.sin(angle * 1.5 - time * 0.92) * 42
    return { phase: fraction(cycles - turn * 0.25), mix: wave, hueOffset: offset }
  }
  if (colorMode === 'opal' || colorMode === 'flow') {
    return { phase, mix: wave, hueOffset: 0 }
  }
  return { phase, mix: 0, hueOffset: 0 }
}

export function samplePrismColor(spectrum, colorMode, effect, time, { slot = 0, angle = 0, layer = 0.5, role = '' } = {}) {
  const s = spectrum || CLASSIC_PRISM_SPECTRUM
  const platinum = s.platinum || s.highlight || PLATINUM_BASE
  if (colorMode === 'solid') {
    return mixRgb(s.primary, platinum, clamp(layer * 0.14, 0, 0.20))
  }
  if (colorMode === 'opal') {
    const breathShift = 0.14 * (0.5 + 0.5 * Math.sin(time * 0.78 + slot * 0.85))
    if (role === 'platinum') return mixRgb(platinum, s.coreGlow || s.primary, breathShift * 0.65)
    if (role === 'accent') return mixRgb(s.accent, s.primary, breathShift)
    if (role === 'primary') return mixRgb(s.primary, s.accent, breathShift)
    if (layer > 0.72) return mixRgb(s.primary, s.coreGlow || platinum, breathShift)
    if (layer < 0.34) return mixRgb(s.accent, s.primary, breathShift)
    return mixRgb(s.primary, s.accent, 0.35 + breathShift)
  }
  const sample = centerGlowSample(effect, colorMode, time, angle)
  if (colorMode === 'layered') {
    const drift = Math.sin(angle * 2 - time * 0.85 + slot * 0.7) * 0.24
    const blend = clamp(layer + drift, 0, 1)
    if (blend < 0.22) return mixRgb(s.deep, s.primary, blend / 0.22)
    if (blend > 0.90) return mixRgb(s.accent, platinum, (blend - 0.90) / 0.10)
    return mixRgb(s.primary, s.accent, (blend - 0.22) / 0.68)
  }
  if (colorMode === 'prism') {
    const base = mixRgb(s.primary, s.accent, 0.5 + 0.5 * Math.sin(time * 0.68 + layer * 1.65 + slot * 0.45))
    const { h, s: sat, l } = rgbToHsl(base)
    const spread = Math.sin(angle * 1.5 + slot * 0.78 - time * 0.95) * 44
      + Math.cos(layer * Math.PI - time * 0.55) * 18
    return hslToRgb(h + spread, sat < 0.06 ? 0.68 : clamp(sat * 1.08, 0.76, 0.96), clamp(l, 0.55, 0.70))
  }
  // 'flow': rich dual-tone jewel aurora oscillation across layers.
  const breathBias = effect === 'breathe'
    ? centerGlowPulse(sample.phase) * 0.88 - 0.22
    : 0.5 + 0.5 * Math.sin(time * 0.82 + layer * 1.45 + slot * 0.26)
  return mixRgb(s.primary, s.accent, clamp(breathBias, 0, 1))
}

export function centerGlowPulse(phase) {
  return 0.46 + 0.72 * Math.sin(Math.PI * phase) ** 2
}

export function centerGlowWave(phase) {
  return phase < 0.84 ? Math.sin(Math.PI * phase / 0.84) * (1 - phase) : 0
}

export function centerGlowEdge(effect, angle, time) {
  switch (effect) {
    case 'sweep': return 0.10 + 0.90 * ((1 + Math.cos(angle - time * 1.65)) / 2) ** 5
    case 'breathe': return 0.36 + 0.52 * Math.sin(Math.PI * fraction(time / CYCLE_SECONDS.breathe)) ** 2
    case 'pulse': {
      const p = fraction(time / CYCLE_SECONDS.pulse)
      return 0.30 + 0.66 * Math.pow(Math.max(0, 1 - p * 1.4), 2)
    }
    default: return (1 + Math.sin(angle * 3 - time * 1.55) * Math.cos(angle * 2 + time * 0.88)) / 2
  }
}
