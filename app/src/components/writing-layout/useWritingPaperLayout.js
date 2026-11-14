import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'

export function useWritingPaperLayout(ui, enabled) {
  const editorWrap = ref(null)
  const paperFrame = ref(null)
  const limits = shallowRef({ w: 0, h: 0 })
  const actual = shallowRef({ w: 0, h: 0 })
  const preview = shallowRef(null)
  const minimum = computed(() => ({ w: Math.min(320, Math.max(0, limits.value.w - 24)), h: Math.min(160, limits.value.h) }))
  const saved = computed(() => ui.latentWritingLayout.paper)
  const width = computed(() => preview.value?.axis === 'x' ? preview.value.value : saved.value?.w)
  const height = computed(() => preview.value?.axis === 'y' ? preview.value.value : saved.value?.h)
  const wrapStyle = computed(() => enabled.value && width.value ? {
    '--ls-page-w': 'min(' + width.value + 'px, calc(100% - 24px))'
  } : null)
  const frameStyle = computed(() => enabled.value && height.value ? { '--writing-paper-height': height.value + 'px' } : null)
  let start
  let observer

  function measure() {
    if (!editorWrap.value || !paperFrame.value) return
    const frame = paperFrame.value.getBoundingClientRect()
    const wrap = editorWrap.value.getBoundingClientRect()
    const next = { w: editorWrap.value.clientWidth, h: Math.max(0, Math.floor(wrap.bottom - frame.top - 12)) }
    if (next.w !== limits.value.w || next.h !== limits.value.h) cancel()
    limits.value = next
    actual.value = { w: Math.round(frame.width), h: Math.round(frame.height) }
  }
  function begin(axis) {
    measure()
    start = { axis, value: frameSize(axis) }
  }
  function frameSize(axis) { return actual.value[axis === 'x' ? 'w' : 'h'] }
  function move(delta) {
    if (!start) return
    const { axis, value } = start
    const dimension = axis === 'x' ? 'w' : 'h'
    const max = dimension === 'w' ? Math.max(0, limits.value.w - 24) : limits.value.h
    const amount = axis === 'x' ? delta.x * 2 : delta.y
    preview.value = { axis, value: Math.round(Math.min(max, Math.max(Math.min(minimum.value[dimension], max), value + amount))) }
  }
  function cancel() {
    start = null
    preview.value = null
  }
  async function end() {
    if (!preview.value || !start || preview.value.value === start.value) { cancel(); return }
    const { axis } = preview.value
    const dimension = axis === 'x' ? 'w' : 'h'
    const pending = preview.value
    start = null
    await ui.saveLatentWritingLayout('paper', { [dimension]: pending.value })
    if (preview.value === pending) preview.value = null
  }
  function nudge(axis, delta) {
    begin(axis)
    move(axis === 'x' ? { ...delta, x: delta.x / 2 } : delta)
    end()
  }
  function reset(axis) {
    cancel()
    ui.saveLatentWritingLayout('paper', { [axis === 'x' ? 'w' : 'h']: undefined })
  }

  watch([editorWrap, paperFrame, enabled], () => {
    observer?.disconnect()
    cancel()
    if (!enabled.value || !editorWrap.value || !paperFrame.value) return
    observer = new ResizeObserver(measure)
    observer.observe(editorWrap.value)
    observer.observe(paperFrame.value)
    measure()
  }, { flush: 'post' })
  onBeforeUnmount(() => observer?.disconnect())
  return { editorWrap, paperFrame, actual, minimum, limits, wrapStyle, frameStyle, begin, move, end, cancel, nudge, reset }
}
