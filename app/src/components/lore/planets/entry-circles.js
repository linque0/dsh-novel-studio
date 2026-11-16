import { clamp } from './planet-scene.js'

export const MIN_ENTRY_RADIUS = 6
export const MAX_ENTRY_RADIUS = 180
const DEFAULT_LINES = 3
const DEFAULT_GLYPHS = 15

export function entryCircleGlyphs(text) {
  return Array.from(text.trim().replace(/\s+/gu, ' '))
}

export function entryCircleRadius(base, count) {
  if (!count) return base
  const textRadius = 7 + 5.4 * Math.sqrt(Math.min(count, DEFAULT_GLYPHS))
    + Math.min(10, 2.6 * Math.log2(1 + Math.max(0, count - DEFAULT_GLYPHS) / DEFAULT_GLYPHS))
  return Math.max(base, textRadius)
}

export function entryRadiusLimit(width, height) {
  return clamp(Math.floor(Math.min(width, height) / 2) - 4, MIN_ENTRY_RADIUS, MAX_ENTRY_RADIUS)
}

export function layoutEntryCircleText(measure, glyphs, radius, manual, lineHeight, fontSize = lineHeight / 1.2) {
  const capacity = Math.max(1, Math.floor((1.65 * radius - 3) / lineHeight))
  const maxLines = manual ? capacity : Math.min(capacity, DEFAULT_LINES)
  const limit = manual ? glyphs.length : Math.min(glyphs.length, DEFAULT_GLYPHS)
  for (let rows = 1; rows <= maxLines; rows++) {
    const lines = []
    let index = 0
    for (let row = 0; row < rows && index < limit; row++) {
      const y = Math.abs(row - (rows - 1) / 2) * lineHeight + fontSize / 2
      const width = 2 * Math.sqrt(Math.max(0, (radius - 1) ** 2 - y ** 2)) - 3
      while (index < limit && glyphs[index] === ' ') index++
      let text = ''
      while (index < limit && measure(text + glyphs[index]) <= width) text += glyphs[index++]
      if (!text) break
      if (index < glyphs.length && (index === limit || (rows === maxLines && row === rows - 1))) {
        const chars = Array.from(text.trimEnd())
        if (!manual && index === limit) chars.pop()
        while (chars.length && measure(chars.join('') + '…') > width) chars.pop()
        text = measure('…') <= width ? chars.join('') + '…' : text
      }
      lines.push(text.trimEnd())
    }
    if (index >= limit || rows === maxLines) return lines
  }
  return []
}

