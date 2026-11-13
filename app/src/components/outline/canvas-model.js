import { createRoute, planOrthogonal, routePoint, trimRoute, channelCost } from './canvas-routing.js'
export { projectOnRoute, flattenRoute, shapePorts, routeIsClear, labelPoint } from './canvas-routing.js'
/* 自由模块画布纯逻辑（8.8.2 / 计划书 9.4.2）：元数据、尺寸、容器派生盒、布局算法、骨架模板。
 * 零依赖（不 import Vue），可被 node 直跑自测（tools/canvas-model-test.mjs）。 */

/* ---------- 节点尺寸与落点 ---------- */

/* 引力书舱档位：按设计稿放大卡片，容纳顶部类型行与宋体大标题（仅新增档位，原版与紧凑口径不变） */
/* 引力书舱沿用既有放大档位：新设计稿的纸面排版适配这套尺寸，
 * 不改变旧作品的卡片占位，避免进入容器后原有坐标互相压叠。 */
const ROOMY_SIZE = {
  event: { w: 210, h: 130 },
  note: { w: 196, h: 130 },
  cite: { w: 190, h: 130 },
  anchor: { w: 190, h: 130 },
  volume: { w: 190, h: 130 },
  textbox: { w: 240, h: 110 },
  container: { w: 300, h: 180 }
}

/* Paper detail is a presentation default; explicit saved w/h always take precedence. */
const PAPER_SIZE = {event:{w:224,h:154},note:{w:248,h:178},cite:{w:264,h:177},anchor:{w:240,h:153},volume:{w:210,h:124},textbox:{w:300,h:100},container:{w:460,h:178}}
/** 画布节点尺寸（kind × 密度），container 为空态基准尺寸 */
export function canvasNodeSize(n, density = 'detail') {
  if (density === 'draft') return ({event:{w:204,h:141},note:{w:178,h:128},cite:{w:178,h:128},anchor:{w:178,h:128},volume:{w:190,h:128},textbox:{w:240,h:110},container:{w:400,h:178}})[n.kind] || PAPER_SIZE.container
  if (density === 'paper') return PAPER_SIZE[n.kind] || PAPER_SIZE.container
  if (density === 'roomy') return ROOMY_SIZE[n.kind] || ROOMY_SIZE.container
  const c = density === 'compact'
  switch (n.kind) {
    case 'event':
      return c ? { w: 138, h: 40 } : { w: 178, h: 54 }
    case 'note':
      return c ? { w: 130, h: 58 } : { w: 158, h: 76 }
    case 'cite':
      return { w: 154, h: 34 }
    case 'anchor':
    case 'volume':
      return c ? { w: 142, h: 38 } : { w: 180, h: 48 }
    default:
      return { w: 280, h: 120 } // container
  }
}

/* 非矩形事件形状的设计盒（与 outline-paper.js 的 EVENT_SHAPES 同源）：纸面美术按这套宽高绘制，
 * .oc-paper 是 background-size:100% 100%，只有盒子同比例时才不会被拉扁。 */
const SHAPE_SIZE = {
  para: { w: 254, h: 170 },
  diamond: { w: 250, h: 210 },
  ellipse: { w: 210, h: 118 }
}

/** 形状设计尺寸：paper 密度直接取设计盒，其余密度按该密度的基准宽度等比缩放（比例不变） */
export function shapeSize(shape, density = 'paper') {
  const d = SHAPE_SIZE[shape]
  if (!d) return null
  if (density === 'paper') return { w: d.w, h: d.h }
  const k = canvasNodeSize({ kind: 'event' }, density).w / d.w
  return { w: Math.round(d.w * k), h: Math.round(d.h * k) }
}

/** 形状尺寸：非矩形按形状设计比例出盒；节点自定义 w/h 优先（显式拖拽结果，容器作为派生盒下限） */
export function effSize(n, density = 'detail') {
  const design = n.kind === 'event' ? SHAPE_SIZE[n.shape] : null
  if (n.w != null || n.h != null) {
    const s = canvasNodeSize(n, density)
    let w = Math.max(96, n.w != null ? n.w : s.w)
    let h = Math.max(36, n.h != null ? n.h : s.h)
    /* 只手动改过一条边时，另一条边按形状比例补齐，纸面才不会一侧被拉扁 */
    if (design) {
      if (n.w == null) w = Math.max(96, Math.round(h * design.w / design.h))
      else if (n.h == null) h = Math.max(36, Math.round(w * design.h / design.w))
    }
    return { w, h }
  }
  if (design) return shapeSize(n.shape, density)
  return canvasNodeSize(n, density)
}

