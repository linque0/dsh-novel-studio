import { nextTick, onBeforeUnmount, watch } from 'vue'
import '../styles/chapter-sort.css'

const EASING = 'cubic-bezier(.22, .61, .36, 1)'
const GHOST_PROPERTIES = [
  'display', 'box-sizing', 'width', 'height', 'flex', 'grid-template-columns',
  'gap', 'align-items', 'justify-content', 'margin', 'padding', 'border-radius',
  'font-family', 'font-size', 'font-style', 'font-weight', 'line-height', 'color',
  'letter-spacing', 'text-align', 'text-overflow', 'white-space', 'overflow-wrap',
  '-webkit-box-orient', '-webkit-line-clamp', 'overflow', 'opacity', 'fill', 'stroke'
]

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
    for (const attr of ['id', 'title', 'draggable', 'data-chapter-sort-chapter', 'data-chapter-sort-volume', 'data-lore-sort-row', 'data-node', 'contenteditable']) clone.removeAttribute(attr)
  })
  copy.style.margin = '0'
  if (source.dataset.loreSortRow) {
    copy.style.setProperty('--depth', source.dataset.depth || '0')
    copy.style.background = 'transparent'
    ghost.dataset.loreSortGhost = ''
  }
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

export function usePointerRowSort(listRef, options) {
  const { structure, collectRows, getTarget, preview, commit, slotTop, sourceSelector, rowKey, sourceRows } = options
  let session
  let finishAnimation
  let suppressClick = false
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
    const target = getTarget(drag, bounds)
    moveGhost(drag.ghost, options.ghostX?.(drag, target) ?? drag.x - drag.grabX, drag.y - drag.grabY)
    if (target?.id !== drag.target?.id || target?.mode !== drag.target?.mode ||
        target?.slot !== drag.target?.slot || target?.snap !== drag.target?.snap) preview(drag, target)
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
    const branch = sourceRows?.(rows, from) || [source]
    const last = branch.at(-1)
    const following = rows[from + branch.length]
    const gap = following && (sourceRows || following.chapter) ? Math.max(0, following.top - last.bottom) : 0
    Object.assign(drag, {
      rows, from, branch, sourceRect, extent: last.bottom - source.top + gap,
      grabX: drag.startX - sourceRect.left, grabY: drag.startY - sourceRect.top,
      ghost: createGhost(node, sourceRect), frameTime: performance.now(), scrollRemainder: 0
    })
    suppressClick = true
    list.setPointerCapture(pointerId)
    list.setAttribute('data-chapter-sort-active', '')
    for (const row of rows) row.el.setAttribute('data-chapter-sort-shifting', '')
    source.el.setAttribute('data-chapter-sort-source', '')
    for (const row of branch.slice(1)) row.el.setAttribute('data-lore-sort-branch', '')
    drag.observer = new MutationObserver(() => {
      const current = collectRows(list, list.getBoundingClientRect().top)
      if (current.length !== rows.length || rows.some((row, i) => row.node !== current[i].node)) stop(false)
    })
    drag.observer.observe(list, { childList: true, subtree: true })
    frame(performance.now())
    return true
  }

  function clearPreview(drag) {
    options.clearPreview?.(drag)
    drag.list.removeAttribute('data-chapter-sort-active')
    drag.header?.removeAttribute('data-chapter-sort-target')
    for (const row of drag.rows) {
      row.el.removeAttribute('data-chapter-sort-shifting')
      row.el.removeAttribute('data-chapter-sort-source')
      row.el.removeAttribute('data-lore-sort-branch')
      row.el.style.removeProperty('--chapter-sort-shift')
    }
  }

  async function settle(drag, target) {
    const duration = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 180
    const { ghost, list, rows, from } = drag
    const bounds = list.getBoundingClientRect()
    const fallback = { left: drag.sourceRect.left, top: bounds.top + slotTop(drag, target) - list.scrollTop }
    const visual = target ? new Map(rows.map((row) => [rowKey(row), row.el.getBoundingClientRect().top])) : null
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
        committed = await commit(rowKey(rows[from]), target)
      } catch (error) {
        window.$msg?.error('排序未能完成：' + (error?.message || error))
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
        if (rowKey(row) === rowKey(rows[from])) {
          landed = row.el
          destination = row.node.getBoundingClientRect()
          continue
        }
        const delta = visual.get(rowKey(row)) - row.el.getBoundingClientRect().top
        if (duration && Number.isFinite(delta) && Math.abs(delta) > 1) {
          animations.push(row.el.animate(
            [{ transform: `translateY(${delta}px)` }, { transform: 'translateY(0)' }],
            { duration, easing: EASING }
          ))
        }
      }
      if (landed) landed.setAttribute('data-chapter-sort-source', '')
      else destination = (sourceRows && updated.find(row => rowKey(row) === target.id)?.node.getBoundingClientRect()) || fallback
    } else {
      preview(drag, null)
    }
    if (!duration) return done()
    ghost.setAttribute('data-chapter-sort-settling', '')
    moveGhost(ghost, destination.left, destination.top)
    timer = setTimeout(done, duration)
  }

  function stop(drop, event, immediate = false) {
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
    if (immediate) {
      clearPreview(drag)
      drag.ghost.remove()
    } else void settle(drag, target)
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
    const handle = event.target.closest(sourceSelector)
    const node = handle && (options.sourceNode ? options.sourceNode(handle) : handle)
    if (options.available?.() === false || !node || !list?.contains(node)) return
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
    if (!event.target.closest(sourceSelector)) return
    event.preventDefault()
    event.stopPropagation()
  }
  function click(event) {
    if (!suppressClick || !event.detail) return
    suppressClick = false
    event.preventDefault()
    event.stopPropagation()
  }

  watch(structure, () => { if (session) stop(false, null, true) })
  onBeforeUnmount(() => {
    stop(false, null, true)
    finishAnimation?.()
  })
  return { pointerDown, nativeDrag, click }
}
