import { nextTick, onBeforeUnmount, watch } from 'vue'
import '../styles/chapter-sort.css'

const ROW = '[data-chapter-sort-chapter], [data-chapter-sort-volume]'
const EASING = 'cubic-bezier(.22, .61, .36, 1)'
const GHOST_PROPERTIES = [
  'display', 'box-sizing', 'width', 'height', 'flex', 'grid-template-columns',
  'gap', 'align-items', 'justify-content', 'margin', 'padding', 'border-radius',
  'font-family', 'font-size', 'font-style', 'font-weight', 'line-height', 'color',
  'letter-spacing', 'text-align', 'text-overflow', 'white-space', 'overflow-wrap',
  '-webkit-box-orient', '-webkit-line-clamp', 'overflow', 'opacity', 'fill', 'stroke'
]

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

function createGhost(source, rect) {
  const ghost = document.createElement('div')
  ghost.dataset.chapterSortGhost = ''
  ghost.setAttribute('aria-hidden', 'true')
  ghost.inert = true
  const copy = source.cloneNode(true)
  const originals = [source, ...source.querySelectorAll('*')]
  const copies = [copy, ...copy.querySelectorAll('*')]
  originals.forEach((original, i) => {
    const css = getComputedStyle(original)
    const clone = copies[i]
    for (const property of GHOST_PROPERTIES) clone.style.setProperty(property, css.getPropertyValue(property))
    for (const attr of ['id', 'title', 'draggable', 'data-chapter-sort-chapter', 'data-chapter-sort-volume']) clone.removeAttribute(attr)
  })
  copy.style.margin = '0'
  ghost.style.width = `${rect.width}px`
  ghost.style.height = `${rect.height}px`
  if (source.matches('.crimson-rail-chapter.current')) {
    const selected = getComputedStyle(source)
    ghost.style.backgroundColor = selected.backgroundColor
    ghost.style.color = selected.color
  }
  ghost.append(copy)
  document.body.append(ghost)
  return ghost
}