/* ---------- 连线样式（v0.4.1 界面优化）：实线 / 虚线 / 点线 ---------- */
export const EDGE_STYLES = [
  { key: 'solid', label: '实线' },
  { key: 'dashed', label: '虚线' },
  { key: 'dotted', label: '点线' }
]
/** 渲染 dasharray：显式线型优先，未设置时伏笔类默认虚线 */
export function dashOf(style, kind) {
  if (style === 'dashed') return '5 4'
  if (style === 'dotted') return '2 3'
  if (style === 'solid') return null
  return relDashed(kind) ? '5 4' : null
}

/* 连线自定义色板（v0.4.12）：首项=主题色（空值，跟随关系类型配色），其余为常用色 */
export const EDGE_COLORS = ['#59877e', '#ae715f', '#8971a2', '#b28443', '#6e8c79', '#7f8c8d']
/** 边渲染色：自定义 color 优先，否则按关系类型配色 */
export function edgeColor(rel) {
  return rel.color || relColor(rel.kind)
}

/* ---------- 连线端口严格化 + 避障路由（v0.4.14 / v0.4.16 重写） ----------
 * 端口在建立时记录（fromSide/toSide），渲染严格使用，不随节点挪位回退就近侧；
 * 避障路由 v0.4.16 起为全局最优：先试最简首形，被挡时在 Hanan 稀疏网格上跑
 * A*（长度 + 转向惩罚）求最短折线并拉直收敛，旧贪心逐段绕行仅作病态兜底。 */

/** 依据两矩形相对位置给出默认端口组合（建边未记录侧 / 旧数据回退用） */
export function sideBetween(A, B) {
  const dx = B.x + B.w / 2 - (A.x + A.w / 2)
  const dy = B.y + B.h / 2 - (A.y + A.h / 2)
  if (Math.abs(dx) >= Math.abs(dy)) {
    return { from: dx >= 0 ? 'right' : 'left', to: dx >= 0 ? 'left' : 'right' }
  }
  return { from: dy >= 0 ? 'bottom' : 'top', to: dy >= 0 ? 'top' : 'bottom' }
}

/** 轴对齐线段是否穿过矩形（严格重叠：仅贴合边缘不算穿过） */
export function segHitsRect(ax, ay, bx, by, r) {
  const minx = Math.min(ax, bx)
  const maxx = Math.max(ax, bx)
  const miny = Math.min(ay, by)
  const maxy = Math.max(ay, by)
  return maxx > r.x && minx < r.x + r.w && maxy > r.y && miny < r.y + r.h
}

/** 带皮命中测试（A* 与拉直用）：贴边滑行（间距 < 2px）视为穿过，保证绕行段至少留出可视间隙 */
function segHitsSkin(ax, ay, bx, by, r, pad = 2) {
  return segHitsRect(ax, ay, bx, by, { x: r.x - pad, y: r.y - pad, w: r.w + pad * 2, h: r.h + pad * 2 })
}

/**
 * [v0.4.16 重写] 稀疏网格 A*：在由障碍膨胀边界（±margin）与两端桩端点张成的 Hanan 网格上
 * 求正交最短路，代价 = 段长 + 转向惩罚（少弯优先）；网格线天然与障碍保持 margin 间距，
 * 全局择优，不再产生包络大环绕与重复平行段。dir0 / dirGoal 为出/入桩行进方向
 * （端点处的转弯同样计价），返回 p1→p2 折点数组（含两端），不可达返回 null。
 */
