/* 分层大纲画布的纯逻辑：层级路径、当前层、迷你卡递归布局、关系投影、统计与排版。
 * 零 Vue / 零 DOM，供 OutlineCanvas.vue 与 node 自测共用。 */

export const SCOPE_METRICS = {
  cardW: 460,
  singleColW: 320,
  threeColW: 680,
  cardMinW: 260,
  cardMaxW: 720,
  headH: 108,
  progressH: 24,
  footH: 38,
  padY: 8,
  collapsedH: 178,
  emptyOpenH: 186,
  containerMinH: 220,
  miniGap: 12,
  miniPad: 16,
  miniCols: 2,
  miniMaxCols: 3,
  miniLeafH: 112,
  miniContainerH: 124,
  miniOpenGap: 8
}

const M = SCOPE_METRICS

export function isContainer(n) {
  return n?.kind === 'container'
}

export function childrenOf(nodes, parentId) {
  return nodes
    .filter((n) => (n.parentId || null) === (parentId || null))
    .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))
}

export function descendantsOf(nodes, id) {
  const out = []
  const seen = new Set()
  const walk = (pid) => {
    for (const n of childrenOf(nodes, pid)) {
      if (seen.has(n.id)) continue
      seen.add(n.id)
      out.push(n)
      walk(n.id)
    }
  }
  walk(id)
  return out
}

/** 根到当前层的容器链（不含根占位）。 */
export function scopePathIds(nodes, scopeId) {
  const out = []
  const seen = new Set()
  let cur = scopeId ? nodes.find((n) => n.id === scopeId) : null
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id)
    out.unshift(cur.id)
    cur = cur.parentId ? nodes.find((n) => n.id === cur.parentId) : null
  }
  return out
}

/** 面包屑：全书 + 当前层及其祖先。 */
export function scopeCrumbs(nodes, scopeId) {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  return [
    { id: null, title: '全书' },
    ...scopePathIds(nodes, scopeId).map((id) => ({ id, title: byId.get(id)?.title || '容器' }))
  ]
}

/** 当前层直接子项。 */
export function layerNodes(nodes, scopeId) {
  return childrenOf(nodes, scopeId)
}

function subtreeIds(nodes, scopeId) {
  if (!scopeId) return new Set(nodes.map((n) => n.id))
  return new Set([scopeId, ...descendantsOf(nodes, scopeId).map((n) => n.id)])
}

function statusDone(n) {
  return n.kind === 'event' && n.status === 'done'
}

/** 事件口径的层级统计。容器/便签/文本/锚点不充当事件。 */
export function scopeStats(nodes, scopeId) {
  const inside = scopeId ? [nodes.find((n) => n.id === scopeId), ...descendantsOf(nodes, scopeId)].filter(Boolean) : nodes
  const events = inside.filter((n) => n.kind === 'event')
  const done = events.filter(statusDone).length
  const blocks = inside.filter((n) => isContainer(n) && n.id !== scopeId).length
  let depth = 0
  if (scopeId) {
    const walk = (id, d) => {
      depth = Math.max(depth, d)
      for (const c of childrenOf(nodes, id)) if (isContainer(c)) walk(c.id, d + 1)
    }
    walk(scopeId, 0)
  } else {
    const walk = (id, d) => {
      for (const c of childrenOf(nodes, id)) {
        if (!isContainer(c)) continue
        depth = Math.max(depth, d + 1)
        walk(c.id, d + 1)
      }
    }
    walk(null, 0)
  }
  return { total: events.length, done, blocks, depth, complete: events.length > 0 && done === events.length }
}

export function nodeStats(nodes, id) {
  const n = nodes.find((x) => x.id === id)
  if (!n) return { total: 0, done: 0, blocks: 0, depth: 0, complete: false }
  if (!isContainer(n)) {
    const done = statusDone(n) ? 1 : 0
    return { total: n.kind === 'event' ? 1 : 0, done, blocks: 0, depth: 0, complete: n.kind === 'event' && done === 1 }
  }
  return scopeStats(nodes, id)
}

export function cardWidth(n) {
  return Math.max(M.cardMinW, Math.min(M.cardMaxW, Number(n.w) || M.cardW))
}

