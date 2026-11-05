<!-- 设定层级导图（C 视图 · hierarchy 模式）——布局与画法对照设计稿 c-hierarchy-1440 与原型 map.mjs/treeLayout：
     横向树（x = 90 + 层级 × 232，叶子行距 80），纸片节点卡（设定集 160×68 / 条目 176×68），
     连线是两端水平切线的三次贝塞尔，折叠按钮是节点右缘的绿色圆点（展开显示 −，折叠显示子项数）。
     交互：拖动空白平移、Ctrl+滚轮缩放、点击选中（联动右摘要）、双击进 B、圆点折叠。
     数据仍取 work.mubu*，不套大纲画布（OutlineCanvas）的节点/连线模型。 -->
<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useWorkStore } from '../../stores/work'
import { usePanZoom } from '../../services/graphview'
import OIcon from '../OIcon.vue'

const props = defineProps({
  setId: { type: String, default: '' },
  activeId: { type: String, default: '' }
})
const emit = defineEmits(['select', 'open'])

const work = useWorkStore()
const canvasEl = ref(null)
const { zoom, innerStyle, onWheel, onPanStart, fit, centerOn } = usePanZoom(canvasEl)

const NODE_W = 176
const SET_W = 160
const NODE_H = 68
const STEP_X = 232
const STEP_Y = 80
const folded = ref(new Set())

function widthOf(n) {
  return n.set ? SET_W : NODE_W
}

const layout = computed(() => {
  const setId = props.setId || work.currentMubuRoot()?.id || null
  if (!setId) return { nodes: [], edges: [], bounds: { x: 0, y: 0, w: 760, h: 580 } }
  const nodes = []
  const edges = []
  const seen = new Set()
  let cursor = 0
  let maxDepth = 0
  const visit = (id, depth, isSet) => {
    if (seen.has(id)) return 0
    seen.add(id)
    const raw = work.mubu.find((n) => n.id === id && !n.deletedAt)
    if (!raw) return 0
    const kids = folded.value.has(id) ? [] : work.mubuChildren(id)
    const ys = kids.map((k) => visit(k.id, depth + 1, false))
    const y = ys.length ? (ys[0] + ys[ys.length - 1]) / 2 : (cursor += STEP_Y)
    nodes.push({
      id,
      set: isSet,
      text: String(raw.text || '').trim() || '（空节点）',
      depth,
      x: 90 + depth * STEP_X,
      y,
      childCount: work.mubuChildren(id).length,
      collapsed: folded.value.has(id)
    })
    for (const k of kids) edges.push({ from: id, to: k.id })
    maxDepth = Math.max(maxDepth, depth)
    return y
  }
  if (work.mubu.some((n) => n.id === setId && !n.deletedAt)) visit(setId, 0, true)
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const paths = edges
    .map((e) => {
      const a = byId.get(e.from)
      const b = byId.get(e.to)
      if (!a || !b) return null
      const x1 = a.x + widthOf(a) / 2 + 3
      const y1 = a.y
      const x2 = b.x - widthOf(b) / 2 - 3
      const y2 = b.y
      const mx = (x1 + x2) / 2
      return { id: e.from + '>' + e.to, d: `M${x1} ${y1}C${mx} ${y1},${mx} ${y2},${x2} ${y2}` }
    })
    .filter(Boolean)
  const w = Math.max(760, 180 + maxDepth * STEP_X)
  const h = Math.max(580, cursor + 70)
  return { nodes, edges: paths, bounds: { x: 0, y: 0, w, h } }
})

const nodeCount = computed(() => layout.value.nodes.length)
function fitAll() {
  fit(layout.value.bounds)
}
function toggleFold(id, e) {
  if (e) e.stopPropagation()
  const next = new Set(folded.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  folded.value = next
  nextTick(fitAll)
}
function nodeStyle(n) {
  return {
    left: n.x + 'px',
    top: n.y + 'px',
    width: widthOf(n) + 'px',
    height: NODE_H + 'px',
    transform: 'translate(-50%, -50%)'
  }
}
function onNodeClick(n) {
  emit('select', n.id)
}
function onNodeDblClick(n) {
  if (n.set) return
  emit('open', n.id)
}
function zoomIn() {
  zoom.value = Math.min(2, Math.round((zoom.value + 0.1) * 100) / 100)
}
function zoomOut() {
  zoom.value = Math.max(0.35, Math.round((zoom.value - 0.1) * 100) / 100)
}
function zoomReset() {
  zoom.value = 1
}
function focusActive() {
  const n = layout.value.nodes.find((x) => x.id === props.activeId)
  if (n) centerOn(n.x, n.y)
  else fitAll()
}

watch(() => props.setId, () => {
  folded.value = new Set()
  nextTick(fitAll)
})
onMounted(() => nextTick(fitAll))

defineExpose({ zoomIn, zoomOut, zoomReset, fitAll, focusActive, zoom })
</script>

<template>
  <div ref="canvasEl" class="lore-tm-wrap" @mousedown="onPanStart" @wheel.prevent="onWheel">
    <div class="lore-tm-inner" :style="innerStyle">
      <svg class="lore-tm-edges" :width="layout.bounds.w + 200" :height="layout.bounds.h + 200" style="left: -100px; top: -100px">
        <path v-for="p in layout.edges" :key="p.id" class="lore-tm-edge" :d="p.d" />
      </svg>
      <div
        v-for="n in layout.nodes"
        :key="n.id"
        class="lore-tm-node"
        :class="{ set: n.set, on: n.id === props.activeId }"
        :style="nodeStyle(n)"
        :title="n.text"
        role="button"
        tabindex="0"
        @mousedown.stop
        @click="onNodeClick(n)"
        @dblclick.stop="onNodeDblClick(n)"
        @keydown.enter="onNodeClick(n)"
      >
        <small class="lore-tm-kind"><OIcon :name="n.set ? 'folder' : 'tag'" :size="10" />{{ n.set ? '设定集' : '设定条目' }}</small>
        <h3 class="lore-tm-title">{{ n.text }}</h3>
        <button
          v-if="n.childCount"
          class="lore-tm-fold"
          :class="{ collapsed: n.collapsed }"
          type="button"
          :title="n.collapsed ? `展开 ${n.childCount} 项` : `收起 ${n.childCount} 项`"
          @mousedown.stop
          @click="toggleFold(n.id, $event)"
        >{{ n.collapsed ? n.childCount : '−' }}</button>
      </div>
    </div>
    <p v-if="!nodeCount" class="lore-tm-empty">当前设定集还没有条目</p>
  </div>
</template>