function astarOrtho(p1, p2, obstacles, margin, dir0, dirGoal, turnPenalty, context = {}) {
  const xs = [p1.x, p2.x]
  const ys = [p1.y, p2.y]
  for (const o of obstacles) {
    xs.push(o.x - margin, o.x + o.w + margin)
    ys.push(o.y - margin, o.y + o.h + margin)
  }
  for (const p of [...(context.waypoints || []), ...(context.previous?.pts || [])]) { xs.push(p.x); ys.push(p.y) }
  // Stable parallel lanes are candidates, never hard exclusions (crossings remain legal).
  for (const s of context.occupiedSegments || []) {
    if (Math.abs(s.a.y-s.b.y)<.01) ys.push(s.a.y-12,s.a.y+12)
    else if (Math.abs(s.a.x-s.b.x)<.01) xs.push(s.a.x-12,s.a.x+12)
  }
  xs.sort((a, b) => a - b)
  ys.sort((a, b) => a - b)
  const X = []
  const Y = []
  for (const v of xs) if (!X.length || v - X[X.length - 1] >= 0.5) X.push(v)
  for (const v of ys) if (!Y.length || v - Y[Y.length - 1] >= 0.5) Y.push(v)
  const NX = X.length
  const NY = Y.length
  if (!NX || !NY || NX * NY > 30000) return null
  const idxNear = (arr, v) => arr.findIndex((u) => Math.abs(u - v) < 0.5)
  const sxi = idxNear(X, p1.x)
  const syi = idxNear(Y, p1.y)
  const gxi = idxNear(X, p2.x)
  const gyi = idxNear(Y, p2.y)
  if (sxi < 0 || syi < 0 || gxi < 0 || gyi < 0) return null
  /* 网格边通行缓存：0 未知 / 1 通 / 2 堵（segHitsRect 为严格重叠，贴边不算穿过） */
  const H = new Uint8Array(NX * NY)
  const V = new Uint8Array(NX * NY)
  const hClear = (i, j) => {
    const k = j * NX + i
    if (!H[k]) {
      H[k] = 1
      for (const o of obstacles) if (segHitsSkin(X[i], Y[j], X[i + 1], Y[j], o)) { H[k] = 2; break }
    }
    return H[k] === 1
  }
  const vClear = (i, j) => {
    const k = j * NX + i
    if (!V[k]) {
      V[k] = 1
      for (const o of obstacles) if (segHitsSkin(X[i], Y[j], X[i], Y[j + 1], o)) { V[k] = 2; break }
    }
    return V[k] === 1
  }
  const stateOf = (i, j, d) => (j * NX + i) * 4 + d
  const NS = NX * NY * 4
  const gScore = new Float64Array(NS).fill(Infinity)
  const came = new Int32Array(NS).fill(-1)
  const heap = []
  const hpush = (f, s) => {
    heap.push([f, s])
    let c = heap.length - 1
    while (c > 0) {
      const p = (c - 1) >> 1
      if (heap[p][0] <= heap[c][0]) break
      const t = heap[p]
      heap[p] = heap[c]
      heap[c] = t
      c = p
    }
  }
  const hpop = () => {
    const top = heap[0]
    const last = heap.pop()
    if (heap.length) {
      heap[0] = last
      let c = 0
      for (;;) {
        const l = c * 2 + 1
        const r = l + 1
        let m = c
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r
        if (m === c) break
        const t = heap[m]
        heap[m] = heap[c]
        heap[c] = t
        c = m
      }
    }
    return top
  }
  const hDist = (i, j) => Math.abs(X[i] - X[gxi]) + Math.abs(Y[j] - Y[gyi])
  const start = stateOf(sxi, syi, dir0)
  gScore[start] = 0
  hpush(hDist(sxi, syi), start)
  let pops = 0
  while (heap.length) {
    const s = hpop()[1]
    if (++pops > 120000) return null
    const d = s & 3
    const cell = s >> 2
    const ci = cell % NX
    const cj = (cell - ci) / NX
    if (ci === gxi && cj === gyi && (dirGoal == null || (d ^ 1) !== dirGoal)) {
      const pts = []
      for (let t = s; t >= 0; t = came[t]) {
        const c = t >> 2
        const ti = c % NX
        pts.push({ x: X[ti], y: Y[(c - ti) / NX] })
      }
      return pts.reverse()
    }
    const g = gScore[s]
    for (let nd = 0; nd < 4; nd++) {
      if ((nd ^ 1) === d) continue // 不掉头
      let ni = ci
      let nj = cj
      if (nd === 0) {
        if (ci + 1 >= NX || !hClear(ci, cj)) continue
        ni = ci + 1
      } else if (nd === 1) {
        if (ci === 0 || !hClear(ci - 1, cj)) continue
        ni = ci - 1
      } else if (nd === 2) {
        if (cj + 1 >= NY || !vClear(ci, cj)) continue
        nj = cj + 1
      } else {
        if (cj === 0 || !vClear(ci, cj - 1)) continue
        nj = cj - 1
      }
      const goal = ni === gxi && nj === gyi
      if (goal && dirGoal != null && (nd ^ 1) === dirGoal) continue
      let congestion = 0
      for (const seg of context.occupiedSegments || []) congestion += channelCost({ x: X[ci], y: Y[cj] }, { x: X[ni], y: Y[nj] }, seg.a, seg.b)
      const ng =
        g + Math.abs(X[ni] - X[ci]) + Math.abs(Y[nj] - Y[cj]) + (nd === d ? 0 : turnPenalty) + (goal && dirGoal != null && nd !== dirGoal ? turnPenalty : 0) + congestion
      const ns = stateOf(ni, nj, nd)
      if (ng < gScore[ns] - 1e-9) {
        gScore[ns] = ng
        came[ns] = s
        hpush(ng + hDist(ni, nj), ns)
      }
    }
  }
  return null
}

