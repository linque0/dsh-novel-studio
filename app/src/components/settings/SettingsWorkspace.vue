<script setup>
/* 设置工作区外壳（总稿 app.mjs:21-45 的 render/status/applyPreview 那一层）。
 *
 * 结构契约（settings-fusion.css 按此写死）：.settings-shell 的直接子元素只有
 * aside.pane.side-pane / main.pane.main-pane / button.scrim / div.toast，
 * 顶栏和外壳是兄弟，外壳在弹性列中跟随顶栏实际高度。
 *
 * 界面键（分类/滚动/预览/抽屉）在本组件里另存一份 ref 作为渲染真源：
 * 跨窗口 prefs-changed 时 installAppBus 会整体 loadPrefs（含 settings:* 四个键），
 * 若不这样，另一个窗口存过一次分类就会把本窗口的页面顶走。
 *
 * 外观四项的改动一律走 ui.applyPref：先写内存、失败留 pending/dirty，可重试。 */
import { computed, nextTick, onBeforeUnmount, onMounted, provide, ref, watch } from 'vue'
import AppTopbar from '../AppTopbar.vue'
import { useUiStore } from '../../stores/ui'
import { useWorkStore } from '../../stores/work'
import { WORK_NAVIGATION } from '../app-navigation'
import { leaveSettings } from '../../services/settings-entry.js'
import { mountFlowBackdrop } from '../../services/latent/flow.js'
import { SETTINGS_PAGES, SETTINGS_PAGE_KEYS, searchSettings } from './settings-catalog.js'
import { SETTINGS_SAVE_ERROR, createSettingsHistory, resetAppearancePrefs } from './settings-prefs.js'
import { SETTINGS_TOAST_KEY, useSettingsToast } from './settings-toast.js'
import SettingsSidebar from './SettingsSidebar.vue'
import SettingsSearchResults from './SettingsSearchResults.vue'
import SettingsAppearance from './SettingsAppearance.vue'
import SettingsDataPage from './SettingsDataPage.vue'
import SettingsAboutPage from './SettingsAboutPage.vue'
import SettingsDialog from './SettingsDialog.vue'

const APPEARANCE_KEYS = ['editorFont', 'editorLatin', 'fontSize', 'topbarAutoHide']
const NARROW_MAX = 1100
const TARGET_MS = 1200
const SCROLL_SAVE_MS = 250

const ui = useUiStore()
const work = useWorkStore()

const { message, undoVisible, show: showToast, runUndo } = useSettingsToast()
provide(SETTINGS_TOAST_KEY, { show: showToast, message, undoVisible, runUndo })

/* ---------- 界面状态 ---------- */
const page = ref(SETTINGS_PAGE_KEYS.includes(ui.settingsPage) ? ui.settingsPage : 'appearance')
const query = ref('')
const drawer = ref(false)
const previewOpen = ref(ui.settingsPreviewOpen === true)
const narrow = ref(typeof window !== 'undefined' ? window.innerWidth < NARROW_MAX : false)

const shell = ref(null)
const scrollEl = ref(null)

const results = computed(() => searchSettings(query.value))
/* 预览只在外观页有意义：切页复位（抽屉/预览都是「当前屏」的状态，不该跨页延续） */
const preview = computed(() => previewOpen.value && page.value === 'appearance')
const trapActive = computed(() => drawer.value && narrow.value)
const pageMeta = computed(() => SETTINGS_PAGES.find((item) => item.key === page.value) || SETTINGS_PAGES[0])
const scrollKey = computed(() => (query.value ? 'search' : page.value))
const breadcrumb = computed(() => (query.value ? '搜索' : page.value === 'appearance' ? '外观' : page.value === 'data' ? '数据' : '关于'))
const headTitle = computed(() => (query.value ? '搜索设置' : pageMeta.value.title))
const footRight = computed(() => {
  if (query.value) return '快速定位工坊偏好'
  if (page.value === 'appearance') return '改动即时生效'
  if (page.value === 'data') return '作品与偏好 · 当前设备'
  return '小说工坊 · LATENT'
})
const saveState = computed(() => (ui.prefsSave.error ? 'error' : ui.prefsSave.pending ? 'dirty' : 'saved'))

