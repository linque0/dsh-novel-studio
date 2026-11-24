/**
 * 设定侧栏目录树纯布局与折叠策略计算（零 DOM 依赖，可独立单测）。
 *
 * 缩进策略：
 * - 常规窄侧栏（< 300px）：depth 0 -> 0px，1..3 每级 +10px，4..6 每级 +6px，>= 7 封顶 48px。
 * - 宽侧栏（>= 300px）：depth 0 -> 0px，1..4 每级 +12px，5..7 每级 +8px，>= 8 封顶 72px。
 */

export const LORE_NAV_COMPACT_CAP = 48
export const LORE_NAV_WIDE_CAP = 72
export const LORE_NAV_WIDE_THRESHOLD = 300

export function loreNavDepthCap(wide = false) {
  return wide ? 7 : 6
}

export function loreNavIndentPx(depth, { wide = false } = {}) {
  const d = Number.isFinite(depth) ? Math.max(0, Math.floor(depth)) : 0
  if (d === 0) return 0
  if (wide) {
    const primary = Math.min(d, 4) * 12
    const secondary = Math.min(Math.max(0, d - 4), 3) * 8
    return Math.min(LORE_NAV_WIDE_CAP, primary + secondary)
  }
  const primary = Math.min(d, 3) * 10
  const secondary = Math.min(Math.max(0, d - 3), 3) * 6
  return Math.min(LORE_NAV_COMPACT_CAP, primary + secondary)
}

/**
 * 返回父节点位于 `depth` 时，其子级分组（`.lore-nav-group`）纵向引导线的 left 坐标（px）。
 * 始终严格落在 (indent(depth), indent(depth + 1)) 区间内；当层级达到封顶不再右移时返回 null，避免重叠粗线。
 */
export function loreNavGuideX(depth, { wide = false } = {}) {
  const cur = loreNavIndentPx(depth, { wide })
  const next = loreNavIndentPx(depth + 1, { wide })
  const step = next - cur
  if (step <= 0) return null
  const offset = Math.min(7, Math.max(3, Math.floor(step * 0.75)))
  return cur + Math.min(offset, step - 1)
}

/**
 * 目录树「一键收起」两段式目标折叠集合：
 * 1. 若存在位于 activePathIds 之外且当前仍展开的父节点 → 折叠所有无关分支，仅保留当前激活路径展开；
 * 2. 若已仅剩当前路径展开（或无激活路径）→ 折叠所有父节点至顶层（pinOpenIds 中节点始终保持展开）。
 */
export function loreNavCollapseIds(
  liveNodes,
  childrenOf,
  activePathIds = [],
  currentFoldIds = [],
  { pinOpenIds = [] } = {}
) {
  const pinSet = new Set(pinOpenIds || [])
  const activeSet = new Set(activePathIds || [])
  const currentFoldSet = new Set(currentFoldIds || [])

  const parents = []
  for (const node of liveNodes || []) {
    if (!node?.id || pinSet.has(node.id)) continue
    if ((childrenOf(node.id) || []).length > 0) parents.push(node.id)
  }

  const hasExpandedUnrelated =
    activeSet.size > 0 &&
    parents.some((id) => !activeSet.has(id) && !currentFoldSet.has(id))

  if (hasExpandedUnrelated) {
    return parents.filter((id) => !activeSet.has(id))
  }
  return parents
}
