<!-- 关联关系图谱（设定详情页内）：中心条目固定在原点，一度邻居环形自动排布；
     复用 graphview（pan/zoom + 箭头）与 canvas-model（routeEdge 贝塞尔/A* 避障）共用引擎；
     邻居可拖动，位置按中心条目分组记忆在 appconfig loreGraph:<workId>；
     点击邻居 → 设定切换详情页 / 人物跳转；悬停节点或连线 → 高亮并联动关系列表 -->
<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import OIcon from './OIcon.vue'
import { useWorkStore } from '../stores/work'
import { usePanZoom, anchorsOf, arrowHeadDir } from '../services/graphview'
import { routeEdge, sideBetween, trimEdgeD } from './outline/canvas-model'
import { relColor } from '../services/relation-kinds'

const props = defineProps({
  nodeId: { type: String, required: true },
  entries: { type: Array, default: () => [] }, // work.loreLinksOf('mubu', nodeId)
  /* 下面三个是给「C 视觉导图 · 关系网络」用的可选参数，默认值 = 详情页与拆窗面板的原行为：
     height：画布高度（数字按 px，也可传 '100%'）；不传走 CSS（.lg-wrap height:100%）。
     degree：邻居扩展层数（默认 1 = 只要直接邻居）；>1 时按关系 BFS 展开并画出集合内的连线。
     scope ：'center'（默认，中心 + 邻居）/ 'set'（当前设定集的全部条目与它们之间的关系）。 */
  height: { type: [Number, String], default: null },
  nodeW: { type: Number, default: 0 },
  nodeH: { type: Number, default: 0 },
  centerW: { type: Number, default: 0 },
  centerH: { type: Number, default: 0 },
  degree: { type: Number, default: 1 },
  scope: { type: String, default: 'center' }
})
const emit = defineEmits(['pick', 'hover'])

const work = useWorkStore()
const canvasEl = ref(null)
const { zoom, tx, ty, innerStyle, onWheel, onPanStart, fit: fitTo } = usePanZoom(canvasEl)

/* 节点尺寸可被调用方覆盖：详情页用默认值（132×48 / 中心 150×52），
   C 视觉导图按设计稿传 156×88 / 中心 198×116。几何与命中区都读这一组值。 */
const nodeW = computed(() => Number(props.nodeW) || 132)
const nodeH = computed(() => Number(props.nodeH) || 48)
const centerW = computed(() => Number(props.centerW) || 150)
const centerH = computed(() => Number(props.centerH) || 52)
const ARROW = 7

const allLayout = ref({}) // { '<centerKey>': { '<neighborKey>': { x, y } } }
const dragPos = reactive(new Map())
const hoverKey = ref(null) // 邻居节点 key（'' = 无）
const centerKey = computed(() => 'mubu:' + props.nodeId)
const layout = computed(() => allLayout.value[centerKey.value] || {})
const centerTitle = computed(() => {
  const n = work.mubu.find((x) => x.id === props.nodeId && !x.deletedAt)
  return ((n && n.text) || '（空节点）').slice(0, 20)
})

/** 集合是否超出「中心 + 一度邻居」（degree / scope 才打开这条路径，默认不碰） */
const expandedSet = computed(() => props.scope === 'set' || props.degree > 1)

const nodes = computed(() => {
  const out = [{ key: centerKey.value, center: true, kind: 'mubu', title: centerTitle.value }]
  const seen = new Set([centerKey.value])
  const add = (kind, id, title, entry) => {
    const key = kind + ':' + id
    if (seen.has(key)) return false
    seen.add(key)
    out.push({ key, center: false, kind, title, entry })
    return true
  }
  if (!expandedSet.value) {
    for (const e of props.entries) add(e.otherKind, e.otherId, e.otherTitle, e)
    return out
  }
  if (props.scope === 'set') {
    const root = work.currentMubuRoot()
    if (root) {
      const walk = (id) => {
        for (const c of work.mubuChildren(id)) {
          add('mubu', c.id, String(c.text || '（空节点）').slice(0, 40), null)
          walk(c.id)
        }
      }
      add('mubu', root.id, String(root.text || '（空节点）').slice(0, 40), null)
      walk(root.id)
    }
    return out
  }
  /* degree > 1：从中心按关系逐层 BFS */
  let frontier = [{ kind: 'mubu', id: props.nodeId }]
  for (let hop = 0; hop < Math.min(4, props.degree) && frontier.length; hop++) {
    const next = []
    for (const cur of frontier) {
      for (const e of work.loreLinksOf(cur.kind, cur.id)) {
        if (add(e.otherKind, e.otherId, e.otherTitle, hop === 0 ? e : null)) next.push({ kind: e.otherKind, id: e.otherId })
      }
    }
    frontier = next
  }
  return out
})
const wrapStyle = computed(() => {
  if (props.height == null || props.height === '') return null
  return { height: typeof props.height === 'number' ? props.height + 'px' : String(props.height) }
})
function sizeOf(n) {
  return n.center ? { w: centerW.value, h: centerH.value } : { w: nodeW.value, h: nodeH.value }
}
function posOf(n) {
  if (n.center) return { x: -centerW.value / 2, y: -centerH.value / 2 }
  return dragPos.get(n.key) || layout.value[n.key] || null
}

