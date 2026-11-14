<!-- 大纲自由模块画布（8.8.2 v0.4.1）：流程图式白板——事件/便签/引用卡/容器/章节锚点自由摆位，
     四向锚点拖线（因果/伏笔/冲突/关联 + 箭头 + 标签）、贝塞尔/正交折线、网格吸附、双密度、断线检测、
     关系链接卫星与悬停预览（复用全局 DLinkPopover）、骨架模板快速开始；布局数学在 outline/canvas-model.js -->
<script setup>
import OutlinePlacementGhost from './outline/OutlinePlacementGhost.vue'
import { useOutlinePlacement } from './outline/useOutlinePlacement.js'
import OutlineCardText from './outline/OutlineCardText.vue'
import { normalizeCanvasOpacity } from '../services/canvas-appearance.js'
import { computed, ref, reactive, watch, nextTick, onMounted, onBeforeUnmount, inject } from 'vue'
import { useWorkStore } from '../stores/work'
import { usePanZoom, arrowHeadDir } from '../services/graphview'
import { parseTokens, findByTitle, targetById, parseTarget, jumpTo, KIND_LABEL } from '../services/doublelinks'
import {
  relayoutAll, effSize, freeSpotFor,
  relColor, relDashed, cycleArrow, nextShape, SHAPE_LABEL,
  REL_KINDS, KIND_META, KIND_LABEL_DESIGN, tplThreeAct, tplChapterList, dashOf, EDGE_STYLES, EDGE_COLORS, edgeColor as modelEdgeColor,
  sideBetween, routeEdge, pointAtT, trimEdgeD, projectOnRoute, shapePorts, labelPoint
} from './outline/canvas-model'
import { CanvasRouteCache } from './outline/canvas-route-cache.js'
import { flattenRelations } from './outline/canvas-relations.js'
import {
  SCOPE_METRICS,
  buildLayerLayout,
  containerCardSize,
  descendantsOf,
  nodeStats,
  packLayer,
  projectRelations,
  scopeConnections,
  scopeCrumbs,
  scopePathIds,
  scopeStats
} from './outline/outline-scope.js'
import {
  CONTAINER_COLORS,
  PAPER_KINDS,
  STATUS,
  STATUS_COLORS,
  kindPaperStyle,
  paperStyle
} from './outline/outline-paper.js'
import { uid } from '../db/database'
import { useAiStore } from '../stores/ai'
import { useUiStore } from '../stores/ui'
import { NPopover, NSlider, NDropdown } from 'naive-ui'
import OIcon from './OIcon.vue'
import DLinkPicker from './DLinkPicker.vue'
import TaskLauncher from './ai/TaskLauncher.vue'
import OutlineNodeDrawer from './outline/OutlineNodeDrawer.vue'
import OutlineNodeDetail from './outline/OutlineNodeDetail.vue'
import Glyph from './outline/OutlineGlyph.vue'

import { OUTLINE_LAYOUT_KEY } from './outline/outline-layout.js'
const outlineWorkspace=inject(OUTLINE_LAYOUT_KEY,null)
const edgeColor=rel=>outlineWorkspace&&!rel.color?(rel.kind==='伏笔'?'#a2d8cd':'#d4d2e0'):modelEdgeColor(rel)
const detailTarget=computed(()=>outlineWorkspace?.detailTarget.value || null)
const work = useWorkStore()
const ai = useAiStore()
const ui = useUiStore()
/* 引力书舱用设计稿的放大卡片档位；原版沿用「详细 / 紧凑」原口径 */
const cardDensity = computed(() => work.canvasPrefs.density === 'compact' ? 'compact' : outlineWorkspace ? 'draft' : 'paper')
const canvasEl = ref(null)
const { zoom, tx, ty, innerStyle, onWheel, onPanStart, centerOn } = usePanZoom(canvasEl)
const dotsVisible = computed(() => work.canvasPrefs.showDots !== false)
const dotGridStyle = computed(() => {
  const base = 24 * zoom.value
  const spacing = base < 12 ? base * 2 : base > 48 ? base / 2 : base
  return {
    backgroundSize: `${spacing}px ${spacing}px`,
    backgroundPosition: `${tx.value % spacing - spacing / 2}px ${ty.value % spacing - spacing / 2}px`
  }
})

const dragPos = reactive(new Map()) // 拖动中的临时坐标（mouseup 统一落库）
const dragSize = reactive(new Map()) // 拖拽调整大小时的临时尺寸
const editText = ref(null) // { id, value } 模块内行内文本编辑
const inlineEl = ref(null)
const connecting = ref(null) // { fromId, x, y } 锚点拖线临时态
const edgeEdit = ref(null) // { ownerId, relId, mx, my } 边编辑浮层
const citePick = ref(null) // { nodeId } 引用卡目标选择浮层
const editTitle = ref(null) // { id, value } 容器标题原位编辑
const drawerId = ref(null)
const settingsOpen = ref(false)
const settingsTrigger = ref(null)
const settingsPanel = ref(null)
const settingsPosition = ref({})
function positionSettings() {
  const panel = settingsPanel.value
  const anchor = settingsTrigger.value?.getBoundingClientRect()
  if (!panel || !anchor) return
  const width = panel.offsetWidth
  const height = panel.offsetHeight
  const left = Math.max(12, Math.min(anchor.right - width, innerWidth - width - 12))
  const below = anchor.bottom + 8
  const above = anchor.top - height - 8
  const preferredTop = below + height <= innerHeight - 12 ? below : above
  const top = Math.max(12, Math.min(preferredTop, innerHeight - height - 12))
  settingsPosition.value = { left: left + 'px', top: top + 'px' }
}
function updateSettings(open) {
  if (open === settingsOpen.value) return
  settingsOpen.value = open
  if (open) searchOpen.value = false
  nextTick(() => {
    if (open) positionSettings()
    const target = open ? settingsPanel.value : settingsTrigger.value
    target?.focus({ preventScroll: true })
  })
}
function outlineCommand(e) {
  if (e.detail?.command === 'settings') updateSettings(!settingsOpen.value)
  else if (e.detail?.command === 'toggle-structure') outlineWorkspace?.toggle('left')
}
const draftTotals=computed(()=>scopeStats(live.value,scopeId.value))
function relsFor(n){return relationEntries.value.filter(e=>(e.owner?.id===n.id||e.rel.toId===n.id)&&nodeById(e.owner?.id===n.id?e.rel.toId:e.owner?.id)?.kind!=='anchor')}
function draftStatus(n){return ({done:'已完成',writing:'进行中',planned:'待展开',revise:'待修改'})[n.status]||'待展开'}
function chapterLabel(n){
  if(n.kind==='anchor')return chapterOf(n)?.title||n.title
  const anchor=relationEntries.value.filter(e=>e.owner?.id===n.id||e.rel.toId===n.id)
    .map(e=>nodeById(e.owner?.id===n.id?e.rel.toId:e.owner?.id)).find(other=>other?.kind==='anchor'&&chapterOf(other))
  const title=(anchor&&chapterOf(anchor)?.title)||n.chapter||''
  return /^(第\s*.+?章)/.exec(title)?.[1]||title
}
watch(drawerId,id=>{if(outlineWorkspace&&id){work.selOlnodeId=id;outlineWorkspace.open('right')}})
const viewMulti = ref(false)
const picked = reactive(new Set())
const searchQuery = ref('')
const searchOpen = ref(false)
const searchEl = ref(null)
function selectSearchResult(id) {
  if (outlineWorkspace) searchOpen.value = false
  revealNode(id)
}
const groupDetailsOpen = ref(false)
const flashIds = reactive(new Set())
const STATUS_LABEL = { draft: '草稿', done: '完成', revise: '待修改' }
const PALETTE = CONTAINER_COLORS.map(([color]) => color)
const AI_UNSET_HINT = '恍然梦未配置：请先在设置中完成恍然梦配置'

/* ---------- 基础几何 / 分层 ---------- */
const live = computed(() => work.liveOlnodes())
const nodeIndex = computed(() => new Map(live.value.map(n=>[n.id,n])))
const nodeById = (id) => nodeIndex.value.get(id)
const posOf = (n) => dragPos.get(n.id) || (n.canvasX != null ? { x: n.canvasX, y: n.canvasY } : null)
const sizeOf = (n) => dragSize.get(n.id) || effSize(n, cardDensity.value)
const kidsOf = (n) => live.value.filter((k) => k.parentId === n.id)

const scopeId = computed(() => {
  const id = work.canvasPrefs.scopeId
  if (!id) return null
  return live.value.some((n) => n.id === id && n.kind === 'container') ? id : null
})
const expandedSet = computed(() => new Set((work.canvasPrefs.expanded || []).filter((id) => live.value.some((n) => n.id === id && n.kind === 'container'))))
const layerLayout = computed(() => buildLayerLayout(live.value, scopeId.value, expandedSet.value, {
  sizeOf: (n) => dragSize.get(n.id),
  posOf: (n) => posOf(n)
}))
const visNodes = computed(() => layerLayout.value.layer)
const miniItems = computed(() => layerLayout.value.mini.items)
const miniById = computed(() => layerLayout.value.mini.byId)
const visibleIdSet = computed(() => layerLayout.value.visibleIds)
const containerSizes = computed(() => layerLayout.value.sizes)
/* 容器内容区滚动：只影响迷你卡的显示/连线几何，不改真实坐标。 */
const scrollOffsets = reactive(new Map())
const MINI_SCROLL_PAD = 6
const isExpanded = (id) => expandedSet.value.has(id)

const draggingId = ref(null)
function rectOf(n) {
  if (!n) return null
  const mini = miniById.value.get(n.id)
  if (mini) {
    const off = mini.clipId ? (scrollOffsets.get(mini.clipId) || 0) : 0
    return { ...mini.rect, y: mini.rect.y - off }
  }
  const p = posOf(n)
  if (!p) return null
  const size = n.kind === 'container'
    ? (containerSizes.value.get(n.id) || dragSize.get(n.id) || containerCardSize(live.value, n, expandedSet.value))
    : sizeOf(n)
  return { ...p, ...size }
}

/* ---------- 连线集合与关系链接卫星 ---------- */
const routeCache = new CanvasRouteCache()
const selectedEdgeKey = ref(null)
const flowMode = ref('idle') // idle / selected / create / adjust / reconnect
const routeDraft = ref(null)
const relationEntries = computed(() => flattenRelations(live.value))
const obstacleRects = computed(() => {
  const out = []
  for (const n of visNodes.value) {
    const r = rectOf(n)
    if (r) out.push({ ...r, id: n.id, shape: n.kind === 'event' ? n.shape : null })
  }
  for (const item of miniItems.value) {
    out.push({ ...(rectOf(item.node) || item.rect), id: item.node.id, shape: item.node.kind === 'event' ? item.node.shape : null, mini: true })
  }
  return out
})
const containerIds = computed(() => new Set([
  ...visNodes.value.filter(n => n.kind === 'container').map(n => n.id),
  ...miniItems.value.filter(i => i.node.kind === 'container').map(i => i.node.id)
]))
const portsOf = n => shapePorts(rectOf(n), n.kind === 'event' ? n.shape : null)
function insideContainer(nodeId, cid) {
  let cur = nodeById(nodeId)
  const seen = new Set()
  while (cur && !seen.has(cur.id)) {
    if (cur.id === cid) return true
    seen.add(cur.id);cur = cur.parentId ? nodeById(cur.parentId) : null
  }
  return false
}
function edgeObstacles(fromId, toId) {
  if(!containerIds.value.size) return obstacleRects.value
  return obstacleRects.value.filter(r => {
    return !containerIds.value.has(r.id) || !(insideContainer(fromId,r.id)||insideContainer(toId,r.id)) || r.id === fromId || r.id === toId
  })
}
function migrateSides() {
  for (const {owner:n,rel:r} of relationEntries.value) {
    if (r.fromJunction || r.toJunction || (r.fromSide && r.toSide)) continue
    const target = nodeById(r.toId), A = rectOf(n), B = target && rectOf(target)
    if (!A || !B) continue
    const sides = sideBetween(A,B)
    work.olnodeRelPatchAny(n.id,r.id,{fromSide:r.fromSide||sides.from,toSide:r.toSide||sides.to})
  }
}
function hostJunctionGeom(ref, visiting = new Set()) {
  const e = relationEntries.value.find(e => e.owner.id === ref.ownerId && e.rel.id === ref.relId)
  if (!e) return null
  const j = e.rel.junctions?.find(j => j.id === ref.junctionId)
  const host = edgeGeomFor(e.owner,e.rel,visiting)
  if (!host || host.status === 'blocked' || (!j && !Number.isFinite(ref.t))) return null
  const t = j?.t ?? ref.t
  const p0 = pointAtT(host,Math.max(0,t-.002)),p1 = pointAtT(host,Math.min(1,t+.002))
  const dx=p1.x-p0.x,dy=p1.y-p0.y
  return {point:pointAtT(host,t),side:Math.abs(dx)>=Math.abs(dy)?(dx>=0?'right':'left'):(dy>=0?'bottom':'top')}
}
function endpointGeom(endpoint, other, visiting = new Set()) {
  if (endpoint.nodeId) {
    const n=nodeById(endpoint.nodeId)
    if (!n || !posOf(n) || !visibleIdSet.value.has(n.id)) return null
    const r=rectOf(n),side=endpoint.side || sideBetween(r,{x:other?.x||0,y:other?.y||0,w:0,h:0}).from
    return {point:portsOf(n)[side],side,nodeId:n.id}
  }
  if (endpoint.point) return {point:endpoint.point,side:endpoint.side||'left'}
  return hostJunctionGeom(endpoint,visiting)
}
function occupiedChannels(key,a,b) {
  const left=Math.min(a.x,b.x)-100,right=Math.max(a.x,b.x)+100,top=Math.min(a.y,b.y)-100,bottom=Math.max(a.y,b.y)+100
  const out=[]
  for (const [id,entry] of routeCache.entries) {
    if (id === key || entry.g.status !== 'ok') continue
    const pts=entry.g.pts || [entry.g.a,entry.g.b]
    for(let i=1;i<pts.length;i++) {
      const u=pts[i-1],v=pts[i]
      if(Math.max(u.x,v.x)<left||Math.min(u.x,v.x)>right||Math.max(u.y,v.y)<top||Math.min(u.y,v.y)>bottom) continue
      out.push({a:u,b:v})
    }
    if(out.length>28) break
  }
  return out
}
function shiftPort(point, side, offset) {
  if (!offset) return point
  return side === 'left' || side === 'right'
    ? { x: point.x, y: point.y + offset }
    : { x: point.x + offset, y: point.y }
}
function geometryBetween(source,target,rel={},key='',visiting=new Set(),preview=false) {
  let dst=endpointGeom(target,null,visiting)
  if(!dst) return null
  let src=endpointGeom(source,dst.point,visiting)
  if(!src) return null
  if(target.nodeId && !target.side) dst=endpointGeom({...target,side:sideBetween({x:src.point.x,y:src.point.y,w:0,h:0},rectOf(nodeById(target.nodeId))).to},src.point,visiting)
  /* 同一对模块之间的多条关系平行错开，避免完全重叠。 */
  if (rel._parallel) {
    src = { ...src, point: shiftPort(src.point, src.side, rel._parallel) }
    dst = { ...dst, point: shiftPort(dst.point, dst.side, rel._parallel) }
  }
  const obs=edgeObstacles(src.nodeId,dst.nodeId)
  const routing=routeDraft.value?.key===key?routeDraft.value.routing:rel.routing
  const context={waypoints:routing?.waypoints,custom:routing?null:rel.custom}
  const signature=JSON.stringify([src.point,src.side,dst.point,dst.side,work.canvasPrefs.edgeStyle,context,source.nodeId,target.nodeId,rel.label,rel._parallel||0])
  const build=previous=>{
    const g=routeEdge(src.point,src.side,dst.point,dst.side,obs,work.canvasPrefs.edgeStyle,18,16,{...context,previous,occupiedSegments:occupiedChannels(key,src.point,dst.point)})
    // Legacy module -> junction paths stored t in the reverse direction.
    g.parameterReversed=!!rel.toJunction&&!rel.fromJunction
    g.source=source;g.target=target
    g.mid=labelPoint(g,obs,Math.max(60,Math.min(160,(rel.label||'').length*12+20)),26)
    return g
  }
  return preview?build(routeCache.entries.get(key)?.g):routeCache.get(key,signature,obs,build)
}
function edgeGeomFor(n,r,visiting=new Set()) {
  if(visiting.has(r.id)) return null
  const next=new Set(visiting);next.add(r.id)
  return geometryBetween(r.fromJunction||{nodeId:n.id,side:r.fromSide},r.toJunction||{nodeId:r.toId,side:r.toSide},r,r.id,next)
}
const scopedRelations = computed(() => projectRelations(relationEntries.value, live.value, scopeId.value, layerLayout.value))
const edges = computed(() => {
  const out=[],keys=new Set(),labels=[]
  const groups = scopedRelations.value.groups
  /* 同一对端点之间的多条关系（含不同关系类型）统一错开。 */
  const pairCounts = new Map(), pairUsed = new Map()
  for (const g of groups) {
    const k = `${g.from}>${g.to}`
    pairCounts.set(k, (pairCounts.get(k) || 0) + 1)
  }
  for (const group of groups) {
    const a = nodeById(group.from), b = nodeById(group.to)
    if (!a || !b) continue
    const pairKey = `${group.from}>${group.to}`
    const index = pairUsed.get(pairKey) || 0
    pairUsed.set(pairKey, index + 1)
    const parallel = (index - ((pairCounts.get(pairKey) || 1) - 1) / 2) * 18
    const only = group.relations.length === 1 ? group.relations[0] : null
    const rel = only ? only.rel : {
      id: group.key, toId: group.to, kind: group.kind, arrows: group.arrow,
      label: group.label, style: '', color: '', junctions: []
    }
    const sides = sideBetween(rectOf(a), rectOf(b))
    const fromSide = only && !group.projectedFrom && only.rel.fromSide ? only.rel.fromSide : sides.from
    const toSide = only && !group.projectedTo && only.rel.toSide ? only.rel.toSide : sides.to
    const source = { nodeId: group.from, side: fromSide }
    const target = { nodeId: group.to, side: toSide }
    const g = geometryBetween(source, target, { ...rel, _parallel: parallel }, group.key)
    if (!g) continue
    keys.add(group.key)
    const arrows = only ? (only.rel.arrows || '->') : group.arrow
    const trim = 7 * relArrowScale(rel) * Math.cos(.42) + relEdgeWidth(rel) * .4
    const displayLabel = group.relations.length > 1 ? `${group.kind} · ${group.relations.length}` : group.label
    const width = Math.max(52, Math.min(160, (displayLabel || '').length * 12 + 20))
    const mid = labelPoint(g, [...obstacleRects.value, ...labels], width, 22)
    if (displayLabel) labels.push({ x: mid.x - width / 2, y: mid.y - 28, w: width, h: 22 })
    const dashed = only ? dashOf(only.rel.style, only.rel.kind) : (relDashed(group.kind) ? '5 4' : null)
    out.push({
      key: group.key,
      ownerId: only ? only.owner.id : null,
      rel,
      group: !only,
      relations: group.relations,
      fromId: group.from,
      toId: group.to,
      projected: group.projected,
      projectedFrom: group.projectedFrom,
      projectedTo: group.projectedTo,
      arrow: arrows,
      label: displayLabel,
      ...g,
      mid,
      dTrim: trimEdgeD(g, arrows !== '--' ? trim : 0, arrows === '<->' ? trim : 0),
      color: only ? edgeColor(only.rel) : relColor(group.kind),
      dashed
    })
  }
  routeCache.prune(keys)
  return out
})
const selectedEdge = computed(() => edges.value.find(e=>e.key===selectedEdgeKey.value))
/* 箭头三角形：按 rel.arrows 在两端生成；单条连线可经 rel.edgeWidth / rel.arrowScale 覆盖画布全局设置 */
const relEdgeWidth = (rel) => rel?.edgeWidth || work.canvasPrefs.edgeWidth || 1.8
const relArrowScale = (rel) => rel?.arrowScale || work.canvasPrefs.arrowSize || 1
const edgeDecor = computed(() => {
  const heads = []
  const fills = []
  for (const e of edges.value) {
    const a = e.arrow || '->'
    const tip=e.b,dir=e.endDir,tail=e.a,tdir={x:-e.startDir.x,y:-e.startDir.y}
    if (a === '->' || a === '<->') {
      heads.push(arrowHeadDir(tip.x, tip.y, dir, 7 * relArrowScale(e.rel)))
      fills.push(e.color)
    }
    if (a === '<->') {
      heads.push(arrowHeadDir(tail.x, tail.y, tdir, 7 * relArrowScale(e.rel)))
      fills.push(e.color)
    }
  }
  return { heads, fills }
})

