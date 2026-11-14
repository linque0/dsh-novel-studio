<!-- 设定工作区外壳（面板矩阵，三单共用）——结构与度量对照设计稿 docs/前端美化/设定-融合总稿-20261105/：
     nav 列 | 16px 分隔 | [B: 同层列 | 16px] main | [C: 16px | 摘要列]；页头住在 main pane 内（原型 fusion-head）。
     三列各自可收起成 40px 竖排细轨（nav 的细轨由 MubuTree 自己输出），列宽可拖拽/键盘调整并落库。
     状态唯一真源在 ui store：loreView / loreActiveId / loreMapMode / loreNavWidth… / loreNavClosed… / loreScope。
     ≤1099 不再有顶部移动栏：窄档默认是完整正文页，「条目列表」入口在 LoreDetail 的
     return-tools 里（仅窄档渲染），点它才切到 list 屏；宽档不渲染。
     A 条目编写（MubuView：整棵森林）/ B 设定详情（LoreEntryList + LoreDetail）/ C 视觉导图（LoreTreeMap + LoreInspector / LoreGalaxy）。 -->
<script setup>
import '../../styles/lore-free-tree.css'
import { autosave } from '../../services/autosave'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import OIcon from '../OIcon.vue'
import MubuView from '../MubuView.vue'
import MubuTree from '../MubuTree.vue'
import LoreDetail from '../LoreDetail.vue'
import { resolveLoreFocus } from '../../services/lore-core.js'
import { parseTarget, targetById } from '../../services/doublelinks'
import LoreReferences from './LoreReferences.vue'
import LorePeek from './LorePeek.vue'
import LoreHead from './LoreHead.vue'
import LoreEntryList from '../LoreEntryList.vue'
import LoreGalaxy from './planets/LoreGalaxy.vue'
import LoreTreeMap from './LoreTreeMap.vue'
import LoreInspector from './LoreInspector.vue'
import LoreDivider from './LoreDivider.vue'
import { loreWidths } from './lore-layout.js'
import { jumpTo } from '../../services/doublelinks'
import { useWorkStore } from '../../stores/work'
import { useUiStore } from '../../stores/ui'

const work = useWorkStore()
const ui = useUiStore()

const mubu = ref(null) // A 视图实例：新建 / 定位 / 滚动
const treeMap = ref(null) // C 层级导图实例：缩放 / 适应 / 聚焦
const drawer = ref(false) // ≤1099：nav 变抽屉（原型 drawer）
const screen = ref('main') // ≤1099 两屏流程：main | list | insp（宽档不生效）
const innerWidth = ref(typeof window === 'undefined' ? 1440 : window.innerWidth)

/* ---------- 面板矩阵的列宽（纯函数算，结果写成 CSS 变量） ---------- */
const widths = computed(() => loreWidths({
  view: ui.loreView === 'map' && ui.loreMapMode === 'relations' ? 'write' : ui.loreView,
  innerWidth: innerWidth.value,
  navWidth: ui.loreNavWidth,
  listWidth: ui.loreListWidth,
  detailWidth: ui.loreDetailWidth,
  navClosed: ui.loreNavClosed,
  listClosed: ui.loreListClosed,
  detailClosed: ui.loreDetailClosed
}))
const shellStyle = computed(() => ({
  '--lore-nav-w': widths.value.nav + 'px',
  '--lore-list-w': widths.value.list + 'px',
  '--lore-detail-w': widths.value.detail + 'px'
}))
const narrow = computed(() => widths.value.narrow)
function onResize() {
  innerWidth.value = window.innerWidth
  if (!narrow.value) drawer.value = false
}
/** 面包屑里的「世界设定」：窄档开抽屉，宽档确保 nav 列展开 */
function openNav() {
  if (narrow.value) drawer.value = true
  else if (ui.loreNavClosed) ui.setPref('loreNavClosed', false)
}
function openList() {
  ui.setPref('loreListClosed', false)
}
function openInspector() {
  ui.setPref('loreDetailClosed', false)
}
/** 窄档三屏互切：main（阅读区 / 导图）· list（同级条目）· insp（条目摘要）；宽档不产生任何影响 */
function toScreen(next) {
  screen.value = next
}
/** 切视图时重置两屏：三视图一律从主屏起步（detail → 正文页、map → 导图页、write → 编写页）。
    旧实现让窄档的 detail 默认停在 'list'，main pane 被整块 display:none，
    页头 / 正文 / 关联关系 / 子条目 / 页脚全部离屏（用户报的「设定详情界面不全」）。 */
