<script setup>
import { computed, ref, watch } from 'vue'
import { NModal, NButton, NCheckbox, NInputNumber, useMessage } from 'naive-ui'
import { collectExportChapters } from '../db/repo'
import { useWorkStore } from '../stores/work'
import { useUiStore } from '../stores/ui'
import { exportBookWithFilter, exportChapterRowsSequential, exportRowsAsZip, exportSingleChapter } from '../services/exporter'
import OIcon from './OIcon.vue'

const work = useWorkStore()
const ui = useUiStore()
const msg = useMessage()

const fmt = ref('txt')
const picked = ref(new Set())
const busy = ref(false)
const zip = ref(false)
const merge = ref(false)
const threshold = ref(30) // 大批量阈值（用户可改，存 appconfig）
const formats = [
  { k: 'txt', label: 'TXT 纯文本' },
  { k: 'md', label: 'Markdown' },
  { k: 'docx', label: 'Word' }
]

const live = computed(() => work.chapters.filter((c) => !c.deletedAt))
const groups = computed(() => {
  const vols = work.volumes.filter((v) => !v.deletedAt).sort((a, b) => a.sortOrder - b.sortOrder)
  const out = []
  const used = new Set()
  for (const v of vols) {
    const chs = live.value.filter((c) => c.volumeId === v.id).sort((a, b) => a.sortOrder - b.sortOrder)
    if (chs.length || vols.length > 1) out.push({ id: v.id, label: v.title || '未命名卷', chapters: chs })
    for (const c of chs) used.add(c.id)
  }
  const loose = live.value.filter((c) => !used.has(c.id) && !vols.some((v) => v.id === c.volumeId))
  if (loose.length) out.push({ id: '__loose__', label: '未分卷章节', chapters: loose.sort((a, b) => a.sortOrder - b.sortOrder) })
  return out
})
const allIds = computed(() => groups.value.flatMap((g) => g.chapters.map((c) => c.id)))
const allOn = computed(() => allIds.value.length > 0 && allIds.value.every((id) => picked.value.has(id)))
const pickedRows = computed(() => collectExportChapters(work.volumes, work.chapters, picked.value))
/* 大批量：仅按选中章节数是否超过阈值判定（整卷/全选本身不强制，
   例如全书只有 8 章时全选仍走逐章分批导出） */
const isBulk = computed(() => pickedRows.value.length > threshold.value)
const exportLabel = computed(() => {
  const count = pickedRows.value.length
  if (!count) return '导出正文'
  if (zip.value) return `打包导出 ${count} 章`
  if (isBulk.value) return merge.value ? `合并导出 ${count} 章` : '选择导出方式…'
  if (count === 1) return `导出「${(pickedRows.value[0].ch.title || '未命名章节').slice(0, 10)}」`
  return `逐章导出 ${count} 章`
})

watch(
  () => ui.exportOpen,
  (open) => {
    if (open) {
      picked.value = new Set(allIds.value)
      fmt.value = 'txt'
      zip.value = false
      merge.value = false
      loadThreshold()
    }
  }
)
async function loadThreshold() {
  try {
    const { db } = window.__ns
    const row = await db.appconfig.get('exportBatchThreshold')
    threshold.value = Number(row?.value) || 30
  } catch {}
}
async function saveThreshold(v) {
  threshold.value = v || 30
  try {
    const { db } = window.__ns
    await db.appconfig.put({ key: 'exportBatchThreshold', value: threshold.value })
  } catch {}
}

function toggleAll() {
  picked.value = new Set(allOn.value ? [] : allIds.value)
  merge.value = false
}
function groupOn(g) {
  return g.chapters.length > 0 && g.chapters.every((c) => picked.value.has(c.id))
}
function toggleGroup(g) {
  const checked = !groupOn(g)
  for (const { id } of g.chapters) {
    if (checked) picked.value.add(id)
    else picked.value.delete(id)
  }
  merge.value = false
}
function toggleCh(id, on) {
  if (on) picked.value.add(id)
  else picked.value.delete(id)
  merge.value = false
}
function toggleZip() {
  zip.value = !zip.value
  merge.value = false
}
function chooseMerge() {
  zip.value = false
  merge.value = true
}

