<script setup>
import { computed, ref, provide, onMounted, onBeforeUnmount, watch } from 'vue'
import { NButton, NDropdown, useMessage } from 'naive-ui'
import { useWorkStore } from '../stores/work'
import { useUiStore } from '../stores/ui'
import { useAiStore } from '../stores/ai'
import OIcon from './OIcon.vue'
import AppTopbar from './AppTopbar.vue'
import OutlineTopbar from './outline/OutlineTopbar.vue'
import DreamModeEntries from './agent/DreamModeEntries.vue'
import {enterDreamMode,enterLightSleepMode} from '../services/ai/entry-modes.js'
import { WORK_NAVIGATION } from './app-navigation'
import { openSettings as openSettingsEntry } from '../services/settings-entry.js'
import ChapterTree from './ChapterTree.vue'
import OutlineSidebar from './OutlineSidebar.vue'
import CandidateEditor from './agent/CandidateEditor.vue'
import {useStoryStore} from '../stores/story.js'
const story=useStoryStore()
import { autosave } from '../services/autosave.js'
import OutlineCenter from './OutlineCenter.vue'
import CharactersWorkspace from './characters/CharactersWorkspace.vue'
import LoreWorkspace from './lore/LoreWorkspace.vue'
import SnippetsWorkspace from './snippets/SnippetsWorkspace.vue'
import RightPanel from './RightPanel.vue'
import AiAssistantPanel from './ai/AiAssistantPanel.vue'
const nsPlugin = __NS_PLUGIN__
import DLinkPopover from './DLinkPopover.vue'
import { popOut, isPopped, focusPopped } from '../services/panelwindows'
import { mountFlowBackdrop } from '../services/latent/flow.js'
import { hashString, paletteOf } from '../services/latent/palette.js'

const work = useWorkStore()
const ui = useUiStore()
const shell = ref(null)
const narrow = ref(window.matchMedia('(max-width: 1180px)').matches)
/* 设定页与人物页都自带面板矩阵（LoreWorkspace 的 nav 列 = 设定目录、CharactersWorkspace 的 roster 列 = 人物名录），
   不再走外置侧栏：.side-panel / .side-resizer / .ol-side-rail 在 lore / characters 页整体让位，别的 tab 一字不动。 */
const showDirectory = computed(() => work.tab !== 'lore' && work.tab !== 'characters' && work.tab !== 'snippets' && !(nsPlugin && work.tab === 'outline') && !ui.focusMode && !ui.readMode && !modulePopped.value)
const showNotes = computed(() => !!work.activeChapter && !ui.focusMode && !ui.readMode && !modulePopped.value && work.tab === 'chapters')
/* 目录栏（正文页即章节栏）开合：大纲模块沿用自有开合，其余模块共用 sidePanelOpen */
const dirVisible = computed(() => (work.tab === 'outline' ? ui.outlineSideOpen : ui.sidePanelOpen))
function toggleDirectory() {
  return work.tab === 'outline' ? ui.setPref('outlineSideOpen', !ui.outlineSideOpen) : ui.setPref('sidePanelOpen', !ui.sidePanelOpen)
}
function closeDirectory() {
  return ui.setPref(work.tab === 'outline' ? 'outlineSideOpen' : 'sidePanelOpen', false)
}
function openDirectoryDrawer() {
  ui.setPref(work.tab === 'outline' ? 'outlineSideOpen' : 'sidePanelOpen', true)
}
const ai = useAiStore()
function returnToShelf(){
  if(new URLSearchParams(location.search).get('panel')?.startsWith('agent:'))return window.native?.panelCloseSelf()
  return work.closeWork()
}
const inspirationPrompt = ref('把这条灵感扩展成一个场景，保留悬念。')
provide('inspirationPrompt', inspirationPrompt)
const msg = useMessage()
const entryBusy=ref(false)
async function enterAiMode(mode){
  if(entryBusy.value)return
  entryBusy.value=true
  try{
    const context={ui,work,flush:()=>autosave.flushAll(),toggle:true,isDetached:()=>isPopped(work,'ai',''),focusDetached:()=>focusPopped(work,'ai','')}
    await (mode==='dream'?enterDreamMode(context):enterLightSleepMode(context))
  }catch(e){msg.error(e.message)}finally{entryBusy.value=false}
}

