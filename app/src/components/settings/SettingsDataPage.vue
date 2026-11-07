<script setup>
/* 数据页（总稿 app.mjs:27-29,84-97 dataPage/actionRow/librarySummary）。
 *
 * 三组动作 + 右栏「此设备上的内容」。数值全部来自真实库（settings-data-actions 的
 * loadLibrarySummary），最近一次备份读 ui.lastBackupAt——备份真正落盘才写这个时间戳。
 *
 * 弹窗一次只挂一个（v-if）：<dialog> 的 id 是通用壳写死的，同时挂两个会让
 * document.querySelector('#settings-dialog-title') 命中关闭着的那一个，
 * 顺带也让「恢复备份 / 彻底删除」这类替换式弹窗的语义显式化。 */
import { computed, inject, nextTick, onMounted, ref } from 'vue'
import { useUiStore } from '../../stores/ui'
import { useWorkStore } from '../../stores/work'
import { SETTINGS_CATALOG } from './settings-catalog.js'
import { SETTINGS_TOAST_KEY } from './settings-toast.js'
import {
  applyBackupJson,
  clearRestoreSnapshot,
  createBackup,
  formatBackupTime,
  formatCount,
  loadLibrarySummary,
  pickBackupCandidate,
  purgeTrashRow,
  readRestoreSnapshot
} from './settings-data-actions.js'
import SettingsDialog from './SettingsDialog.vue'
import SettingsExportDialog from './dialogs/SettingsExportDialog.vue'
import SettingsRestoreDialog from './dialogs/SettingsRestoreDialog.vue'
import SettingsTrashDialog from './dialogs/SettingsTrashDialog.vue'

const ui = useUiStore()
const work = useWorkStore()
const toast = inject(SETTINGS_TOAST_KEY, null)

/* 文案与检索目录同源：搜索结果里写的说明必须和页内一字不差 */
const descOf = (id) => SETTINGS_CATALOG.find((item) => item.id === id)?.desc || ''

const summary = ref({ works: 0, chapters: 0, words: 0, characters: 0, lore: 0, trash: 0 })
const active = ref(null)
const candidate = ref(null)
const trashFilter = ref('all')
const purgeRow = ref(null)
const purgeOpen = ref(false)
const backingUp = ref(false)

const backupTime = computed(() => formatBackupTime(ui.lastBackupAt))
const hasBackup = computed(() => Number(ui.lastBackupAt) > 0)

async function refresh() {
  try {
    summary.value = await loadLibrarySummary()
  } catch (err) {
    toast?.show(String(err?.message || err))
  }
}

async function onBackup() {
  if (backingUp.value) return
  backingUp.value = true
  try {
    const result = await createBackup()
    if (result.canceled) return
    ui.lastBackupAt = result.at
    toast?.show('完整备份文件已生成。')
  } catch (err) {
    toast?.show(String(err?.message || err))
  } finally {
    backingUp.value = false
    await refresh()
  }
}

/* 选文件 + 校验都在打开弹窗之前：读不出来或结构不符只提示，一个字节的数据都不动 */
async function onRestore() {
  try {
    const parsed = await pickBackupCandidate()
    if (!parsed) return
    candidate.value = parsed
    active.value = 'restore'
  } catch (err) {
    toast?.show(String(err?.message || err))
  }
}

function onImport() {
  ui.importOpen = true
}

function onExport() {
  if (!summary.value.works) {
    toast?.show('还没有可以导出的作品。')
    return
  }
  active.value = 'export'
}

function onTrash() {
  active.value = 'trash'
}

function openPurge(row) {
  purgeRow.value = row
  active.value = null
  nextTick(() => {
    purgeOpen.value = true
  })
}

function closePurge(back = false) {
  purgeOpen.value = false
  /* 先让弹窗自己关（焦点归还），下一拍再换回回收站列表：两个 <dialog> 不同时在树上 */
  setTimeout(() => {
    purgeRow.value = null
    if (back) active.value = 'trash'
  }, 0)
}

async function confirmPurge() {
  const row = purgeRow.value
  if (!row) return
  try {
    await purgeTrashRow(work, row)
    closePurge()
    toast?.show('条目已从回收站移除。')
    await refresh()
  } catch (err) {
    toast?.show(String(err?.message || err))
  }
}

/* 恢复备份会重载页面，所以「撤销」只能落在重载之后：读 sessionStorage 里的快照再恢复一次。
   快照超过 10 分钟或写不进去就当没有，绝不弹一个点了没反应的取消。 */
function offerRestoreUndo() {
  const snapshot = readRestoreSnapshot()
  if (!snapshot) return
  toast?.show('工作区已从备份恢复。', {
    undo: async () => {
      clearRestoreSnapshot()
      try {
        await applyBackupJson(snapshot.json)
      } catch (err) {
        toast?.show(String(err?.message || err))
      }
    }
  })
}

onMounted(async () => {
  await refresh()
  offerRestoreUndo()
})
</script>

