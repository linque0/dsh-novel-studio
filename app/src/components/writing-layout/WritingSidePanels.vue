<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { useUiStore } from '../../stores/ui'
import { useWorkStore } from '../../stores/work'
import { arrangeWritingPanels, placeWritingRect, resizeWritingPanel, writingPanels } from './layout.mjs'
import WritingLayoutHandle from './WritingLayoutHandle.vue'
import './writing-layout.css'

const props = defineProps({ directory: Boolean, notes: Boolean, directoryId: String, notesId: String })
const ui = useUiStore()
const work = useWorkStore()
const chapterCount = computed(() => work.liveChapters.length)
const layer = ref(null)
const size = shallowRef({ w: 0, h: 0 })
const priority = ref('')
const preview = shallowRef(null)
const visible = computed(() => ({
  directory: props.directory ? ui.sidePanelOpen : null,
  notes: props.notes ? ui.rightPanelOpen : null
}))
const arranged = computed(() => arrangeWritingPanels(size.value, ui.latentWritingLayout, visible.value, priority.value, ui.sideWidth))
const panels = computed(() => preview.value ? { ...arranged.value, [preview.value.key]: preview.value } : arranged.value)
const otherKey = key => key === 'directory' ? 'notes' : 'directory'
const pref = (key, open) => open ? key : key + 'Capsule'
const id = key => key === 'directory' ? props.directoryId : props.notesId
const style = rect => rect && { left: rect.x + 'px', top: rect.y + 'px', width: rect.w + 'px', height: rect.h + 'px' }
const axes = ['move', 'x', 'y']
const dimension = axis => axis === 'x' ? 'w' : 'h'
const name = (key, axis) => axis === 'move' ? '移动' + writingPanels[key].label
  : '调整' + writingPanels[key].label + (axis === 'x' ? '宽度' : '高度')
const capsuleLabel = key => key === 'directory' ? `展开章节栏，共 ${chapterCount.value} 章，可拖动位置`
  : '展开批注栏，可拖动位置'
const round = value => Math.round(value)
let start
let observer

function measure() {
  const { width, height } = layer.value.getBoundingClientRect()
  const w = Math.floor(width), h = Math.floor(height)
  if (w === size.value.w && h === size.value.h) return
  cancel()
  size.value = { w, h }
}
function begin(key, axis) {
  measure()
  if (!arranged.value[key]) return
  start = { rect: arranged.value[key], other: arranged.value[otherKey(key)], axis }
}
function move(delta) {
  if (!start) return
  const { rect, other, axis } = start
  if (axis === 'move') {
    const next = placeWritingRect({ ...rect, x: rect.x + delta.x, y: rect.y + delta.y }, other, size.value)
    if (next) preview.value = { ...rect, ...next }
  } else preview.value = resizeWritingPanel(rect, other, size.value, dimension(axis), delta[axis])
}
function cancel() {
  start = null
  preview.value = null
}
function end() {
  const rect = preview.value
  if (rect && start) {
    const { axis, rect: initial } = start
    const position = (offset, span, available) => available > span ? offset / (available - span) : undefined
    const patch = {}
    if (axis === 'move' || axis === 'x') patch.x = position(rect.x, rect.w, size.value.w)
    if (axis === 'move' || axis === 'y') patch.y = position(rect.y, rect.h, size.value.h)
    if (axis !== 'move') patch[dimension(axis)] = round(rect[dimension(axis)])
    if (rect.x !== initial.x || rect.y !== initial.y || rect.w !== initial.w || rect.h !== initial.h) {
      const pending = preview.value
      start = null
      ui.saveLatentWritingLayout(pref(rect.key, rect.open), patch).finally(() => {
        if (preview.value === pending) preview.value = null
      })
      return
    }
  }
  cancel()
}
function nudge(key, axis, delta) {
  begin(key, axis)
  move(delta)
  end()
}
function reset(key, axis, open) {
  const patch = axis === 'move' ? { x: undefined, y: undefined }
    : axis === 'x' ? { w: undefined, x: undefined } : { h: undefined, y: undefined }
  ui.saveLatentWritingLayout(pref(key, open), patch)
}
async function open(key) {
  priority.value = key
  const setting = key === 'directory' ? 'sidePanelOpen' : 'rightPanelOpen'
  if (!ui[setting]) await ui.setPref(setting, true)
  await nextTick()
  layer.value?.querySelector('#' + id(key) + ' .side-fold, #' + id(key) + ' .rp-fold')?.focus({ preventScroll: true })
}

watch(visible, (next, previous) => {
  if (next.directory && previous.directory === false) priority.value = 'directory'
  if (next.notes && previous.notes === false) priority.value = 'notes'
  if (next.directory !== previous.directory || next.notes !== previous.notes) cancel()
})
onMounted(() => {
  observer = new ResizeObserver(measure)
  observer.observe(layer.value)
  window.addEventListener('resize', measure)
  measure()
})
onBeforeUnmount(() => {
  observer?.disconnect()
  window.removeEventListener('resize', measure)
})
</script>

<template>
  <div ref="layer" class="writing-float-layer">
    <template v-for="(meta, key) in writingPanels" :key="key">
      <div v-if="panels[key]?.open" :id="id(key)" class="writing-float-panel" :style="style(panels[key])">
        <div class="writing-float-chrome">
          <WritingLayoutHandle v-for="axis in axes" :key="axis" :axis="axis" :label="name(key, axis)"
            :controls="id(key)" :value="axis === 'move' ? undefined : round(panels[key][dimension(axis)])"
            :min="axis === 'move' ? undefined : Math.min(panels[key][dimension(axis)], axis === 'x' ? meta.minW : meta.minH)"
            :max="axis === 'move' ? undefined : size[dimension(axis)]"
            @start="begin(key, axis)" @move="move" @end="end" @cancel="cancel"
            @nudge="nudge(key, axis, $event)" @reset="reset(key, axis, true)" />
        </div>
        <slot :name="key" />
      </div>
      <WritingLayoutHandle v-else-if="panels[key]" axis="move" capsule class="writing-float-capsule"
        :style="style(panels[key])" :controls="id(key)" :label="capsuleLabel(key)"
        @start="begin(key, 'move')" @move="move" @end="end" @cancel="cancel"
        @nudge="nudge(key, 'move', $event)" @reset="reset(key, 'move', false)" @activate="open(key)">
        <span class="writing-capsule-text">{{ meta.capsule }}</span>
        <span v-if="key === 'directory'" class="writing-capsule-count">{{ chapterCount }}</span>
      </WritingLayoutHandle>
    </template>
  </div>
</template>
