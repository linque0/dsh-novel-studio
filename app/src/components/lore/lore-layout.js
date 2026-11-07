/* 设定面板矩阵的宽度算法：纯函数、不碰 DOM（便于单测）。
   逐条对照设计稿 docs/前端美化/设定-融合总稿-20261105/：
   - applyWidths()（prototype.js 1582-1596）：available = innerWidth - 56；
     extra2 = write ? 16 : 32；budget = available - extra2 - 480；
     other = detail ? (listClosed ? 40 : 240) : map ? (detailClosed ? 40 : 280) : 0；
     nav 取 min(navWidth, budget - other)，list/detail 再减去 nav，结果不小于 40。
   - 拖拽（1980-2005）与键盘调宽（2092-2099）：ArrowLeft/Right ±10、Shift ±40，detail 方向取负，Home 复位。 */

export const LORE_PANE = {
  /* 设计稿 --nav-w: 220（studio.css）；改动前请同步 scripts/compare-lore.mjs 的 SPEC 与验收基线 */
  nav: { min: 180, max: 360, def: 220 },
  list: { min: 240, max: 420, def: 300 },
  detail: { min: 280, max: 460, def: 348 }
}
export const RAIL_W = 40
export const MAIN_MIN = 480

/** 把某列的宽度夹进它的 min/max（非法值退回默认宽度）。 */
export function clampWidth(size, w) {
  const pane = LORE_PANE[size] || LORE_PANE.nav
  const n = Math.round(Number(w))
  if (!Number.isFinite(n)) return pane.def
  return Math.max(pane.min, Math.min(pane.max, n))
}

/** 按视图 / 窗口宽度 / 收起态算出三列的实际像素宽（收起 = 40px 细轨）。
    write 只要 nav；detail 多一个 list；map 多一个 detail —— 与网格模板一致。 */
export function loreWidths({ view, innerWidth, navWidth, listWidth, detailWidth, navClosed, listClosed, detailClosed } = {}) {
  const v = view === 'detail' || view === 'map' ? view : 'write'
  const width = Number(innerWidth) || 1440
  /* 窄档（≤1099）：细轨是常驻列、抽屉是覆盖在 main 上的覆盖层，二者都不参与列宽预算 ——
     因此这里只交出 nav = RAIL_W（常驻细轨）、list/detail = 0（窄档只显示 main 或两屏之一）；
     抽屉的 270px 宽由 CSS 给定，不进列宽预算。 */
  if (width <= 1099) return { nav: RAIL_W, list: 0, detail: 0, narrow: true }
  const available = width - 56
  const extra2 = v === 'write' ? 16 : 32
  const budget = available - extra2 - MAIN_MIN
  const other = v === 'detail' ? (listClosed ? RAIL_W : 240) : v === 'map' ? (detailClosed ? RAIL_W : 280) : 0
  const nav = navClosed ? RAIL_W : clampWidth('nav', Math.min(Number(navWidth) || LORE_PANE.nav.def, budget - other))
  const side = v === 'detail'
    ? (listClosed ? RAIL_W : clampWidth('list', Math.min(Number(listWidth) || LORE_PANE.list.def, budget - nav)))
    : v === 'map'
      ? (detailClosed ? RAIL_W : clampWidth('detail', Math.min(Number(detailWidth) || LORE_PANE.detail.def, budget - nav)))
      : 0
  return {
    nav: Math.max(RAIL_W, nav),
    list: v === 'detail' ? Math.max(RAIL_W, side) : 0,
    detail: v === 'map' ? Math.max(RAIL_W, side) : 0,
    narrow: width <= 1099
  }
}

/** 各列默认宽度（双击分隔条 / Home 复位）。 */
export function resetWidth(size) {
  return (LORE_PANE[size] || LORE_PANE.nav).def
}

/** 键盘调宽的步长：ArrowLeft/Right → ±10，Shift ±40，detail 方向取负；Home 由调用方用 resetWidth 复位（这里返回 0）。 */
export function keyboardDelta(size, key, shift) {
  if (key !== 'ArrowLeft' && key !== 'ArrowRight') return 0
  const step = shift ? 40 : 10
  const sign = size === 'detail' ? -1 : 1
  return (key === 'ArrowRight' ? step : -step) * sign
}