function miniColumns(contentW, childCount = null) {
  /* 旧作品容器常见 300px 宽：两列会只剩 128px 卡宽，改为单列保证可读；
   * 内容较多且宽度足够时扩展到 3 列，单卡则保持 1 列占满容器内宽。 */
  let cols = M.miniCols
  if (childCount === 1) cols = 1
  else if ((childCount == null || childCount >= 5) && contentW >= 580) cols = M.miniMaxCols
  else if (contentW < 360) cols = 1
  const colW = (contentW - M.miniGap * (cols - 1)) / cols
  return { colW, cols, fullW: contentW }
}

function miniBaseHeight(n) {
  return isContainer(n) ? M.miniContainerH : M.miniLeafH
}

export function adaptiveContainerWidth(nodes, node, expanded, visiting = new Set()) {
  if (!isContainer(node) || !expanded.has(node.id)) return cardWidth(node)
  if (node.manualW && Number(node.w) > 0) return cardWidth(node)
  if (visiting.has(node.id)) return M.cardW
  const nextVisiting = new Set(visiting)
  nextVisiting.add(node.id)
  const kids = childrenOf(nodes, node.id)
  const openNested = kids.filter((k) => isContainer(k) && expanded.has(k.id))
  let target = M.cardW
  if (kids.length <= 1 && !openNested.length) target = M.singleColW
  else if (kids.length >= 5) target = M.threeColW
  for (const nested of openNested) {
    const nestedW = adaptiveContainerWidth(nodes, nested, expanded, nextVisiting)
    target = Math.max(target, nestedW + M.miniPad * 2)
  }
  return Math.max(M.cardMinW, Math.min(M.cardMaxW, target))
}

/** 迷你容器展开时的高度（含递归子网格）。 */
function miniContainerOpenHeight(nodes, node, expanded, width = cardWidth(node)) {
  const grid = layoutMiniChildren(nodes, node, { x: 0, y: 0, w: width, h: 0 }, expanded, {
    topOffset: M.miniContainerH + M.miniOpenGap,
    pad: M.miniPad,
    bottomPad: M.miniOpenGap
  })
  return M.miniContainerH + M.miniOpenGap + grid.height + M.miniOpenGap
}

/**
 * 递归排版一个容器内的迷你卡。
 * parentRect 为容器卡绝对矩形；topOffset 为子网格起始纵向偏移；pad 为左右内边距。
 * 返回 { items, height }，items[*].rect 为绝对世界坐标。
 */
export function layoutMiniChildren(nodes, parent, parentRect, expanded, opts = {}) {
  const topOffset = opts.topOffset ?? M.headH + M.progressH + M.padY
  const pad = opts.pad ?? M.miniPad
  const bottomPad = opts.bottomPad ?? M.padY
  const contentX = parentRect.x + pad
  const contentW = Math.max(80, parentRect.w - pad * 2)
  const startY = parentRect.y + topOffset
  const kids = childrenOf(nodes, parent.id)
  const { colW, cols, fullW } = miniColumns(contentW, kids.length)
  const items = []
  let y = startY
  let col = 0
  let rowH = 0

  const push = (node, rect, depth, parentId) => {
    items.push({ node, rect, depth, parentId, mini: true, clipId: opts.clipId || null })
  }

  for (const child of kids) {
    const open = isContainer(child) && expanded.has(child.id)
    if (open) {
      if (col > 0) {
        y += rowH + M.miniGap
        col = 0
        rowH = 0
      }
      const h = miniContainerOpenHeight(nodes, child, expanded, fullW)
      const rect = { x: contentX, y, w: fullW, h }
      push(child, rect, (opts.depth || 0) + 1, parent.id)
      const nested = layoutMiniChildren(nodes, child, rect, expanded, {
        topOffset: M.miniContainerH + M.miniOpenGap,
        pad: M.miniPad,
        bottomPad: M.miniOpenGap,
        depth: (opts.depth || 0) + 1,
        clipId: opts.clipId
      })
      items.push(...nested.items)
      y += h + M.miniGap
      continue
    }

    const h = miniBaseHeight(child)
    const x = contentX + col * (colW + M.miniGap)
    push(child, { x, y, w: colW, h }, (opts.depth || 0) + 1, parent.id)
    rowH = Math.max(rowH, h)
    col += 1
    if (col === cols) {
      y += rowH + M.miniGap
      col = 0
      rowH = 0
    }
  }
  if (col > 0) y += rowH + M.miniGap
  return { items, height: Math.max(0, y - startY - M.miniGap + bottomPad - M.padY) }
}

