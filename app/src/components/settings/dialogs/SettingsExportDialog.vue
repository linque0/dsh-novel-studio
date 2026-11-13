<script setup>
import { computed, inject, onMounted, ref, watch } from 'vue'
import { collectExportChapters } from '../../../db/repo.js'
import { exportBookWithFilter, exportRowsAsZip } from '../../../services/exporter.js'
import { countWords, stripTags } from '../../../services/wordcount.js'
import { loadExportWorks, loadWorkChapters, formatCount } from '../settings-data-actions.js'
import { SETTINGS_TOAST_KEY } from '../settings-toast.js'
import SettingsDialog from '../SettingsDialog.vue'

const emit = defineEmits(['close', 'done'])
/* 与外壳共用同一条提示：自己造第二条会出现两条并存、撤销回调各指一处 */
const toast = inject(SETTINGS_TOAST_KEY, null)

const visible = ref(false)
const error = ref('')
const busy = ref(false)
const loadingWork = ref(false)
const works = ref([])
const volumes = ref([])
const chapters = ref([])
const workId = ref('')
const format = ref('txt')
const zip = ref(false)
const picked = ref(new Set())

const FORMATS = [
  { value: 'txt', label: 'TXT 纯文本' },
  { value: 'md', label: 'Markdown' },
  { value: 'docx', label: 'Word' }
]

const canConfirm = computed(() => !busy.value && !loadingWork.value && picked.value.size > 0)

function wordsOf(row) {
  const raw = row?.content == null ? '' : String(row.content)
  return countWords(row?.fmt === 'html' ? stripTags(raw) : raw)
}

function chapterChecked(id) {
  return picked.value.has(id)
}

function toggleChapter(id, checked) {
  const next = new Set(picked.value)
  if (checked) next.add(id)
  else next.delete(id)
  picked.value = next
}

async function loadWork(id) {
  loadingWork.value = true
  error.value = ''
  volumes.value = []
  chapters.value = []
  picked.value = new Set()
  try {
    const bundle = await loadWorkChapters(id)
    if (id !== workId.value) return
    volumes.value = bundle.volumes
    chapters.value = bundle.chapters
    picked.value = new Set(bundle.chapters.map((row) => row.id))
  } catch (err) {
    if (id === workId.value) error.value = String(err?.message || err)
  } finally {
    if (id === workId.value) loadingWork.value = false
  }
}

async function boot() {
  works.value = await loadExportWorks()
  workId.value = works.value[0]?.id || ''
}

function close() {
  if (busy.value) return
  visible.value = false
  setTimeout(() => emit('close'), 0)
}

async function confirm() {
  if (!canConfirm.value) return
  const work = works.value.find((row) => row.id === workId.value)
  if (!work) return
  busy.value = true
  error.value = ''
  try {
    const saved = zip.value
      ? await exportRowsAsZip(work, collectExportChapters(volumes.value, chapters.value, picked.value), format.value)
      : await exportBookWithFilter(work, volumes.value, chapters.value, format.value, picked.value)
    if (saved?.canceled) return
  } catch (err) {
    error.value = String(err?.message || err)
    return
  } finally {
    busy.value = false
  }
  toast?.show(zip.value ? `已导出 ZIP 压缩包（${picked.value.size} 章）。` : '正文文件已生成。')
  emit('done')
  close()
}

watch(workId, (id) => {
  if (id) loadWork(id)
})

onMounted(async () => {
  visible.value = true
  try {
    await boot()
  } catch (err) {
    error.value = String(err?.message || err)
  }
})
</script>

<template>
  <SettingsDialog :open="visible" :closable="!busy" title="导出正文" @update:open="close">
    <div class="form-field">
      <label for="export-work">选择作品</label>
      <select id="export-work" v-model="workId" :disabled="busy || loadingWork">
        <option v-for="row in works" :key="row.id" :value="row.id">{{ row.title || '未命名作品' }}</option>
      </select>
    </div>

    <div class="form-field">
      <label>文件格式</label>
      <div class="export-format-row" role="group" aria-label="导出选项">
        <button
          v-for="item in FORMATS"
          :key="item.value"
          type="button"
          class="btn small"
          :class="{ primary: format === item.value }"
          :disabled="busy"
          :aria-pressed="format === item.value"
          @click="format = item.value"
        >{{ item.label }}</button>
        <button type="button" class="btn small settings-export-zip" :class="{ primary: zip }" :disabled="busy" :aria-pressed="zip" @click="zip = !zip">ZIP 打包</button>
      </div>
      <p v-if="zip" class="dialog-note">每章一个 {{ FORMATS.find(item => item.value === format).label }} 文件，按卷分目录。</p>
    </div>

    <div class="form-field">
      <label>选择章节</label>
      <p v-if="loadingWork" class="dialog-note" role="status">正在读取章节…</p>
      <div v-else id="export-chapters">
        <label v-for="row in chapters" :key="row.id" class="chapter-pick">
          <!-- 内联复位：皮肤里的 .form-field input{width:100%;padding;border;background} 会命中章节复选框，
               把每一行挤成一列竖排字（总稿截图同样如此）。设置页不能改皮肤，只能就地抵消。 -->
          <input
            type="checkbox"
            name="export-chapter"
            :value="row.id"
            :checked="chapterChecked(row.id)"
            :disabled="busy"
            style="width: auto; padding: 0; border: 0; background: none; flex: none"
            @change="toggleChapter(row.id, $event.target.checked)"
          />
          <span>{{ row.title || '未命名章节' }}</span>
          <small>{{ formatCount(wordsOf(row)) }} 字</small>
        </label>
        <p v-if="!chapters.length" class="dialog-note">这部作品还没有正文。</p>
      </div>
    </div>

    <template #footer>
      <span v-if="busy" role="status">正在导出 {{ picked.size }} 章…</span>
      <button type="button" class="btn" data-act="dialog-close" :disabled="busy" @click="close">取消</button>
      <button type="button" class="btn primary" data-act="export-confirm" :disabled="!canConfirm" @click="confirm">
        {{ zip ? `打包导出 ${picked.size} 章` : '生成文件' }}
      </button>
    </template>
    <template #error>{{ error }}</template>
  </SettingsDialog>
</template>

<style scoped>
.export-format-row { display: flex; gap: 6px; flex-wrap: wrap; }
.settings-export-zip { margin-inline-start: 4px; }
</style>