/** Orthogonal compatibility entry. Unreachable routes retain endpoints; routeEdge adds status. */
export function routeOrthogonal(from, fromSide, to, toSide, obstacles = [], stub = 18, margin = 16, context = {}) {
  return planOrthogonal(from, fromSide, to, toSide, obstacles, stub, margin, context, astarOrtho).pts
}

/** 折线路径（拐圆角），返回 SVG d 字符串 */
export function pathFromPoints(pts, r = 10) {
  if (!pts || pts.length < 2) return ''
  let d = `M ${pts[0].x} ${pts[0].y}`
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i]
    const prev = pts[i - 1]
    const next = pts[i + 1]
    const l1 = Math.hypot(p.x - prev.x, p.y - prev.y) || 1
    const l2 = Math.hypot(next.x - p.x, next.y - p.y) || 1
    const rr = Math.min(r, l1 / 2, l2 / 2)
    const u = { x: (p.x - prev.x) / l1, y: (p.y - prev.y) / l1 }
    const v = { x: (next.x - p.x) / l2, y: (next.y - p.y) / l2 }
    d += ` L ${p.x - u.x * rr} ${p.y - u.y * rr} Q ${p.x} ${p.y}, ${p.x + v.x * rr} ${p.y + v.y * rr}`
  }
  const last = pts[pts.length - 1]
  d += ` L ${last.x} ${last.y}`
  return d
}

/** 折线中点（按长度一半处）——标签/浮层定位 */
export function polyMid(pts) {
  if (!pts || pts.length < 2) return { x: 0, y: 0 }
  let total = 0
  for (let i = 0; i < pts.length - 1; i++) total += Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y)
  let acc = 0
  for (let i = 0; i < pts.length - 1; i++) {
    const l = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y)
    if (acc + l >= total / 2) {
      const t = (total / 2 - acc) / (l || 1)
      return { x: pts[i].x + (pts[i + 1].x - pts[i].x) * t, y: pts[i].y + (pts[i + 1].y - pts[i].y) * t }
    }
    acc += l
  }
  return pts[pts.length - 1]
}

/** Unified visible segments; optional routing context preserves the existing call signature. */
export function routeEdge(a, fromSide, b, toSide, obstacles = [], style = 'bezier', stub = 18, margin = 16, context = {}) {
  return createRoute(a, fromSide, b, toSide, obstacles, style, stub, margin, context, astarOrtho)
}

/**
 * 按箭头长度截短连线路径（v1.0.14）：箭头尖端顶在真实端点上，线画到箭头底边为止，
 * 消除粗线帽盖住三角内部的"穿线"感。trime/trtrims 分别为末/首端回缩长度（=箭头尺寸）。
 */
export function trimEdgeD(g, trime = 0, trims = 0) {
  return g ? trimRoute(g, trime, trims) : ''
}