<template>
  <div class="data-layout">
    <div>
      <section class="action-group">
        <div class="section-title">
          <h2>备份与恢复</h2>
        </div>
        <div class="action-row" data-setting="backup">
          <svg class="icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v13m-5-5 5 5 5-5M3 17v4h18v-4" /></svg>
          <div>
            <strong>备份全部数据</strong>
            <p>作品、章节、人物、设定与偏好的完整快照</p>
          </div>
          <button type="button" class="btn" data-act="backup" aria-label="备份全部数据" @click="onBackup"><span>生成备份</span></button>
        </div>
        <div class="action-row danger" data-setting="restore">
          <svg class="icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 16V3m-5 5 5-5 5 5M3 15v6h18v-6" /></svg>
          <div>
            <strong>恢复备份</strong>
            <p>先检查备份内容，再替换当前工作区</p>
          </div>
          <button type="button" class="btn" data-act="restore" aria-label="恢复备份" @click="onRestore"><span>选择备份</span></button>
        </div>
      </section>

      <section class="action-group">
        <div class="section-title">
          <h2>导入与导出</h2>
        </div>
        <div class="action-row" data-setting="import">
          <svg class="icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 4h6a4 4 0 0 1 3 2 4 4 0 0 1 3-2h6v16h-6a4 4 0 0 0-3 2 4 4 0 0 0-3-2H3zM12 6v16" /></svg>
          <div>
            <strong>导入文本作品</strong>
            <p>{{ descOf('import') }}</p>
          </div>
          <button type="button" class="btn" data-act="import" aria-label="导入文本作品" @click="onImport"><span>选择文件</span></button>
        </div>
        <div class="action-row" data-setting="export">
          <svg class="icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v13m-5-5 5 5 5-5M3 17v4h18v-4" /></svg>
          <div>
            <strong>导出正文</strong>
            <p>{{ descOf('export') }}</p>
          </div>
          <button type="button" class="btn" data-act="export" aria-label="导出正文" @click="onExport"><span>选择章节</span></button>
        </div>
      </section>

      <section class="action-group">
        <div class="section-title">
          <h2>回收站</h2>
          <small>{{ summary.trash }} 项</small>
        </div>
        <div class="action-row" data-setting="trash">
          <svg class="icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7" /></svg>
          <div>
            <strong>找回删除的内容</strong>
            <p>恢复章节、人物、设定或灵感条目</p>
          </div>
          <button type="button" class="btn" data-act="trash" aria-label="回收站" @click="onTrash"><span>查看</span></button>
        </div>
      </section>
    </div>

    <aside class="data-aside">
      <h2 class="aside-heading">此设备上的内容</h2>
      <dl class="library-list">
        <div><dt>作品</dt><dd>{{ summary.works }} 部</dd></div>
        <div><dt>章节</dt><dd>{{ summary.chapters }} 章</dd></div>
        <div><dt>正文</dt><dd>{{ formatCount(summary.words) }} 字</dd></div>
        <div><dt>人物</dt><dd>{{ summary.characters }} 人</dd></div>
        <div><dt>设定</dt><dd>{{ summary.lore }} 条</dd></div>
        <div><dt>回收站</dt><dd>{{ summary.trash }} 项</dd></div>
      </dl>
      <div class="device-note">
        <strong>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 2 8 3v6c0 5-8 11-8 11S4 16 4 11V5zM8 12l3 3 5-6" /></svg>
          数据由你保管
        </strong>
        <p>内容保存在当前设备。完整备份可以帮助你迁移或找回作品。</p>
      </div>
      <div class="device-note">
        <strong>最近一次备份</strong>
        <div class="backup-time">{{ backupTime }}</div>
        <p style="margin-top: 7px">{{ hasBackup ? '备份文件已生成，请妥善保管。' : '先生成一份完整快照，让创作多一层保障。' }}</p>
      </div>
    </aside>

    <SettingsExportDialog v-if="active === 'export'" @close="active = null" @done="refresh" />
    <SettingsRestoreDialog v-if="active === 'restore'" :candidate="candidate" @close="active = null" />
    <SettingsTrashDialog
      v-if="active === 'trash'"
      :filter="trashFilter"
      @update:filter="trashFilter = $event"
      @close="active = null"
      @changed="refresh"
      @purge="openPurge"
    />

    <SettingsDialog v-if="purgeRow" :open="purgeOpen" title="彻底删除条目" @update:open="closePurge()">
      <p>彻底删除「{{ purgeRow?.name }}」？</p>
      <p class="dialog-note">此条目将从回收站移除，之后无法通过回收站找回。</p>
      <template #footer>
        <button type="button" class="btn" data-act="trash-back" @click="closePurge(true)">保留条目</button>
        <button type="button" class="btn danger" data-act="purge-confirm" @click="confirmPurge">彻底删除</button>
      </template>
    </SettingsDialog>
  </div>
</template>
