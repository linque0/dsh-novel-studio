<!-- 人物关系图（8.8.3 v0.4.1）：复用 graphview 画布引擎——人物节点=头像+姓名+角色徽标，
     边=relations（标签渲染于中点，点选编辑/删除，与关系列表双向同步）；
     从人物节点边缘拖线到另一人物即建关系；悬停高亮一度关系网（其余淡出）；
     圆形/网格一键排布；角色·标签筛选；孤岛人物提示；拖摆位置存 appconfig charGraph:<workId> -->
<script setup>
import { computed, ref, reactive, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { NSelect } from 'naive-ui'
import { useWorkStore } from '../stores/work'
import { useUiStore } from '../stores/ui'
import { characterGeometry, projectCharacterPoint } from '../skins/graph-presentation'
import { usePanZoom, anchorsOf } from '../services/graphview'
import OIcon from './OIcon.vue'
import CharacterList from './CharacterList.vue'
import { freeSpotFor, dashOf, EDGE_STYLES, sideBetween, routeEdge } from './outline/canvas-model'
import { rolesOf, primaryRole, characterTagList } from '../services/character-tags'

const work = useWorkStore()
const ui = useUiStore()
const geometry = computed(() => characterGeometry(ui.skin))
const nodeW = computed(() => geometry.value.width)
const nodeH = computed(() => geometry.value.height)
const canvasEl = ref(null)
const { zoom, tx, ty, innerStyle, onWheel, onPanStart, fit: fitTo, centerOn } = usePanZoom(canvasEl)

const NODE_W = 132
const NODE_H = 56
const ROLE_COLOR = { 主角: '#c0392b', 反派: '#d35400', 配角: '#2980b9', 龙套: '#7f8c8d' }

const layout = ref({}) // { [charId]: {x,y} }
const dragPos = reactive(new Map())
const hoverId = ref(null)
const flashIds = reactive(new Set())
const relEdit = ref(null) // { relId, mx, my } 边标签编辑
const relInput = ref(null) // { fromId, toId, x, y, value } 拖线建关系输入
const connecting = ref(null) // { fromId, x, y }
const roleFilter = ref('全部')
const tagFilter = ref([])
let saveTimer = null
const relInputEl = ref(null)

const chars = computed(() => {
  let list = work.liveCharacters
  if (roleFilter.value !== '全部') list = list.filter((c) => rolesOf(c).includes(roleFilter.value))
  if (tagFilter.value.length) list = list.filter((c) => characterTagList(c).some((t) => tagFilter.value.includes(t)))
  return list
})
const allTags = computed(() => [...new Set(work.liveCharacters.flatMap((c) => characterTagList(c)))])
const roleOptions = computed(() => ['全部', ...new Set(work.liveCharacters.flatMap((c) => rolesOf(c)))])
const posOf = (c) => c ? projectCharacterPoint(dragPos.get(c.id) || layout.value[c.id], geometry.value) : null
const avatarOf = (c) => (c.avatarAssetId ? work.assetUrl(c.avatarAssetId) : '')

/* ---------- 排布与布局持久化 ---------- */
function circleAll() {
  const list = chars.value
  const R = Math.max(170, list.length * 32)
  const next = {}
  list.forEach((c, i) => {
    const a = (i / list.length) * Math.PI * 2 - Math.PI / 2
    const point = { x: Math.round(460 + R * Math.cos(a)), y: Math.round(340 + R * Math.sin(a)) }
    next[c.id] = point
  })
  layout.value = next
  scheduleSave()
}
function gridAll() {
  const list = chars.value
  const cols = Math.max(2, Math.ceil(Math.sqrt(list.length)))
  const next = {}
  list.forEach((c, i) => {
    next[c.id] = { x: 80 + (i % cols) * (NODE_W + 60), y: 80 + Math.floor(i / cols) * (NODE_H + 60) }
  })
  layout.value = next
  scheduleSave()
}
function ensureLayout() {
  if (!chars.value.length) return
  if (!Object.keys(layout.value).length) {
    circleAll()
    return
  }
  const missing = chars.value.filter((c) => !layout.value[c.id])
  if (!missing.length) return
  const occupied = chars.value.filter((c) => layout.value[c.id]).map((c) => ({ ...layout.value[c.id], w: NODE_W, h: NODE_H }))
  const next = { ...layout.value }
  for (const c of missing) {
    const spot = freeSpotFor(occupied, { w: NODE_W, h: NODE_H })
    next[c.id] = { x: spot.x, y: spot.y }
    occupied.push({ x: spot.x, y: spot.y, w: NODE_W, h: NODE_H })
  }
  layout.value = next
  scheduleSave()
}
async function loadLayout() {
  layout.value = (await work.loadCharGraph()) || {}
  ensureLayout()
  nextTick(fitView)
}
function scheduleSave() {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => work.saveCharGraph(layout.value), 350)
}
function flushSave() {
  clearTimeout(saveTimer)
  if (work.work && Object.keys(layout.value).length) work.saveCharGraph(layout.value)
}

