<script setup>
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, useSlots } from 'vue'
import OIcon from '../OIcon.vue'
import { outlineCardLayout, outlineEventLayout } from './card-layout.js'

const props = defineProps({
  kind: String,
  shape: String,
  rect: { type: Object, required: true },
  title: String,
  summary: String,
  status: String,
  statusColor: String,
  subtype: String,
  association: String,
  relationCount: Number,
  needsTarget: Boolean
})
const emit = defineEmits(['choose-target'])
const slots = useSlots()
const kindLabel = { cite: '引用', volume: '卷' }
const kindIcon = { cite: 'link', volume: 'rows' }
const card = ref(null)
const eventTitle = ref(null)
const size = shallowRef(null)
const titleLines = ref(null)
let observer
onMounted(() => {
  const frame = card.value.parentElement
  const measure = () => {
    const w = frame.clientWidth
    const h = frame.clientHeight
    if (w && h && (w !== size.value?.w || h !== size.value?.h)) size.value = { w, h }
  }
  measure()
  // The parent can be transitioning to its new size. Measure in canvas pixels,
  // so the same layout works during resize and at every canvas zoom level.
  observer = new ResizeObserver((entries) => {
    for (const { target, contentRect } of entries) {
      if (target === frame) measure()
      else if (contentRect.height) {
        const lineHeight = parseFloat(getComputedStyle(target).lineHeight)
        titleLines.value = Math.round(contentRect.height / lineHeight)
      }
    }
  })
  observer.observe(frame, { box: 'border-box' })
  if (eventTitle.value) observer.observe(eventTitle.value)
})
onBeforeUnmount(() => observer?.disconnect())
const relations = computed(() => props.relationCount ? `${props.relationCount} 条关系` : '')
const layout = computed(() => {
  const dimensions = size.value || props.rect
  if (props.kind !== 'event') return outlineCardLayout(dimensions)
  return outlineEventLayout(props.shape, dimensions, {
    status: props.status,
    association: props.association,
    relations: relations.value,
    action: Boolean(slots.actions),
    titleLines: titleLines.value
  })
})
const style = computed(() => ({
  '--card-title-font': `${layout.value.font}px`,
  '--card-title-line': `${layout.value.line}px`,
  '--card-title-lines': layout.value.lines,
  '--card-summary-lines': layout.value.summaryLines
}))
const bandStyle = (band) => ({
  top: `${band.y}px`,
  left: `${band.left}px`,
  right: `${band.right}px`
})
</script>

<template>
  <div ref="card" class="oc-fit-card" :class="['oc-fit-' + kind, { 'oc-fit-centered': layout.centered }]" :style="style">
    <button v-if="needsTarget" class="oc-fit-choose" type="button" title="选择引用目标" @mousedown.stop @click.stop="emit('choose-target')">
      选择目标
    </button>
    <template v-else-if="kind === 'event'">
      <div v-if="layout.top" class="oc-event-corners oc-event-top" :style="bandStyle(layout.top)">
        <div v-if="layout.top.showLeft" class="oc-event-type">
          <OIcon name="shape" :size="12" aria-hidden="true" />
          <span :title="subtype || '事件'">事件<template v-if="subtype"> · {{ subtype }}</template></span>
        </div>
        <div class="oc-event-top-right">
          <span v-if="layout.top.showRight" class="oc-event-status" :title="status">
            <i :style="{ backgroundColor: statusColor }" />{{ status }}
          </span>
          <slot v-if="layout.top.more" name="actions" />
        </div>
      </div>
      <div class="oc-event-title" :style="{ ...bandStyle(layout.title), height: layout.title.height + 'px' }">
        <div ref="eventTitle" class="oc-fit-title" :title="title">{{ title }}</div>
      </div>
      <div v-if="summary && layout.summary" class="oc-fit-summary oc-event-summary"
        :style="{ ...bandStyle(layout.summary), '--card-summary-lines': layout.summary.lines }" :title="summary">{{ summary }}</div>
      <div v-if="layout.bottom" class="oc-event-corners oc-event-bottom" :style="bandStyle(layout.bottom)">
        <span v-if="layout.bottom.showLeft" class="oc-event-association" :title="association">{{ association }}</span>
        <span v-if="layout.bottom.showRight" class="oc-event-relations">{{ relations }}</span>
      </div>
    </template>
    <template v-else>
      <div v-if="layout.meta" class="oc-fit-meta">
        <OIcon :name="kindIcon[kind]" :size="12" aria-hidden="true" />
        <span>{{ kindLabel[kind] }}<template v-if="subtype"> · {{ subtype }}</template></span>
        <slot name="actions" />
      </div>
      <div class="oc-fit-title" :title="title">{{ title }}</div>
      <div v-if="summary && layout.summaryLines" class="oc-fit-summary" :title="summary">{{ summary }}</div>
    </template>
  </div>
