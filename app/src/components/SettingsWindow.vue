<script setup>
/* 设置窗口（面板窗口 settings 类型）：左侧分类导航 + 右侧设置内容，替代原顶栏设置弹层。
 * 页面：外观 / 恍然梦 / 数据 / 关于。书签跳转依赖主窗口工作台状态，仍留在主窗口顶栏。
 * 跨窗口安全：
 * - 改偏好 → ui.setPref 内广播 prefs-changed，其余窗口即时重载；
 * - 导入 / 回收站还原改动作品集合 → 关闭弹窗时广播 works-changed 刷新书架；
 * - 恢复备份 → 先广播 db-restore-begin（全部窗口 flushAll+discardPending，v1.0.22 防覆盖纪律），
 *   恢复完成后广播 db-restored 全员整体重载。
 */
import { h, ref, onMounted, watch, computed } from 'vue'
import { NButton, NSelect, NTag, NCheckbox, NSwitch } from 'naive-ui'
import OIcon from './OIcon.vue'
import WritingPaperPicker from './WritingPaperPicker.vue'
import WritingPaperPreview from './WritingPaperPreview.vue'
import AiSettings from './ai/AiSettings.vue'
import KnowledgeModelSettings from './ai/KnowledgeModelSettings.vue'
import ImportDialog from './ImportDialog.vue'
import ExportDialog from './ExportDialog.vue'
import TrashModal from './TrashModal.vue'
import StatsModal from './StatsModal.vue'
import HelpManual from './HelpManual.vue'
import { useUiStore, FONT_MAP, LATIN_MAP } from '../stores/ui'
import { backupAll, restoreBackup } from '../services/exporter'
import { pickFiles, getDataLocation, pickDataDir, openDataFolder, moveDataDir, cleanOldLocation, openOldFolder, clearDataPointer } from '../services/fileio'
import { broadcastAppEvent } from '../services/appbus'

const ui = useUiStore()
/* 插件构建没有恍然梦：模型/知识库两个分区整段不出现（导航与 @go-ai 两条入口都在下面被收掉）。 */
const nsPlugin = __NS_PLUGIN__

const PAGES = [
  { key: 'appearance', icon: '外', label: '外观', desc: '主题 / 字体 / 字号' },
  { key: 'ai', icon: '模', label: '模型设置', desc: '供应商预设 / 模型 / 参数' },
  { key: 'knowledge', icon: '知', label: '知识库模型', desc: '向量模型 / 语义检索' },
  { key: 'data', icon: '数', label: '数据', desc: '导入导出 / 备份 / 存储' },
  { key: 'about', icon: '关', label: '关于', desc: '统计 / 手册 / 标语' }
]
/* 插件构建没有恍然梦：模型设置 / 知识库模型两个分区从导航里过滤掉（page 只由导航与 @go-ai 赋值，
 * 两个入口都不在，内容区那两段本身不会渲染）。Vue 3 里 v-if 早于 v-for 求值，不能同元素直接判 p.key。 */
const navPages = computed(() => nsPlugin ? PAGES.filter(p => p.key !== 'ai' && p.key !== 'knowledge') : PAGES)
const page = ref('appearance')

function resetAppearance() {
  ui.setWritingPaperStyle('booklet').catch(e=>window.$msg?.error('纸面未能恢复默认：'+e.message))
  ui.setPref('editorFont', 'song')
  ui.setPref('editorLatin', 'none')
  ui.setPref('fontSize', 17)
  ui.setPref('theme', 'xuan')
  ui.setPref('topbarAutoHide', false)
}

function closeWindow() {
  window.native?.panelCloseSelf()
}

/* ---------- 外观 ---------- */
const CJK_OPTS = Object.entries(FONT_MAP).map(([value, f]) => ({ label: f.label, value }))
const LATIN_OPTS = Object.entries(LATIN_MAP).map(([value, f]) => ({ label: f.label, value }))
function bumpFont(d) {
  ui.setPref('fontSize', Math.min(24, Math.max(13, ui.fontSize + d)))
}