/* ---------- 边集合与一度网高亮（v0.4.15 严格端口 + 一次性补记 + 遇模块绕行） ---------- */
const migratedSides = new Set()
const edges = computed(() => {
  const out = []
  const ids = new Set(chars.value.map((c) => c.id))
  const obstacles = []
  for (const c of chars.value) {
    const p = posOf(c)
    if (p) obstacles.push({ x: p.x, y: p.y, w: nodeW.value, h: nodeH.value })
  }
  for (const r of work.relations) {
    if (!ids.has(r.fromId) || !ids.has(r.toId)) continue
    const a = chars.value.find((c) => c.id === r.fromId)
    const b = chars.value.find((c) => c.id === r.toId)
    if (!posOf(a) || !posOf(b)) continue
    const A = { ...posOf(a), w: nodeW.value, h: nodeH.value }
    const B = { ...posOf(b), w: nodeW.value, h: nodeH.value }
    const sb = sideBetween(A, B)
    const fromSide = r.fromSide || sb.from
    const toSide = r.toSide || sb.to
    if ((!r.fromSide || !r.toSide) && !migratedSides.has(r.id)) {
      migratedSides.add(r.id)
      work.updateRelation(r.id, { fromSide, toSide })
    }
    const fa = anchorsOf(A)[fromSide]
    const ta = anchorsOf(B)[toSide]
    if (!fa || !ta) continue
    /* 两端节点本体也是障碍：端口严格后，连线中段不得从节点身上穿过 */
    const obs = obstacles.filter((o) => !(o.x === A.x && o.y === A.y) && !(o.x === B.x && o.y === B.y))
    obs.unshift({ x: A.x, y: A.y, w: nodeW.value, h: nodeH.value }, { x: B.x, y: B.y, w: nodeW.value, h: nodeH.value })
    const g = routeEdge(fa, fromSide, ta, toSide, obs, 'bezier')
    out.push({ rel: r, ...g, dash: dashOf(r.style, ''), stroke: r.color || 'var(--accent)' })
  }
  return out
})
const dimIds = computed(() => {
  if (!hoverId.value) return new Set()
  const keep = new Set([hoverId.value])
  for (const r of work.relations) {
    if (r.fromId === hoverId.value) keep.add(r.toId)
    if (r.toId === hoverId.value) keep.add(r.fromId)
  }
  return new Set(chars.value.filter((c) => !keep.has(c.id)).map((c) => c.id))
})
const dimEdgeIds = computed(() => {
  if (!hoverId.value) return new Set()
  return new Set(work.relations.filter((r) => r.fromId !== hoverId.value && r.toId !== hoverId.value).map((r) => r.id))
})
const isolated = computed(() => {
  const linked = new Set()
  for (const r of work.relations) {
    linked.add(r.fromId)
    linked.add(r.toId)
  }
  return work.liveCharacters.filter((c) => !linked.has(c.id)).map((c) => ({ ...c, name: c.name || '未命名' }))
})
const bounds = computed(() => {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const c of chars.value) {
    const p = posOf(c)
    if (!p) continue
    x0 = Math.min(x0, p.x)
    y0 = Math.min(y0, p.y)
    x1 = Math.max(x1, p.x + nodeW.value)
    y1 = Math.max(y1, p.y + nodeH.value)
  }
  if (x0 === Infinity) return { x: 0, y: 0, w: 600, h: 400 }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
})
/* 连线层视口：人物可拖到原点左侧/上方（负坐标），包围盒向左/上收缩时
 * 若视口仍从 (0,0) 起算会裁掉连线——改为覆盖负象限并四周留余量 */
