<!-- 人物工作区外壳（面板矩阵）：roster | 16 分隔 | main | 16 分隔 | context。
     结构与度量对照设计稿 docs/前端美化/人物-融合总稿-20261105/（app.mjs:17 两套默认栏宽、
     app.mjs:53 的列宽预算、studio.css 的 .workspace / .pane / .resize-handle / .rail / .side-pane / .scrim）。
     状态分工：只有外壳布局态用 provide('charShell') 下发，共 18 个键 ——
     view / narrow / screen / drawer / hasCharacter / closed / bar / setBar，
     以及 select / setView / openRoster / openContext / toggleRoster / toggleContext /
     openDrawer / closeDrawer / showContext / backToMain 十个动作。
     数据真源仍在 work（selCharacterId / charView / charFocusId / charFocusTick）
     与 ui（charQuery / charRole / charTag / charScope / charPrefs / charScroll）里，子组件直接用 store。 -->
<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, provide, reactive, ref, watch } from 'vue'
import OIcon from '../OIcon.vue'
import CharRoster from './CharRoster.vue'
import CharDossier from './CharDossier.vue'
import CharContext from './CharContext.vue'
import CharInspector from './CharInspector.vue'
import CharGraphPane from './CharGraphPane.vue'
import CharDivider from './CharDivider.vue'
import { charWidths, isNarrow } from './char-layout.js'
import { useWorkStore } from '../../stores/work'
import { useUiStore } from '../../stores/ui'

const work = useWorkStore()
const ui = useUiStore()
const shellEl = ref(null)
const innerWidth = ref(typeof window === 'undefined' ? 1440 : window.innerWidth)
const narrow = computed(() => isNarrow(innerWidth.value))
/* 视图派生：work.charView 的值域保持 'list' | 'graph'（services/doublelinks.js:255 依赖它），
   外壳内部只认 'profile' | 'graph'，两向映射在本文件收口。 */
const view = computed(() => (work.charView === 'graph' ? 'graph' : 'profile'))
const screen = ref('main') // 仅窄档：'main' | 'context'
const drawer = ref(false) // 仅窄档：名录抽屉
const hasCharacter = computed(() => !!work.activeCharacter)
const ownerWorkId = computed(() => work.work?.id || null)

/* 窄档顶部工具条（原型 .mobile-tools 的三段式）现在由外壳按 view + screen 派生：
   名录在窄档的唯一入口就是工具条左键，所以左右键的内容不允许子组件改写（D2/D3/D4 都调过 setBar，
   曾把左键挤成「‹ 人物卷宗」，结果 760/380 档打不开名录）。
   bar 仅保留一个 title 覆盖位；setBar 是兼容 no-op：接受参数、只认 title，left/right 一律忽略。 */
const bar = reactive({ title: '' })
function resetBar() {
  bar.title = ''
}
function setBar(patch = {}) {
  if (!patch || typeof patch !== 'object') return
  if (patch.title !== undefined) bar.title = typeof patch.title === 'string' ? patch.title : ''
}

/* ---------- 列宽（纯函数算，结果写成 CSS 变量） ---------- */
const prefs = computed(() => ui.charPrefs[view.value] || ui.charPrefs.profile)
const widths = computed(() => charWidths({
  view: view.value,
  innerWidth: innerWidth.value,
  left: prefs.value.left,
  right: prefs.value.right,
  leftClosed: prefs.value.leftClosed,
  rightClosed: prefs.value.rightClosed
}))
const shellStyle = computed(() => ({ '--char-left-w': widths.value.left + 'px', '--char-right-w': widths.value.right + 'px' }))
/* 两列的收起态（子组件据此写 aria-expanded 与「收起/展开」文案） */
const closed = computed(() => ({ left: prefs.value.leftClosed, right: prefs.value.rightClosed }))

function setClosed(side, closed) {
  const v = view.value
  const one = ui.charPrefs[v] || ui.charPrefs.profile
  void ui.setPref('charPrefs', { ...ui.charPrefs, [v]: { ...one, [side]: closed } })
}
/* 细轨（宽档展开列 / 窄档开抽屉）与窄档两屏切换 */
function openDrawer() { drawer.value = true }
function closeDrawer() { drawer.value = false }
function showContext() { screen.value = 'context' }
function backToMain() { screen.value = 'main' }
function openRoster() {
  if (narrow.value) return openDrawer()
  if (prefs.value.leftClosed) setClosed('leftClosed', false)
}
function openContext() {
  if (narrow.value) return showContext()
  if (prefs.value.rightClosed) setClosed('rightClosed', false)
}
/* 宽档的收起键（设计稿 .module-head 里 toggle-left / toggle-right 两个键：宽档显示、窄档隐藏）：
   宽档 = 列收成 40px 细轨；窄档 = 名录走抽屉、侧栏走两屏互切（窄档没有可收起的列）。 */