/* ---------- 界面键写回（防抖：滚动与分类切换都是高频动作） ---------- */
let uiSaveTimer = null
function scheduleSaveUi() {
  clearTimeout(uiSaveTimer)
  uiSaveTimer = setTimeout(() => ui.saveSettingsUi(), SCROLL_SAVE_MS)
}

/* ---------- 滚动记忆 ---------- */
let scrollTimer = null
function restoreScroll() {
  const el = scrollEl.value
  if (!el) return
  const top = ui.settingsScroll?.[scrollKey.value]
  el.scrollTop = Number.isFinite(top) ? top : 0
}
function onScroll(event) {
  const el = event.target
  ui.settingsScroll[scrollKey.value] = el.scrollTop
  clearTimeout(scrollTimer)
  scrollTimer = setTimeout(() => ui.saveSettingsUi(), SCROLL_SAVE_MS)
}

/* ---------- 分类 / 检索 ---------- */
function applyPage(key) {
  page.value = key
  ui.settingsPage = key
  previewOpen.value = false
  ui.settingsPreviewOpen = false
  scheduleSaveUi()
}
function setPage(key) {
  if (!SETTINGS_PAGE_KEYS.includes(key)) return
  query.value = ''
  drawer.value = false
  applyPage(key)
  nextTick(restoreScroll)
}
function setQuery(value) {
  query.value = String(value ?? '')
  previewOpen.value = false
  ui.settingsPreviewOpen = false
  nextTick(restoreScroll)
}
function clearQuery() {
  setQuery('')
  nextTick(() => document.getElementById('settings-query')?.focus())
}
function showResults() {
  drawer.value = false
  nextTick(() => shell.value?.querySelector('.search-result')?.focus())
}

/* 定位：清空查询 → 切到条目所属分类 → 下一帧给该行打 .target 并聚焦行内控件 */
function locate(row) {
  if (!row?.id) return
  query.value = ''
  drawer.value = false
  if (SETTINGS_PAGE_KEYS.includes(row.page)) applyPage(row.page)
  nextTick(() => {
    requestAnimationFrame(() => {
      const target = scrollEl.value?.querySelector(`[data-setting="${row.id}"]`)
      if (!target) return
      target.classList.add('target')
      target.scrollIntoView({ block: 'center' })
      setTimeout(() => target.classList.remove('target'), TARGET_MS)
      const focusable = target.querySelector('input,select,button')
      if (focusable) focusable.focus({ preventScroll: true })
      else {
        target.tabIndex = -1
        target.focus({ preventScroll: true })
      }
    })
  })
}

/* ---------- 抽屉 ---------- */
let drawerTrigger = null
function openDrawer(event) {
  drawerTrigger = event?.currentTarget || null
  drawer.value = true
  nextTick(() => document.getElementById('settings-query')?.focus())
}
function closeDrawer() {
  const wasOpen = drawer.value
  drawer.value = false
  if (!wasOpen) return
  nextTick(() => {
    const target = drawerTrigger?.isConnected ? drawerTrigger : shell.value?.querySelector('.mobile-tools [data-act="open-drawer"]')
    drawerTrigger = null
    target?.focus({ preventScroll: true })
  })
}

/* ---------- 预览与恢复默认 ---------- */
function togglePreview() {
  previewOpen.value = !preview.value
  ui.settingsPreviewOpen = previewOpen.value
  scheduleSaveUi()
}

/* 恢复默认要二次确认（总稿 app.mjs:80-81）：点「恢复默认」只开弹窗，
 * 确认才 checkpoint + 写默认值——否则一次误点就把作者的字形字号全换掉。
 * 撤销窗口交给 toast：快照只存外观四项，撤销也只回写这四项，不碰作品数据。 */
