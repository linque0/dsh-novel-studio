<script setup>
/* 导出正文（总稿 app.mjs:53-54,88 showExport/exportChapters/export-confirm）。
 *
 * 只做「选作品 + 选章节 + 选格式」这一层，落盘交给 services/exporter.js 的 exportBookWithFilter：
 * 它在浏览器里触发下载、在 Electron 里弹保存对话框，文件名与卷章顺序都由既有实现决定，
 * 设置页再拼一套只会和正文页导出的文件不一致。
 * 格式第三项 Word 是插件真实能力（exporter.js 的 docx 分支），总稿只有 TXT/Markdown，这里补齐。 */
import { computed, inject, onMounted, ref, watch } from 'vue'
import { exportBookWithFilter } from '../../../services/exporter.js'
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
const works = ref([])
const volumes = ref([])
const chapters = ref([])
const workId = ref('')
const format = ref('txt')
const picked = ref(new Set())

const FORMATS = [
  { value: 'txt', label: 'TXT' },
  { value: 'md', label: 'Markdown' },
  { value: 'docx', label: 'Word' }
]

const chapterCount = computed(() => chapters.value.length)
const canConfirm = computed(() => !busy.value && picked.value.size > 0 && chapterCount.value > 0)

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
  const bundle = await loadWorkChapters(id)
  volumes.value = bundle.volumes
  chapters.value = bundle.chapters
  picked.value = new Set(bundle.chapters.map((row) => row.id))
}

async function boot() {
  works.value = await loadExportWorks()
  workId.value = works.value[0]?.id || ''
  if (workId.value) await loadWork(workId.value)
}

function close() {
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
    const saved = await exportBookWithFilter(work, volumes.value, chapters.value, format.value, new Set(picked.value))
    if (saved?.canceled) {
      close()
      return
    }
    toast?.show('正文文件已生成。')
    emit('done')
    close()
  } catch (err) {
    error.value = String(err?.message || err)
  } finally {
    busy.value = false
  }
}

watch(workId, (id) => {
  if (id) loadWork(id)
})

onMounted(async () => {
  visible.value = true
  await boot()
})
</script>

<template>
  <SettingsDialog :open="visible" title="导出正文" @update:open="close">
    <div class="form-field">
      <label for="export-work">选择作品</label>
      <select id="export-work" v-model="workId">
        <option v-for="row in works" :key="row.id" :value="row.id">{{ row.title || '未命名作品' }}</option>
      </select>
    </div>

    <div class="form-field">
      <label>文件格式</label>
      <div class="radio-row">
        <label v-for="item in FORMATS" :key="item.value">
          <input v-model="format" type="radio" name="export-format" :value="item.value" />
          {{ item.label }}
        </label>
      </div>
    </div>

    <div class="form-field">
      <label>选择章节</label>
      <div id="export-chapters">
        <label v-for="row in chapters" :key="row.id" class="chapter-pick">
          <!-- 内联复位：皮肤里的 .form-field input{width:100%;padding;border;background} 会命中章节复选框，
               把每一行挤成一列竖排字（总稿截图同样如此）。设置页不能改皮肤，只能就地抵消。 -->
          <input
            type="checkbox"
            name="export-chapter"
            :value="row.id"
            :checked="chapterChecked(row.id)"
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
      <button type="button" class="btn" data-act="dialog-close" @click="close">取消</button>
      <button type="button" class="btn primary" data-act="export-confirm" :disabled="!canConfirm" @click="confirm">生成文件</button>
    </template>
    <template #error>{{ error }}</template>
  </SettingsDialog>
</template>