function toggleRoster() {
  if (narrow.value) return drawer.value ? closeDrawer() : openDrawer()
  setClosed('leftClosed', !prefs.value.leftClosed)
}
function toggleContext() {
  if (narrow.value) return screen.value === 'context' ? backToMain() : showContext()
  setClosed('rightClosed', !prefs.value.rightClosed)
}
function select(id) {
  if (!id) return
  work.selCharacterId = id
  if (narrow.value) { screen.value = 'main'; drawer.value = false }
}
function setView(next) {
  const target = next === 'graph' ? 'graph' : 'list'
  if (work.charView !== target) work.setCharView(target)
  screen.value = 'main'
  drawer.value = false
  /* 切到关系剧场即以当前人物为定位中心（work.charFocusTick 是关系剧场的定位信号） */
  if (target === 'graph' && work.selCharacterId) {
    work.charFocusId = work.selCharacterId
    work.charFocusTick++
  }
}
provide('charShell', { view, narrow, screen, drawer, hasCharacter, closed, bar, setBar, select, setView, openRoster, openContext, toggleRoster, toggleContext, openDrawer, closeDrawer, showContext, backToMain })

/* ---------- 按作品持久化（ui.charstate:<workId>，250ms 防抖在 store 里） ---------- */
function persist(patch = {}) {
  if (!ownerWorkId.value) return
  ui.saveCharState(ownerWorkId.value, {
    view: view.value,
    query: ui.charQuery,
    role: ui.charRole,
    tag: ui.charTag,
    scope: ui.charScope,
    scroll: { ...ui.charScroll },
    ...patch
  })
}
watch(() => [view.value, ui.charQuery, ui.charRole, ui.charTag, ui.charScope], () => persist())
/* 切视图：重置工具条（上一条视图写进去的按钮不会带过来），并回到该视图上次的滚动位置 */
watch(view, () => { resetBar(); nextTick(restoreScroll) })
/* 窄档两屏互切与抽屉关闭后同理：每一屏各自记住自己的滚动位置 */
watch(screen, () => nextTick(restoreScroll))
watch(drawer, (open) => { if (!open) nextTick(restoreScroll) })
function onScroll(e) {
  const name = e.target?.dataset?.charScroll
  if (!name) return
  ui.charScroll[name] = e.target.scrollTop
  persist()
}
function restoreScroll() {
  shellEl.value?.querySelectorAll('[data-char-scroll]').forEach((el) => {
    const top = ui.charScroll[el.dataset.charScroll]
    if (top) el.scrollTop = top
  })
}

/* 工具条三段：主屏左键恒为「人物名录」（窄档唯一入口）、右键进第二屏；第二屏左键恒为返回、右键开名录 */
const barTitle = computed(() => bar.title || work.activeCharacter?.name || (view.value === 'graph' ? '关系剧场' : '人物工作区'))
const barLeft = computed(() => (screen.value === 'context'
  ? { label: '‹ ' + (view.value === 'graph' ? '关系剧场' : '人物卷宗'), act: backToMain }
  : { label: '人物名录', act: openDrawer }))
const barRight = computed(() => (screen.value === 'context'
  ? { label: '人物名录', act: openDrawer }
  : { label: view.value === 'graph' ? '人物档案' : '关系与设定', act: showContext }))

function onResize() {
  innerWidth.value = window.innerWidth
  if (!narrow.value) { drawer.value = false }
}
function onKeydown(e) {
  if (e.isComposing) return
  if (e.key === 'Escape' && drawer.value) { e.preventDefault(); drawer.value = false }
}
onMounted(async () => {
  window.addEventListener('resize', onResize)
  window.addEventListener('keydown', onKeydown)
  await ui.loadCharState(ownerWorkId.value)
  await nextTick()
  restoreScroll()
  /* 恢复的选中项可能已被删除或属于别的作品：退回名录首项，避免主区空转 */
  const list = work.liveCharacters
  if (!list.some((c) => c.id === work.selCharacterId)) work.selCharacterId = list[0]?.id || null
})
onBeforeUnmount(() => {
  persist()
  window.removeEventListener('resize', onResize)
  window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div
    ref="shellEl"
    class="char-shell"
    :data-view="view"
    :data-screen="screen"
    :data-drawer="drawer ? 'roster' : ''"
    :style="shellStyle"
    @scroll.capture="onScroll"
  >
    <div v-if="narrow" class="char-mobilebar">
      <button type="button" class="char-mobile-btn" @click="barLeft.act()">{{ barLeft.label }}</button>
      <span class="char-mobile-title">{{ barTitle }}</span>
      <button type="button" class="char-mobile-btn" @click="barRight.act()">{{ barRight.label }}</button>
    </div>

    <section class="char-pane" data-pane="roster" :data-closed="prefs.leftClosed ? 'true' : null">
      <CharRoster />
      <button class="char-rail" data-rail="roster" type="button" title="展开人物名录" aria-label="展开人物名录" @click="openRoster">
        <OIcon name="user" :size="16" />
        <span>人物名录</span>
      </button>
    </section>
    <CharDivider size="left" />

    <section class="char-pane" data-pane="main">
      <CharGraphPane v-if="view === 'graph'" />
      <CharDossier v-else />
    </section>
    <CharDivider size="right" />

    <section class="char-pane" data-pane="context" :data-closed="prefs.rightClosed ? 'true' : null">
      <CharInspector v-if="view === 'graph'" />
      <CharContext v-else />
      <button class="char-rail" data-rail="context" type="button" title="展开侧栏" aria-label="展开侧栏" @click="openContext">
        <OIcon name="rows" :size="16" />
        <span>{{ view === 'graph' ? '人物档案' : '人物关系' }}</span>
      </button>
    </section>

    <button v-if="drawer" type="button" class="char-scrim" aria-label="关闭人物名录" tabindex="-1" @click="closeDrawer"></button>
  </div>
</template>