/* ---------- 书签（章节快捷收藏） ---------- */
const bookmarkOptions = computed(() => {
  const list = work.liveBookmarks
  return list.length
    ? list.map((b) => ({ label: b.title || '（空）', key: b.id }))
    : [{ label: '暂无书签（编辑器工具栏或章节右键添加）', key: 'none', disabled: true }]
})
function onBookmarkSelect(key) {
  const b = work.bookmarks.find((x) => x.id === key)
  if (!b) return
  selectTab('chapters')
  work.selChapterId = b.targetId
  const c = work.chapters.find((x) => x.id === b.targetId)
  if (c) work.selVolumeId = c.volumeId
}

const tabs = WORK_NAVIGATION
function selectTab(key) {
  work.tab = key
}

const moreOptions = computed(() => [
  { label: '拆出独立窗口', key: 'split', children: splitOptions.value.map(o => ({ ...o, key: 'split:' + o.key })) },
  { label: '章节书签', key: 'bookmarks', children: bookmarkOptions.value.map(o => ({ ...o, key: 'bookmark:' + o.key })) },
  { label: dirVisible.value ? '收起目录栏' : '展开目录栏', key: 'dir' },
  { label: ui.focusMode ? '退出沉浸' : '沉浸写作', key: 'focus' },
  ...(work.tab === 'chapters' ? [{ label: ui.readMode ? '退出阅读' : '阅读模式', key: 'read' }] : [])
])
function onMore(key) {
  if (key.startsWith('split:')) return onSplit(key.slice(6))
  if (key.startsWith('bookmark:')) return onBookmarkSelect(key.slice(9))
  if (key === 'dir' && nsPlugin && work.tab==='outline') return window.dispatchEvent(new CustomEvent('outline-command',{detail:{command:'toggle-structure'}}))
  if (key === 'dir') return toggleDirectory()
  if (key === 'focus') ui.focusMode = !ui.focusMode
  if (key === 'read') ui.readMode = !ui.readMode
  if (key === 'settings') openSettings()
}

/* 窄栏（<560）顶栏动作全收进 ⋯：搜索 / 章节历史 / 批注 / 更多（子菜单复用工作台「更多」）。
 * 与 APP_NAVIGATION 分两区，模块导航不受影响。 */
const narrowActions = computed(() => [
  { label: '搜索', key: 'search' },
  { label: '章节历史', key: 'history', disabled: !(work.tab === 'chapters' && work.activeChapter) },
  { label: chapterNotes.value.length ? `批注 (${chapterNotes.value.length})` : '批注', key: 'notes', disabled: !chapterNotes.value.length },
  { label: '更多', key: 'more', children: moreOptions.value }
])
function onTopbarAction(key) {
  if (key === 'search') return (ui.searchOpen = true)
  if (key === 'history') {
    if (work.tab !== 'chapters' || !work.activeChapter) return
    return (ui.revisionsCtx = { id: work.activeChapter.id, title: work.activeChapter.title })
  }
  if (key === 'notes') return openNotesDrawer()
  onMore(key)
}

/* 窄栏批注抽屉：<560 时右批注栏改由 ⋯「动作 → 批注」打开，覆盖式从右滑出；
 * ≥560 由 dsh 皮肤恢复常驻三栏，这里的开关不落盘、不写 ui.rightPanelOpen。 */
const narrowNotesOpen = ref(false)
let narrowMq = null
let narrowMq1180 = null
let tinyMq = null
let wideMq = null
function syncNarrowWidth(event) { narrow.value = event.matches }
/* ≤560 进入窄栏时收起目录栏一次：380 档皮肤会把章节栏当抽屉铺在正文上，细轨才是入口。
   只在 matchMedia 变化与首次挂载时跑，用户点细轨展开后不会再被自动关。 */
