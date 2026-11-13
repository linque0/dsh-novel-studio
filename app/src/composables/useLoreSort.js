import { usePointerRowSort } from './usePointerRowSort.js'

const SNAP_RANGE = 6
const SWITCH_MARGIN = 3
const BRANCH_MARGIN = 6
const EMPTY_GUIDES = []

function collectRows(list, listTop) {
  const rows = Array.from(list.querySelectorAll('[data-lore-sort-row]'), el => {
    const rect = el.getBoundingClientRect()
    const bullet = el.querySelector('.ob-bullet').getBoundingClientRect()
    const top = rect.top - listTop + list.scrollTop
    return {
      node: el, el, top, bottom: top + rect.height, height: rect.height, left: rect.left,
      id: el.dataset.loreSortRow, depth: Number(el.dataset.depth),
      guides: [...el.querySelectorAll('.ob-guide')].map(guide => guide.getBoundingClientRect().left),
      bulletX: bullet.left + bullet.width / 2, shift: 0
    }
  }).filter(row => row.height > 0)
  const open = []
  rows.forEach((row, index) => {
    while (open.length && rows[open.at(-1)].depth >= row.depth) rows[open.pop()].end = index
    open.push(index)
  })
  for (const index of open) rows[index].end = rows.length
  return rows
}

function collectLevels(drag, bounds, work) {
  const source = drag.rows[drag.from]
  const nodes = new Map(work.liveMubu().map(node => [node.id, node]))
  const parents = []
  const seen = new Set([source.id])
  for (let parent = nodes.get(source.id)?.parentId; parent; parent = nodes.get(parent)?.parentId) {
    if (seen.has(parent) || !nodes.has(parent)) return []
    seen.add(parent)
    parents.unshift(parent)
  }
  parents.pop()
  const visible = source.guides.slice(0, parents.length)
  const hidden = parents.length - visible.length
  const left = bounds.left + 4
  const edge = visible[0] ?? source.bulletX - SNAP_RANGE * 2
  return parents.map((id, index) => ({
    id, level: index + 1,
    x: index < hidden
      ? left + Math.max(0, edge - left) * index / Math.max(1, hidden)
      : Math.max(left, visible[index - hidden])
  }))
}

function selectLevel(levels, x, previous) {
  const last = levels.at(-1)
  if (!last || x > last.x + SNAP_RANGE + (previous ? SWITCH_MARGIN : 0)) return null
  if (x < levels[0].x) return levels[0]
  const nearest = levels.reduce((best, level) => Math.abs(level.x - x) < Math.abs(best.x - x) ? level : best)
  if (previous && Math.abs(previous.x - x) - Math.abs(nearest.x - x) < SWITCH_MARGIN * 2) return previous
  return nearest
}

function levelTarget(drag, level, pointer, { append = false, mode = 'lift' } = {}) {
  const siblings = drag.rows.map((row, index) => ({ row, index }))
    .filter(({ row }) => drag.parents.get(row.id) === level.id)
  const reference = siblings.find(({ row }) => pointer < drag.rows[row.end - 1].bottom) || siblings.at(-1)
  const before = !append && reference && pointer < (reference.row.top + drag.rows[reference.row.end - 1].bottom) / 2
  const parentRow = drag.rows.find(row => row.id === level.id)
  const slot = mode === 'sink' && drag.nodes.get(level.id)?.fold ? drag.from
    : before ? reference.index : (append ? siblings.at(-1) : reference)?.row.end ?? parentRow?.end ?? drag.from
  return {
    mode, id: level.id, slot,
    placement: { referenceId: append ? null : reference?.row.id, side: before ? 'before' : 'after' },
    snap: append ? null : level,
    level: level.level
  }
}

function childColumns(parent, rows, parents) {
  const childDepth = parent.depth + 1
  const sample = rows.find(row => parents.get(row.id) === parent.id)
    ?? rows.find(row => row.depth === childDepth && row.guides.length === childDepth)
  if (sample) return { x: sample.guides.at(-1), bulletX: sample.bulletX }

  // A leaf or a folded branch can still be a parent. Measure the child
  // indentation with the same row styles, including the active skin's padding.
  const probe = parent.el.cloneNode(false)
  probe.removeAttribute('data-lore-sort-row')
  probe.removeAttribute('data-node')
  probe.removeAttribute('data-chapter-sort-source')
  probe.removeAttribute('data-chapter-sort-shifting')
  probe.removeAttribute('data-lore-sort-branch')
  probe.dataset.depth = childDepth
  const latent = parent.el.style.getPropertyValue('--depth') !== ''
  probe.style.setProperty('--depth', childDepth)
  Object.assign(probe.style, {
    position: 'absolute', left: '0', width: `${parent.el.offsetWidth}px`,
    visibility: 'hidden', pointerEvents: 'none'
  })
  let lastGuide
  for (let i = 0; i < childDepth; i++) {
    const guide = document.createElement('span')
    guide.className = 'ob-guide'
    if (latent) guide.style.left = `${i * 22 + 12}px`
    probe.append(guide)
    lastGuide = guide
  }
  for (const el of parent.el.querySelectorAll(':scope > .ob-fold-toggle, :scope > .ob-bullet')) {
    probe.append(el.cloneNode(false))
  }
  parent.el.after(probe)
  try {
    const origin = probe.getBoundingClientRect().left
    const guide = lastGuide.getBoundingClientRect()
    const bullet = probe.querySelector('.ob-bullet').getBoundingClientRect()
    return { x: parent.left + guide.left - origin, bulletX: parent.left + bullet.left + bullet.width / 2 - origin }
  } finally {
    probe.remove()
  }
}