const svgBox = computed(() => {
  const b = bounds.value
  const x0 = Math.min(0, b.x - 400)
  const y0 = Math.min(0, b.y - 400)
  const x1 = Math.max(2400, b.x + b.w + 400)
  const y1 = Math.max(1600, b.y + b.h + 400)
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
})
function fitView() {
  fitTo(bounds.value)
}

/* ---------- 交互 ---------- */
function canvasPt(e) {
  const r = canvasEl.value.getBoundingClientRect()
  return { x: (e.clientX - r.left - tx.value) / zoom.value, y: (e.clientY - r.top - ty.value) / zoom.value }
}
function hitCharAt(pt, excludeId) {
  for (const c of [...chars.value].reverse()) {
    if (c.id === excludeId) continue
    const p = posOf(c)
    if (p && pt.x >= p.x && pt.x <= p.x + nodeW.value && pt.y >= p.y && pt.y <= p.y + nodeH.value) return c
  }
  return null
}
function onNodeDown(e, c) {
  if (e.button !== 0) return
  if (e.target.closest('button, input, a, .rg-apt')) return
  e.stopPropagation()
  work.selCharacterId = c.id
  relEdit.value = null
  const orig = { ...(layout.value[c.id] || { x: 0, y: 0 }) }
  const mx = e.clientX
  const my = e.clientY
  const move = (ev) => {
    dragPos.set(c.id, { x: Math.round(orig.x + (ev.clientX - mx) / zoom.value / geometry.value.scaleX), y: Math.round(orig.y + (ev.clientY - my) / zoom.value / geometry.value.scaleY) })
  }
  const up = () => {
    window.removeEventListener('mousemove', move)
    window.removeEventListener('mouseup', up)
    const p = dragPos.get(c.id)
    if (p) {
      layout.value = { ...layout.value, [c.id]: p }
      dragPos.delete(c.id)
      scheduleSave()
    }
  }
  window.addEventListener('mousemove', move)
  window.addEventListener('mouseup', up)
}
/* 从节点边缘拖线到另一人物 → 弹关系标签输入（v0.4.14：记录两侧端口） */
function startConnect(e, c) {
  e.stopPropagation()
  e.preventDefault()
  const side = e.currentTarget?.dataset?.side || 'right'
  const a = canvasPt(e)
  connecting.value = { fromId: c.id, side, x: a.x, y: a.y }
  const move = (ev) => {
    const p = canvasPt(ev)
    connecting.value = { fromId: c.id, side, x: p.x, y: p.y }
  }
  const up = (ev) => {
    window.removeEventListener('mousemove', move)
    window.removeEventListener('mouseup', up)
    const st = connecting.value
    connecting.value = null
    if (!st) return
    const target = hitCharAt(canvasPt(ev), c.id)
    if (!target) return
    /* 已有这层关系（含反向）→ 打开编辑浮层直接改；无 → 弹输入新建 */
    const dup = work.relations.find((r) => (r.fromId === c.id && r.toId === target.id) || (r.fromId === target.id && r.toId === c.id))
    if (dup) {
      const g = relGeom(dup)
      if (g) openRelEdit(dup, g.mid)
      return
    }
    const p = canvasPt(ev)
    relInput.value = { fromId: c.id, toId: target.id, side: st.side, x: p.x, y: p.y, value: '' }
    nextTick(() => relInputEl.value?.focus())
  }
  window.addEventListener('mousemove', move)
  window.addEventListener('mouseup', up)
}
const connPath = computed(() => {
  const c = connecting.value
  if (!c) return ''
  const from = work.liveCharacters.find((x) => x.id === c.fromId)
  const p = from && posOf(from)
  const start = p ? anchorsOf({ ...p, w: nodeW.value, h: nodeH.value })[c.side] : c
  return `M ${start.x} ${start.y} L ${c.x} ${c.y}`
})
/* 关系几何（严格端口 + 绕行）：拖线编辑定位/已有关系复用 */
function relGeom(rel) {
  const a = chars.value.find((x) => x.id === rel.fromId)
  const b = chars.value.find((x) => x.id === rel.toId)
  if (!posOf(a) || !posOf(b)) return null
  const A = { ...posOf(a), w: nodeW.value, h: nodeH.value }
  const B = { ...posOf(b), w: nodeW.value, h: nodeH.value }
  const sb = sideBetween(A, B)
  const fromSide = rel.fromSide || sb.from
  const toSide = rel.toSide || sb.to
  const fa = anchorsOf(A)[fromSide]
  const ta = anchorsOf(B)[toSide]
  if (!fa || !ta) return null
  /* 障碍集与渲染用 edges 同一口径：排除两端后再 unshift 两端矩形（v1.0.22 对齐，
   * 此前漏掉两端 → 退化路由判定不一致，编辑浮层锚定在偏离连线的位置） */
  const obs = chars.value
    .map((c) => posOf(c))
    .filter(Boolean)
    .map((p) => ({ x: p.x, y: p.y, w: nodeW.value, h: nodeH.value }))
    .filter((o) => !(o.x === A.x && o.y === A.y) && !(o.x === B.x && o.y === B.y))
  obs.unshift({ x: A.x, y: A.y, w: nodeW.value, h: nodeH.value }, { x: B.x, y: B.y, w: nodeW.value, h: nodeH.value })
  return routeEdge(fa, fromSide, ta, toSide, obs, 'bezier')
}
function saveRelInput() {
  const st = relInput.value
  relInput.value = null
  if (!st) return
  const from = chars.value.find((x) => x.id === st.fromId)
  const to = chars.value.find((x) => x.id === st.toId)
  if (!posOf(from) || !posOf(to)) return
  const toSide = sideBetween({ ...posOf(from), w: nodeW.value, h: nodeH.value }, { ...posOf(to), w: nodeW.value, h: nodeH.value }).to
  const label = st.value.trim()
  work.addRelation(st.fromId, st.toId, label || '关联', { fromSide: st.side, toSide })
}
/* 浮层与容器右键菜单同模式：fixed + 屏幕坐标，不随画布缩放重定位/变形 */
function popPlacement(mid) {
  const el = canvasEl.value
  if (!el) return { mx: mid.x, my: mid.y, flip: false }
  const r = el.getBoundingClientRect()
  const sx = r.left + tx.value + mid.x * zoom.value
  const sy = r.top + ty.value + mid.y * zoom.value
  const halfW = 120
  const cx = Math.min(Math.max(sx, r.left + 6 + halfW), Math.max(r.left + 6 + halfW, r.right - 6 - halfW))
  const roomUp = sy - r.top
  return { mx: cx, my: sy, flip: roomUp < 150 && r.bottom - sy > roomUp }
}
function openRelEdit(rel, mid) {
  const p = popPlacement(mid)
  relEdit.value = { relId: rel.id, mx: p.mx, my: p.my, flip: p.flip }
  nextTick(() => relInputEl.value?.focus())
}
function patchRelLabel(e) {
  if (relEdit.value) work.updateRelation(relEdit.value.relId, { label: e.target.value })
}
const REL_COLORS = ['#2980b9', '#c0392b', '#8e44ad', '#d35400', '#27ae60', '#7f8c8d']
function curRel() {
  return relEdit.value ? work.relations.find((r) => r.id === relEdit.value.relId) || null : null
}
function patchRel(patch) {
  if (relEdit.value) work.updateRelation(relEdit.value.relId, patch)
}
function removeRel() {
  if (relEdit.value) work.removeRelation(relEdit.value.relId)
  relEdit.value = null
}
function onWinDown(e) {
  if (relEdit.value && !e.target.closest?.('.rg-eedit, .rg-elabel, .rg-edge-hit')) relEdit.value = null
  if (relInput.value && !e.target.closest?.('.rg-relinput')) saveRelInput()
  if (ctxMenu.value && !e.target.closest?.('.rg-ctx')) ctxMenu.value = null
  if (blankCtx.value && !e.target.closest?.('.oc-ctx')) blankCtx.value = null
}
/* 人物节点右键菜单（v0.4.3）：替代旧「选中即显示」的常驻小工具条——不遮挡节点内容，随点随开随点随关 */
const ctxMenu = ref(null) // { charId, x, y }
function openCtx(e, c) {
  const p = canvasPt(e)
  work.selCharacterId = c.id
  blankCtx.value = null
  ctxMenu.value = { charId: c.id, x: p.x, y: p.y }
}
/* 画布空白右键（v0.4.9）：在此处新建人物并选中 */
const blankCtx = ref(null) // { x, y, px, py }
function onBlankCtx(e) {
  /* Chromium 对 SVG pointer-events:stroke 路径的 contextmenu 命中可能与 mousedown 不一致——反查真实落点 */
  const t = document.elementFromPoint(e.clientX, e.clientY)
  const hitEl = t && (t.classList?.contains('rg-edge-hit') ? t : t.closest?.('.rg-edge-hit'))
  if (hitEl && hitEl.dataset.rel) {
    const rel = work.relations.find((r) => r.id === hitEl.dataset.rel)
    if (rel) {
      const g = relGeom(rel)
      if (g) openRelEdit(rel, g.mid)
      return
    }
  }
  if (e.target.closest?.('.rg-node, .rg-elabel, .rg-edge-hit, .rg-eedit, .oc-eedit, .oc-ctx')) return
  const p = canvasPt(e)
  blankCtx.value = { x: e.clientX, y: e.clientY, px: p.x, py: p.y }
}
function createCharAt() {
  const st = blankCtx.value
  blankCtx.value = null
  if (!st) return
  const row = work.addCharacter()
  layout.value = { ...layout.value, [row.id]: projectCharacterPoint({ x: st.px, y: st.py }, geometry.value, true) }
  scheduleSave()
  work.selCharacterId = row.id
}
/* Delete 键删除选中人物（软删，可在回收站恢复；输入态不劫持） */
function onKeyC(e) {
  const t = e.target
  if (t && (t.matches?.('input, textarea, select, [contenteditable="true"]') || t.isContentEditable)) return
  if ((e.key === 'Delete' || e.key === 'Backspace') && work.selCharacterId && !relInput.value && !relEdit.value) {
    e.preventDefault()
    work.deleteCharacter(work.selCharacterId)
    work.selCharacterId = null
  }
}
const ctxChar = computed(() => work.liveCharacters.find((c) => c.id === ctxMenu.value?.charId) || null)
function ctxSendOutline() {
  if (ctxChar.value) work.sendCharToOutline(ctxChar.value.id)
  ctxMenu.value = null
}
function ctxOpenDetail() {
  if (ctxChar.value) openDetail(ctxChar.value)
  ctxMenu.value = null
}
function onWheelC(ev) {
  ctxMenu.value = null
  blankCtx.value = null
  onWheel(ev)
}
function nodeStyle(c) {
  const p = posOf(c)
  if (!p) return { display: 'none' }
  return {
    left: p.x + 'px',
    top: p.y + 'px',
    width: nodeW.value + 'px',
    height: nodeH.value + 'px',
    opacity: dimIds.value.has(c.id) ? 0.15 : 1,
    zIndex: work.selCharacterId === c.id ? 6 : 3
  }
}
/* 「编辑选中人物」（设计稿右下角那颗）：只在图上已选中节点时出现 */
const selectedChar = computed(() => chars.value.find((c) => c.id === work.selCharacterId) || null)
/* 页头右侧「发送为大纲引用卡」：复用列表页同一动作（设计稿 data-send-cite 的等价物） */
function sendCite() {
  if (selectedChar.value) work.sendCharToOutline(selectedChar.value.id)
}
function openDetail(c) {
  work.selCharacterId = c.id
  work.charView = 'list'
}
function locateIsolated(c) {
  work.selCharacterId = c.id
  work.charFocusId = c.id
  work.charFocusTick++
}
/* 定位请求可能先于组件挂载（跨模块跳转）——以 handled 戳补处理，不丢闪 */
function focusCharById(id) {
  const c = chars.value.find((x) => x.id === id) || work.liveCharacters.find((x) => x.id === id)
  if (!c) return
  roleFilter.value = '全部'
  tagFilter.value = []
  nextTick(() => {
    const p = posOf(c)
    if (p) centerOn(p.x + nodeW.value / 2, p.y + nodeH.value / 2)
    flashIds.add(c.id)
    setTimeout(() => flashIds.delete(c.id), 1600)
  })
}
function maybeFocus() {
  if (work.charFocusHandled !== work.charFocusTick && work.charFocusId) {
    work.charFocusHandled = work.charFocusTick
    focusCharById(work.charFocusId)
  }
}
watch(() => work.charFocusTick, maybeFocus)
watch(() => ui.skin, () => nextTick(fitView))