function collapseDirectoryOnTiny(event) {
  if (event.matches && ui.sidePanelOpen) ui.setPref('sidePanelOpen', false)
}
/* ≤1179 批注栏改脱流覆盖式抽屉：进入这一段时收起一次，别让它默认盖在正文上。
   同样只在 matchMedia 变化与首次挂载时跑，用户点右缘细轨打开后不会再被自动关。 */
function collapseNotesOnWide(event) {
  if (event.matches && ui.rightPanelOpen) ui.setPref('rightPanelOpen', false)
}
const chapterNotes = computed(() => (work.activeChapter ? work.annotationsForChapter(work.activeChapter.id) : []))
function openNotesDrawer() {
  if (!chapterNotes.value.length) return
  /* 宽屏没有抽屉：同一入口退回「展开常驻批注栏」，不让这个菜单项在桌面版变成死键 */
  if (!window.matchMedia('(max-width: 899px)').matches) return ui.setPref('rightPanelOpen', true)
  narrowNotesOpen.value = true
}
function syncNarrowView(event) {
  if (!event.matches) narrowNotesOpen.value = false
}
watch(() => work.tab, () => { narrowNotesOpen.value = false })
watch(() => work.activeChapter?.id, () => { if (!chapterNotes.value.length) narrowNotesOpen.value = false })

const fmtTime = (t) => {
  const d = new Date(t)
  const p = (n) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}
const badgeClass = computed(() => (ui.autosave.saving ? 'saving' : ui.autosave.pending ? 'dirty' : ''))
/* 窄栏顶栏保存点（<560 顶栏动作整条隐藏后仍需可见）：saving > dirty > saved；
 * autosave 目前只报 saving/pending，error 留给后续接线。 */
const saveState = computed(() => (ui.autosave.saving ? 'saving' : ui.autosave.pending ? 'dirty' : 'saved'))
const badgeText = computed(() => {
  if (ui.autosave.saving) return '保存中…'
  if (ui.autosave.pending) return `${ui.autosave.pending} 处待保存`
  return ui.autosave.lastSavedAt ? `已保存 ${fmtTime(ui.autosave.lastSavedAt)}` : '自动保存就绪'
})

/* ---------- 设置入口：优先面板窗口，被拦或无桥时退回主窗口就地视图 ---------- */
function openSettings() {
  openSettingsEntry(ui)
}

function onKeydown(e) {
  if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'f') {
    e.preventDefault()
    ui.searchOpen = true
  }
  if (e.key === 'Escape' && narrowNotesOpen.value) {
    narrowNotesOpen.value = false
    e.preventDefault()
  }
}

/* ---------- 功能面板拆窗（9.2-W5：面板 = 完整模块界面，预选中当前实体） ---------- */
const splitOptions = computed(() => [
  { label: '⧉ 正文', key: 'chapter', disabled: false },
  { label: '⧉ 大纲', key: 'outline', disabled: false },
  { label: '⧉ 人物', key: 'characters', disabled: false },
  { label: '⧉ 设定', key: 'lore', disabled: false },
  { label: '⧉ 灵感', key: 'snippets', disabled: false },
  { label: '⧉ 恍然梦', key: 'ai', disabled: false }
])
async function onSplit(key) {
  const titles = {
    chapter: () => `${work.work?.title || ''} · 正文`,
    outline: () => `${work.work?.title || ''} · 大纲`,
    characters: () => `${work.work?.title || ''} · 人物`,
    lore: () => `${work.work?.title || ''} · 设定`,
    snippets: () => `${work.work?.title || ''} · 灵感`,
    ai: () => `${work.work?.title || ''} · 恍然梦`
  }
  const entityMap = {
    chapter: () => work.selChapterId,
    outline: () => '',
    characters: () => work.selCharacterId,
    lore: () => '',
    snippets: () => work.selSnippetId,
    ai: () => ''
  }
  const ok = await popOut(work, key, entityMap[key]?.() || '', titles[key]?.())
  if (ok) msg.success('已在独立窗口打开')
}

