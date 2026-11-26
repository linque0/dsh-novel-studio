<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, useSlots, watch } from 'vue'
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
  needsTarget: Boolean,
  tags: { type: Array, default: () => [] },
  taggable: Boolean,
  editing: Boolean,
  editTitle: { type: String, default: '' },
  editBody: { type: String, default: '' },
  showEditTitle: Boolean,
  allowAddTitle: Boolean,
  editFocus: { type: String, default: 'body' }
})
const emit = defineEmits([
  'choose-target',
  'open-tags',
  'update:editTitle',
  'update:editBody',
  'add-edit-title',
  'commit-edit',
  'cancel-edit',
  'edit-focusout'
])
const slots = useSlots()
const kindLabel = { cite: '引用', volume: '卷' }
const kindIcon = { cite: 'link', volume: 'rows' }
const emptyLabel = { event: '（空事件）', note: '（空便签）', cite: '（空引用）', volume: '（空卷）' }
const card = ref(null)
const eventTitle = ref(null)
const titleInputEl = ref(null)
const bodyInputEl = ref(null)
const size = shallowRef(null)
const titleLines = ref(null)
let observer
onMounted(() => {
  const frame = card.value.parentElement
  const measure = () => {
    const w = frame.offsetWidth
    const h = frame.offsetHeight
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
watch(() => [props.rect?.w, props.rect?.h], ([w, h]) => {
  if (w && h && (w !== size.value?.w || h !== size.value?.h)) size.value = { w, h }
})
const relations = computed(() => props.relationCount ? `${props.relationCount} 条关系` : '')
const activeTitle = computed(() => (props.editing ? (props.editTitle ?? '') : (props.title ?? '')))
const activeSummary = computed(() => (props.editing ? (props.editBody ?? '') : (props.summary ?? '')))
const hasTitle = computed(() => (props.editing ? Boolean(props.showEditTitle || String(activeTitle.value).trim()) : Boolean(props.title && props.title.trim())))
const hasSummary = computed(() => (props.editing ? true : Boolean(props.summary && props.summary.trim())))
const normalizedTags = computed(() => (Array.isArray(props.tags) ? props.tags.filter((t) => t && t.name) : []))
const visibleTags = computed(() => normalizedTags.value.slice(0, 2))
const extraTagCount = computed(() => Math.max(0, normalizedTags.value.length - visibleTags.value.length))
watch(eventTitle, (el, prev) => {
  if (!observer) return
  if (prev) observer.unobserve(prev)
  if (el) observer.observe(el)
  else titleLines.value = null
})
function focusInputEl(el) {
  if (!el) return
  el.focus()
  const len = el.value?.length ?? 0
  try { el.setSelectionRange(len, len) } catch {}
}
watch(() => props.editing, (on) => {
  if (!on) return
  nextTick(() => {
    if (props.editFocus === 'title' && props.showEditTitle && titleInputEl.value) focusInputEl(titleInputEl.value)
    else focusInputEl(bodyInputEl.value || titleInputEl.value)
  })
}, { immediate: true })
watch(() => props.showEditTitle, (shown, prev) => {
  if (props.editing && shown && !prev) nextTick(() => focusInputEl(titleInputEl.value))
})
function focusBody() {
  focusInputEl(bodyInputEl.value)
}
function onEditWheel(e) {
  const el = e.currentTarget
  if (el && el.scrollHeight > el.clientHeight + 1) e.stopPropagation()
}
function tagPillStyle(t) {
  const c = t?.color || '#5d6b66'
  return {
    '--tag-color': c,
    color: c,
    borderColor: `color-mix(in srgb, ${c} 38%, transparent)`,
    backgroundColor: `color-mix(in srgb, ${c} 12%, transparent)`
  }
}
const layout = computed(() => {
  const dimensions = size.value || props.rect
  if (props.kind !== 'event') {
    return outlineCardLayout(dimensions, {
      kind: props.kind,
      title: activeTitle.value,
      summary: activeSummary.value,
      hasTitle: hasTitle.value,
      hasSummary: hasSummary.value
    })
  }
  const topRightOpts = props.taggable
    ? {
        topRightWidth: normalizedTags.value.length ? 46 : 38,
        preferTopRight: false
      }
    : {}
  return outlineEventLayout(props.shape, dimensions, {
    status: props.taggable ? '' : props.status,
    association: props.association,
    relations: relations.value,
    action: Boolean(slots.actions),
    hasSummary: hasSummary.value,
    hasTitle: hasTitle.value,
    title: activeTitle.value,
    summary: activeSummary.value,
    ...topRightOpts
  })
})
const editZoneStyle = computed(() => {
  const dim = size.value || props.rect || { w: 224, h: 154 }
  const l = layout.value
  const topY = l.top ? Math.round(l.top.y + (l.metaLine || 14) + 6) : Math.max(8, Math.round(dim.h * 0.12))
  const botY = l.bottom ? Math.round(l.bottom.y - 6) : Math.max(topY + 28, Math.round(dim.h - Math.max(8, dim.h * 0.12)))
  const band = l.summary || l.title || l.empty
  const padX = props.shape === 'diamond' ? Math.round(dim.w * 0.18) : props.shape === 'para' ? Math.round(dim.w * 0.12) : 14
  const left = band?.left ?? padX
  const right = band?.right ?? padX
  return {
    top: `${topY}px`,
    bottom: `${Math.max(6, Math.round(dim.h - botY))}px`,
    left: `${left}px`,
    right: `${right}px`
  }
})
const style = computed(() => {
  const l = layout.value
  return {
    '--card-title-font': `${l.font}px`,
    '--card-title-line': `${l.line}px`,
    '--card-title-lines': l.lines,
    '--card-meta-font': `${l.metaFont}px`,
    '--card-meta-line': `${l.metaLine}px`,
    '--card-summary-font': `${l.summaryFont}px`,
    '--card-summary-line': `${l.summaryLine}px`,
    '--card-summary-lines': l.summaryLines,
    '--card-dot-size': `${l.dotSize || 5}px`,
    ...(props.kind !== 'event'
      ? {
          '--card-pad-y': `${l.padY}px`,
          '--card-pad-x': `${l.padX}px`,
          '--card-gap': `${l.gap}px`,
          '--card-justify': l.justify || (hasSummary.value && l.summaryLines > 0 ? 'flex-start' : 'center')
        }
      : {})
  }
})
const bandStyle = (band) => ({
  top: `${band.y}px`,
  left: `${band.left}px`,
  right: `${band.right}px`
})
</script>

<template>
  <div ref="card" class="oc-fit-card" :class="['oc-fit-' + kind, { 'oc-fit-centered': layout.centered, 'oc-fit-no-title': !hasTitle, 'oc-fit-editing': editing }]" :style="style">
    <button v-if="needsTarget && !editing" class="oc-fit-choose" type="button" title="选择引用目标" @mousedown.stop @dblclick.stop @click.stop="emit('choose-target')">
      选择目标
    </button>
    <template v-else-if="kind === 'event'">
      <div v-if="layout.top" class="oc-event-corners oc-event-top" :style="bandStyle(layout.top)">
        <div v-if="layout.top.showLeft" class="oc-event-type">
          <OIcon name="shape" :size="layout.iconSize || 12" aria-hidden="true" />
          <span :title="subtype || '事件'">事件<template v-if="subtype"> · {{ subtype }}</template></span>
        </div>
        <div class="oc-event-top-right">
          <template v-if="taggable && layout.top.showRight">
            <button
              v-if="visibleTags.length"
              type="button"
              class="oc-card-tags"
              :title="normalizedTags.map((t) => t.name).join(' · ') + '（点击编辑标签）'"
              @mousedown.stop
              @dblclick.stop
              @click.stop="emit('open-tags', $event)"
            >
              <span v-for="t in visibleTags" :key="t.name" class="oc-card-tag" :style="tagPillStyle(t)">{{ t.name }}</span>
              <span v-if="extraTagCount" class="oc-card-tag-more">+{{ extraTagCount }}</span>
            </button>
            <button
              v-else
              type="button"
              class="oc-card-tag-add"
              title="添加自定义标签"
              @mousedown.stop
              @dblclick.stop
              @click.stop="emit('open-tags', $event)"
            >+ 标签</button>
          </template>
          <span v-else-if="!taggable && layout.top.showRight" class="oc-event-status" :title="status">
            <i :style="{ backgroundColor: statusColor }" />{{ status }}
          </span>
          <slot v-if="layout.top.more" name="actions" />
        </div>
      </div>
      <div
        v-if="editing"
        class="oc-event-edit-zone"
        :style="editZoneStyle"
        @mousedown.stop
        @dblclick.stop
        @focusout="emit('edit-focusout', $event)"
      >
        <input
          v-if="showEditTitle"
          ref="titleInputEl"
          class="oc-inplace-title"
          type="text"
          :value="editTitle"
          placeholder="标题（留空隐藏）"
          spellcheck="false"
          @input="emit('update:editTitle', $event.target.value)"
          @keydown.enter.prevent="focusBody"
          @keydown.ctrl.enter.prevent="emit('commit-edit')"
          @keydown.meta.enter.prevent="emit('commit-edit')"
          @keydown.esc.stop.prevent="emit('cancel-edit')"
        />
        <button
          v-else-if="allowAddTitle"
          type="button"
          class="oc-inplace-add-title"
          tabindex="-1"
          title="为此卡片添加标题"
          @mousedown.prevent
          @click.stop="emit('add-edit-title')"
        >+ 添加标题</button>
        <textarea
          ref="bodyInputEl"
          class="oc-inplace-body"
          :class="{ 'is-body-only': !showEditTitle }"
          :value="editBody"
          placeholder="输入事件内容…"
          spellcheck="false"
          @input="emit('update:editBody', $event.target.value)"
          @wheel="onEditWheel"
          @keydown.ctrl.enter.prevent="emit('commit-edit')"
          @keydown.meta.enter.prevent="emit('commit-edit')"
          @keydown.esc.stop.prevent="emit('cancel-edit')"
        ></textarea>
      </div>
      <template v-else>
        <div v-if="hasTitle && layout.title" class="oc-event-title" :style="{ ...bandStyle(layout.title), height: layout.title.height + 'px' }">
          <div ref="eventTitle" class="oc-fit-title" :title="title">{{ title }}</div>
        </div>
        <div v-if="summary && layout.summary" class="oc-fit-summary oc-event-summary"
          :style="{ ...bandStyle(layout.summary), '--card-summary-lines': layout.summary.lines }" :title="summary">{{ summary }}</div>
        <div v-else-if="!hasTitle && !hasSummary && layout.empty" class="oc-fit-empty oc-event-empty"
          :style="{ ...bandStyle(layout.empty), height: layout.empty.height + 'px' }">{{ emptyLabel[kind] || '（空模块）' }}</div>
      </template>
      <div v-if="layout.bottom" class="oc-event-corners oc-event-bottom" :style="bandStyle(layout.bottom)">
        <span v-if="layout.bottom.showLeft" class="oc-event-association" :title="association">{{ association }}</span>
        <span v-if="layout.bottom.showRight" class="oc-event-relations">{{ relations }}</span>
      </div>
    </template>
    <template v-else>
      <div v-if="layout.meta" class="oc-fit-meta">
        <OIcon :name="kindIcon[kind]" :size="layout.iconSize || 12" aria-hidden="true" />
        <span>{{ kindLabel[kind] }}<template v-if="subtype"> · {{ subtype }}</template></span>
        <slot name="actions" />
      </div>
      <div
        v-if="editing"
        class="oc-fit-main oc-fit-edit-main"
        @mousedown.stop
        @dblclick.stop
        @focusout="emit('edit-focusout', $event)"
      >
        <input
          v-if="showEditTitle"
          ref="titleInputEl"
          class="oc-inplace-title"
          type="text"
          :value="editTitle"
          placeholder="标题（可选）"
          spellcheck="false"
          @input="emit('update:editTitle', $event.target.value)"
          @keydown.enter.prevent="focusBody"
          @keydown.ctrl.enter.prevent="emit('commit-edit')"
          @keydown.meta.enter.prevent="emit('commit-edit')"
          @keydown.esc.stop.prevent="emit('cancel-edit')"
        />
        <button
          v-else-if="allowAddTitle"
          type="button"
          class="oc-inplace-add-title"
          tabindex="-1"
          title="为此卡片添加标题"
          @mousedown.prevent
          @click.stop="emit('add-edit-title')"
        >+ 添加标题</button>
        <textarea
          ref="bodyInputEl"
          class="oc-inplace-body"
          :class="{ 'is-body-only': !showEditTitle }"
          :value="editBody"
          placeholder="输入内容…"
          spellcheck="false"
          @input="emit('update:editBody', $event.target.value)"
          @wheel="onEditWheel"
          @keydown.ctrl.enter.prevent="emit('commit-edit')"
          @keydown.meta.enter.prevent="emit('commit-edit')"
          @keydown.esc.stop.prevent="emit('cancel-edit')"
        ></textarea>
      </div>
      <div v-else class="oc-fit-main">
        <div v-if="hasTitle" class="oc-fit-title" :title="title">{{ title }}</div>
        <div v-if="summary && layout.summaryLines" class="oc-fit-summary" :title="summary">{{ summary }}</div>
        <div v-else-if="!hasTitle && !hasSummary" class="oc-fit-empty">{{ emptyLabel[kind] || '（空模块）' }}</div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.oc-fit-card {
  position: absolute;
  inset: var(--card-pad-y, min(12px, 11%)) var(--card-pad-x, min(14px, 8%));
  z-index: 1;
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
  min-width: 0;
  gap: var(--card-gap, 4px);
  overflow: hidden;
  color: var(--oc-fit-ink, #293c36);
  text-decoration: none;
}
.oc-fit-main {
  flex: 1;
  min-height: 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: var(--card-justify, center);
  gap: var(--card-gap, 4px);
  overflow: hidden;
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
.oc-fit-meta, .oc-event-corners {
  flex: none;
  min-width: 0;
  color: var(--oc-fit-muted, #53665f);
  font: 400 var(--card-meta-font, 10.5px)/var(--card-meta-line, 14px) "Microsoft YaHei", system-ui, sans-serif;
}
.oc-fit-summary {
  flex: none;
  min-width: 0;
  color: var(--oc-fit-muted, #53665f);
  font: 400 var(--card-summary-font, 12.5px)/var(--card-summary-line, 18.5px) "Microsoft YaHei", system-ui, sans-serif;
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
.oc-event-corners, .oc-event-title, .oc-event-summary, .oc-event-empty { position: absolute; }
.oc-event-corners { height: var(--card-meta-line, 14px); gap: 6px; text-align: start; }
.oc-event-title { display: flex; align-items: center; }
.oc-event-title > .oc-fit-title { width: 100%; pointer-events: auto; }
.oc-fit-no-title .oc-fit-summary {
  color: var(--oc-fit-ink, #293c36);
}
.oc-fit-empty {
  color: color-mix(in srgb, var(--oc-fit-muted, #53665f) 70%, transparent);
  font: 400 var(--card-summary-font, 14px)/var(--card-summary-line, 20px) "Microsoft YaHei", system-ui, sans-serif;
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.oc-event-empty {
  display: flex;
  align-items: center;
  justify-content: center;
}
.oc-event-type, .oc-event-association { min-width: 0; }
.oc-event-top-right, .oc-event-relations { flex: none; margin-inline-start: auto; }
.oc-event-top-right { gap: 4px; max-width: 68%; min-width: 0; }
.oc-event-status, .oc-event-relations { white-space: nowrap; }
.oc-card-tags {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  min-width: 0;
  max-width: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
  pointer-events: auto;
}
.oc-card-tag {
  display: inline-flex;
  align-items: center;
  max-width: 68px;
  padding: 0 5px;
  height: calc(var(--card-meta-line, 14px) + 1px);
  border: 1px solid color-mix(in srgb, var(--tag-color, #5d6b66) 38%, transparent);
  border-radius: 999px;
  font-size: calc(var(--card-meta-font, 10.5px) * 0.9);
  font-weight: 500;
  line-height: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.oc-card-tag-more {
  flex: none;
  padding: 0 4px;
  height: calc(var(--card-meta-line, 14px) + 1px);
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  background: rgb(41 60 54 / .09);
  color: var(--oc-fit-muted, #53665f);
  font-size: calc(var(--card-meta-font, 10.5px) * 0.85);
  font-weight: 600;
  line-height: 1;
}
.oc-card-tag-add {
  display: inline-flex;
  align-items: center;
  height: calc(var(--card-meta-line, 14px) + 1px);
  padding: 0 6px;
  border: 1px dashed rgb(83 102 95 / .36);
  border-radius: 999px;
  background: rgb(255 255 255 / .35);
  color: var(--oc-fit-muted, #53665f);
  font-size: calc(var(--card-meta-font, 10.5px) * 0.88);
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
  pointer-events: auto;
  opacity: 0;
  transition: opacity .15s ease, background .15s ease, border-color .15s ease;
}
.oc-card-tag-add:hover,
.oc-card-tag-add:focus-visible {
  opacity: 1 !important;
  background: rgb(255 255 255 / .72);
  border-color: rgb(83 102 95 / .68);
  color: var(--oc-fit-ink, #293c36);
}
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
  height: var(--card-meta-line, 14px);
  pointer-events: auto;
}
.oc-event-status i {
  display: inline-block;
  width: var(--card-dot-size, 5px);
  height: var(--card-dot-size, 5px);
  margin-inline-end: 4px;
  border-radius: 50%;
  vertical-align: middle;
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
/* 纸面原位编辑区：严格位于顶栏与底栏之间，透明融合卡片纸纹与自适应字号 */
.oc-event-edit-zone {
  position: absolute;
  z-index: 2;
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-height: 0;
  pointer-events: auto;
}
.oc-fit-edit-main {
  justify-content: flex-start;
  pointer-events: auto;
}
.oc-fit-card .oc-inplace-title {
  flex: none;
  width: 100%;
  min-width: 0;
  padding: 0 0 2px;
  border: 0;
  border-bottom: 1px dashed color-mix(in srgb, var(--oc-fit-muted, #53665f) 32%, transparent);
  background: transparent;
  color: var(--oc-fit-ink, #293c36);
  font: 500 var(--card-title-font, 17px)/var(--card-title-line, 23px) var(--oc-serif, "Noto Serif SC", serif);
  outline: none;
  box-sizing: border-box;
  caret-color: var(--oc-fit-ink, #293c36);
}
.oc-fit-card .oc-inplace-title:focus {
  border-bottom-color: color-mix(in srgb, var(--accent, #59877e) 70%, transparent);
}
.oc-fit-card .oc-inplace-body {
  flex: 1;
  min-height: 22px;
  width: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--oc-fit-muted, #53665f);
  font: 400 var(--card-summary-font, 13px)/var(--card-summary-line, 19px) "Microsoft YaHei", system-ui, sans-serif;
  outline: none;
  resize: none;
  overflow-y: auto;
  box-sizing: border-box;
  caret-color: var(--oc-fit-ink, #293c36);
  scrollbar-width: thin;
  scrollbar-color: rgb(41 60 54 / .22) transparent;
}
.oc-fit-card .oc-inplace-body.is-body-only {
  color: var(--oc-fit-ink, #293c36);
}
.oc-fit-card .oc-inplace-title::placeholder,
.oc-fit-card .oc-inplace-body::placeholder {
  color: color-mix(in srgb, var(--oc-fit-muted, #53665f) 52%, transparent);
}
.oc-fit-card .oc-inplace-add-title {
  align-self: flex-start;
  flex: none;
  padding: 1px 6px;
  border: 1px dashed color-mix(in srgb, var(--oc-fit-muted, #53665f) 34%, transparent);
  border-radius: 999px;
  background: rgb(255 255 255 / .3);
  color: color-mix(in srgb, var(--oc-fit-muted, #53665f) 80%, transparent);
  font: 400 10.5px/1.4 "Microsoft YaHei", system-ui, sans-serif;
  cursor: pointer;
  opacity: .55;
  transition: opacity .15s ease, background .15s ease, border-color .15s ease;
}
.oc-fit-card .oc-inplace-add-title:hover {
  opacity: 1;
  background: rgb(255 255 255 / .65);
  border-color: color-mix(in srgb, var(--oc-fit-ink, #293c36) 45%, transparent);
  color: var(--oc-fit-ink, #293c36);
}
.oc-fit-centered .oc-inplace-title,
.oc-fit-centered .oc-inplace-body {
  text-align: center;
}
.oc-fit-centered .oc-inplace-add-title {
  align-self: center;
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
.oc-node:is(:hover, .sel, .selected, :focus-within) .oc-card-tag-add,
.oc-mini:is(:hover, .sel, :focus-within) .oc-card-tag-add {
  opacity: .85;
}
</style>
