<!-- 设定层级导图（C 视图 · hierarchy 模式）——布局与画法对照设计稿 c-hierarchy-1440 与原型 map.mjs/treeLayout：
     横向树（x = 90 + 层级 × 232，叶子行距 80），纸片节点卡（设定集 160×68 / 条目 176×68），
     连线是两端水平切线的三次贝塞尔，折叠按钮是节点右缘的绿色圆点（展开显示 −，折叠显示子项数）。
     交互：拖动空白平移、Ctrl+滚轮缩放、点击选中（联动右摘要）、双击进 B、圆点折叠。
     数据仍取 work.mubu*，不套大纲画布（OutlineCanvas）的节点/连线模型。 -->
<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useWorkStore } from '../../stores/work'
import { usePanZoom } from '../../services/graphview'
import OIcon from '../OIcon.vue'
import { kindOf } from './lore-kinds.js'

const props = defineProps({
  setId: { type: String, default: '' },
  /* 「全部设定」总览：非空时每个 id 各画一棵树（集与集之间纵向留白），空时退回单集 setId */
  setIds: { type: Array, default: () => [] },
  activeId: { type: String, default: '' }
})
const emit = defineEmits(['select', 'open'])

const work = useWorkStore()
const canvasEl = ref(null)
const { zoom, innerStyle, onWheel, onPanStart, fit, centerOn } = usePanZoom(canvasEl)

const NODE_W = 176
const SET_W = 160
const NODE_H = 68
const EDGE_PAD = 100 // svg 相对画布外扩的留白；<g> 用同一常量反向补偿，路径坐标与节点坐标同源
const STEP_X = 232
const STEP_Y = 80
const folded = ref(new Set())

function widthOf(n) {
  return n.set ? SET_W : NODE_W
}
/* 卡片 kind 行：设定集仍写「设定集」；条目按 kindOf 取名，读原始节点才有 tags/kind（只读，不动布局） */
function cardKind(n) {
  if (n.set) return { icon: 'folder', label: '设定集' }
  const raw = work.mubu.find((x) => x.id === n.id && !x.deletedAt)
  return kindOf(raw || n)
}

/* 布局根：setIds 非空即多根总览，否则单集（setId 兼容旧接线） */
const roots = computed(() => (props.setIds.length ? props.setIds : [props.setId || work.currentMubuRoot()?.id].filter(Boolean)))
const ROOT_GAP = 60 // 集与集之间的纵向留白（上一集末叶与下一集首叶的 y 差）

const layout = computed(() => {
  if (!roots.value.length) return { nodes: [], edges: [], bounds: { x: 0, y: 0, w: 760, h: 580 } }
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
  /* 多根依次布局：cursor / maxDepth 跨根累计，每集之间留 ROOT_GAP；上一根没画出节点（已删除的 id）不留白 */
  roots.value.forEach((rid, i) => {
    if (i && nodes.length) cursor += ROOT_GAP
    visit(rid, 0, true)
  })
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
  fit(layout.value.bounds, { minZoom: 0.12 })
}
function frameTree() {
  const n = layout.value.nodes.find(x => x.id === props.activeId) || layout.value.nodes[0]
  if (window.innerWidth <= 559 && n) { zoom.value = 0.8; centerOn(n.x, n.y) }
  else fitAll()
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
    minHeight: NODE_H + 'px',
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
  if (n) { if (window.innerWidth <= 559) zoom.value = Math.max(0.8, zoom.value); centerOn(n.x, n.y) }
  else fitAll()
}

watch(roots, () => {
  folded.value = new Set()
  nextTick(frameTree)
})
/* 尺寸自适应：细轨收起 / 摘要列收起 / 窗口缩放都会改 stage 宽度，画布自身尺寸一变就重新 fitAll */
let ro = null
let resizeTimer = 0
onMounted(() => {
  nextTick(frameTree)
  const el = canvasEl.value
  if (!el || typeof ResizeObserver === 'undefined') return
  let lastW = el.clientWidth
  let lastH = el.clientHeight
  ro = new ResizeObserver((entries) => {
    const box = entries[entries.length - 1].contentRect
    const w = Math.round(box.width)
    const h = Math.round(box.height)
    if (w === lastW && h === lastH) return // 首帧与平移缩放不动画布尺寸，不触发重排
    lastW = w
    lastH = h
    if (resizeTimer) clearTimeout(resizeTimer)
    resizeTimer = setTimeout(() => {
      resizeTimer = 0
      nextTick(frameTree)
    }, 60)
  })
  ro.observe(el)
})
onBeforeUnmount(() => {
  ro?.disconnect()
  ro = null
  if (resizeTimer) clearTimeout(resizeTimer)
  resizeTimer = 0
})

defineExpose({ zoomIn, zoomOut, zoomReset, fitAll, focusActive, zoom })
</script>

<template>
  <div ref="canvasEl" class="lore-tm-wrap" @mousedown="onPanStart" @wheel.prevent="onWheel">
    <div class="lore-tm-inner" :style="innerStyle">
      <svg
        class="lore-tm-edges"
        :width="layout.bounds.w + EDGE_PAD * 2"
        :height="layout.bounds.h + EDGE_PAD * 2"
        :style="{ left: -EDGE_PAD + 'px', top: -EDGE_PAD + 'px' }"
      >
        <g :transform="`translate(${EDGE_PAD},${EDGE_PAD})`">
          <path v-for="p in layout.edges" :key="p.id" class="lore-tm-edge" :d="p.d" />
        </g>
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
        <small class="lore-tm-kind"><OIcon :name="cardKind(n).icon" :size="10" />{{ cardKind(n).label }}</small>
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
