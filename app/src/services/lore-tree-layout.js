/**
 * 设定层级视觉导图（LoreTreeMap）纯函数布局与折叠计算模块：
 * 支持单侧（single）与左右双侧（double）分支排布、多级折叠深度探测与肘形/贝塞尔连线生成。
 */
const MIN_COLUMN_WIDTH = 320
const COLUMN_GAP = 76
const BRANCH_GAP = 24
const ROOT_GAP = 64
const COMPACT_BRANCH_GAP = 14
const COMPACT_ROOT_GAP = 36
const COMPACT_VISIBLE_THRESHOLD = 120
const PADDING = 48

function edgePath(start, y1, end, y2, trunk, direction, edgeStyle) {
  const x1 = Math.round(start)
  const sy1 = Math.round(y1)
  const x2 = Math.round(end)
  const sy2 = Math.round(y2)
  const tx = Math.round(trunk)
  if (edgeStyle === 'curve') {
    const span = x2 - x1
    const c1x = Math.round(x1 + span * 0.46)
    const c2x = Math.round(x2 - span * 0.46)
    return `M${x1} ${sy1}C${c1x} ${sy1},${c2x} ${sy2},${x2} ${sy2}`
  }
  const dy = sy2 - sy1
  if (Math.abs(dy) <= 1) return `M${x1} ${sy1}H${x2}`
  const dx1 = tx - x1
  const dx2 = x2 - tx
  const r = Math.max(0, Math.min(10, Math.floor(Math.abs(dy) / 2), Math.abs(dx1), Math.abs(dx2)))
  if (r < 2) return `M${x1} ${sy1}H${tx}V${sy2}H${x2}`
  const sx = Math.sign(dx1) || direction
  const ex = Math.sign(dx2) || direction
  const sy = Math.sign(dy)
  return `M${x1} ${sy1}H${tx - sx * r}Q${tx} ${sy1} ${tx} ${sy1 + sy * r}V${sy2 - sy * r}Q${tx} ${sy2} ${tx + ex * r} ${sy2}H${x2}`
}

/** 计算根节点集合下的最大树深度，用于导图工具栏折叠层级选择器。 */
export function loreTreeMaxDepth(rootIds, childrenOf) {
  const visited = new Set()
  let max = 0
  const walk = (id, depth) => {
    if (visited.has(id)) return
    visited.add(id)
    if (depth > max) max = depth
    for (const childId of childrenOf(id) || []) walk(childId, depth + 1)
  }
  for (const id of rootIds || []) walk(id, 1)
  return max
}

/** 生成展开至第 level 级时需要折叠的父节点 ID 集合（Infinity 表示全展开）。 */
export function loreFoldedIdsForLevel(rootIds, childrenOf, level) {
  const next = new Set()
  if (level === Infinity) return next
  const visited = new Set()
  const cutoff = Math.max(0, Number(level) || 0) - 1
  const walk = (id, depth) => {
    if (visited.has(id)) return
    visited.add(id)
    const kids = childrenOf(id) || []
    if (!kids.length) return
    if (depth >= cutoff) next.add(id)
    for (const childId of kids) walk(childId, depth + 1)
  }
  for (const id of rootIds || []) walk(id, 0)
  return next
}

/** 反推当前折叠状态对应的统一展开层级；若各分支展开深度不一致则返回 null。 */
export function loreActiveFoldLevel(rootIds, childrenOf, folded) {
  const visited = new Set()
  let hasFoldable = false
  let minCollapsedDepth = Infinity
  let maxExpandedDepth = -1
  const walk = (id, depth) => {
    if (visited.has(id)) return
    visited.add(id)
    const kids = childrenOf(id) || []
    if (!kids.length) return
    hasFoldable = true
    if (folded?.has(id)) {
      if (depth < minCollapsedDepth) minCollapsedDepth = depth
      return
    }
    if (depth > maxExpandedDepth) maxExpandedDepth = depth
    for (const childId of kids) walk(childId, depth + 1)
  }
  for (const id of rootIds || []) walk(id, 0)
  if (!hasFoldable || minCollapsedDepth === Infinity) return Infinity
  if (maxExpandedDepth >= minCollapsedDepth) return null
  return minCollapsedDepth + 1
}

/** 按当前作用域节点规模计算初始折叠集合：
 *  - ≤40 节点：全展开（保持小树原有观感）；
 *  - 41–150 节点：自动收敛至可见节点 ≤ maxVisible 的最深层级（保底至少 2 级）；
 *  - >150 节点：默认展开至 2 级骨架；
 *  - 若传入作用域内的 activeId，自动展开其祖先链确保目标可见。 */
export function loreInitialFoldedIds(rootIds, childrenOf, { maxVisible = 48, activeId = null } = {}) {
  const roots = rootIds || []
  const visited = new Set()
  const parentOf = new Map()
  let maxDepth = 0

  const scan = (id, depth, parent) => {
    if (visited.has(id)) return
    visited.add(id)
    if (parent != null) parentOf.set(id, parent)
    if (depth > maxDepth) maxDepth = depth
    for (const childId of childrenOf(id) || []) scan(childId, depth + 1, id)
  }
  for (const id of roots) scan(id, 1, null)

  const total = visited.size
  if (total <= 40) return new Set()

  const countVisible = (folded) => {
    const seen = new Set()
    const walk = (id) => {
      if (seen.has(id)) return
      seen.add(id)
      if (folded.has(id)) return
      for (const childId of childrenOf(id) || []) walk(childId)
    }
    for (const id of roots) walk(id)
    return seen.size
  }

  let level = 2
  if (total <= 150) {
    for (let candidate = Math.max(2, maxDepth); candidate >= 2; candidate--) {
      if (countVisible(loreFoldedIdsForLevel(roots, childrenOf, candidate)) <= maxVisible) {
        level = candidate
        break
      }
    }
  }

  const folded = loreFoldedIdsForLevel(roots, childrenOf, level)
  if (activeId && visited.has(activeId)) {
    let cur = parentOf.get(activeId)
    const guard = new Set()
    while (cur != null && !guard.has(cur)) {
      guard.add(cur)
      folded.delete(cur)
      cur = parentOf.get(cur)
    }
  }
  return folded
}