/* ---------- 层级条 / 抽屉 / 搜索 / 多选 / 关系组 ---------- */
const scopeMetaText = computed(() => {
  const s = scopeStatsData.value
  return `${s.total} 个事件${s.blocks ? ` · ${s.blocks} 个容器` : ''}${s.total ? ` · 已完成 ${s.done}/${s.total}` : ' · 尚无事件'}`
})
const drawerNode = computed(() => nodeById(outlineWorkspace ? work.selOlnodeId : drawerId.value) || null)
const drawerPath = computed(() => (drawerNode.value ? scopeCrumbs(live.value, drawerNode.value.parentId || null) : []))
const drawerStats = computed(() => (drawerNode.value ? nodeStats(live.value, drawerNode.value.id) : { total: 0, done: 0, blocks: 0, depth: 0, complete: false }))
const drawerParent = computed(() => {
  const p = drawerNode.value?.parentId
  return p ? nodeById(p) : null
})
const drawerConnections = computed(() => {
  const n = drawerNode.value
  if (!n) return []
  if (n.kind === 'container') {
    return scopeConnections(relationEntries.value, live.value, n.id).map((c) => ({
      id: c.id,
      direction: c.direction,
      kind: c.rel.kind || '关联',
      label: c.rel.label || '',
      otherId: c.otherId,
      otherTitle: c.other ? labelOf(c.other) : '（未命名）',
      otherPath: scopeCrumbs(live.value, c.other?.parentId || null).map((x) => x.title).join(' / ')
    }))
  }
  const out = []
  const seen = new Set()
  for (const { owner, rel } of relationEntries.value) {
    const from = rel.fromJunction?.ownerId || owner?.id
    const to = rel.toJunction?.ownerId || rel.toId
    if (from !== n.id && to !== n.id) continue
    const otherId = from === n.id ? to : from
    const key = `${rel.id}:${otherId}`
    if (!otherId || seen.has(key)) continue
    seen.add(key)
    const other = nodeById(otherId)
    if (!other) continue
    out.push({
      id: rel.id,
      direction: from === n.id ? 'out' : 'in',
      kind: rel.kind || '关联',
      label: rel.label || '',
      otherId,
      otherTitle: labelOf(other),
      otherPath: scopeCrumbs(live.value, other.parentId || null).map((x) => x.title).join(' / ')
    })
  }
  return out
})
const searchResults = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  if (!q) return []
  return live.value
    .filter((n) => n.id !== scopeId.value)
    .map((n) => ({ n, text: `${n.title || ''}\n${n.text || ''}`.toLowerCase() }))
    .filter((x) => x.text.includes(q))
    .sort((a, b) => (a.n.title || '').toLowerCase().indexOf(q) - (b.n.title || '').toLowerCase().indexOf(q))
    .slice(0, 8)
    .map(({ n }) => ({
      node: n,
      path: scopeCrumbs(live.value, n.parentId || null).map((x) => x.title).join(' / '),
      kind: KIND_LABEL_DESIGN[n.kind] || '模块'
    }))
})
const multiCount = computed(() => picked.size)
function toggleMulti() {
  placement.cancel()
  viewMulti.value = !viewMulti.value
  if (viewMulti.value) {
    drawerId.value = null
    selectedEdgeKey.value = null
    closeFloaters()
  } else picked.clear()
}
function togglePick(id) {
  if (!visNodes.value.some((n) => n.id === id)) return
  if (picked.has(id)) picked.delete(id)
  else picked.add(id)
}
const wrapOpen = ref(false)
const wrapTitle = ref('')
const wrapSummary = ref('')
function openWrap() {
  if (picked.size < 2) return
  wrapTitle.value = ''
  wrapSummary.value = ''
  wrapOpen.value = true
}
function confirmWrap() {
  const title = wrapTitle.value.trim()
  if (!title) return
  const row = work.olnodeWrap([...picked], {
    title,
    summary: wrapSummary.value,
    color: CONTAINER_COLORS[0][0]
  })
  if (!row) {
    window.$msg?.warning('请选择同一层的至少两个模块，并填写容器名称')
    return
  }
  picked.clear()
  viewMulti.value = false
  wrapOpen.value = false
  work.selOlnodeId = row.id
  drawerId.value = row.id
  nextTick(() => {
    const r = rectOf(row)
    if (r) centerOn(r.x + r.w / 2, r.y + r.h / 2)
    flashIds.add(row.id)
    setTimeout(() => flashIds.delete(row.id), 1600)
  })
  window.$msg?.success('已用容器封装，全部关系保留')
}
const anchorMenuOptions = computed(() => {
  const out = [{ label: '新建空白锚点', key: 'anchor' }]
  if (work.liveChapters?.length) {
    out.push({ type: 'divider', key: 'anchor-divider' })
    out.push(...work.liveChapters.slice(0, 40).map((c) => ({ label: c.title || '未命名章节', key: `chapter:${c.id}` })))
  }
  return out
})
const volumeMenuOptions = computed(() => {
  const out = [{ label: '新建空白卷锚点', key: 'volume' }]
  if (work.liveVolumes?.length) {
    out.push({ type: 'divider', key: 'volume-divider' })
    out.push(...work.liveVolumes.map((v) => ({ label: v.title || '未命名卷', key: `volume:${v.id}` })))
  }
  return out
})
function onModuleSelect(kind, key) {
  if (kind === key) return startPlacement(kind)
  const prefix = kind === 'anchor' ? 'chapter:' : 'volume:'
  const entries = kind === 'anchor' ? work.liveChapters : work.liveVolumes
  const target = key.startsWith(prefix) && entries.find(row => row.id === key.slice(prefix.length))
  if (target) startPlacement(kind, { refId: target.id, title: target.title || '' })
}
const canvasOpacity = computed(() => normalizeCanvasOpacity(work.canvasPrefs.canvasOpacity))
const canvasOpacityModel = computed({
  get: () => canvasOpacity.value,
  set: (v) => setPref('canvasOpacity', normalizeCanvasOpacity(v))
})
function statusLabel(n) {
  return n?.status ? STATUS[n.status] || '未标记' : '未标记'
}
function statusColor(n) {
  return STATUS_COLORS[n?.status] || '#b8bfa9'
}
function nodeIndexLabel(n) {
  const i = Math.floor((n?.sortOrder || 0) / 1000) + 1
  return String(Math.max(1, i)).padStart(2, '0')
}
function paperFor(n) {
  if (!n) return null
  if (n.kind === 'event') return paperStyle(n.shape)
  if (PAPER_KINDS[n.kind]) return kindPaperStyle(n.kind)
  return null
}
function paperClass(n) {
  if (n?.kind === 'event') return `oc-paper-event sh-${n.shape || 'process'}`
  return n ? `oc-paper-${n.kind}` : ''
}
/* 紧凑卡片（原版 54–76px）容不下类型行与状态脚注，只保留原来的标题/摘要；
 * 工作室的 roomy 卡与用户主动拉高的卡才显示完整纸面排版。 */
function showCardChrome(n) {
  if (!n) return false
  if (cardDensity.value === 'roomy' || cardDensity.value === 'paper') return (rectOf(n)?.h || 0) >= 92
  return (rectOf(n)?.h || 0) >= 92
}
function containerSummary(n) {
  const first = String(n.text || '').split('\n').find((x) => x.trim())
  if (first) return first.trim()
  const s = nodeStats(live.value, n.id)
  if (s.total) return `${s.total} 个事件 · 已完成 ${s.done}/${s.total}`
  const inside = descendantsOf(live.value, n.id).length
  return inside ? `已收纳 ${inside} 个模块` : '还没有内容，进入后继续添加'
}
function containerProgress(n) {
  const s = nodeStats(live.value, n.id)
  return { ...s, pct: s.total ? Math.round((s.done / s.total) * 100) : 0 }
}
/* 顶层展开容器的内容区：迷你卡在这里滚动，连线几何随 scrollOffsets 一起位移。 */
const miniGroups = computed(() => {
  const groups = new Map()
  for (const item of miniItems.value) {
    const clipId = item.clipId
    if (!clipId) continue
    if (!groups.has(clipId)) {
      const cardNode = nodeById(clipId)
      const card = cardNode ? rectOf(cardNode) : null
      if (!card) continue
      const top = SCOPE_METRICS.headH + SCOPE_METRICS.progressH + SCOPE_METRICS.padY
      const bottom = SCOPE_METRICS.footH + SCOPE_METRICS.padY
      groups.set(clipId, {
        id: clipId,
        rect: {
          x: card.x + SCOPE_METRICS.miniPad,
          y: card.y + top,
          w: Math.max(80, card.w - SCOPE_METRICS.miniPad * 2),
          h: Math.max(0, card.h - top - bottom)
        },
        items: []
      })
    }
    groups.get(clipId).items.push(item)
  }
  const out = []
  for (const group of groups.values()) {
    const bottom = group.items.reduce((m, item) => Math.max(m, item.rect.y + item.rect.h - group.rect.y), 0)
    group.contentH = Math.max(group.rect.h, bottom)
    out.push(group)
  }
  return out
})
function miniScrollStyle(group) {
  return {
    left: (group.rect.x - MINI_SCROLL_PAD) + 'px',
    top: group.rect.y + 'px',
    width: (group.rect.w + MINI_SCROLL_PAD * 2) + 'px',
    height: group.rect.h + 'px'
  }
}
function onMiniScroll(id, e) {
  scrollOffsets.set(id, e.target.scrollTop)
}
const miniScrollEls = new Map()
function setMiniScrollEl(id, el) {
  if (el) {
    miniScrollEls.set(id, el)
    scrollOffsets.set(id, el.scrollTop || 0)
  } else {
    miniScrollEls.delete(id)
    scrollOffsets.delete(id)
  }
}
function ensureMiniVisible(id) {
  const item = miniById.value.get(id)
  if (!item?.clipId) return
  const group = miniGroups.value.find((g) => g.id === item.clipId)
  const el = group && miniScrollEls.get(group.id)
  if (!group || !el) return
  const top = item.rect.y - group.rect.y
  const bottom = top + item.rect.h
  let next = el.scrollTop
  if (top < next) next = top
  else if (bottom > next + group.rect.h) next = bottom - group.rect.h
  next = Math.max(0, next)
  if (next !== el.scrollTop) {
    el.scrollTop = next
    scrollOffsets.set(group.id, next)
  }
}
function miniStyle(item, group) {
  return {
    left: (item.rect.x - group.rect.x + MINI_SCROLL_PAD) + 'px',
    top: (item.rect.y - group.rect.y) + 'px',
    width: item.rect.w + 'px',
    height: item.rect.h + 'px',
    zIndex: 2 + item.depth,
    ...(item.node.kind === 'container' ? { '--bc': item.node.color || CONTAINER_COLORS[0][0] } : {})
  }
}
function selectMini(n) {
  work.selOlnodeId = n.id
  selectedEdgeKey.value = null
  drawerId.value = null
}
function onMiniDbl(item) {
  if (item.node.kind === 'container') drawerId.value = item.node.id
  else startInlineEdit(item.node)
}

/* ---------- 容器内迷你卡拖动（v1.1.8）：容器内重排 / 拖出回当前层 / 拖入其它容器 ----------
 * 迷你卡位于滚动内容区里，拖影挂到画布内层，拖出容器时不会被内容区裁剪。 */
const miniDrag = ref(null)
function miniDropTarget(node, pt) {
  const desc = new Set(work.olnodeDescendants(node.id).map((d) => d.id))
  let best = null
  for (const id of containerIds.value) {
    if (id === node.id || desc.has(id)) continue
    const c = nodeById(id)
    const r = c ? rectOf(c) : null
    if (!r) continue
    if (pt.x < r.x || pt.x > r.x + r.w || pt.y < r.y || pt.y > r.y + r.h) continue
    const area = r.w * r.h
    if (!best || area < best.area) best = { id, area }
  }
  return best
}
function miniLayerRects(excludeId) {
  const out = []
  for (const n of visNodes.value) if (n.id !== excludeId) { const r = rectOf(n); if (r) out.push(r) }
  for (const it of miniItems.value) if (it.node.id !== excludeId) { const r = rectOf(it.node); if (r) out.push(r) }
  return out
}
/* 落点坐标：回到当前层时按鼠标落点放置；移入其它容器时按该容器既有子模块范围追加。 */
function miniPlacement(node, targetParentId, dropPoint) {
  const size = effSize(node, cardDensity.value)
  if ((targetParentId || null) === scopeId.value && dropPoint) {
    /* 拖出容器时以落点为中心放置（只做真实重叠避让，不做大间距平移——
     * 旧口径 24px 余量会把卡片推离鼠标几百像素）。 */
    const start = { x: snap(dropPoint.x - size.w / 2), y: snap(dropPoint.y - size.h / 2) }
    const occupied = miniLayerRects(node.id)
    const clash = occupied.some((r) => start.x < r.x + r.w && start.x + size.w > r.x && start.y < r.y + r.h && start.y + size.h > r.y)
    const spot = clash ? freeSpotFor(occupied, size, start.x, start.y) : start
    return { x: Math.round(spot.x), y: Math.round(spot.y) }
  }
  const kids = work.olnodeChildren(targetParentId).filter((k) => k.id !== node.id)
  const rects = kids.map((k) => ({ x: Number(k.canvasX) || 0, y: Number(k.canvasY) || 0, ...effSize(k, cardDensity.value) }))
  const startX = rects.length ? Math.min(...rects.map((r) => r.x)) : 40
  const startY = rects.length ? Math.max(...rects.map((r) => r.y + r.h)) + 40 : 40
  const spot = freeSpotFor(rects, size, startX, startY)
  return { x: Math.round(spot.x), y: Math.round(spot.y) }
}
/* 容器内重排：按落点命中最近的兄弟卡，插到它前面（第一位则用 beforeId）。 */
function reorderMini(node, parentId, dropPoint) {
  const sibs = work.olnodeChildren(parentId)
    .filter((s) => s.id !== node.id)
    .map((s) => ({ s, r: rectOf(s) }))
    .filter((x) => x.r)
    .sort((a, b) => a.r.y - b.r.y || a.r.x - b.r.x)
  if (!sibs.length) return
  let anchor = null
  for (const it of sibs) {
    if (dropPoint.y < it.r.y) break
    if (dropPoint.y > it.r.y + it.r.h) { anchor = it.s.id; continue }
    if (dropPoint.x > it.r.x + it.r.w / 2) anchor = it.s.id
    break
  }
  if (anchor) work.olnodeMoveTo(node.id, parentId, anchor)
  else work.olnodeMoveTo(node.id, parentId, null, sibs[0].s.id)
}
function moveMiniTo(node, targetParentId, dropPoint) {
  const from = node.parentId || null
  const to = targetParentId || null
  if (to === from) {
    /* 同一容器内的自由落点不改变父级，仅按落点重排。 */
    if (dropPoint) { const p = miniPlacement(node, to, dropPoint); if (p) work.olnodeSetCanvas(node.id, p.x, p.y) }
    return
  }
  if (!work.olnodeMoveTo(node.id, to)) return
  const p = miniPlacement(node, to, dropPoint)
  if (p) work.olnodeSetCanvas(node.id, p.x, p.y)
  work.selOlnodeId = node.id
  if (to) {
    flashIds.add(to)
    setTimeout(() => flashIds.delete(to), 1600)
    window.$msg?.success(`已归入「${labelOf(nodeById(to))}」`)
  } else {
    window.$msg?.success('已移出容器')
  }
}
function applyMiniDrop(node, item, drop) {
  const parentId = node.parentId || null
  const hit = miniDropTarget(node, drop)
  if (hit) {
    if (hit.id === parentId) reorderMini(node, parentId, drop)
    else moveMiniTo(node, hit.id, null)
    return
  }
  const clip = item.clipId && nodeById(item.clipId)
  const clipRect = clip ? rectOf(clip) : null
  const insideClip = clipRect && drop.x >= clipRect.x && drop.x <= clipRect.x + clipRect.w && drop.y >= clipRect.y && drop.y <= clipRect.y + clipRect.h
  if (parentId && !insideClip) {
    /* 拖出整块展开容器 → 回到当前层（落点即新位置）。 */
    moveMiniTo(node, scopeId.value, drop)
    return
  }
  if (parentId && clip && parentId !== clip.id) {
    /* 拖出嵌套迷你容器、但仍在外层容器内 → 上移一层。 */
    moveMiniTo(node, nodeById(parentId)?.parentId || scopeId.value, null)
    return
  }
  reorderMini(node, parentId, drop)
}
function onMiniDown(e, item) {
  if (e.button !== 0) return
  /* 多选模式下点击用于勾选，不启动拖动。 */
  if (viewMulti.value) return
  /* 按钮/输入框/拖线锚点走各自交互，不启动拖动。 */
  if (e.target.closest?.('button, input, textarea, a, .oc-apt')) return
  const n = item.node
  const r = rectOf(n)
  if (!r) return
  e.stopPropagation()
  e.preventDefault()
  work.selOlnodeId = n.id
  selectedEdgeKey.value = null
  drawerId.value = null
  const start = { mx: e.clientX, my: e.clientY }
  miniDrag.value = { id: n.id, node: n, w: r.w, h: r.h, ghostX: r.x, ghostY: r.y, moved: false, targetId: null }
  const state = miniDrag.value
  pointerGesture(e, (ev) => {
    state.ghostX = r.x + (ev.clientX - start.mx) / zoom.value
    state.ghostY = r.y + (ev.clientY - start.my) / zoom.value
    state.moved = true
    const hit = miniDropTarget(n, { x: state.ghostX + r.w / 2, y: state.ghostY + r.h / 2 })
    state.targetId = hit?.id || null
  }, (ev, moved) => {
    const drop = { x: state.ghostX + r.w / 2, y: state.ghostY + r.h / 2 }
    miniDrag.value = null
    /* 松手在画布外（侧栏/工具栏）视为取消，避免模块落到视口外的坐标。 */
    const box = canvasEl.value?.getBoundingClientRect()
    const outside = box && (ev.clientX < box.left || ev.clientX > box.right || ev.clientY < box.top || ev.clientY > box.bottom)
    if (moved && !outside) applyMiniDrop(n, item, drop)
  }, () => { miniDrag.value = null })
}
function patchGroup(field, value) {
  const edge = selectedEdge.value
  if (!edge?.group) return
  work.olnodePushUndo(true)
  for (const { owner, rel } of edge.relations) work.olnodeRelPatchAny(owner.id, rel.id, { [field]: value })
  nextTick(() => {
    const first = edge.relations[0]?.rel.id
    const group = edges.value.find((e) => e.relations?.some((r) => r.rel.id === first))
    selectedEdgeKey.value = group?.key || null
  })
}
function revealRelationEndpoint(id) {
  groupDetailsOpen.value = false
  revealNode(id)
}
function editDrawerNode(patch, nodeId = drawerNode.value?.id) {
  const n = nodeById(nodeId)
  if (!n || n.deletedAt) return
  work.olnodePushUndo()
  if (patch.title != null) work.olnodeSetTitle(n.id, patch.title)
  if (patch.body != null) work.olnodeSetRich(n.id, patch.body, null)
  if (patch.chapter != null) work.olnodeSetChapter(n.id, patch.chapter)
  if (patch.shape != null) work.olnodeSetShape(n.id, patch.shape)
  if (patch.status != null) work.olnodeSetStatus(n.id, patch.status)
  if (patch.color != null) work.olnodeSetColor(n.id, patch.color)
}
const onDrawerTitle = (v) => editDrawerNode({ title: v })
const onDrawerBody = (v) => editDrawerNode({ body: v })
function onDetailEdit(change) {
  if (change.field === 'title' || change.field === 'body') editDrawerNode({[change.field]:change.value}, change.id)
}
const onDrawerChapter = (v) => editDrawerNode({ chapter: v })
const onDrawerShape = (v) => editDrawerNode({ shape: v })
const onDrawerStatus = (v) => editDrawerNode({ status: v })
const onDrawerColor = (v) => editDrawerNode({ color: v })
function onDrawerEnter() {
  const n = drawerNode.value
  if (n?.kind === 'container') focusScope(n.id, { animate: true })
}
function onDrawerToggle() {
  if (drawerNode.value?.kind === 'container') toggleInline(drawerNode.value.id)
}
function onDrawerMoveOut() {
  const n = drawerNode.value
  if (!n || !n.parentId) return
  const parent = nodeById(n.parentId)
  work.olnodeMoveTo(n.id, null)
  revealNode(n.id, { openDrawer: true })
  window.$msg?.success(`已移出「${parent?.title || '容器'}」`)
}
function onDrawerRemove() {
  if (drawerNode.value) onRemove(drawerNode.value)
}
function onDrawerInlineEdit() {
  if (drawerNode.value) startInlineEdit(drawerNode.value)
}
const sats = computed(() => {
  const out = []
  for (const n of visNodes.value) {
    if (!['event', 'note', 'anchor', 'container', 'textbox'].includes(n.kind)) continue
    const p = posOf(n)
    const s = sizeOf(n)
    parseTokens(n.text || '').forEach((t, i) => {
      out.push({
        key: n.id + ':' + t.start,
        x: p.x + 2,
        y: p.y + s.h + 6 + i * 26,
        display: t.display || t.title,
        title: t.title,
        resolved: findByTitle(t.title)
      })
    })
  }
  return out
})
const bounds = computed(() => {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  const eat = (r) => {
    if (!r) return
    x0 = Math.min(x0, r.x)
    y0 = Math.min(y0, r.y)
    x1 = Math.max(x1, r.x + r.w)
    y1 = Math.max(y1, r.y + r.h)
  }
  for (const n of visNodes.value) eat(rectOf(n))
  for (const item of miniItems.value) eat(rectOf(item.node) || item.rect)
  for (const s of sats.value) eat({ x: s.x, y: s.y, w: 150, h: 22 })
  if (x0 === Infinity) return { x: 0, y: 0, w: 600, h: 400 }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
})
/* 连线层视口：模块可拖到原点左侧/上方（负坐标），包围盒向左/上收缩时
 * 若视口仍从 (0,0) 起算会裁掉连线——改为覆盖负象限并四周留余量 */
