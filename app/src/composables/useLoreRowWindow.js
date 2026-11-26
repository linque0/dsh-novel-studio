import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { loreRowAtOffset, loreViewportIndices } from '../services/lore-core.js'

export function useLoreRowWindow(editor, surface, rows, pinnedKeys) {
  const sizes = shallowRef(new Map())
  const elements = new Map()
  const top = ref(0)
  const height = ref(600)
  const expanded = ref(false)
  const dragActive = ref(false)
  const dragPinnedKey = ref(null)
  const hiddenBranch = ref(null) // { start, end } indices in rows.value to collapse visually during drag
  let origin = 0
  let width = 0
  let observer
  let mountSync = null

  const activeRows = computed(() => {
    const all = rows.value
    const hide = hiddenBranch.value
    if (!hide || hide.start >= hide.end) return all
    return all.slice(0, hide.start).concat(all.slice(hide.end))
  })

  const windowed = computed(() => activeRows.value.length > 80 && !expanded.value)

  const layout = computed(() => {
    const list = activeRows.value
    const offsets = [0]
    const keys = []
    const indices = new Map()
    const sizeMap = sizes.value
    for (let index = 0; index < list.length; index++) {
      const row = list[index]
      const key = row.node.key
      const estimate = row.depth === 0 ? 54 : 39
      keys.push(key)
      indices.set(key, index)
      offsets.push(offsets[index] + (sizeMap.get(key) ?? estimate))
    }
    return { offsets, keys, indices }
  })

  const entries = computed(() => {
    const all = activeRows.value
    if (!windowed.value) return all
    const { offsets, indices } = layout.value
    const pinned = pinnedKeys.value.map(key => indices.get(key) ?? -1)
    if (dragPinnedKey.value) {
      const dragIdx = indices.get(dragPinnedKey.value)
      if (dragIdx != null) pinned.push(dragIdx)
    }
    const visible = loreViewportIndices(offsets, top.value, height.value, 320, pinned)
    const result = []
    let cursor = 0
    function gap(end, key) {
      if (end > cursor) result.push({ gapKey: key, height: offsets[end] - offsets[cursor] })
    }
    for (const index of visible) {
      const row = all[index]
      gap(index, 'before:' + row.node.key)
      result.push(row)
      cursor = index + 1
    }
    gap(all.length, 'end')
    return result
  })

  function updateScroll() {
    if (editor.value) top.value = Math.max(0, editor.value.scrollTop - origin)
  }
  function updateViewport() {
    const scroller = editor.value, content = surface.value
    if (!scroller?.clientHeight || !content) return
    const rect = scroller.getBoundingClientRect()
    origin = content.getBoundingClientRect().top - rect.top + scroller.scrollTop - scroller.clientTop
    height.value = scroller.clientHeight
    updateScroll()
  }

  function measure(changes) {
    const scroller = editor.value
    if (!scroller?.clientHeight) return
    const next = scroller.clientWidth === width ? new Map(sizes.value) : new Map()
    let changed = scroller.clientWidth !== width
    width = scroller.clientWidth
    if (changes.some(entry => entry.target === scroller)) updateViewport()
    for (const { target, borderBoxSize } of changes) {
      const key = target.dataset.loreWindowKey
      if (!key || elements.get(key) !== target) continue
      const size = borderBoxSize?.[0]?.blockSize || target.offsetHeight
      if (size && next.get(key) !== size) {
        next.set(key, size)
        changed = true
      }
    }
    if (!changed) return
    sizes.value = next
  }

  watch(layout, (next, previous) => {
    const scroller = editor.value
    if (!windowed.value || dragActive.value || !scroller?.clientHeight || top.value === 0) return
    const oldIndex = loreRowAtOffset(previous.offsets, top.value)
    const newIndex = next.indices.get(previous.keys[oldIndex])
    if (newIndex == null) return
    const shift = next.offsets[newIndex] - previous.offsets[oldIndex]
    if (!shift) return
    const scroll = scroller.scrollTop
    nextTick(() => {
      if (!windowed.value || dragActive.value || editor.value !== scroller || !scroller.clientHeight) return
      const clamped = Math.min(scroll, scroller.scrollHeight - scroller.clientHeight)
      if (Math.abs(scroller.scrollTop - clamped) > 1) return
      scroller.scrollTop = scroll + shift
      updateScroll()
    })
  })

  function bind(key, el) {
    const old = elements.get(key)
    if (old === el) return
    if (old) {
      observer?.unobserve(old)
      const oldRow = old.firstElementChild
      if (oldRow && dragActive.value) {
        oldRow.removeAttribute('data-chapter-sort-shifting')
        oldRow.removeAttribute('data-chapter-sort-source')
        oldRow.removeAttribute('data-chapter-sort-target')
        oldRow.style.removeProperty('--chapter-sort-shift')
      }
    }
    if (!el) elements.delete(key)
    else {
      elements.set(key, el)
      observer?.observe(el)
      if (mountSync && el.firstElementChild) mountSync(key, el.firstElementChild)
    }
  }

  function reveal(key, center = false) {
    const scroller = editor.value
    if (!windowed.value || !scroller || elements.has(key)) return
    const { offsets, indices } = layout.value
    const index = indices.get(key)
    if (index == null) return
    updateViewport()
    scroller.scrollTop = origin + offsets[index] - (center ? height.value / 2 : height.value / 3)
    updateScroll()
  }

  function getMountedRowEl(key) {
    return elements.get(key)?.firstElementChild || null
  }

  function forEachMountedRow(fn) {
    for (const [key, slot] of elements) {
      const el = slot?.firstElementChild
      if (el) fn(key, el)
    }
  }

  function setMountSync(fn) {
    mountSync = fn || null
  }

  /**
   * 拖拽开始时保持虚拟滚动开启，仅固定源节点并在视觉上临时折叠源节点的展开子孙，
   * 避免将成百上千行全量渲染进 DOM，同时让父节点拖动与章节栏一样按单行高度优雅让位。
   */
  function beginVirtualDrag(sourceEl) {
    const sourceId = sourceEl?.dataset?.loreSortRow
    if (!sourceId) return null
    const all = rows.value
    const sourceKey = 'm:' + sourceId
    const origFrom = all.findIndex(r => r.node.key === sourceKey)
    if (origFrom < 0) return null
    const sourceDepth = all[origFrom].depth
    let origEnd = origFrom + 1
    while (origEnd < all.length && all[origEnd].depth > sourceDepth) origEnd++
    const descendantCount = origEnd - origFrom - 1
    dragActive.value = true
    dragPinnedKey.value = sourceKey
    hiddenBranch.value = descendantCount > 0 ? { start: origFrom + 1, end: origEnd } : null
    return {
      descendantCount,
      ready: nextTick(() => {
        updateViewport()
      }),
      release() {
        mountSync = null
        hiddenBranch.value = null
        dragPinnedKey.value = null
        dragActive.value = false
        nextTick(updateViewport)
      }
    }
  }

  /**
   * 纯数学 O(N) 生成全量虚拟行几何表（不遍历 DOM 调用 getBoundingClientRect），
   * 仅采样源行 1 次来校准缩进步长与基准偏移。
   */
  function snapshotVirtualRows(list, listTop, sourceEl) {
    updateViewport()
    const listRows = activeRows.value
    const { offsets, indices } = layout.value
    if (!listRows.length) return { rows: [], indentStep: 22, baseGuideX: 12, baseBulletX: 24 }

    const sourceKey = sourceEl?.dataset?.node || (sourceEl?.dataset?.loreSortRow ? 'm:' + sourceEl.dataset.loreSortRow : null)
    const fromIdx = sourceKey ? (indices.get(sourceKey) ?? 0) : 0
    const sourceRow = listRows[fromIdx]
    const sourceDepth = sourceRow ? sourceRow.depth : 0
    const sourceRect = sourceEl.getBoundingClientRect()
    const sourceBulletEl = sourceEl.querySelector('.ob-bullet')
    const sourceBulletRect = sourceBulletEl ? sourceBulletEl.getBoundingClientRect() : sourceRect
    const sourceBulletCenter = sourceBulletRect.left + sourceBulletRect.width / 2

    // 校准虚拟偏移基准（与源行真实视口位置对齐至亚像素）
    const actualSourceTop = sourceRect.top - listTop + list.scrollTop
    const baseTop = actualSourceTop - (offsets[fromIdx] ?? 0)

    // 测算每层缩进步长（隐现皮肤固定 22px；若有已挂载不同层级行则实测校准）
    let indentStep = 22
    const sourceGuides = [...sourceEl.querySelectorAll('.ob-guide')]
    if (sourceGuides.length >= 2) {
      const g0 = sourceGuides[0].getBoundingClientRect().left
      const g1 = sourceGuides[1].getBoundingClientRect().left
      if (g1 - g0 > 4) indentStep = g1 - g0
    } else {
      for (const [k, slot] of elements) {
        const el = slot?.firstElementChild
        if (!el || el === sourceEl) continue
        const d = Number(el.dataset.depth)
        if (!Number.isFinite(d) || d === sourceDepth) continue
        const b = el.querySelector('.ob-bullet')?.getBoundingClientRect()
        if (b) {
          const step = (b.left + b.width / 2 - sourceBulletCenter) / (d - sourceDepth)
          if (step > 8 && step < 64) {
            indentStep = step
            break
          }
        }
      }
    }

    const baseBulletX = sourceBulletCenter - sourceDepth * indentStep
    const baseGuideX = sourceGuides.length
      ? sourceGuides[0].getBoundingClientRect().left
      : sourceRect.left + 12

    const rowLeft = sourceRect.left
    const out = new Array(listRows.length)
    for (let i = 0; i < listRows.length; i++) {
      const item = listRows[i]
      const key = item.node.key
      const depth = item.depth
      const rowTop = baseTop + offsets[i]
      const rowHeight = offsets[i + 1] - offsets[i]
      const guides = new Array(depth)
      for (let g = 0; g < depth; g++) guides[g] = baseGuideX + g * indentStep
      out[i] = {
        id: item.node.id,
        key,
        depth,
        top: rowTop,
        bottom: rowTop + rowHeight,
        height: rowHeight,
        left: rowLeft,
        bulletX: baseBulletX + depth * indentStep,
        guides,
        node: elements.get(key)?.firstElementChild || null,
        el: elements.get(key)?.firstElementChild || null,
        shift: 0,
        end: listRows.length
      }
    }
    const open = []
    for (let index = 0; index < out.length; index++) {
      const depth = out[index].depth
      while (open.length && out[open[open.length - 1]].depth >= depth) {
        out[open.pop()].end = index
      }
      open.push(index)
    }
    return { rows: out, indentStep, baseGuideX, baseBulletX }
  }

  onMounted(() => {
    observer = new ResizeObserver(measure)
    if (editor.value) observer.observe(editor.value)
    for (const el of elements.values()) observer.observe(el)
    updateViewport()
  })
  onBeforeUnmount(() => observer?.disconnect())

  return {
    entries,
    windowed,
    bind,
    reveal,
    updateScroll,
    updateViewport,
    beginVirtualDrag,
    expandForDrag: beginVirtualDrag,
    snapshotVirtualRows,
    getMountedRowEl,
    forEachMountedRow,
    setMountSync
  }
}