/* 模块级锁：大纲/设定拆出为整模块锁；人物/灵感按选中实体锁（9.2-W5） */
function curEntityForTab(tab) {
  if (tab === 'characters') return work.selCharacterId || ''
  if (tab === 'snippets') return work.selSnippetId || ''
  return ''
}
const modulePopped = computed(() => {
  if (!work.work || work.tab === 'chapters') return false
  return isPopped(work, work.tab, curEntityForTab(work.tab))
})
/* 恍然梦已拆出为独立窗口：主窗口停靠列隐藏，避免两处同时展示（锁随面板，关窗自动恢复） */
const aiPopped = computed(() => (work.work ? isPopped(work, 'ai', '') : false))
const aiMounted = ref(ui.aiDrawerOpen)
watch(() => ui.aiDrawerOpen, open => { if (open) aiMounted.value = true })
const aiVisible = computed(() => ui.aiDrawerOpen && !ui.focusMode && !ui.readMode && !aiPopped.value)
const curTabLabel = computed(() => tabs.find((t) => t.key === work.tab)?.label || '')
const poppedEntityName = computed(() => {
  if (work.tab === 'characters') return work.activeCharacter?.name || ''
  if (work.tab === 'snippets') return work.activeSnippet?.title || ''
  return ''
})

/* ---------- 侧栏宽度拖拽（180–480，松手后写入 appconfig 记忆） ----------
   设定页的列宽由面板矩阵自己管（lore-layout.js + LoreDivider 落库），这里只剩章节/人物/灵感栏 */
const sidePanelStyle = computed(() => ({ width: Math.min(280, ui.sideWidth || 280) + 'px' }))
function startSideResize(e) {
  e.preventDefault()
  const startX = e.clientX
  const startW = ui.sideWidth
  document.body.style.userSelect = 'none'
  const move = (ev) => {
    ui.sideWidth = Math.min(480, Math.max(180, startW + ev.clientX - startX))
  }
  const up = () => {
    window.removeEventListener('mousemove', move)
    window.removeEventListener('mouseup', up)
    document.body.style.userSelect = ''
    ui.setPref('sideWidth', ui.sideWidth)
  }
  window.addEventListener('mousemove', move)
  window.addEventListener('mouseup', up)
}
function resetSideWidth() {
  ui.setPref('sideWidth', 252)
}
/* ---------- 恍然梦停靠列宽度拖拽（300–640，appconfig 记忆，双击恢复默认） ---------- */
function startAiResize(e) {
  e.preventDefault()
  const startX = e.clientX
  const startW = ui.aiDrawerWidth
  document.body.style.userSelect = 'none'
  const move = (ev) => {
    ui.aiDrawerWidth = Math.min(640, Math.max(300, startW - (ev.clientX - startX)))
  }
  const up = () => {
    window.removeEventListener('mousemove', move)
    window.removeEventListener('mouseup', up)
    document.body.style.userSelect = ''
    ui.setPref('aiDrawerWidth', ui.aiDrawerWidth)
  }
  window.addEventListener('mousemove', move)
  window.addEventListener('mouseup', up)
}
function resetAiWidth() {
  ui.setPref('aiDrawerWidth', 400)
}
/* ---------- 主窗口流动底（正文/大纲/设定/人物/灵感共用 flow 引擎）：只做挂载与销毁，不含业务逻辑 ---------- */
const flowCanvas = ref(null)
let flowApi = null
let flowRippleAt = 0
const reduceMotionQuery = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
  ? window.matchMedia('(prefers-reduced-motion: reduce)') : null

/* 验收脚本读这个钩子：形状对齐 __nsLatentStats，没有实例时给一份空壳，backend 仍归一到 gpu|cpu */
function flowStats() {
  const api = flowApi
  return api && typeof api.stats === 'function'
    ? api.stats()
    : { backend: 'cpu', renderer: '', avgFrameMs: 0, scale: 1, pixels: [0, 0], time: 0 }
}