/* ---------- 数据 ---------- */
async function onBackup() {
  const r = await backupAll()
  if (!r?.canceled) window.$msg?.success('备份已保存')
}
async function onRestore() {
  const files = await pickFiles(['json'])
  if (!files.length) return
  /* 先让全部窗口（含自身）冲刷并丢弃在途脏数据，再执行恢复，防止旧状态写回恢复后的库 */
  broadcastAppEvent('db-restore-begin')
  await new Promise((r) => setTimeout(r, 200))
  try {
    await restoreBackup(files[0].data)
    broadcastAppEvent('db-restored')
    window.location.reload()
  } catch (e) {
    window.$msg?.error('恢复失败：' + e.message)
  }
}
/* 面板窗口内完成的导入 / 回收站还原会改动作品集合 → 通知其余窗口刷新书架 */
watch([() => ui.importOpen, () => ui.trashOpen], ([a, b], [pa, pb]) => {
  if ((pa && !a) || (pb && !b)) broadcastAppEvent('works-changed')
})

/* ---------- 存储位置（仅 Electron；迁移会自动保存并重启应用，IndexedDB 无法热迁移） ----------
 * 旧位置：迁移默认保留原位置（只记录位置，供此处清理）；弹窗勾选「清理原位置」则迁移时当场释放。
 * 清理两档：只删缓存（保留 IndexedDB 备份与指针）／彻底删除（仅留指针文件，指针丢了会回退默认位置）。 */
const hasDataDir = !!window.native?.moveDataDir
const dataLoc = ref(null)
const migrating = ref(false)
const wipeOld = ref(false) // 迁移弹窗：勾选 = 迁移后清理原位置（不保留备份）
function shortPath(p) {
  if (!p) return ''
  if (p.length <= 42) return p
  return p.slice(0, 22) + '…' + p.slice(-19)
}
function fmtBytes(n) {
  const v = Number(n) || 0
  if (v < 1024) return v + ' B'
  if (v < 1024 * 1024) return (v / 1024).toFixed(0) + ' KB'
  if (v < 1024 * 1024 * 1024) return (v / 1024 / 1024).toFixed(1) + ' MB'
  return (v / 1024 / 1024 / 1024).toFixed(2) + ' GB'
}
async function refreshLoc() {
  if (hasDataDir) dataLoc.value = await getDataLocation()
}
onMounted(refreshLoc)
function confirmMove(title, target, note, dir) {
  wipeOld.value = false
  window.$dlg?.warning({
    title,
    content: () =>
      h('div', { style: 'line-height:1.7' }, [
        h('div', { style: 'word-break:break-all' }, target),
        h('div', { style: 'font-size:12px;opacity:.85' }, note),
        h('div', { style: 'margin-top:10px' }, '原位置剩下的只是副本与缓存：留着可在「旧位置」里随时清理。'),
        h(
          NCheckbox,
          { checked: wipeOld.value, 'onUpdate:checked': (v) => (wipeOld.value = v), style: 'margin-top:6px' },
          () => '迁移后清理原位置数据（不保留备份，不可恢复）'
        )
      ]),
    positiveText: '迁移并重启',
    negativeText: '取消',
    onPositiveClick: async () => {
      const r = await moveDataDir(dir, { keepOld: !wipeOld.value })
      if (!r?.ok) {
        window.$msg?.error(r?.error || '迁移失败')
        return false
      }
      migrating.value = true
    }
  })
}
async function changeDataDir() {
  const res = await pickDataDir()
  if (res.canceled || !res.dir) return
  confirmMove(
    '更改数据存储位置',
    `将把全部数据迁移到：${res.dir}\\小说工坊`,
    '迁移前自动保存全部未落盘数据，随后应用关闭并自动重启；原位置默认保留为副本。',
    res.dir
  )
}
function restoreDataDir() {
  confirmMove(
    '恢复默认存储位置',
    `将把数据迁回默认位置：${dataLoc.value?.defaultDir || ''}`,
    '迁移前自动保存全部未落盘数据，随后应用关闭并自动重启；默认位置原有的陈旧快照也按下方的选择处理。',
    ''
  )
}
/* 旧位置清理（只传记录下标，路径由主进程从记录文件读取） */
function cleanOld(index, mode) {
  const entry = dataLoc.value?.old?.[index]
  const isAll = mode === 'all'
  window.$dlg?.warning({
    title: isAll ? '删除旧位置数据' : '清理旧位置缓存',
    content: () =>
      h('div', { style: 'line-height:1.7' }, [
        h('div', { style: 'word-break:break-all' }, entry?.dir || ''),
        h(
          'div',
          { style: 'font-size:12px;opacity:.85' },
          isAll
            ? '删除该目录内的全部内容（含 IndexedDB 备份），只保留指针文件。此操作不可恢复。'
            : '只删除 Chromium 缓存与临时状态，保留 IndexedDB 备份和指针文件；不影响正在使用的数据。'
        )
      ]),
    positiveText: isAll ? '确认删除' : '确认清理',
    negativeText: '取消',
    onPositiveClick: async () => {
      const r = await cleanOldLocation(index, mode)
      if (!r?.ok) {
        window.$msg?.error((isAll ? '删除失败：' : '清理失败：') + (r?.error || '未知错误'))
        return false
      }
      window.$msg?.success(`${isAll ? '已删除旧位置数据' : '已清理旧位置缓存'}，释放 ${fmtBytes(r.freed)}`)
      await refreshLoc()
    }
  })
}
async function openOld(index) {
  const r = await openOldFolder(index)
  if (r?.error) window.$msg?.warning(r.error)
}
/* 指针指向的目录已不存在时（回退默认位置），清除失效记录——否则告警会一直挂着 */
async function clearStalePointer() {
  const r = await clearDataPointer()
  if (!r?.ok) {
    window.$msg?.error('清除失效记录失败：' + (r?.error || '未知错误'))
    return
  }
  window.$msg?.success('已清除失效的位置记录，当前使用默认存储位置')
  await refreshLoc()
}
</script>