/* ---------- 自动排布（缺位置的一度邻居环形落位）与持久化 ---------- */
function ensureLayout() {
  const key = centerKey.value
  const nbrs = nodes.value.filter((n) => !n.center)
  const cur = { ...(allLayout.value[key] || {}) }
  if (nbrs.some((n) => !cur[n.key])) {
    const total = Math.max(1, nbrs.length)
    const R = Math.max(180, total * 44)
    nbrs.forEach((n, i) => {
      if (cur[n.key]) return
      const a = (i / total) * Math.PI * 2 - Math.PI / 2
      cur[n.key] = { x: Math.round(R * Math.cos(a) - nodeW.value / 2), y: Math.round(R * Math.sin(a) - nodeH.value / 2) }
    })
    allLayout.value = { ...allLayout.value, [key]: cur }
    scheduleSave()
  }
}
let saveTimer = null
function scheduleSave() {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => work.saveLoreGraph(allLayout.value), 350)
}
function flushSave() {
  clearTimeout(saveTimer)
  if (work.work) work.saveLoreGraph(allLayout.value)
}

/* ---------- 连线（方向箭头 + 类型标签 + 两端避障） ---------- */
const edges = computed(() => {
  if (expandedSet.value) return pairEdges() // 集合内任意两点的连线（degree/scope 才走）
  const out = []
  const rects = []
  for (const n of nodes.value) {
    const p = posOf(n)
    if (p) {
      const s = sizeOf(n)
      rects.push({ key: n.key, x: p.x, y: p.y, w: s.w, h: s.h })
    }
  }
  const center = rects.find((r) => r.key === centerKey.value)
  if (!center) return out
  const labelShift = new Map() // 同一邻居多条关系时，标签依次下移避免叠字
  for (const n of nodes.value) {
    if (n.center) continue
    const p = posOf(n)
    if (!p) continue
    const B = { x: p.x, y: p.y, w: nodeW.value, h: nodeH.value }
    /* 同一邻居可能挂多条关系：逐条出边（几何相同，标签错位） */
    const rels = props.entries.filter((e) => e.otherKind + ':' + e.otherId === n.key)
    const shiftIdx = labelShift.get(n.key) || 0
    rels.forEach((e, i) => {
      const sb = sideBetween(center, B)
      const fromSide = sb.from
      const toSide = sb.to
      const fa = anchorsOf(center)[fromSide]
      const ta = anchorsOf(B)[toSide]
      if (!fa || !ta) return
      const obs = rects.filter((r) => r.key !== centerKey.value && r.key !== n.key).map((r) => ({ x: r.x, y: r.y, w: r.w, h: r.h }))
      obs.unshift({ x: center.x, y: center.y, w: center.w, h: center.h }, { x: B.x, y: B.y, w: B.w, h: B.h })
      const g = routeEdge(fa, fromSide, ta, toSide, obs, 'bezier')
      const toCenter = e.dir === 'in' // 反向关系：箭头指向中心
      const tip = toCenter ? fa : ta
      const dir = toCenter ? { x: -g.startDir.x, y: -g.startDir.y } : g.endDir
      out.push({
        id: e.linkId + ':' + e.dir,
        nkey: n.key,
        entry: e,
        d: toCenter ? trimEdgeD(g, 0, ARROW) : trimEdgeD(g, ARROW),
        mid: { x: g.mid.x, y: g.mid.y + (shiftIdx + i) * 15 },
        arrow: arrowHeadDir(tip.x, tip.y, dir, ARROW + 0.5),
        color: e.color || relColor(e.label)
      })
    })
    labelShift.set(n.key, shiftIdx + rels.length)
  }
  return out
})
/** 扩展集合的连线：集合内每条关系的两端都可见时才画（几何与中心出边同一套引擎） */
function pairEdges() {
  const out = []
  const byKey = new Map(nodes.value.map((n) => [n.key, n]))
  const rectOf = (n) => {
    const p = posOf(n)
    if (!p) return null
    const s = sizeOf(n)
    return { key: n.key, x: p.x, y: p.y, w: s.w, h: s.h }
  }
  const rects = nodes.value.map(rectOf).filter(Boolean)
  for (const l of work.liveLoreLinks) {
    const a = byKey.get(l.fromKind + ':' + l.fromId)
    const b = byKey.get(l.toKind + ':' + l.toId)
    if (!a || !b || (a.center && b.center)) continue
    const ra = rectOf(a)
    const rb = rectOf(b)
    if (!ra || !rb) continue
    const sb = sideBetween(ra, rb)
    const fa = anchorsOf(ra)[sb.from]
    const ta = anchorsOf(rb)[sb.to]
    if (!fa || !ta) continue
    const obs = rects
      .filter((r) => r.key !== ra.key && r.key !== rb.key)
      .map((r) => ({ x: r.x, y: r.y, w: r.w, h: r.h }))
    obs.push({ x: ra.x, y: ra.y, w: ra.w, h: ra.h }, { x: rb.x, y: rb.y, w: rb.w, h: rb.h })
    const g = routeEdge(fa, sb.from, ta, sb.to, obs, 'bezier')
    const color = l.color || relColor(l.label || '关联')
    out.push({
      id: l.id + ':pair',
      nkey: rb.key,
      entry: { linkId: l.id, dir: 'out', label: l.label || '关联', color: l.color || '', otherKind: l.toKind, otherId: l.toId },
      d: trimEdgeD(g, ARROW),
      mid: g.mid,
      arrow: arrowHeadDir(ta.x, ta.y, g.endDir, ARROW + 0.5),
      color
    })
  }
  return out
}
const dimNodes = computed(() => {
  if (!hoverKey.value) return new Set()
  const keep = new Set([centerKey.value, hoverKey.value])
  return new Set(nodes.value.filter((n) => !keep.has(n.key)).map((n) => n.key))
})
const dimEdges = computed(() => {
  if (!hoverKey.value) return new Set()
  return new Set(edges.value.filter((e) => e.nkey !== hoverKey.value).map((e) => e.id))
})