/* 调色只跟作品 id：同一本书在任何页、任何顺序下都是同一套色板 */
function applyFlowPalette() {
  const target = work.work
  if (!flowApi || !target) return
  flowApi.setPalette(paletteOf(target), { duration: 600, seed: (hashString(target.id) % 997) / 997 })
}

function destroyFlow() {
  try { flowApi?.dispose?.() } catch { /* 已销毁 */ }
  flowApi = null
}

function mountFlow() {
  destroyFlow()
  /* 恍然梦模式下 StudioWorkspace 用 v-show 藏起 Workbench：画布还在 DOM 里，rAF 不会自己停，
     不销毁就是两套背板同时跑。 */
  if (ui.workbenchMode !== 'writing') return
  const canvas = flowCanvas.value
  if (!canvas) return
  const width = window.innerWidth
  flowApi = mountFlowBackdrop(canvas, {
    palette: work.work ? paletteOf(work.work) : null,
    reducedMotion: Boolean(reduceMotionQuery?.matches),
    simWidth: width < 560 ? 320 : width < 900 ? 480 : 640,
    maxEdge: width < 900 ? 1280 : 1600
  })
}

/* 打字涟漪：编辑器（ProseMirror 根 .tiptap）输入时 80ms 节流推一次；找不到节点就跳过，不报错 */
function onStudioInput(event) {
  if (work.tab !== 'chapters') return
  const target = event.target
  if (!target || typeof target.closest !== 'function' || !target.closest('#tiptap, .tiptap')) return
  const now = performance.now()
  if (now - flowRippleAt < 80) return
  flowRippleAt = now
  try { flowApi?.pulse?.(0.05) } catch { /* 背板已销毁 */ }
}

function mountStudioBackdrop() {
  window.__nsFlowBackdrop = flowStats
  window.__nsStudioBackdrop = flowStats
  shell.value?.addEventListener('input', onStudioInput, true)
  mountFlow()
}

function unmountStudioBackdrop() {
  shell.value?.removeEventListener('input', onStudioInput, true)
  destroyFlow()
  /* 只撤自己那面旗：回到书架时钩子已被 LatentShelf 接管 */
  if (window.__nsFlowBackdrop === flowStats) delete window.__nsFlowBackdrop
  if (window.__nsStudioBackdrop === flowStats) delete window.__nsStudioBackdrop
}

/* 切页即销毁重建：上下文必须跟着放掉，重挂时引擎换一张干净画布（碰过 WebGL 的画布取不回上下文） */
watch(() => work.tab, () => { mountFlow() }, { flush: 'post' })
watch(() => ui.workbenchMode, () => { mountFlow() }, { flush: 'post' })
watch(() => work.work?.id, () => { applyFlowPalette() })

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  narrowMq = window.matchMedia('(max-width: 899px)')
  narrowMq.addEventListener('change', syncNarrowView)
  narrowMq1180 = window.matchMedia('(max-width: 1180px)')
  narrowMq1180.addEventListener('change', syncNarrowWidth)
  tinyMq = window.matchMedia('(max-width: 560px)')
  tinyMq.addEventListener('change', collapseDirectoryOnTiny)
  collapseDirectoryOnTiny(tinyMq)
  wideMq = window.matchMedia('(max-width: 1179px)')
  wideMq.addEventListener('change', collapseNotesOnWide)
  collapseNotesOnWide(wideMq)
  /* 章节栏与批注栏一致：默认收起，按需点左缘细轨浮出（皮肤把它做成脱流浮层，不占列宽）。
     只在挂载时收一次：之后用户自己打开不会再被自动关掉。
     设定页现在由 LoreWorkspace 的面板矩阵自带目录列，不再读 sidePanelOpen（下方 tab watcher 仅为兼容旧记录保留）。 */
  if (work.tab !== 'lore' && ui.sidePanelOpen) ui.setPref('sidePanelOpen', false)
  mountStudioBackdrop()
})
/* 进入设定页：宽屏把设定目录当作常驻左栏展开（原型 .nav-pane 220）；窄档仍走左缘细轨，
   免得主区被压到不能写字。其余模块沿用「默认收起」。 */
