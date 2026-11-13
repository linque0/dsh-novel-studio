export function outlineCardLayout({ w, h }) {
  const x = Math.min(14, w * .08)
  const y = Math.min(12, h * .11)
  const width = w - 2 * x
  const height = h - 2 * y
  const font = width < 86 || height < 34 ? 12 : width < 145 || height < 65 ? 14 : 16
  const line = Math.floor(font * 1.16)
  const lines = width >= 94 && height >= line * 2 + 4 ? 2 : 1
  const spare = height - line * lines
  const meta = width >= 67 && spare >= 18
  const summaryHeight = spare - 2 - (meta ? 16 : 0)
  const summaryLines = width >= 85 ? Math.max(0, Math.floor(summaryHeight / 14)) : 0
  return {
    font, line, lines, meta, summaryLines
  }
}

const GAP = 8
const INFO_LINE = 14
const ACTION_WIDTH = 18

// Intersect the paper's horizontal spans at both ends of a text row.
function paperBand(shape, { w, h }, y, height) {
  const top = y / h
  const bottom = (y + height) / h
  const pad = Math.min(12, w * .08)
  let left = 0
  let right = 1
  if (shape === 'para') {
    left = .12 - .104 * (top - .016) / .968
    right = .984 - .104 * (bottom - .016) / .968
  } else if (shape === 'ellipse' || shape === 'diamond') {
    const distance = Math.max(Math.abs(top - .5), Math.abs(bottom - .5))
    const half = shape === 'ellipse'
      ? Math.sqrt(Math.max(0, .49 ** 2 - distance ** 2))
      : Math.max(0, .484 - distance)
    left = .5 - half
    right = .5 + half
  }
  return { left: left * w + pad, right: (1 - right) * w + pad }
}

function cornerRow(shape, size, start, end, step, left, right, preferRight, action) {
  let best = null
  let bestScore = 0
  for (let y = start; step > 0 ? y <= end : y >= end; y += step) {
    const band = paperBand(shape, size, y, INFO_LINE)
    const width = size.w - band.left - band.right
    const both = left && right && width >= left + right + GAP
    const showLeft = Boolean(both || (left && width >= left && (!preferRight || width < right)))
    const showRight = Boolean(both || (!showLeft && right && width >= right))
    const count = Number(showLeft) + Number(showRight)
    if (!count) continue
    const used = (showLeft ? left : 0) + (showRight ? right : 0)
    const more = action && width >= used + ACTION_WIDTH + GAP * count
    const score = count * 4 + Number(preferRight ? showRight : showLeft) * 2 + Number(more)
    if (score <= bestScore) continue
    best = { ...band, y, showLeft, showRight, more }
    bestScore = score
    if ((!left || showLeft) && (!right || showRight) && (!action || more)) break
  }
  return best
}

export function outlineEventLayout(shape, size, { status, association, relations, action, titleLines }) {
  const { w, h } = size
  const centered = shape === 'diamond' || shape === 'ellipse'
  const centralBand = paperBand(shape, size, h * .4, h * .2)
  const width = w - centralBand.left - centralBand.right
  const font = width < 86 || h < 55 ? 12 : width < 145 || h < 80 ? 14 : 16
  const line = Math.floor(font * 1.25)
  const lines = width >= 94 && h >= 72 ? 2 : 1
  const titleHeight = line * (centered ? Math.min(lines, titleLines || lines) : lines)
  const titleY = (h - titleHeight) / 2
  // Keep the wrapping width stable when a short title frees a line of space.
  const wrapHeight = line * lines
  const title = { ...paperBand(shape, size, (h - wrapHeight) / 2, wrapHeight), y: titleY, height: titleHeight }
  const margin = Math.max(8, Math.ceil(h * .08))
  const lastTop = titleY - GAP - INFO_LINE
  // Start on the wider shoulder of curved paper. The title clearance still
  // limits how far inward a row can go on a short card.
  const shoulder = h * (shape === 'diamond' ? .35 : .27)
  const rowInset = centered ? Math.max(margin, Math.min(Math.ceil(shoulder), Math.floor(lastTop))) : margin
  const statusWidth = status ? Array.from(status).length * 10 + 9 : 0
  const relationWidth = relations ? Array.from(relations).length * 10 : 0
  const associationWidth = association ? (association === '未关联章节' ? 50 : 30) : 0
  const top = cornerRow(shape, size, rowInset, lastTop, 1,
    36, statusWidth, Boolean(status && status !== '未标记'), action)
  const bottom = cornerRow(shape, size, h - rowInset - INFO_LINE, titleY + titleHeight + GAP, -1,
    associationWidth, relationWidth, Boolean(relations && association === '未关联章节'), false)
  const summaryY = titleY + titleHeight + GAP
  const summaryEnd = bottom ? bottom.y - GAP : h - margin
  let summary = null
  if (top?.showLeft && (!status || top.showRight) && (!association || bottom?.showLeft) && (!relations || bottom?.showRight)) {
    const available = Math.min(3, Math.floor((summaryEnd - summaryY) / INFO_LINE))
    for (let lines = available; lines > 0; lines--) {
      const band = paperBand(shape, size, summaryY, lines * INFO_LINE)
      if (w - band.left - band.right < 85) continue
      summary = { ...band, y: summaryY, lines }
      break
    }
  }
  return { centered, font, line, lines, title, top, bottom, summary }
}