const svgBox = computed(() => {
  const b = bounds.value
  const x0 = Math.min(0, b.x - 400)
  const y0 = Math.min(0, b.y - 400)
  const x1 = Math.max(2400, b.x + b.w + 400)
  const y1 = Math.max(1600, b.y + b.h + 400)
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
})

/* ---------- 落位 / 视图 ---------- */
function applyPositions(map) {
  for (const [id, p] of map) work.olnodeSetCanvas(id, p.x, p.y)
}
function ensurePlaced() {
  applyPositions(relayoutAll({ nodes: live.value, density: cardDensity.value, force: false }))
}
/* 分层相机：按当前层包围盒适配；首屏给 74% 可读下限，过宽时靠左展示开头。 */
function fitLayer(readable = false) {
  const el = canvasEl.value
  if (!el) return
  const b = bounds.value
  const vw = el.clientWidth
  const vh = el.clientHeight
  if (!vw || !vh) return
  const cap = readable && vw < 760 ? 1.0 : 1.06
  const padX = 48
  const padTop = 44
  const padBottom = 58
  const fit = Math.min(cap, (vw - padX * 2) / Math.max(b.w, 1), (vh - padTop - padBottom) / Math.max(b.h, 1))
  let z = Math.min(cap, Math.max(readable ? 0.74 : 0.3, fit))
  z = Math.max(0.3, Math.min(2.2, z))
  zoom.value = z
  const contentW = b.w * z
  const contentH = b.h * z
  tx.value = contentW <= vw - padX * 2 ? (vw - contentW) / 2 - b.x * z : padX - b.x * z
  ty.value = contentH <= vh - padTop - padBottom ? (vh - contentH) / 2 - b.y * z : padTop - b.y * z
}
function fitView() {
  fitLayer(false)
}
function tidyAll() {
  const width = Math.max(900, (canvasEl.value?.clientWidth || 1200) / Math.max(0.6, zoom.value) - 80)
  const packed = packLayer(live.value, scopeId.value, (n) => (
    n.kind === 'container' ? containerCardSize(live.value, n, expandedSet.value) : effSize(n, cardDensity.value)
  ), { maxWidth: width })
  if (!packed.positions.size) return
  work.olnodePushUndo(true)
  applyPositions(packed.positions)
  dragPos.clear()
  nextTick(() => fitView())
}
defineExpose({ tidyAll })
function setPref(k, v) {
  work.canvasPrefs[k] = v
  work.saveCanvasPrefs()
}
const edgeWidthModel = computed({
  get: () => work.canvasPrefs.edgeWidth || 1.8,
  set: (v) => setPref('edgeWidth', v)
})
const arrowSizeModel = computed({
  get: () => work.canvasPrefs.arrowSize || 1,
  set: (v) => setPref('arrowSize', v)
})
function snap(v) {
  return work.canvasPrefs.snap ? Math.round(v / 16) * 16 : Math.round(v)
}
function canvasPt(e) {
  const r = canvasEl.value.getBoundingClientRect()
  return { x: (e.clientX - r.left - tx.value) / zoom.value, y: (e.clientY - r.top - ty.value) / zoom.value }
}
function hitConnTarget(pt, exclude = new Set()) {
  // 拖线目标优先命中子模块（事件/便签/引用卡/锚点/卷），其次无子模块的容器；迷你卡也是可连接目标。
  const nodes = [...visNodes.value, ...miniItems.value.map((i) => i.node)].reverse()
  for (const n of nodes) {
    if (exclude.has(n.id) || n.kind === 'container') continue
    const r = rectOf(n)
    if (r && pt.x >= r.x && pt.x <= r.x + r.w && pt.y >= r.y && pt.y <= r.y + r.h) return n
  }
  for (const n of nodes) {
    if (exclude.has(n.id)) continue
    const r = rectOf(n)
    if (r && pt.x >= r.x && pt.x <= r.x + r.w && pt.y >= r.y && pt.y <= r.y + r.h) return n
  }
  return null
}

/* ---------- 层级导航 / 相机 / 就地展开 ---------- */
const scopeCrumbsList = computed(() => scopeCrumbs(live.value, scopeId.value))
const scopeStatsData = computed(() => scopeStats(live.value, scopeId.value))
const scopeTitle = computed(() => (scopeId.value ? (nodeById(scopeId.value)?.title || '容器') : '全书情节'))
const scopeParent = computed(() => (scopeId.value ? (nodeById(scopeId.value)?.parentId || null) : null))
const scopeColor = computed(() => {
  const n = scopeId.value ? nodeById(scopeId.value) : null
  return n?.color || '#6e8c79'
})
const scopeKey = (id) => id || 'root'

function saveCamera(id = scopeId.value) {
  if (!work.canvasPrefs.cameras) work.canvasPrefs.cameras = {}
  work.canvasPrefs.cameras[scopeKey(id)] = { zoom: zoom.value, tx: tx.value, ty: ty.value }
  work.saveCanvasPrefs()
}
function restoreCamera(id) {
  const c = work.canvasPrefs.cameras?.[scopeKey(id)]
  if (!c || !Number.isFinite(c.zoom)) return false
  zoom.value = Math.max(0.3, Math.min(2.2, c.zoom))
  tx.value = Number(c.tx) || 0
  ty.value = Number(c.ty) || 0
  return true
}

function animateScope(direction, fromRect, color) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return
  const stage = canvasEl.value
  if (!stage) return
  const b = stage.getBoundingClientRect()
  const r = fromRect || { x: b.x + b.width * .3, y: b.y + b.height * .28, width: b.width * .4, height: b.height * .4 }
  const portal = document.createElement('div')
  portal.className = 'oc-scope-portal'
  portal.setAttribute('aria-hidden', 'true')
  portal.style.cssText = `left:${r.x}px;top:${r.y}px;width:${r.width}px;height:${r.height}px;--portal-color:${color || '#6e8c79'}`
  document.body.append(portal)
  const target = { x: b.x + 6, y: b.y + 6, width: b.width - 12, height: b.height - 12 }
  const transform = `translate(${target.x - r.x}px,${target.y - r.y}px) scale(${target.width / Math.max(r.width, 1)},${target.height / Math.max(r.height, 1)})`
  const frames = direction === 'return'
    ? [{ transform, opacity: .55 }, { transform: 'none', opacity: 0 }]
    : [{ transform: 'none', opacity: .82 }, { transform, opacity: .42, offset: .72 }, { transform, opacity: 0 }]
  const anim = portal.animate(frames, { duration: direction === 'return' ? 300 : 420, easing: 'cubic-bezier(.2,.75,.2,1)', fill: 'both' })
  anim.finished.finally(() => portal.remove())
}

function focusScope(id, { animate = true, restore = true } = {}) {
  const target = id || null
  if (target && !live.value.some((n) => n.id === target && n.kind === 'container')) return
  if (target === scopeId.value) return
  const sourceEl = target ? canvasEl.value?.querySelector(`[data-node-id="${target}"]`) : null
  const sourceRect = sourceEl?.getBoundingClientRect()
  const direction = target && scopePathIds(live.value, target).length > scopePathIds(live.value, scopeId.value).length ? 'enter' : 'return'
  saveCamera(scopeId.value)
  work.canvasPrefs.scopeId = target
  work.saveCanvasPrefs()
  work.selOlnodeId = null
  selectedEdgeKey.value = null
  flowMode.value = 'idle'
  viewMulti.value = false
  picked.clear()
  drawerId.value = null
  closeFloaters()
  nextTick(() => {
    const restored = restore ? restoreCamera(target) : false
    if (!restored) fitLayer(true)
    if (animate) animateScope(direction, sourceRect, scopeColor.value)
  })
}

function goBack() {
  focusScope(scopeParent.value, { animate: true })
}

function revealNode(id, { openDrawer = false } = {}) {
  const n = nodeById(id)
  if (!n) return
  const parent = n.parentId || null
  if (parent !== scopeId.value) {
    focusScope(parent, { animate: false })
  }
  nextTick(() => requestAnimationFrame(() => {
    if (!nodeById(id)) return
    work.selOlnodeId = id
    if (openDrawer) drawerId.value = id
    ensureMiniVisible(id)
    const r = rectOf(n)
    if (r) centerOn(r.x + r.w / 2, r.y + r.h / 2)
    flashIds.add(id)
    setTimeout(() => flashIds.delete(id), 1600)
  }))
}

function setExpanded(id, open) {
  const list = Array.isArray(work.canvasPrefs.expanded) ? work.canvasPrefs.expanded : []
  const set = new Set(list.filter((x) => x !== id))
  if (open) set.add(id)
  work.canvasPrefs.expanded = [...set]
  work.saveCanvasPrefs()
}

function topLevelAncestor(id) {
  let cur = nodeById(id)
  const seen = new Set()
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id)
    if ((cur.parentId || null) === scopeId.value) return cur.id
    cur = cur.parentId ? nodeById(cur.parentId) : null
  }
  return null
}

function collisionShift(anchorId, before, after) {
  const delta = after.h - before.h
  if (delta <= 0) return []
  const moved = []
  const left = Math.min(before.x, after.x)
  const right = Math.max(before.x + before.w, after.x + after.w)
  for (const sib of visNodes.value) {
    if (sib.id === anchorId) continue
    const r = rectOf(sib)
    if (!r) continue
    const overlapsX = r.x < right + 10 && left < r.x + r.w + 10
    if (!overlapsX) continue
    if (r.y < before.y + before.h - 8) continue
    moved.push(sib.id)
  }
  if (!moved.length) return []
  work.olnodePushUndo(true)
  for (const id of moved) {
    const n = nodeById(id)
    if (n) work.olnodeSetCanvas(id, n.canvasX ?? 0, (n.canvasY ?? 0) + delta)
  }
  nextTick(() => {
    for (const id of moved) {
      canvasEl.value?.querySelector(`[data-node-id="${id}"]`)?.animate(
        [{ transform: `translateY(${-delta}px)` }, { transform: 'none' }],
        { duration: 220, easing: 'cubic-bezier(.2,.7,.2,1)' }
      )
    }
  })
  return moved
}

function toggleInline(id) {
  const n = nodeById(id)
  if (!n || n.kind !== 'container') return
  const anchorId = topLevelAncestor(id) || id
  const anchor = nodeById(anchorId)
  const before = anchor ? { ...posOf(anchor), ...containerCardSize(live.value, anchor, expandedSet.value) } : null
  setExpanded(id, !isExpanded(id))
  nextTick(() => {
    const after = anchor ? { ...posOf(anchor), ...containerCardSize(live.value, anchor, expandedSet.value) } : null
    if (before && after) collisionShift(anchorId, before, after)
    nextTick(() => fitIfTinyDelta(after, before))
  })
}
function fitIfTinyDelta(after, before) {
  if (!after || !before) return
  /* 展开不主动改变相机；只有内容已超出视口下沿时才轻微下移，保持上下文。 */
  const el = canvasEl.value
  if (!el) return
  const bottom = ty.value + (after.y + after.h) * zoom.value
  if (bottom > el.clientHeight - 24 && before.h < after.h) {
    ty.value -= Math.min(160, (bottom - el.clientHeight + 40)) * .42
  }
}

function scopeSubtreeNodes() {
  return scopeId.value ? descendantsOf(live.value, scopeId.value) : live.value.slice()
}
function expandAllDeep() {
  const ids = scopeSubtreeNodes().filter((n) => n.kind === 'container' && kidsOf(n).length).map((n) => n.id)
  if (!ids.length) return
  const list = new Set(work.canvasPrefs.expanded || [])
  for (const id of ids) list.add(id)
  work.canvasPrefs.expanded = [...list]
  work.saveCanvasPrefs()
  nextTick(() => fitLayer(false))
}
function collapseAllDeep() {
  const ids = new Set(scopeSubtreeNodes().filter((n) => n.kind === 'container').map((n) => n.id))
  if (!ids.size) return
  const list = new Set(work.canvasPrefs.expanded || [])
  for (const id of ids) list.delete(id)
  work.canvasPrefs.expanded = [...list]
  work.saveCanvasPrefs()
  nextTick(() => fitLayer(false))
}
function overview() {
  const list = new Set(work.canvasPrefs.expanded || [])
  for (const n of visNodes.value) if (n.kind === 'container') list.delete(n.id)
  work.canvasPrefs.expanded = [...list]
  work.saveCanvasPrefs()
  nextTick(() => fitLayer(false))
}

/* ---------- 节点拖动（容器连带后代；落点几何归组） ---------- */
function onNodeDown(e, n) {
  if (e.button !== 0) return
  if (e.target.closest('button, input, textarea, a, .oc-apt, .oc-mini, .oc-rs')) return
  if (viewMulti.value) {
    e.stopPropagation()
    if ((n.parentId || null) === scopeId.value) togglePick(n.id)
    return
  }
  e.stopPropagation()
  selectedEdgeKey.value=null;flowMode.value='idle'
  work.selOlnodeId = n.id
  closeFloaters()
  const group = n.kind === 'container' ? [n, ...work.olnodeDescendants(n.id)] : [n]
  draggingId.value = n.id
  const start = { mx: e.clientX, my: e.clientY, origins: group.map(g => ({ id: g.id, x: g.canvasX ?? 0, y: g.canvasY ?? 0 })) }
  const finish=()=>{dragPos.clear();draggingId.value=null}
  pointerGesture(e,ev=>{
    const dx=(ev.clientX-start.mx)/zoom.value,dy=(ev.clientY-start.my)/zoom.value
    for(const o of start.origins) dragPos.set(o.id,{x:snap(o.x+dx),y:snap(o.y+dy)})
  },(ev,moved)=>{
    if(moved) {
      work.olnodePushUndo(true)
      const undoLength=work.olUndo.length
      for(const o of start.origins) {const p=dragPos.get(o.id);if(p) work.olnodeSetCanvas(o.id,p.x,p.y)}
      if(n.kind!=='container') reparentAfterDrop(n,canvasPt(ev))
      // Reparent uses the normal store command; collapse its snapshot into this gesture.
      work.olUndo.splice(undoLength)
    }
    finish()
  },finish)
}
/* 拖入即归组：落点中心命中当前层的容器卡 → 改父。
 * 分层视图里“拖出容器”不再自动回根——子节点只在容器内部可见，移出请走抽屉/右键「移出上一层」。 */
function reparentAfterDrop(n, pt) {
  const p = posOf(n)
  if (!p) return
  const cx = p.x + sizeOf(n).w / 2
  const cy = p.y + sizeOf(n).h / 2
  const desc = new Set(work.olnodeDescendants(n.id).map((d) => d.id))
  const curParent = n.parentId || null
  const inBox = (box) => box && cx >= box.x && cx <= box.x + box.w && cy >= box.y && cy <= box.y + box.h
  let landed = null
  for (const c of [...visNodes.value].reverse()) {
    if (c.kind !== 'container' || c.id === n.id || desc.has(c.id)) continue
    if (inBox(rectOf(c))) {
      landed = c
      break
    }
  }
  if (landed && landed.id !== curParent) {
    work.olnodeMoveTo(n.id, landed.id)
    flashIds.add(landed.id)
    setTimeout(() => flashIds.delete(landed.id), 1600)
    window.$msg?.success(`已归入「${landed.title || '容器'}」，可就地展开或进入编辑`)
  }
}

/* ---------- 模块八向边缘拖拽调整大小（n/w 方向同步移动原点；拖拽中短过渡实时跟手，落库取整） ---------- */
const resizing = ref(false)
const resizeSmooth = ref(false) // 容器大盒子：调整过程用过渡动画平滑跟随鼠标
function startResize(e, n, dir) {
  if (e.button !== 0) return
  e.stopPropagation()
  e.preventDefault()
  resizing.value = n.id
  resizeSmooth.value = n.kind === 'container'
  const current = rectOf(n) || effSize(n, cardDensity.value)
  const base = { w: current.w, h: current.h }
  const p0 = dragPos.get(n.id) || { x: n.canvasX ?? 0, y: n.canvasY ?? 0 }
  const minW = n.kind === 'container' ? SCOPE_METRICS.cardMinW : 96
  const maxW = n.kind === 'container' ? SCOPE_METRICS.cardMaxW : Infinity
  const minH = n.kind === 'container'
    ? (isExpanded(n.id) ? SCOPE_METRICS.containerMinH : SCOPE_METRICS.collapsedH)
    : 36
  const mx = e.clientX
  const my = e.clientY
  /* 拖拽方向决定可变轴：未拖的轴保持原值不落库（否则横拖会把高度钉死在当前值） */
  const canW = dir.includes('e') || dir.includes('w')
  const canH = dir.includes('n') || dir.includes('s')
  const apply = (ev) => {
    const dx = (ev.clientX - mx) / zoom.value
    const dy = (ev.clientY - my) / zoom.value
    let w = base.w
    let h = base.h
    let x = p0.x
    let y = p0.y
    if (dir.includes('e')) w = Math.min(maxW, Math.max(minW, base.w + dx))
    if (dir.includes('s')) h = Math.max(minH, base.h + dy)
    if (dir.includes('w')) {
      w = Math.min(maxW, Math.max(minW, base.w - dx))
      x = p0.x + (base.w - w)
    }
    if (dir.includes('n')) {
      h = Math.max(minH, base.h - dy)
      y = p0.y + (base.h - h)
    }
    dragSize.set(n.id, { w, h })
    if (dir.includes('w') || dir.includes('n')) dragPos.set(n.id, { x: Math.round(x), y: Math.round(y) })
  }
  const finish=()=>{dragSize.delete(n.id);dragPos.delete(n.id);resizing.value=false;resizeSmooth.value=false}
  pointerGesture(e,apply,(ev,moved)=>{
    const size=dragSize.get(n.id),pos=dragPos.get(n.id)
    if(moved) {
      work.olnodePushUndo(true)
      if(pos) work.olnodeSetCanvas(n.id,pos.x,pos.y)
      if(size) work.olnodeSetSize(n.id,canW?size.w:null,canH?size.h:null)
    }
    finish()
  },finish)
}