export function shouldShowContainerContent(nodes, node, width, height, expanded = new Set()) {
  if (!isContainer(node)) return false
  const kids = childrenOf(nodes, node.id)
  if (!kids.length) return false
  const w = Math.max(M.cardMinW, Math.min(M.cardMaxW, Number(width) || M.cardW))
  const grid = layoutMiniChildren(nodes, node, { x: 0, y: 0, w, h: 0 }, expanded, {
    topOffset: M.headH + M.progressH + M.padY,
    pad: M.miniPad,
    bottomPad: M.padY
  })
  if (grid.height <= 0) return false
  const chromeH = M.headH + M.progressH + M.padY * 2 + M.footH
  const availH = Math.max(0, Number(height) - chromeH)
  return availH >= Math.ceil(grid.height * 0.5)
}

export function containerCardSize(nodes, node, expanded, width) {
  const open = isContainer(node) && expanded.has(node.id)
  const w = width ?? adaptiveContainerWidth(nodes, node, expanded)
  const kids = open ? childrenOf(nodes, node.id) : []
  /* 无手动高度时按内容自动贴合；空容器采用紧凑空态高度，不再硬留大片空白。 */
  let autoH = M.collapsedH
  if (open) {
    if (!kids.length) {
      autoH = M.emptyOpenH
    } else {
      const rect = { x: 0, y: 0, w, h: 0 }
      const grid = layoutMiniChildren(nodes, node, rect, expanded, {
        topOffset: M.headH + M.progressH + M.padY,
        pad: M.miniPad,
        bottomPad: M.padY
      })
      autoH = M.headH + M.progressH + M.padY + grid.height + M.padY + M.footH
    }
  }
  const minH = open ? (kids.length ? M.containerMinH : M.emptyOpenH) : M.collapsedH
  const manualH = Number(node.h) > 0 ? Math.max(minH, Number(node.h)) : null
  return { w, h: manualH ?? autoH }
}

/** 旧作品容器间距可能只有 320px：折叠态或显式宽度按既有逻辑；展开态未锁宽时按内容自适应。 */
function layerWidths(nodes, layer, expanded) {
  const out = new Map()
  const containers = layer.filter(isContainer).sort((a, b) => (Number(a.canvasX) || 0) - (Number(b.canvasX) || 0))
  for (let i = 0; i < containers.length; i++) {
    const n = containers[i]
    if (expanded.has(n.id) && !n.manualW) {
      out.set(n.id, adaptiveContainerWidth(nodes, n, expanded))
      continue
    }
    const base = Number(n.w) ? cardWidth(n) : M.cardW
    const next = containers[i + 1]
    const avail = next ? (Number(next.canvasX) || 0) - (Number(n.canvasX) || 0) - 20 : Infinity
    /* 用户手动调宽后不再被邻居压缩；旧作品没有 manualW，继续自适应收窄避免重叠。 */
    out.set(n.id, n.manualW
      ? base
      : (Number.isFinite(avail) ? Math.max(M.cardMinW, Math.min(base, avail)) : base))
  }
  return out
}

/**
 * 当前层完整布局：直接子节点、所有就地展开的容器卡尺寸与迷你卡矩形。
 */
