import { usePointerRowSort } from './usePointerRowSort.js'

const SNAP_RANGE = 6
const SWITCH_MARGIN = 3
const BRANCH_MARGIN = 6
const EMPTY_GUIDES = []

function collectDomRows(list, listTop) {
  const rows = Array.from(list.querySelectorAll('[data-lore-sort-row]'), el => {
    const rect = el.getBoundingClientRect()
    const bullet = el.querySelector('.ob-bullet').getBoundingClientRect()
    const top = rect.top - listTop + list.scrollTop
    return {
      node: el, el, top, bottom: top + rect.height, height: rect.height, left: rect.left,
      id: el.dataset.loreSortRow, key: 'm:' + el.dataset.loreSortRow, depth: Number(el.dataset.depth),
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

/** O(log N) 二分命中指针所在行索引 */
function findRowIndex(rows, pointer) {
  const len = rows.length
  if (!len) return -1
  if (pointer < rows[0].top) return -1
  if (pointer >= rows[len - 1].bottom) return -1
  let lo = 0
  let hi = len - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const row = rows[mid]
    const prevMid = mid > 0 ? (rows[mid - 1].bottom + row.top) * 0.5 : row.top
    const nextMid = mid < len - 1 ? (row.bottom + rows[mid + 1].top) * 0.5 : row.bottom
    if (pointer < prevMid) hi = mid - 1
    else if (pointer >= nextMid) lo = mid + 1
    else return mid
  }
  return -1
}

function collectLevels(drag, bounds) {
  const source = drag.rows[drag.from]
  const nodes = drag.nodes
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
  const siblings = drag.siblingsByParent.get(level.id || null) || []
  let reference = null
  for (let i = 0; i < siblings.length; i++) {
    const entry = siblings[i]
    if (pointer < drag.rows[entry.row.end - 1].bottom) {
      reference = entry
      break
    }
  }
  if (!reference && siblings.length) reference = siblings[siblings.length - 1]
  const before = !append && reference && pointer < (reference.row.top + drag.rows[reference.row.end - 1].bottom) / 2
  const parentRow = drag.rowsById.get(level.id)
  const slot = mode === 'sink' && drag.nodes.get(level.id)?.fold ? drag.from
    : before ? reference.index : (append ? siblings[siblings.length - 1] : reference)?.row.end ?? parentRow?.end ?? drag.from
  return {
    mode, id: level.id, slot,
    placement: { referenceId: append ? null : reference?.row.id, side: before ? 'before' : 'after' },
    snap: append ? null : level,
    level: level.level
  }
}

/** O(1) 纯数学推导子层级参考列坐标，彻底消除临时 DOM probe 插入与重排 */
function childColumns(parent, drag) {
  const childDepth = parent.depth + 1
  const indentStep = drag.indentStep || 22
  const baseGuideX = drag.baseGuideX
  const baseBulletX = drag.baseBulletX
  return {
    x: baseGuideX + (childDepth - 1) * indentStep,
    bulletX: baseBulletX + childDepth * indentStep
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
        if (!drag.lowerColumns.has(id)) drag.lowerColumns.set(id, childColumns(parent, drag))
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

function hitsCachedSetHead(drag, pointer) {
  const ranges = drag.setHeadRanges
  if (!ranges || !ranges.length) return false
  for (let i = 0; i < ranges.length; i++) {
    const [top, bottom] = ranges[i]
    if (pointer >= top && pointer < bottom) return true
  }
  return false
}

function getTarget(drag, bounds, freeEntries) {
  const { x, y, list, rows, from } = drag
  if (x < bounds.left || x >= bounds.right || y < bounds.top || y >= bounds.bottom) return null
  if (!rows.length) return null
  const pointer = y - bounds.top + list.scrollTop
  if (hitsCachedSetHead(drag, pointer)) return null
  const source = rows[from]
  const index = findRowIndex(rows, pointer)
  const row = index >= 0 ? rows[index] : null
  const level = selectLevel(drag.levels, x, drag.target?.mode === 'lift' ? drag.target.snap : null)
  if (level || pointer >= rows[rows.length - 1].bottom) {
    showLevelGuides(drag, bounds, EMPTY_GUIDES, 'lowerGuides')
    if (level) return levelTarget(drag, level, pointer)
    if (freeEntries) return { mode: 'root', id: null, slot: rows.length }
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
    return !freeEntries && mode === 'inside' ? { mode: 'swap', id: row.id, slot: from } : null
  }
  const target = { mode, id: row.id, slot: mode === 'before' ? index : row.end }
  const node = drag.nodes.get(row.id)
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

function computeRowShift(index, from, end, slot, extent) {
  if (index >= slot && index < from) return extent
  if (index >= end && index < slot) return -extent
  return 0
}

export function useLoreSort(editor, work, context, refresh, checkpoint, { freeEntries = false, prepareLift, rowWindow = null } = {}) {
  const isVirtualized = Boolean(rowWindow)

  function applyShiftToMountedEl(drag, key, el, instant = false) {
    const row = drag.rowsByKey?.get(key)
    if (!row) return
    const index = row.index
    const from = drag.from
    const end = drag.virtualEnd
    const slot = drag.activeSlot ?? from
    const shift = computeRowShift(index, from, end, slot, drag.extent)
    if (index === from) {
      el.setAttribute('data-chapter-sort-source', '')
    } else if (!isVirtualized && index > from && index < end) {
      el.setAttribute('data-lore-sort-branch', '')
    }
    if (instant) {
      el.style.setProperty('--chapter-sort-shift', `${shift}px`)
      el.setAttribute('data-chapter-sort-shifting', '')
    } else {
      if (!el.hasAttribute('data-chapter-sort-shifting')) el.setAttribute('data-chapter-sort-shifting', '')
      el.style.setProperty('--chapter-sort-shift', `${shift}px`)
    }
    if (drag.targetHighlightId && row.id === drag.targetHighlightId) {
      el.setAttribute('data-chapter-sort-target', drag.headerMode)
      drag.header = el
    }
  }

  function preview(drag, target) {
    showLift(drag, target)
    const { rows, from, extent } = drag
    const end = drag.virtualEnd ?? rows[from].end
    const slot = target?.slot ?? from
    drag.activeSlot = slot

    const wantHighlightId = ['inside', 'swap', 'sink'].includes(target?.mode) ? target.id : null
    drag.targetHighlightId = wantHighlightId

    if (isVirtualized) {
      // 仅更新当前视口内已挂载的 ~30 行 DOM，彻底杜绝上千行同时改样式与动画
      rowWindow.forEachMountedRow((key, el) => {
        const row = drag.rowsByKey.get(key)
        if (!row) return
        const shift = computeRowShift(row.index, from, end, slot, extent)
        if (shift !== row.shift || el.style.getPropertyValue('--chapter-sort-shift') !== `${shift}px`) {
          row.shift = shift
          el.style.setProperty('--chapter-sort-shift', `${shift}px`)
        }
      })
      const highlight = wantHighlightId ? rowWindow.getMountedRowEl('m:' + wantHighlightId) : null
      if (highlight !== drag.header || target?.mode !== drag.headerMode) {
        drag.header?.removeAttribute('data-chapter-sort-target')
        if (highlight && target?.mode) highlight.setAttribute('data-chapter-sort-target', target.mode)
        drag.header = highlight
        drag.headerMode = target?.mode
      }
      return
    }

    for (let index = 0; index < rows.length; index++) {
      const row = rows[index]
      const shift = computeRowShift(index, from, end, slot, extent)
      if (shift === row.shift) continue
      row.shift = shift
      row.el?.style.setProperty('--chapter-sort-shift', `${shift}px`)
    }
    const highlight = wantHighlightId ? drag.rowsById.get(wantHighlightId)?.el : null
    if (highlight === drag.header && target?.mode === drag.headerMode) return
    drag.header?.removeAttribute('data-chapter-sort-target')
    if (highlight && target?.mode) highlight.setAttribute('data-chapter-sort-target', target.mode)
    drag.header = highlight
    drag.headerMode = target?.mode
  }

  function initDragCache(drag, bounds) {
    const live = work.mubuIndex.live
    drag.nodes = work.mubuIndex.byId
    drag.parents = new Map()
    for (let i = 0; i < live.length; i++) {
      const n = live[i]
      drag.parents.set(n.id, n.parentId || null)
    }
    const rows = drag.rows
    drag.rowsById = new Map()
    drag.rowsByKey = new Map()
    drag.siblingsByParent = new Map()
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      row.index = i
      drag.rowsById.set(row.id, row)
      drag.rowsByKey.set(row.key || ('m:' + row.id), row)
      const pid = drag.parents.get(row.id) ?? null
      let arr = drag.siblingsByParent.get(pid)
      if (!arr) {
        arr = []
        drag.siblingsByParent.set(pid, arr)
      }
      arr.push({ row, index: i })
    }
    drag.virtualEnd = isVirtualized ? drag.from + 1 : rows[drag.from].end
    drag.levels = collectLevels(drag, bounds)
    drag.rootId = work.mubuRootOf(rows[drag.from].id)?.id
    drag.lowerLevels = EMPTY_GUIDES
    drag.lowerColumns = new Map()

    // 校准纯数学缩进参数（零 DOM 探针）
    if (drag.meta) {
      drag.indentStep = drag.meta.indentStep
      drag.baseGuideX = drag.meta.baseGuideX
      drag.baseBulletX = drag.meta.baseBulletX
    } else {
      const src = rows[drag.from]
      let indentStep = 22
      if (src.guides.length >= 2 && src.guides[1] - src.guides[0] > 4) {
        indentStep = src.guides[1] - src.guides[0]
      } else {
        const other = rows.find(r => r.depth !== src.depth)
        if (other) {
          const step = (other.bulletX - src.bulletX) / (other.depth - src.depth)
          if (step > 8 && step < 64) indentStep = step
        }
      }
      drag.indentStep = indentStep
      drag.baseGuideX = src.guides.length ? src.guides[0] : src.left + 12
      drag.baseBulletX = src.bulletX - src.depth * indentStep
    }

    // 经典皮肤下一次性缓存 .mubu-set-head 区间，替代每帧 elementFromPoint
    if (!freeEntries) {
      const heads = drag.list.querySelectorAll('.mubu-set-head')
      drag.setHeadRanges = Array.from(heads, h => {
        const r = h.getBoundingClientRect()
        const top = r.top - bounds.top + drag.list.scrollTop
        return [top, top + r.height]
      })
    } else {
      drag.setHeadRanges = null
    }

    const ghostBullet = drag.ghost.querySelector('.ob-bullet')?.getBoundingClientRect()
    const ghostRect = drag.ghost.getBoundingClientRect()
    drag.ghostBulletOffset = ghostBullet ? (ghostBullet.left + ghostBullet.width / 2 - ghostRect.left) : 16
    const source = rows[drag.from]
    const sourceParent = drag.parents.get(source.id) ?? null
    const sibs = drag.siblingsByParent.get(sourceParent) || []
    let prevSib = null
    for (let i = 0; i < sibs.length; i++) {
      if (sibs[i].index >= drag.from) break
      prevSib = sibs[i].row
    }
    drag.previousSibling = prevSib
    showLevelGuides(drag, bounds, drag.levels, 'upperGuides')
  }

  return usePointerRowSort(editor, {
    virtualized: isVirtualized,
    prepareLift: isVirtualized ? rowWindow.beginVirtualDrag : prepareLift,
    structure: () => `${work.work?.id || ''}|${work.mubuSetId || ''}|${work.mubuRevision}|${JSON.stringify(context())}`,
    sourceSelector: '.ob-bullet',
    sourceNode: handle => handle.closest('[data-lore-sort-row]'),
    rowKey: row => row.id,
    collectRows(list, listTop, sourceEl) {
      if (isVirtualized) {
        const snap = rowWindow.snapshotVirtualRows(list, listTop, sourceEl)
        return { rows: snap.rows, meta: { indentStep: snap.indentStep, baseGuideX: snap.baseGuideX, baseBulletX: snap.baseBulletX } }
      }
      return collectDomRows(list, listTop)
    },
    sourceRows(rows, from) {
      return isVirtualized ? [rows[from]] : rows.slice(from, rows[from].end)
    },
    onLift(drag) {
      if (!isVirtualized) {
        for (const row of drag.rows) row.el?.setAttribute('data-chapter-sort-shifting', '')
        drag.rows[drag.from].el?.setAttribute('data-chapter-sort-source', '')
        for (const row of drag.branch.slice(1)) row.el?.setAttribute('data-lore-sort-branch', '')
        return
      }
      drag.activeSlot = drag.from
      rowWindow.forEachMountedRow((key, el) => {
        el.setAttribute('data-chapter-sort-shifting', '')
        if (key === drag.rows[drag.from].key) el.setAttribute('data-chapter-sort-source', '')
      })
      rowWindow.setMountSync((key, el) => applyShiftToMountedEl(drag, key, el, true))
    },
    clearMounted(drag) {
      if (!isVirtualized) return
      rowWindow.setMountSync(null)
      rowWindow.forEachMountedRow((_key, el) => {
        el.removeAttribute('data-chapter-sort-shifting')
        el.removeAttribute('data-chapter-sort-source')
        el.removeAttribute('data-lore-sort-branch')
        el.removeAttribute('data-chapter-sort-target')
        el.style.removeProperty('--chapter-sort-shift')
      })
    },
    snapshotVisual(drag, map) {
      if (isVirtualized) {
        rowWindow.forEachMountedRow((key, el) => {
          const id = el.dataset.loreSortRow || key.slice(2)
          map.set(id, el.getBoundingClientRect().top)
        })
        return
      }
      for (const row of drag.rows) {
        if (row.el) map.set(row.id, row.el.getBoundingClientRect().top)
      }
    },
    collectMountedRows() {
      const list = []
      rowWindow.forEachMountedRow((key, el) => {
        const rect = el.getBoundingClientRect()
        if (rect.height > 0) {
          list.push({ id: el.dataset.loreSortRow || key.slice(2), el, rect })
        }
      })
      return list
    },
    getTarget(drag, bounds) {
      if (!drag.levels) initDragCache(drag, bounds)
      return getTarget(drag, bounds, freeEntries)
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
      const end = drag.virtualEnd ?? rows[from].end
      if (!target || target.slot === from || target.slot === end) return rows[from].top
      const boundary = rows[target.slot]?.top ?? rows[rows.length - 1].bottom
      return target.slot > from ? boundary - extent : boundary
    },
    commit(id, target) {
      const changed = freeEntries
        ? work.mubuPlace(id, target.id, target.mode, target.placement, checkpoint)
        : work.mubuDrop(id, target.id, target.mode, checkpoint, target.placement)
      if (changed) refresh()
      return changed
    }
  })
}