function resetScreen() {
  screen.value = 'main'
}
/** 同级条目列点条目：列内既有逻辑（写 loreActiveId）之后，窄档回到阅读区 */
function pickEntry(id) {
  if (id) ui.navigateLore({ activeId: id, selectedId: id })
  syncSet(id)
  if (narrow.value) screen.value = 'main'
}

/* ---------- 头部：页头已抽成 LoreHead.vue（只发事件），范围切换仍由外壳落库 ---------- */
const node = computed(() => (ui.loreActiveId ? work.mubu.find((n) => n.id === ui.loreActiveId && !n.deletedAt) || null : null))
function toggleScope() {
  ui.navigateLore({ rootId: null, rootPath: [], scope: ui.loreScope === 'all' ? 'set' : 'all' })
}
/** 进详情时同步当前设定集：否则导航高亮的是 A 集、同级条目列列的是 B 集 */
function syncSet(id) {
  const root = id ? work.mubuRootOf(id) : null
  if (root && root.id !== work.mubuSetId) work.setMubuSet(root.id)
}

/* ---------- 视图切换（保留当前条目；返回恢复视图与滚动位置） ---------- */
function fallbackId() {
  return ui.loreActiveId || ui.mubuSelectedId || work.mubuChildren(work.currentMubuRoot()?.id || null)[0]?.id || null
}
function captureScroll() {
  return ui.loreView === 'write' ? mubu.value?.getScroll() ?? 0 : 0
}
function switchView(next) {
  if (next === ui.loreView) return
  const id = next === 'detail' ? (ui.loreRootId || fallbackId()) : undefined
  if (next === 'detail' && !id) return
  const scroll = captureScroll()
  ui.setLoreView(next, { id, scroll })
}
async function back() {
  const prev = ui.loreBack()
  await nextTick()
  if (ui.loreView === 'write' && prev && prev.position?.scroll != null) mubu.value?.setScroll(prev.position.scroll)
}
function openDetail(id) {
  if (!id) return
  ui.setLoreView('detail', { id, scroll: captureScroll() })
  syncSet(id)
}
/** B「查看导图」→ C 的层级导图（关系网络是 C 里的另一个模式，不能顺着上一个模式走） */
function openMap() {
  ui.setLoreMapMode('hierarchy')
  switchView('map')
}
/** B/C → A：切回编写并滚动定位（先切视图，再让 MubuView 闪烁，隐藏态测不到位置） */
async function locate(id) {
  const target = id || ui.loreActiveId
  if (!target) return
  const parent = work.mubu.find(n => n.id === target)?.parentId
  ui.navigateLore({ view: 'write', rootId: parent || target, rootPath: work.mubuPath(parent || target).map(n => n.id), activeId: target, selectedId: target, scope: 'set' })
  syncSet(target)
  await nextTick()
  mubu.value?.focusNode(target)
}
function newEntry() {
  mubu.value?.headAdd()
}
function clearFilter() {
  ui.mubuQuery = ''
}
function selectNode(id) {
  if (!id) return
  ui.loreActiveId = id
  const root = work.mubuRootOf(id)
  if (root) work.setMubuSet(root.id)
}

/* ---------- C 视觉导图 ---------- */
const mapMode = computed(() => ui.loreMapMode)
const mapSetId = computed(() => ui.loreRootId || work.currentMubuRoot()?.id || null)
/* 层级导图的范围：'all' 画全部设定集（多根），否则只画当前集 */
const mapSetIds = computed(() => (ui.loreScope === 'all' ? work.mubuRoots().map((r) => r.id) : [work.currentMubuRoot()?.id].filter(Boolean)))
const mapContext = computed(() => ui.loreScope === 'all' ? '全部设定 · 层级' : '条目层级')
const zoomPercent = computed(() => Math.round((Number(treeMap.value?.zoom) || 1) * 100))
function setMapMode(mode) {
  resetScreen()
  ui.setLoreMapMode(mode)
}
function openRelPanel(id) {
  if (!id) return
  ui.loreRelationPanel = { kind: 'mubu', id, x: Math.max(8, window.innerWidth / 2 - 170), y: 110 }
}
function openGalaxyTarget(target) {
  const resolved = targetById(target.kind, target.id)
  if (!resolved) return
  jumpTo(resolved)
}