async function doExport() {
  const rows = pickedRows.value
  if (busy.value || !work.work || !rows.length) return
  if (isBulk.value && !merge.value && !zip.value) {
    msg.warning('请选择「合并为单个文件」或开启「ZIP 打包」')
    return
  }
  busy.value = true
  let completed = false
  try {
    if (zip.value) {
      const r = await exportRowsAsZip(work.work, rows, fmt.value)
      completed = !r?.canceled
      if (completed) msg.success(`已导出 ZIP 压缩包（${rows.length} 章 · ${fmt.value.toUpperCase()}）`)
    } else if (isBulk.value) {
      const r = await exportBookWithFilter(work.work, work.volumes, work.chapters, fmt.value, new Set(picked.value))
      completed = !r?.canceled
      if (completed) msg.success(`已合并导出 ${rows.length} 章（${fmt.value.toUpperCase()}）`)
    } else if (rows.length === 1) {
      const r = await exportSingleChapter(work.work, work.volumes, rows[0].ch, fmt.value)
      completed = !r?.canceled
      if (completed) msg.success(`已导出「${rows[0].ch.title || '未命名章节'}」`)
    } else {
      const r = await exportChapterRowsSequential(work.work, work.volumes, work.chapters, rows, fmt.value)
      completed = r.exported === rows.length && !r.canceledAt
      if (!completed) msg.warning(`已导出 ${r.exported} 章，在「${r.canceledAt || '未命名章节'}」处取消`)
      else msg.success(`已导出 ${r.exported} 章至 ${r.dir || '所选目录'}（${fmt.value.toUpperCase()}）`)
    }
  } catch (e) {
    msg.error('导出失败：' + (e.message || e))
  } finally {
    busy.value = false
    if (completed) ui.exportOpen = false
  }
}
</script>

<template>
  <NModal
    class="export-dialog latent-export-dialog"
    :show="ui.exportOpen"
    :mask-closable="!busy"
    :close-on-esc="!busy"
    :closable="!busy"
    preset="card"
    aria-label="导出正文"
    close-focusable
    style="width: min(620px, calc(100vw - 32px))"
    @update:show="(v) => (ui.exportOpen = v)"
  >
    <template #header>
      <div class="exp-heading">
        <span class="exp-heading-icon" aria-hidden="true"><OIcon name="download" :size="20" /></span>
        <div class="exp-heading-text">
          <h2>导出正文</h2>
          <p v-if="work.work" :title="work.work.title">{{ work.work.title || '未命名作品' }}</p>
        </div>
      </div>
    </template>
    <fieldset class="original-export-options exp-options" :disabled="busy">
      <div class="exp-tree">
        <div class="exp-all">
          <NCheckbox :checked="allOn" :disabled="busy || !allIds.length" :indeterminate="pickedRows.length > 0 && !allOn" @update:checked="toggleAll">
            全选章节
          </NCheckbox>
          <span class="exp-count">共 {{ allIds.length }} 章</span>
        </div>
        <div v-for="g in groups" :key="g.id" class="exp-group">
          <div class="exp-vol">
            <NCheckbox :checked="groupOn(g)" :disabled="busy || !g.chapters.length" :indeterminate="!groupOn(g) && g.chapters.some(c => picked.has(c.id))" @update:checked="toggleGroup(g)">
              <span class="exp-title" :title="g.label">{{ g.label }}</span>
              <span class="exp-vol-count">（{{ g.chapters.length }}）</span>
            </NCheckbox>
          </div>
          <div class="exp-chs">
            <NCheckbox
              v-for="c in g.chapters"
              :key="c.id"
              class="exp-ch"
              :checked="picked.has(c.id)"
              :disabled="busy"
              @update:checked="(v) => toggleCh(c.id, v)"
            >
              <span class="exp-title" :title="c.title || '未命名章节'">{{ c.title || '未命名章节' }}</span>
            </NCheckbox>
          </div>
        </div>
        <p v-if="!allIds.length" class="original-dialog-note exp-empty" role="status">当前作品没有可导出的正文。</p>
      </div>
      <div class="exp-fmt" role="group" aria-label="导出选项">
        <span class="exp-fmt-label">格式</span>
        <button type="button" v-for="f in formats" :key="f.k" class="om-chip" :class="{ on: fmt === f.k }" :aria-pressed="fmt === f.k" @click="fmt = f.k">{{ f.label }}</button>
        <button type="button" class="om-chip exp-zip" :class="{ on: zip }" :aria-pressed="zip" @click="toggleZip">ZIP 打包</button>
      </div>
      <p v-if="zip" class="exp-zip-note">每章一个 {{ formats.find(f => f.k === fmt).label }} 文件，按卷分目录。</p>
      <div v-if="isBulk" class="exp-bulk">
        <div v-if="!zip" class="exp-bulk-tip">
          已超过 {{ threshold }} 章。可合并为单个文件，或开启 ZIP 打包。
        </div>
        <button type="button" class="exp-bulk-opt" :class="{ on: merge && !zip }" :aria-pressed="merge && !zip" @click="chooseMerge">
          合并为单个文件
        </button>
        <div class="exp-bulk-th">
          <span>大批量阈值</span>
          <NInputNumber :value="threshold" :disabled="busy" size="tiny" :min="2" :max="500" :step="1" style="width: 90px" @update:value="saveThreshold" />
          <span>章，修改后自动保存</span>
        </div>
      </div>
    </fieldset>
    <template #footer>
      <div class="original-dialog-actions exp-actions">
        <span class="exp-selection" role="status">
          {{ busy ? `正在导出 ${pickedRows.length} 章…` : `已选 ${pickedRows.length} / ${allIds.length} 章` }}
        </span>
        <NButton size="small" :disabled="busy" @click="ui.exportOpen = false">取消</NButton>
        <NButton size="small" type="primary" :loading="busy" :disabled="busy || !pickedRows.length" @click="doExport">
          {{ exportLabel }}
        </NButton>
      </div>
    </template>
  </NModal>
