<!-- 主区·关系剧场：画布引擎（平移缩放 / 四向端口 / 绕行连线 / 拖线建关系 / 排布持久化）
     迁自旧 CharacterGraph.vue，结构按设计稿 .graph-pane 三层重排：
     module-head + graph-subbar + graph-stage + graph-foot
     （docs/前端美化/人物-融合总稿-20261105/app.mjs:44 graphMain()，
     度量取 studio.css 的 .graph-* 段，样式落 styles/chars-graph.css）。
     外壳布局与列宽走 inject('charShell')（一律可选链）；数据真源仍是 work / ui 两个 store。 -->
<script setup>
import { computed, inject, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import OIcon from '../OIcon.vue'
import { useWorkStore } from '../../stores/work'
import { useUiStore } from '../../stores/ui'
import { characterGeometry, projectCharacterPoint } from '../../skins/graph-presentation'
import { usePanZoom, anchorsOf } from '../../services/graphview'
import { freeSpotFor, dashOf, EDGE_STYLES, sideBetween, routeEdge } from '../outline/canvas-model'
import { rolesOf, primaryRole, characterTagList } from '../../services/character-tags'

const shell = inject('charShell', null)
const work = useWorkStore()
const ui = useUiStore()

const geometry = computed(() => characterGeometry(ui.skin))
const canvasEl = ref(null)
const { zoom, tx, ty, innerStyle, onWheel, onPanStart, fit: fitTo, centerOn } = usePanZoom(canvasEl)

const SIDES = ['top', 'right', 'bottom', 'left']
const REL_COLORS = ['#2980b9', '#c0392b', '#8e44ad', '#d35400', '#27ae60', '#7f8c8d']
const ROLE_COLOR = { 主角: '#c0392b', 反派: '#d35400', 配角: '#2980b9', 龙套: '#7f8c8d' }

const layout = ref({}) // { [charId]: {x,y} } 存的是节点左上角锚点（画布坐标）
const dragPos = reactive(new Map())
const hoverId = ref(null)
const flashIds = reactive(new Set())
const relEdit = ref(null) // { relId, mx, my, flip }
const relInput = ref(null) // { fromId, toId, side, mx, my, value }
const connecting = ref(null) // { fromId, side, x, y }
const linkFrom = ref(null) // 底栏「＋ 关系」后的目标拾取态
const ctxMenu = ref(null) // { charId, mx, my }
const blankCtx = ref(null) // { mx, my, px, py }
const roleFilter = ref('全部')
const tagFilter = ref([])
const filterOpen = ref(false)
const panning = ref(false)
const relInputEl = ref(null)
let saveTimer = null

/* ---------- 范围（一度关系 / 全部人物）与筛选 ---------- */
const scope = computed(() => (ui.charScope === 'all' ? 'all' : 'local'))
const active = computed(() => work.activeCharacter)
const scoped = computed(() => {
  const all = work.liveCharacters
  const c = active.value
  if (scope.value === 'all' || !c) return all
  const keep = new Set([c.id])
  for (const r of work.relations) {
    if (r.fromId === c.id) keep.add(r.toId)
    if (r.toId === c.id) keep.add(r.fromId)
  }
  return all.filter((x) => keep.has(x.id))
})
const chars = computed(() => {
  let list = scoped.value
  if (roleFilter.value !== '全部') list = list.filter((c) => rolesOf(c).includes(roleFilter.value))
  if (tagFilter.value.length) list = list.filter((c) => characterTagList(c).some((t) => tagFilter.value.includes(t)))
  return list
})
const allTags = computed(() => [...new Set(work.liveCharacters.flatMap((c) => characterTagList(c)))])
const roleOptions = computed(() => ['全部', ...new Set(work.liveCharacters.flatMap((c) => rolesOf(c)))])

/* ---------- 节点几何：默认取 graph-presentation，量到实际渲染尺寸就用实测 ---------- */
const measured = reactive(new Map())
const elOf = new Map()
const observer = typeof ResizeObserver === 'undefined'
  ? null
  : new ResizeObserver((entries) => {
    for (const en of entries) {
      const id = en.target?.dataset?.id
      if (!id) continue
      const w = Math.round(en.target.offsetWidth)
      const h = Math.round(en.target.offsetHeight)
      const cur = measured.get(id)
      if (cur && cur.w === w && cur.h === h) continue
      measured.set(id, { w, h })
    }
  })
function setNodeEl(id, el) {
  const prev = elOf.get(id)
  if (prev === el) return
  if (prev) {
    observer?.unobserve(prev)
    elOf.delete(id)
  }
  if (el) {
    elOf.set(id, el)
    observer?.observe(el)
  }
}
function sizeOf(c) {
  const m = c ? measured.get(c.id) : null
  if (m) return m
  const g = geometry.value
  const sel = !!c && work.selCharacterId === c.id
  return {
    w: sel ? g.selectedWidth ?? g.width : g.width,
    h: sel ? g.selectedHeight ?? g.height : g.height
  }
}
const posOf = (c) => (c ? projectCharacterPoint(dragPos.get(c.id) || layout.value[c.id], geometry.value) : null)
/* 锚点 + 半默认尺寸 = 节点中心；选中态放大时绕中心长，连线端口不会跟着漂 */
function centerOf(c) {
  const p = posOf(c)
  if (!p) return null
  return { x: p.x + geometry.value.width / 2, y: p.y + geometry.value.height / 2 }
}
function rectOf(c) {
  const ct = centerOf(c)
  if (!ct) return null
  const s = sizeOf(c)
  return { x: ct.x - s.w / 2, y: ct.y - s.h / 2, w: s.w, h: s.h }
}
const avatarOf = (c) => (c.avatarAssetId ? work.assetUrl(c.avatarAssetId) : '')
/* 边标签底板宽度（app.mjs:44 edgeMarkup：中文 16/字、其它 9/字 + 18，最小 65；rx=7 在模板里） */
function labelWidth(text) {
  let w = 18
  for (const ch of Array.from(text || '')) w += /[\u3400-\u9fff]/.test(ch) ? 16 : 9
  return Math.max(65, w)
}
const initialOf = (c) => (c.name || '人').trim().slice(0, 1)
const toneOf = (c) => ROLE_COLOR[primaryRole(c)] || '#9fb8a8'

/* ---------- 排布与布局持久化 ---------- */
function circleAll() {
  const list = chars.value
  const R = Math.max(170, list.length * 32)
  const next = {}
  list.forEach((c, i) => {
    const a = (i / list.length) * Math.PI * 2 - Math.PI / 2
    next[c.id] = { x: Math.round(460 + R * Math.cos(a) - geometry.value.width / 2), y: Math.round(340 + R * Math.sin(a) - geometry.value.height / 2) }
  })
  layout.value = next
  scheduleSave()
}
function gridAll() {
  const list = chars.value
  const cols = Math.max(2, Math.ceil(Math.sqrt(list.length)))
  const stepX = geometry.value.selectedWidth + 60
  const stepY = geometry.value.selectedHeight + 60
  const next = {}
  list.forEach((c, i) => {
    next[c.id] = { x: 80 + (i % cols) * stepX, y: 80 + Math.floor(i / cols) * stepY }
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
  const occupied = chars.value.filter((c) => layout.value[c.id]).map((c) => ({ ...layout.value[c.id], ...sizeOf(c) }))
  const next = { ...layout.value }
  for (const c of missing) {
    const s = sizeOf(c)
    const spot = freeSpotFor(occupied, { w: s.w, h: s.h })
    next[c.id] = { x: spot.x, y: spot.y }
    occupied.push({ x: spot.x, y: spot.y, w: s.w, h: s.h })
  }
  layout.value = next
  scheduleSave()
}
async function loadLayout() {
  layout.value = (await work.loadCharGraph()) || {}
  ensureLayout()
}
function scheduleSave() {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => work.saveCharGraph(layout.value), 350)
}
function flushSave() {
  clearTimeout(saveTimer)
  if (work.work && Object.keys(layout.value).length) work.saveCharGraph(layout.value)
}

/* ---------- 相机持久化（key = scope:layout，档位切换各自记一份） ---------- */
const cameraKey = () => scope.value + ':' + (typeof window === 'undefined' || window.innerWidth >= 1100 ? 'wide' : 'compact')
let camTick = 0
let cameraLoading = false
let camTimer = null
function scheduleSaveCamera() {
  clearTimeout(camTimer)
  camTimer = setTimeout(() => {
    work.saveCharCamera?.(cameraKey(), { x: tx.value, y: ty.value, z: zoom.value })
  }, 400)
}
async function restoreCamera() {
  const token = ++camTick
  cameraLoading = true
  try {
    const cam = await work.loadCharCamera?.(cameraKey())
    if (token !== camTick) return
    if (cam) {
      zoom.value = cam.z
      tx.value = cam.x
      ty.value = cam.y
      return
    }
    await nextTick()
    fitView()
    scheduleSaveCamera()
  } finally {
    if (token === camTick) cameraLoading = false
  }
}

/* ---------- 边集合与一度网高亮 ---------- */
const migratedSides = new Set()
function rectsOf() {
  const map = new Map()
  for (const c of chars.value) {
    const r = rectOf(c)
    if (r) map.set(c.id, r)
  }
  return map
}
const edges = computed(() => {
  const out = []
  const rects = rectsOf()
  const obstacles = [...rects.values()]
  for (const r of work.relations) {
    const A = rects.get(r.fromId)
    const B = rects.get(r.toId)
    if (!A || !B) continue
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
    obs.unshift(A, B)
    const g = routeEdge(fa, fromSide, ta, toSide, obs, 'bezier')
    out.push({ rel: r, ...g, dash: dashOf(r.style, ''), stroke: r.color || '' })
  }
  return out
})
const focusId = computed(() => hoverId.value || work.selCharacterId || null)
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
    const r = rectOf(c)
    if (!r) continue
    x0 = Math.min(x0, r.x)
    y0 = Math.min(y0, r.y)
    x1 = Math.max(x1, r.x + r.w)
    y1 = Math.max(y1, r.y + r.h)
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
function screenOfWorld(p) {
  const r = canvasEl.value?.getBoundingClientRect()
  if (!r) return { mx: p.x, my: p.y }
  return { mx: r.left + tx.value + p.x * zoom.value, my: r.top + ty.value + p.y * zoom.value }
}
function hitCharAt(pt, excludeId) {
  for (const c of [...chars.value].reverse()) {
    if (c.id === excludeId) continue
    const r = rectOf(c)
    if (r && pt.x >= r.x && pt.x <= r.x + r.w && pt.y >= r.y && pt.y <= r.y + r.h) return c
  }
  return null
}
function onPanDown(e) {
  panning.value = true
  const stop = () => {
    panning.value = false
    window.removeEventListener('mouseup', stop)
  }
  window.addEventListener('mouseup', stop)
  onPanStart(e)
}
function onNodeDown(e, c) {
  if (e.button !== 0) return
  if (e.target.closest('input, textarea, a')) return
  e.stopPropagation()
  work.selCharacterId = c.id
  relEdit.value = null
  filterOpen.value = false
  /* 底栏「＋ 关系」已持起一端：点另一个节点 = 指定另一端 */
  if (linkFrom.value && linkFrom.value !== c.id) {
    const from = linkFrom.value
    linkFrom.value = null
    const ct = centerOf(c) || { x: 0, y: 0 }
    openRelInput(from, c.id, null, screenOfWorld(ct))
    return
  }
  if (linkFrom.value) return
  const orig = { ...(layout.value[c.id] || { x: 0, y: 0 }) }
  const mx = e.clientX
  const my = e.clientY
  const move = (ev) => {
    dragPos.set(c.id, {
      x: Math.round(orig.x + (ev.clientX - mx) / zoom.value / geometry.value.scaleX),
      y: Math.round(orig.y + (ev.clientY - my) / zoom.value / geometry.value.scaleY)
    })
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
/* 从节点边缘拖线到另一人物 → 弹关系标签输入 */
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
    openRelInput(c.id, target.id, side, { mx: ev.clientX, my: ev.clientY })
  }
  window.addEventListener('mousemove', move)
  window.addEventListener('mouseup', up)
}
function openRelInput(fromId, toId, side, at) {
  relInput.value = { fromId, toId, side, mx: at.mx, my: at.my, value: '' }
  nextTick(() => relInputEl.value?.focus())
}
const connPath = computed(() => {
  const c = connecting.value
  if (!c) return ''
  const from = work.liveCharacters.find((x) => x.id === c.fromId)
  const r = from && rectOf(from)
  const start = r ? anchorsOf(r)[c.side] : c
  return 'M ' + start.x + ' ' + start.y + ' L ' + c.x + ' ' + c.y
})
/* 关系几何（严格端口 + 绕行）：拖线编辑定位 / 已有关系复用 */
function relGeom(rel) {
  const rects = rectsOf()
  const A = rects.get(rel.fromId)
  const B = rects.get(rel.toId)
  if (!A || !B) return null
  const sb = sideBetween(A, B)
  const fromSide = rel.fromSide || sb.from
  const toSide = rel.toSide || sb.to
  const fa = anchorsOf(A)[fromSide]
  const ta = anchorsOf(B)[toSide]
  if (!fa || !ta) return null
  const obs = [...rects.values()].filter((o) => !(o.x === A.x && o.y === A.y) && !(o.x === B.x && o.y === B.y))
  obs.unshift(A, B)
  return routeEdge(fa, fromSide, ta, toSide, obs, 'bezier')
}
function saveRelInput() {
  const st = relInput.value
  relInput.value = null
  if (!st) return
  const from = chars.value.find((x) => x.id === st.fromId)
  const to = work.liveCharacters.find((x) => x.id === st.toId)
  const A = from && rectOf(from)
  const B = to && rectOf(to)
  if (!A || !B) return
  const toSide = sideBetween(A, B).to
  const label = st.value.trim()
  work.addRelation(st.fromId, st.toId, label || '关联', { fromSide: st.side || sideBetween(A, B).from, toSide })
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
  const t = e.target
  if (relEdit.value && !t.closest?.('.graph-eedit, .graph-elabel, .graph-edge-hit')) relEdit.value = null
  if (relInput.value && !t.closest?.('.graph-relinput')) saveRelInput()
  if (ctxMenu.value && !t.closest?.('.graph-ctx')) ctxMenu.value = null
  if (blankCtx.value && !t.closest?.('.graph-blankctx')) blankCtx.value = null
  if (filterOpen.value && !t.closest?.('.graph-filters, .graph-more')) filterOpen.value = false
}
/* 人物节点右键菜单：发送为大纲引用卡 / 打开详情 */
function openCtx(e, c) {
  work.selCharacterId = c.id
  blankCtx.value = null
  ctxMenu.value = { charId: c.id, mx: e.clientX, my: e.clientY }
}
/* 画布空白右键：在此处新建人物并选中 */
function onBlankCtx(e) {
  /* SVG 路径的 contextmenu 命中可能与 mousedown 不一致——反查真实落点 */
  const t = document.elementFromPoint(e.clientX, e.clientY)
  const hitEl = t && (t.classList?.contains('graph-edge-hit') ? t : t.closest?.('.graph-edge-hit'))
  if (hitEl && hitEl.dataset.rel) {
    const rel = work.relations.find((r) => r.id === hitEl.dataset.rel)
    if (rel) {
      const g = relGeom(rel)
      if (g) openRelEdit(rel, g.mid)
      return
    }
  }
  if (e.target.closest?.('.graph-node, .graph-elabel, .graph-edge-hit, .graph-eedit, .graph-ctx, .graph-pop')) return
  const p = canvasPt(e)
  blankCtx.value = { mx: e.clientX, my: e.clientY, px: p.x, py: p.y }
}
function createCharAt() {
  const st = blankCtx.value
  blankCtx.value = null
  if (!st) return
  const row = work.addCharacter()
  layout.value = { ...layout.value, [row.id]: projectCharacterPoint({ x: st.px - geometry.value.width / 2, y: st.py - geometry.value.height / 2 }, geometry.value, true) }
  scheduleSave()
  work.selCharacterId = row.id
}
/* Delete / Backspace 删除选中人物（软删，可在回收站恢复；输入态不劫持） */
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
  filterOpen.value = false
  onWheel(ev)
}
function nodeStyle(c) {
  const ct = centerOf(c)
  if (!ct) return { display: 'none' }
  return {
    left: ct.x + 'px',
    top: ct.y + 'px',
    '--tone': toneOf(c),
    zIndex: work.selCharacterId === c.id ? 6 : 3
  }
}
/* 页头「人物卷宗」/ 双击节点 / 孤岛 ── 视图切换一律交回外壳（work.charView 仍是持久化真源） */
function goProfile() {
  if (shell?.setView) shell.setView('profile')
  else work.charView = 'list'
}
const selectedChar = computed(() => chars.value.find((c) => c.id === work.selCharacterId) || null)
function openDetail(c) {
  work.selCharacterId = c.id
  goProfile()
}
function locateIsolated(c) {
  work.selCharacterId = c.id
  work.charFocusId = c.id
  work.charFocusTick++
}
/* 定位请求可能先于组件挂载（跨模块跳转）——以 handled 戳补处理，不丢闪 */
function focusCharById(id) {
  const c = work.liveCharacters.find((x) => x.id === id)
  if (!c) return
  roleFilter.value = '全部'
  tagFilter.value = []
  if (scope.value === 'local' && active.value && id !== active.value.id) {
    const near = work.relations.some((r) => (r.fromId === active.value.id && r.toId === id) || (r.toId === active.value.id && r.fromId === id))
    if (!near) setScope('all')
  }
  nextTick(() => {
    const r = rectOf(c)
    if (r) centerOn(r.x + r.w / 2, r.y + r.h / 2)
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
function setScope(next) {
  const v = next === 'all' ? 'all' : 'local'
  if (ui.charScope === v) return
  ui.charScope = v
  ui.saveCharState(work.work?.id, { scope: v })
  nextTick(() => {
    ensureLayout()
    restoreCamera()
  })
}
function toggleRole(r) {
  roleFilter.value = roleFilter.value === r ? '全部' : r
  nextTick(() => {
    ensureLayout()
    fitView()
  })
}
function toggleTag(t) {
  tagFilter.value = tagFilter.value.includes(t) ? tagFilter.value.filter((x) => x !== t) : [...tagFilter.value, t]
  nextTick(() => {
    ensureLayout()
    fitView()
  })
}
/* ---------- 缩放条 / 底栏动作 ---------- */
function zoomBy(delta) {
  zoom.value = Math.min(2.2, Math.max(0.3, zoom.value + delta))
}
function resetZoom() {
  zoom.value = 1
  const r = selectedChar.value && rectOf(selectedChar.value)
  if (r) centerOn(r.x + r.w / 2, r.y + r.h / 2)
}
function focusSelected() {
  const r = selectedChar.value && rectOf(selectedChar.value)
  if (r) centerOn(r.x + r.w / 2, r.y + r.h / 2)
}
function armRelation() {
  if (!work.selCharacterId) return
  linkFrom.value = work.selCharacterId
}
/* 窄档三段工具条（外壳负责渲染；未实现时可选链直接跳过） */
function syncBar() {
  if (!shell?.narrow?.value || !shell?.setBar) return
  shell.setBar({
    left: { label: '‹ 人物名录', act: () => shell?.openDrawer?.() },
    title: active.value?.name || '关系剧场',
    right: { label: '档案', act: () => shell?.showContext?.() }
  })
}

watch(() => work.charFocusTick, maybeFocus)
watch(() => ui.skin, () => nextTick(fitView))
watch([() => tx.value, () => ty.value, () => zoom.value], () => {
  if (!cameraLoading) scheduleSaveCamera()
})
watch(() => [active.value?.name, shell?.narrow?.value].join('|'), syncBar)
/* 关系图打开期间新增的人物：补布局坐标并持久化——否则 posOf 为 null → display:none，新人物隐身 */
watch(
  () => chars.value.map((c) => c.id).join('|'),
  () => {
    ensureLayout()
    scheduleSave()
  }
)
let lastKey = null
function onWinResize() {
  const k = cameraKey()
  if (lastKey && k !== lastKey) {
    lastKey = k
    restoreCamera()
  } else {
    lastKey = k
  }
}

onMounted(async () => {
  await loadLayout()
  window.addEventListener('mousedown', onWinDown, true)
  window.addEventListener('keydown', onKeyC)
  window.addEventListener('resize', onWinResize)
  const ids = work.liveCharacters.filter((ch) => ch.avatarAssetId).map((ch) => ch.avatarAssetId)
  if (ids.length) await work.warmUrls(ids)
  lastKey = cameraKey()
  await restoreCamera()
  maybeFocus()
  syncBar()
})
onBeforeUnmount(() => {
  window.removeEventListener('mousedown', onWinDown, true)
  window.removeEventListener('keydown', onKeyC)
  window.removeEventListener('resize', onWinResize)
  clearTimeout(camTimer)
  work.saveCharCamera?.(cameraKey(), { x: tx.value, y: ty.value, z: zoom.value })
  flushSave()
})
</script>

<template>
  <div class="graph-pane">
    <!-- 页头：module-head（111px） -->
    <header class="module-head">
      <div>
        <div class="breadcrumbs">
          <span>{{ work.work?.title || '未命名作品' }}</span>
          <i>›</i>
          <span>人物</span>
        </div>
        <h1>关系剧场</h1>
      </div>
      <div class="head-actions">
        <span class="segmented" role="group" aria-label="人物视图">
          <button type="button" :class="{ on: shell?.view?.value === 'profile' }" :aria-pressed="shell?.view?.value === 'profile'" @click="goProfile">人物卷宗</button>
          <button type="button" class="on" aria-pressed="true">关系剧场</button>
        </span>
        <!-- 宽档一左一右两颗收起键（studio.css .head-actions 的 toggle-left/toggle-right；≤1099 由 CSS 隐藏） -->
        <button
          class="icon-btn char-head-toggle"
          type="button"
          data-act="toggle-left"
          :aria-label="shell?.closed?.value?.left ? '展开人物名录' : '收起人物名录'"
          :title="shell?.closed?.value?.left ? '展开人物名录' : '收起人物名录'"
          @click="shell?.toggleRoster?.()"
        >
          <OIcon name="user" :size="15" />
        </button>
        <button
          class="icon-btn char-head-toggle"
          type="button"
          data-act="toggle-right"
          :aria-label="shell?.closed?.value?.right ? '展开关系与设定' : '收起关系与设定'"
          :title="shell?.closed?.value?.right ? '展开关系与设定' : '收起关系与设定'"
          @click="shell?.toggleContext?.()"
        >
          <OIcon name="rows" :size="15" />
        </button>
      </div>
    </header>

    <!-- 范围条：人物名 · N 人物 / M 关系 + 一度关系/全部人物 + ⋯（角色·标签筛选与排布） -->
    <div class="graph-subbar">
      <span>
        <b v-if="active">{{ active.name || '未命名' }}</b>
        <b v-if="active"> · </b>{{ chars.length }} 人物 / {{ edges.length }} 关系
        <button v-if="isolated.length" class="graph-island" type="button" :title="'暂无任何关系：' + isolated.map((c) => c.name).join('、')" @click="locateIsolated(isolated[0])">孤岛 {{ isolated.length }}</button>
      </span>
      <div class="graph-tools">
        <span class="segmented" role="group" aria-label="关系范围">
          <button type="button" :class="{ on: scope === 'local' }" :aria-pressed="scope === 'local'" @click="setScope('local')">一度关系</button>
          <button type="button" :class="{ on: scope === 'all' }" :aria-pressed="scope === 'all'" @click="setScope('all')">全部人物</button>
        </span>
        <button class="icon-btn graph-more" type="button" title="筛选与排布" aria-label="筛选与排布" :aria-pressed="filterOpen" @click="filterOpen = !filterOpen">
          <OIcon name="dots" :size="15" />
        </button>
      </div>

      <div v-if="filterOpen" class="graph-filters">
        <h4>角色</h4>
        <div class="graph-row">
          <button v-for="r in roleOptions" :key="r" class="graph-chip" :class="{ on: roleFilter === r }" type="button" @click="toggleRole(r)">{{ r }}</button>
        </div>
        <h4>标签</h4>
        <div class="graph-row">
          <button v-for="t in allTags" :key="t" class="graph-chip" :class="{ on: tagFilter.includes(t) }" type="button" @click="toggleTag(t)">{{ t }}</button>
          <span v-if="!allTags.length" class="graph-chip" style="cursor: default; opacity: .6">暂无标签</span>
        </div>
        <h4>排布</h4>
        <div class="graph-row">
          <button class="graph-chip act" type="button" @click="circleAll"><OIcon name="circle-layout" :size="12" />圆形</button>
          <button class="graph-chip act" type="button" @click="gridAll"><OIcon name="grid" :size="12" />网格</button>
        </div>
      </div>
    </div>

    <!-- 舞台：点阵底 + 可平移缩放的世界层 -->
    <div
      ref="canvasEl"
      class="graph-stage"
      :class="{ panning }"
      aria-label="可平移和缩放的人物关系画布"
      @mousedown="onPanDown"
      @wheel="onWheelC"
      @contextmenu.prevent="onBlankCtx"
    >
      <div class="graph-world" :style="innerStyle">
        <svg
          class="graph-edges"
          :style="{ left: svgBox.x + 'px', top: svgBox.y + 'px' }"
          :width="svgBox.w"
          :height="svgBox.h"
          :viewBox="svgBox.x + ' ' + svgBox.y + ' ' + svgBox.w + ' ' + svgBox.h"
        >
          <path
            v-for="e in edges"
            :key="'h' + e.rel.id"
            class="graph-edge-hit"
            :d="e.d"
            :data-rel="e.rel.id"
            @mousedown.stop="openRelEdit(e.rel, e.mid)"
            @contextmenu.prevent.stop="openRelEdit(e.rel, e.mid)"
          >
            <title>点击或右键编辑连线（标签 / 线型 / 颜色）</title>
          </path>
          <path
            v-for="e in edges"
            :key="'v' + e.rel.id"
            class="graph-edge"
            :class="{ adjacent: focusId === e.rel.fromId || focusId === e.rel.toId }"
            :d="e.d"
            :stroke="e.stroke || null"
            :stroke-dasharray="e.dash || null"
            :opacity="dimEdgeIds.has(e.rel.id) ? 0.1 : null"
          />
          <path v-if="connecting" class="graph-draft" :d="connPath" />
          <g
            v-for="e in edges.filter((x) => x.rel.label)"
            :key="'l' + e.rel.id"
            class="graph-elabel"
            :opacity="dimEdgeIds.has(e.rel.id) ? 0.12 : null"
            @mousedown.stop="openRelEdit(e.rel, e.mid)"
            @contextmenu.prevent.stop="openRelEdit(e.rel, e.mid)"
          >
            <rect
              class="edge-label-bg"
              :x="e.mid.x - labelWidth(e.rel.label) / 2"
              :y="e.mid.y - 11"
              :width="labelWidth(e.rel.label)"
              height="22"
              rx="7"
            />
            <text class="edge-label" :x="e.mid.x" :y="e.mid.y + 4" text-anchor="middle">{{ e.rel.label }}</text>
          </g>
        </svg>

        <!-- 人物节点（中心定位：选中态放大绕中心长） -->
        <div
          v-for="c in chars"
          :key="c.id"
          :ref="(el) => setNodeEl(c.id, el)"
          class="graph-node"
          :class="{ selected: work.selCharacterId === c.id, dimmed: dimIds.has(c.id), flash: flashIds.has(c.id) }"
          :data-id="c.id"
          :style="nodeStyle(c)"
          role="button"
          tabindex="0"
          :aria-label="(c.name || '未命名') + '，' + (primaryRole(c) || '未定')"
          @mousedown="onNodeDown($event, c)"
          @contextmenu.prevent="openCtx($event, c)"
          @mouseenter="hoverId = c.id"
          @mouseleave="hoverId = null"
          @dblclick.stop="openDetail(c)"
          @keydown.enter.prevent="openDetail(c)"
        >
          <span class="portrait">
            <img v-if="avatarOf(c)" :src="avatarOf(c)" alt="" />
            <template v-else>{{ initialOf(c) }}</template>
          </span>
          <h3>{{ c.name || '未命名' }}</h3>
          <small>{{ primaryRole(c) || '未定' }}</small>
          <span
            v-for="sd in SIDES"
            :key="sd"
            class="graph-port"
            :data-side="sd"
            title="拖到另一人物建立/修改关系"
            @mousedown="startConnect($event, c)"
          />
        </div>
      </div>

      <span class="graph-hint">拖动人物排布 · 拖动空白平移</span>

      <div v-if="!work.liveCharacters.length" class="graph-empty">
        <strong>众生有相</strong>
        <p>先在人物卷宗里创建人物，再回到关系剧场连线成网。</p>
        <button type="button" @click="goProfile">去创建人物</button>
      </div>
    </div>

    <!-- 底栏：提示 + 缩放条 + 新建关系 -->
    <footer class="graph-foot">
      <span><OIcon name="link" :size="11" /> 选择人物，查看彼此的故事</span>
      <div class="zoom-controls" role="group" aria-label="缩放">
        <button type="button" aria-label="缩小" title="缩小" @click="zoomBy(-0.15)"><OIcon name="minus" :size="13" /></button>
        <button type="button" aria-label="恢复百分之百缩放" title="恢复百分之百缩放" @click="resetZoom">{{ Math.round(zoom * 100) }}%</button>
        <button type="button" aria-label="放大" title="放大" @click="zoomBy(0.15)"><OIcon name="plus" :size="13" /></button>
        <i></i>
        <button type="button" aria-label="适应画布" title="适应画布" @click="fitView"><OIcon name="fit" :size="13" /></button>
        <button type="button" aria-label="聚焦当前人物" title="聚焦当前人物" :disabled="!selectedChar" @click="focusSelected"><OIcon name="map-pin" :size="13" /></button>
      </div>
      <button class="btn" type="button" :disabled="!work.selCharacterId" :title="linkFrom ? '现在点另一个节点作为另一端' : '以当前人物为起点新建关系'" @click="armRelation">
        <OIcon name="plus" :size="12" />{{ linkFrom ? '选择另一端' : '关系' }}
      </button>
    </footer>

    <!-- 浮层一律 Teleport 到 .app-root：fixed 定位，不随画布缩放变形，也保留主题变量 -->
    <Teleport to=".app-root">
      <div v-if="relInput" class="graph-pop graph-relinput" :style="{ left: relInput.mx + 'px', top: relInput.my + 'px' }" @mousedown.stop>
        <input ref="relInputEl" v-model="relInput.value" placeholder="关系（如：师徒 / 宿敌）…" @keydown.enter="saveRelInput" @keydown.esc="relInput = null" />
        <button type="button" title="保存" @click="saveRelInput"><OIcon name="check" :size="13" /></button>
      </div>

      <div v-if="relEdit" class="graph-pop graph-eedit" :class="{ flip: relEdit.flip }" :style="{ left: relEdit.mx + 'px', top: relEdit.my + 'px' }" @mousedown.stop @contextmenu.prevent.stop>
        <input :value="curRel()?.label || ''" placeholder="关系标签…" @input="patchRelLabel" @keydown.enter="relEdit = null" @keydown.esc="relEdit = null" />
        <div class="graph-kindrow">
          <span
            v-for="s in EDGE_STYLES"
            :key="s.key"
            class="graph-kind"
            :class="{ on: (curRel()?.style || '') === (s.key === 'solid' ? '' : s.key) }"
            @click="patchRel({ style: s.key === 'solid' ? '' : s.key })"
          >{{ s.label }}</span>
        </div>
        <div class="graph-swatches">
          <span class="graph-sw" :class="{ on: !(curRel()?.color || '') }" title="主题色" @click="patchRel({ color: '' })"></span>
          <span
            v-for="col in REL_COLORS"
            :key="col"
            class="graph-sw"
            :class="{ on: (curRel()?.color || '') === col }"
            :style="{ background: col }"
            :title="col"
            @click="patchRel({ color: col })"
          ></span>
          <button class="graph-del" type="button" title="删除关系" @click="removeRel"><OIcon name="close" :size="12" /></button>
        </div>
      </div>

      <div v-if="ctxMenu" class="graph-pop graph-ctx" :style="{ left: ctxMenu.mx + 'px', top: ctxMenu.my + 'px' }" @mousedown.stop>
        <button type="button" title="发送为大纲画布引用卡" @click="ctxSendOutline">发送为大纲引用卡</button>
        <button type="button" title="打开人物详情（也可双击节点）" @click="ctxOpenDetail">打开详情</button>
      </div>

      <div v-if="blankCtx" class="graph-pop graph-blankctx" :style="{ left: blankCtx.mx + 'px', top: blankCtx.my + 'px' }" @mousedown.stop>
        <button type="button" title="新建人物并放到此处" @click="createCharAt">＋ 新建人物</button>
      </div>
    </Teleport>
  </div>
</template>