/* ---------- 容器右键色彩快捷栏（v0.4.2） ---------- */
const ctxMenu = ref(null) // { x, y, nodeId }
/* 空白右键（v0.4.9）：在右键落点选建各模块（锚点/卷需选章节/卷参数，不在菜单内） */
const blankCtx = ref(null) // { x, y, px, py }  px/py = 画布坐标落点
/* 连线右键（v1.0.17）：直接打开编辑浮层（含「在此处创建连接点」）——右键落点记录用于连接点定位 */
const edgeCtx = ref(null) // { x, y, ownerId, relId, px, py }  屏幕坐标 + 画布落点
function openEdgeCtxFromEvent(e, edge) {
  if (edge.group) {
    selectEdge(edge)
    groupDetailsOpen.value = true
    return
  }
  const pt = canvasPt(e)
  /* 浮层锚定连线中点，但保留右键落点供「创建连接点」精确定位 */
  edgeCtx.value = { x: e.clientX, y: e.clientY, ownerId: edge.ownerId, relId: edge.rel.id, px: pt.x, py: pt.y }
  openEdgeEdit(edge.ownerId, edge.rel.id, edge)
}
const CREATE_KINDS = Object.fromEntries(Object.entries(KIND_META).filter(([k]) => k !== 'anchor' && k !== 'volume'))
/* 工具条是唯一的「添加模块」入口：7 类模块 + 多选。 */
const ADD_TOOLS = [
  { kind: 'event', label: '事件', icon: 'diamond' },
  { kind: 'note', label: '便签', icon: 'edit' },
  { kind: 'cite', label: '引用', icon: 'link' },
  { kind: 'textbox', label: '文本框', icon: 'textbox' },
  { kind: 'anchor', label: '锚点', icon: 'anchor' },
  { kind: 'volume', label: '卷', icon: 'rows' },
  { kind: 'container', label: '容器', icon: 'container' }
]
function onCanvasCtx(e) {
  /* Chromium 对 SVG pointer-events:stroke 路径的 contextmenu 命中可能与 mousedown 不一致
     （mousedown 命中路径，contextmenu 却派发给画布）——用 elementFromPoint 反查真实落点 */
  const t = document.elementFromPoint(e.clientX, e.clientY)
  const hitEl = t && (t.classList?.contains('oc-edge-hit') ? t : t.closest?.('.oc-edge-hit'))
  if (hitEl && (hitEl.dataset.edgeKey || (hitEl.dataset.owner && hitEl.dataset.rel))) {
    const edge = hitEl.dataset.edgeKey
      ? edges.value.find((x) => x.key === hitEl.dataset.edgeKey)
      : edges.value.find((x) => x.ownerId === hitEl.dataset.owner && x.rel?.id === hitEl.dataset.rel)
    if (edge) openEdgeCtxFromEvent(e, edge)
    return
  }
  if (e.target.closest?.('.oc-node, .oc-elabel, .oc-edge-hit, .oc-eedit, .rg-eedit, .oc-ctx')) return // 节点/连线/标签/浮层/菜单上不弹创建菜单（容器右键走调色板，连线右键开编辑浮层）
  const pt = canvasPt(e)
  blankCtx.value = { x: e.clientX, y: e.clientY, px: pt.x, py: pt.y }
}
function onWheelC(e) {
  blankCtx.value = null
  onWheel(e)
}
function createAt(kind) {
  const st = blankCtx.value
  blankCtx.value = null
  if (!st) return
  addNodeAt(kind, { x: st.px, y: st.py }, kind === 'note' ? { title: '新便签' } : {})
}
/* Delete 键删除选中模块（输入态不劫持） */
function onKey(e) {
  if (e.defaultPrevented) return
  if (settingsOpen.value && e.key === 'Escape') {
    e.preventDefault()
    updateSettings(false)
    return
  }
  if (e.key === 'Escape') {
    placement.cancel()
    cancelGesture?.()
    selectedEdgeKey.value=null;flowMode.value='idle'
    ctxMenu.value = null
    blankCtx.value = null
    edgeCtx.value = null
    juncCtx.value = null
    edgeEdit.value = null
    drawerId.value = null
    searchOpen.value = false
    groupDetailsOpen.value = false
    return
  }
  const t = e.target
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    if (t !== searchEl.value && (t?.matches?.('input:not([type="range"]), textarea') || t?.isContentEditable)) return
    e.preventDefault()
    updateSettings(false)
    searchOpen.value = true
    nextTick(() => searchEl.value?.focus())
    return
  }
  if (t?.closest?.('.latent-canvas-settings') || (t && (t.matches?.('input, textarea, [contenteditable="true"]') || t.isContentEditable))) return
  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (editTitle.value || editText.value || edgeEdit.value || connecting.value || citePick.value) return
    if (selectedEdge.value) {e.preventDefault();deleteSelectedEdge();return}
    if (work.selOlnodeId && visibleIdSet.value.has(work.selOlnodeId)) {
      e.preventDefault()
      work.olnodeRemove(work.selOlnodeId)
      work.selOlnodeId = null
      drawerId.value = null
    }
    return
  }
  if (!(e.ctrlKey || e.metaKey) && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key) && work.selOlnodeId && visibleIdSet.value.has(work.selOlnodeId)) {
    const n = nodeById(work.selOlnodeId)
    if (!n) return
    e.preventDefault()
    const step = e.shiftKey ? 24 : 8
    const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0
    const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0
    work.olnodePushUndo()
    work.olnodeSetCanvas(n.id, (n.canvasX ?? 0) + dx, (n.canvasY ?? 0) + dy)
    return
  }
  if (!(e.ctrlKey || e.metaKey)) return
  cancelGesture?.()
  const k = e.key.toLowerCase()
  if (k === 'z' && !e.shiftKey) {
    e.preventDefault()
    work.olnodeUndo()
  } else if (k === 'y' || (k === 'z' && e.shiftKey)) {
    e.preventDefault()
    work.olnodeRedo()
  }
}function onNodeCtx(e, n) {
  e.preventDefault()
  work.selOlnodeId = n.id
  ctxMenu.value = { x: e.clientX, y: e.clientY, nodeId: n.id }
}
function applyColor(c) {
  if (ctxMenu.value) work.olnodeSetColor(ctxMenu.value.nodeId, c)
}
const ctxNode = computed(() => (ctxMenu.value ? nodeById(ctxMenu.value.nodeId) : null))
function ctxAct(kind) {
  const n = ctxNode.value
  if (!n) return
  if (kind === 'shape') work.olnodeSetShape(n.id, nextShape(n.shape))
  else if (kind === 'mtype') cycleMtype(n)
  else if (kind === 'pin') work.olnodeSetPin(n.id, !n.pin)
  else if (kind === 'fold') work.olnodeToggleFold(n.id)
  else if (kind === 'settings') {
    ctxMenu.value = null
    drawerId.value = n.id
    return
  } else if (kind === 'moveout') {
    ctxMenu.value = null
    if (n.parentId) {
      const parent = nodeById(n.parentId)
      work.olnodeMoveTo(n.id, null)
      revealNode(n.id, { openDrawer: true })
      window.$msg?.success(`已移出「${parent?.title || '容器'}」`)
    }
    return
  } else if (kind === 'edit') {
    ctxMenu.value = null
    startInlineEdit(n)
    return
  } else if (kind === 'ai') {
    /* 附带节点并打开对话，由作者编辑需求后发送。 */
    ctxMenu.value = null
    if (!ai.ready) return window.$msg?.warning(AI_UNSET_HINT)
    ai.prepare('请讨论这个大纲节点的后续安排。', {outlineId:n.id})
    return
  } else if (kind === 'remove') {
    ctxMenu.value = null
    onRemove(n)
    return
  }
  /* 形状/类型/固定保持菜单开启，便于连续调整 */
}
function startInlineEdit(n) {
  editText.value = { id: n.id, value: n.text || '' }
  nextTick(() => {
    const raw = inlineEl.value
    const el = Array.isArray(raw) ? raw[0] : raw
    if (el) {
      el.focus()
      el.setSelectionRange(el.value.length, el.value.length)
    }
  })
}
function commitInline() {
  const st = editText.value
  editText.value = null
  if (st) work.olnodeSetRich(st.id, st.value, null)
}

/* ---------- 锚点拖线建边（从拖出的接口出发，fromSide 随边存储） ---------- */
/* ---------- 连接点：右键投影 + 创建（v1.0.13 推倒重建） ---------- */
/* 画布点到连线路径的最近点：先沿真实几何（折线 pts / 贝塞尔 c1c2）采样，再逐段投影。
 * 返回 { point, t }——t 为路径参数，连接点按 t 钉在宿主连线上。 */
function projectOnEdge(pt,e) {return projectOnRoute(pt,e)}
/* 编辑浮层内「在此处创建连接点」：在右键落点对应的路径参数处直接建（浮层保持开启） */
function edgeCtxCreate() {
  const st = edgeCtx.value
  if (!st) return
  const e = edges.value.find((x) => x.ownerId === st.ownerId && x.rel.id === st.relId)
  if (!e || e.status === 'blocked' || e.projected) return
  const { t } = projectOnEdge({ x: st.px, y: st.py }, e)
  work.olnodeJunctionAdd(st.ownerId, st.relId, t)
}
/* 连接点右键：仅删除（创建只来自连线右键） */
const juncCtx = ref(null) // { x, y, ownerId, relId, junctionId }
function openJunctionCtx(e, j) {
  juncCtx.value = { x: e.clientX, y: e.clientY, ownerId: j.ownerId, relId: j.relId, junctionId: j.junctionId }
}
function juncCtxRemove() {
  const st = juncCtx.value
  juncCtx.value = null
  if (st) work.olnodeJunctionRemove(st.ownerId, st.relId, st.junctionId)
}
/* 连接点渲染集合：宿主连线 × junctions → SVG 层小圆点 + 命中热区；
 * bornAt（创建 1.6s 内）驱动 flash 高亮态——加深显形方便确认位置，随后淡出隐藏 */
const juncFlashTick = ref(0)
let juncFlashTimer = null // 驱动 bornAt 高亮过期重算（挂载期轮询，卸载即停）
const junctionItems = computed(() => {
  void juncFlashTick.value
  const now = Date.now()
  const out = []
  /* 连接点挂在真实宿主连线上；即使宿主边被投影分组，也要保留可见的连接点。 */
  for (const { owner, rel } of relationEntries.value) {
    if (!rel.junctions?.length) continue
    const fromId = rel.fromJunction?.ownerId || owner.id
    const toId = rel.toJunction?.ownerId || rel.toId
    if (!visibleIdSet.value.has(fromId) || !visibleIdSet.value.has(toId)) continue
    const a = nodeById(fromId), b = nodeById(toId)
    if (!a || !b) continue
    const sides = sideBetween(rectOf(a), rectOf(b))
    const geom = geometryBetween(
      { nodeId: fromId, side: rel.fromSide || sides.from },
      { nodeId: toId, side: rel.toSide || sides.to },
      rel,
      rel.id
    )
    if (!geom) continue
    for (const j of rel.junctions) {
      const p = pointAtT(geom, j.t)
      if (p) out.push({ key: j.id, ownerId: owner.id, relId: rel.id, junctionId: j.id, x: p.x, y: p.y, flash: now - (j.bornAt || 0) < 1600 })
    }
  }
  return out
})
/* One transient state machine for create, route adjustment and reconnect. */
let cancelGesture = null
function pointerGesture(event,onMove,onEnd,onCancel=()=>{}) {
  cancelGesture?.()
  const savedRoutes=new Map(routeCache.entries)
  const origin={x:event.clientX,y:event.clientY}
  let moved=false,pending=null,frame=0
  const flush=()=>{frame=0;if(pending){const ev=pending;pending=null;onMove(ev)}}
  const move=ev=>{
    if(!moved&&Math.hypot(ev.clientX-origin.x,ev.clientY-origin.y)<4) return
    moved=true;pending=ev
    if(!frame) frame=requestAnimationFrame(flush)
  }
  const cleanup=()=>{window.removeEventListener('mousemove',move);window.removeEventListener('mouseup',up);cancelAnimationFrame(frame);frame=0;pending=null;cancelGesture=null}
  const up=ev=>{
    if(Math.hypot(ev.clientX-origin.x,ev.clientY-origin.y)>=4) {moved=true;pending=ev}
    if(pending) flush()
    cleanup();onEnd(ev,moved)
  }
  cancelGesture=()=>{cleanup();routeCache.entries=new Map(savedRoutes);onCancel()}
  window.addEventListener('mousemove',move);window.addEventListener('mouseup',up)
}
function selectEdge(edge) {
  selectedEdgeKey.value=edge.key;work.selOlnodeId=null;drawerId.value=null;flowMode.value='selected';closeFloaters()
}
function startEdgeShape(e,edge) {
  if(e.button!==0) return
  e.preventDefault();selectEdge(edge)
  if(e.detail>=2) onEdgeDbl(edge)
}
function onEdgeDbl(edge) {
  selectEdge(edge)
  if (edge.group) { groupDetailsOpen.value = true; return }
  openEdgeEdit(edge.ownerId,edge.rel.id,edge)
}
function hostAllowed(endpoint,exclude) {
  if(!exclude||endpoint.nodeId) return true
  const seen=new Set()
  function depends(id) {
    if(id===exclude) return true
    if(seen.has(id)) return false
    seen.add(id)
    const e=relationEntries.value.find(e=>e.rel.id===id)
    return e&&[e.rel.fromJunction,e.rel.toJunction].filter(Boolean).some(r=>depends(r.relId))
  }
  return !depends(endpoint.relId)
}
function snapEndpoint(pt,exclude) {
  const radius=12/zoom.value
  const nodes=[...visNodes.value, ...miniItems.value.map(i=>i.node)].reverse().sort((a,b)=>(a.kind==='container')-(b.kind==='container'))
  let best=null
  for(const n of nodes) for(const [side,p] of Object.entries(portsOf(n))) {
    const d=Math.hypot(p.x-pt.x,p.y-pt.y)
    if(d<=radius&&(!best||d<best.dist)) best={nodeId:n.id,side,point:p,dist:d}
  }
  if(best) return best
  for(const j of junctionItems.value) {
    if(edges.value.find(e=>e.key===j.relId)?.status==='blocked') continue
    if(!hostAllowed(j,exclude)) continue
    const d=Math.hypot(pt.x-j.x,pt.y-j.y)
    if(d<=radius&&(!best||d<best.dist)) best={ownerId:j.ownerId,relId:j.relId,junctionId:j.junctionId,point:{x:j.x,y:j.y},dist:d}
  }
  if(best) return best
  const n=hitConnTarget(pt)
  if(n) {
    const [side,p]=Object.entries(portsOf(n)).sort((a,b)=>Math.hypot(pt.x-a[1].x,pt.y-a[1].y)-Math.hypot(pt.x-b[1].x,pt.y-b[1].y))[0]
    return {nodeId:n.id,side,point:p}
  }
  for(const edge of edges.value) {
    if(edge.group) continue
    /* edge.key 是分组键（from|to|kind），store 命令只认真实 rel.id——v1.1.8 修复 */
    if(edge.status==='blocked'||!hostAllowed({relId:edge.rel.id},exclude)) continue
    const proj=projectOnRoute(pt,edge)
    if(proj.dist<=10/zoom.value&&(!best||proj.dist<best.dist)) best={ownerId:edge.ownerId,relId:edge.rel.id,t:proj.t,point:proj.point,dist:proj.dist}
  }
  return best
}
function endpointData(e) {
  if(e.nodeId) return {nodeId:e.nodeId,side:e.side}
  return {ownerId:e.ownerId,relId:e.relId,...(e.junctionId?{junctionId:e.junctionId}:{t:e.t})}
}
function beginConnection(e,source,edge=null,end='target') {
  if(e.button!==0) return
  e.preventDefault();e.stopPropagation();closeFloaters()
  const fixedTarget=edge?.target
  const originalSource=edge?.source||source
  connecting.value={source:originalSource,target:fixedTarget,point:canvasPt(e),candidate:null,edgeKey:edge?.key,end,rel:edge?.rel}
  flowMode.value=edge?'reconnect':'create'
  const finish=()=>{connecting.value=null;flowMode.value=selectedEdgeKey.value?'selected':'idle'}
  pointerGesture(e,ev=>{
    const point=canvasPt(ev),candidate=snapEndpoint(point,edge?.rel?.id)
    connecting.value={...connecting.value,point,candidate}
  },(ev,moved)=>{
    const st=connecting.value
    const preview=connGeometry.value
    /* 有候选落点即建线：路径受阻（blocked）只说明现布局下要绕行/穿卡，
       拒绝建线会让用户拖了半天毫无反应——建成的受阻连线会以虚线+「路径受阻」呈现（v1.1.8） */
    if(moved&&st?.candidate&&preview) {
      const endpoint=endpointData(st.candidate)
      const command=edge?{type:'reconnect',ownerId:edge.ownerId,relId:edge.rel.id,end,endpoint}:{type:'connect',source:st.source,target:endpoint}
      const result=work.olnodeRelGesture(command)
      if(result.ok) {
        work.selOlnodeId=null
        nextTick(() => {
          const group = edges.value.find((e) => e.relations?.some((r) => r.rel.id === result.rel.id))
          selectedEdgeKey.value = group?.key || null
        })
      } else window.$msg?.warning(result.error)
    }
    finish()
  },finish)
}
function startConnect(e,n) {beginConnection(e,{nodeId:n.id,side:e.currentTarget?.dataset?.side||'right'})}
function startConnectFromJunction(e,j) {beginConnection(e,{ownerId:j.ownerId,relId:j.relId,junctionId:j.junctionId})}
function startReconnect(e,edge,end) {beginConnection(e,edge.source,edge,end)}
const connGeometry=computed(()=>{
  const c=connecting.value
  if(!c) return null
  const candidate=c.candidate?endpointData(c.candidate):{point:c.point,side:c.end==='source'?'right':'left'}
  const source=c.end==='source'?candidate:c.source,target=c.end==='source'?c.target:candidate
  return geometryBetween(source,target,c.rel||{},c.edgeKey||'__preview',new Set(c.edgeKey?[c.edgeKey]:[]),true)
})
const connPath=computed(()=>connGeometry.value?.d||'')
const routeHandles=computed(()=>{
  const e=selectedEdge.value
  if(!e||connecting.value||e.group||e.projected) return []
  if(work.canvasPrefs.edgeStyle!=='ortho') {
    const wp=e.resolvedWaypoints?.[0]
    return [{key:'curve',point:wp||pointAtT(e,.5),curve:true,index:0}]
  }
  const pts=e.pts||[e.a,e.b],out=[]
  for(let i=1;i<pts.length-2;i++) if(Math.hypot(pts[i+1].x-pts[i].x,pts[i+1].y-pts[i].y)>=24) out.push({key:i,index:i,point:{x:(pts[i].x+pts[i+1].x)/2,y:(pts[i].y+pts[i+1].y)/2},horizontal:Math.abs(pts[i].y-pts[i+1].y)<.5})
  if(!out.length) out.push({key:'middle',index:0,point:pointAtT(e,.5),horizontal:Math.abs(e.a.y-e.b.y)<Math.abs(e.a.x-e.b.x),straight:true})
  return out
})
function startRouteAdjust(event,handle) {
  const edge=selectedEdge.value
  if(!edge||edge.group||edge.projected||event.button!==0) return
  event.preventDefault();event.stopPropagation();closeFloaters();flowMode.value='adjust'
  const start=canvasPt(event),original=edge.rel.routing?.waypoints|| (edge.rel.custom?[edge.rel.custom]:[])
  const finish=()=>{routeDraft.value=null;flowMode.value='selected'}
  pointerGesture(event,ev=>{
    const p=canvasPt(ev)
    let waypoints
    if(handle.curve) {waypoints=original.map(p=>({...p}));waypoints[handle.index]={x:p.x,y:p.y}}
    else {
      const pts=(edge.pts||[edge.a,edge.b]).map(p=>({...p}))
      const delta=handle.horizontal?p.y-start.y:p.x-start.x,axis=handle.horizontal?'y':'x'
      if(handle.straight) {
        const a={x:edge.a.x+(edge.b.x-edge.a.x)/3,y:edge.a.y+(edge.b.y-edge.a.y)/3},b={x:edge.a.x+(edge.b.x-edge.a.x)*2/3,y:edge.a.y+(edge.b.y-edge.a.y)*2/3}
        a[axis]+=delta;b[axis]+=delta;waypoints=[a,b]
      } else {pts[handle.index][axis]+=delta;pts[handle.index+1][axis]+=delta;waypoints=pts.slice(1,-1)}
    }
    routeDraft.value={key:edge.key,routing:{version:1,waypoints}}
  },(ev,moved)=>{
    if(moved&&routeDraft.value) work.olnodeRelGesture({type:'patch',ownerId:edge.ownerId,relId:edge.rel.id,patch:{routing:routeDraft.value.routing,custom:null}})
    finish()
  },finish)
}
function resetRoute(edge=selectedEdge.value) {
  if(!edge||edge.group||edge.projected) return
  routeCache.entries.delete(edge.key)
  work.olnodeRelGesture({type:'patch',ownerId:edge.ownerId,relId:edge.rel.id,patch:{routing:null,custom:null}})
}
function deleteSelectedEdge() {
  const edge=selectedEdge.value
  if(!edge) return
  if(edge.group) {
    const start=work.olUndo.length
    for(const {owner,rel} of edge.relations) work.olnodeRelRemove(owner.id,rel.id)
    if(work.olUndo.length>start+1) work.olUndo.splice(start+1)
  } else {
    /* edge.key 是投影分组键（from|to|kind），删除必须用真实 rel.id——否则 relationTransaction
       按 relId 找不到连线、静默失败（Delete 键与工具条「删除」全部无效，v1.1.8 修复） */
    work.olnodeRelRemove(edge.ownerId,edge.rel.id)
  }
  selectedEdgeKey.value=null;flowMode.value='idle';closeFloaters()
}
const edgeToolsStyle=computed(()=>{
  const e=selectedEdge.value,r=canvasEl.value?.getBoundingClientRect()
  if(!e||!r) return {}
  const top=Math.min(...(e.samples||[e.a,e.b]).map(p=>p.y))
  return {left:Math.max(r.left+150,Math.min(r.right-150,r.left+tx.value+e.mid.x*zoom.value))+'px',top:Math.max(r.top+45,Math.min(r.bottom-30,r.top+ty.value+top*zoom.value-26))+'px'}
})