function lowerLevels(drag, row) {
  if (drag.lowerAnchor === row?.id) return drag.lowerLevels
  drag.lowerAnchor = row?.id
  const source = drag.rows[drag.from]
  const chain = []
  for (let id = row?.id; id && !chain.includes(id); id = drag.parents.get(id)) chain.unshift(id)
  const root = drag.rootId
  const sourceLevel = drag.levels.length + 1
  drag.lowerLevels = chain[0] === root && !chain.includes(source.id)
    ? chain.slice(sourceLevel).flatMap((id, index) => {
        const parent = drag.rowsById.get(id)
        if (!parent) return []
        if (!drag.lowerColumns.has(id)) drag.lowerColumns.set(id, childColumns(parent, drag.rows, drag.parents))
        return [{ id, level: sourceLevel + index + 1, ...drag.lowerColumns.get(id) }]
      })
    : EMPTY_GUIDES
  return drag.lowerLevels
}

function selectLowerLevel(levels, x, previous) {
  const first = levels[0]
  const last = levels.at(-1)
  if (!first) return null
  const retained = levels.find(level => level.id === previous?.id)
  const margin = SNAP_RANGE + (retained ? SWITCH_MARGIN : 0)
  if (x < first.x - margin || x > last.x + margin) return null

  // A single coordinate per level gives each guide a continuous column.
  const nearest = levels.reduce((best, level) =>
    Math.abs(level.x - x) < Math.abs(best.x - x) ? level : best)
  if (retained && Math.abs(retained.x - x) - Math.abs(nearest.x - x) < SWITCH_MARGIN * 2) return retained
  return nearest
}

function lowerTarget(drag, bounds, row, pointer, inSource) {
  const previous = drag.target?.mode === 'sink' ? drag.target.snap : null
  const anchor = inSource ? drag.previousSibling : row
  const oldAnchor = drag.rowsById.get(drag.lowerAnchor)
  const oldLevels = drag.lowerLevels
  let levels = Math.abs(drag.x - drag.startX) > SWITCH_MARGIN || previous
    ? lowerLevels(drag, anchor)
    : EMPTY_GUIDES
  if (previous && oldAnchor && !levels.some(level => level.id === previous.id) &&
      pointer >= oldAnchor.top - BRANCH_MARGIN && pointer <= oldAnchor.bottom + BRANCH_MARGIN) {
    drag.lowerAnchor = oldAnchor.id
    levels = drag.lowerLevels = oldLevels
  }
  showLevelGuides(drag, bounds, levels, 'lowerGuides')
  const level = selectLowerLevel(levels, drag.x, previous)
  return level ? levelTarget(drag, level, pointer, { mode: 'sink' }) : null
}

function getTarget(drag, bounds, work) {
  const { x, y, list, rows, from } = drag
  if (x < bounds.left || x >= bounds.right || y < bounds.top || y >= bounds.bottom) return null
  const pointer = y - bounds.top + list.scrollTop
  const source = rows[from]
  const index = rows.findIndex((row, i) =>
    pointer >= ((rows[i - 1]?.bottom ?? row.top) + row.top) / 2 &&
    pointer < (row.bottom + (rows[i + 1]?.top ?? row.bottom)) / 2)
  const row = rows[index]
  if (document.elementFromPoint(x, y)?.closest('.mubu-set-head')) return null
  const level = selectLevel(drag.levels, x, drag.target?.mode === 'lift' ? drag.target.snap : null)
  if (level || pointer >= rows.at(-1).bottom) {
    showLevelGuides(drag, bounds, EMPTY_GUIDES, 'lowerGuides')
    if (level) return levelTarget(drag, level, pointer)
    if (drag.levels.length) return levelTarget(drag, drag.levels.at(-1), pointer, { append: true })
  }
  const lower = lowerTarget(drag, bounds, row, pointer, index >= from && index < source.end)
  if (lower) return lower
  if (!row || index === from) return null
  const edge = row.height * .28
  const offset = pointer - row.top
  const before = edge
  const after = row.height - edge
  const previous = drag.target
  let mode = offset < before ? 'before' : offset > after ? 'after' : 'inside'
  const threshold = Math.min(3, edge / 3)
  if (previous?.id === row.id && ['before', 'after', 'inside', 'swap'].includes(previous.mode) &&
      (Math.abs(offset - before) <= threshold || Math.abs(offset - after) <= threshold)) {
    mode = previous.mode === 'swap' ? 'inside' : previous.mode
  }
  if (index > from && index < source.end) {
    return mode === 'inside' ? { mode: 'swap', id: row.id, slot: from } : null
  }
  const target = { mode, id: row.id, slot: mode === 'before' ? index : row.end }
  const node = work.mubu.find(node => node.id === row.id)
  if (mode === 'inside' && node?.fold) target.slot = from
  return target
}

