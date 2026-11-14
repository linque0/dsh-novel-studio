export const writingPanels = {
  directory: { label: '章节栏', capsule: '章节', minW: 180, minH: 200 },
  notes: { label: '批注栏', capsule: '批注', minW: 200, minH: 200 }
}

const gap = 6
const clamp = (value, max) => Math.max(0, Math.min(value, max))
const sizeValue = value => Number.isFinite(value) && value > 0 ? value : undefined

export function normalizeWritingLayout(value) {
  const layout = {}
  for (const key of ['directory', 'notes', 'directoryCapsule', 'notesCapsule', 'paper']) {
    const input = value?.[key]
    if (!input || typeof input !== 'object') continue
    const rect = {}
    for (const axis of ['w', 'h']) {
      if (!key.endsWith('Capsule') && sizeValue(input[axis])) rect[axis] = input[axis]
    }
    for (const axis of ['x', 'y']) {
      if (key !== 'paper' && Number.isFinite(input[axis])) rect[axis] = clamp(input[axis], 1)
    }
    if (Object.keys(rect).length) layout[key] = rect
  }
  return layout
}

export function placeWritingRect(rect, other, size) {
  const { w, h } = rect
  if (w > size.w || h > size.h) return null
  const x = clamp(rect.x, size.w - w)
  const y = clamp(rect.y, size.h - h)
  if (!other) return { x, y, w, h }
  const left = other.x - w - gap
  const right = other.x + other.w + gap
  const top = other.y - h - gap
  const bottom = other.y + other.h + gap
  if (x <= left || x >= right || y <= top || y >= bottom) return { x, y, w, h }
  return [{ x: left, y }, { x: right, y }, { x, y: top }, { x, y: bottom }]
    .filter(p => p.x >= 0 && p.y >= 0 && p.x + w <= size.w && p.y + h <= size.h)
    .sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y))
    .map(p => ({ ...p, w, h }))[0] || null
}

function requestedRect(size, layout, key, open, sideWidth, maxW = size.w, maxH = size.h) {
  const saved = layout[open ? key : key + 'Capsule'] || {}
  const { minW, minH } = writingPanels[key]
  const w = open ? Math.min(maxW, Math.max(minW, saved.w ?? (key === 'directory' ? sideWidth : 280))) : Math.min(32, size.w)
  const h = open ? Math.min(maxH, Math.max(minH, saved.h ?? size.h)) : Math.min(58, size.h)
  return { w, h, x: (saved.x ?? (key === 'notes' ? 1 : 0)) * (size.w - w), y: (saved.y ?? 0) * (size.h - h) }
}

function fitBeside(size, layout, key, open, sideWidth, other, start) {
  const requested = requestedRect(size, layout, key, open, sideWidth)
  const placed = placeWritingRect(requested, other, size)
  if (placed || !open) return placed
  const { minW, minH } = writingPanels[key]
  const availableW = Math.max(other.x, size.w - other.x - other.w) - gap
  const availableH = Math.max(other.y, size.h - other.y - other.h) - gap
  const options = []
  if (availableW >= minW) options.push(requestedRect(size, layout, key, true, sideWidth, availableW))
  if (availableH >= minH) options.push(requestedRect(size, layout, key, true, sideWidth, size.w, availableH))
  for (const option of options.sort((a, b) => b.w * b.h - a.w * a.h)) {
    const fit = placeWritingRect(option, other, size)
    if (fit) return fit
  }
  if (!start.open) return null
  // Give both expanded panels room before temporarily collapsing either one.
  const first = start.key
  const firstMin = writingPanels[first]
  const leftFirst = start.x + start.w / 2 <= requested.x + requested.w / 2
  const topFirst = start.y + start.h / 2 <= requested.y + requested.h / 2
  const axes = [
    ['x', 'w', minW, firstMin.minW, leftFirst],
    ['y', 'h', minH, firstMin.minH, topFirst]
  ]
  for (const [axis, span, min, firstFloor, firstBefore] of axes) {
    if (size[span] < firstFloor + gap + min) continue
    const firstSpan = Math.min(start[span], size[span] - gap - min)
    const secondSpan = Math.min(requested[span], size[span] - gap - firstSpan)
    const firstStart = firstBefore ? clamp(start[axis], size[span] - firstSpan - gap - secondSpan)
      : Math.max(secondSpan + gap, clamp(start[axis], size[span] - firstSpan))
    const secondStart = firstBefore ? Math.max(firstStart + firstSpan + gap, clamp(requested[axis], size[span] - secondSpan))
      : clamp(requested[axis], firstStart - gap - secondSpan)
    Object.assign(start, { [axis]: firstStart, [span]: firstSpan })
    return { ...requested, [axis]: secondStart, [span]: secondSpan }
  }
  return null
}

export function arrangeWritingPanels(size, layout, visible, priority, sideWidth) {
  if (!size.w || !size.h) return {}
  const keys = Object.keys(writingPanels).filter(key => visible[key] != null)
  if (keys.includes(priority)) keys.sort((a, b) => Number(b === priority) - Number(a === priority))
  const result = {}
  for (const key of keys) {
    let open = visible[key]
    // An expanded panel must leave at least one edge for the other capsule.
    const otherKey = keys.find(other => other !== key)
    const other = result[otherKey]
    let rect
    if (!other) {
      const requested = requestedRect(size, layout, key, open, sideWidth)
      const reserve = 32 + gap
      if (open && otherKey && requested.h > size.h - 58 - gap && size.w >= writingPanels[key].minW + reserve) {
        rect = requestedRect(size, layout, key, open, sideWidth, size.w - reserve)
      } else rect = requested
    } else {
      rect = fitBeside(size, layout, key, open, sideWidth, other, other)
      if (!rect) {
        open = false
        rect = placeWritingRect(requestedRect(size, layout, key, false, sideWidth), other, size)
        if (!rect) {
          const reserve = Math.min(32, size.w) + gap
          other.w = Math.max(0, Math.min(other.w, size.w - reserve))
          other.x = key === 'directory' ? Math.max(reserve, other.x) : Math.min(other.x, size.w - reserve - other.w)
          rect = placeWritingRect(requestedRect(size, layout, key, false, sideWidth), other, size)
        }
      }
    }
    if (rect) result[key] = { ...rect, open, key }
  }
  return result
}

export function resizeWritingPanel(rect, other, size, axis, delta) {
  const { key, x, y, w, h } = rect
  const { minW, minH } = writingPanels[key]
  if (axis === 'h') {
    const room = other && x < other.x + other.w + gap && x + w > other.x - gap && y + h <= other.y
      ? other.y - gap - y : size.h - y
    return { ...rect, h: Math.min(room, Math.max(Math.min(minH, h), h + delta)) }
  }
  const leading = key === 'notes'
  const end = x + w
  let room = leading ? end : size.w - x
  if (other && y < other.y + other.h + gap && y + h > other.y - gap) {
    if (leading && x >= other.x + other.w) room = end - other.x - other.w - gap
    if (!leading && end <= other.x) room = other.x - gap - x
  }
  const width = Math.min(room, Math.max(Math.min(minW, w), w + (leading ? -delta : delta)))
  return { ...rect, w: width, x: leading ? end - width : x }
}