<template>
  <div class="sw-root">
    <div class="sw-head">
      <span class="sw-title serif">设置</span>
      <span class="sw-sub">SETTINGS · 小说工坊</span>
      <div style="flex: 1"></div>
      <NButton size="small" quaternary title="关闭设置窗口" @click="closeWindow"><OIcon name="close" :size="13" /></NButton>
    </div>

    <div class="sw-body">
      <nav class="sw-nav">
        <button
          v-for="p in navPages"
          :key="p.key"
          class="sw-nav-item"
          :class="{ on: page === p.key }"
          type="button"
          @click="page = p.key"
        >
          <span class="sw-nav-ico">{{ p.icon }}</span>
          <span class="sw-nav-text">
            <b>{{ p.label }}</b>
            <i>{{ p.desc }}</i>
          </span>
        </button>
      </nav>

      <section class="sw-content" :class="{ 'sw-appearance': page === 'appearance' }" :data-paper-settings="page==='appearance'||undefined">
        <!-- 外观 -->
        <template v-if="page === 'appearance'">
          <div class="sw-appearance-controls">
          <h2 class="sw-h serif">外观</h2>
          <NButton size="small" quaternary :disabled="ui.writingPaperSaving" @click="resetAppearance">恢复默认</NButton>
          <p class="sw-desc">顶栏与字体字号，改动即时生效并同步到全部窗口</p>
          <div class="sw-card">
            <!-- 插件版不提供纸面切换：纸面由 DSH 皮肤决定，留一个选了也不生效的选项只会误导。 -->
            <div v-if="!nsPlugin" class="sw-row sw-paper-row">
              <div class="sw-row-main"><b>正文纸面装帧</b><i>跟随皮肤明暗，切换不改变文字排版</i></div>
              <WritingPaperPicker settings />
            </div>
            <div class="sw-row">
              <div class="sw-row-main"><b>默认隐藏顶栏</b><i>鼠标移至顶部展开，可随时固定。</i></div>
              <NSwitch :value="ui.topbarAutoHide" aria-label="默认隐藏顶栏" @update:value="value => ui.setPref('topbarAutoHide', value)" />
            </div>
            <div class="sw-row">
              <div class="sw-row-main"><b>中文字体</b><i>正文与界面的中文字形</i></div>
              <NSelect size="small" style="width: 190px" :value="ui.editorFont" :options="CJK_OPTS" @update:value="(v) => ui.setPref('editorFont', v)" />
            </div>
            <div class="sw-row">
              <div class="sw-row-main"><b>西文字体</b><i>拉丁字符使用的字形</i></div>
              <NSelect size="small" style="width: 190px" :value="ui.editorLatin" :options="LATIN_OPTS" @update:value="(v) => ui.setPref('editorLatin', v)" />
            </div>
            <div class="sw-row">
              <div class="sw-row-main"><b>正文字号</b><i>正文编辑与阅读字号（13–24px）</i></div>
              <span class="fs">
                <NButton size="tiny" :disabled="ui.fontSize <= 13" @click="bumpFont(-1)">A－</NButton>
                <b>{{ ui.fontSize }} px</b>
                <NButton size="tiny" :disabled="ui.fontSize >= 24" @click="bumpFont(1)">A＋</NButton>
              </span>
            </div>
          </div>
          </div>
          <WritingPaperPreview />
        </template>

        <!-- 模型设置 -->
        <template v-else-if="page === 'ai'">
          <h2 class="sw-h serif">模型设置</h2>
          <p class="sw-desc">多供应商预设：连接、模型与生成参数，改动即时生效</p>
          <div class="sw-card sw-card-ai">
            <AiSettings />
          </div>
        </template>

        <!-- 知识库模型：向量模型从供应商参数中独立出来 -->
        <template v-else-if="page === 'knowledge'">
          <h2 class="sw-h serif">知识库模型</h2>
          <p class="sw-desc">语义检索使用的向量模型；连接跟随当前供应商预设</p>
          <div class="sw-card sw-card-ai">
            <KnowledgeModelSettings @go-ai="page = 'ai'" />
          </div>
        </template>

        <!-- 数据 -->
        <template v-else-if="page === 'data'">
          <h2 class="sw-h serif">数据</h2>
          <p class="sw-desc">导入导出、备份与本地存储，全部数据保存在本机</p>
          <div class="sw-card">
            <button class="sw-item" type="button" @click="ui.importOpen = true">
              <OIcon name="download" :size="14" />
              <span class="sw-row-main"><b>导入作品…</b><i>支持 txt / md / docx / pdf / epub / 图片</i></span>
            </button>
            <button class="sw-item" type="button" @click="ui.exportOpen = true">
              <OIcon name="download" :size="14" />
              <span class="sw-row-main"><b>导出正文…</b><i>TXT / Markdown / Word，可按章节勾选</i></span>
            </button>
            <button class="sw-item" type="button" @click="onBackup">
              <OIcon name="download" :size="14" />
              <span class="sw-row-main"><b>备份全部数据（JSON）</b><i>作品、章节、人物、大纲、设定、批注等全量快照</i></span>
            </button>
            <button class="sw-item is-danger" type="button" @click="onRestore">
              <OIcon name="upload" :size="14" />
              <span class="sw-row-main"><b>恢复备份（JSON）…</b><i>以备份覆盖当前全部数据，恢复前自动保存并全窗口重载</i></span>
            </button>
            <button class="sw-item" type="button" @click="ui.trashOpen = true">
              <OIcon name="trash" :size="14" />
              <span class="sw-row-main"><b>回收站</b><i>软删除的作品与条目可还原或彻底清除</i></span>
            </button>
          </div>

          <template v-if="hasDataDir">
            <h3 class="sw-h2 serif">存储位置</h3>
            <div class="sw-card">
              <div class="sw-row">
                <div class="sw-row-main">
                  <b>当前位置</b>
                  <i class="loc-path" :title="dataLoc?.current">{{ shortPath(dataLoc?.current) || '…' }}</i>
                </div>
                <NTag size="small" :bordered="false" :type="dataLoc?.isCustom ? 'warning' : 'default'">{{ dataLoc?.isCustom ? '自定义' : '默认' }}</NTag>
              </div>
              <div v-if="dataLoc?.fallback" class="sw-warn">
                自定义目录当前不可用（目录被改名或删除），已回退默认位置；可清除失效记录，或重新「更改存储位置」。<NButton size="tiny" quaternary style="margin-left:6px" @click="clearStalePointer">清除失效记录</NButton>
              </div>
              <div v-if="migrating" class="sw-warn hot">正在迁移数据，应用即将重启，请稍候…</div>
              <button class="sw-item" type="button" @click="changeDataDir">
                <OIcon name="folder" :size="14" />
                <span class="sw-row-main"><b>更改存储位置…</b><i>迁移前自动保存，应用关闭并自动重启后生效；原位置默认保留为副本</i></span>
              </button>
              <button v-if="dataLoc?.isCustom" class="sw-item is-danger" type="button" @click="restoreDataDir">
                <OIcon name="back" :size="14" />
                <span class="sw-row-main"><b>恢复默认存储位置</b><i>数据迁回默认位置，原自定义目录默认保留为副本</i></span>
              </button>
              <div v-if="dataLoc?.old?.length" class="sw-warn">
                旧位置里只剩指针与备份副本：缓存（体积大头）可安全清理；IndexedDB 是数据备份；<b>指针文件不可删</b>，否则下次启动会回到默认位置并新建空库。
              </div>
              <div v-for="(o, i) in dataLoc?.old || []" :key="o.dir" class="sw-row">
                <div class="sw-row-main">
                  <b>{{ o.kind === 'stale-snapshot' ? '旧默认快照' : '迁移前原位置' }}</b>
                  <i class="loc-path" :title="o.dir">{{ shortPath(o.dir) }}（{{ fmtBytes(o.bytes) }}）</i>
                </div>
                <NButton size="tiny" quaternary @click="openOld(i)">打开</NButton>
                <NButton size="tiny" quaternary @click="cleanOld(i, 'caches')">清理缓存</NButton>
                <NButton size="tiny" quaternary @click="cleanOld(i, 'all')">删除数据</NButton>
              </div>
              <button class="sw-item" type="button" @click="openDataFolder()">
                <OIcon name="external" :size="14" />
                <span class="sw-row-main"><b>打开数据文件夹</b><i>在资源管理器中查看本地数据目录</i></span>
              </button>
            </div>
          </template>
        </template>

        <!-- 关于 -->
        <template v-else>
          <h2 class="sw-h serif">关于</h2>
          <p class="sw-desc">小说工坊 · 本地优先的写作工坊</p>
          <div class="sw-card">
            <button class="sw-item" type="button" @click="ui.statsOpen = true">
              <OIcon name="stats" :size="14" />
              <span class="sw-row-main"><b>写作统计</b><i>每日码字曲线与累计字数</i></span>
            </button>
            <button class="sw-item" type="button" @click="ui.helpOpen = true">
              <OIcon name="note" :size="14" />
              <span class="sw-row-main"><b>帮助与键位手册</b><i>全部功能与快捷键说明</i></span>
            </button>
          </div>
          <div class="sw-foot">本地优先 · 自动保存 · 色带书封 G</div>
        </template>
      </section>
    </div>


    <!-- 与主窗口同款的弹层：在设置窗口内完成导入 / 导出 / 回收站 / 统计 / 手册 -->
    <ImportDialog />
    <ExportDialog />
    <TrashModal />
    <StatsModal />
    <HelpManual />
  </div>