/** 执行两遍树布局（先自底向上度量子树纵向跨度与列宽，再自顶向下落定节点坐标与连线路径）。 */
export function layoutLoreTree(rootIds, entries, folded, sizes, { mode = 'single', edgeStyle = 'elbow', centerWidth = 132, centerHeight = 42 } = {}) {
  const visibleSeen = new Set()
  const countVisible = (id) => {
    const entry = entries.get(id)
    if (!entry || visibleSeen.has(id)) return
    visibleSeen.add(id)
    if (folded.has(id)) return
    for (const child of entry.children) countVisible(child)
  }
  for (const id of rootIds) countVisible(id)
  const compact = visibleSeen.size > COMPACT_VISIBLE_THRESHOLD
  const branchGap = compact ? COMPACT_BRANCH_GAP : BRANCH_GAP
  const rootGap = compact ? COMPACT_ROOT_GAP : ROOT_GAP

  const seen = new Set()
  const sides = { left: { columns: [], trees: [] }, right: { columns: [], trees: [] } }
  const center = { x: Math.round(-centerWidth / 2), y: Math.round(-centerHeight / 2), width: centerWidth, height: centerHeight }

  function measure(id, side, depth) {
    const entry = entries.get(id)
    if (!entry || seen.has(id)) return null
    seen.add(id)
    const column = side.columns[depth] ??= { limit: MIN_COLUMN_WIDTH, width: 0 }
    column.limit = Math.max(column.limit, entry.imageWidth || 0)
    const width = sizes.get(id)?.width || Math.max(80, entry.imageWidth || 0)
    const height = sizes.get(id)?.height || 30
    column.width = Math.max(column.width, width)
    const collapsed = folded.has(id)
    const children = collapsed ? [] : entry.children.map(child => measure(child, side, depth + 1)).filter(Boolean)
    let bottom = 0
    const bands = children.map(child => {
      const band = { child, offset: bottom }
      bottom += child.extent + branchGap
      return band
    })
    const first = bands[0], last = bands.at(-1)
    const mid = first ? (first.child.mid + last.offset + last.child.mid) / 2 : height / 2
    const shift = Math.max(0, height / 2 - mid)
    return {
      id, depth, width, height, bands, shift, mid: mid + shift, collapsed, childCount: entry.children.length,
      extent: shift + Math.max(mid + height / 2, bottom - branchGap)
    }
  }

  for (const [index, id] of rootIds.entries()) {
    const side = mode === 'double' && index % 2 ? sides.left : sides.right
    const tree = measure(id, side, 0)
    if (tree) side.trees.push(tree)
  }
  const nodes = [], edges = []
  let minX = center.x, minY = center.y
  let maxX = center.x + center.width, maxY = center.y + center.height

  function place(tree, top, parent, side, name) {
    const direction = name === 'right' ? 1 : -1
    const column = side.columns[tree.depth]
    const node = {
      id: tree.id, depth: tree.depth, side: name, width: tree.width, height: tree.height,
      x: Math.round(direction > 0 ? column.edge : column.edge - tree.width),
      y: Math.round(top + tree.mid - tree.height / 2), columnWidth: column.limit,
      childCount: tree.childCount, collapsed: tree.collapsed
    }
    nodes.push(node)
    minX = Math.min(minX, node.x); minY = Math.min(minY, node.y)
    maxX = Math.max(maxX, node.x + node.width); maxY = Math.max(maxY, node.y + node.height)
    const start = direction > 0 ? parent.x + parent.width : parent.x
    const end = direction > 0 ? node.x : node.x + node.width
    const trunk = column.edge - direction * COLUMN_GAP / 2
    const y1 = parent.y + parent.height / 2, y2 = node.y + node.height / 2
    edges.push({
      id: node.id,
      parentId: parent.id ?? null,
      depth: tree.depth,
      d: edgePath(start, y1, end, y2, trunk, direction, edgeStyle)
    })
    for (const band of tree.bands) place(band.child, top + tree.shift + band.offset, node, side, name)
  }

  for (const [name, side] of Object.entries(sides)) {
    const direction = name === 'right' ? 1 : -1
    let x = direction * (centerWidth / 2 + COLUMN_GAP)
    for (const column of side.columns) {
      column.edge = x
      x += direction * (column.width + COLUMN_GAP)
    }
    const height = side.trees.reduce((sum, tree) => sum + tree.extent + rootGap, -rootGap)
    let y = -height / 2
    for (const tree of side.trees) {
      place(tree, y, center, side, name)
      y += tree.extent + rootGap
    }
  }
  return {
    center, nodes, edges,
    bounds: { x: minX - PADDING, y: minY - PADDING, w: maxX - minX + 2 * PADDING, h: maxY - minY + 2 * PADDING }
  }
}