const history = createSettingsHistory()
const resetOpen = ref(false)
function currentAppearance() {
  return { editorFont: ui.editorFont, editorLatin: ui.editorLatin, fontSize: ui.fontSize, topbarAutoHide: ui.topbarAutoHide }
}
function resetAppearance() {
  history.checkpoint(currentAppearance())
  const defaults = resetAppearancePrefs()
  for (const key of APPEARANCE_KEYS) ui.applyPref(key, defaults[key])
  resetOpen.value = false
  showToast('外观已恢复默认。', {
    undo: () => {
      const previous = history.undo()
      if (!previous) {
        showToast('暂无可撤销的操作。')
        return
      }
      for (const key of APPEARANCE_KEYS) if (previous[key] !== undefined) ui.applyPref(key, previous[key])
      showToast('已撤销上一步操作。')
    }
  })
}

/* ---------- 保存态 ---------- */
async function retrySave() {
  const ok = await ui.retryPrefs()
  if (!ok) showToast(ui.prefsSave.error || SETTINGS_SAVE_ERROR)
  return ok
}
/* Ctrl/⌘+S：有待写键就先重试写库；没有待写就刷一次界面状态，两种情况都给一条结论 */
async function saveNow() {
  if (Object.keys(ui.prefsDirty || {}).length) {
    const ok = await ui.retryPrefs()
    showToast(ok ? '偏好已保存' : ui.prefsSave.error || SETTINGS_SAVE_ERROR)
    return
  }
  await ui.saveSettingsUi()
  showToast(ui.prefsSave.error || '偏好已保存')
}

/* ---------- 顶栏导航 ---------- */
function onTopbarNavigate(key) {
  if (key === 'settings') return
  const navKey = WORK_NAVIGATION.some((item) => item.key === key) ? key : null
  if (navKey && work.work) {
    leaveSettings(ui)
    ui.view = 'work'
    work.tab = navKey
    return
  }
  leaveSettings(ui)
  /* 无作品时模块键无处可去：leaveSettings 的来处可能是工作台，兜住别落在空工作台上 */
  if (navKey && !work.work) ui.view = 'shelf'
}

/* ---------- 键盘 ---------- */
function dialogOpen() {
  return !!shell.value?.querySelector('dialog[open]')
}
function trapTab(event) {
  const pane = shell.value?.querySelector('.side-pane')
  const items = [...(pane?.querySelectorAll('button,input,a') || [])].filter((el) => !el.disabled && el.getClientRects().length)
  if (!items.length) return
  const first = items[0]
  const last = items[items.length - 1]
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}
function onKeydown(event) {
  if (event.isComposing || ui.statsOpen) return
  const modal = dialogOpen()
  if (event.key === 'Escape' && !modal) {
    if (drawer.value) {
      event.preventDefault()
      closeDrawer()
      return
    }
    if (preview.value) {
      event.preventDefault()
      previewOpen.value = false
      ui.settingsPreviewOpen = false
      return
    }
    event.preventDefault()
    leaveSettings(ui)
    return
  }
  if ((event.ctrlKey || event.metaKey) && String(event.key).toLowerCase() === 's' && !modal) {
    event.preventDefault()
    saveNow()
    return
  }
  if (event.key === 'Tab' && trapActive.value && !modal) trapTab(event)
}

/* ---------- 窗口尺寸 ---------- */
function onResize() {
  narrow.value = window.innerWidth < NARROW_MAX
  drawer.value = false
}

/* ---------- 流动背板 ----------
 * 背板原本只由 Workbench / PanelHost 挂（各自带 .st-backdrop-wrap），设置视图不在它们里面，
 * 于是这里少一层底。按同一份 DOM 与同一个引擎自挂一层：
 * 本壳不是 .workbench-shell/.panel-host，flow-shell.css 的定位/尺寸规则不命中，
 * 所以包裹层（fixed 满视口）与画布（absolute 满铺）的盒子走内联；不额外加遮罩或滤镜。
 * 层级不用调：背板 0 < .settings-shell 20 < 顶栏 60（.wb-topbar-host 自带 z-index:60）。 */
