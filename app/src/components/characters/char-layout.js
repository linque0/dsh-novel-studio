/* 人物工作区的宽度算法与状态归一：纯函数、不碰 DOM（与 lore-layout.js 同构，便于探针/单测）。
   逐条对照设计稿 docs/前端美化/人物-融合总稿-20261105/：
   - 两套默认栏宽 fusion.css:2-3 与 app.mjs:17 的 defaults：profile 248/304，graph 220/332。
   - 列宽预算 app.mjs:53：innerWidth >= 1100 才参与预算，
     available = innerWidth - 56（.workspace 左右各 28px 留白）- 32（两条 16px 分隔列）；
     收窄顺序同原型：先把右列压到 260，再把左列压到 180。
   - 主区下限 420：app.mjs:53 的预算（… - 420）与 app.mjs:138 的拖拽 space（… - 420）同一数值，
     设计稿 report.json 的「边界与横向溢出」实测（1440 / 1280 都是 248 + 640/800 + 304）也据此成立。
   - 拖拽 app.mjs:138 / 键盘 app.mjs:148：左列 180–360、右列 260–480、步长 12、右列方向取负、Home 复位。
   - 收起态 = 44px 细轨：studio.css 的 .workspace.left-closed / .right-closed 直接写
     `44px 16px minmax(0,1fr) 16px var(--right)` 与 `var(--left) 16px minmax(0,1fr) 16px 44px`。 */

export const MAIN_MIN = 420
export const DIVIDER_W = 16
export const RAIL_W = 44
export const SHELL_PAD_X = 56
export const CHAR_STEP = 12
export const NARROW_MAX = 1099
export const WIDE_MIN = 1100

/* 每种视图两列各自的 min/max/def（def 即 app.mjs:17 defaults） */
export const CHAR_PANE = {
  profile: { left: { min: 180, max: 360, def: 248 }, right: { min: 260, max: 480, def: 304 } },
  graph: { left: { min: 180, max: 360, def: 220 }, right: { min: 260, max: 480, def: 332 } }
}
export const CHAR_VIEWS = ['profile', 'graph']

function viewKey(view) {
  return view === 'graph' ? 'graph' : 'profile'
}
function paneOf(size, view) {
  const one = CHAR_PANE[viewKey(view)]
  return size === 'right' ? one.right : one.left
}

/** 把某列的宽度夹进它的 min/max。非数字（含数字字符串）按非法值退回该视图该列的默认宽度。 */
export function clampWidth(size, w, view = 'profile') {
  const pane = paneOf(size, view)
  if (typeof w !== 'number' || !Number.isFinite(w)) return pane.def
  return Math.max(pane.min, Math.min(pane.max, Math.round(w)))
}

/** 窄档判定：<=1099 为窄档（app.mjs:137/148 的拖拽门槛是 innerWidth >= 1100）。 */
export function isNarrow(w) {
  const n = Number(w)
  return Number.isFinite(n) ? n <= NARROW_MAX : false
}

/** 按视图 / 窗口宽度 / 收起态算出两列的实际像素宽（收起 = 44px 细轨）。
    窄档两列都不进网格（名录是抽屉、侧栏是第二屏），这里交 0，列宽交给 CSS 的两行网格。 */
export function charWidths({ view, innerWidth, left, right, leftClosed, rightClosed } = {}) {
  const v = viewKey(view)
  const width = Number(innerWidth) || 1440
  if (width <= NARROW_MAX) return { left: 0, right: 0 }
  const budget = width - SHELL_PAD_X - DIVIDER_W * 2 - MAIN_MIN
  const win = CHAR_PANE[v]
  const l = leftClosed ? RAIL_W : clampWidth('left', left === undefined ? win.left.def : left, v)
  const r = rightClosed ? RAIL_W : clampWidth('right', right === undefined ? win.right.def : right, v)
  let extra = l + r - budget
  if (extra <= 0) return { left: l, right: r }
  const cut = Math.min(extra, r - win.right.min)
  const outRight = r - cut
  extra -= cut
  return { left: Math.max(win.left.min, l - extra), right: outRight }
}

/** 双击分隔条 / Home 复位：按视图交回两列的默认宽度。 */
export function resetWidth(view = 'profile') {
  const win = CHAR_PANE[viewKey(view)]
  return { left: win.left.def, right: win.right.def }
}

/** 键盘调宽步长：ArrowLeft/Right ±12，右列方向取负；Home 由调用方用 resetWidth 复位（这里返回 0）。 */
export function keyboardDelta(size, key) {
  if (key !== 'ArrowLeft' && key !== 'ArrowRight') return 0
  const sign = size === 'right' ? -1 : 1
  return (key === 'ArrowRight' ? CHAR_STEP : -CHAR_STEP) * sign
}

/** appconfig['charPrefs'] 的读回归一：两套视图各 { left, right, leftClosed, rightClosed }。 */
export function normalizeCharPrefs(raw) {
  const src = raw && typeof raw === 'object' ? raw : {}
  const out = {}
  for (const v of CHAR_VIEWS) {
    const one = src[v] && typeof src[v] === 'object' ? src[v] : {}
    out[v] = {
      left: clampWidth('left', one.left, v),
      right: clampWidth('right', one.right, v),
      leftClosed: one.leftClosed === true,
      rightClosed: one.rightClosed === true
    }
  }
  return out
}

const text = (s, max) => (typeof s === 'string' ? s.slice(0, max) : '')
const scrollTop = (n) => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.round(n) : 0)

/** appconfig['charstate:<workId>'] 的读回归一：视图 / 检索词 / 角色 / 标签 / 关系范围 / 三处滚动。 */
export function normalizeCharState(raw) {
  const v = raw && typeof raw === 'object' ? raw : {}
  const scroll = v.scroll && typeof v.scroll === 'object' ? v.scroll : {}
  return {
    view: v.view === 'graph' ? 'graph' : 'profile',
    query: text(v.query, 120),
    role: text(v.role, 60),
    tag: text(v.tag, 60),
    scope: v.scope === 'all' ? 'all' : 'local',
    scroll: { roster: scrollTop(scroll.roster), dossier: scrollTop(scroll.dossier), context: scrollTop(scroll.context) }
  }
}
