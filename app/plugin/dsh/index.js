/* DSH 插件版专属层（M0）：把皮肤定为 dsh，并守住宿主注入的 body 标记。
 * 只做状态与属性，不含任何界面组件。 */
import './dsh.css'
/* 语言令牌与胶囊外壳排在 dsh.css 之后：同权重时后写为胜，覆盖关系靠这一行维持。 */
import './language.css'
/* 流动背板的外壳（主窗口 + 拆窗面板）同样排在 language.css 之后：压 dsh.css 的实底与玻璃靠的是后写为胜。 */
import './flow-shell.css'
import './outline-fusion.css'
import './characters-fusion.css'
import './settings-fusion.css'
import { getActivePinia } from 'pinia'
import { useUiStore } from '../../src/stores/ui'

const SKIN = 'dsh'
const HOST = 'dsh'

function applyBodyAttrs() {
  const body = typeof document === 'undefined' ? null : document.body
  if (!body) return
  if (body.dataset.skin !== SKIN) body.dataset.skin = SKIN
  if (body.dataset.nsHost !== HOST) body.dataset.nsHost = HOST
}

/* 应用状态层先定 dsh：App.vue 的 activeSkin 侦听会用 ui.skin 回写 body，光写属性会被覆盖。 */
function forceSkin(ui) {
  if (ui.skin === SKIN) return
  Promise.resolve(ui.setSkin(SKIN)).catch(() => { ui.skin = SKIN })
}

/* 正文页左栏（章节栏）在这个界面里是左缘 22px 细轨的抽屉：窄栏（<560）默认收起，
 * 正文拿整幅宽度。只改内存里的默认值、不写库：用户手动展开/收起走 setPref 落库，
 * 之后的启动由 loadPrefs 读回库里的值（本函数先跑，loadPrefs 后跑，有记录就覆盖它）。 */
const NARROW_MAX = 560

function defaultDirectoryCollapsed(ui) {
  if (typeof window === 'undefined') return
  if (window.innerWidth >= NARROW_MAX) return
  if (ui.sidePanelOpen) ui.sidePanelOpen = false
}

export function installDshSkin(pinia) {
  if (typeof document === 'undefined') return
  if (!document.body) {
    document.addEventListener('DOMContentLoaded', () => installDshSkin(pinia), { once: true })
    return
  }
  applyBodyAttrs()
  if (typeof MutationObserver === 'function') {
    const observer = new MutationObserver(applyBodyAttrs)
    observer.observe(document.body, { attributes: true, attributeFilter: ['data-skin', 'data-ns-host'] })
  }
  const store = pinia || getActivePinia()
  if (!store) return
  const ui = useUiStore(store)
  forceSkin(ui)
  defaultDirectoryCollapsed(ui)
  /* loadPrefs 会用库里旧皮肤覆盖 state，这里兜住回写 */
  ui.$subscribe(() => forceSkin(ui))
}