export function buildLayerLayout(nodes, scopeId, expanded, opts = {}) {
  const layer = layerNodes(nodes, scopeId)
  const sizes = new Map()
  const widths = layerWidths(nodes, layer, expanded)
  const mini = { items: [], byId: new Map() }
  for (const n of layer) {
    const drag = opts.sizeOf?.(n)
    if (isContainer(n)) {
      if (drag) {
        sizes.set(n.id, {
          w: Math.max(M.cardMinW, Math.min(M.cardMaxW, Number(drag.w) || M.cardW)),
          h: Math.max(M.collapsedH, Number(drag.h) || M.collapsedH)
        })
      } else {
        sizes.set(n.id, containerCardSize(nodes, n, expanded, widths.get(n.id)))
      }
    } else {
      sizes.set(n.id, null)
    }
    if (!isContainer(n) || !expanded.has(n.id)) continue
    const card = sizes.get(n.id)
    /* 拖动中的临时坐标优先：容器本体与内部迷你卡必须使用同一实时位置。 */
    const pos = opts.posOf?.(n) || { x: Number(n.canvasX) || 0, y: Number(n.canvasY) || 0 }
    const grid = layoutMiniChildren(nodes, n, { ...pos, ...card }, expanded, {
      topOffset: M.headH + M.progressH + M.padY,
      pad: M.miniPad,
      bottomPad: M.padY,
      clipId: n.id
    })
    mini.items.push(...grid.items)
    for (const item of grid.items) mini.byId.set(item.node.id, item)
  }
  const visibleIds = new Set([...layer.map((n) => n.id), ...mini.items.map((i) => i.node.id)])
  return { scopeId, layer, sizes, mini, visibleIds }
}

function rangeArrow(a) {
  if (a === '<->') return 2
  if (a === '->') return 1
  return 0
}

/**
 * 关系投影与分组。
 * entries: flattenRelations 的输出 [{ owner, rel }]。
 * 返回 groups（同一 from/to/kind 合并）、external（当前层之外的端点）、visibleIds。
 */
export function projectRelations(entries, nodes, scopeId, layerLayout) {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const inside = subtreeIds(nodes, scopeId)
  const visible = layerLayout.visibleIds
  const groups = new Map()
  const external = { in: new Set(), out: new Set() }

  const project = (id, end) => {
    if (!id || !byId.has(id)) return null
    if (!inside.has(id)) {
      external[end].add(id)
      return null
    }
    if (visible.has(id)) return { id, projected: false }
    if (id === scopeId) {
      external[end].add(id)
      return null
    }
    let cur = byId.get(id)
    const seen = new Set()
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id)
      const parentId = cur.parentId || null
      if (parentId && visible.has(parentId)) return { id: parentId, projected: true }
      if (!parentId || parentId === scopeId) return null
      cur = byId.get(parentId)
    }
    return null
  }

  const byRelId = new Map(entries.map((e) => [e.rel.id, e]))
  const hostDirectCache = new Map()
  const hostDirect = (relId, visiting = new Set()) => {
    if (!relId) return false
    if (hostDirectCache.has(relId)) return hostDirectCache.get(relId)
    if (visiting.has(relId)) return false
    const entry = byRelId.get(relId)
    if (!entry) return false
    visiting.add(relId)
    const { owner, rel } = entry
    const srcOk = rel.fromJunction ? hostDirect(rel.fromJunction.relId, visiting) : Boolean(owner?.id && visible.has(owner.id))
    const dstOk = rel.toJunction ? hostDirect(rel.toJunction.relId, visiting) : Boolean(rel.toId && visible.has(rel.toId))
    const ok = srcOk && dstOk
    visiting.delete(relId)
    hostDirectCache.set(relId, ok)
    return ok
  }

  for (const { owner, rel } of entries) {
    const fromDirectJunc = Boolean(rel.fromJunction && hostDirect(rel.fromJunction.relId))
    const toDirectJunc = Boolean(rel.toJunction && hostDirect(rel.toJunction.relId))
    const fromRaw = rel.fromJunction?.ownerId || owner?.id
    const toRaw = rel.toJunction?.ownerId || rel.toId
    if (!fromRaw || !toRaw) continue
    if (!fromDirectJunc && !toDirectJunc && !inside.has(fromRaw) && !inside.has(toRaw)) continue
    const from = fromDirectJunc ? { id: fromRaw, projected: false } : project(fromRaw, 'in')
    const to = toDirectJunc ? { id: toRaw, projected: false } : project(toRaw, 'out')
    if (!from || !to) continue
    if (!fromDirectJunc && !toDirectJunc && from.id === to.id) continue
    const kind = rel.kind || '关联'
    const hasDirectJunction = fromDirectJunc || toDirectJunc || (Boolean(rel.junctions?.length) && !from.projected && !to.projected)
    const key = hasDirectJunction ? `rel:${rel.id}` : `${from.id}|${to.id}|${kind}`
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        from: from.id,
        to: to.id,
        kind,
        label: '',
        arrow: '--',
        relations: [],
        projected: false,
        projectedFrom: false,
        projectedTo: false,
        fromJunction: fromDirectJunc ? rel.fromJunction : null,
        toJunction: toDirectJunc ? rel.toJunction : null
      })
    }
    const g = groups.get(key)
    g.relations.push({ owner, rel })
    if (rel.label && !g.label) g.label = rel.label
    if (rangeArrow(rel.arrows) > rangeArrow(g.arrow)) g.arrow = rel.arrows || '->'
    if (from.projected) g.projectedFrom = true
    if (to.projected) g.projectedTo = true
    g.projected = g.projectedFrom || g.projectedTo
  }

  /* 拓扑序：普通宿主边（深度 0）先于挂在连接点上的分支边（深度 1..N），确保连接点直接复用宿主渲染几何。 */
  const list = [...groups.values()]
  const groupByRelId = new Map()
  for (const g of list) if (g.relations.length === 1) groupByRelId.set(g.relations[0].rel.id, g)
  const depthMemo = new Map()
  const depthOf = (g, visiting = new Set()) => {
    if (depthMemo.has(g.key)) return depthMemo.get(g.key)
    if (visiting.has(g.key)) return 0
    visiting.add(g.key)
    let d = 0
    for (const ref of [g.fromJunction, g.toJunction]) {
      if (!ref) continue
      const host = groupByRelId.get(ref.relId)
      if (host) d = Math.max(d, 1 + depthOf(host, visiting))
    }
    visiting.delete(g.key)
    depthMemo.set(g.key, d)
    return d
  }
  const indexed = list.map((g, i) => ({ g, i, d: depthOf(g) }))
  indexed.sort((a, b) => a.d - b.d || a.i - b.i)

  return { groups: indexed.map((x) => x.g), external, visibleIds: visible }
}

