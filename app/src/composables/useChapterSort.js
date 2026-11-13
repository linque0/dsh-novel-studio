import { usePointerRowSort } from './usePointerRowSort.js'

const ROW = '[data-chapter-sort-chapter], [data-chapter-sort-volume]'
function collectRows(list, listTop) {
  return Array.from(list.querySelectorAll(ROW), (node) => {
    const el = node.closest('.n-tree-node-wrapper') || node
    const rect = el.getBoundingClientRect()
    const top = rect.top - listTop + list.scrollTop
    return {
      node, el, top, bottom: top + rect.height, height: rect.height, shift: 0,
      chapter: node.dataset.chapterSortChapter,
      volume: node.dataset.chapterSortVolume
    }
  }).filter((row) => row.height > 0)
}

function getTarget(drag, bounds) {
  const { x, y, list, rows, from, grabY, sourceRect } = drag
  if (x < bounds.left || x >= bounds.right || y < bounds.top || y >= bounds.bottom) return null
  const pointer = y - bounds.top + list.scrollTop
  const header = rows.findIndex((row) => row.volume !== undefined && pointer >= row.top && pointer < row.bottom)
  if (header >= 0) {
    let slot = header + 1
    while (slot < rows.length && rows[slot].volume === undefined) slot++
    return { slot, mode: 'inside', id: rows[header].volume }
  }
  const center = pointer - grabY + sourceRect.height / 2
  const index = rows.findIndex((row, i) => center < (row.bottom + (rows[i + 1]?.top ?? Infinity)) / 2)
  const row = rows[index]
  if (!row?.chapter || index === from) return null
  const midpoint = (row.top + row.bottom) / 2
  const previous = drag.target
  const mode = previous?.id === row.chapter && Math.abs(center - midpoint) < 3
    ? previous.mode
    : center < midpoint ? 'before' : 'after'
  return { slot: index + Number(mode === 'after'), mode, id: row.chapter }
}

function preview(drag, target) {
  const slot = target?.slot ?? drag.from
  for (const [index, row] of drag.rows.entries()) {
    const shift = index >= slot && index < drag.from ? drag.extent
      : index > drag.from && index < slot ? -drag.extent : 0
    if (row.shift === shift) continue
    row.shift = shift
    row.el.style.setProperty('--chapter-sort-shift', `${shift}px`)
  }
  const header = target?.mode === 'inside' ? drag.rows.find((row) => row.volume === target.id)?.el : null
  if (header !== drag.header) {
    drag.header?.removeAttribute('data-chapter-sort-target')
    header?.setAttribute('data-chapter-sort-target', '')
    drag.header = header
  }
}

function slotTop(drag, target) {
  const { rows, from, extent } = drag
  const slot = target?.slot ?? from
  if (slot === from || slot === from + 1) return rows[from].top
  const boundary = rows[slot]?.top ?? rows.at(-1).bottom
  return slot > from ? boundary - extent : boundary
}

/** Shared pointer gesture for the chapter tree and the Crimson rail. */
export function useChapterSort(listRef, work, query, available = () => true) {
  const structure = () => JSON.stringify([
    work.work?.id, query.value, available(), work.liveVolumes.map((v) => v.id),
    work.liveChapters.map((c) => [c.id, c.volumeId, c.sortOrder])
  ])

  function commit(id, target) {
    if (target.mode === 'inside') return work.moveChapterTo(id, target.id, 'inside')
    const reference = work.liveChapters.find((c) => c.id === target.id)
    if (!reference) return false
    return work.moveChapterTo(id, reference.volumeId, target.mode, reference.id)
  }

  return usePointerRowSort(listRef, {
    structure, collectRows, getTarget, preview, commit, slotTop, available,
    sourceSelector: '[data-chapter-sort-chapter]',
    rowKey: row => row.chapter ?? `v:${row.volume}`
  })
}