/* ---------- 边编辑浮层（与容器右键菜单同模式：fixed + 屏幕坐标 + 不随画布缩放重定位） ---------- */
const edgeLabelInput = ref(null)
/* 避线放置（v1.0.18）：以锚点为基准沿 上/下/左/右 四方位生成候选框（与 .oc-eedit.dir-* transform 变体一一对应），
 * 统计连线路径采样点落入框内的数量（遮挡少者优先），越出画布可视区的面积占比高者罚分，
 * 同分按 上>下>右>左 偏好——浮层弹在不压住连线本体的一侧。size 缺省用估值，挂载后可按真实尺寸复检 */
function popPlacement(mid, geom, size) {
  const el = canvasEl.value
  if (!el) return { mx: mid?.x ?? 0, my: mid?.y ?? 0, dir: 'up' }
  const r = el.getBoundingClientRect()
  const sx = r.left + tx.value + (mid?.x ?? 0) * zoom.value
  const sy = r.top + ty.value + (mid?.y ?? 0) * zoom.value
  const gap = 14
  const w = size?.w || 238
  const h = size?.h || (edgeCtx.value ? 206 : 172)
  /* 几何缺失时回退旧逻辑：默认上方弹出，顶部空间不足且下方更宽敞则向下（v0.4.12 行为） */
  if (!geom || (!geom.pts && !geom.c1)) {
    const roomUp = sy - r.top
    return { mx: sx, my: sy, dir: roomUp < h + gap && r.bottom - sy > roomUp ? 'down' : 'up' }
  }
  const N = 32
  const samples = []
  for (let i = 0; i <= N; i++) {
    const p = pointAtT(geom, i / N)
    if (p) samples.push({ x: r.left + tx.value + p.x * zoom.value, y: r.top + ty.value + p.y * zoom.value })
  }
  const pref = { up: 0, down: 1, right: 2, left: 3 }
  const cands = [
    { dir: 'up', x: sx - w / 2, y: sy - gap - h },
    { dir: 'down', x: sx - w / 2, y: sy + gap },
    { dir: 'left', x: sx - gap - w, y: sy - h / 2 },
    { dir: 'right', x: sx + gap, y: sy - h / 2 }
  ]
  let best = null
  for (const rc of cands) {
    let inside = 0
    for (const p of samples) {
      if (p.x > rc.x && p.x < rc.x + w && p.y > rc.y && p.y < rc.y + h) inside++
    }
    const ix = Math.max(0, Math.min(rc.x + w, r.right) - Math.max(rc.x, r.left))
    const iy = Math.max(0, Math.min(rc.y + h, r.bottom) - Math.max(rc.y, r.top))
    const clipped = 1 - (ix * iy) / (w * h)
    const score = inside * 2 + clipped * 64 + pref[rc.dir]
    if (best === null || score < best.score) best = { score, dir: rc.dir }
  }
  return { mx: sx, my: sy, dir: best.dir }
}
function openEdgeEdit(ownerId, relId, geom) {
  const p = popPlacement(geom?.mid, geom)
  edgeEdit.value = { ownerId, relId, mx: p.mx, my: p.my, dir: p.dir }
  nextTick(() => {
    edgeLabelInput.value?.focus()
    /* 挂载后按真实尺寸复检方位（估值有偏差时纠正：锚点不变，仅切换 transform 变体） */
    const el = document.querySelector('.oc-eedit')
    if (!el || !edgeEdit.value) return
    edgeEdit.value.dir = popPlacement(geom?.mid, geom, { w: el.offsetWidth, h: el.offsetHeight }).dir
  })
}
function curRel() {
  const st=edgeEdit.value
  return st?relationEntries.value.find(e=>e.owner.id===st.ownerId&&e.rel.id===st.relId)?.rel:null
}
function patchRel(patch) {
  const st=edgeEdit.value
  if(!st) return
  work.olnodePushUndo()
  work.olnodeRelPatchAny(st.ownerId,st.relId,patch)
}
function removeRel() {
  const st=edgeEdit.value
  if(st) work.olnodeRelRemove(st.ownerId,st.relId)
  selectedEdgeKey.value=null;flowMode.value='idle';closeFloaters()
}
function closeFloaters() {
  edgeEdit.value = null
  edgeCtx.value = null
  citePick.value = null
  editTitle.value = null
}
function onWinDown(e) {
  if (settingsOpen.value && !e.target.closest?.('.latent-canvas-settings,.draft-settings-toggle')) updateSettings(false)
  if (searchOpen.value && !e.target.closest?.('.oc-search-wrap')) searchOpen.value = false
  if (e.target.closest?.('.ow-resizer,.ow-rail,.ow-mobile-controls,.draft-canvas-head,.creation,.draft-zoom,.latent-canvas-settings')) return
  if (!e.target.closest?.('.oc-edge-hit,.oc-elabel,.oc-route-handle,.oc-endpoint,.oc-endpoint-control,.oc-edge-tools,.oc-eedit,.oc-apt,.oc-junc')) {selectedEdgeKey.value=null;flowMode.value='idle'}
  /* 浮层与其落点数据（edgeCtx）同生共死：点浮层/连线外即一并关闭 */
  if (edgeEdit.value && !e.target.closest?.('.oc-eedit, .oc-edge-hit, .oc-elabel')) {
    edgeEdit.value = null
    edgeCtx.value = null
  }
  if (citePick.value && !e.target.closest?.('.oc-pick')) citePick.value = null
  if (editTitle.value && !e.target.closest?.('.oc-title-edit')) commitTitle()
  if (groupDetailsOpen.value && !e.target.closest?.('.oc-relations-panel, .oc-group-inspector, .oc-edge-hit, .oc-elabel')) groupDetailsOpen.value = false
  if (drawerId.value && !e.target.closest?.('.oc-drawer, .oc-node, .oc-mini, .oc-ctx')) drawerId.value = null
  if (ctxMenu.value && !e.target.closest?.('.oc-ctx')) ctxMenu.value = null
  if (blankCtx.value && !e.target.closest?.('.oc-ctx')) blankCtx.value = null
  if (juncCtx.value && !e.target.closest?.('.oc-ctx, .oc-junc-hit')) juncCtx.value = null
}

/* ---------- 节点操作 ---------- */
function onRemove(n) {
  const kids = work.olnodeChildren(n.id).length
  const label = n.title || KIND_META[n.kind]?.label || '模块'
  if (kids && !window.confirm(`删除「${label}」及其全部 ${kids} 个子模块？`)) return
  const removedScope = scopeId.value && (scopeId.value === n.id || work.olnodeDescendants(n.id).some((d) => d.id === scopeId.value))
  if (work.selOlnodeId === n.id || work.olnodeDescendants(n.id).some((d) => d.id === work.selOlnodeId)) work.selOlnodeId = null
  drawerId.value = null
  work.olnodeRemove(n.id)
  if (removedScope) nextTick(() => focusScope(n.parentId || null, { animate: false, restore: false }))
}
function onDblNode(n) {
  if(outlineWorkspace){work.selOlnodeId=n.id;outlineWorkspace.open('right')}
  if (n.kind === 'anchor' && n.refId) {
    work.navTo('chapters', n.refId)
    return
  }
  if (n.kind === 'volume' && n.refId) {
    const first = work.liveChapters.find((c) => c.volumeId === n.refId)
    if (first) work.navTo('chapters', first.id)
    return
  }
  drawerId.value = n.id
}
const chapterOf = (n) => (n.kind === 'anchor' ? work.chapters.find((c) => c.id === n.refId && !c.deletedAt) : null)
function labelOf(n) {
  if (n.kind === 'anchor') return chapterOf(n)?.title || n.title || '（已删章节）'
  if (n.kind === 'volume') return work.volumes.find((v) => v.id === n.refId && !v.deletedAt)?.title || n.title || '（已删卷）'
  if (n.kind === 'cite') {
    const parsed = parseTarget(n.refId)
    const t = parsed ? targetById(parsed.kind, parsed.id) : null
    return n.title || t?.title || '引用卡'
  }
  const first = (n.text || '').split('\n').find((x) => x.trim())
  return n.title || (first || '').trim().slice(0, 40) || '（空模块）'
}
function subOf(n) {
  if (n.kind === 'anchor') {
    const c = chapterOf(n)
    return c ? `${c.wordCount || 0}字 · ${STATUS_LABEL[c.status]}` : ''
  }
  if (n.kind === 'volume') {
    const chs = work.liveChapters.filter((c) => c.volumeId === n.refId)
    return chs.length ? `${chs.length}章 · ${chs.reduce((s, c) => s + (c.wordCount || 0), 0)}字` : ''
  }
  if (n.kind === 'cite') {
    const parsed = parseTarget(n.refId)
    return parsed ? KIND_LABEL[parsed.kind] || '' : '未选择目标'
  }
  return n.title ? (n.text || '').split('\n').find((x) => x.trim())?.trim().slice(0, 30) || '' : ''
}
function chooseCitation(n) {
  const rect = rectOf(n)
  if (rect) citePick.value = { nodeId: n.id, x: rect.x, y: rect.y }
}
/* 放大模块（自定义高度超出默认 30px+）显示正文全文；文本框模块始终全文 */
function showFullText(n) {
  if (n.kind === 'textbox') return true
  if (n.h == null) return false
  const base = effSize({ kind: n.kind, shape: n.shape }, cardDensity.value).h
  if (cardDensity.value === 'paper') return (n.text || '').trim().length > 0 && (rectOf(n)?.h || 0) >= 110
  return n.h >= base + 30 && (n.text || '').trim().length > 0
}
function plainText(n) {
  return String(n.text || '').replace(/\[\[([^\[\]\n]+?)\|?([^\[\]\n]*?)\]\]/g, (m, t, d) => d || t).slice(0, 600)
}
function commitTitle() {
  const st = editTitle.value
  editTitle.value = null
  if (st && st.value.trim()) work.olnodeSetTitle(st.id, st.value.trim())
}
function branchColor(n) {
  if (n.color) return n.color // 右键快捷栏手动指定色优先
  const cs = live.value.filter((x) => x.kind === 'container')
  const i = cs.findIndex((x) => x.id === n.id)
  return PALETTE[(i < 0 ? 0 : i) % PALETTE.length]
}
function nodeStyle(n) {
  const r = rectOf(n)
  if (!r) return { display: 'none' }
  const editing = editText.value && editText.value.id === n.id
  return {
    left: r.x + 'px',
    top: r.y + 'px',
    width: r.w + 'px',
    // 非容器一律显式高度：与 rectOf（连线锚点/容器派生盒）一致，高度拖拽才能生效；
    // 编辑态给足最小编辑区（否则 absolute 编辑器撑不开节点，内容不可见）
    height: n.kind === 'container' ? r.h + 'px' : editing ? Math.max(r.h, 96) + 'px' : Math.max(r.h, 36) + 'px',
    zIndex: editing ? 8 : n.kind === 'container' ? 1 : work.selOlnodeId === n.id ? 6 : 3,
    ...(n.kind === 'container' ? { '--bc': branchColor(n) } : {})
  }
}

/* 形状描边多边形（viewBox 0 0 100 100，preserveAspectRatio=none 拉伸铺满节点）：
 * 菱形/平行四边形顶点恰好落在连线锚点（边界中点）上，边框与连线端点贴合 */
const SW = 1.6
function shapePoly(n) {
  if (n.shape === 'diamond') {
    return [
      [50, SW],
      [100 - SW, 50],
      [50, 100 - SW],
      [SW, 50]
    ]
      .map((p) => p.join(','))
      .join(' ')
  }
  const sk = 12
  return [
    [sk, SW],
    [100 - SW, SW],
    [100 - sk, 100 - SW],
    [SW, 100 - SW]
  ]
    .map((p) => p.join(','))
    .join(' ')
}

/* ---------- 新建与骨架模板 ---------- */
function newNodeSize(node) {
  const size = node.kind === 'container'
    ? { w: SCOPE_METRICS.cardW, h: SCOPE_METRICS.collapsedH }
    : effSize(node, cardDensity.value)
  return { w: size.w, h: Math.max(36, size.h) }
}
function newNodeFields(kind) {
  return { kind, title: ({ event: '新事件', note: '新便签', container: '新容器' })[kind] || '' }
}
function createPlacedNode(node, rect) {
  const entries = node.kind === 'anchor' ? work.liveChapters : work.liveVolumes
  if (node.refId && !entries.some(row => row.id === node.refId)) {
    window.$msg?.warning('关联的章节或卷已不存在，请重新选择')
    return
  }
  const fields = node.kind === 'container' ? { ...node, w: rect.w, manualW: true } : node
  const row = work.olnodeAdd(scopeId.value, { ...fields, canvasX: rect.x, canvasY: rect.y })
  work.selOlnodeId = row.id
  if (row.kind === 'cite') chooseCitation(row)
}
const placement = useOutlinePlacement({ canvasPoint: canvasPt, nodeSize: newNodeSize, snap, create: createPlacedNode })
const { draft: placementDraft, ghost: placementGhost } = placement
const placementTool = computed(() => ADD_TOOLS.find(tool => tool.kind === placementDraft.value?.kind))
function startPlacement(kind, fields = {}) {
  if (!work.work || !canvasEl.value) return
  if (viewMulti.value) toggleMulti()
  cancelGesture?.()
  closeFloaters()
  drawerId.value = null
  ctxMenu.value = null
  blankCtx.value = null
  juncCtx.value = null
  selectedEdgeKey.value = null
  flowMode.value = 'idle'
  placement.start({ ...newNodeFields(kind), ...fields })
}
watch([scopeId, () => work.work?.id], placement.cancel, { flush: 'sync' })
function onCanvasDoubleClick() {
  if (!placementDraft.value && !placement.consumePlacementDoubleClick()) addNode('event')
}
function addNodeAt(kind, pt, fields = {}) {
  const s = newNodeSize({ kind })
  const spot = freeSpotFor(
    [...visNodes.value.map((n) => rectOf(n)).filter(Boolean), ...miniItems.value.map((i) => rectOf(i.node)).filter(Boolean)],
    s,
    pt.x - s.w / 2,
    pt.y - s.h / 2
  )
  const row = work.olnodeAdd(scopeId.value, {
    kind,
    title: kind === 'event' ? '新事件' : kind === 'container' ? '新容器' : '',
    canvasX: spot.x,
    canvasY: spot.y,
    ...fields
  })
  work.selOlnodeId = row.id
  return row
}
function addNode(kind, fields = {}) {
  const el = canvasEl.value
  const pt = el ? { x: (el.clientWidth / 2 - tx.value) / zoom.value, y: (el.clientHeight / 2 - ty.value) / zoom.value } : { x: 120, y: 120 }
  const row = addNodeAt(kind, pt, kind === 'note' ? { title: '新便签' } : kind === 'cite' ? { title: '' } : { ...fields })
  if (kind === 'cite') {
    const p = posOf(row)
    if (p) citePick.value = { nodeId: row.id, x: p.x, y: p.y }
  }
  return row
}
function onCitePick(t) {
  const st = citePick.value
  citePick.value = null
  if (st) work.olnodeSetCite(st.nodeId, t)
}
function applyTemplate(t) {
  work.olnodePushUndo(true)
  const created = work.olnodeBulkAdd(t.rows)
  for (const e of t.edges) {
    const src = created[e.from]
    const dst = created[e.to]
    if (!src || !dst) continue
    work.olnodeSetRels(src.id, [
      ...work.olnodeRelsOf(src.id),
      { id: uid(), toId: dst.id, label: e.label || '', kind: e.kind || '关联', arrows: '->', style: '' }
    ])
  }
  nextTick(fitView)
}