</template>

<style scoped>
.exp-options { border: 0; padding: 0; margin: 0; min-width: 0; }
.exp-tree {
  max-height: 320px;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: var(--space-2);
}
.exp-all {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: var(--space-2);
  border-bottom: 1px solid var(--border);
  margin-bottom: var(--space-2);
}
.exp-vol {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
  font-size: var(--fs-sm);
  cursor: pointer;
  padding: 3px 0;
}
.exp-chs {
  padding-left: 18px;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 2px 10px;
}
.exp-ch { min-width: 0; font-size: var(--fs-sm); }
.exp-vol :deep(.n-checkbox) { min-width: 0; max-width: 100%; }
.exp-ch :deep(.n-checkbox__label), .exp-vol :deep(.n-checkbox__label) {
  min-width: 0;
  display: flex;
  align-items: center;
}
.exp-title {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.exp-vol-count { flex: none; }
.exp-fmt {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-top: var(--space-3);
}
.exp-fmt-label {
  font-size: var(--fs-sm);
  color: var(--text-dim);
}
.exp-fmt .om-chip { background: transparent; font-family: inherit; }
.exp-zip { margin-inline-start: 4px; }
.exp-zip-note {
  color: var(--text-dim);
  font-size: var(--fs-sm);
  margin: 8px 0 0;
}
.exp-empty { padding: 8px 0; }
.exp-actions { display: flex; align-items: center; justify-content: flex-end; gap: 8px; }

.exp-bulk {
  margin-top: var(--space-3);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: var(--space-2);
}
.exp-bulk-tip {
  font-size: var(--fs-sm);
  color: var(--warning);
  margin-bottom: var(--space-2);
}
.exp-bulk-opt {
  background: transparent;
  color: inherit;
  text-align: left;
  font: inherit;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: var(--space-2);
  cursor: pointer;
  transition: border-color var(--dur-fast, 120ms) ease, background 120ms ease;
}
.exp-bulk-opt:hover {
  border-color: var(--border-strong);
}
.exp-bulk-opt.on {
  border-color: var(--accent);
  background: var(--accent-soft);
}
.exp-bulk-th {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--fs-xs);
  color: var(--text-dim);
  margin-top: var(--space-2);
}

</style>

<style>
body[data-skin='dsh'] .n-modal-container:has(.latent-export-dialog) > .n-modal-mask {
  background-color: rgb(25 16 33 / .3);
}