/** 连线路径参数 t∈[0,1] 处的点：折线按弧长插值，贝塞尔按三次曲线求值。
 * 连接点位置由宿主连线路径派生（v1.0.13），节点挪位/重排后连线重算，连接点随之回到线上。 */
export function pointAtT(g, t) { return routePoint(g, t) }

/**
 * 为新节点找一个不与现有矩形重叠的落点：从起点逐格右移扫描，超过行宽换行。
 * occupied 为已有节点矩形数组。
 */
export function freeSpotFor(occupied, size, startX = 40, startY = 40, stepX = 40, rowWidth = 2800) {
  let x = startX
  let y = startY
  let tries = 0
  while (tries < 400) {
    const clash = occupied.some((r) => x < r.x + r.w + 24 && x + size.w + 24 > r.x && y < r.y + r.h + 24 && y + size.h + 24 > r.y)
    if (!clash) return { x, y }
    x += stepX
    if (x > rowWidth) {
      x = startX
      y += size.h + 56
    }
    tries++
  }
  return { x, y }
}

/* ---------- 容器网格常量 ---------- */
export const CELL_W = 216
export const CELL_H = 100
export const C_PAD = 18
export const C_TITLE = 34
export const C_PADB = 16

export const gridCols = (cnt) => Math.max(1, Math.min(3, Math.ceil(Math.sqrt(Math.max(1, cnt)))))

/** 容器子项网格步长：随卡片档位放大，否则放大的子项会互相压住 */
export const gridCell = (density = 'detail') => (density === 'roomy' ? { w: 226, h: 150 } : { w: CELL_W, h: CELL_H })

/**
 * 容器派生盒：由子模块包围盒撑开（锚点 canvasX/Y 为标题栏左上）；
 * 无可见子项（空 / 折叠）时用基准尺寸。
 */
export function containerRect(n, kids, posOf, sizeOf) {
  const base = sizeOf ? sizeOf(n) : effSize(n) // 容器自定义尺寸优先（拖拽调整时经 sizeOf 读 dragSize 实时尺寸，盒子才能跟随鼠标），空态用基准尺寸
  const p = posOf(n)
  let x = p.x
  let y = p.y
  let w = base.w
  let h = base.h
  if (kids.length) {
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const k of kids) {
      const kp = posOf(k)
      const ks = sizeOf(k)
      if (!kp || !ks) continue
      minX = Math.min(minX, kp.x)
      minY = Math.min(minY, kp.y)
      maxX = Math.max(maxX, kp.x + ks.w)
      maxY = Math.max(maxY, kp.y + ks.h)
    }
    if (minX !== Infinity) {
      const x0 = Math.min(x, minX - C_PAD)
      const y0 = Math.min(y, minY - C_TITLE)
      w = Math.max(w, maxX + C_PAD - x0)
      h = Math.max(h, maxY + C_PADB - y0)
      x = x0
      y = y0
    }
  }
  return { x, y, w, h }
}

/* ---------- 连线类型 / 箭头 / 形状 ---------- */

export const REL_KINDS = [
  { key: '关联', color: '#59877e' },
  { key: '因果', color: '#ae715f' },
  { key: '伏笔', color: '#8971a2', dashed: true },
  { key: '冲突', color: '#b28443' }
]
export const relColor = (k) => (REL_KINDS.find((r) => r.key === k) || REL_KINDS[0]).color
export const relDashed = (k) => !!(REL_KINDS.find((r) => r.key === k) || {}).dashed
export const ARROWS = ['->', '<->', '--']
export const cycleArrow = (a) => ARROWS[(ARROWS.indexOf(a) + 1) % ARROWS.length]

export const SHAPES = ['process', 'para', 'diamond', 'ellipse']
export const nextShape = (s) => SHAPES[(SHAPES.indexOf(s) + 1) % SHAPES.length]
export const SHAPE_LABEL = { process: '矩形', para: '平行四边形', diamond: '菱形', ellipse: '椭圆' }

/** 模块类型元数据（侧边栏图标 / 徽标 / 筛选） */
export const KIND_META = {
  event: { icon: 'diamond', label: '事件' },
  note: { icon: 'note', label: '便签' },
  cite: { icon: 'link', label: '引用' },
  textbox: { icon: 'textbox', label: '文本框' },
  container: { icon: 'container', label: '容器' },
  anchor: { icon: 'flag', label: '锚点' },
  volume: { icon: 'rows', label: '卷' }
}