/* ---------- 视口 ---------- */
const bounds = computed(() => {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const n of nodes.value) {
    const p = posOf(n)
    if (!p) continue
    const s = sizeOf(n)
    x0 = Math.min(x0, p.x)
    y0 = Math.min(y0, p.y)
    x1 = Math.max(x1, p.x + s.w)
    y1 = Math.max(y1, p.y + s.h)
  }
  if (x0 === Infinity) return { x: -100, y: -100, w: 200, h: 200 }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
})
const svgBox = computed(() => {
  const b = bounds.value
  const x0 = Math.min(0, b.x - 400)
  const y0 = Math.min(0, b.y - 400)
  const x1 = Math.max(600, b.x + b.w + 400)
  const y1 = Math.max(500, b.y + b.h + 400)
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
})
function fitView() {
  fitTo(bounds.value)
}

/* ---------- 交互：拖动邻居（点击=跳转，位移>4px 才算拖动） ---------- */
function onNodeDown(e, n) {
  if (e.button !== 0) return
  e.stopPropagation() // 不触发画布平移
  const orig = { ...(dragPos.get(n.key) || posOf(n) || { x: 0, y: 0 }) }
  const sx = e.clientX
  const sy = e.clientY
  let moved = false
  const move = (ev) => {
    if (n.center) return
    if (!moved && Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) > 4) moved = true
    if (!moved) return
    dragPos.set(n.key, { x: Math.round(orig.x + (ev.clientX - sx) / zoom.value), y: Math.round(orig.y + (ev.clientY - sy) / zoom.value) })
  }
  const up = () => {
    window.removeEventListener('mousemove', move)
    window.removeEventListener('mouseup', up)
    if (moved && !n.center) {
      const p = dragPos.get(n.key)
      if (p) {
        dragPos.delete(n.key)
        commitPos(n.key, p)
      }
    } else if (!n.center) {
      emit('pick', n.entry)
    }
  }
  window.addEventListener('mousemove', move)
  window.addEventListener('mouseup', up)
}
function commitPos(key, p) {
  const cur = { ...(allLayout.value[centerKey.value] || {}), [key]: p }
  allLayout.value = { ...allLayout.value, [centerKey.value]: cur }
  scheduleSave()
}
function onNodeEnter(n) {
  hoverKey.value = n.key
  if (n.entry) emit('hover', n.entry)
}
function onNodeLeave() {
  hoverKey.value = null
  emit('hover', null)
}
function hoverEdge(e) {
  hoverKey.value = e ? e.nkey : null
  emit('hover', e ? e.entry : null)
}
function nodeStyle(n) {
  const p = posOf(n)
  if (!p) return { display: 'none' }
  const s = sizeOf(n)
  return {
    left: p.x + 'px',
    top: p.y + 'px',
    width: s.w + 'px',
    height: s.h + 'px',
    opacity: dimNodes.value.has(n.key) ? 0.18 : 1,
    zIndex: n.center ? 5 : 3
  }
}