/* ---------- 断线定位 / 闪烁 ---------- */
const brokenCycle = ref(0)
const arrowsGlyph = (a) => ({ '->': '→', '<->': '↔', '--': '—' }[a] || '→')
const edgeStyleLabel = computed(() => (work.canvasPrefs.edgeStyle === 'ortho' ? '折线' : '曲线'))
/* 自定义模块类型（8.8.2-G2）：mtype 循环赋值（无 → 类型1 → … → 无） */
const mtypeColorOf = (name) => work.olTypes.find((t) => t.name === name)?.color || 'var(--text-dim)'
function cycleMtype(n) {
  const names = work.olTypes.map((t) => t.name)
  const i = names.indexOf(n.mtype || '')
  work.olnodeSetMtype(n.id, names[(i + 1) % (names.length + 1)] || '')
}
function locateBroken(list) {
  if (!list.length) return
  const n = list[brokenCycle.value % list.length]
  brokenCycle.value++
  work.selOlnodeId = n.id
  revealNode(n.id)
}
watch(
  () => work.canvasFocusTick,
  () => {
    if (work.selOlnodeId) revealNode(work.selOlnodeId)
    else focusScope(null)
  }
)
/* 撤销/删除导致当前层容器失效时，回到根层，避免停在一个不存在的画布。 */
watch(scopeId, (id) => {
  if ((work.canvasPrefs.scopeId || null) !== id) {
    work.canvasPrefs.scopeId = id
    work.saveCanvasPrefs()
  }
})

/* ---------- 键盘 / 生命周期 ---------- */
onMounted(() => {
  if(outlineWorkspace)outlineWorkspace.actions.value={add:startPlacement,settings:()=>updateSettings(true)}
  window.addEventListener('outline-command',outlineCommand)
  if (!ai.loaded) ai.loadSettings() // 保障入口置灰判定基于已装载的配置（幂等）
  migrateSides()
  ensurePlaced()
  // v0.4.2：容器内嵌 textboxes（上一实现）迁移为独立文本框子节点（可拖拽/连线/缩放）
  const legacy = live.value.filter((x) => x.kind === 'container' && (Array.isArray(x.textboxes) && x.textboxes.length))
  if (legacy.length) {
    work.olnodePushUndo(true)
    for (const c of legacy) {
      const box = rectOf(c) || { x: c.canvasX ?? 0, y: c.canvasY ?? 0, w: 280 }
      const rows = (c.textboxes || []).map((t, i) => ({
        kind: 'textbox',
        parentId: c.id,
        title: '',
        text: t.text || '',
        opacity: t.opacity != null ? t.opacity : 1,
        w: t.w || 180,
        h: t.h || 64,
        canvasX: (box.x ?? 0) + 10 + (i % 2) * (t.w || 180),
        canvasY: (box.y ?? 0) + 44 + Math.floor(i / 2) * (t.h || 64) + i * 8
      }))
      for (const r of rows) work.olnodeAdd(null, r)
      work.olnodeTextboxesSet(c.id, [])
    }
  }
  window.addEventListener('keydown', onKey)
  window.addEventListener('mousedown', onWinDown, true)
  window.addEventListener('resize', positionSettings)
  juncFlashTimer = setInterval(() => juncFlashTick.value++, 400)
  if (live.value.length) nextTick(() => { if (!restoreCamera(scopeId.value)) fitLayer(true) })
})
watch(() => work.work?.id, () => {
  settingsOpen.value = false
  searchOpen.value = false
  cancelGesture?.()
  routeCache.clear()
  selectedEdgeKey.value=null
  routeDraft.value=null
  connecting.value=null
  flowMode.value='idle'
  drawerId.value=null
  nextTick(() => { if (!restoreCamera(scopeId.value)) fitLayer(true) })
})
onBeforeUnmount(() => {
  window.removeEventListener('outline-command',outlineCommand)
  if(outlineWorkspace)outlineWorkspace.actions.value=null
  saveCamera()
  cancelGesture?.()
  routeCache.clear()
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('mousedown', onWinDown, true)
  window.removeEventListener('resize', positionSettings)
  clearInterval(juncFlashTimer)
})
</script>