/** 引力书舱沿用设计稿的类型称谓（侧栏行与卡片共用）；与筛选口径 KIND_META.label 分开，避免影响原版筛选匹配 */
export const KIND_LABEL_DESIGN = {
  event: '事件',
  note: '便签',
  cite: '引用卡',
  textbox: '文本框',
  container: '容器',
  anchor: '章节锚点',
  volume: '卷'
}

/* ---------- 布局算法 ---------- */

/**
 * 画布重排：返回 Map(id → {x,y})，只含需要落位的节点。
 * - force=false（进入画布补位）：仅处理无坐标节点；已定位节点为锚。
 * - force=true（「整理」）：全部重排，pin 节点豁免；根节点水平带 3000px 换行，
 *   容器子项按网格（步长随 density 档位，最多 3 列）排布。
 */
export function relayoutAll({ nodes, density = 'detail', force = false }) {
  const kidsOf = new Map()
  for (const n of nodes) {
    const p = n.parentId || null
    if (!kidsOf.has(p)) kidsOf.set(p, [])
    kidsOf.get(p).push(n)
  }
  for (const list of kidsOf.values()) list.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))

  const out = new Map()
  const SIZE = (n) => effSize(n, density)
  const CELL = gridCell(density)
  const willPlace = (n) => (force ? !(n.pin && n.canvasX != null) : n.canvasX == null)

  function placeTree(n, defX, defY) {
    const place = willPlace(n)
    const px = place ? Math.round(defX) : n.canvasX
    const py = place ? Math.round(defY) : n.canvasY
    if (place) out.set(n.id, { x: px, y: py })
    const kids = kidsOf.get(n.id) || []
    if (n.kind === 'container') {
      const movable = kids.filter((k) => willPlace(k))
      if (movable.length) {
        const cols = gridCols(movable.length)
        movable.forEach((k, i) => {
          placeTree(k, px + C_PAD + (i % cols) * CELL.w, py + C_TITLE + 10 + Math.floor(i / cols) * CELL.h)
        })
      }
      for (const k of kids) if (!willPlace(k) && (kidsOf.get(k.id) || []).length) placeTree(k, k.canvasX, k.canvasY)
    } else if (kids.length) {
      let ky = py
      for (const k of kids) {
        if (willPlace(k)) {
          placeTree(k, px + SIZE(n).w + 70, ky)
          ky += SIZE(k).h + 24
        } else {
          placeTree(k, k.canvasX, k.canvasY)
        }
      }
    }
  }

  function measureTree(n) {
    const kids = kidsOf.get(n.id) || []
    const base = SIZE(n)
    if (n.kind === 'container') {
      if (!kids.length) return base
      const cols = gridCols(kids.length)
      const rows = Math.ceil(kids.length / cols)
      return { w: Math.max(base.w, C_PAD * 2 + cols * CELL.w - 14), h: C_TITLE + 10 + rows * CELL.h + C_PADB }
    }
    if (kids.length) {
      const sub = kids.map(measureTree)
      return {
        w: base.w + 70 + Math.max(...sub.map((m) => m.w)),
        h: Math.max(base.h, sub.reduce((s, m) => s + m.h + 24, -24))
      }
    }
    return base
  }

  const roots = (kidsOf.get(null) || []).slice()
  roots.sort((a, b) => (a.kind === 'container' ? 0 : 1) - (b.kind === 'container' ? 0 : 1) || (a.sortOrder || 0) - (b.sortOrder || 0))

  if (force) {
    let bx = 60
    let by = 60
    let bandH = 0
    for (const r of roots) {
      if (!willPlace(r)) {
        placeTree(r, r.canvasX, r.canvasY)
        continue
      }
      const m = measureTree(r)
      if (bx + m.w > 3000 && bx > 60) {
        bx = 60
        by += bandH + 70
        bandH = 0
      }
      placeTree(r, bx, by)
      bx += m.w + 60
      bandH = Math.max(bandH, m.h)
    }
  } else {
    const occupied = nodes
      .filter((n) => n.canvasX != null)
      .map((n) => ({ x: n.canvasX, y: n.canvasY, w: SIZE(n).w, h: SIZE(n).h }))
    for (const r of roots) {
      if (willPlace(r)) {
        const m = measureTree(r)
        const spot = freeSpotFor(occupied, { w: Math.max(m.w, 200), h: Math.max(m.h, 120) })
        placeTree(r, spot.x, spot.y)
        occupied.push({ x: spot.x, y: spot.y, w: Math.max(m.w, 200), h: Math.max(m.h, 120) })
      } else {
        placeTree(r, r.canvasX, r.canvasY)
      }
    }
  }
  return out
}