function moveGhost(ghost, x, y) {
  ghost.style.transform = `translate3d(${x}px, ${y}px, 0)`
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
  let session
  let finishAnimation
  let suppressClick = false
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

  function frame(time) {
    const drag = session
    if (!drag?.ghost) return
    if (!drag.list.isConnected) return stop(false)
    const bounds = drag.list.getBoundingClientRect()
    if (drag.x >= bounds.left && drag.x < bounds.right && drag.y >= bounds.top && drag.y < bounds.bottom) {
      const edge = Math.min(38, bounds.height / 3)
      const start = Math.max(0, 1 - (drag.y - bounds.top) / edge)
      const end = Math.max(0, 1 - (bounds.bottom - drag.y) / edge)
      const elapsed = Math.min(32, time - drag.frameTime)
      const distance = (end ** 2 - start ** 2) * elapsed * .65
      const accumulated = distance ? distance + drag.scrollRemainder : 0
      const pixels = Math.trunc(accumulated)
      drag.scrollRemainder = accumulated - pixels
      if (pixels) drag.list.scrollTop += pixels
    } else {
      drag.scrollRemainder = 0
    }
    drag.frameTime = time
    moveGhost(drag.ghost, drag.x - drag.grabX, drag.y - drag.grabY)
    const target = getTarget(drag, bounds)
    if (target?.id !== drag.target?.id || target?.mode !== drag.target?.mode) preview(drag, target)
    drag.target = target
    drag.frame = requestAnimationFrame(frame)
  }

  function lift(drag) {
    const { list, node, pointerId } = drag
    const rows = collectRows(list, list.getBoundingClientRect().top)
    const from = rows.findIndex((row) => row.node === node)
    if (from < 0) return false
    const source = rows[from]
    const sourceRect = node.getBoundingClientRect()
    const following = rows[from + 1]
    const gap = following?.chapter ? Math.max(0, following.top - source.bottom) : 0
    Object.assign(drag, {
      rows, from, sourceRect, extent: source.height + gap,
      grabX: drag.startX - sourceRect.left, grabY: drag.startY - sourceRect.top,
      ghost: createGhost(node, sourceRect), frameTime: performance.now(), scrollRemainder: 0
    })
    suppressClick = true
    list.setPointerCapture(pointerId)
    list.setAttribute('data-chapter-sort-active', '')
    for (const row of rows) row.el.setAttribute('data-chapter-sort-shifting', '')
    source.el.setAttribute('data-chapter-sort-source', '')
    drag.observer = new MutationObserver(() => {
      const nodes = list.querySelectorAll(ROW)
      if (nodes.length !== rows.length || rows.some((row, i) => row.node !== nodes[i])) stop(false)
    })
    drag.observer.observe(list, { childList: true, subtree: true })
    frame(performance.now())
    return true
  }

  function clearPreview(drag) {
    drag.list.removeAttribute('data-chapter-sort-active')
    drag.header?.removeAttribute('data-chapter-sort-target')
    for (const row of drag.rows) {
      row.el.removeAttribute('data-chapter-sort-shifting')
      row.el.removeAttribute('data-chapter-sort-source')
      row.el.style.removeProperty('--chapter-sort-shift')
    }
  }

  async function settle(drag, target) {
    const duration = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 180
    const { ghost, list, node, rows, from } = drag
    const bounds = list.getBoundingClientRect()
    const fallback = { left: drag.sourceRect.left, top: bounds.top + slotTop(drag, target) - list.scrollTop }
    const visual = target ? new Map(rows.map((row) => [row.chapter ?? `v:${row.volume}`, row.el.getBoundingClientRect().top])) : null
    let landed
    let timer
    const animations = []
    const done = () => {
      clearTimeout(timer)
      for (const animation of animations) animation.cancel()
      clearPreview(drag)
      landed?.removeAttribute('data-chapter-sort-source')
      ghost.remove()
      if (finishAnimation === done) finishAnimation = null
    }
    finishAnimation = done
    let committed = false
    if (target) {
      try {
        committed = await commit(node.dataset.chapterSortChapter, target)
      } catch (error) {
        window.$msg?.error('章节排序未能完成：' + (error?.message || error))
      }
    }
    if (finishAnimation !== done) return
    let destination = rows[from].node.getBoundingClientRect()
    if (committed) {
      clearPreview(drag)
      await nextTick()
      if (finishAnimation !== done) return
      const updated = collectRows(list, list.getBoundingClientRect().top)
      for (const row of updated) {
        if (row.chapter === node.dataset.chapterSortChapter) {
          landed = row.el
          destination = row.node.getBoundingClientRect()
          continue
        }
        const delta = visual.get(row.chapter ?? `v:${row.volume}`) - row.el.getBoundingClientRect().top
        if (duration && Number.isFinite(delta) && Math.abs(delta) > 1) {
          animations.push(row.el.animate(
            [{ transform: `translateY(${delta}px)` }, { transform: 'translateY(0)' }],
            { duration, easing: EASING }
          ))
        }
      }
      if (landed) landed.setAttribute('data-chapter-sort-source', '')
      else destination = fallback
    } else {
      preview(drag, null)
    }
    if (!duration) return done()
    ghost.setAttribute('data-chapter-sort-settling', '')
    moveGhost(ghost, destination.left, destination.top)
    timer = setTimeout(done, duration)
  }

  function stop(drop, event) {
    const drag = session
    if (!drag) return
    session = null
    window.removeEventListener('pointermove', onMove, true)
    window.removeEventListener('pointerup', onUp, true)
    window.removeEventListener('pointercancel', onCancel, true)
    window.removeEventListener('keydown', onKey, true)
    window.removeEventListener('blur', onBlur)
    window.removeEventListener('resize', onBlur)
    drag.list.removeEventListener('lostpointercapture', onCancel)
    if (!drag.ghost) return
    cancelAnimationFrame(drag.frame)
    drag.observer?.disconnect()
    if (drag.list.hasPointerCapture(drag.pointerId)) drag.list.releasePointerCapture(drag.pointerId)
    if (event) {
      drag.x = event.clientX
      drag.y = event.clientY
    }
    const target = drop && drag.structure === structure() ? getTarget(drag, drag.list.getBoundingClientRect()) : null
    void settle(drag, target)
  }

  function onMove(event) {
    const drag = session
    if (!drag || event.pointerId !== drag.pointerId) return
    drag.x = event.clientX
    drag.y = event.clientY
    if (!drag.ghost && Math.hypot(drag.x - drag.startX, drag.y - drag.startY) >= 5 && !lift(drag)) return stop(false)
    if (drag.ghost) event.preventDefault()
  }
  function onUp(event) {
    if (event.pointerId === session?.pointerId) stop(true, event)
  }
  function onCancel(event) {
    if (event.pointerId === session?.pointerId) stop(false)
  }
  function onBlur() { stop(false) }
  function onKey(event) {
    if (event.key !== 'Escape' || !session?.ghost) return
    event.preventDefault()
    event.stopImmediatePropagation()
    stop(false)
  }
  function pointerDown(event) {
    if (event.button !== 0 || !event.isPrimary || event.pointerType === 'touch' || session) return
    suppressClick = false
    const list = listRef.value
    const node = event.target.closest('[data-chapter-sort-chapter]')
    if (!available() || !node || !list?.contains(node)) return
    finishAnimation?.()
    session = {
      list, node, structure: structure(), pointerId: event.pointerId,
      startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY
    }
    window.addEventListener('pointermove', onMove, { capture: true, passive: false })
    window.addEventListener('pointerup', onUp, true)
    window.addEventListener('pointercancel', onCancel, true)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('blur', onBlur)
    window.addEventListener('resize', onBlur)
    list.addEventListener('lostpointercapture', onCancel)
  }
  function nativeDrag(event) {
    if (!event.target.closest('[data-chapter-sort-chapter]')) return
    event.preventDefault()
    event.stopPropagation()
  }
  function click(event) {
    if (!suppressClick || !event.detail) return
    suppressClick = false
    event.preventDefault()
    event.stopPropagation()
  }

  watch(structure, () => stop(false))
  onBeforeUnmount(() => {
    stop(false)
    finishAnimation?.()
  })
  return { pointerDown, nativeDrag, click }
}