</template>

<style scoped>
.sw-root {
  height: 100%;
  display: flex;
  flex-direction: column;
  color: var(--text);
  background: var(--bg, var(--bg-panel));
}
.sw-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-panel);
  flex: none;
  /* 无原生标题栏（frameless）：头行即窗口拖拽区，交互元素单独豁免 */
  -webkit-app-region: drag;
}
.sw-head button {
  -webkit-app-region: no-drag;
}
.sw-title {
  font-size: 16px;
  font-weight: 700;
  color: var(--ikb);
}
.sw-sub {
  font-family: var(--g-disp, serif);
  font-size: 9px;
  letter-spacing: 0.24em;
  color: var(--text-dim);
  text-transform: uppercase;
  font-weight: 600;
}
.sw-body {
  flex: 1;
  min-height: 0;
  display: flex;
}

/* 左侧分类导航 */
.sw-nav {
  width: 198px;
  flex: none;
  padding: 12px 8px;
  border-right: 1px solid var(--border);
  background: var(--bg-panel);
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow: auto;
}
.sw-nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border: none;
  border-radius: 6px;
  background: none;
  color: var(--text);
  cursor: pointer;
  text-align: left;
  font: inherit;
}
.sw-nav-item:hover {
  background: color-mix(in srgb, var(--accent) 8%, transparent);
}
.sw-nav-item.on {
  background: color-mix(in srgb, var(--accent) 14%, transparent);
}
.sw-nav-ico {
  flex: none;
  width: 26px;
  height: 26px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--bg-panel);
  font-family: var(--g-serif, serif);
  font-size: 13px;
  color: var(--ikb);
}
.sw-nav-item.on .sw-nav-ico {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--bg-panel);
}
.sw-nav-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.sw-nav-text b {
  font-size: 12.5px;
  font-weight: 600;
}
.sw-nav-item.on .sw-nav-text b {
  color: var(--accent);
}
.sw-nav-text i {
  font-style: normal;
  font-size: 10.5px;
  color: var(--text-dim);
}