watch(
  () => work.tab,
  (tab) => {
    if (tab !== 'lore' || window.innerWidth < 900) return
    if (!ui.sidePanelOpen) ui.setPref('sidePanelOpen', true)
  },
  { immediate: true }
)
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  narrowMq?.removeEventListener('change', syncNarrowView)
  narrowMq1180?.removeEventListener('change', syncNarrowWidth)
  tinyMq?.removeEventListener('change', collapseDirectoryOnTiny)
  wideMq?.removeEventListener('change', collapseNotesOnWide)
  unmountStudioBackdrop()
})
</script>

<template>
  <div ref="shell" class="workbench-shell" :class="{ 'is-focus': ui.focusMode, 'is-reading': ui.readMode, 'latent-studio': work.tab === 'chapters', 'outline-strict': nsPlugin && work.tab==='outline' }" :data-module="work.tab" :data-flow="'on'" style="display: flex; flex-direction: column; height: 100%">
    <div class="st-backdrop-wrap"><canvas class="st-backdrop" ref="flowCanvas"></canvas><div class="st-layer dots"></div><div class="st-layer vignette"></div><div class="st-layer grain"></div></div>

    <OutlineTopbar v-if="nsPlugin && work.tab==='outline'" :actions="moreOptions" @navigate="key=>key==='shelf'?returnToShelf():key==='settings'?openSettings():selectTab(key)" @action="onMore"/>
    <AppTopbar v-else :active="work.tab" :has-work="!!work.work" :target-title="work.work?.title" :save-state="saveState" @navigate="key => key === 'shelf' ? returnToShelf() : key === 'settings' ? openSettings() : selectTab(key)" :actions="narrowActions" @action="onTopbarAction">
      <template #actions>
        <span class="save-badge"><span class="save-dot" :class="badgeClass"></span>{{ badgeText }}</span>
        <NButton size="small" quaternary aria-label="搜索" @click="ui.searchOpen = true"><OIcon name="search" :size="16" /> 搜索</NButton>
        <div id="studio-task-actions"></div>
        <DreamModeEntries v-if="!nsPlugin" :disabled="entryBusy" :active="ui.aiDrawerOpen?'light':''" @dream="enterAiMode('dream')" @light="enterAiMode('light')" />
        <NDropdown trigger="click" :options="moreOptions" @select="onMore"><NButton size="small" quaternary title="拆窗、书签、沉浸、阅读与皮肤">更多 <OIcon name="caret-down" :size="11" /></NButton></NDropdown>
      </template>
    </AppTopbar>

    <div class="wb-body">
      <div v-if="showDirectory && dirVisible" id="writing-directory" v-show="work.tab !== 'outline' || ui.outlineSideOpen" class="side-panel" aria-label="目录与资料" :style="sidePanelStyle">
        <ChapterTree v-if="work.tab === 'chapters'" @read="onMore('read')" @window="onSplit('chapter')" @collapse="closeDirectory()" />
        <OutlineSidebar v-else-if="work.tab === 'outline'" />
      </div>
      <div
        v-if="!(nsPlugin && work.tab === 'outline') && work.tab !== 'characters' && !ui.focusMode && !ui.readMode && !modulePopped && dirVisible"
        v-show="work.tab !== 'outline' || ui.outlineSideOpen"
        class="side-resizer"
        title="拖拽调整侧栏宽度（双击恢复默认）"
        @mousedown="startSideResize"
        @dblclick="resetSideWidth"
      ></div>

      <button
        v-if="showDirectory && !dirVisible && work.tab !== 'outline' && !ui.focusMode && !ui.readMode"
        class="ol-side-rail"
        type="button"
        title="展开目录栏"
        aria-label="展开目录栏"
        aria-controls="writing-directory"
        :aria-expanded="false"
        @click="toggleDirectory()"
      >
        <span class="rail-text">{{ work.tab === 'chapters' ? '章节' : '目录' }}</span>
        <span v-if="work.tab === 'chapters'" class="rail-count">{{ work.liveChapters.length }}</span>
      </button>
      <button
        v-if="!nsPlugin && work.tab === 'outline' && !ui.outlineSideOpen && !ui.focusMode && !ui.readMode && !modulePopped"
        class="ol-side-rail"
        type="button"
        title="展开故事结构"
        aria-label="展开故事结构"
        @click="ui.setPref('outlineSideOpen', true)"
      >
        <span class="rail-text">故事结构</span>
      </button>

      <!-- 模块已被拆出为面板窗口：主窗口占位，避免双窗口同写 -->
      <div v-show="modulePopped" class="center-pane paper-texture pop-lock-pane">
        <div class="pop-lock-note">
          <div class="big serif">{{ poppedEntityName ? `${curTabLabel}「${poppedEntityName}」已在独立窗口编辑` : `${curTabLabel}已在独立窗口编辑` }}</div>
          <p>主窗口此条目暂时只读——两侧同时写入会互相覆盖。关闭独立面板（或在面板中切换到其他条目）后此处自动恢复编辑。</p>
          <NButton type="primary" @click="focusPopped(work, work.tab, curEntityForTab(work.tab))">前往窗口</NButton>
        </div>
      </div>
      <!-- 设定页：委派给 LoreWorkspace 自带的面板矩阵外壳（nav | 16 | list | 16 | main | 16 | detail） -->
      <LoreWorkspace v-if="work.tab === 'lore'" v-show="!modulePopped" class="lore-shell-host" />
      <!-- 人物页：委派给 CharactersWorkspace 自带的面板矩阵外壳（roster | 16 | main | 16 | context） -->
      <CharactersWorkspace v-else-if="work.tab === 'characters'" v-show="!modulePopped" class="char-shell-host" />
      <SnippetsWorkspace v-else-if="work.tab === 'snippets'" v-show="!modulePopped" class="snippets-shell-host" />
      <div v-else v-show="!modulePopped" class="center-pane paper-texture">
        <div v-if="work.tab==='chapters'&&story.active&&!ui.agentCandidateId&&!nsPlugin" class="story-workshop-bar"><span>{{story.formalView?'正式正文':'与恍然梦共用的工作稿'}} · {{story.active.status==='confirmed'?'本章已确认':'尚未确认入正文'}}</span><button @click="story.formalView=!story.formalView">{{story.formalView?'回到共同工作稿':'对照正式正文'}}</button><button @click="ui.workbenchMode='agent'">回到故事现场</button></div>
        <div id="writing-story-editor-host" v-show="work.tab==='chapters'&&!ui.agentCandidateId&&story.active&&!story.formalView" class="shared-editor-host story-workshop-editor"></div>
        <div id="writing-editor-host" v-show="work.tab==='chapters'&&!ui.agentCandidateId&&(!story.active||story.formalView)" class="shared-editor-host"></div>
        <CandidateEditor v-if="work.tab==='chapters'&&ui.agentCandidateId" :candidate-id="ui.agentCandidateId" handoff @close="ui.agentCandidateId=null" />
        <OutlineCenter v-if="work.tab === 'outline'" />
      </div>

      <!-- 批注栏收起后的右缘细轨：点击重新展开（仅正文页显示，与批注栏同条件） -->
      <button
        v-if="!ui.focusMode && !ui.readMode && !modulePopped && work.tab === 'chapters' && !ui.rightPanelOpen"
        class="rp-rail"
        title="展开批注栏"
        @click="ui.setPref('rightPanelOpen', true)"
      >
        <span class="rp-rail-text">批注</span>
      </button>

      <button v-if="narrowNotesOpen" type="button" class="ns-notes-scrim" aria-label="关闭批注栏" tabindex="-1" @click="narrowNotesOpen = false"></button>
      <RightPanel v-if="showNotes && (ui.rightPanelOpen || narrowNotesOpen)" v-show="ui.rightPanelOpen || narrowNotesOpen" :class="{ 'ns-notes-drawer': narrowNotesOpen }" aria-label="批注与资料" />

      <!-- 窄栏批注抽屉的关闭键：不能进 RightPanel（那里只加条件类名不改结构），锚在抽屉右上角 -->
      <button v-if="narrowNotesOpen" type="button" class="ns-notes-close" aria-label="关闭批注栏" title="关闭批注栏" @click="narrowNotesOpen = false">×</button>


      <!-- 非模态覆盖层：开合与拖宽不参与正文排版；隐藏时保留输入与生成状态。 -->
      <aside v-if="aiMounted && !nsPlugin" v-show="aiVisible" class="ai-dock" aria-label="恍然梦-浅眠" :style="{ width: 'min(' + ui.aiDrawerWidth + 'px, 100%)' }">
        <div class="ai-dock-resizer" title="拖拽调整恍然梦宽度（双击恢复默认）" @mousedown="startAiResize" @dblclick="resetAiWidth"></div>
        <div class="ai-drawer-head">
          <span class="ai-drawer-name serif">恍然梦-浅眠</span>
          <div style="flex: 1"></div>
          <NButton size="tiny" quaternary title="拆出为独立窗口（可与其他模块并排对照）" @click="onSplit('ai')"><OIcon name="split" :size="13" /></NButton>
          <NButton size="tiny" quaternary title="收起恍然梦" @click="ui.aiDrawerOpen = false"><OIcon name="close" :size="13" /></NButton>
        </div>
        <div class="ai-drawer-body" style="padding:0;overflow:hidden">
          <AiAssistantPanel />
        </div>
      </aside>
    </div>

    <!-- 关系链接悬浮预览窗（全局唯一，悬停关系链接标签 / 纯文本令牌时展示目标内容） -->
    <DLinkPopover />
  </div>
