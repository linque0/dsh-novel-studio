<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { NConfigProvider, NMessageProvider, NDialogProvider, NButton, zhCN, dateZhCN, darkTheme } from 'naive-ui'
import { useDshOverrides } from '../plugin/dsh/theme.js'
import { useUiStore } from './stores/ui'
import { startAutosave } from './services/autosave'
import { installLibrarySync } from './services/library-sync'
import { openDbWithRetry } from './db/database'
import Bookshelf from './components/Bookshelf.vue'
import SettingsWorkspace from './components/settings/SettingsWorkspace.vue'
import StudioWorkspace from './components/StudioWorkspace.vue'
import GlobalSearch from './components/GlobalSearch.vue'
import ImportDialog from './components/ImportDialog.vue'
import ExportDialog from './components/ExportDialog.vue'
import HelpManual from './components/HelpManual.vue'
import RevisionsModal from './components/RevisionsModal.vue'
import TrashModal from './components/TrashModal.vue'
import WritingStatsDialog from './components/stats/WritingStatsDialog.vue'
import MubuTagPanel from './components/MubuTagPanel.vue'
import LoreRelationPanel from './components/LoreRelationPanel.vue'
import PrefBridge from './components/PrefBridge.vue'
import PanelHost from './components/PanelHost.vue'
import { installAppBus } from './services/appbus'
import { useShelfStore } from './stores/shelf'
import { installAiRuntime } from './services/ai/runtime'
import { useAiStore } from './stores/ai'
import { resolveSkin } from './skins/registry'

const ui = useUiStore()
const shelf = useShelfStore()

/* 跨窗口事件（偏好同步 / 书架刷新 / 恢复备份协议）：主窗口与面板窗口都在根组件装一次 */
installAppBus()

/* 功能面板窗口（9.2-W5）：URL 带 ?panel=<type>:<workId>:<entityId> 时渲染精简面板布局 */
const panelMode = new URLSearchParams(location.search).has('panel')
const settingsPanel = new URLSearchParams(location.search).get('panel')?.split(':')[0] === 'settings'
const prefsReady = ref(false)

const activeSkin = computed(() => resolveSkin(ui.skin, panelMode ? 'panel' : ui.view))
const naiveTheme = computed(() => (ui.theme === 'night' ? darkTheme : null))
/* naive 主题与覆盖色全部由 plugin/dsh/theme.js 提供，分皮肤的覆盖表已随皮肤删除；
 * 留一个空对象是模板里那条非插件分支的占位（本项目构建 __NS_PLUGIN__ 恒为 true）。 */
const overrides = {}
/* M1-C2：插件构建下 naive 主题跟 iframe 根上的 data-ns-dark 走（预览窗口与宿主同亮暗）；
 * 桌面版 __NS_PLUGIN__ 为 false，两个表达式原样落回 naiveTheme / overrides。 */
const nsPlugin = __NS_PLUGIN__
const dshThemeState = nsPlugin ? useDshOverrides() : null
const dshNaiveTheme = computed(() => (dshThemeState && dshThemeState.value.dark ? darkTheme : null))
const dshOverrides = computed(() => (dshThemeState ? dshThemeState.value.overrides : {}))

watch(activeSkin, skin => { document.body.dataset.skin = skin.id }, { immediate: true })

/* 主题类镜像到 body：naive 的 popover/modal 等浮层 teleport 到 body 下，
   继承不到 .app-root 上的主题变量——var(--bg-panel) 等会整条声明失效
   （设置面板变全透明、帮助手册回落默认白板的根因）。body 挂同类即可继承。 */
watch(
  () => ui.theme,
  (t) => {
    document.body.classList.remove('theme-xuan', 'theme-parchment', 'theme-night')
    document.body.classList.add('theme-' + t)
  },
  { immediate: true }
)

async function revealSettings() {
  if (!settingsPanel) return
  // Let PanelHost mount and commit its themed layout before showing the native window.
  await nextTick()
  requestAnimationFrame(() => requestAnimationFrame(() => window.native?.panelReady?.()))
}

async function boot() {
  ui.dbError = false
  const ok = await openDbWithRetry()
  if (!ok) {
    ui.dbError = true
    revealSettings()
    return
  }
  // Appearance is required for the first panel frame; AI configuration is not.
  await ui.loadPrefs()
  prefsReady.value = true
  revealSettings()
  startAutosave()
  /* 作品库同步（M3）：主进程有通道才启用；hydrate 失败不影响本地可用 */
  try {
    await installLibrarySync()
  } catch (error) {
    console.warn('[library] 同步层未启用', error)
  }
  installAiRuntime()
  await useAiStore().loadSettings()
  if (panelMode) return
  await seedDevVerifyBooks()
  await shelf.refresh()
}
onMounted(boot)

/* 开发调试版专属：npm run dev 启动时把全部验证书种入书架（tools/verify-seeds.mjs 注册表）。
 * 仅 DEV 生效且只补种缺失的；正式版（app://，DEV=false）不会加载，绝不写入测试数据。 */
async function seedDevVerifyBooks() {
  if (!import.meta.env.DEV) return
  try {
    const { seedVerifyBooks } = await import('./dev/verifyBooks.js')
    const r = await seedVerifyBooks()
    const made = (r.books || []).filter((b) => b.created)
    if (made.length) console.info('[dev] 已种入验证书 ' + made.length + ' 本：' + made.map((b) => b.title).join('、'))
  } catch (e) {
    console.warn('[dev] 验证书种入失败（不影响正常使用，可执行 node tools/seed-verify.mjs 重试）', e)
  }
}
</script>

<template>
  <NConfigProvider :theme="nsPlugin ? dshNaiveTheme : naiveTheme" :theme-overrides="nsPlugin ? dshOverrides : overrides" :locale="zhCN" :date-locale="dateZhCN">
    <NMessageProvider>
      <NDialogProvider>
        <PrefBridge />
        <PanelHost v-if="panelMode && prefsReady" />
        <div v-else-if="!panelMode || ui.dbError" class="app-root" :class="'theme-' + ui.theme" :data-skin="activeSkin.id" :style="ui.rootStyle">
          <div v-if="ui.dbError" class="empty-shelf" style="padding-top: 16vh">
            <div class="big">数据的另一扇门被占用了</div>
            <p>
              本地数据库暂时无法打开——很可能是另一个「小说工坊」窗口正在运行。<br />
              你的全部数据都安全地保存在本地，不会被覆盖。关闭其他窗口后重试即可。
            </p>
            <NButton type="primary" @click="boot">重试</NButton>
          </div>
          <template v-else>
            <Bookshelf v-if="ui.view === 'shelf'" />
            <SettingsWorkspace v-else-if="ui.view === 'settings'" />
            <StudioWorkspace v-else />
            <GlobalSearch />
            <ImportDialog />
            <ExportDialog />
            <HelpManual />
            <RevisionsModal />
            <TrashModal />
            <MubuTagPanel />
            <LoreRelationPanel />
          </template>
        </div>
        <WritingStatsDialog />
      </NDialogProvider>
    </NMessageProvider>
  </NConfigProvider>
</template>
