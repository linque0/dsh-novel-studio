/* 分层大纲画布的纯逻辑：层级路径、当前层、迷你卡递归布局、关系投影、统计与排版。
 * 零 Vue / 零 DOM，供 OutlineCanvas.vue 与 node 自测共用。 */

export const SCOPE_METRICS = {
  cardW: 460,
  cardMinW: 260,
  cardMaxW: 720,
  headH: 108,
  progressH: 24,
  footH: 38,
  padY: 8,
  collapsedH: 178,
  containerMinH: 220,
  miniGap: 12,
  miniPad: 16,
  miniCols: 2,
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

function miniColumns(contentW) {
  /* 旧作品容器常见 300px 宽：两列会只剩 128px 卡宽，改为单列保证可读。 */
  const cols = contentW >= 360 ? M.miniCols : 1
  const colW = (contentW - M.miniGap * (cols - 1)) / cols
  return { colW, cols, fullW: contentW }
}

function miniBaseHeight(n) {
  return isContainer(n) ? M.miniContainerH : M.miniLeafH
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
  const { colW, cols, fullW } = miniColumns(contentW)
  const items = []
  let y = startY
  let col = 0
  let rowH = 0

  const push = (node, rect, depth, parentId) => {
    items.push({ node, rect, depth, parentId, mini: true, clipId: opts.clipId || null })
  }

  for (const child of childrenOf(nodes, parent.id)) {
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

export function containerCardSize(nodes, node, expanded, width) {
  const w = width ?? cardWidth(node)
  const open = isContainer(node) && expanded.has(node.id)
  /* 无手动高度时按内容自动；有手动高度时保留，最小高度由折叠/展开状态决定。
   * 展开后允许比内容矮，多出的迷你卡由画布的滚动内容区承接。 */
  let autoH = M.collapsedH
  if (open) {
    const rect = { x: 0, y: 0, w, h: 0 }
    const grid = layoutMiniChildren(nodes, node, rect, expanded, {
      topOffset: M.headH + M.progressH + M.padY,
      pad: M.miniPad,
      bottomPad: M.padY
    })
    autoH = M.headH + M.progressH + M.padY + grid.height + M.padY + M.footH
  }
  const minH = open ? M.containerMinH : M.collapsedH
  const manualH = Number(node.h) > 0 ? Math.max(minH, Number(node.h)) : null
  return { w, h: manualH ?? autoH }
}

/** 旧作品容器间距可能只有 320px：显式宽度优先，否则在相邻容器之间自适应收窄，
 * 避免 460 固定卡宽把同一排容器压在一起。 */
function layerWidths(nodes, layer) {
  const out = new Map()
  const containers = layer.filter(isContainer).sort((a, b) => (Number(a.canvasX) || 0) - (Number(b.canvasX) || 0))
  for (let i = 0; i < containers.length; i++) {
    const n = containers[i]
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
  const widths = layerWidths(nodes, layer)
  const mini = { items: [], byId: new Map() }
  for (const n of layer) {
    const drag = opts.sizeOf?.(n)
    if (isContainer(n)) {
      if (drag) {
        const minH = expanded.has(n.id) ? M.containerMinH : M.collapsedH
        sizes.set(n.id, {
          w: Math.max(M.cardMinW, Math.min(M.cardMaxW, Number(drag.w) || M.cardW)),
          h: Math.max(minH, Number(drag.h) || minH)
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

  for (const { owner, rel } of entries) {
    const fromRaw = rel.fromJunction?.ownerId || owner?.id
    const toRaw = rel.toJunction?.ownerId || rel.toId
    if (!fromRaw || !toRaw) continue
    if (!inside.has(fromRaw) && !inside.has(toRaw)) continue
    const from = project(fromRaw, 'in')
    const to = project(toRaw, 'out')
    if (!from || !to || from.id === to.id) continue
    const kind = rel.kind || '关联'
    const key = `${from.id}|${to.id}|${kind}`
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
        projectedTo: false
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

  return { groups: [...groups.values()], external, visibleIds: visible }
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
