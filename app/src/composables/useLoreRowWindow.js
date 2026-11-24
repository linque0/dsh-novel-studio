import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { loreRowAtOffset, loreViewportIndices } from '../services/lore-core.js'

export function useLoreRowWindow(editor, surface, rows, pinnedKeys) {
  const sizes = shallowRef(new Map())
  const elements = new Map()
  const top = ref(0)
  const height = ref(600)
  const expanded = ref(false)
  const windowed = computed(() => rows.value.length > 80 && !expanded.value)
  let origin = 0
  let width = 0
  let observer

  const layout = computed(() => {
    const offsets = [0]
    const keys = []
    const indices = new Map()
    for (const [index, row] of rows.value.entries()) {
      const key = row.node.key
      const estimate = row.depth === 0 ? 54 : 39
      keys.push(key)
      indices.set(key, index)
      offsets.push(offsets[index] + (sizes.value.get(key) ?? estimate))
    }
    return { offsets, keys, indices }
  })

  const entries = computed(() => {
    const all = rows.value
    if (!windowed.value) return all
    const { offsets, indices } = layout.value
    const visible = loreViewportIndices(offsets, top.value, height.value, 320, pinnedKeys.value.map(key => indices.get(key) ?? -1))
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
    if (!windowed.value || !scroller?.clientHeight || top.value === 0) return
    const oldIndex = loreRowAtOffset(previous.offsets, top.value)
    const newIndex = next.indices.get(previous.keys[oldIndex])
    if (newIndex == null) return
    const shift = next.offsets[newIndex] - previous.offsets[oldIndex]
    if (!shift) return
    const scroll = scroller.scrollTop
    nextTick(() => {
      if (!windowed.value || editor.value !== scroller || !scroller.clientHeight) return
      const clamped = Math.min(scroll, scroller.scrollHeight - scroller.clientHeight)
      if (Math.abs(scroller.scrollTop - clamped) > 1) return
      scroller.scrollTop = scroll + shift
      updateScroll()
    })
  })

  function bind(key, el) {
    const old = elements.get(key)
    if (old === el) return
    if (old) observer?.unobserve(old)
    if (!el) elements.delete(key)
    else {
      elements.set(key, el)
      observer?.observe(el)
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

  // Sorting measures the full branch and allows edge autoscroll across it.
  function expandForDrag(source) {
    if (!windowed.value) return
    const scroller = editor.value
    const sourceTop = source.getBoundingClientRect().top
    expanded.value = true
    return {
      ready: nextTick(() => {
        if (!expanded.value || !source.isConnected) return
        scroller.scrollTop += source.getBoundingClientRect().top - sourceTop
      }),
      release() {
        updateViewport()
        expanded.value = false
      }
    }
  }

  onMounted(() => {
    observer = new ResizeObserver(measure)
    if (editor.value) observer.observe(editor.value)
    for (const el of elements.values()) observer.observe(el)
    updateViewport()
  })
  onBeforeUnmount(() => observer?.disconnect())

  return { entries, windowed, bind, reveal, updateScroll, updateViewport, expandForDrag }
}
