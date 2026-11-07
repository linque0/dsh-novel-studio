/* 设置入口：桌面版优先开独立面板窗口，被宿主拦下时退回主窗口的就地视图。
 *
 * 两种呈现必须共用同一套界面（SettingsWorkspace），所以入口只决定「在哪个窗口里渲染」：
 * - 面板窗口已开 → 不动 ui.view，主窗口原地不动（用户原来的位置不被打断）；
 * - 面板窗口开不了 → 记住来处视图再切到 'settings'，退出时回到来处。
 *
 * 宿主拦弹窗的判定只做一次：被拦一次之后本会话不再重试 panelOpen，
 * 否则每点一次齿轮都先弹一个被拦的空窗再闪回就地视图。
 * 判定按会话缓存、不落库：换一次宿主版本（可能已放开）重启即可重新探测。
 */

const PANEL_OPEN_TIMEOUT = 250

let returnView = null
/* null = 还没探测过；true = 宿主会拦（或没有桥），不再重试 */
let hostBlocked = null

/* 面板窗口自身：URL 带 ?panel=settings:... 时就是设置面板，退出要关窗而不是换视图 */
export function isSettingsPanel() {
  return new URLSearchParams(location.search).get('panel')?.split(':')[0] === 'settings'
}

function openPanelWindow() {
  if (!window.native?.panelOpen) return Promise.resolve(false)
  /* 超时只表示「250ms 内没有应答复」，被挂起那次调用结果自己吃掉，避免未处理拒绝 */
  const call = Promise.resolve()
    .then(() => window.native.panelOpen({ type: 'settings', workId: 'app', entityId: '', title: '设置' }))
    .then((result) => result?.ok === true, () => false)
  const timeout = new Promise((resolve) => setTimeout(() => resolve(false), PANEL_OPEN_TIMEOUT))
  return Promise.race([call, timeout])
}

export async function openSettings(ui) {
  if (!ui) return false
  if (hostBlocked !== true) {
    const opened = await openPanelWindow()
    if (opened) return true
    hostBlocked = true
  }
  /* 面板窗口里没有「就地视图」可退：设置窗口已经自己开着，交给调用方忽略 */
  if (isSettingsPanel()) return false
  if (ui.view !== 'settings') returnView = ui.view
  ui.view = 'settings'
  return true
}

export function leaveSettings(ui) {
  if (isSettingsPanel()) {
    if (window.native?.panelCloseSelf) window.native.panelCloseSelf()
    else window.close()
    return
  }
  const target = returnView || 'shelf'
  returnView = null
  if (ui) ui.view = target
}

/* 面板窗口的宿主关闭按钮也走 leaveSettings，把「关窗」这一件事收在一处 */
export function resetSettingsEntry() {
  returnView = null
  hostBlocked = null
}
