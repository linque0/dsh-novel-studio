<script setup>
import { computed, nextTick, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, shallowRef, watch } from 'vue'
import { useWorkStore } from '../../stores/work'
import { useUiStore } from '../../stores/ui'
import { usePanZoom } from '../../services/graphview'
import { loreMapContent } from '../../services/lore-editor-dom'
import { layoutLoreTree } from '../../services/lore-tree-layout'
import { planLoreMove } from '../../services/lore-move'
import LoreImageHiddenNotice from '../LoreImageHiddenNotice.vue'
import LoreMapEditor from './LoreMapEditor.vue'

const props = defineProps({
  focusId: { type: String, default: '' },
  direction: { type: String, default: 'single' },
  edgeStyle: { type: String, default: 'elbow' },
  activeId: { type: String, default: '' }
})
const emit = defineEmits(['select', 'move'])
const work = useWorkStore()
const ui = useUiStore()
const canvasEl = ref(null)
const toolbar = ref(null)
const editing = shallowRef(null)
const gesture = shallowRef(null)
const dropTarget = shallowRef(null)
const hoveredId = ref('')
const CENTER = Symbol('work-center')
const minZoom = 0.08
const { zoom, tx, ty, onWheel, onPanStart, fit, centerOn } = usePanZoom(canvasEl, { minZoom })
const innerStyle = computed(() => {
  const z = Math.round((zoom.value || 1) * 1000) / 1000
  const edgeW = Math.min(3.6, Math.max(0.8, 1.35 / z)).toFixed(2)
  const edgeActiveW = Math.min(4.2, Math.max(1.0, 1.75 / z)).toFixed(2)
  return {
    transform: `translate(${Math.round(tx.value)}px, ${Math.round(ty.value)}px) scale(${z})`,
    transformOrigin: '0 0',
    '--tm-zoom': String(z),
    '--tm-edge-w': `${edgeW}px`,
    '--tm-edge-active-w': `${edgeActiveW}px`
  }
})
const folded = ref(new Set())
const sizes = shallowRef(new Map())
const nodes = new Map()
const cache = new Map()
let observer
let initialFrame = true

const roots = computed(() => props.focusId ? [props.focusId] : work.mubuRoots().map(node => node.id))
const entries = computed(() => {
  const byId = new Map(work.liveMubu().map(node => [node.id, {
    node, children: [],
    get imageWidth() {
      const width = contentOf(node).imageWidth
      return width && !node.parentId ? width + 28 : width
    }
  }]))
  for (const { node } of byId.values()) byId.get(node.parentId)?.children.push(node.id)
  return byId
})
watch(entries, current => {
  for (const id of cache.keys()) if (!current.has(id)) cache.delete(id)
})
const layout = computed(() => layoutLoreTree(roots.value, entries.value, folded.value, sizes.value, {
  mode: props.direction,
  edgeStyle: props.edgeStyle,
  centerWidth: sizes.value.get(CENTER)?.width || 132,
  centerHeight: sizes.value.get(CENTER)?.height || 42
}))
const topLevel = id => !entries.value.get(id)?.node.parentId
const isEmpty = id => {
  const entry = entries.value.get(id)
  return !entry?.node.text?.trim() && !contentOf(entry.node).imageWidth
}

function measureAll() {
  const next = new Map(sizes.value)
  let changed = false
  for (const [id, target] of nodes.entries()) {
    const width = target.offsetWidth, height = target.offsetHeight
    const previous = next.get(id)
    if (!width || !height || (previous?.width === width && previous?.height === height)) continue
    next.set(id, { width, height })
    changed = true
  }
  if (changed) sizes.value = next
}

function contentOf(node) {
  const previous = cache.get(node.id)
  if (previous && previous.sourceHtml === node.html && previous.sourceText === node.text) return previous
  const content = { ...loreMapContent(node), sourceHtml: node.html, sourceText: node.text }
  cache.set(node.id, content)
  return content
}