/* 右侧内容 */
.sw-content {
  flex: 1;
  min-width: 0;
  overflow: auto;
  padding: 18px 22px 26px;
}
.sw-h {
  margin: 0 0 4px;
  font-size: 19px;
  font-weight: 700;
  color: var(--text);
}
.sw-h2 {
  margin: 16px 0 6px;
  font-size: 14px;
  font-weight: 700;
  color: var(--text);
}
.sw-desc {
  margin: 0 0 14px;
  font-size: 12px;
  color: var(--text-dim);
}
.sw-card {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-panel);
  padding: 2px 0;
  margin-bottom: 14px;
  overflow: hidden;
}
.sw-card-ai {
  padding: 10px 12px;
}
.sw-row {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 11px 14px;
}
.sw-row + .sw-row {
  border-top: 1px solid var(--border);
}
.sw-row-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.sw-row-main b {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text);
}
.sw-row-main i {
  font-style: normal;
  font-size: 11px;
  line-height: 1.5;
  color: var(--text-dim);
  word-break: break-all;
}
.sw-item {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 11px 14px;
  border: none;
  background: none;
  color: var(--text);
  cursor: pointer;
  font: inherit;
  text-align: left;
}
.sw-item + .sw-item {
  border-top: 1px solid var(--border);
}
.sw-item:hover {
  background: color-mix(in srgb, var(--accent) 8%, transparent);
}
.sw-item:hover .sw-row-main b {
  color: var(--accent);
}
.sw-item > .OIcon,
.sw-item svg {
  flex: none;
  color: var(--text-dim);
}
.fs {
  display: flex;
  align-items: center;
  gap: 8px;
}
.fs b {
  font-variant-numeric: tabular-nums;
  font-size: 12px;
  min-width: 44px;
  text-align: center;
  color: var(--text);
}
.loc-path {
  max-width: 420px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sw-warn {
  margin: 8px 14px;
  padding: 6px 10px;
  font-size: 11.5px;
  line-height: 1.5;
  border-radius: 4px;
  background: color-mix(in srgb, #d48219 14%, transparent);
  color: #9a6b00;
}
.sw-warn.hot {
  background: color-mix(in srgb, var(--accent) 12%, transparent);
  color: var(--accent);
}
.sw-foot {
  margin-top: 4px;
  font-size: 10.5px;
  letter-spacing: 0.08em;
  color: var(--text-faint, var(--text-dim));
}
</style>