/* ---------- 会话恢复：按作品记视图/条目/模式（刷新后回来还是走到的位置） ---------- */
let saveTimer = null
const ownerWorkId = work.work?.id
function schedulePersist() {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => ui.persistLoreState(ownerWorkId), 300)
}
watch(() => [ui.loreView, ui.loreRootId, ui.loreActiveId, ui.mubuSelectedId, ui.loreScope, ui.mubuQuery, ui.loreMapMode, ui.loreNavFold, ui.loreLinksOpen, ui.loreReferenceTab, ui.lorePositions], schedulePersist, { deep: true })
watch(() => [ui.loreRootId, ui.loreRestoreTick], () => { drawer.value = false; screen.value = 'main'; const id = ui.loreRootId || ui.loreActiveId; if (id) syncSet(id) })
watch(() => work.mubu.map(n => [n.id,n.parentId,n.deletedAt].join(':')).join('|'), () => {
  const next = resolveLoreFocus(work.mubu, ui.loreRootId, ui.loreRootPath, work.work?.id)
  if (next !== ui.loreRootId) ui.navigateLore({ rootId: next, rootPath: work.mubuPath(next).map(n => n.id), activeId: next, selectedId: next, scope: next ? 'set' : 'all' }, { replace: true })
  else if (next) ui.loreRootPath = work.mubuPath(next).map(n => n.id)
})
/* 换视图即收抽屉并重置两屏：抽屉里点条目后主区就不该再被遮 */
watch(() => ui.loreView, () => {
  drawer.value = false
  resetScreen()
})
/** 窄档：点常驻细轨（含 MubuTree 输出的 .lore-rail / data-rail）→ 开抽屉；
    抽屉里点设定集 / 条目（原型 .category / .nav-entry）后收抽屉；展开箭头、搜索不关。
    宽档不参与：宽档点 .lore-rail 仍由 MubuTree 自己 loreNavClosed=false 展开列。 */
function onNavClick(e) {
  if (!narrow.value) return
  if (e.target.closest('.lore-rail')) {
    drawer.value = true
    return
  }
  if (!drawer.value) return
  if (e.target.closest('.category, .nav-entry, .lore-nav-node')) drawer.value = false
}
function onKeydown(e) {
  if (e.isComposing) return
  if (e.altKey && ['ArrowLeft','ArrowRight'].includes(e.key)) { e.preventDefault(); e.key === 'ArrowLeft' ? ui.loreBack() : ui.loreNext(); return }
  if (e.key === 'Escape' && ui.lorePeek) { ui.lorePeek = null; return }
  if (e.key === 'Escape' && ui.loreLinksOpen && narrow.value) { ui.loreLinksOpen = false; return }
  if (e.key === 'Escape' && drawer.value) {
    drawer.value = false
    e.preventDefault()
  }
}
onMounted(async () => {
  window.addEventListener('resize', onResize)
  window.addEventListener('keydown', onKeydown)
  const requested = ui.loreWorkId !== work.work?.id && ui.loreRootId && work.liveMubu().some(n => n.id === ui.loreRootId) ? ui.loreRootId : null
  await ui.restoreLoreState(work.work?.id)
  if (requested) ui.focusLoreNode(requested, work.mubuPath(requested))
  const resolved = resolveLoreFocus(work.mubu, ui.loreRootId, ui.loreRootPath, work.work?.id)
  if (resolved !== ui.loreRootId) { ui.loreRootId = resolved; ui.loreScope = resolved ? 'set' : 'all' }
  if (!ui.loreNavSeeded) { const keep = new Set(work.mubuPath(ui.loreRootId || work.mubuSetId).map(n => n.id)); ui.loreNavFold = work.liveMubu().filter(n => !keep.has(n.id) && work.mubuChildren(n.id).length).map(n => n.id); ui.loreNavSeeded = true }
  nextTick(() => mubu.value?.restorePosition())
  /* 恢复的条目可能属于别的作品或被删：无效就退回条目编写 */
  const id = ui.loreActiveId
  if (id && !work.mubu.some((n) => n.id === id && !n.deletedAt)) {
    ui.loreActiveId = null
    if (ui.loreView !== 'write') ui.loreView = 'write'
  }
  if (ui.loreView === 'detail' && !node.value) {
    ui.loreActiveId = fallbackId()
    if (!ui.loreActiveId) ui.loreView = 'write'
  }
  resetScreen()
  // Default categories are seeded only for a new work, never restored on entry.
})
onBeforeUnmount(() => {
  mubu.value?.rememberPosition(); void ui.persistLoreState(ownerWorkId)
  clearTimeout(saveTimer)
  window.removeEventListener('resize', onResize)
  window.removeEventListener('keydown', onKeydown)
})
function onLinkClick(e) {
  const link = e.target.closest?.('[data-dl-target]')
  if (!link) return
  const t = parseTarget(link.dataset.dlTarget); if (!t) return
  e.preventDefault(); e.stopPropagation()
  const target = targetById(t.kind, t.id)
  if ((e.ctrlKey || e.metaKey) && target) jumpTo(target)
  else ui.lorePeek = { ...t, title: target?.title || link.dataset.dlTitle || link.textContent }
}
function rememberReading(e) {
  if (ui.loreView === 'write' || !e.target.matches?.('.lore-detail-reader,.lore-detail-main')) return
  ui.lorePositions[ui.lorePositionKey()] = { scroll: e.target.scrollTop }
}
watch(() => ui.loreRestoreTick, () => nextTick(() => {
  if (ui.loreView === 'write') return
  const el = document.querySelector('.lore-detail-reader'), position = ui.lorePositions[ui.lorePositionKey()]
  if (el && position) el.scrollTop = position.scroll || 0
}))
</script>