<template>
  <div class="om-wrap" :class="{ 'oc-compact': work.canvasPrefs.density === 'compact', 'oc-root-scope': !scopeId, 'oc-background-visible': canvasOpacity < 100 }">

    <div v-if="outlineWorkspace" class="draft-canvas-head">
     <div class="draft-head-copy">
     <div class="bookline"><span>{{work.work?.title}}</span><Glyph name="chevron" :size="11"/><button type="button" @click="overview">全书情节</button><template v-for="c in scopeCrumbsList.filter(x=>x.id)" :key="c.id"><Glyph name="chevron" :size="11"/><button type="button" @click="focusScope(c.id)">{{c.title}}</button></template></div>
     <h1>故事大纲</h1><p class="subtitle">{{draftTotals.total}} 个事件 · {{draftTotals.blocks}} 个容器 · {{draftTotals.done}} 个事件已完成</p>
     </div>
     <div class="draft-head-tools">
       <button type="button" class="btn light" @click="startPlacement('event')"><Glyph name="plus" :size="13"/>新建事件</button>
       <button type="button" class="btn" @click="tidyAll"><Glyph name="tidy" :size="13"/>整理</button>
       <button type="button" class="btn" @click="overview"><Glyph name="expand" :size="13"/>总览</button>
       <button ref="settingsTrigger" type="button" class="btn draft-settings-toggle" aria-haspopup="dialog" :aria-expanded="settingsOpen" @click="updateSettings(!settingsOpen)"><Glyph name="gear" :size="13"/>画布设置</button>
       <Teleport to="body">
         <section v-if="settingsOpen" ref="settingsPanel" class="latent-canvas-settings" :style="settingsPosition" role="dialog" aria-label="画布设置" tabindex="-1">
           <header><h2>画布设置</h2><button type="button" class="latent-canvas-settings-close" aria-label="关闭画布设置" @click="updateSettings(false)"><Glyph name="close" :size="16"/></button></header>
           <div class="latent-canvas-settings-row">
             <span>连线形状</span>
             <div class="latent-canvas-settings-segment" role="group" aria-label="连线形状">
               <button type="button" :aria-pressed="work.canvasPrefs.edgeStyle !== 'ortho'" @click="setPref('edgeStyle', 'bezier')">曲线</button>
               <button type="button" :aria-pressed="work.canvasPrefs.edgeStyle === 'ortho'" @click="setPref('edgeStyle', 'ortho')">折线</button>
             </div>
           </div>
           <label class="latent-canvas-settings-range">
             <span>连线粗细</span><output>{{ edgeWidthModel.toFixed(1) }} px</output>
             <input v-model.number="edgeWidthModel" type="range" min="0.8" max="5" step="0.2" aria-label="连线粗细">
           </label>
           <label class="latent-canvas-settings-range">
             <span>箭头大小</span><output>{{ arrowSizeModel.toFixed(1) }}×</output>
             <input v-model.number="arrowSizeModel" type="range" min="0.5" max="3" step="0.1" aria-label="箭头大小">
           </label>
           <div class="latent-canvas-settings-row">
             <span>显示点阵</span>
             <button type="button" class="latent-canvas-settings-switch" role="switch" aria-label="显示点阵" :aria-checked="dotsVisible" @click="setPref('showDots', !dotsVisible)"></button>
           </div>
         </section>
       </Teleport>
       <div class="viewtoggle"><button type="button" class="on">画布</button><button type="button" @click="work.outlineView='text'">文本</button></div>
     </div>
    </div>
    <template v-if="outlineWorkspace">
     <div class="draft-create creation glass oc-module-tools"><button type="button" class="tool" :class="{chosen:!viewMulti&&!placementDraft}" aria-label="选择" title="退出放置或多选" @click="placement.cancel(); viewMulti&&toggleMulti()"><Glyph name="pointer"/><span>选择</span></button><i></i><template v-for="tool in ADD_TOOLS" :key="tool.kind"><NDropdown v-if="tool.kind==='anchor'||tool.kind==='volume'" trigger="click" :options="tool.kind==='anchor'?anchorMenuOptions:volumeMenuOptions" @select="onModuleSelect(tool.kind,$event)"><button type="button" class="tool" :title="'添加'+(tool.kind==='anchor'?'章节':tool.label)" :class="{ chosen: placementDraft?.kind === tool.kind, 'oc-placement-active': placementDraft?.kind === tool.kind }"><Glyph :name="tool.kind==='anchor'?'anchor':'volume'"/><span>{{tool.kind==='anchor'?'章节':tool.label}}</span></button></NDropdown><button v-else type="button" class="tool" :title="'添加'+tool.label" :aria-pressed="placementDraft?.kind === tool.kind" :class="{ chosen: placementDraft?.kind === tool.kind, 'oc-placement-active': placementDraft?.kind === tool.kind }" @click="startPlacement(tool.kind)"><Glyph :name="tool.kind==='cite'?'link':tool.kind==='textbox'?'text':tool.kind"/><span>{{tool.label}}</span></button></template></div>
     <div class="draft-zoom zoom glass"><button type="button" class="btn" aria-label="缩小" @click="zoom=Math.max(.3,zoom-.15)">−</button><button type="button" class="draft-percent" title="恢复 100%" @click="zoom=1">{{Math.round(zoom*100)}}%</button><button type="button" class="btn" aria-label="放大" @click="zoom=Math.min(2.2,zoom+.15)">+</button><i></i><button type="button" class="btn" @click="fitView"><Glyph name="expand" :size="13"/>总览</button></div>
     <div class="draft-legend legend"><span><i></i>情节推进</span><span><i class="dashed"></i>关联与伏笔</span></div>
    </template>

    <div v-if="!outlineWorkspace" class="oc-workspace-head"><div><div class="oc-eyebrow">OUTLINE · 故事大纲</div><h1>{{ scopeTitle }}<small v-if="scopeId">容器内部</small></h1><p>{{ scopeMetaText }}</p></div><div class="oc-head-actions"><button type="button" @click="overview">总览</button><button type="button" @click="expandAllDeep">展开全部</button><button type="button" @click="collapseAllDeep">收起全部</button><button type="button" @click="tidyAll">整理布局</button><button type="button" @click="work.outlineView='text'">文本视图</button><TaskLauncher module="outline" /></div></div>
    <div v-if="!outlineWorkspace || searchOpen" :class="outlineWorkspace ? 'draft-canvas-search' : 'oc-scopebar'">
      <button v-if="!outlineWorkspace && scopeId" class="oc-back" type="button" title="返回上一级" @click="goBack"><OIcon name="back" :size="12" /> 上一级</button>
      <nav v-if="!outlineWorkspace" class="oc-crumbs" aria-label="大纲层级">
        <template v-for="(c, i) in scopeCrumbsList" :key="c.id || 'root'">
          <i v-if="i">›</i>
          <button type="button" :aria-current="c.id === scopeId ? 'page' : undefined" @click="focusScope(c.id)">{{ c.title }}</button>
        </template>
      </nav>
      <span v-if="!outlineWorkspace" class="oc-scope-meta">{{ scopeMetaText }}</span>
      <div class="oc-scope-tools">
        <div class="oc-search-wrap">
          <label class="oc-search">
            <OIcon name="search" :size="12" />
            <input ref="searchEl" v-model="searchQuery" placeholder="搜索全部层级…" aria-label="搜索全部层级" @focus="searchOpen = true" @input="searchOpen = true" @keydown.esc="searchOpen = false" />
            <kbd>Ctrl K</kbd>
          </label>
          <div v-if="searchOpen && searchQuery.trim()" class="oc-search-results">
            <button v-for="r in searchResults" :key="r.node.id" type="button" class="oc-search-item" @click="selectSearchResult(r.node.id)">
              <span class="oc-kind-tag">{{ r.kind }}</span>
              <span style="min-width:0"><b>{{ r.node.title || '（未命名）' }}</b><small>{{ r.path }}</small></span>
            </button>
            <p v-if="!searchResults.length" style="padding:8px;font-size:10px;color:var(--text-dim);margin:0">没有匹配的模块。</p>
          </div>
        </div>
      </div>
    </div>
    <div v-if="!outlineWorkspace" class="om-toolbar oc-toolbar">
      <div class="oc-module-tools">
        <template v-for="tool in ADD_TOOLS" :key="tool.kind">
          <NDropdown v-if="tool.kind === 'anchor' || tool.kind === 'volume'" trigger="click" :options="tool.kind === 'anchor' ? anchorMenuOptions : volumeMenuOptions" @select="onModuleSelect(tool.kind, $event)">
            <button type="button" :title="'添加'+tool.label" :class="{ chosen: placementDraft?.kind === tool.kind, 'oc-placement-active': placementDraft?.kind === tool.kind }"><OIcon :name="tool.icon" :size="14" />{{ tool.label }}</button>
          </NDropdown>
          <button v-else type="button" :title="'添加'+tool.label" :aria-pressed="placementDraft?.kind === tool.kind" :class="{ chosen: placementDraft?.kind === tool.kind, 'oc-placement-active': placementDraft?.kind === tool.kind }" @click="startPlacement(tool.kind)"><OIcon :name="tool.icon" :size="14" />{{ tool.label }}</button>
        </template>
      </div>
      <button class="oc-chip" type="button" :class="{on:viewMulti}" :aria-pressed="viewMulti" @click="toggleMulti">多选</button>
      <span class="oc-count">{{ visNodes.length }} 模块 · {{ edges.length }} 连线</span>
      <div class="oc-line-modes" aria-label="连线样式"><button type="button" :aria-pressed="work.canvasPrefs.edgeStyle !== 'ortho'" @click="setPref('edgeStyle','bezier')">流畅曲线</button><button type="button" :aria-pressed="work.canvasPrefs.edgeStyle === 'ortho'" @click="setPref('edgeStyle','ortho')">圆角折线</button></div>
      <NPopover trigger="click" :show-arrow="false">
        <template #trigger>
          <span class="oc-chip" title="画布设置：连线粗细等"><OIcon name="gear" :size="12" /> 设置</span>
        </template>
        <div class="oc-settings"><div class="oc-settings-options"><button type="button" class="oc-chip" :class="{on:work.canvasPrefs.snap}" @click="setPref('snap',!work.canvasPrefs.snap)">网格吸附</button><button class="oc-chip" type="button" @click="setPref('density',work.canvasPrefs.density==='compact'?'detail':'compact')">{{ work.canvasPrefs.density==='compact'?'切换详细卡片':'切换紧凑卡片' }}</button><button v-if="work.olBroken.tails.length" class="oc-chip" type="button" @click="locateBroken(work.olBroken.tails)">烂尾 {{ work.olBroken.tails.length }}</button><button v-if="work.olBroken.missing.length" class="oc-chip" type="button" @click="locateBroken(work.olBroken.missing)">缺铺垫 {{ work.olBroken.missing.length }}</button></div>
          <div class="oc-settings-row">
            <span class="oc-settings-label">画布透明度</span>
            <NSlider v-model:value="canvasOpacityModel" :min="0" :max="100" :step="1" style="width: 150px" />
            <span class="oc-settings-val">{{ canvasOpacity }}%</span>
          </div>
          <div class="oc-settings-row">
            <span class="oc-settings-label">连线粗细</span>
            <NSlider v-model:value="edgeWidthModel" :min="0.8" :max="5" :step="0.2" style="width: 150px" />
            <span class="oc-settings-val">{{ (work.canvasPrefs.edgeWidth || 1.6).toFixed(1) }}px</span>
          </div>
          <div class="oc-settings-row">
            <span class="oc-settings-label">箭头大小</span>
            <NSlider v-model:value="arrowSizeModel" :min="0.5" :max="3" :step="0.1" style="width: 150px" />
            <span class="oc-settings-val">{{ (work.canvasPrefs.arrowSize || 1).toFixed(1) }}×</span>
          </div>
          <div class="oc-settings-tip">画布透明度只影响底色与点阵，模块和连线保持不透明；线型与箭头方向在连线编辑浮层中按条设置。</div>
        </div>
      </NPopover>
      <button class="om-btn" title="撤销 (Ctrl+Z)" @click="work.olnodeUndo()">↶</button>
      <button class="om-btn" title="重做 (Ctrl+Y)" @click="work.olnodeRedo()">↷</button>
      <div class="oc-zoom-controls"><button class="om-btn" title="缩小" @click="zoom = Math.max(0.3, zoom - 0.15)"><OIcon name="minus" :size="13" /></button>
      <button class="oc-zoom" title="恢复 100% 缩放" @click="zoom = 1">{{ Math.round(zoom * 100) }}%</button>
      <button class="om-btn" title="放大" @click="zoom = Math.min(2.2, zoom + 0.15)"><OIcon name="plus" :size="13" /></button>
      <button class="om-btn text" title="适应当前层" @click="fitView">适应</button></div>
    </div>

    <div v-if="outlineWorkspace&&(scopedRelations.external.in.size||scopedRelations.external.out.size)" class="draft-cross-lanes" aria-label="跨层故事关系">
      <template v-for="[direction,label] in [['in','前接'],['out','后续']]" :key="direction"><button v-for="id in [...scopedRelations.external[direction]]" :key="direction+id" type="button" @click="revealNode(id)"><small>{{label}}</small><span>{{nodeById(id)?labelOf(nodeById(id)):'外部情节'}}</span><Glyph name="chevron" :size="11"/></button></template>
    </div>
    <div ref="canvasEl" class="om-canvas oc-canvas" :data-flow-state="flowMode" @mousedown.capture="placement.onCanvasMouseDown" @mousedown="onPanStart" @wheel.prevent="onWheelC" @dblclick.self="onCanvasDoubleClick" @contextmenu.prevent="onCanvasCtx">
      <div
        v-if="placementDraft"
        class="oc-placement-surface"
        @pointerenter="placement.move"
        @pointermove="placement.move"
        @pointerleave="placement.leave"
        @mousedown.stop.prevent
        @click.stop="placement.confirm"
        @contextmenu.stop.prevent="placement.cancel"
      >
        <span class="oc-placement-hint" role="status">点击画布放置 · Esc 取消</span>
      </div>
      <div v-if="!outlineWorkspace" class="oc-canvas-surface" :style="{ opacity: canvasOpacity / 100 }" aria-hidden="true"></div>
      <div v-else-if="dotsVisible" class="draft-canvas-dots" :style="dotGridStyle" aria-hidden="true"></div>
      <div class="om-inner" :style="innerStyle">
        <OutlinePlacementGhost
          v-if="placementGhost"
          :kind="placementGhost.node.kind"
          :label="placementTool?.label"
          :icon="placementTool?.icon"
          :title="placementGhost.node.title"
          :rect="placementGhost.rect"
          :paper="paperFor(placementGhost.node)"
        />
        <svg
          class="om-edges oc-edges"
          :style="{ left: svgBox.x + 'px', top: svgBox.y + 'px' }"
          :width="svgBox.w"
          :height="svgBox.h"
          :viewBox="svgBox.x + ' ' + svgBox.y + ' ' + svgBox.w + ' ' + svgBox.h"
        >
          <g v-for="e in edges" :key="e.key" class="oc-edge" :class="{ selected: selectedEdgeKey === e.key, blocked: e.status === 'blocked', projected: e.projected, grouped: e.group }" :data-rel="e.rel?.id || e.key" :data-edge-key="e.key" :data-status="e.status">
            <path class="oc-edge-highlight" :d="e.d" fill="none" stroke="var(--accent)" :stroke-width="relEdgeWidth(e.rel) + 3 / zoom" />
            <path class="oc-edge-visible" :d="e.dTrim || e.d" fill="none" :stroke="e.color" :stroke-width="relEdgeWidth(e.rel)" :stroke-dasharray="e.status === 'blocked' ? '4 6' : e.dashed" />
            <circle v-if="e.projectedTo" :cx="e.b.x" :cy="e.b.y" r="2.8" fill="var(--bg-panel, #fffef9)" :stroke="e.color" stroke-width="1.2" />
            <circle v-if="e.projectedFrom" :cx="e.a.x" :cy="e.a.y" r="2.4" fill="var(--bg-panel, #fffef9)" :stroke="e.color" stroke-width="1.1" />
            <path class="oc-edge-hit" :d="e.d" vector-effect="non-scaling-stroke" :data-edge-key="e.key" :data-owner="e.ownerId || ''" :data-rel="e.rel?.id || ''" @mousedown.stop="startEdgeShape($event, e)" @dblclick.stop="onEdgeDbl(e)" @contextmenu.prevent.stop="openEdgeCtxFromEvent($event, e)">
              <title>{{ e.group ? `合并关系 · ${e.relations.length} 条真实连线` : e.status === 'blocked' ? '路径受阻 · 请移动模块或调整路径' : '单击选中 · 拖动手柄调整路径或端点 · 双击编辑' }}</title>
            </path>
          </g>
          <polygon v-for="(h, i) in edgeDecor.heads" :key="'a' + i" :points="h" :fill="edgeDecor.fills[i]" />
          <!-- 连接点（v1.0.13）：钉在宿主连线路径上——默认微观透明小圆点；创建后 1.6s 内 flash 高亮（加深显形）便于确认位置，随后淡出隐藏。
               热区圆承担两类操作：mousedown 引出连线（连接点作起点）、被模块锚点拖线命中（作终点）、右键删除 -->
          <g v-for="j in junctionItems" :key="'j' + j.key" class="oc-junc" :class="{ flash: j.flash }">
            <circle class="oc-junc-hit" :cx="j.x" :cy="j.y" :r="10 / zoom" fill="transparent" :data-junc="j.key" @mousedown.stop.prevent="startConnectFromJunction($event, j)" @contextmenu.prevent.stop="openJunctionCtx($event, j)">
              <title>连接点——按住拖出连线 / 模块锚点拖到此接线 · 右键删除</title>
            </circle>
            <circle class="oc-junc-dot" :cx="j.x" :cy="j.y" r="2.5" />
          </g>
          <path v-if="connecting" class="oc-connection-preview" :class="{ blocked: connGeometry?.status === 'blocked' }" :d="connPath" fill="none" stroke="var(--accent)" stroke-width="2" vector-effect="non-scaling-stroke" stroke-dasharray="6 4" />
          <circle v-if="connecting?.candidate" class="oc-snap-indicator" :cx="connecting.candidate.point.x" :cy="connecting.candidate.point.y" :r="8 / zoom" vector-effect="non-scaling-stroke" />
          <g v-if="selectedEdge && !connecting && !selectedEdge.group && !selectedEdge.projected" class="oc-selection-handles">
            <circle v-for="end in ['source', 'target']" :key="end" class="oc-endpoint" :data-end="end" :cx="end === 'source' ? selectedEdge.a.x : selectedEdge.b.x" :cy="end === 'source' ? selectedEdge.a.y : selectedEdge.b.y" :r="5 / zoom" vector-effect="non-scaling-stroke" @mousedown.stop="startReconnect($event, selectedEdge, end)"><title>拖动以重连{{ end === 'source' ? '起点' : '终点' }}</title></circle>
            <circle v-for="h in routeHandles" :key="h.key" class="oc-route-handle" :class="{ horizontal: h.horizontal, curve: h.curve }" :cx="h.point.x" :cy="h.point.y" :r="4 / zoom" vector-effect="non-scaling-stroke" @mousedown.stop="startRouteAdjust($event, h)"><title>{{ h.curve ? '拖动调整曲线路径' : '沿垂直方向拖动线段' }}</title></circle>
          </g>
        </svg>

        <!-- 容器 / 节点层 -->
        <div
          v-for="n in visNodes"
          :key="n.id"
          class="oc-node"
          :data-node-id="n.id"
          :class="['oc-' + n.kind, 'sh-' + (n.shape || 'process'), { node:!!outlineWorkspace && !['container','textbox'].includes(n.kind), event:!!outlineWorkspace && n.kind==='event', note:!!outlineWorkspace && n.kind==='note', cite:!!outlineWorkspace && n.kind==='cite', anchor:!!outlineWorkspace && n.kind==='anchor', selected:!!outlineWorkspace && work.selOlnodeId===n.id, sel: work.selOlnodeId === n.id, flash: flashIds.has(n.id), pinned: n.pin, resizing: resizing === n.id, 'oc-small-card': n.kind !== 'container' && rectOf(n).h < 92, 'resize-smooth': resizeSmooth && resizing === n.id, editing: editText && editText.id === n.id, 'drop-target': miniDrag && miniDrag.moved && miniDrag.targetId === n.id }]"
          :style="nodeStyle(n)"
          :data-outline-citation="n.kind === 'cite' && n.refId ? '' : null"
          :data-dl-target="n.kind === 'cite' && n.refId ? n.refId : null"
          :data-dl-title="n.kind === 'cite' ? labelOf(n) : null"
          @mousedown="onNodeDown($event, n)"
          @dblclick.stop="onDblNode(n)"
          @click.stop="n.kind === 'cite' && !viewMulti && selectMini(n)"
          @contextmenu.prevent="onNodeCtx($event, n)"
        >
          <template v-if="n.kind === 'container'">
            <div class="oc-cmeta"><span class="oc-container-kind">容器</span>
              <span class="oc-cchapter">{{ n.chapter || '故事片段' }}</span>
              <span v-if="containerProgress(n).blocks">{{ containerProgress(n).blocks }} 个子容器</span>
            </div>
            <div class="oc-chead">
              <button class="oc-caret" :title="isExpanded(n.id) ? '收起内容' : '就地展开'" @click.stop="toggleInline(n.id)"><OIcon :name="isExpanded(n.id) ? 'caret-down' : 'caret-right'" :size="11" /></button>
              <span class="oc-ctitle">{{ n.title || '容器' }}</span>
              <button class="oc-inline-toggle" type="button" @click.stop="toggleInline(n.id)">{{ isExpanded(n.id) ? '收起内容 −' : '就地展开 ＋' }}</button>
            </div>
            <p class="oc-csummary">{{ containerSummary(n) }}</p>
            <div class="oc-cprogress">
              <span class="oc-state-dot" :style="{ '--state-color': containerProgress(n).complete ? '#78977b' : containerProgress(n).done ? '#b29a65' : '#b8bfa9' }" />
              <span>{{ containerProgress(n).complete ? '已完成' : containerProgress(n).done ? '进行中' : '待展开' }}</span>
              <div class="bar"><i :style="{ width: containerProgress(n).pct + '%' }" /></div>
              <span class="done">{{ containerProgress(n).total ? containerProgress(n).done + ' / ' + containerProgress(n).total : '待添加事件' }}</span>
            </div>
            <div class="oc-cfoot">
              <button class="enter" type="button" @click.stop="focusScope(n.id)">进入容器 ↗</button>
              <button class="inspect" type="button" @click.stop="drawerId = n.id">设置</button>
            </div>
          </template>
          <template v-else>
            <span v-if="paperFor(n)" class="oc-paper" :class="paperClass(n)" :style="paperFor(n)" aria-hidden="true" />
            <!-- 菱形/平行四边形：SVG 描边代替 clip-path（clip 会裁掉边框、锚点与手柄） -->
            <svg v-if="n.kind === 'event' && (n.shape === 'diamond' || n.shape === 'para')" class="oc-shape" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              <polygon :points="shapePoly(n)" />
            </svg>
            <span v-if="n.kind === 'anchor' && chapterOf(n)" class="ol-dot" :data-s="chapterOf(n).status" :title="STATUS_LABEL[chapterOf(n).status]" />
            <textarea
              v-if="editText && editText.id === n.id"
              ref="inlineEl"
              v-model="editText.value"
              class="oc-inline-edit"
              spellcheck="false"
              title="Ctrl+Enter 提交 · Esc 取消"
              @mousedown.stop
              @dblclick.stop
              @blur="commitInline"
              @keydown.esc.prevent="editText = null"
              @keydown.ctrl.enter.prevent="commitInline"
            ></textarea>
            <OutlineCardText
              v-else-if="['cite', 'volume', 'event'].includes(n.kind)"
              :kind="n.kind"
              :shape="n.shape"
              :rect="rectOf(n)"
              :title="labelOf(n)"
              :summary="n.kind === 'volume' ? subOf(n) : plainText(n).trim() || subOf(n)"
              :status="n.kind === 'event' ? statusLabel(n) : ''"
              :status-color="n.kind === 'event' ? statusColor(n) : ''"
              :subtype="n.mtype"
              :association="n.kind === 'event' ? chapterLabel(n) || '未关联章节' : ''"
              :relation-count="n.kind === 'event' ? relsFor(n).length : 0"
              :needs-target="n.kind === 'cite' && !n.refId"
              @choose-target="chooseCitation(n)"
            >
              <template #actions>
                <button class="gv-more" title="模块操作（与右键菜单相同）" aria-label="模块操作" @mousedown.stop.prevent @click.stop="onNodeCtx($event, n)">⋯</button>
              </template>
            </OutlineCardText>
            <div v-else-if="outlineWorkspace && n.kind!=='textbox'" class="draft-card-body"><div class="node-meta"><span><Glyph :name="n.kind==='cite'?'link':n.kind" :size="13"/>{{({event:'事件',note:'便签',cite:'引用',anchor:'章节',volume:'卷'})[n.kind]||'模块'}}<em v-if="n.mtype"> / {{n.mtype}}</em></span><span v-if="n.kind==='event'" class="status" :class="{done:n.status==='done',doing:n.status==='writing'}"><Glyph v-if="n.status==='done'" name="check" :size="10"/>{{draftStatus(n)}}</span></div><h3>{{labelOf(n)}}</h3><p>{{plainText(n).split("\n").find(line=>line.trim())}}</p><footer v-if="n.kind==='event'"><Glyph name="anchor" :size="12"/>{{chapterLabel(n)||'未关联章节'}}<span>{{relsFor(n).length?relsFor(n).length+' 条关系':''}}</span></footer></div>
            <div v-else class="oc-body" :class="{ 'oc-textbody': n.kind === 'textbox' }">
              <div v-if="n.kind !== 'textbox' && showCardChrome(n)" class="oc-kicker">
                <span>{{ KIND_LABEL_DESIGN[n.kind] || '模块' }}</span>
                <span v-if="n.kind === 'event'" class="oc-index">{{ nodeIndexLabel(n) }}</span>
                <button class="gv-more" title="模块操作（与右键菜单相同）" @mousedown.stop.prevent @click.stop="onNodeCtx($event, n)">⋯</button>
              </div>
              <div class="oc-label">{{ labelOf(n) }}</div>
              <div v-if="showFullText(n)" class="oc-fulltext">{{ plainText(n) }}</div>
              <div v-else class="om-sub">{{ plainText(n).split('\n')[0].slice(0, 40) || subOf(n) || '&nbsp;' }}</div>
              <span v-if="!showFullText(n) && n.mtype && cardDensity !== 'compact'" class="om-mtype" :style="{ color: mtypeColorOf(n.mtype), borderColor: mtypeColorOf(n.mtype) }">{{ n.mtype }}</span>
              <div v-if="n.kind === 'event' && showCardChrome(n)" class="oc-status-text oc-foot-status">
                <i class="oc-state-dot" :style="{ '--state-color': statusColor(n) }" />
                {{ statusLabel(n) }}
              </div>
            </div>
          </template>
          <button v-if="viewMulti && n.parentId === scopeId" class="oc-pick-toggle" :class="{ on: picked.has(n.id) }" type="button" title="选择此模块" @mousedown.stop @click.stop="togglePick(n.id)">{{ picked.has(n.id) ? '✓' : '+' }}</button>

          <span v-for="sd in ['top', 'right', 'bottom', 'left']" :key="sd" class="oc-apt" :class="{ 'snap-target': connecting?.candidate?.nodeId === n.id && connecting?.candidate?.side === sd }" :style="n.shape === 'para' && (sd === 'left' || sd === 'right') ? { [sd]: 'calc(6.8% - 4.5px)' } : null" :data-side="sd" :title="'拖到目标模块或连接点建立连线'" @mousedown="startConnect($event, n)" />
          <span class="oc-rs" data-dir="e" title="拖拽调整宽度" @mousedown="startResize($event, n, 'e')" />
          <span class="oc-rs" data-dir="w" title="拖拽调整宽度" @mousedown="startResize($event, n, 'w')" />
          <span class="oc-rs" data-dir="s" title="拖拽调整高度" @mousedown="startResize($event, n, 's')" />
          <span class="oc-rs" data-dir="n" title="拖拽调整高度" @mousedown="startResize($event, n, 'n')" />
          <span class="oc-rs oc-rs-corner" data-dir="se" title="拖拽调整大小" @mousedown="startResize($event, n, 'se')" />
          <span class="oc-rs oc-rs-corner" data-dir="sw" title="拖拽调整大小" @mousedown="startResize($event, n, 'sw')" />
          <span class="oc-rs oc-rs-corner" data-dir="ne" title="拖拽调整大小" @mousedown="startResize($event, n, 'ne')" />
          <span class="oc-rs oc-rs-corner" data-dir="nw" title="拖拽调整大小" @mousedown="startResize($event, n, 'nw')" />
        </div>

        <!-- 就地展开的迷你卡：按顶层容器分组，内容区可滚动；连线矩形随 scrollOffsets 位移 -->
        <div
          v-for="group in miniGroups"
          :key="'mini-scroll-' + group.id"
          class="oc-mini-scroll"
          :style="miniScrollStyle(group)"
          :data-mini-scroll="group.id"
          :ref="(el) => setMiniScrollEl(group.id, el)"
          @scroll="onMiniScroll(group.id, $event)"
          @mousedown.stop
          @click.stop
          @wheel.stop
        >
          <div class="oc-mini-content" :style="{ height: group.contentH + 'px' }">
            <div
              v-for="item in group.items"
              :key="'mini-' + item.node.id"
              class="oc-mini"
              :class="[
                'oc-mini-' + item.node.kind,
                'sh-' + (item.node.shape || 'process'),
                {
                  sel: work.selOlnodeId === item.node.id,
                  flash: flashIds.has(item.node.id),
                  editing: editText && editText.id === item.node.id,
                  'oc-mini-event': item.node.kind === 'event',
                  'oc-mini-container': item.node.kind === 'container',
                  dragging: miniDrag && miniDrag.moved && miniDrag.id === item.node.id,
                  'drop-target': miniDrag && miniDrag.moved && miniDrag.targetId === item.node.id
                }
              ]"
              :style="miniStyle(item, group)"
              :data-node-id="item.node.id"
              :data-mini-id="item.node.id"
              :data-outline-citation="item.node.kind === 'cite' && item.node.refId ? '' : null"
              :data-dl-target="item.node.kind === 'cite' && item.node.refId ? item.node.refId : null"
              :data-dl-title="item.node.kind === 'cite' ? labelOf(item.node) : null"
              @mousedown="onMiniDown($event, item)"
              @click.stop="selectMini(item.node)"
              @dblclick.stop="onMiniDbl(item)"
              @contextmenu.prevent="onNodeCtx($event, item.node)"
            >
              <span v-if="paperFor(item.node)" class="oc-paper" :class="paperClass(item.node)" :style="paperFor(item.node)" aria-hidden="true" />
              <div class="oc-mini-content" :class="{ 'oc-mini-fitted': ['cite', 'volume', 'event'].includes(item.node.kind) }">
                <div v-if="!['cite', 'volume', 'event'].includes(item.node.kind)" class="oc-mini-top">
                  <span class="oc-mini-kind">{{ KIND_LABEL_DESIGN[item.node.kind] || '模块' }}</span>
                  <span class="oc-mini-state">
                    <i v-if="item.node.kind === 'event'" class="oc-state-dot" :style="{ '--state-color': statusColor(item.node) }" />
                    {{ item.node.kind === 'event' ? statusLabel(item.node) : (item.node.kind === 'container' ? `${containerProgress(item.node).done}/${containerProgress(item.node).total}` : '') }}
                  </span>
                </div>
                <template v-if="item.node.kind === 'container'">
                  <h3 class="oc-mini-title">{{ item.node.title || '容器' }}</h3>
                  <p class="oc-mini-body">{{ containerSummary(item.node) }}</p>
                  <div class="oc-mini-actions">
                    <button class="enter" type="button" @click.stop="focusScope(item.node.id)">进入 ↗</button>
                    <button type="button" @click.stop="toggleInline(item.node.id)">{{ isExpanded(item.node.id) ? '收起' : '展开' }}</button>
                    <button class="more" type="button" @click.stop="drawerId = item.node.id">设置</button>
                  </div>
                </template>
                <template v-else>
                  <textarea
                    v-if="editText && editText.id === item.node.id"
                    ref="inlineEl"
                    v-model="editText.value"
                    class="oc-mini-inline"
                    spellcheck="false"
                    @mousedown.stop
                    @dblclick.stop
                    @blur="commitInline"
                    @keydown.esc.prevent="editText = null"
                    @keydown.ctrl.enter.prevent="commitInline"
                  ></textarea>
                  <OutlineCardText
                    v-else-if="['cite', 'volume', 'event'].includes(item.node.kind)"
                    :kind="item.node.kind"
                    :shape="item.node.shape"
                    :rect="item.rect"
                    :title="labelOf(item.node)"
                    :summary="item.node.kind === 'volume' ? subOf(item.node) : plainText(item.node).trim() || subOf(item.node)"
                    :status="item.node.kind === 'event' ? statusLabel(item.node) : ''"
                    :status-color="item.node.kind === 'event' ? statusColor(item.node) : ''"
                    :subtype="item.node.mtype"
                    :association="item.node.kind === 'event' ? chapterLabel(item.node) || '未关联章节' : ''"
                    :relation-count="item.node.kind === 'event' ? relsFor(item.node).length : 0"
                    :needs-target="item.node.kind === 'cite' && !item.node.refId"
                    @choose-target="chooseCitation(item.node)"
                  >
                    <template v-if="item.node.kind === 'event'" #actions>
                      <button class="gv-more" type="button" aria-label="模块操作" title="模块操作" @mousedown.stop.prevent @click.stop="onNodeCtx($event, item.node)">⋯</button>
                    </template>
                  </OutlineCardText>
                  <template v-else>
                    <h3 class="oc-mini-title">{{ labelOf(item.node) }}</h3>
                    <p v-if="item.node.kind !== 'textbox'" class="oc-mini-body">{{ plainText(item.node).split('\n')[0].slice(0, 70) || subOf(item.node) }}</p>
                  </template>
                  <div class="oc-mini-actions">
                    <button type="button" @click.stop="drawerId = item.node.id">编辑</button>
                    <button v-if="item.node.kind !== 'event'" class="more" type="button" @click.stop="onNodeCtx($event, item.node)">⋯</button>
                  </div>
                </template>
              </div>
              <span v-for="sd in ['top', 'right', 'bottom', 'left']" :key="sd" class="oc-apt" :data-side="sd" title="拖到目标模块或连接点建立连线" @mousedown.stop="startConnect($event, item.node)" />
            </div>
          </div>
        </div>

        <!-- 迷你卡拖影：挂在画布内层，拖出容器内容区时不裁剪 -->
        <div
          v-if="miniDrag && miniDrag.moved"
          class="oc-mini-ghost"
          :class="'oc-mini-' + miniDrag.node.kind"
          :style="{ left: miniDrag.ghostX + 'px', top: miniDrag.ghostY + 'px', width: miniDrag.w + 'px', height: miniDrag.h + 'px' }"
        >
          <div class="oc-mini-top">
            <span class="oc-mini-kind">{{ KIND_LABEL_DESIGN[miniDrag.node.kind] || '模块' }}</span>
          </div>
          <h3 class="oc-mini-title">{{ labelOf(miniDrag.node) }}</h3>
        </div>

        <template v-if="selectedEdge && !connecting && !selectedEdge.group && !selectedEdge.projected">
          <button v-for="end in ['source','target']" :key="'endpoint-'+end" class="oc-endpoint-control" :data-end="end" :aria-label="end === 'source' ? '重连起点' : '重连终点'" :style="{left:(end === 'source' ? selectedEdge.a.x : selectedEdge.b.x)+'px',top:(end === 'source' ? selectedEdge.a.y : selectedEdge.b.y)+'px',width:14/zoom+'px',height:14/zoom+'px'}" @mousedown.stop="startReconnect($event,selectedEdge,end)" />
        </template>

        <!-- 关系链接令牌卫星 -->
        <a
          v-for="st in sats"
          :key="st.key"
          class="om-sat dl-link oc-sat"
          href="javascript:;"
          :style="{ left: st.x + 'px', top: st.y + 'px' }"
          :data-dl-target="st.resolved ? st.resolved.kind + ':' + st.resolved.id : ''"
          :data-dl-title="st.title"
          :title="st.resolved ? '点击跳转 · 悬停预览' : '未找到目标内容'"
          @click.stop.prevent="st.resolved && jumpTo(st.resolved)"
        >
          <span class="dl-kind">{{ st.resolved ? KIND_LABEL[st.resolved.kind] : '?' }}</span>
          <span class="om-sat-text">{{ st.display }}</span>
        </a>

        <!-- 连线标签（纯展示 + 双击拉直；左键编辑入口已随塑形改版取消） -->
        <div
          v-for="e in edges.filter((x) => x.label || x.status === 'blocked')"
          :key="'l' + e.key"
          class="oc-elabel" :class="{ selected: selectedEdgeKey === e.key, blocked: e.status === 'blocked', projected: e.projected, grouped: e.group }"
          @mousedown.stop="startEdgeShape($event, e)"
          :style="{ left: e.mid.x + 'px', top: e.mid.y + 'px', borderColor: e.color, color: e.color }"
          @dblclick.stop="onEdgeDbl(e)"
          @contextmenu.prevent.stop="openEdgeCtxFromEvent($event, e)"
        >{{ e.status === 'blocked' ? '路径受阻' : e.label }}</div>

        <Teleport to=".app-root" v-if="selectedEdge && !connecting && flowMode !== 'adjust' && !edgeEdit">
          <div class="oc-edge-tools" :style="edgeToolsStyle" @mousedown.stop>
            <span class="oc-edge-tools-status">{{ selectedEdge.group ? `合并关系 · ${selectedEdge.relations.length} 条` : selectedEdge.projected ? '投影连线' : selectedEdge.status === 'blocked' ? '路径受阻' : selectedEdge.rel.routing || selectedEdge.rel.custom ? '手动路径' : '自动路径' }}</span>
            <button :title="selectedEdge.group ? '查看真实关系' : '编辑连线属性与标签'" @click="onEdgeDbl(selectedEdge)">{{ selectedEdge.group ? '详情' : '编辑' }}</button>
            <button v-if="!selectedEdge.group && !selectedEdge.projected" title="清除手动路径偏好并重新布线" @click="resetRoute()">恢复自动路径</button>
            <button class="danger" title="删除连线（Delete）" @click="deleteSelectedEdge">删除</button>
          </div>
        </Teleport>

        <!-- 边编辑浮层：挂 .app-root（theme-* 的 CSS 变量在此元素上，Teleport 到 body 会丢失背景色变透明），
           fixed 定位不受画布缩放影响，尺寸恒定 -->
      <Teleport to=".app-root" v-if="edgeEdit">
      <div class="oc-eedit" :class="['dir-' + (edgeEdit.dir || 'up')]" :style="{ position: 'fixed', left: edgeEdit.mx + 'px', top: edgeEdit.my + 'px' }" @mousedown.stop @contextmenu.prevent.stop>
          <div class="oc-eedit-title">编辑连线</div>
          <div class="oc-eedit-row">
            <input ref="edgeLabelInput" class="rp-input" :value="curRel()?.label || ''" placeholder="连线标签…" @input="patchRel({ label: $event.target.value })" @keydown.enter="edgeEdit = null" @keydown.esc="edgeEdit = null" />
            <button class="om-btn" :title="edgeEdit && curRel() ? '箭头：' + { '->': '单向', '<->': '双向', '--': '无向' }[curRel().arrows || '->'] : '箭头'" @click="patchRel({ arrows: cycleArrow(curRel()?.arrows || '->') })">{{ arrowsGlyph(curRel()?.arrows) }}</button>
            <button class="om-btn oc-mini-x" title="删除连线" @click="removeRel"><OIcon name="close" :size="12" /></button>
          </div>
          <!-- 右键打开时提供「在此处创建连接点」（落点 = 右键位置，投影到真实路径） -->
          <button v-if="edgeCtx && !selectedEdge?.projected" class="oc-ctx-item oc-eedit-juncbtn" title="在右键位置的连线上创建连接点（模块锚点拖线到连接点、或按住连接点拖出连线互连）" @click="edgeCtxCreate">
            <OIcon name="link" :size="13" /> 在此处创建连接点
          </button>
          <div class="oc-eedit-row oc-kindrow oc-eedit-sec">
            <span
              v-for="k in REL_KINDS"
              :key="k.key"
              class="oc-kind"
              :class="{ on: (curRel()?.kind || '关联') === k.key }"
              :style="{ '--kc': k.color }"
              @click="patchRel({ kind: k.key })"
            >{{ k.key }}</span>
          </div>
          <div class="oc-eedit-row oc-kindrow">
            <span
              v-for="s in EDGE_STYLES"
              :key="s.key"
              class="oc-kind"
              :class="{ on: (curRel()?.style || '') === (s.key === 'solid' ? '' : s.key) }"
              @click="patchRel({ style: s.key === 'solid' ? '' : s.key })"
            >{{ s.label }}</span>
          </div>
          <div class="oc-eedit-row oc-eedit-swatches oc-eedit-sec">
            <span
              class="oc-ctx-sw"
              :class="{ on: !(curRel()?.color || '') }"
              title="主题色"
              @click="patchRel({ color: '' })"
            ></span>
            <span
              v-for="col in EDGE_COLORS"
              :key="col"
              class="oc-ctx-sw"
              :class="{ on: (curRel()?.color || '') === col }"
              :style="{ background: col }"
              :title="col"
              @click="patchRel({ color: col })"
            />
          </div>
          <!-- 单条连线尺寸（v1.0.9）：覆盖画布全局设置，空值=跟随全局 -->
          <div class="oc-eedit-row oc-eedit-size">
            <span class="oc-eedit-szlabel">线宽</span>
            <input
              type="range"
              min="0.8"
              max="5"
              step="0.2"
              :value="curRel()?.edgeWidth || work.canvasPrefs.edgeWidth || 1.8"
              title="本条连线粗细（拖动即时生效）"
              @input="patchRel({ edgeWidth: Number($event.target.value) })"
            />
            <span class="oc-eedit-szval">{{ (curRel()?.edgeWidth || work.canvasPrefs.edgeWidth || 1.8).toFixed(1) }}</span>
            <button v-if="curRel()?.edgeWidth" class="oc-eedit-szreset" title="恢复跟随全局线宽" @click="patchRel({ edgeWidth: null })">↺</button>
          </div>
          <div class="oc-eedit-row oc-eedit-size">
            <span class="oc-eedit-szlabel">箭头</span>
            <input
              type="range"
              min="0.5"
              max="3"
              step="0.1"
              :value="curRel()?.arrowScale || work.canvasPrefs.arrowSize || 1"
              title="本条连线箭头大小（拖动即时生效）"
              @input="patchRel({ arrowScale: Number($event.target.value) })"
            />
            <span class="oc-eedit-szval">{{ (curRel()?.arrowScale || work.canvasPrefs.arrowSize || 1).toFixed(1) }}×</span>
            <button v-if="curRel()?.arrowScale" class="oc-eedit-szreset" title="恢复跟随全局箭头大小" @click="patchRel({ arrowScale: null })">↺</button>
          </div>
        </div>
      </Teleport>

        <!-- 引用卡目标选择浮层 -->
        <div v-if="citePick" class="oc-pick" :style="{ left: citePick.x + 'px', top: citePick.y + 40 + 'px' }" @mousedown.stop>
          <DLinkPicker @pick="onCitePick" />
        </div>
      </div>

      <!-- 跨层接续卡 -->
      <div v-if="!outlineWorkspace&&scopedRelations.external.in.size" class="oc-external-lane in">
        <div v-for="id in [...scopedRelations.external.in]" :key="'in-' + id" class="oc-external-card">
          <OIcon name="arrow-right" :size="12" />
          <div><small>前接</small><button type="button" @click="revealNode(id)">{{ nodeById(id) ? labelOf(nodeById(id)) : '外部情节' }} →</button></div>
        </div>
      </div>
      <div v-if="!outlineWorkspace&&scopedRelations.external.out.size" class="oc-external-lane out">
        <div v-for="id in [...scopedRelations.external.out]" :key="'out-' + id" class="oc-external-card">
          <OIcon name="external" :size="12" />
          <div><small>后续</small><button type="button" @click="revealNode(id)">{{ nodeById(id) ? labelOf(nodeById(id)) : '外部情节' }} →</button></div>
        </div>
      </div>

      <!-- 多选封装 -->
      <div v-if="viewMulti" class="oc-selection-bar">
        <span>已选择 <b>{{ multiCount }}</b> 个模块</span>
        <span style="color: var(--text-dim)">选择当前层至少 2 个模块</span>
        <button class="oc-quiet primary" type="button" :disabled="picked.size < 2" @click="openWrap">用容器封装</button>
        <button class="oc-quiet" type="button" @click="toggleMulti">取消</button>
      </div>

      <!-- 合并关系浮层 -->
      <div v-if="selectedEdge?.group && !connecting" class="oc-group-inspector" @mousedown.stop>
        <span style="color: var(--text-dim)">合并关系</span>
        <span v-for="k in REL_KINDS" :key="k.key" class="oc-kind" :class="{ on: selectedEdge.rel.kind === k.key }" :style="{ '--kc': k.color }" @click="patchGroup('kind', k.key)">{{ k.key }}</span>
        <select :value="selectedEdge.arrow" @change="patchGroup('arrows', $event.target.value)">
          <option value="->">单向 →</option>
          <option value="<->">双向 ↔</option>
          <option value="--">无向 —</option>
        </select>
        <input :value="selectedEdge.relations.find((r) => r.rel.label)?.rel.label || ''" placeholder="关系标签…" maxlength="12" @input="patchGroup('label', $event.target.value)" />
        <button class="oc-quiet" type="button" @click="groupDetailsOpen = true">详情</button>
        <button class="oc-quiet" type="button" title="取消选择" @click="selectedEdgeKey = null">×</button>
      </div>
      <div v-if="groupDetailsOpen && selectedEdge?.group" class="oc-relations-panel" @mousedown.stop>
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
          <h3>这条线连接的真实事件 · {{ selectedEdge.relations.length }}</h3>
          <button class="oc-quiet" type="button" @click="groupDetailsOpen = false">关闭</button>
        </div>
        <div v-for="{ owner, rel } in selectedEdge.relations" :key="rel.id" class="oc-relation-row">
          <button type="button" @click="revealRelationEndpoint(rel.fromJunction?.ownerId || owner.id)">
            {{ labelOf(nodeById(rel.fromJunction?.ownerId || owner.id) || owner) }}
            <small>{{ scopeCrumbs(live, (nodeById(rel.fromJunction?.ownerId || owner.id) || owner).parentId || null).map(x => x.title).join(' / ') }}</small>
          </button>
          <span class="kind" :style="{ '--kd': relColor(rel.kind) }">{{ rel.kind || '关联' }} · {{ ({ '->': '→', '<->': '↔', '--': '—' })[rel.arrows || '->'] }}</span>
          <button type="button" @click="revealRelationEndpoint(rel.toJunction?.ownerId || rel.toId)">
            {{ labelOf(nodeById(rel.toJunction?.ownerId || rel.toId) || { title: rel.toId }) }}
            <small>{{ scopeCrumbs(live, (nodeById(rel.toJunction?.ownerId || rel.toId) || {}).parentId || null).map(x => x.title).join(' / ') }}</small>
          </button>
        </div>
      </div>

      <!-- 当前层空态 -->
      <div v-if="!placementDraft && !visNodes.length && !miniItems.length" class="oc-scope-empty">
        <p>当前层还没有模块。</p>
        <button class="oc-quiet primary" type="button" @click="startPlacement('event')">＋ 新建事件</button>
        <span v-if="scopeId">也可以从上方面包屑返回上一层。</span>
      </div>

      <!-- 右侧设置抽屉 -->
      <Teleport :to="detailTarget || 'body'" :disabled="!detailTarget">
      <component :is="outlineWorkspace ? OutlineNodeDetail : OutlineNodeDrawer"
        v-if="drawerNode"
        :node="drawerNode"
        :path="drawerPath"
        :stats="drawerStats"
        :connections="drawerConnections"
        :parent="drawerParent"
        :is-mini="drawerNode.kind === 'container' ? isExpanded(drawerNode.id) : !!miniById.get(drawerNode.id)"
        @close="outlineWorkspace ? outlineWorkspace.close('right') : drawerId = null"
        @title="onDrawerTitle"
        @body="onDrawerBody"
        @edit-node="onDetailEdit"
        @chapter="onDrawerChapter"
        @shape="onDrawerShape"
        @status="onDrawerStatus"
        @color="onDrawerColor"
        @enter="onDrawerEnter"
        @toggle-inline="onDrawerToggle"
        @move-out="onDrawerMoveOut"
        @remove="onDrawerRemove"
        @reveal="revealNode"
        @text="work.outlineView='text'"
        @inline-edit="onDrawerInlineEdit"
      />
      </Teleport>
    </div>

    <!-- 右键操作栏 / 空白菜单 / 连接点菜单统一挂到 body：毛玻璃皮肤的 .ow-main 带 backdrop-filter，
         它会成为 position:fixed 子元素的包含块，留在画布内会整体偏移 .ow-main 的原点（实测 265,108）。
         关闭仍由 window 捕获阶段 mousedown + closest('.oc-ctx') 判定，与挂载位置无关。 -->
    <Teleport to="body">
    <!-- 模块右键操作栏（v0.4.19：mini 工具栏改右键触发，可 Esc / 点空白关闭；fixed 定位须在 transform 层外） -->
    <div v-if="ctxMenu" class="oc-ctx" :style="{ left: ctxMenu.x + 'px', top: ctxMenu.y + 'px' }" @mousedown.stop @contextmenu.prevent.stop>
      <div class="oc-ctx-title">{{ ctxNode?.title || KIND_META[ctxNode?.kind]?.label || '模块' }}</div>
      <template v-if="ctxNode && ctxNode.kind === 'container'">
        <div class="oc-ctx-swatches">
          <span v-for="c in PALETTE" :key="c" class="oc-ctx-sw" :style="{ background: c }" :title="c" @click="applyColor(c)" />
        </div>
        <div class="oc-ctx-actions">
          <span class="oc-ctx-reset" title="恢复自动配色（按容器顺序）" @click="applyColor('')">↺ 自动配色</span>
        </div>
      </template>
      <div class="oc-ctx-actions oc-ctx-ops">
        <button v-if="ctxNode" class="oc-ctx-item" title="打开右侧设置" @click="ctxAct('settings')"><OIcon name="gear" :size="13" /> 设置 / 详情</button>
        <button v-if="ctxNode && ctxNode.kind === 'event'" class="oc-ctx-item" :title="'形状：' + SHAPE_LABEL[ctxNode.shape || 'process'] + '（点击切换）'" @click="ctxAct('shape')"><OIcon name="shape" :size="13" /> {{ SHAPE_LABEL[ctxNode.shape || 'process'] }} ▸</button>
        <button v-if="ctxNode && ctxNode.kind !== 'container'" class="oc-ctx-item" title="在画布内编辑文字" @click="ctxAct('edit')"><OIcon name="edit" :size="13" /> 画布内编辑</button>
        <button v-if="ctxNode && work.olTypes.length" class="oc-ctx-item" :title="'自定义类型：' + (ctxNode.mtype || '无') + '（点击切换）'" @click="ctxAct('mtype')"><OIcon name="tag" :size="13" /> {{ ctxNode.mtype || '自定义类型' }} ▸</button>
        <button v-if="ctxNode" class="oc-ctx-item" :title="ctxNode.pin ? '取消固定（「整理」时将参与重排）' : '固定位置（「整理」时不动）'" @click="ctxAct('pin')"><OIcon name="pin" :size="13" /> {{ ctxNode.pin ? '取消固定' : '固定位置' }}</button>
        <button v-if="ctxNode?.kind === 'container' && ctxNode.parentId" class="oc-ctx-item" title="把容器移到上一层" @click="ctxAct('moveout')"><OIcon name="arrow-up" :size="13" /> 移出上一层</button>
        <button v-if="ctxNode?.kind === 'container'" class="oc-ctx-item" title="折叠/展开侧栏与文本视图中的子模块" @click="ctxAct('fold')"><OIcon name="caret-right" :size="13" /> {{ ctxNode.fold ? '展开侧栏子项' : '折叠侧栏子项' }}</button>
        <button v-if="ctxNode" class="oc-ctx-item" :disabled="!ai.ready" :title="ai.ready ? '附带此节点，在对话中描述需求后发送' : AI_UNSET_HINT" @click="ctxAct('ai')"><OIcon name="star" :size="13" /> 发送给恍然梦</button>
        <button v-if="ctxNode" class="oc-ctx-item oc-ctx-danger" title="删除模块（容器会连同子模块）" @click="ctxAct('remove')"><OIcon name="close" :size="13" /> 删除</button>
      </div>
    </div>

    <!-- 画布空白右键：选建模块（连接点必须在连线上右键创建） -->
    <div v-if="blankCtx" class="oc-ctx oc-blankctx" :style="{ left: blankCtx.x + 'px', top: blankCtx.y + 'px' }" @mousedown.stop>
      <div class="oc-ctx-title">在此处新建模块</div>
      <button v-for="(m, k) in CREATE_KINDS" :key="k" class="oc-ctx-item" @click="createAt(k)">
        <OIcon :name="m.icon" :size="13" /> {{ m.label }}
      </button>
    </div>

    <!-- 连接点右键：仅删除 -->
    <div v-if="juncCtx" class="oc-ctx oc-blankctx" :style="{ left: juncCtx.x + 'px', top: juncCtx.y + 'px' }" @mousedown.stop @contextmenu.prevent.stop>
      <button class="oc-ctx-item oc-ctx-danger" title="删除该连接点（接到它上面的连线一并删除）" @click="juncCtxRemove">
        <OIcon name="close" :size="13" /> 删除连接点
      </button>
    </div>
    </Teleport>

    <!-- 多选封装 -->
    <div v-if="wrapOpen" class="oc-modal-backdrop" @mousedown.self="wrapOpen = false">
      <div class="oc-modal" role="dialog" aria-modal="true" aria-label="用容器封装">
        <h2>用容器封装</h2>
        <p>把选中的 <b>{{ multiCount }}</b> 个模块归入同一个容器，内容与全部连线保留；容器会收起为一段故事摘要。</p>
        <label class="oc-field">容器名称<input v-model="wrapTitle" maxlength="40" placeholder="如：灯塔疑云" @keydown.enter="confirmWrap" /></label>
        <label class="oc-field">摘要<textarea v-model="wrapSummary" rows="3" maxlength="160" placeholder="这一段情节的一句话摘要" /></label>
        <div class="oc-dialog-actions">
          <button class="oc-quiet" type="button" @click="wrapOpen = false">取消</button>
          <button class="oc-quiet primary" type="button" :disabled="!wrapTitle.trim()" @click="confirmWrap">封装并收起</button>
        </div>
      </div>
    </div>


    <!-- 空画布快速开始 -->
    <div v-if="!placementDraft && !live.length" class="oc-quick">
      <div class="big">谋篇布局 · 自由画布</div>
      <p>事件、便签、引用卡、容器是积木，连线是脉络——结构由你自由生长，没有固定框架。</p>
      <div class="oc-quick-btns">
        <button @click="applyTemplate(tplThreeAct(cardDensity))">三幕式模板</button>
        <button @click="applyTemplate(tplChapterList(work.liveChapters, cardDensity))">章级清单模板</button>
        <button class="ghost" @click="startPlacement('event')">空白开始</button>
      </div>
      <p class="oc-quick-tip">拖节点四向锚点拉出连线 · 拖入容器即归组 · 双击模块行内编辑内容 · 拖边缘调整大小 · 空白处双击新建事件</p>
    </div>
  </div>
</template>