/* ---------- 骨架模板（快速开始） ---------- */

/**
 * 返回 { rows, edges }：rows 直接喂 olnodeBulkAdd（顺序敏感），
 * edges 为 [fromIndex, toIndex] 引用 + kind/label，落库后按 created 序转真实 id。
 */
export function tplThreeAct(density = 'detail') {
  const rows = []
  const CELL = gridCell(density)
  const mkContainer = (title, x, y) => rows.push({ kind: 'container', title, text: '', canvasX: x, canvasY: y }) - 1
  const mkEvent = (parent, title, text, x, y) => rows.push({ kind: 'event', title, text, canvasX: x, canvasY: y, _parent: parent }) - 1
  const ex = (base, col) => base + C_PAD + col * CELL.w
  const ey = (base, row) => base + C_TITLE + 10 + row * CELL.h
  const a1 = mkContainer('第一幕 · 建置', 40, 40)
  mkEvent(a1, '日常与世界', '', ex(40, 0), ey(40, 0))
  const b = mkEvent(a1, '激励事件', '打破平静的事件', ex(40, 1), ey(40, 0))
  const a2 = mkContainer('第二幕 · 对抗', 560, 40)
  const c = mkEvent(a2, '试炼与升级', '', ex(560, 0), ey(40, 0))
  const d = mkEvent(a2, '中点反转', '', ex(560, 1), ey(40, 0))
  const e = mkEvent(a2, '一切崩塌', '', ex(560, 0), ey(40, 1))
  const a3 = mkContainer('第三幕 · 解决', 1080, 40)
  const f = mkEvent(a3, '终局对决', '', ex(1080, 0), ey(40, 0))
  mkEvent(a3, '新的平衡', '', ex(1080, 1), ey(40, 0))
  rows.push({ kind: 'note', title: '用法', text: '拖节点四向锚点拉连线；拖入容器即归组；双击节点行内编辑内容。', canvasX: 40, canvasY: C_TITLE + 10 + 2 * CELL.h + C_PADB + 60 })
  return {
    rows,
    edges: [
      { from: b, to: c, kind: '因果', label: '推动' },
      { from: d, to: e, kind: '因果', label: '' },
      { from: e, to: f, kind: '因果', label: '' }
    ]
  }
}

export function tplChapterList(chapters, density = 'detail') {
  const rows = []
  const edges = []
  const CELL = gridCell(density)
  const bx = 40
  const by = 40
  rows.push({ kind: 'container', title: '章节清单', text: '', canvasX: bx, canvasY: by })
  const head = 0
  const list = chapters || []
  if (list.length) {
    const cols = gridCols(list.length)
    list.forEach((ch, i) => {
      rows.push({
        kind: 'anchor',
        refId: ch.id,
        title: ch.title || '',
        text: '',
        canvasX: bx + C_PAD + (i % cols) * CELL.w,
        canvasY: by + C_TITLE + 10 + Math.floor(i / cols) * CELL.h,
        _parent: head
      })
    })
  } else {
    const cols = 3
    for (let i = 0; i < 6; i++) {
      rows.push({
        kind: 'event',
        title: '第' + '一二三四五六'[i] + '章',
        text: '',
        canvasX: bx + C_PAD + (i % cols) * CELL.w,
        canvasY: by + C_TITLE + 10 + Math.floor(i / cols) * CELL.h,
        _parent: head
      })
    }
  }
  rows.push({ kind: 'note', title: '节奏提示', text: '每章推进一件事。', canvasX: bx + 720, canvasY: by })
  return { rows, edges }
}