<template>
  <div class="lore-shell-wrap" @click.capture="onLinkClick" @scroll.capture="rememberReading">
    <div class="lore-shell" :data-view="ui.loreView" :data-map-mode="ui.loreMapMode" :data-screen="screen" :data-drawer="drawer ? 'nav' : null" :data-narrow="narrow ? 'true' : null" :style="shellStyle">
      <aside class="lore-pane" data-pane="nav" :data-closed="ui.loreNavClosed ? 'true' : null" @click="onNavClick">
        <MubuTree />
      </aside>
      <LoreDivider size="nav" />

      <template v-if="ui.loreView === 'detail'">
        <aside class="lore-pane" data-pane="list" :data-closed="ui.loreListClosed ? 'true' : null">
          <!-- 窄档两屏流程：列表屏独占一屏，必须自带页头（宽档不出现第二份） -->
          <LoreHead
            v-if="narrow && ui.loreView === 'detail' && screen === 'list'"
            compact
            :narrow="narrow"
            :nav-open="drawer"
            @view="switchView"
            @scope="toggleScope"
            @new="newEntry"
            @clear-filter="clearFilter"
            @nav="openNav"
          />
          <LoreEntryList @pick="pickEntry" />
          <button class="lore-rail" data-rail="list" type="button" title="展开同级条目" aria-label="展开同级条目" @click="openList">
            <OIcon name="rows" :size="16" />
            <span>同级条目</span>
          </button>
        </aside>
        <LoreDivider size="list" />
      </template>

      <main class="lore-pane lore-main" data-pane="main">
        <!-- 页头：结构与类名在 LoreHead.vue（契约要求住在 main pane 内、是其直接子元素） -->
        <LoreHead
          :narrow="narrow"
          :nav-open="drawer"
          @view="switchView"
          @scope="toggleScope"
          @new="newEntry"
          @clear-filter="clearFilter"
          @nav="openNav"
          @position="mubu?.rememberPosition()"
        />

        <!-- A 条目编写：整棵森林（保留挂载，返回时滚动位置与选中态原样还在） -->
        <div v-show="ui.loreView === 'write'" class="lore-views">
          <div v-if="ui.autosave.error" class="lore-free-save-error" role="alert">保存失败，输入仍保留。<button @click="autosave.flushAll()">重试保存</button></div>
          <MubuView ref="mubu" />
        </div>

        <!-- B 设定详情：阅读区（同级条目列已在左侧独立 pane） -->
        <div v-if="ui.loreView === 'detail'" class="lore-views">
          <LoreDetail :can-back="ui.loreReturn.length > 0" :list-back="narrow" @back="back" @list="toScreen('list')" @locate="locate" @map="openMap" />
        </div>

        <!-- C 视觉导图：导图子条 + 图区 + 底部工具（摘要列在右侧独立 pane） -->
        <div v-if="ui.loreView === 'map'" class="lore-views lore-map-view">
          <div class="lore-map-subbar">
            <div class="lore-map-modes" role="tablist" aria-label="导图模式">
              <button type="button" role="tab" :class="{ on: mapMode === 'hierarchy' }" :aria-selected="mapMode === 'hierarchy'" @click="setMapMode('hierarchy')">层级导图</button>
              <button type="button" role="tab" :class="{ on: mapMode === 'relations' }" :aria-selected="mapMode === 'relations'" @click="setMapMode('relations')">关系星系</button>
            </div>
            <span v-if="mapMode === 'hierarchy'" class="lore-map-context">{{ mapContext }}</span>
            <button v-if="mapMode === 'hierarchy'" class="lore-mobile-back" type="button" @click="toScreen('insp')">摘要</button>
          </div>
          <div class="lore-map-stage">
            <LoreTreeMap
              v-if="mapMode === 'hierarchy'"
              ref="treeMap"
              :set-id="mapSetId"
              :set-ids="mapSetIds"
              :active-id="ui.loreActiveId"
              @select="selectNode"
              @open="openDetail"
            />
            <LoreGalaxy v-else @select="selectNode" @open-entry="openDetail"
              @open-target="openGalaxyTarget" @edit-relations="openRelPanel" />
          </div>
          <div v-if="mapMode === 'hierarchy'" class="lore-map-foot">
            <span class="lore-map-legend">
              <i />
              父子层级
              <span>点击圆点展开</span>
            </span>
            <div class="lore-zoom">
              <button type="button" title="缩小" @click="treeMap?.zoomOut()">−</button>
              <button type="button" title="恢复 100%" @click="treeMap?.zoomReset()">{{ zoomPercent }}%</button>
              <button type="button" title="放大" @click="treeMap?.zoomIn()">+</button>
              <i />
              <button type="button" title="适应当前内容" @click="treeMap?.fitAll()">适应</button>
              <button type="button" title="聚焦当前条目" @click="treeMap?.focusActive()">聚焦</button>
            </div>
          </div>
        </div>
        <LoreReferences v-if="ui.loreLinksOpen" :overlay="narrow || (ui.loreView !== 'write' && innerWidth < 1440)" />
      </main>
      <LorePeek @link-click="onLinkClick" />

      <template v-if="ui.loreView === 'map' && mapMode === 'hierarchy'">
        <LoreDivider size="detail" />
        <aside class="lore-pane" data-pane="detail" :data-closed="ui.loreDetailClosed ? 'true' : null">
          <LoreInspector @open="openDetail" @locate="locate" @back="toScreen('main')" />
          <button class="lore-rail" data-rail="detail" type="button" title="展开条目摘要" aria-label="展开条目摘要" @click="openInspector">
            <OIcon name="note" :size="16" />
            <span>条目摘要</span>
          </button>
        </aside>
      </template>

      <!-- ≤1099：nav 列变抽屉，遮罩盖住整个工作区 -->
      <button v-if="drawer" type="button" class="lore-scrim" aria-label="关闭设定目录" tabindex="-1" @click="drawer = false"></button>
    </div>
  </div>
</template>

<style scoped>
/* 面板矩阵的纵向容器：外壳原本是父级 flex 列的直接子项（.lore-shell 自带 flex:1），
   多隔一层后由本容器承担同一个 flex:1，继续让外壳撑满可用高度。 */
.lore-shell-wrap { display: flex; flex-direction: column; flex: 1; min-width: 0; min-height: 0; }
:global(.lore-shell[data-view='map'][data-map-mode='relations']) {
  grid-template-columns: var(--lore-nav-w, 220px) 16px minmax(0, 1fr);
}
</style>
