<script setup>
/* 功能面板窗口宿主（9.2-W5）：面板窗口 = 完整功能界面（侧栏 + 正文区，章节含右栏），
 * 与主窗口同一套组件零改动复用，可在面板内自由切换条目。
 * 按 ?panel=<type>:<workId>:<entityId> 打开作品并预选中实体；
 * 章节/人物/灵感的实体锁随面板当前选中迁移（panelSetEntity），主窗口占位实时跟随。 */
import { computed, ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { NButton } from 'naive-ui'
import OIcon from './OIcon.vue'
import { useWorkStore } from '../stores/work'
import { useUiStore } from '../stores/ui'
import { resolveSkin } from '../skins/registry'
import { autosave, startAutosave } from '../services/autosave'
import { panelSetEntity } from '../services/panelwindows'
import { mountFlowBackdrop } from '../services/latent/flow.js'
import { paletteOf, hashString } from '../services/latent/palette.js'
import ChapterTree from './ChapterTree.vue'
import OutlineSidebar from './OutlineSidebar.vue'
import EditorPane from './EditorPane.vue'
import OutlineCenter from './OutlineCenter.vue'
import OutlineTopbar from './outline/OutlineTopbar.vue'
import CharactersWorkspace from './characters/CharactersWorkspace.vue'
import LoreWorkspace from './lore/LoreWorkspace.vue'
import SnippetsWorkspace from './snippets/SnippetsWorkspace.vue'
import RightPanel from './RightPanel.vue'
import WritingSidePanels from './writing-layout/WritingSidePanels.vue'
import DLinkPopover from './DLinkPopover.vue'
import RevisionsModal from './RevisionsModal.vue'
import SettingsWindow from './SettingsWindow.vue'
import WritingStatsEntry from './stats/WritingStatsEntry.vue'
import MubuTagPanel from './MubuTagPanel.vue'
import LoreRelationPanel from './LoreRelationPanel.vue'
import AiAssistantPanel from './ai/AiAssistantPanel.vue'
import { openSettings as openSettingsEntry } from '../services/settings-entry.js'
const nsPlugin = __NS_PLUGIN__
/* 面板窗口里的「设置」也走统一入口：桌面版另开设置面板窗口，开不了时才退回就地视图 */
function outlineNavigate(key){if(key==='shelf')return flushAndClose();if(key==='settings')return openSettingsEntry(ui);spec.value={...spec.value,type:key==='chapters'?'chapter':key};work.tab=key}
import PresetWindow from './ai/PresetWindow.vue'
import StudioWorkspace from './StudioWorkspace.vue'
import TaskLauncher from './ai/TaskLauncher.vue'

const work = useWorkStore()
const ui = useUiStore()
const shell = ref(null)
/* 面板窗口也要把皮肤写到 body，皮肤样式统一以 body[data-skin] 为作用域 */
watch(
  () => resolveSkin(ui.skin, 'panel').id,
  (id) => { document.body.dataset.skin = id },
  { immediate: true }
)

const spec = ref(null) // { type, workId, entityId }
const writingLayout = computed(() => spec.value?.type === 'chapter')
const status = ref('loading') // loading | ready | error
const errMsg = ref('')

const PANEL_TITLES = { chapter: '正文', outline: '大纲', characters: '人物', lore: '设定', snippets: '灵感', settings: '设置', 'ai-presets': '恍然梦预设', ai: '恍然梦', agent: '恍然梦创作台' }
const ENTITY_SEL = {
  chapter: () => work.activeChapter?.title,
  characters: () => work.activeCharacter?.name,
  snippets: () => work.activeSnippet?.title
}
const panelTitle = computed(() => {
  const label = PANEL_TITLES[spec.value?.type] || '面板'
  const ent = ENTITY_SEL[spec.value?.type]?.()
  return ent ? `${label} · ${ent}` : label
})

const badgeClass = computed(() => (ui.autosave.saving ? 'saving' : ui.autosave.pending ? 'dirty' : ''))
const badgeText = computed(() => {
  if (ui.autosave.saving) return '保存中…'
  if (ui.autosave.pending) return `${ui.autosave.pending} 处待保存`
  return ui.autosave.lastSavedAt ? '已保存' : '自动保存就绪'
})

function closePanel() {
  window.native?.panelCloseSelf()
}
async function flushAndClose() {
  try {
    await autosave.flushAll()
  } finally {
    closePanel()
  }
}

/* 侧栏宽度拖拽（与主窗口同一 appconfig 记忆） */
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

function parseSpec() {
  const raw = new URLSearchParams(location.search).get('panel')
  if (!raw) return null
  const [type = '', workId = '', entityId = ''] = raw.split(':')
  if (!type || !workId) return null
  return { type, workId, entityId }
}

async function boot() {
  const s = parseSpec()
  if (!s || !PANEL_TITLES[s.type]) {
    status.value = 'error'
    errMsg.value = '面板参数缺失或无效'
    return
  }
  spec.value = s
  /* 设置窗口与全局预设窗口：无作品上下文，不打开作品 */
  if (s.type === 'settings' || s.type === 'ai-presets' && s.workId === '__global__') {
    status.value = 'ready'
    document.title = '小说工坊 · ' + (PANEL_TITLES[s.type] || '面板')
    return
  }
  try {
    await work.open(s.workId, { chapterId: s.type === 'chapter' ? s.entityId : null, restorePosition: false })
  } catch (e) {
    status.value = 'error'
    errMsg.value = '作品打开失败：' + (e?.message || e)
    return
  }
  // 完整界面：切到对应页签并预选中拆窗时的实体（恍然梦无页签，仅携带作品上下文）
  const tabOf = { chapter: 'chapters', outline: 'outline', characters: 'characters', lore: 'lore', snippets: 'snippets' }
  if (tabOf[s.type]) work.tab = tabOf[s.type]
  if(s.type==='agent')ui.workbenchMode='agent'
  if (s.type === 'ai-presets' && s.entityId) work.selChapterId = s.entityId
  if (s.type === 'chapter' && s.entityId && work.liveChapters.some(c=>c.id===s.entityId)) {
    work.selChapterId = s.entityId
    work.selVolumeId = work.activeChapter?.volumeId || work.selVolumeId
  }
  if (s.type === 'outline') {
    work.outlineView = 'canvas'
    if (s.entityId) work.selOlnodeId = s.entityId
  }
  if (s.type === 'characters') work.selCharacterId = s.entityId || work.liveCharacters[0]?.id || null
  if (s.type === 'lore' && s.entityId) ui.mubuSelectedId = s.entityId
  if (s.type === 'snippets') work.selSnippetId = s.entityId || work.liveSnippets[0]?.id || null
  status.value = 'ready'
  document.title = `小说工坊 · ${work.work?.title || ''} · ${panelTitle.value}`
}

/* 实体锁跟随面板当前选中（章节/人物/灵感；大纲/设定为整模块锁无需迁移） */
const SEL_OF = {
  chapter: () => work.selChapterId,
  characters: () => work.selCharacterId,
  snippets: () => work.selSnippetId
}
watch(
  () => (spec.value && SEL_OF[spec.value.type] ? SEL_OF[spec.value.type]() : null),
  (id) => {
    if (id && spec.value) panelSetEntity(work, spec.value.type, id)
  }
)

/* ---------- 流动背板：只做挂载、调色与销毁，不参与排版 ---------- */
const flowCanvas = ref(null)
let flow = null

/* 画布按 CSS 像素分档（与书架的 simWidth/maxEdge 同档位）：拆窗常有窄窗，没必要按整块屏烧算力 */
function flowWidth() {
  return flowCanvas.value?.clientWidth || window.innerWidth || 0
}
/* 验收脚本读这个钩子：没有实例时给一份空壳，形状与 Workbench.vue:296 / LatentShelf 的 latentStats 逐字对齐；
 * backend 归一到契约的 gpu|cpu（'css' 不是合法值，旧验收脚本会据此判失败） */
function flowStats() {
  return flow && typeof flow.stats === 'function'
    ? flow.stats()
    : { backend: 'cpu', renderer: '', avgFrameMs: 0, scale: 1, pixels: [0, 0], time: 0, noise: '', shaderLog: '' }
}
/* 没有作品的面板（设置 / 恍然梦 / 创作台）不推调色：引擎留着 DEFAULT_PALETTE，不算错误 */
function paintFlowPalette() {
  const current = work.work
  if (!current || !flow?.setPalette) return
  flow.setPalette(paletteOf(current), { duration: 600, seed: (hashString(current.id) % 997) / 997 })
}
/* 画布在 v-if 分支里：onMounted 时它还没渲染，只能由 canvas ref 出现后再挂引擎 */
function mountEngine() {
  const canvas = flowCanvas.value
  if (!canvas || flow) return
  const width = flowWidth()
  try {
    flow = mountFlowBackdrop(canvas, {
      reducedMotion: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true,
      simWidth: width < 560 ? 320 : width < 900 ? 480 : 640,
      maxEdge: width < 900 ? 1280 : 1600,
      /* 上下文丢失后引擎会换 CPU 底并清空调色，这里把作品的色补回去 */
      onFallback: () => paintFlowPalette()
    })
  } catch { flow = null }
  paintFlowPalette()
}
function destroyEngine() {
  try { flow?.dispose?.() } catch { /* 已销毁 */ }
  flow = null
}
function mountFlow() {
  /* 旧验收脚本读 __nsStudioBackdrop：拆窗里没有 Workbench，这里补上同一个函数 */
  window.__nsFlowBackdrop = flowStats
  window.__nsStudioBackdrop = flowStats
  mountEngine()
}
function unmountFlow() {
  destroyEngine()
  delete window.__nsFlowBackdrop
  delete window.__nsStudioBackdrop
}
/* 拆窗可被拖拽改大小，画布尺寸只跟窗口走 */
function onFlowResize() {
  try { flow?.resize?.() } catch { /* 已销毁 */ }
}

/* 作品在 boot() 里异步打开，色只能等 id 落地后再推 */
watch(() => work.work?.id, () => paintFlowPalette())
/* 设置 / 预设 / 创作台窗口走的是无背景层的分支，画布一消失就把上下文放掉，别攒 GPU 上下文 */
watch(flowCanvas, (el) => (el ? mountEngine() : destroyEngine()))

onMounted(() => {
  startAutosave()
  boot()
  mountFlow()
  window.addEventListener('resize', onFlowResize)
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', onFlowResize)
  unmountFlow()
  autosave.flushAll()
})
</script>

<template>
  <div ref="shell" class="app-root panel-host latent-studio" :data-flow="'on'" :class="['theme-' + ui.theme,{ 'is-focus': writingLayout && ui.focusMode, 'is-reading': writingLayout && ui.readMode, 'outline-strict': nsPlugin && spec?.type === 'outline' }]" :data-skin="resolveSkin(ui.skin, 'panel').id" :data-module="work.tab" :style="ui.rootStyle" style="height: 100vh; display: flex; flex-direction: column">
    <div v-if="status === 'error'" class="empty-shelf" style="padding-top: 18vh">
      <div class="big">面板无法打开</div>
      <p>{{ errMsg }}</p>
      <NButton type="primary" @click="closePanel">关闭面板</NButton>
    </div>
    <template v-else-if="status === 'ready'">
      <!-- 设置窗口：独立布局（左导航 + 右内容），无作品顶栏 -->
      <PresetWindow v-if="spec.type === 'ai-presets'" style="flex: 1; min-height: 0" />
      <SettingsWindow v-else-if="spec.type === 'settings'" style="flex: 1; min-height: 0" />
      <StudioWorkspace v-else-if="spec.type==='agent'" />
      <template v-else>
        <!-- 与主窗口同构的背景层：.st-backdrop-wrap 必须是 .latent-studio 的直接子项（§15 的脱流规则按这个层级写） -->
        <div class="st-backdrop-wrap"><canvas ref="flowCanvas" class="st-backdrop"></canvas><div class="st-layer dots"></div><div class="st-layer vignette"></div><div class="st-layer grain"></div></div>
        <OutlineTopbar v-if="nsPlugin && spec.type==='outline'" detached @navigate="outlineNavigate" @close="flushAndClose"/>
        <div v-else class="panel-topbar">
          <span class="serif" style="font-weight: 700">{{ work.work?.title }} · {{ panelTitle }}</span>
          <span class="save-badge">
            <span class="save-dot" :class="badgeClass"></span>
            {{ badgeText }}
          </span>
          <div style="flex: 1"></div>
          <WritingStatsEntry v-if="nsPlugin" />
          <NButton size="small" @click="flushAndClose">保存并关闭</NButton>
          <NButton size="small" quaternary @click="closePanel"><OIcon name="close" :size="13" /></NButton>
        </div>
        <!-- 恍然梦窗口：无侧栏与中央区，全高 AI 界面 -->
        <div v-if="spec.type === 'ai'" class="ai-win">
          <AiAssistantPanel v-if="!nsPlugin" />
        </div>
        <div v-if="spec.type !== 'ai'" class="panel-body" :class="{ 'writing-layout-host': writingLayout }">
          <WritingSidePanels v-if="writingLayout && !ui.focusMode && !ui.readMode" directory :notes="!!work.activeChapter"
            directory-id="writing-directory" notes-id="writing-notes">
            <template #directory>
              <div class="side-panel" aria-label="章节栏">
                <ChapterTree in-panel collapsible-panel @read="ui.readMode=true" @collapse="ui.setPref('sidePanelOpen', false)" />
              </div>
            </template>
            <template #notes><RightPanel aria-label="批注与资料" /></template>
          </WritingSidePanels>
          <div v-if="!writingLayout && !(nsPlugin && spec.type === 'outline') && spec.type !== 'lore' && spec.type !== 'characters' && spec.type !== 'snippets'" v-show="(spec.type !== 'outline' || ui.outlineSideOpen) && (spec.type !== 'chapter' || (!ui.readMode && !ui.focusMode))" class="side-panel" aria-label="目录与资料" :style="{ width: ui.sideWidth + 'px' }">
            <ChapterTree v-if="spec.type === 'chapter'" in-panel @read="ui.readMode=true" />
            <OutlineSidebar v-else-if="spec.type === 'outline'" />
          </div>
          <div v-if="!writingLayout && !(nsPlugin && spec.type === 'outline') && spec.type !== 'lore' && spec.type !== 'characters' && spec.type !== 'snippets'" v-show="(spec.type !== 'outline' || ui.outlineSideOpen) && (spec.type !== 'chapter' || (!ui.readMode && !ui.focusMode))" class="side-resizer" title="拖拽调整侧栏宽度（双击恢复默认）" @mousedown="startSideResize" @dblclick="ui.setPref('sideWidth', 252)"></div>
          <button
            v-if="!nsPlugin && spec.type === 'outline' && !ui.outlineSideOpen"
            class="ol-side-rail"
            type="button"
            title="展开故事结构"
            aria-label="展开故事结构"
            @click="ui.setPref('outlineSideOpen', true)"
          >
            <OIcon name="caret-right" :size="12" />
            <span class="rail-text">故事结构</span>
          </button>
          <!-- 设定面板：委派给 LoreWorkspace 自带的面板矩阵外壳（不再套 .center-pane 与外置侧栏） -->
          <LoreWorkspace v-if="spec.type === 'lore'" class="lore-shell-host" />
          <!-- 人物面板：同样委派给 CharactersWorkspace 自带的面板矩阵外壳 -->
          <CharactersWorkspace v-else-if="spec.type === 'characters'" class="char-shell-host" />
          <!-- 灵感：自带导航列 + 手札/拼板 + 片段整理，不再借用外置 .side-panel 与 .center-pane -->
          <SnippetsWorkspace v-else-if="spec.type === 'snippets'" class="snippets-shell-host" />
          <div v-else class="center-pane paper-texture">
            <EditorPane v-if="spec.type === 'chapter'" />
            <OutlineCenter v-else-if="spec.type === 'outline'" style="flex: 1; min-height: 0" />
          </div>
        </div>
        <DLinkPopover />
        <RevisionsModal />
        <MubuTagPanel />
        <LoreRelationPanel />
      </template>
    </template>
    <div v-else class="empty-shelf" style="padding-top: 20vh">
      <div class="big">正在打开面板…</div>
    </div>
  </div>
</template>

<style scoped>
.panel-topbar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 14px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-panel);
  flex: none;
}
.panel-body {
  flex: 1;
  min-height: 0;
  display: flex;
}
.ai-win {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  padding: 0;
}
</style>
