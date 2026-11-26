const BASE_CARD_SIZE = {
  event: { w: 204, h: 141 },
  diamond: { w: 250, h: 210 },
  para: { w: 254, h: 170 },
  ellipse: { w: 210, h: 118 },
  cite: { w: 178, h: 128 },
  volume: { w: 190, h: 128 },
  note: { w: 178, h: 128 },
  anchor: { w: 178, h: 128 }
}

const ACTION_WIDTH = 18

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v))
}

function round1(v) {
  return Math.round(v * 10) / 10
}

function cardBaseFor(kind, shape) {
  if (kind === 'event' && (shape === 'diamond' || shape === 'para' || shape === 'ellipse')) {
    return BASE_CARD_SIZE[shape]
  }
  return BASE_CARD_SIZE[kind] || BASE_CARD_SIZE.event
}

export function cardScaleFor(size, kind = 'event', shape = 'process') {
  const w = Number(size?.w) || 0
  const h = Number(size?.h) || 0
  const base = cardBaseFor(kind, shape)
  if (!w || !h) return 1
  const rw = w / base.w
  const rh = h / base.h
  const minRatio = Math.min(rw, rh)
  const geoRatio = Math.sqrt(rw * rh)
  return clamp(0.65 * minRatio + 0.35 * geoRatio, 0.82, 2.0)
}

function bodyLineRatio(font) {
  if (font >= 20) return 1.38
  if (font >= 16) return 1.42
  return 1.46
}

function titleLineRatio(font) {
  return font >= 22 ? 1.22 : 1.26
}