function clearLift(drag) {
  drag.activeGuide?.classList.remove('is-active')
  drag.liftLabel?.remove()
  drag.activeGuide = drag.liftLabel = null
}

function showLevelGuides(drag, bounds, levels, key) {
  if (drag[key] === levels) return
  for (const level of drag[key] || []) level.guide?.remove()
  drag[key] = levels
  for (const level of levels) {
    const guide = document.createElement('span')
    guide.className = 'lore-sort-level-guide'
    guide.dataset.loreSortLevel = level.level
    guide.setAttribute('aria-hidden', 'true')
    Object.assign(guide.style, {
      left: `${level.x}px`, top: `${bounds.top}px`, height: `${bounds.height}px`
    })
    document.body.append(guide)
    level.guide = guide
  }
}

function showLift(drag, target) {
  if (!['lift', 'sink'].includes(target?.mode)) return clearLift(drag)
  if (!drag.liftLabel) {
    drag.liftLabel = document.createElement('span')
    drag.liftLabel.className = 'lore-sort-level-label'
    drag.ghost.append(drag.liftLabel)
  }
  drag.liftLabel.textContent = `${target.mode === 'sink' ? '降' : '升'}至第 ${target.level} 级`
  drag.liftLabel.style.left = `${drag.ghostBulletOffset}px`
  drag.activeGuide?.classList.remove('is-active')
  drag.activeGuide = target.snap?.guide
  drag.activeGuide?.classList.add('is-active')
}

function preview(drag, target) {
  showLift(drag, target)
  const { rows, from, extent } = drag
  const end = rows[from].end
  const slot = target?.slot ?? from
  for (const [index, row] of rows.entries()) {
    const shift = index >= slot && index < from ? extent
      : index >= end && index < slot ? -extent : 0
    if (shift === row.shift) continue
    row.shift = shift
    row.el.style.setProperty('--chapter-sort-shift', `${shift}px`)
  }
  const highlight = ['inside', 'swap', 'sink'].includes(target?.mode)
    ? rows.find(row => row.id === target.id)?.el
    : null
  if (highlight === drag.header && target?.mode === drag.headerMode) return
  drag.header?.removeAttribute('data-chapter-sort-target')
  highlight?.setAttribute('data-chapter-sort-target', target.mode)
  drag.header = highlight
  drag.headerMode = target?.mode
}

export function useLoreSort(editor, work, context, refresh, checkpoint) {
  return usePointerRowSort(editor, {
    structure: () => JSON.stringify([
      context(), work.work?.id, work.mubuSetId,
      work.liveMubu().map(node => [node.id, node.parentId, node.sortOrder, node.fold])
    ]),
    sourceSelector: '.ob-bullet',
    sourceNode: handle => handle.closest('[data-lore-sort-row]'),
    rowKey: row => row.id,
    collectRows,
    sourceRows(rows, from) {
      return rows.slice(from, rows[from].end)
    },
    getTarget(drag, bounds) {
      if (!drag.levels) {
        drag.levels = collectLevels(drag, bounds, work)
        drag.nodes = new Map(work.liveMubu().map(node => [node.id, node]))
        drag.parents = new Map(Array.from(drag.nodes, ([id, node]) => [id, node.parentId]))
        drag.rootId = work.mubuRootOf(drag.rows[drag.from].id)?.id
        drag.lowerLevels = EMPTY_GUIDES
        drag.lowerColumns = new Map()
        drag.rowsById = new Map(drag.rows.map(row => [row.id, row]))
        const ghostBullet = drag.ghost.querySelector('.ob-bullet').getBoundingClientRect()
        drag.ghostBulletOffset = ghostBullet.left + ghostBullet.width / 2 - drag.ghost.getBoundingClientRect().left
        const source = drag.rows[drag.from]
        drag.previousSibling = drag.rows.slice(0, drag.from).findLast(row => drag.parents.get(row.id) === drag.parents.get(source.id))
        showLevelGuides(drag, bounds, drag.levels, 'upperGuides')
      }
      return getTarget(drag, bounds, work)
    },
    ghostX: (drag, target) => target?.snap
      ? (target.snap.bulletX ?? target.snap.x) - drag.ghostBulletOffset
      : drag.x - drag.grabX,
    clearPreview(drag) {
      clearLift(drag)
      for (const level of [...(drag.levels || []), ...(drag.lowerGuides || [])]) level.guide?.remove()
    },
    preview,
    slotTop(drag, target) {
      const { rows, from, extent } = drag
      if (!target || target.slot === from || target.slot === rows[from].end) return rows[from].top
      const boundary = rows[target.slot]?.top ?? rows.at(-1).bottom
      return target.slot > from ? boundary - extent : boundary
    },
    commit(id, target) {
      const changed = work.mubuDrop(id, target.id, target.mode, checkpoint, target.placement)
      if (changed) refresh()
      return changed
    }
  })
}
