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

function createGhost(source, rect, descendantCount = 0) {
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
  if (descendantCount > 0) {
    const badge = document.createElement('span')
    badge.className = 'lore-sort-branch-badge'
    badge.textContent = `含 ${descendantCount} 个子节点`
    ghost.append(badge)
  }
  document.body.append(ghost)
  return ghost
}

function moveGhost(ghost, x, y) {
  ghost.style.transform = `translate3d(${x}px, ${y}px, 0)`
}

export function usePointerRowSort(listRef, options) {
  const { structure, collectRows, getTarget, preview, commit, slotTop, sourceSelector, rowKey, sourceRows, virtualized = false } = options
  let session
  let finishAnimation
  let suppressClick = false

  function frame(time) {
    const drag = session
    if (!drag?.ghost) return
    if (!drag.list.isConnected) return stop(false)

    const bounds = drag.bounds || (drag.bounds = drag.list.getBoundingClientRect())
    let pixels = 0
    if (drag.x >= bounds.left && drag.x < bounds.right && drag.y >= bounds.top && drag.y < bounds.bottom) {
      const edge = Math.min(38, bounds.height / 3)
      const start = Math.max(0, 1 - (drag.y - bounds.top) / edge)
      const end = Math.max(0, 1 - (bounds.bottom - drag.y) / edge)
      const elapsed = Math.min(32, time - drag.frameTime)
      const distance = (end ** 2 - start ** 2) * elapsed * .65
      const accumulated = distance ? distance + drag.scrollRemainder : 0
      pixels = Math.trunc(accumulated)
      drag.scrollRemainder = accumulated - pixels
      if (pixels) drag.list.scrollTop += pixels
    } else {
      drag.scrollRemainder = 0
    }
    drag.frameTime = time

    const scrollTop = drag.list.scrollTop
    const dirty = !drag.hasFrame || pixels !== 0 || drag.x !== drag.lastX || drag.y !== drag.lastY || scrollTop !== drag.lastScrollTop
    if (dirty) {
      drag.hasFrame = true
      drag.lastX = drag.x
      drag.lastY = drag.y
      drag.lastScrollTop = scrollTop
      const target = getTarget(drag, bounds)
      moveGhost(drag.ghost, options.ghostX?.(drag, target) ?? drag.x - drag.grabX, drag.y - drag.grabY)
      if (target?.id !== drag.target?.id || target?.mode !== drag.target?.mode ||
          target?.slot !== drag.target?.slot || target?.snap !== drag.target?.snap) {
        preview(drag, target)
      }
      drag.target = target
    }
    drag.frame = requestAnimationFrame(frame)
  }

  function lift(drag) {
    const { list, node, pointerId } = drag
    const bounds = list.getBoundingClientRect()
    const collected = collectRows(list, bounds.top, node)
    const rows = Array.isArray(collected) ? collected : collected.rows
    if (!Array.isArray(collected) && collected.meta) drag.meta = collected.meta
    const from = rows.findIndex((row) => row.node === node || (node.dataset?.loreSortRow && row.id === node.dataset.loreSortRow))
    if (from < 0) return false
    const source = rows[from]
    const sourceRect = node.getBoundingClientRect()
    const branch = sourceRows?.(rows, from) || [source]
    const last = branch.at(-1)
    const following = rows[from + branch.length]
    const gap = following && (sourceRows || following.chapter) ? Math.max(0, following.top - last.bottom) : 0
    const descendantCount = drag.preparation?.descendantCount || 0
    const extent = virtualized ? source.height : (last.bottom - source.top + gap)
    Object.assign(drag, {
      rows, from, branch, sourceRect, bounds, extent,
      grabX: drag.startX - sourceRect.left, grabY: drag.startY - sourceRect.top,
      ghost: createGhost(node, sourceRect, descendantCount),
      frameTime: performance.now(), scrollRemainder: 0,
      hasFrame: false, lastX: NaN, lastY: NaN, lastScrollTop: NaN
    })
    suppressClick = true
    if (!drag.preparation) list.setPointerCapture(pointerId)
    list.setAttribute('data-chapter-sort-active', '')
    if (options.onLift) {
      options.onLift(drag)
    } else {
      for (const row of rows) row.el?.setAttribute('data-chapter-sort-shifting', '')
      source.el?.setAttribute('data-chapter-sort-source', '')
      for (const row of branch.slice(1)) row.el?.setAttribute('data-lore-sort-branch', '')
    }
    if (!virtualized) {
      drag.observer = new MutationObserver(() => {
        const current = collectRows(list, list.getBoundingClientRect().top, node)
        const listNow = Array.isArray(current) ? current : current.rows
        if (listNow.length !== rows.length || rows.some((row, i) => row.node !== listNow[i].node)) stop(false)
      })
      drag.observer.observe(list, { childList: true, subtree: true })
    }
    frame(performance.now())
    return true
  }

  function clearPreview(drag) {
    options.clearPreview?.(drag)
    drag.list.removeAttribute('data-chapter-sort-active')
    drag.header?.removeAttribute('data-chapter-sort-target')
    if (!options.clearMounted) {
      for (const row of drag.rows) {
        if (!row.el) continue
        row.el.removeAttribute('data-chapter-sort-shifting')
        row.el.removeAttribute('data-chapter-sort-source')
        row.el.removeAttribute('data-lore-sort-branch')
        row.el.style.removeProperty('--chapter-sort-shift')
      }
    } else {
      options.clearMounted(drag)
    }
  }

  function snapshotMountedTops(drag) {
    const map = new Map()
    if (options.snapshotVisual) {
      options.snapshotVisual(drag, map)
      return map
    }
    for (const row of drag.rows) {
      if (row.el) map.set(rowKey(row), row.el.getBoundingClientRect().top)
    }
    return map
  }

  async function settle(drag, target) {
    const duration = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 180
    const { ghost, list, rows, from } = drag
    const bounds = list.getBoundingClientRect()
    const fallback = { left: drag.sourceRect.left, top: bounds.top + slotTop(drag, target) - list.scrollTop }
    const visual = target ? snapshotMountedTops(drag) : null
    const sourceId = rowKey(rows[from])
    let landed
    let timer
    const animations = []
    let released = false
    const releasePrep = () => {
      if (released) return
      released = true
      drag.preparation?.release()
    }
    const done = () => {
      clearTimeout(timer)
      for (const animation of animations) animation.cancel()
      clearPreview(drag)
      landed?.removeAttribute('data-chapter-sort-source')
      ghost.remove()
      releasePrep()
      if (finishAnimation === done) finishAnimation = null
    }
    finishAnimation = done
    let committed = false
    if (target) {
      try {
        committed = await commit(sourceId, target)
      } catch (error) {
        window.$msg?.error('排序未能完成：' + (error?.message || error))
      }
    }
    if (finishAnimation !== done) return
    let destination = drag.node?.isConnected ? drag.node.getBoundingClientRect() : fallback
    if (committed) {
      clearPreview(drag)
      releasePrep()
      await nextTick()
      if (finishAnimation !== done) return
      if (virtualized && options.collectMountedRows) {
        const mounted = options.collectMountedRows(list)
        for (const row of mounted) {
          if (row.id === sourceId) {
            landed = row.el
            destination = row.rect
            continue
          }
          const prevTop = visual.get(row.id)
          if (prevTop == null) continue
          const delta = prevTop - row.rect.top
          if (duration && Number.isFinite(delta) && Math.abs(delta) > 1) {
            animations.push(row.el.animate(
              [{ transform: `translate3d(0, ${delta}px, 0)` }, { transform: 'translate3d(0, 0, 0)' }],
              { duration, easing: EASING }
            ))
          }
        }
        if (landed) landed.setAttribute('data-chapter-sort-source', '')
        else destination = mounted.find(row => row.id === target.id)?.rect || fallback
      } else {
        const updated = collectRows(list, list.getBoundingClientRect().top, drag.node)
        const updatedRows = Array.isArray(updated) ? updated : updated.rows
        for (const row of updatedRows) {
          if (rowKey(row) === sourceId) {
            landed = row.el
            destination = row.node.getBoundingClientRect()
            continue
          }
          const delta = visual.get(rowKey(row)) - row.el.getBoundingClientRect().top
          if (duration && Number.isFinite(delta) && Math.abs(delta) > 1) {
            animations.push(row.el.animate(
              [{ transform: `translate3d(0, ${delta}px, 0)` }, { transform: 'translate3d(0, 0, 0)' }],
              { duration, easing: EASING }
            ))
          }
        }
        if (landed) landed.setAttribute('data-chapter-sort-source', '')
        else destination = (sourceRows && updatedRows.find(row => rowKey(row) === target.id)?.node.getBoundingClientRect()) || fallback
      }
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
    drag.stopStructureWatch?.()
    drag.stopStructureWatch = null
    window.removeEventListener('pointermove', onMove, true)
    window.removeEventListener('pointerup', onUp, true)
    window.removeEventListener('pointercancel', onCancel, true)
    window.removeEventListener('keydown', onKey, true)
    window.removeEventListener('blur', onBlur)
    window.removeEventListener('resize', onBlur)
    drag.list.removeEventListener('lostpointercapture', onCancel)
    if (drag.list.hasPointerCapture(drag.pointerId)) drag.list.releasePointerCapture(drag.pointerId)
    if (!drag.ghost) {
      drag.preparation?.release()
      return
    }
    cancelAnimationFrame(drag.frame)
    drag.observer?.disconnect()
    if (event) {
      drag.x = event.clientX
      drag.y = event.clientY
    }
    const target = drop && drag.structure === structure() ? getTarget(drag, drag.list.getBoundingClientRect()) : null
    if (immediate) {
      clearPreview(drag)
      drag.ghost.remove()
      drag.preparation?.release()
    } else void settle(drag, target)
  }

  function onMove(event) {
    const drag = session
    if (!drag || event.pointerId !== drag.pointerId) return
    drag.x = event.clientX
    drag.y = event.clientY
    if (!drag.ghost && !drag.preparation && Math.hypot(drag.x - drag.startX, drag.y - drag.startY) >= 5) {
      drag.preparation = options.prepareLift?.(drag.node)
      if (drag.preparation) {
        drag.list.setPointerCapture(drag.pointerId)
        void drag.preparation.ready.then(() => {
          if (session === drag && !lift(drag)) stop(false)
        }).catch(() => {
          if (session === drag) stop(false)
        })
      } else if (!lift(drag)) return stop(false)
    }
    if (drag.ghost || drag.preparation) event.preventDefault()
  }
  function onUp(event) {
    if (event.pointerId === session?.pointerId) stop(true, event)
  }
  function onCancel(event) {
    if (event.pointerId === session?.pointerId) stop(false)
  }
  function onBlur() { stop(false) }
  function onKey(event) {
    if (event.key !== 'Escape' || !(session?.ghost || session?.preparation)) return
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
    const currentSession = {
      list, node, structure: structure(), pointerId: event.pointerId,
      startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY,
      stopStructureWatch: null
    }
    session = currentSession
    // 仅在拖拽会话激活期间监听结构变更，非拖拽期零开销
    currentSession.stopStructureWatch = watch(structure, () => {
      if (session === currentSession) stop(false, null, true)
    })
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

  function cancel() {
    stop(false, null, true)
    finishAnimation?.()
  }
  onBeforeUnmount(cancel)
  return { pointerDown, nativeDrag, click, cancel }
}