function lineAdvanceUnits(str) {
  let units = 0
  for (const ch of str) {
    const code = ch.charCodeAt(0)
    if (code > 255) units += 1.0
    else if (/[.,:;!'|\s ilI]/.test(ch)) units += 0.38
    else if (/[A-Z0-9@#%&+=]/.test(ch)) units += 0.62
    else units += 0.54
  }
  return units
}

export function estimateWrappedLines(text, availWidth, font) {
  const s = typeof text === 'string' ? text.trim() : ''
  if (!s) return 0
  const effW = Math.max(font, availWidth || 0)
  const safety = effW < font * 7 ? 1.09 : 1.05
  const paras = s.replace(/\n{3,}/g, '\n\n').split('\n')
  let total = 0
  for (const p of paras) {
    const trimmed = p.trim()
    if (!trimmed) {
      total += 1
      continue
    }
    const px = lineAdvanceUnits(trimmed) * font * safety
    total += Math.max(1, Math.ceil(px / effW))
  }
  return total
}

function fontBoundsFor(scale, kind = 'event') {
  const bodyMin = round1(clamp(11 * (0.86 + 0.14 * scale), 10.5, 14))
  const titleMin = round1(clamp(12.5 * (0.85 + 0.15 * scale), 12, 16))
  const bodyOnlyMax = round1(clamp(17.5 * scale + 3.5, 16, 26))
  const titledBodyMax = round1(clamp(15.5 * scale + 2.5, 14, 24))
  const titleMax = round1(clamp((kind === 'volume' ? 20 : 18.5) * scale + 4, 16, 30))
  return { bodyMin, titleMin, bodyOnlyMax, titledBodyMax, titleMax }
}

/**
 * Solve the largest font in [minFont, maxFont] where `text` fits completely
 * inside `availH` (with width evaluated dynamically for the candidate block height).
 */
function fitBodyOnly(text, widthForHeight, availH, minFont, maxFont, minWidth = 60) {
  const evaluate = (f) => {
    const lh = Math.round(f * bodyLineRatio(f))
    const maxLines = Math.floor(availH / lh)
    if (maxLines < 1) return null
    // Fixed-point 2-pass width lookup (important for diamond/ellipse where block height affects width).
    let est = 1
    let w = widthForHeight(lh)
    for (let pass = 0; pass < 2; pass++) {
      w = widthForHeight(Math.min(availH, est * lh))
      if (w < minWidth) return null
      est = estimateWrappedLines(text, w, f)
    }
    const fits = est <= maxLines && est * lh <= availH
    return { font: round1(f), line: lh, estLines: est, maxLines, fits, width: w }
  }

  let lo = minFont
  let hi = Math.max(minFont, maxFont)
  let best = null
  const topCheck = evaluate(hi)
  if (topCheck?.fits) {
    best = topCheck
  } else {
    const lowCheck = evaluate(lo)
    if (!lowCheck?.fits) {
      // Long text: stay at readable floor and allocate all available lines.
      const lh = Math.round(lo * bodyLineRatio(lo))
      const maxLines = Math.max(1, Math.floor(availH / lh))
      const w = widthForHeight(Math.min(availH, maxLines * lh))
      const est = estimateWrappedLines(text, Math.max(minWidth, w), lo)
      return {
        font: round1(lo),
        line: lh,
        estLines: Math.min(maxLines, Math.max(1, est)),
        maxLines,
        fits: false,
        usedH: Math.min(availH, maxLines * lh)
      }
    }
    best = lowCheck
    for (let i = 0; i < 10; i++) {
      const mid = (lo + hi) / 2
      const res = evaluate(mid)
      if (res?.fits) {
        best = res
        lo = mid
      } else {
        hi = mid
      }
    }
  }
  const usedH = Math.min(availH, best.estLines * best.line)
  return { ...best, usedH }
}

/**
 * Solve the largest title-only font in [minFont, maxFont] where `titleText`
 * fits cleanly within `availH` and `maxLines`.
 */
function fitTitleOnly(titleText, widthForHeight, availH, minFont, maxFont, maxLinesCap = 3) {
  const evaluate = (f) => {
    const lh = Math.round(f * titleLineRatio(f))
    const maxLines = Math.min(maxLinesCap, Math.floor(availH / lh))
    if (maxLines < 1) return null
    let est = 1
    let w = widthForHeight(lh)
    for (let pass = 0; pass < 2; pass++) {
      w = widthForHeight(Math.min(availH, est * lh))
      if (w < 44) return null
      est = estimateWrappedLines(titleText, w, f)
    }
    const fits = est <= maxLines && est * lh <= availH
    return { font: round1(f), line: lh, lines: Math.min(maxLines, Math.max(1, est)), maxLines, fits }
  }

  let lo = minFont
  let hi = Math.max(minFont, maxFont)
  let best = null
  const topCheck = evaluate(hi)
  if (topCheck?.fits) {
    best = topCheck
  } else {
    const lowCheck = evaluate(lo)
    if (!lowCheck?.fits) {
      const lh = Math.round(lo * titleLineRatio(lo))
      const maxLines = Math.max(1, Math.min(maxLinesCap, Math.floor(availH / lh)))
      return { font: round1(lo), line: lh, lines: maxLines, maxLines, fits: false, usedH: Math.min(availH, maxLines * lh) }
    }
    best = lowCheck
    for (let i = 0; i < 10; i++) {
      const mid = (lo + hi) / 2
      const res = evaluate(mid)
      if (res?.fits) {
        best = res
        lo = mid
      } else {
        hi = mid
      }
    }
  }
  return { ...best, usedH: Math.min(availH, best.lines * best.line) }
}

/**
 * Linked solver for cards that have BOTH title and summary:
 * keeps titleFont >= ~1.22x summaryFont while maximizing combined vertical fill.
 */
function fitTitleAndBody(titleText, summaryText, widthForHeight, availH, { bodyMin, titledBodyMax, titleMin, titleMax, baseGap, maxTitleLines = 2, minSummaryW = 70 }) {
  const evaluate = (sf) => {
    const tf = round1(clamp(Math.max(sf * 1.22, titleMin), titleMin, titleMax))
    const tlh = Math.round(tf * titleLineRatio(tf))
    const slh = Math.round(sf * bodyLineRatio(sf))
    const gap = Math.round(clamp(baseGap * (sf / 13), 4, 14))
    let tLines = 1
    let sLines = 1
    let totalH = tlh + gap + slh
    for (let pass = 0; pass < 2; pass++) {
      const w = widthForHeight(Math.min(availH, totalH))
      if (w < minSummaryW) return null
      tLines = Math.min(maxTitleLines, Math.max(1, estimateWrappedLines(titleText, w, tf)))
      sLines = Math.max(1, estimateWrappedLines(summaryText, w, sf))
      totalH = tLines * tlh + gap + sLines * slh
    }
    return {
      titleFont: tf,
      titleLine: tlh,
      titleLines: tLines,
      summaryFont: round1(sf),
      summaryLine: slh,
      estSummaryLines: sLines,
      gap,
      totalH,
      fits: totalH <= availH
    }
  }

  let lo = bodyMin
  let hi = Math.max(bodyMin, titledBodyMax)
  let best = null
  const topCheck = evaluate(hi)
  if (topCheck?.fits) {
    best = topCheck
  } else {
    const lowCheck = evaluate(lo)
    if (!lowCheck?.fits) {
      // Long summary: stay at readable floor and allocate every remaining line to summary.
      const tf = round1(clamp(Math.max(lo * 1.26, titleMin + 1), titleMin, titleMax))
      const tlh = Math.round(tf * titleLineRatio(tf))
      const slh = Math.round(lo * bodyLineRatio(lo))
      const gap = Math.round(clamp(baseGap, 4, 12))
      const w = Math.max(minSummaryW, widthForHeight(availH))
      const tLines = Math.min(maxTitleLines, Math.max(1, estimateWrappedLines(titleText, w, tf)))
      const remH = availH - tLines * tlh - gap
      const maxSummaryLines = Math.max(0, Math.floor(remH / slh))
      return {
        titleFont: tf,
        titleLine: tlh,
        titleLines: tLines,
        summaryFont: round1(lo),
        summaryLine: slh,
        estSummaryLines: maxSummaryLines,
        maxSummaryLines,
        gap,
        fits: false,
        usedH: tLines * tlh + (maxSummaryLines > 0 ? gap + maxSummaryLines * slh : 0)
      }
    }
    best = lowCheck
    for (let i = 0; i < 10; i++) {
      const mid = (lo + hi) / 2
      const res = evaluate(mid)
      if (res?.fits) {
        best = res
        lo = mid
      } else {
        hi = mid
      }
    }
  }

  const maxSummaryLines = Math.max(1, Math.floor((availH - best.titleLines * best.titleLine - best.gap) / best.summaryLine))
  const usedH = Math.min(availH, best.titleLines * best.titleLine + best.gap + Math.min(maxSummaryLines, best.estSummaryLines) * best.summaryLine)
  return { ...best, maxSummaryLines, usedH }
}

export function outlineCardLayout({ w, h }, opts = {}) {
  const kind = opts.kind || 'cite'
  const titleText = opts.title || ''
  const summaryText = typeof opts.summary === 'string' ? opts.summary.trim() : ''
  const hasTitle = opts.hasTitle !== undefined ? Boolean(opts.hasTitle) : Boolean(String(titleText).trim())
  const summaryProvided = opts.summary !== undefined || opts.hasSummary !== undefined
  const hasSummary = opts.hasSummary !== undefined ? Boolean(opts.hasSummary) : (opts.summary !== undefined ? Boolean(summaryText) : true)
  const scale = cardScaleFor({ w, h }, kind)
  const x = Math.round(Math.min(16 * scale, w * 0.08))
  const y = Math.round(Math.min(13 * scale, h * 0.085))
  const width = Math.max(32, w - 2 * x)
  const height = Math.max(20, h - 2 * y)
  const metaFont = round1(clamp(10.5 * scale, 9.5, 16))
  const metaLine = Math.round(metaFont * 1.35)
  const gap = Math.round(clamp(5 * scale, 3, 10))
  const meta = width >= 67 && height >= metaLine + gap + 18
  const availH = Math.max(16, height - (meta ? metaLine + gap : 0))
  const bounds = fontBoundsFor(scale, kind)
  const fixedW = () => width

  let font = round1(clamp((kind === 'volume' ? 17 : 16) * scale, 12, bounds.titleMax))
  let line = Math.round(font * titleLineRatio(font))
  let lines = width >= 94 && availH >= line * 2 + 4 ? 2 : 1
  let summaryFont = hasTitle
    ? round1(clamp(12.5 * scale, 10.5, bounds.titledBodyMax))
    : round1(clamp(14.5 * scale, 12, bounds.bodyOnlyMax))
  let summaryLine = Math.round(summaryFont * bodyLineRatio(summaryFont))
  let summaryLines = 0
  let usedGap = gap
  let justify = 'flex-start'

  if (hasTitle && hasSummary && summaryText && width >= 85) {
    const fitted = fitTitleAndBody(titleText, summaryText, fixedW, availH, {
      ...bounds,
      baseGap: gap,
      maxTitleLines: width >= 94 ? 2 : 1,
      minSummaryW: 72
    })
    font = fitted.titleFont
    line = fitted.titleLine
    lines = fitted.titleLines
    summaryFont = fitted.summaryFont
    summaryLine = fitted.summaryLine
    summaryLines = fitted.maxSummaryLines
    usedGap = fitted.gap
    justify = fitted.fits && availH - fitted.usedH > availH * 0.18 ? 'center' : 'flex-start'
  } else if (!hasTitle && hasSummary && summaryText && width >= 72) {
    const fitted = fitBodyOnly(summaryText, fixedW, availH, bounds.bodyMin, bounds.bodyOnlyMax, 64)
    summaryFont = fitted.font
    summaryLine = fitted.line
    summaryLines = fitted.maxLines
    justify = fitted.fits && availH - fitted.usedH > availH * 0.18 ? 'center' : 'flex-start'
  } else if (hasTitle && summaryProvided && !hasSummary && titleText) {
    const fitted = fitTitleOnly(titleText, fixedW, availH, bounds.titleMin, bounds.titleMax, width >= 110 ? 3 : 2)
    font = fitted.font
    line = fitted.line
    lines = fitted.lines
    justify = 'center'
  } else {
    // Fallback when caller omits summary string (e.g. only passes title).
    const rawFont = round1(clamp((kind === 'volume' ? 17 : 16) * scale, 12, 28))
    font = width < 86 || height < 34 ? Math.min(rawFont, 12) : width < 145 || height < 65 ? Math.min(rawFont, 14.5) : rawFont
    line = Math.round(font * 1.24)
    lines = width >= 94 && availH >= line * 2 + 4 ? 2 : 1
    const effTitleLines = hasTitle ? Math.min(lines, Math.max(1, estimateWrappedLines(titleText, width, font))) : 0
    const remH = availH - (hasTitle ? line * effTitleLines + gap : 0)
    summaryLines = width >= 85 ? Math.max(0, Math.floor(remH / summaryLine)) : 0
    justify = hasSummary && summaryLines > 0 ? 'flex-start' : 'center'
  }

  return {
    hasTitle,
    scale,
    padX: x,
    padY: y,
    gap: usedGap,
    iconSize: Math.round(clamp(12 * scale, 10, 18)),
    metaFont,
    metaLine,
    font,
    line,
    lines,
    summaryFont,
    summaryLine,
    meta,
    summaryLines,
    justify
  }
}

// Intersect the paper's horizontal spans at both ends of a text row.
function paperBand(shape, { w, h }, y, height) {
  const top = y / h
  const bottom = (y + height) / h
  const pad = Math.min(14, w * 0.08)
  let left = 0
  let right = 1
  if (shape === 'para') {
    left = 0.12 - 0.104 * (top - 0.016) / 0.968
    right = 0.984 - 0.104 * (bottom - 0.016) / 0.968
  } else if (shape === 'ellipse' || shape === 'diamond') {
    const distance = Math.max(Math.abs(top - 0.5), Math.abs(bottom - 0.5))
    const half = shape === 'ellipse'
      ? Math.sqrt(Math.max(0, 0.49 ** 2 - distance ** 2))
      : Math.max(0, 0.484 - distance)
    left = 0.5 - half
    right = 0.5 + half
  }
  return { left: left * w + pad, right: (1 - right) * w + pad }
}

function cornerRow(shape, size, start, end, step, left, right, preferRight, action, rowH, actionWidth, gap) {
  let best = null
  let bestScore = 0
  for (let y = start; step > 0 ? y <= end : y >= end; y += step) {
    const band = paperBand(shape, size, y, rowH)
    const width = size.w - band.left - band.right
    const both = left && right && width >= left + right + gap
    const showLeft = Boolean(both || (left && width >= left && (!preferRight || width < right)))
    const showRight = Boolean(both || (!showLeft && right && width >= right))
    const count = Number(showLeft) + Number(showRight)
    if (!count) continue
    const used = (showLeft ? left : 0) + (showRight ? right : 0)
    const more = action && width >= used + actionWidth + gap * count
    const score = count * 4 + Number(preferRight ? showRight : showLeft) * 2 + Number(more)
    if (score <= bestScore) continue
    best = { ...band, y, showLeft, showRight, more }
    bestScore = score
    if ((!left || showLeft) && (!right || showRight) && (!action || more)) break
  }
  return best
}

export function outlineEventLayout(
  shape,
  size,
  {
    status,
    association,
    relations,
    action,
    titleLines: titleLinesLegacy,
    hasSummary: hasSummaryOpt,
    title: titleText = '',
    summary: summaryTextRaw = '',
    hasTitle: hasTitleOpt,
    topRightWidth: topRightWidthOpt,
    preferTopRight: preferTopRightOpt
  }
) {
  const { w, h } = size
  const scale = cardScaleFor(size, 'event', shape)
  const centered = shape === 'diamond' || shape === 'ellipse'
  const summaryText = typeof summaryTextRaw === 'string' ? summaryTextRaw.trim() : ''
  const hasTitle = hasTitleOpt !== undefined ? Boolean(hasTitleOpt) : Boolean(String(titleText || '').trim())
  const hasSummary = hasSummaryOpt !== undefined ? Boolean(hasSummaryOpt) : Boolean(summaryText)
  const centralBand = paperBand(shape, size, h * 0.4, h * 0.2)
  const width = Math.max(32, w - centralBand.left - centralBand.right)

  const metaFont = round1(clamp(10.5 * scale, 9.5, 16))
  const metaLine = Math.round(metaFont * 1.35)
  const bounds = fontBoundsFor(scale, 'event')
  const gap = Math.round(clamp(7 * scale, 5, 14))
  const baseSummaryGap = Math.round(clamp(6 * scale, 4, 12))
  const margin = Math.max(8, Math.ceil(Math.min(w, h) * 0.068))
  const metaScale = metaFont / 10
  const actionWidth = Math.ceil(ACTION_WIDTH * metaScale)
  const hasCustomTopRight = Number.isFinite(topRightWidthOpt)
  const topRightW = hasCustomTopRight
    ? Math.max(0, Math.ceil(topRightWidthOpt))
    : (status ? Math.ceil((Array.from(status).length * 10.5 + 10) * metaScale) : 0)
  const preferTopRight = hasCustomTopRight
    ? Boolean(preferTopRightOpt)
    : Boolean(status && status !== '未标记')
  const relationWidth = relations ? Math.ceil(Array.from(relations).length * 10.5 * metaScale) : 0
  const associationWidth = association ? Math.ceil((association === '未关联章节' ? 54 : Math.min(Array.from(association).length, 6) * 10.5 + 6) * metaScale) : 0
  const kindMinWidth = Math.ceil(38 * metaScale)

  let font = round1(clamp(16 * scale, 12, bounds.titleMax))
  if (width < 86 || h < 55) font = Math.min(font, 12)
  else if (width < 145 || h < 80) font = Math.min(font, 14.5)
  let line = Math.round(font * titleLineRatio(font))
  let lines = width >= 94 && h >= 72 ? 2 : 1
  let summaryFont = hasTitle
    ? round1(clamp(12.5 * scale, 10.5, bounds.titledBodyMax))
    : round1(clamp(14.5 * scale, 12, bounds.bodyOnlyMax))
  let summaryLine = Math.round(summaryFont * bodyLineRatio(summaryFont))

  if (!centered) {
    const minBandH = Math.min(line, summaryLine)
    const maxTopEnd = Math.max(margin, h - margin - minBandH - gap - metaLine)
    const top = cornerRow(
      shape, size, margin, maxTopEnd, 1,
      kindMinWidth, topRightW, preferTopRight, action, metaLine, actionWidth, gap
    )
    const topBottom = top ? top.y + metaLine : margin
    const minBottomStart = Math.min(h - margin - metaLine, topBottom + minBandH + gap)
    const bottom = cornerRow(
      shape, size, h - margin - metaLine, minBottomStart, -1,
      associationWidth, relationWidth, Boolean(relations && association === '未关联章节'), false, metaLine, actionWidth, gap
    )
    const bottomTop = bottom ? bottom.y : h - margin
    const innerTop = top ? topBottom + gap : margin
    const innerBottom = bottom ? bottomTop - gap : h - margin
    const innerH = Math.max(minBandH, innerBottom - innerTop)

    const widthForHeight = (blockH) => {
      const band = paperBand(shape, size, innerTop, Math.min(innerH, blockH))
      return Math.max(0, w - band.left - band.right)
    }

    let title = null
    let summary = null
    let empty = null

    if (hasTitle && hasSummary && summaryText) {
      const fitted = fitTitleAndBody(titleText, summaryText, widthForHeight, innerH, {
        ...bounds,
        baseGap: baseSummaryGap,
        maxTitleLines: width >= 94 && h >= 72 ? 2 : 1,
        minSummaryW: 70
      })
      font = fitted.titleFont
      line = fitted.titleLine
      lines = fitted.titleLines
      summaryFont = fitted.summaryFont
      summaryLine = fitted.summaryLine
      const titleHeight = line * lines
      const spare = Math.max(0, innerH - fitted.usedH)
      const startY = Math.round(innerTop + spare * 0.45)
      title = { ...paperBand(shape, size, startY, titleHeight), y: startY, height: titleHeight }
      if (fitted.maxSummaryLines > 0) {
        const sY = startY + titleHeight + fitted.gap
        const sLines = Math.max(1, Math.floor(Math.max(0, innerBottom - sY) / summaryLine))
        const band = paperBand(shape, size, sY, sLines * summaryLine)
        if (w - band.left - band.right >= 64) {
          summary = { ...band, y: sY, lines: sLines }
        }
      }
    } else if (hasTitle && hasSummary) {
      // Legacy caller without summaryText string: keep scaled top-flow behavior.
      const estBand = paperBand(shape, size, innerTop, line * lines)
      const estWidth = Math.max(0, w - estBand.left - estBand.right)
      const effTitleLines = Math.min(lines, titleLinesLegacy || Math.max(1, estimateWrappedLines(titleText, estWidth, font)))
      const titleHeight = line * effTitleLines
      let titleY = Math.round(innerTop + Math.max(0, (innerH - titleHeight) / 2))
      const minSummaryW = Math.round(85 * (summaryFont / 12.5))
      if (innerH >= titleHeight + baseSummaryGap + summaryLine) {
        titleY = innerTop
        const summaryY = titleY + titleHeight + baseSummaryGap
        const available = Math.floor(Math.max(0, innerBottom - summaryY) / summaryLine)
        for (let sLines = available; sLines > 0; sLines--) {
          const band = paperBand(shape, size, summaryY, sLines * summaryLine)
          if (w - band.left - band.right < minSummaryW) continue
          summary = { ...band, y: summaryY, lines: sLines }
          break
        }
      }
      lines = effTitleLines
      title = { ...paperBand(shape, size, titleY, titleHeight), y: titleY, height: titleHeight }
    } else if (hasTitle && !hasSummary) {
      const fitted = fitTitleOnly(titleText, widthForHeight, innerH, bounds.titleMin, bounds.titleMax, width >= 110 ? 3 : 2)
      font = fitted.font
      line = fitted.line
      lines = fitted.lines
      const titleHeight = line * lines
      const titleY = Math.round(innerTop + Math.max(0, (innerH - titleHeight) / 2))
      title = { ...paperBand(shape, size, titleY, titleHeight), y: titleY, height: titleHeight }
    } else if (!hasTitle && hasSummary && summaryText) {
      const fitted = fitBodyOnly(summaryText, widthForHeight, innerH, bounds.bodyMin, bounds.bodyOnlyMax, 64)
      summaryFont = fitted.font
      summaryLine = fitted.line
      const spare = Math.max(0, innerH - fitted.usedH)
      const summaryY = Math.round(innerTop + spare * 0.45)
      const sLines = Math.max(1, Math.floor(Math.max(0, innerBottom - summaryY) / summaryLine))
      const band = paperBand(shape, size, summaryY, sLines * summaryLine)
      summary = { ...band, y: summaryY, lines: sLines }
    } else if (!hasTitle && hasSummary) {
      const summaryY = innerTop
      const available = Math.max(1, Math.floor(Math.max(0, innerBottom - summaryY) / summaryLine))
      const band = paperBand(shape, size, summaryY, available * summaryLine)
      summary = { ...band, y: summaryY, lines: available }
    } else {
      const emptyY = Math.round(innerTop + Math.max(0, (innerH - summaryLine) / 2))
      empty = { ...paperBand(shape, size, emptyY, summaryLine), y: emptyY, height: summaryLine }
    }

    return {
      centered,
      hasTitle,
      scale,
      iconSize: Math.round(clamp(12 * scale, 10, 18)),
      dotSize: Math.round(clamp(5 * scale, 4.5, 8.5)),
      metaFont,
      metaLine,
      summaryFont,
      summaryLine,
      font,
      line,
      lines,
      title,
      top,
      bottom,
      summary,
      empty
    }
  }

  // Centered geometry (diamond / ellipse): fit content strictly within the shape's tapering waist.
  const shoulder = h * (shape === 'diamond' ? 0.22 : 0.15)
  const roughRowInset = Math.max(margin, Math.min(Math.ceil(shoulder), Math.floor(h * 0.5 - 16 - gap - metaLine)))
  const topAnchorY = h * 0.42
  const lastTopCentered = topAnchorY - gap - metaLine
  const top = cornerRow(
    shape, size, Math.max(margin, roughRowInset), Math.max(margin, Math.floor(lastTopCentered)), 1,
    kindMinWidth, topRightW, preferTopRight, action, metaLine, actionWidth, gap
  )
  const bottom = cornerRow(
    shape, size, h - Math.max(margin, roughRowInset) - metaLine, Math.min(h - margin - metaLine, Math.ceil(h * 0.58 + gap)), -1,
    associationWidth, relationWidth, Boolean(relations && association === '未关联章节'), false, metaLine, actionWidth, gap
  )
  const topSafe = top ? top.y + metaLine + gap : margin
  const bottomSafe = bottom ? bottom.y - gap : h - margin
  const middleSafeH = Math.max(20, bottomSafe - topSafe)
  const midCenterY = topSafe + middleSafeH / 2
  const centeredWidthFor = (blockH) => {
    const clampedH = Math.min(middleSafeH, Math.max(14, blockH))
    const band = paperBand(shape, size, midCenterY - clampedH / 2, clampedH)
    return Math.max(0, w - band.left - band.right)
  }

  let title = null
  let summary = null
  let empty = null

  if (hasTitle && hasSummary && summaryText) {
    const fitted = fitTitleAndBody(titleText, summaryText, centeredWidthFor, middleSafeH, {
      ...bounds,
      baseGap: baseSummaryGap,
      maxTitleLines: width >= 94 && h >= 72 ? 2 : 1,
      minSummaryW: 64
    })
    font = fitted.titleFont
    line = fitted.titleLine
    lines = fitted.titleLines
    summaryFont = fitted.summaryFont
    summaryLine = fitted.summaryLine
    const titleHeight = line * lines
    const blockH = Math.min(middleSafeH, fitted.usedH)
    const blockTop = Math.round(topSafe + Math.max(0, (middleSafeH - blockH) / 2))
    title = { ...paperBand(shape, size, blockTop, titleHeight), y: blockTop, height: titleHeight }
    if (fitted.maxSummaryLines > 0) {
      const sY = blockTop + titleHeight + fitted.gap
      const sLines = Math.max(1, Math.floor(Math.max(0, bottomSafe - sY) / summaryLine))
      const band = paperBand(shape, size, sY, sLines * summaryLine)
      if (w - band.left - band.right >= 56) {
        summary = { ...band, y: sY, lines: sLines }
      }
    }
  } else if (hasTitle && hasSummary) {
    const effTitleLines = Math.min(lines, titleLinesLegacy || Math.max(1, estimateWrappedLines(titleText, width, font)))
    const titleHeight = line * effTitleLines
    let titleY = Math.round(topSafe + (middleSafeH - titleHeight) / 2)
    const minSummaryW = Math.round(85 * (summaryFont / 12.5))
    const cornersOk = top?.showLeft && (hasCustomTopRight || !status || top.showRight) && (!association || bottom?.showLeft) && (!relations || bottom?.showRight)
    if (cornersOk && middleSafeH >= titleHeight + baseSummaryGap + summaryLine) {
      const maxAvail = Math.floor((middleSafeH - titleHeight - baseSummaryGap) / summaryLine)
      for (let sLines = maxAvail; sLines > 0; sLines--) {
        const blockH = titleHeight + baseSummaryGap + sLines * summaryLine
        const blockTop = Math.round(topSafe + (middleSafeH - blockH) / 2)
        const sY = blockTop + titleHeight + baseSummaryGap
        const band = paperBand(shape, size, sY, sLines * summaryLine)
        if (w - band.left - band.right < minSummaryW) continue
        titleY = blockTop
        summary = { ...band, y: sY, lines: sLines }
        break
      }
    }
    lines = effTitleLines
    const wrapHeight = line * lines
    const titleBandY = Math.min(titleY, (h - wrapHeight) / 2)
    title = { ...paperBand(shape, size, titleBandY, wrapHeight), y: titleY, height: titleHeight }
  } else if (hasTitle && !hasSummary) {
    const fitted = fitTitleOnly(titleText, centeredWidthFor, middleSafeH, bounds.titleMin, bounds.titleMax, 2)
    font = fitted.font
    line = fitted.line
    lines = fitted.lines
    const titleHeight = line * lines
    const titleY = Math.round(topSafe + Math.max(0, (middleSafeH - titleHeight) / 2))
    title = { ...paperBand(shape, size, titleY, titleHeight), y: titleY, height: titleHeight }
  } else if (!hasTitle && hasSummary && summaryText) {
    const fitted = fitBodyOnly(summaryText, centeredWidthFor, middleSafeH, bounds.bodyMin, bounds.bodyOnlyMax, 60)
    summaryFont = fitted.font
    summaryLine = fitted.line
    const blockH = Math.min(middleSafeH, fitted.usedH)
    const sY = Math.round(topSafe + Math.max(0, (middleSafeH - blockH) / 2))
    const sLines = Math.max(1, Math.floor(Math.max(0, bottomSafe - sY) / summaryLine))
    const band = paperBand(shape, size, sY, sLines * summaryLine)
    summary = { ...band, y: sY, lines: sLines }
  } else if (!hasTitle && hasSummary) {
    const maxAvail = Math.max(1, Math.floor(middleSafeH / summaryLine))
    const blockH = maxAvail * summaryLine
    const sY = Math.round(topSafe + Math.max(0, (middleSafeH - blockH) / 2))
    const band = paperBand(shape, size, sY, blockH)
    summary = { ...band, y: sY, lines: maxAvail }
  } else {
    const emptyY = Math.round(topSafe + Math.max(0, (middleSafeH - summaryLine) / 2))
    empty = { ...paperBand(shape, size, emptyY, summaryLine), y: emptyY, height: summaryLine }
  }

  return {
    centered,
    hasTitle,
    scale,
    iconSize: Math.round(clamp(12 * scale, 10, 18)),
    dotSize: Math.round(clamp(5 * scale, 4.5, 8.5)),
    metaFont,
    metaLine,
    summaryFont,
    summaryLine,
    font,
    line,
    lines,
    title,
    top,
    bottom,
    summary,
    empty
  }
}

export function outlineDraftCardLayout({ w, h }, opts = {}) {
  const kind = opts.kind || 'note'
  const titleText = opts.title || ''
  const summaryText = typeof opts.summary === 'string' ? opts.summary.trim() : ''
  const hasTitle = opts.hasTitle !== undefined ? Boolean(opts.hasTitle) : Boolean(String(titleText).trim())
  const summaryProvided = opts.summary !== undefined || opts.hasSummary !== undefined
  const hasSummary = opts.hasSummary !== undefined ? Boolean(opts.hasSummary) : (opts.summary !== undefined ? Boolean(summaryText) : true)
  const scale = cardScaleFor({ w, h }, kind)
  const padX = Math.round(clamp(14 * scale, 10, 26))
  const padY = Math.round(clamp(12 * scale, 8, 22))
  const innerW = Math.max(40, w - 2 * padX)
  const metaFont = round1(clamp(10.5 * scale, 9.5, 16))
  const metaLine = Math.round(metaFont * 1.35)
  const gapTop = Math.round(clamp(7 * scale, 4, 14))
  let gapBody = Math.round(clamp(6 * scale, 4, 12))
  const availH = Math.max(20, h - 2 * padY - metaLine - gapTop)
  const bounds = fontBoundsFor(scale, kind)
  const fixedW = () => innerW

  let titleFont = round1(clamp(14.5 * scale, 12, bounds.titleMax))
  let titleLine = Math.round(titleFont * titleLineRatio(titleFont))
  let titleLines = hasTitle ? 2 : 0
  let bodyFont = hasTitle
    ? round1(clamp(12 * scale, 10.5, bounds.titledBodyMax))
    : round1(clamp(14.5 * scale, 12, bounds.bodyOnlyMax))
  let bodyLine = Math.round(bodyFont * bodyLineRatio(bodyFont))
  let bodyLines = 1
  let justify = 'flex-start'

  if (hasTitle && hasSummary && summaryText) {
    const fitted = fitTitleAndBody(titleText, summaryText, fixedW, availH, {
      ...bounds,
      baseGap: gapBody,
      maxTitleLines: 2,
      minSummaryW: 56
    })
    titleFont = fitted.titleFont
    titleLine = fitted.titleLine
    titleLines = fitted.titleLines
    bodyFont = fitted.summaryFont
    bodyLine = fitted.summaryLine
    gapBody = fitted.gap
    bodyLines = Math.max(1, fitted.maxSummaryLines)
    justify = fitted.fits && availH - fitted.usedH > availH * 0.18 ? 'center' : 'flex-start'
  } else if (!hasTitle && hasSummary && summaryText) {
    const fitted = fitBodyOnly(summaryText, fixedW, availH, bounds.bodyMin, bounds.bodyOnlyMax, 52)
    bodyFont = fitted.font
    bodyLine = fitted.line
    bodyLines = fitted.maxLines
    justify = fitted.fits && availH - fitted.usedH > availH * 0.18 ? 'center' : 'flex-start'
  } else if (hasTitle && summaryProvided && !hasSummary && titleText) {
    const fitted = fitTitleOnly(titleText, fixedW, availH, bounds.titleMin, bounds.titleMax, 3)
    titleFont = fitted.font
    titleLine = fitted.line
    titleLines = fitted.lines
    bodyLines = 0
    justify = 'center'
  } else {
    // Fallback when caller omits summary string
    const estTitle = hasTitle ? Math.min(2, Math.max(1, estimateWrappedLines(titleText, innerW, titleFont))) : 0
    titleLines = estTitle
    const remH = hasTitle ? Math.max(0, availH - estTitle * titleLine - gapBody) : availH
    bodyLines = Math.max(1, Math.floor(remH / bodyLine))
    justify = hasTitle && !hasSummary ? 'center' : 'flex-start'
  }

  return {
    hasTitle,
    scale,
    padX,
    padY,
    gapTop,
    gapBody,
    metaFont,
    metaLine,
    titleFont,
    titleLine,
    titleLines,
    bodyFont,
    bodyLine,
    bodyLines,
    justify
  }
}
