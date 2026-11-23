/**
 * entry-circles.js — 设定星系中行星内部条目圆圈的尺寸缩放上限与圆内多行文字折行排版算法。
 */
export const MIN_ENTRY_RADIUS = 1

export function entryCircleGlyphs(text) {
  return Array.from(text.trim().replace(/\s+/gu, ' '))
}

export function entryCircleScale(zoom) {
  return zoom < 1 ? zoom ** 1.5 : 2 * zoom / (1 + zoom)
}

export function entryRadiusLimit(width, height, zoom = 1, overview = false, size = 1) {
  const canvasLimit = Math.max(1, Math.floor(Math.min(width, height) / 2) - 4)
  const viewLimit = (overview ? 9 : 17) * entryCircleScale(zoom) * size
  return Math.min(canvasLimit, viewLimit)
}

export function entryDisplayRadius(base, scale) {
  return Math.max(base, MIN_ENTRY_RADIUS) * scale
}

export function entryReferenceRadius(displayed, scale) {
  return Math.max(displayed / scale, MIN_ENTRY_RADIUS)
}

function singleLineTitle(measure, glyphs, radius) {
  const width = Math.max(0, radius * 1.76 - 2.5)
  const prefix = []
  for (const glyph of glyphs) {
    if (measure(prefix.join('') + glyph) > width) break
    prefix.push(glyph)
  }
  if (!prefix.length) return []
  if (prefix.length === glyphs.length) return [prefix.join('')]
  while (prefix.length > 1 && measure(prefix.join('') + '…') > width) prefix.pop()
  const label = prefix.join('').trimEnd()
  return [measure(label + '…') <= width ? label + '…' : label]
}

export function layoutEntryCircleText(measure, glyphs, radius, manual, lineHeight, fontSize = lineHeight / 1.2) {
  if (!manual) return singleLineTitle(measure, glyphs, radius)
  const maxLines = Math.max(1, Math.floor((1.65 * radius - 3) / lineHeight))
  const limit = glyphs.length
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
      if (index < limit && rows === maxLines && row === rows - 1) {
        const chars = Array.from(text.trimEnd())
        while (chars.length && measure(chars.join('') + '…') > width) chars.pop()
        if (chars.length && measure(chars.join('') + '…') <= width) text = chars.join('') + '…'
      }
      lines.push(text.trimEnd())
    }
    if (index >= limit || rows === maxLines) return lines
  }
  return []
}