const flowCanvas = ref(null)
let flowApi = null
const motionQuery = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
  ? window.matchMedia('(prefers-reduced-motion: reduce)')
  : null

function flowStats() {
  return flowApi && typeof flowApi.stats === 'function'
    ? flowApi.stats()
    : { backend: 'cpu', renderer: '', avgFrameMs: 0, scale: 1, pixels: [0, 0], time: 0, noise: '', shaderLog: '' }
}
function onMotionChange(event) {
  flowApi?.setReducedMotion?.(Boolean(event.matches))
}
function mountFlow() {
  const canvas = flowCanvas.value
  if (!canvas) return
  const width = window.innerWidth || 1280
  /* 引擎起不来不该拖垮整页（PanelHost 同款兜底）：拿不到实例就保持没有底的纯平底 */
  try {
    flowApi = mountFlowBackdrop(canvas, {
      reducedMotion: Boolean(motionQuery?.matches),
      simWidth: width < 560 ? 320 : width < 900 ? 480 : 640,
      maxEdge: width < 900 ? 1280 : 1600
    })
  } catch {
    flowApi = null
  }
  motionQuery?.addEventListener?.('change', onMotionChange)
  /* 验收脚本读这个钩子：形状与 Workbench / PanelHost 的背板钩子一致（backend 只有 gpu|cpu） */
  window.__nsSettingsBackdrop = flowStats
}
function unmountFlow() {
  motionQuery?.removeEventListener?.('change', onMotionChange)
  try { flowApi?.dispose?.() } catch { /* 已销毁 */ }
  flowApi = null
  if (window.__nsSettingsBackdrop === flowStats) delete window.__nsSettingsBackdrop
}

/* ---------- 跨窗口偏好同步 ----------
 * installAppBus 已按 prefs-changed 重载全部偏好（含 settings:* 界面键），这里只补两件事：
 * 本窗口有未保存改动时把脏值写回去（否则另一个窗口的旧值会盖掉用户刚选的字号），
 * 并把界面键交给本组件的 ref——页面/滚动/预览/抽屉不跟着别的窗口跳。 */
const busSubs = new Set()
let busBound = false
function adoptExternalPrefs() {
  if (!ui.prefsSave.pending) return
  for (const [key, value] of Object.entries(ui.prefsDirty || {})) ui[key] = value
}
function bindAppBus() {
  if (busBound || !window.native?.appOnEvent) return
  busBound = true
  window.native.appOnEvent((event) => {
    if (event?.kind === 'prefs-changed') busSubs.forEach((fn) => fn())
  })
}

onMounted(async () => {
  document.addEventListener('keydown', onKeydown)
  window.addEventListener('resize', onResize)
  busSubs.add(adoptExternalPrefs)
  bindAppBus()
  mountFlow()
  await nextTick()
  restoreScroll()
})
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown)
  window.removeEventListener('resize', onResize)
  busSubs.delete(adoptExternalPrefs)
  clearTimeout(uiSaveTimer)
  clearTimeout(scrollTimer)
  unmountFlow()
})

watch(query, () => scheduleSaveUi())
</script>

