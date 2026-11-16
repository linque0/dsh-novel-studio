const clamp = value => Math.max(0, Math.min(1, value))
const linearize = value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
const encode = value => value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055

function chromaVector(rgb) {
  // Preserve exact neutrality, including black and white custom inputs.
  if (rgb[0] === rgb[1] && rgb[1] === rgb[2]) return [0, 0]
  const [r, g, b] = rgb.map(linearize)
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s
  ]
}

function linearRgb(lightness, a, b) {
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (lightness - 0.0894841775 * a - 1.2914855480 * b) ** 3
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
  ]
}

function tone(lightness, [a, b], gain, limit) {
  const chroma = Math.hypot(a, b)
  if (chroma < 0.0001) return Array(3).fill(encode(lightness ** 3))

  const target = Math.min(gain, limit / chroma)
  const full = linearRgb(lightness, a * target, b * target)
  const inGamut = rgb => rgb.every(value => value >= 0 && value <= 1)
  if (inGamut(full)) return full.map(encode)

  // Reduce chroma along the same OKLCH hue and lightness until it fits in sRGB.
  let low = 0
  let high = target
  for (let step = 0; step < 14; step += 1) {
    const mid = (low + high) / 2
    if (inGamut(linearRgb(lightness, a * mid, b * mid))) low = mid
    else high = mid
  }
  return linearRgb(lightness, a * low, b * low).map(value => clamp(encode(value)))
}

const mix = (first, second, amount) => first.map((value, i) => value + (second[i] - value) * amount)

export function colorAtTone(rgb, lightness, chromaLimit, gain = 1) {
  return tone(lightness, chromaVector(rgb), gain, chromaLimit)
}

// Mesh slots stay in this order because each slot follows a distinct Paper Shader path.
export function flowColorStops({ a, b, c }) {
  const main = chromaVector(a)
  const accent = chromaVector(b)
  const base = chromaVector(c)
  return [
    tone(0.59, main, 1.35, 0.20),
    tone(0.70, accent, 1.60, 0.25),
    tone(0.42, mix(main, accent, 0.60), 0.78, 0.12),
    tone(0.89, accent, 0.28, 0.032),
    tone(0.19, mix(base, main, 0.60), 0.85, 0.065),
    tone(0.74, main, 0.32, 0.045)
  ]
}

export function blendFlowStops(from, to, elapsed, duration) {
  if (duration <= 0 || elapsed >= duration) return to
  if (elapsed <= 0) return from

  const linear = elapsed / duration
  const smooth = linear * linear * (3 - 2 * linear)
  return from.map((color, i) => mix(color, to[i], smooth))
}