/** 容器跨边界关系（设置面板 / 接续列表）。 */
export function scopeConnections(entries, nodes, scopeId) {
  if (!scopeId) return []
  const inside = subtreeIds(nodes, scopeId)
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const out = []
  for (const { owner, rel } of entries) {
    const from = rel.fromJunction?.ownerId || owner?.id
    const to = rel.toJunction?.ownerId || rel.toId
    if (!from || !to) continue
    const inFrom = inside.has(from)
    const inTo = inside.has(to)
    if (inFrom === inTo) continue
    const otherId = inFrom ? to : from
    if (!byId.has(otherId)) continue
    out.push({ id: rel.id, ownerId: owner?.id, rel, direction: inFrom ? 'out' : 'in', otherId, other: byId.get(otherId) })
  }
  return out
}

/** 当前层整理：按阅读顺序从左到右，行高取最高；pin 节点不移动。 */
export function packLayer(nodes, scopeId, sizeOf, opts = {}) {
  const gapX = opts.gapX ?? 64
  const gapY = opts.gapY ?? 64
  const startX = opts.startX ?? 60
  const startY = opts.startY ?? 60
  const maxWidth = opts.maxWidth ?? 1200
  const list = layerNodes(nodes, scopeId)
    .filter((n) => !n.pin)
    .sort((a, b) => (Number(a.canvasY) || 0) - (Number(b.canvasY) || 0) || (Number(a.canvasX) || 0) - (Number(b.canvasX) || 0) || (a.sortOrder || 0) - (b.sortOrder || 0))
  const out = new Map()
  let x = startX
  let y = startY
  let rowH = 0
  for (const n of list) {
    const s = sizeOf(n) || { w: 178, h: 54 }
    if (x > startX && x + s.w > startX + maxWidth) {
      x = startX
      y += rowH + gapY
      rowH = 0
    }
    out.set(n.id, { x: Math.round(x), y: Math.round(y) })
    x += s.w + gapX
    rowH = Math.max(rowH, s.h)
  }
  return { positions: out, width: Math.max(0, x - startX - gapX), height: Math.max(0, y + rowH - startY) }
}