</template>

<style scoped>
.oc-fit-card {
  position: absolute;
  inset: min(12px, 11%) min(14px, 8%);
  z-index: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  min-width: 0;
  gap: 2px;
  overflow: hidden;
  color: var(--oc-fit-ink, #293c36);
  text-decoration: none;
}
.oc-fit-volume { --oc-fit-ink: #f7f2de; --oc-fit-muted: #d5e2d5; }
.oc-fit-event { inset: 0; display: block; pointer-events: none; }
.oc-fit-centered { text-align: center; }
.oc-fit-title {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: var(--card-title-lines);
  flex: none;
  overflow: hidden;
  overflow-wrap: anywhere;
  font: 500 var(--card-title-font)/var(--card-title-line) var(--oc-serif, "Noto Serif SC", serif);
}
.oc-fit-meta, .oc-event-corners, .oc-event-type, .oc-event-top-right {
  display: flex;
  align-items: center;
  gap: 4px;
}
.oc-fit-meta, .oc-event-corners, .oc-fit-summary {
  flex: none;
  min-width: 0;
  color: var(--oc-fit-muted, #53665f);
  font: 400 10px/14px "Microsoft YaHei", system-ui, sans-serif;
}
.oc-fit-meta > span { flex: 1; }
.oc-fit-meta > svg, .oc-event-type > svg { flex: none; }
.oc-fit-meta > span, .oc-event-type > span, .oc-event-association, .oc-fit-summary {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.oc-fit-summary {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: var(--card-summary-lines);
  white-space: pre-line;
  overflow-wrap: anywhere;
}
.oc-event-corners, .oc-event-title, .oc-event-summary { position: absolute; }
.oc-event-corners { height: 14px; gap: 8px; text-align: start; }
.oc-event-title { display: flex; align-items: center; }
.oc-event-title > .oc-fit-title { width: 100%; pointer-events: auto; }
.oc-event-type, .oc-event-association { min-width: 0; }
.oc-event-top-right, .oc-event-relations { flex: none; margin-inline-start: auto; }
.oc-event-top-right { gap: 8px; }
.oc-event-status, .oc-event-relations { white-space: nowrap; }
.oc-fit-meta :slotted(.gv-more), .oc-event-top-right :slotted(.gv-more) {
  flex: none;
  border: 0;
  border-radius: 4px;
  padding: 0 2px;
  background: transparent;
  color: inherit;
  line-height: 1;
  cursor: pointer;
}
.oc-event-top-right :slotted(.gv-more) {
  width: 18px;
  height: 14px;
  pointer-events: auto;
}
.oc-event-status i {
  display: inline-block;
  width: 5px;
  height: 5px;
  margin-inline-end: 4px;
  border-radius: 50%;
  vertical-align: 1px;
}
.oc-fit-choose {
  align-self: center;
  max-width: 100%;
  padding: 2px 6px;
  border: 1px solid currentColor;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  font: 500 12px/16px "Microsoft YaHei", sans-serif;
  white-space: nowrap;
  cursor: pointer;
}
</style>

<style>
.oc-mini .oc-mini-content.oc-mini-fitted {
  box-sizing: border-box;
  padding: 0;
}
.oc-mini .oc-mini-fitted .oc-mini-actions {
  position: absolute;
  right: 0;
  bottom: calc(100% + 2px);
  padding: 0;
  display: none;
}
.oc-mini:is(:hover, :focus-within, .sel) .oc-mini-fitted .oc-mini-actions {
  display: flex;
}
.oc-mini:has(.oc-mini-fitted):is(:hover, :focus-within, .sel) { overflow: visible; }
.oc-mini-volume > .oc-paper-volume { opacity: 1; }
html body[data-skin='dsh'] .om-wrap .oc-mini.oc-mini-volume > .oc-paper-volume {
  background-blend-mode: normal;
  background-color: #294c48;
}
.oc-mini-event:is(.sh-ellipse, .sh-diamond, .sh-para):has(.oc-mini-fitted) {
  background: transparent !important;
  border-color: transparent !important;
}
</style>