</template>

<style scoped>
.shared-editor-host{display:flex;flex:1;min-height:0;min-width:0;flex-direction:column}
.wb-body { position: relative; min-width: 0; }
.ai-dock {
  --agent-header-color: #896e4e;
  position: absolute;
  top: 0;
  bottom: 0;
  right: 0;
  z-index: 20;
  max-width: 100%;
  display: flex;
  flex-direction: column;
  min-width: 0;
  background: var(--bg, var(--bg-panel));
  border-left: 1px solid var(--border-strong, var(--border));
  box-shadow: -8px 0 22px rgba(20, 16, 8, 0.06);
}
.ai-dock .ai-drawer-name { color: var(--agent-header-color); font-size: 16px; }
.ai-dock-resizer {
  position: absolute;
  left: -4px;
  top: 0;
  bottom: 0;
  width: 8px;
  cursor: col-resize;
  z-index: 5;
}
.ai-dock-resizer:hover {
  background: color-mix(in srgb, var(--accent) 35%, transparent);
}
.ai-drawer-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 9px 12px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-panel);
  flex: none;
}
.ai-drawer-name {
  font-size: 14px;
  font-weight: 700;
  color: var(--ikb);
}
.ai-drawer-sub {
  font-family: var(--g-disp, serif);
  font-size: 8px;
  letter-spacing: 0.24em;
  color: var(--text-dim);
  text-transform: uppercase;
  font-weight: 600;
}
.ai-drawer-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 8px 10px;
}
/* 批注栏收起后的右缘细轨：竖排文字，悬停亮起，点击重新展开 */
.rp-rail {
  flex: none;
  align-self: stretch;
  width: 20px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 7px;
  padding: 12px 0 10px;
  border: none;
  border-left: 1px solid var(--border);
  background: var(--bg-panel);
  color: var(--text-dim);
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.rp-rail:hover {
  background: color-mix(in srgb, var(--accent, #8c6f4e) 10%, var(--bg-panel));
  color: var(--text);
}
.rp-rail-caret {
  transform: rotate(180deg);
}
.rp-rail-text {
  writing-mode: vertical-lr;
  font-size: 11px;
  letter-spacing: 4px;
  user-select: none;
}
</style>

<style src="../styles/skins/latent-studio.css"></style>