/* 关系图打开期间新增的人物：补布局坐标并持久化——否则 posOf 为 null → display:none，
 * 新人物在画布上隐身，须切视图才出现（v1.0.22 修复） */
watch(
  () => chars.value.map((c) => c.id).join('|'),
  () => {
    ensureLayout()
    scheduleSave()
  }
)

onMounted(async () => {
  await loadLayout()
  window.addEventListener('mousedown', onWinDown, true)
  window.addEventListener('keydown', onKeyC)
  const ids = work.liveCharacters.filter((ch) => ch.avatarAssetId).map((ch) => ch.avatarAssetId)
  if (ids.length) await work.warmUrls(ids)
  maybeFocus()
})
onBeforeUnmount(() => {
  window.removeEventListener('mousedown', onWinDown, true)
  window.removeEventListener('keydown', onKeyC)
  flushSave()
})
</script>

<template>
  <div class="om-wrap">
    <section class="rg-main">
    <!-- 页头：两种设计稿共用人物标题与真实操作 -->
    <div class="om-toolbar rg-toolbar">
      <span v-for="r in roleOptions" :key="r" class="oc-chip" :class="{ on: roleFilter === r }" @click="roleFilter = r">{{ r }}</span>
      <select v-model="tagFilter" class="rg-tagselect" multiple title="按标签筛选（Ctrl+点击多选）">
        <option v-for="t in allTags" :key="t" :value="t">{{ t }}</option>
      </select>
      <span style="flex: 1"></span>
      <span v-if="isolated.length" class="oc-chip oc-warn" :title="'暂无任何关系：' + isolated.map((c) => c.name).join('、')" @click="locateIsolated(isolated[0])">孤岛 {{ isolated.length }}</span>
      <span class="oc-count">{{ chars.length }} 人 · {{ edges.length }} 条关系</span>
      <button class="om-btn" title="圆形排布" @click="circleAll"><OIcon class="om-btn-icon" name="circle-layout" :size="14" /></button>
      <button class="om-btn" title="网格排布" @click="gridAll"><OIcon class="om-btn-icon" name="grid" :size="14" /></button>
      <button class="om-btn" title="缩小" @click="zoom = Math.max(0.3, zoom - 0.15)"><OIcon name="minus" :size="14" /></button>
      <button class="om-btn" title="放大" @click="zoom = Math.min(2.2, zoom + 0.15)"><OIcon name="plus" :size="14" /></button>
      <button class="om-btn text" title="适应视图" @click="fitView">适应</button>
    </div>

    <div ref="canvasEl" class="om-canvas rg-canvas" @mousedown="onPanStart" @wheel="onWheelC" @contextmenu.prevent="onBlankCtx">
      <div class="om-inner" :style="innerStyle">
        <svg
          class="om-edges rg-edges"
          :style="{ left: svgBox.x + 'px', top: svgBox.y + 'px' }"
          :width="svgBox.w"
          :height="svgBox.h"
          :viewBox="svgBox.x + ' ' + svgBox.y + ' ' + svgBox.w + ' ' + svgBox.h"
        >
          <path
            v-for="e in edges"
            :key="'h' + e.rel.id"
            class="rg-edge-hit"
            :d="e.d"
            :opacity="dimEdgeIds.has(e.rel.id) ? 0.1 : 1"
            :data-rel="e.rel.id"
            @mousedown.stop="openRelEdit(e.rel, e.mid)"
            @contextmenu.prevent.stop="openRelEdit(e.rel, e.mid)"
          >
            <title>点击或右键编辑连线（标签 / 线型 / 颜色）</title>
          </path>
          <path
            v-for="e in edges"
            :key="'v' + e.rel.id"
            :d="e.d"
            fill="none"
            :stroke="e.stroke"
            :stroke-width="work.canvasPrefs.edgeWidth || 1.8"
            :stroke-dasharray="e.dash"
            :opacity="dimEdgeIds.has(e.rel.id) ? 0.1 : 0.8"
          />
          <path v-if="connecting" :d="connPath" fill="none" stroke="var(--accent)" stroke-width="1.6" stroke-dasharray="6 4" />
        </svg>

        <!-- 关系标签（点击编辑） -->
        <div
          v-for="e in edges.filter((x) => x.rel.label)"
          :key="'l' + e.rel.id"
          class="rg-elabel"
          :style="{ left: e.mid.x + 'px', top: e.mid.y + 'px', opacity: dimEdgeIds.has(e.rel.id) ? 0.12 : 1 }"
          @mousedown.stop="openRelEdit(e.rel, e.mid)"
          @contextmenu.prevent.stop="openRelEdit(e.rel, e.mid)"
        >{{ e.rel.label }}</div>

        <!-- 人物节点 -->
        <div
          v-for="c in chars"
          :key="c.id"
          class="rg-node"
          :class="{ sel: work.selCharacterId === c.id, flash: flashIds.has(c.id) }"
          :style="nodeStyle(c)"
          @mousedown="onNodeDown($event, c)"
          @contextmenu.prevent="openCtx($event, c)"
          @mouseenter="hoverId = c.id"
          @mouseleave="hoverId = null"
          @dblclick.stop="openDetail(c)"
        >
          <img v-if="avatarOf(c)" :src="avatarOf(c)" class="rg-avatar" />
          <div v-else class="rg-avatar rg-avatar-empty">人</div>
          <div class="rg-meta">
            <div class="rg-name">{{ c.name || '未命名' }}</div>
            <span class="rg-role" :style="{ color: ROLE_COLOR[primaryRole(c)] || 'var(--text-dim)', borderColor: ROLE_COLOR[primaryRole(c)] || 'var(--border)' }">{{ primaryRole(c) || '未定' }}</span>
          </div>
          <span
            v-for="sd in ['top', 'right', 'bottom', 'left']"
            :key="sd"
            class="oc-apt rg-apt"
            :data-side="sd"
            title="拖到另一人物建立/修改关系"
            @mousedown="startConnect($event, c)"
          />
        </div>

        <!-- 拖线建关系输入 -->
        <div v-if="relInput" class="rg-relinput" :style="{ left: relInput.x + 'px', top: relInput.y + 'px' }" @mousedown.stop>
          <input ref="relInputEl" v-model="relInput.value" class="rp-input" placeholder="关系（如：师徒 / 宿敌）…" @keydown.enter="saveRelInput" @keydown.esc="relInput = null" />
          <button class="om-btn" title="保存" @click="saveRelInput"><OIcon name="check" :size="13" /></button>
        </div>

        <!-- 边标签编辑（挂 .app-root 保留主题变量；fixed 定位尺寸不随画布缩放） -->
        <Teleport to=".app-root" v-if="relEdit">
        <div class="rg-eedit" :class="[{ flip: relEdit.flip }]" :style="{ position: 'fixed', left: relEdit.mx + 'px', top: relEdit.my + 'px' }" @mousedown.stop @contextmenu.prevent.stop>
          <input class="rp-input" :value="curRel()?.label || ''" placeholder="关系标签…" @input="patchRelLabel" @keydown.enter="relEdit = null" @keydown.esc="relEdit = null" />
          <div class="oc-kindrow">
            <span
              v-for="s in EDGE_STYLES"
              :key="s.key"
              class="oc-kind"
              :class="{ on: (curRel()?.style || '') === (s.key === 'solid' ? '' : s.key) }"
              @click="patchRel({ style: s.key === 'solid' ? '' : s.key })"
            >{{ s.label }}</span>
          </div>
          <div class="oc-eedit-swatches">
            <span
              class="oc-ctx-sw"
              :class="{ on: !(curRel()?.color || '') }"
              title="主题色"
              @click="patchRel({ color: '' })"
            ></span>
            <span
              v-for="col in REL_COLORS"
              :key="col"
              class="oc-ctx-sw"
              :class="{ on: (curRel()?.color || '') === col }"
              :style="{ background: col }"
              :title="col"
              @click="patchRel({ color: col })"
            />
          </div>
          <button class="om-btn oc-mini-x" title="删除关系" @click="removeRel"><OIcon name="close" :size="12" /></button>
        </div>
        </Teleport>

        <!-- 人物节点右键菜单（替代旧常驻小工具条，不再遮挡节点内容） -->
        <div v-if="ctxMenu" class="rg-ctx" :style="{ left: ctxMenu.x + 'px', top: ctxMenu.y + 'px' }" @mousedown.stop>
          <button title="发送为大纲画布引用卡" @click="ctxSendOutline">发送为大纲引用卡</button>
          <button title="打开人物详情（也可双击节点）" @click="ctxOpenDetail">打开详情</button>
        </div>

        <!-- 画布空白右键：在此处新建人物（v0.4.9） -->
        <div v-if="blankCtx" class="oc-ctx oc-blankctx" :style="{ left: blankCtx.x + 'px', top: blankCtx.y + 'px' }" @mousedown.stop>
          <button class="oc-ctx-item" title="新建人物并放到此处" @click="createCharAt">＋ 新建人物</button>
        </div>
      </div>
    </div>

    <div v-if="!work.liveCharacters.length" class="oc-quick">
      <div class="big">众生有相</div>
      <p>先在列表视图创建人物，再回到关系图连线成网。</p>
      <div class="oc-quick-btns">
        <button @click="work.charView = 'list'">去创建人物</button>
      </div>
    </div>

    <!-- 图谱内的操作提示与「编辑选中人物」（设计稿右下角那颗；创作皮肤共用） -->
    </section>
  </div>
</template>