function markup(id) {
  return contentOf(entries.value.get(id).node).html || '（空节点）'
}

function trackNode(id, el) {
  const previous = nodes.get(id)
  if (el === previous || (!el && !previous)) return
  if (previous) observer?.unobserve(previous)
  if (el) {
    nodes.set(id, el)
    observer?.observe(el)
  } else {
    nodes.delete(id)
  }
}

function fitAll() {
  fit(layout.value.bounds, { minZoom: 0 })
}

function centerNode(node) {
  centerOn(node.x + node.width / 2, node.y + node.height / 2)
}

function frameTree() {
  const node = layout.value.nodes.find(item => item.id === props.activeId) || layout.value.nodes[0]
  if (window.innerWidth <= 559 && node) {
    zoom.value = 0.8
    centerNode(node)
  } else fitAll()
}

function focusActive() {
  const node = layout.value.nodes.find(item => item.id === props.activeId)
  if (!node) return fitAll()
  if (window.innerWidth <= 559) zoom.value = Math.max(0.8, zoom.value)
  centerNode(node)
}

function toggleFold(id) {
  const next = new Set(folded.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  folded.value = next
}

function startEdit(node, event) {
  if (event.target.closest('button, a, [data-dl-target]')) return
  emit('select', node.id)
  editing.value = { id: node.id, point: event.detail ? { x: event.clientX, y: event.clientY } : null }
}

function closeEditing(event) {
  if (!editing.value) return
  if (event.target.closest('.lore-tm-editor, .lore-tm-editor-tools, .lore-tm-editor-dock, .lore-image-chrome, .lore-link-picker')) return
  editing.value = null
}

function openPath(id) {
  const path = new Set(work.mubuPath(id).slice(0, -1).map(node => node.id))
  if ([...folded.value].some(item => path.has(item))) folded.value = new Set([...folded.value].filter(item => !path.has(item)))
}

function targetAt(event) {
  const { clientX: x, clientY: y } = event
  const hit = document.elementFromPoint(x, y)
  if (!canvasEl.value?.contains(hit)) return null
  if (hit.closest('[data-lore-work-center]')) return { key: CENTER, id: null, mode: 'root' }
  const exact = hit.closest('[data-lore-tree-id]')
  const node = exact || [...nodes.values()].find(el => {
    if (el.hasAttribute('data-lore-work-center')) return false
    const rect = el.getBoundingClientRect()
    return x >= rect.left && x <= rect.right && y >= rect.top - 7 && y <= rect.bottom + 7
  })
  if (!node) return null
  const rect = node.getBoundingClientRect()
  const edge = Math.min(16, rect.height * 0.25)
  const mode = y < rect.top + edge ? 'before' : y > rect.bottom - edge ? 'after' : 'inside'
  return { key: node.dataset.loreTreeId, id: node.dataset.loreTreeId, mode }
}

function startMove(node, event) {
  if (event.button !== 0 || gesture.value) return
  editing.value = null
  emit('select', node.id)
  const handle = event.currentTarget
  handle.setPointerCapture(event.pointerId)
  gesture.value = {
    id: node.id, pointer: event.pointerId, handle,
    startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY,
    label: entries.value.get(node.id).node.text?.trim().slice(0, 50) || '条目', moved: false
  }
}

function move(event) {
  const current = gesture.value
  if (!current || event.pointerId !== current.pointer) return
  const x = event.clientX, y = event.clientY
  if (!current.moved && Math.hypot(x - current.startX, y - current.startY) < 5) return
  gesture.value = { ...current, x, y, moved: true }
  const next = targetAt(event)
  const previous = dropTarget.value
  if (previous?.key === next?.key && previous?.mode === next?.mode) return
  dropTarget.value = next && planLoreMove(work.liveMubu(), current.id, next.id, next.mode, { allowRoot: true }).length ? next : null
}

function endMove(event, apply) {
  const current = gesture.value
  if (!current || event && event.pointerId !== current.pointer) return
  const target = apply && current.moved && targetAt(event)
  gesture.value = null
  dropTarget.value = null
  if (current.handle.hasPointerCapture(current.pointer)) current.handle.releasePointerCapture(current.pointer)
  if (target && work.mubuPlace(current.id, target.id, target.mode)) {
    openPath(current.id)
    emit('move', current.id)
    nextTick(() => nodes.get(current.id)?.focus({ preventScroll: true }))
  }
}

function shortcuts(event) {
  if (event.key === 'Escape' && gesture.value) {
    event.preventDefault()
    endMove(null, false)
  }
}

async function onCanvasKey(event) {
  if (event.isComposing || event.defaultPrevented || !(event.ctrlKey || event.metaKey)) return
  const key = event.key.toLowerCase()
  if (!['z', 'y'].includes(key)) return
  event.preventDefault()
  await work.mubuUndo(key === 'y' || event.shiftKey ? 'redo' : 'undo')
  openPath(props.activeId)
}

function zoomIn() {
  zoom.value = Math.min(2, zoom.value * 1.2)
}
function zoomOut() {
  zoom.value = Math.max(Math.min(minZoom, zoom.value), zoom.value / 1.2)
}
function zoomReset() {
  zoom.value = 1
}

watch(() => [props.focusId, props.direction, work.work?.id], () => {
  editing.value = null
  endMove(null, false)
  initialFrame = !sizes.value.size
  nextTick(frameTree)
})
watch(() => props.activeId, id => {
  openPath(id)
  if (editing.value && editing.value.id !== id) editing.value = null
})
watch(() => [ui.editorFont, ui.editorLatin], async () => {
  await nextTick()
  measureAll()
  await document.fonts?.ready
  measureAll()
})

let treeMapBound = false
function bindTreeMapListeners() {
  if (treeMapBound) return
  treeMapBound = true
  document.addEventListener('pointerdown', closeEditing, true)
  document.addEventListener('keydown', shortcuts, true)
}
function unbindTreeMapListeners() {
  if (!treeMapBound) return
  treeMapBound = false
  document.removeEventListener('pointerdown', closeEditing, true)
  document.removeEventListener('keydown', shortcuts, true)
}
onMounted(() => {
  bindTreeMapListeners()
  observer = new ResizeObserver(changes => {
    const next = new Map(sizes.value)
    let changed = false
    for (const { target } of changes) {
      const id = target.hasAttribute('data-lore-work-center') ? CENTER : target.dataset.loreTreeId
      if (nodes.get(id) !== target) continue
      const width = target.offsetWidth, height = target.offsetHeight
      const previous = next.get(id)
      if (!width || !height || (previous?.width === width && previous?.height === height)) continue
      next.set(id, { width, height })
      changed = true
    }
    if (changed) sizes.value = next
    if (initialFrame && next.size) {
      initialFrame = false
      nextTick(frameTree)
    }
  })
  for (const node of nodes.values()) observer.observe(node)
  if (!nodes.size) frameTree()
})
onActivated(() => {
  bindTreeMapListeners()
})
onDeactivated(() => {
  unbindTreeMapListeners()
  endMove(null, false)
})
onBeforeUnmount(() => {
  unbindTreeMapListeners()
  endMove(null, false)
  observer?.disconnect()
})

defineExpose({ zoomIn, zoomOut, zoomReset, fitAll, focusActive, zoom })
</script>

<template>
  <div ref="canvasEl" class="lore-tm-wrap" tabindex="-1" @mousedown="onPanStart" @wheel.prevent="onWheel" @keydown="onCanvasKey">
    <div ref="toolbar" class="lore-tm-editor-dock" @mousedown.stop />
    <div class="lore-tm-inner" :style="innerStyle">
      <svg class="lore-tm-edges" :width="layout.bounds.w" :height="layout.bounds.h"
        :style="{ left: layout.bounds.x + 'px', top: layout.bounds.y + 'px' }"
        :viewBox="`${layout.bounds.x} ${layout.bounds.y} ${layout.bounds.w} ${layout.bounds.h}`" aria-hidden="true">
        <path
          v-for="edge in layout.edges"
          :key="edge.id"
          class="lore-tm-edge"
          :class="{
            'is-root-edge': edge.depth === 0,
            'is-active': edge.id === props.activeId || edge.parentId === props.activeId,
            'is-hovered': hoveredId && (edge.id === hoveredId || edge.parentId === hoveredId)
          }"
          :d="edge.d"
        />
      </svg>
      <div
        :ref="el => trackNode(CENTER, el)" class="lore-tm-work-center"
        data-lore-work-center
        :data-drop="dropTarget?.key === CENTER ? 'inside' : undefined"
        :style="{ left: layout.center.x + 'px', top: layout.center.y + 'px' }"
        @mousedown.stop
      >{{ work.work?.title || '作品' }}</div>
      <div
        v-for="node in layout.nodes"
        :key="node.id"
        :ref="el => trackNode(node.id, el)"
        class="lore-tm-content-node"
        :class="{
          'is-root': topLevel(node.id),
          'is-empty': isEmpty(node.id),
          'is-selected': node.id === props.activeId,
          'is-editing': editing?.id === node.id,
          'is-hovered': hoveredId === node.id
        }"
        :data-lore-tree-id="node.id"
        :data-side="node.side"
        :aria-current="node.id === props.activeId ? 'true' : undefined"
        :data-drop="dropTarget?.key === node.id ? dropTarget.mode : undefined"
        :style="{ left: node.x + 'px', top: node.y + 'px', maxWidth: (editing?.id === node.id ? Math.max(node.columnWidth, 720) : node.columnWidth) + 'px' }"
        tabindex="0"
        @mousedown.stop
        @mouseenter="hoveredId = node.id"
        @mouseleave="hoveredId === node.id && (hoveredId = '')"
        @click="emit('select', node.id)"
        @dblclick.stop="startEdit(node, $event)"
        @keydown.enter.self.prevent="startEdit(node, $event)"
        @keydown.f2.self.prevent="startEdit(node, $event)"
        @keydown.space.self.prevent="emit('select', node.id)"
      >
        <LoreMapEditor v-if="editing?.id === node.id" :node="entries.get(node.id).node" :point="editing.point"
          :toolbar="toolbar" :scope-root="focusId" :zoom="zoom" :viewport="innerStyle.transform"
          :width="Math.max(node.columnWidth, 720)" @finish="editing = null" />
        <div v-else class="lore-tm-content" v-html="markup(node.id)" />
        <LoreImageHiddenNotice :node-id="node.id" :html="entries.get(node.id).node.html" />
        <button v-if="editing?.id !== node.id" class="lore-tm-position" type="button" aria-label="拖动条目" title="拖动条目"
          @pointerdown.stop.prevent="startMove(node, $event)" @pointermove="move"
          @pointerup="endMove($event, true)" @pointercancel="endMove($event, false)"
          @lostpointercapture="endMove($event, false)" @click.stop @dblclick.stop />
        <button
          v-if="node.childCount"
          class="lore-tm-fold"
          :class="{ collapsed: node.collapsed }"
          type="button"
          :aria-expanded="!node.collapsed"
          :title="node.collapsed ? `展开 ${node.childCount} 项` : `收起 ${node.childCount} 项`"
          @click.stop="toggleFold(node.id)"
          @dblclick.stop
        >{{ node.collapsed ? node.childCount : '−' }}</button>
      </div>
    </div>
    <p v-if="!layout.nodes.length" class="lore-tm-empty lore-tm-empty-entries">暂无设定条目</p>
    <Teleport to="body">
      <div v-if="gesture?.moved" class="lore-tm-drag-label" :style="{ left: gesture.x + 12 + 'px', top: gesture.y + 12 + 'px' }">
        {{ gesture.label }}
      </div>
    </Teleport>
  </div>
</template>