/* ---------- 装载 / 切换中心 ---------- */
async function reload() {
  allLayout.value = (await work.loadLoreGraph()) || {}
  ensureLayout()
  nextTick(fitView)
}
watch(
  () => props.nodeId,
  async () => {
    flushSave()
    hoverKey.value = null
    await reload()
  }
)
watch(
  () => props.entries.map((e) => e.linkId + ':' + e.dir).join('|'),
  () => {
    ensureLayout()
    nextTick(fitView)
  }
)
onMounted(reload)
onBeforeUnmount(flushSave)

/* C 视觉导图的页脚缩放键（设计稿 graph-footer .zoom-control）走这一套，与画布内按钮同源 */
function zoomIn() {
  zoom.value = Math.min(2.2, Math.round((zoom.value + 0.1) * 100) / 100)
}
function zoomOut() {
  zoom.value = Math.max(0.3, Math.round((zoom.value - 0.1) * 100) / 100)
}
function zoomReset() {
  zoom.value = 1
}
defineExpose({ zoomIn, zoomOut, zoomReset, fitView, zoom })
</script>

<template>
  <div class="om-wrap lg-wrap" :style="wrapStyle">
    <div class="om-toolbar lg-toolbar">
      <span class="oc-count">{{ nodes.length - 1 }} 个邻居 · {{ entries.length }} 条关系</span>
      <span style="flex: 1"></span>
      <button class="om-btn" title="缩小" @click="zoom = Math.max(0.3, zoom - 0.15)"><OIcon name="minus" :size="14" /></button>
      <button class="om-btn" title="放大" @click="zoom = Math.min(2.2, zoom + 0.15)"><OIcon name="plus" :size="14" /></button>
      <button class="om-btn text" title="适应视图（Ctrl+滚轮缩放 / 空白拖动平移）" @click="fitView">适应</button>
    </div>
    <div ref="canvasEl" class="om-canvas lg-canvas" @mousedown="onPanStart" @wheel="onWheel">
      <div class="om-inner" :style="innerStyle">
        <svg
          class="om-edges lg-edges"
          :style="{ left: svgBox.x + 'px', top: svgBox.y + 'px' }"
          :width="svgBox.w"
          :height="svgBox.h"
          :viewBox="svgBox.x + ' ' + svgBox.y + ' ' + svgBox.w + ' ' + svgBox.h"
        >
          <path
            v-for="e in edges"
            :key="'h' + e.id"
            class="lg-edge-hit"
            :d="e.d"
            :data-link="e.id"
            @mouseenter="hoverEdge(e)"
            @mouseleave="hoverEdge(null)"
          />
          <path
            v-for="e in edges"
            :key="e.id"
            :d="e.d"
            fill="none"
            :stroke="e.color"
            stroke-width="1.8"
            :opacity="dimEdges.has(e.id) ? 0.12 : 0.85"
          />
          <polygon
            v-for="e in edges"
            :key="'a' + e.id"
            :points="e.arrow"
            :fill="e.color"
            :opacity="dimEdges.has(e.id) ? 0.12 : 0.9"
          />
        </svg>

        <!-- 关系类型标签（中点） -->
        <div
          v-for="e in edges"
          :key="'l' + e.id"
          class="lg-elabel"
          :style="{ left: e.mid.x + 'px', top: e.mid.y + 'px', color: e.color, opacity: dimEdges.has(e.id) ? 0.15 : 1 }"
          @mouseenter="hoverEdge(e)"
          @mouseleave="hoverEdge(null)"
        >{{ e.entry.label }}</div>

        <!-- 节点：中心条目 + 一度邻居（邻居可拖动，点击跳转/切换详情） -->
        <div
          v-for="n in nodes"
          :key="n.key"
          class="lg-node"
          :class="{ center: n.center, char: n.kind === 'character' }"
          :style="nodeStyle(n)"
          :title="n.center ? '当前条目（拖动邻居调整布局）' : (n.entry.description || n.title)"
          @mousedown="onNodeDown($event, n)"
          @mouseenter="onNodeEnter(n)"
          @mouseleave="onNodeLeave"
        >
          <OIcon :name="n.kind === 'character' ? 'user' : 'tag'" :size="12" />
          <span class="lg-title">{{ n.title }}</span>
          <span v-if="n.center && entries.length" class="lg-badge">{{ entries.length }}</span>
        </div>
      </div>
      <div v-if="!entries.length" class="lg-empty">暂无关联关系——从关系列表「添加关系」建立后在此查看图谱</div>
    </div>
  </div>
</template>