body[data-skin='dsh'] .latent-export-dialog.n-modal.n-card {
  --export-list: rgb(10 11 15 / .19);
  --export-list-head: rgb(30 28 27 / .58);
  --export-wash: rgb(255 249 240 / .07);
  --export-line: rgb(255 249 240 / .15);
  --export-control-line: rgb(244 239 230 / .54);
  --export-scroll: rgb(224 212 196 / .42);
  --export-ink: var(--nsx-ink-1, #f9fafb);
  --export-quiet: var(--nsx-ink-2, #d9d2c6);
  --export-accent: #bdd8c8;
  --export-accent-wash: rgb(189 216 200 / .15);
  --export-check: #bdd8c8;
  --export-check-mark: #24362f;
  --export-primary: #eee6da;
  --export-on-primary: #262321;
  --n-close-icon-color: var(--export-quiet) !important;
  --n-close-icon-color-hover: var(--export-ink) !important;
  --n-close-icon-color-pressed: var(--export-ink) !important;
  --n-close-color-hover: var(--export-wash) !important;
  --n-close-color-pressed: var(--export-accent-wash) !important;
  max-height: calc(100dvh - 28px);
  overflow: hidden;
}
/* 浅色宿主的玻璃取浅底令牌，选中态和控件描边也随之加深。 */
html:not([data-ns-dark]) body[data-skin='dsh'][data-ns-host='dsh'] .latent-export-dialog {
  --export-list-head: color-mix(in srgb, var(--ns-layer-1, #fafafa) 78%, transparent);
  --export-list: rgb(42 45 50 / .08);
  --export-line: rgb(42 45 50 / .2);
  --export-control-line: rgb(42 45 50 / .54);
  --export-scroll: rgb(42 45 50 / .4);
  --export-accent: #284f43;
  --export-accent-wash: rgb(40 79 67 / .16);
  --export-check: #355c50;
  --export-check-mark: #fff;
  --export-primary: #34342f;
  --export-on-primary: #faf6ed;
}
/* 控件放在与侧栏共用的反光层上方。 */
.latent-export-dialog > :is(.n-card-header, .n-card-content, .n-card__footer) {
  position: relative;
  z-index: 2;
}
body[data-skin='dsh'] .latent-export-dialog .n-card-header {
  padding: 17px 22px 14px;
  border-bottom: 1px solid var(--export-line);
}
.latent-export-dialog .n-card-content {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: auto;
  padding: 16px 22px;
}
.latent-export-dialog .exp-options {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
}
.latent-export-dialog .n-card__footer {
  padding: 12px 22px;
  border-top: 1px solid var(--export-line);
  background: linear-gradient(180deg, transparent, var(--export-wash));
}
.latent-export-dialog .exp-heading { display: flex; align-items: center; gap: 12px; min-width: 0; }
.latent-export-dialog .exp-heading-icon {
  display: grid;
  flex: none;
  place-items: center;
  width: 38px;
  height: 38px;
  border: 1px solid var(--export-line);
  border-radius: 12px;
  color: var(--export-accent);
  background: var(--export-wash);
}
.latent-export-dialog .n-card-header__close {
  --n-border-radius: 50% !important;
}
.latent-export-dialog .exp-heading-text { min-width: 0; }
.latent-export-dialog .exp-heading h2 { margin: 0; color: var(--export-ink); font: 600 23px/1.35 var(--nsx-serif, serif); }
.latent-export-dialog .exp-heading p {
  margin: 2px 0 0;
  color: var(--export-quiet);
  font: 400 12px/1.5 var(--nsx-sans, sans-serif);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.latent-export-dialog .exp-tree {
  flex: 0 1 auto;
  min-height: 40px;
  max-height: min(340px, 43vh);
  padding: 0;
  border-color: var(--export-line);
  border-radius: 12px;
  background: var(--export-list);
  box-shadow: inset 0 1px 4px var(--export-list);
  scroll-padding-block-start: 42px;
}
.latent-export-dialog :is(.exp-tree, .n-card-content) {
  scrollbar-width: thin;
  scrollbar-color: var(--export-scroll) transparent;
}
.latent-export-dialog .exp-all {
  position: sticky;
  z-index: 1;
  top: 0;
  margin: 0;
  padding: 9px 12px;
  border-color: var(--export-line);
  background: var(--export-list-head);
  backdrop-filter: blur(6px);
}
.latent-export-dialog .exp-group { padding: 8px 12px; }
.latent-export-dialog .exp-group + .exp-group { border-top: 1px solid var(--export-line); }
.latent-export-dialog .exp-vol { padding: 2px 0; }
.latent-export-dialog .exp-vol .exp-title { font-weight: 600; }
.latent-export-dialog .exp-vol-count { color: var(--export-quiet); font-weight: 400; }
.latent-export-dialog .exp-chs { padding-inline-start: 18px; gap: 2px 10px; }
.latent-export-dialog .exp-ch { padding: 3px 4px; border-radius: 6px; }
.latent-export-dialog .exp-ch:hover { background: var(--export-wash); }
.latent-export-dialog .exp-empty { padding: 0 12px; color: var(--export-quiet); }
.latent-export-dialog .n-checkbox {
  --n-text-color: var(--export-ink) !important;
  --n-border: 1px solid var(--export-control-line) !important;
  --n-color-checked: var(--export-check) !important;
  --n-border-checked: 1px solid var(--export-check) !important;
  --n-border-focus: 1px solid var(--export-accent) !important;
  --n-box-shadow-focus: 0 0 0 2px var(--export-accent-wash) !important;
  --n-check-mark-color: var(--export-check-mark) !important;
}
.latent-export-dialog .n-checkbox__label { color: var(--export-ink); }
.latent-export-dialog .exp-count,
.latent-export-dialog .exp-selection,
.latent-export-dialog .exp-fmt-label,
.latent-export-dialog .exp-zip-note,
.latent-export-dialog .exp-bulk-th,
.latent-export-dialog .exp-bulk-tip { color: var(--export-quiet); font-size: 12px; }
.latent-export-dialog .exp-fmt { gap: 6px; margin-top: 14px; }
.latent-export-dialog :is(.exp-fmt, .exp-zip-note, .exp-bulk) { flex: none; }
.latent-export-dialog .exp-fmt-label { margin-inline-end: 4px; }
.latent-export-dialog .exp-fmt .om-chip,
.latent-export-dialog .exp-bulk-opt {
  border: 1px solid var(--export-line);
  border-radius: var(--nsx-pill, 999px);
  background: var(--export-wash);
  color: var(--export-ink);
  font-size: 12px;
  line-height: 1.4;
  padding: 6px 10px;
}
.latent-export-dialog .exp-fmt .om-chip:hover,
.latent-export-dialog .exp-bulk-opt:hover { border-color: var(--export-quiet); }
.latent-export-dialog .exp-fmt .om-chip.on,
.latent-export-dialog .exp-bulk-opt.on {
  background: var(--export-accent-wash);
  border-color: var(--export-accent);
  color: var(--export-accent);
}
.latent-export-dialog .exp-bulk { border-color: var(--export-line); padding: 8px 10px; }
.latent-export-dialog .exp-actions { flex-wrap: wrap; }
.latent-export-dialog .exp-selection { margin-inline-end: auto; }
.latent-export-dialog .exp-actions .n-button {
  --n-border-radius: var(--nsx-pill, 999px) !important;
  --n-height: 32px !important;
}
.latent-export-dialog .exp-actions .n-button--default-type {
  --n-text-color: var(--export-ink) !important;
  --n-text-color-hover: var(--export-accent) !important;
  --n-text-color-focus: var(--export-accent) !important;
  --n-text-color-pressed: var(--export-accent) !important;
  --n-color: var(--export-wash) !important;
  --n-color-hover: var(--export-wash) !important;
  --n-color-focus: var(--export-wash) !important;
  --n-color-pressed: var(--export-accent-wash) !important;
  --n-border: 1px solid var(--export-line) !important;
  --n-border-hover: 1px solid var(--export-control-line) !important;
  --n-border-focus: 1px solid var(--export-accent) !important;
  --n-border-pressed: 1px solid var(--export-accent) !important;
}
.latent-export-dialog .exp-actions .n-button--primary-type {
  --n-text-color: var(--export-on-primary) !important;
  --n-text-color-hover: var(--export-on-primary) !important;
  --n-text-color-pressed: var(--export-on-primary) !important;
  --n-text-color-focus: var(--export-on-primary) !important;
  --n-color: var(--export-primary) !important;
  --n-color-hover: color-mix(in srgb, var(--export-primary), var(--export-accent) 20%) !important;
  --n-color-pressed: var(--export-primary) !important;
  --n-color-focus: var(--export-primary) !important;
  --n-border: 1px solid transparent !important;
  --n-border-hover: 1px solid transparent !important;
  --n-border-pressed: 1px solid transparent !important;
  --n-border-focus: 1px solid transparent !important;
}
.latent-export-dialog :is(.om-chip, .exp-bulk-opt):focus-visible,
.latent-export-dialog .n-button:focus-visible,
.latent-export-dialog .n-checkbox:focus-visible,
.latent-export-dialog .n-card-header__close:focus-visible {
  outline: 2px solid var(--export-accent);
  outline-offset: 2px;
}
@media (max-width: 860px) {
  .latent-export-dialog .exp-chs { grid-template-columns: minmax(0, 1fr); }
}
@media (max-width: 540px), (max-height: 530px) {
  body[data-skin='dsh'] .latent-export-dialog .n-card-header,
  .latent-export-dialog .n-card-content,
  .latent-export-dialog .n-card__footer { padding: 10px 14px; }
}
</style>
