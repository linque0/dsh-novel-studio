const MIN_COLUMN_WIDTH = 320
const COLUMN_GAP = 76
const BRANCH_GAP = 24
const ROOT_GAP = 64
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

export function layoutLoreTree(rootIds, entries, folded, sizes, { mode = 'single', edgeStyle = 'elbow', centerWidth = 132, centerHeight = 42 } = {}) {
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
      bottom += child.extent + BRANCH_GAP
      return band
    })
    const first = bands[0], last = bands.at(-1)
    const mid = first ? (first.child.mid + last.offset + last.child.mid) / 2 : height / 2
    const shift = Math.max(0, height / 2 - mid)
    return {
      id, depth, width, height, bands, shift, mid: mid + shift, collapsed, childCount: entry.children.length,
      extent: shift + Math.max(mid + height / 2, bottom - BRANCH_GAP)
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
    const height = side.trees.reduce((sum, tree) => sum + tree.extent + ROOT_GAP, -ROOT_GAP)
    let y = -height / 2
    for (const tree of side.trees) {
      place(tree, y, center, side, name)
      y += tree.extent + ROOT_GAP
    }
  }
  return {
    center, nodes, edges,
    bounds: { x: minX - PADDING, y: minY - PADDING, w: maxX - minX + 2 * PADDING, h: maxY - minY + 2 * PADDING }
  }
}