<template>
  <section class="settings-workspace" aria-label="设置">
  <!-- 设置页也坐在共享的流动底上：DOM 与 Workbench 的背板逐字同构，盒子尺寸走内联见脚本注释 -->
  <div class="st-backdrop-wrap" style="position:fixed;inset:0;z-index:0;pointer-events:none;overflow:hidden">
    <canvas ref="flowCanvas" class="st-backdrop" style="position:absolute;inset:0;display:block;width:100%;height:100%"></canvas>
    <div class="st-layer dots"></div>
    <div class="st-layer vignette"></div>
    <div class="st-layer grain"></div>
  </div>

  <AppTopbar
    active="settings"
    :has-work="!!work.work"
    :target-title="work.work?.title || ''"
    :save-state="saveState"
    :busy="false"
    @navigate="onTopbarNavigate"
  />

  <div ref="shell" class="settings-shell" :data-drawer="drawer ? 'open' : null" :data-preview="preview ? 'open' : null">
    <SettingsSidebar
      :page="page"
      :query="query"
      :result-count="results.length"
      @update:query="setQuery"
      @change-page="setPage"
      @close="closeDrawer"
      @results="showResults"
    />

    <main class="pane main-pane" :inert="trapActive">
      <header class="page-head">
        <div class="settings-heading-copy">
          <div class="breadcrumbs">
            偏好设置
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg>
            {{ breadcrumb }}
          </div>
          <div class="mobile-tools">
            <button type="button" data-act="open-drawer" title="设置分类" aria-label="设置分类" :aria-expanded="drawer ? 'true' : 'false'" @click="openDrawer">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M9 4v16" /></svg>
            </button>
            <h1>{{ headTitle }}</h1>
            <button type="button" data-act="search" title="搜索设置" aria-label="搜索设置" @click="openDrawer">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4.5 4.5" /></svg>
            </button>
          </div>
          <p v-if="query" class="sub">找到 {{ results.length }} 项与「{{ query }}」相关的设置</p>
        </div>
        <div class="head-actions">
          <template v-if="query">
            <button type="button" class="btn soft" data-act="clear-search" @click="clearQuery">清除搜索</button>
          </template>
          <template v-else-if="page === 'appearance'">
            <button type="button" class="btn mobile-preview-toggle" data-act="toggle-preview" @click="togglePreview">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 4h6a4 4 0 0 1 3 2 4 4 0 0 1 3-2h6v16h-6a4 4 0 0 0-3 2 4 4 0 0 0-3-2H3zM12 6v16" /></svg>
              {{ preview ? '返回调整' : '排版预览' }}
            </button>
            <button type="button" class="btn soft" data-act="reset-appearance" @click="resetOpen = true">恢复默认</button>
          </template>
        </div>
      </header>

      <div :hidden="!ui.prefsSave.error" id="save-error" class="save-error-banner">
        <span>{{ ui.prefsSave.error }}</span>
        <button type="button" class="btn small" data-act="retry" @click="retrySave">重试保存</button>
      </div>

      <div ref="scrollEl" class="content-scroll" @scroll="onScroll">
        <SettingsSearchResults v-if="query" :results="results" @locate="locate" @clear="clearQuery" />
        <SettingsAppearance v-else-if="page === 'appearance'" />
        <SettingsDataPage v-else-if="page === 'data'" />
        <SettingsAboutPage v-else />
      </div>

      <footer id="page-foot" class="page-foot" :class="{ error: !!ui.prefsSave.error }">
        <span id="foot-status">{{ ui.prefsSave.error ? '当前改动尚未保存' : '偏好保存在当前设备' }}</span>
        <span>{{ footRight }}</span>
      </footer>

      <!-- 弹窗挂在 main.pane 内（不是 .settings-shell 的直接子元素）：既让 .settings-shell dialog 选择器命中，
           原生 dialog 在 top-layer，不占用内容区高度。 -->
      <SettingsDialog v-model:open="resetOpen" title="恢复默认外观">
        <p>恢复为思源宋体、跟随中文的西文字体和 17 px 字号，并关闭默认隐藏顶栏。</p>
        <p class="dialog-note">正文内容与作品数据会保留。</p>
        <template #footer>
          <button type="button" class="btn" data-act="dialog-close" @click="resetOpen = false">取消</button>
          <button type="button" class="btn primary" data-act="reset-confirm" @click="resetAppearance">恢复默认</button>
        </template>
      </SettingsDialog>
    </main>

    <button class="scrim" type="button" tabindex="-1" aria-label="关闭设置分类" @click="closeDrawer"></button>

    <div class="toast" :hidden="!message" role="status" aria-live="polite">
      <span>{{ message }}</span>
      <button v-if="undoVisible" type="button" data-act="undo" @click="runUndo">撤销</button>
    </div>
  </div>
  </section>
</template>
