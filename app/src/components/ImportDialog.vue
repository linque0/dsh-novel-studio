<script setup>
import { ref, computed } from 'vue'
import { NModal, NButton, NInput, NRadioGroup, NRadio, NCheckbox, NTag, NAlert, useMessage } from 'naive-ui'
import { useWorkStore } from '../stores/work'
import { useShelfStore } from '../stores/shelf'
import { useUiStore } from '../stores/ui'
import { pickFiles, arrayBufferToBlob, imageMime } from '../services/fileio'
import { parseImportFiles, pdfPagesToImages, DOC_EXTS, IMAGE_EXTS } from '../services/importers'
import { countWords } from '../services/wordcount'
import { autosave } from '../services/autosave'

const work = useWorkStore()
const shelf = useShelfStore()
const ui = useUiStore()
const msg = useMessage()

const plan = ref(null)
const busy = ref(false)
const progress = ref('')
const target = ref('new')
const newTitle = ref('')
const mergeOne = ref(false)

const targetOptions = computed(() => [
  { label: '导入为新作品', value: 'new' },
  { label: '追加为当前作品章节', value: 'append', disabled: !work.loaded },
  { label: '存入当前作品灵感', value: 'snippet', disabled: !work.loaded }
])

const flatSections = computed(() => {
  if (!plan.value) return []
  const out = []
  for (const d of plan.value.docs) for (const s of d.sections) out.push({ ...s, file: d.file })
  return out
})
const preview = computed(() => flatSections.value.slice(0, 200))
const scannedDocs = computed(() => (plan.value?.docs || []).filter((d) => d.scanned && !d.sections?.length))

async function choose() {
  const files = await pickFiles([...DOC_EXTS, ...IMAGE_EXTS])
  if (!files.length) return
  busy.value = true
  plan.value = null
  progress.value = ''
  try {
    const p = await parseImportFiles(files, (i, n) => (progress.value = `解析中 ${i}/${n} 页`))
    if (!p.docs.length && !p.images.length) {
      msg.warning('没有可识别的文件（支持 txt / md / docx / pdf / epub 与常见图片）')
      return
    }
    plan.value = p
    newTitle.value = p.docs[0] ? p.docs[0].file.replace(/\.[^.]+$/, '') : '导入作品'
    target.value = work.loaded ? 'append' : 'new'
  } catch (e) {
    msg.error('解析失败：' + (e?.message || e))
  } finally {
    busy.value = false
  }
}

async function appendSections(sections) {
  for (const s of sections) {
    const ch = await work.addChapter(null, s.title)
    work.setChapterContent(ch.id, s.text)
  }
  if (sections.length) await autosave.flushAll()
}

async function confirmImport() {
  if (!plan.value) return
  busy.value = true
  try {
    let sections
    if (mergeOne.value) {
      sections = plan.value.docs.map((d) => ({
        title: d.file.replace(/\.[^.]+$/, '').slice(0, 40),
        text: d.sections.map((s) => s.title + '\n\n' + s.text).join('\n\n')
      }))
    } else {
      sections = flatSections.value
    }

    let chapterCount = 0
    if (target.value === 'new') {
      const w = await shelf.createWork({ title: (newTitle.value || '导入作品').trim(), withVolume: true })
      await work.open(w.id)
      await appendSections(sections)
      chapterCount = sections.length
      msg.success(`已创建《${w.title}》并导入 ${chapterCount} 章`)
      ui.importOpen = false
    } else if (target.value === 'append') {
      await appendSections(sections)
      chapterCount = sections.length
      msg.success(`已追加 ${chapterCount} 章`)
      ui.importOpen = false
    } else if (target.value === 'snippet') {
      for (const d of plan.value.docs) {
        const text = d.sections.map((s) => s.title + '\n' + s.text).join('\n\n')
        work.addSnippet(text.slice(0, 50000))
      }
      msg.success('文档内容已存入灵感')
      ui.importOpen = false
    }

    if (plan.value.images.length) {
      if (!work.loaded) {
        msg.warning('图片导入需要先打开一个作品（在书架点开作品后再导入）')
      } else {
        for (const f of plan.value.images) {
          await work.addAssetBlob(arrayBufferToBlob(f.data, imageMime(f.ext)), f.name)
        }
        msg.success(`已导入 ${plan.value.images.length} 张图片到素材库`)
        ui.importOpen = false
      }
    }
  } catch (e) {
    msg.error('导入失败：' + (e?.message || e))
  } finally {
    busy.value = false
  }
}

async function pdfToImages(d) {
  if (!work.loaded) {
    msg.warning('请先打开一个作品，再转存扫描页')
    return
  }
  busy.value = true
  try {
    const imgs = await pdfPagesToImages(d.raw, 30, (i, n) => (progress.value = `渲染 ${i}/${n} 页`))
    for (const it of imgs) await work.addAssetBlob(it.blob, it.name)
    msg.success(`已转存 ${imgs.length} 页为图片素材`)
  } finally {
    busy.value = false
  }
}

function reset() {
  plan.value = null
  mergeOne.value = false
}
</script>

<template>
  <NModal
    :show="ui.importOpen"
    preset="card"
    title="导入文件"
    style="width: 720px"
    @update:show="(v) => { ui.importOpen = v; if (!v) reset() }"
  >
    <template v-if="!plan">
      <div class="ns-import-pick" style="text-align: center; padding: 18px 0">
        <NButton size="large" type="primary" :loading="busy" @click="choose">选择文件…</NButton>
        <p style="margin-top: 14px; font-size: 12px; color: var(--text-dim); line-height: 2">
          支持 TXT / Markdown / Word(.docx) / PDF / EPUB / 常见图片格式<br />
          TXT 自动识别 GBK 等编码并按章节标题智能分章；Word 按标题样式分章；PDF 优先按书签目录分章
        </p>
        <p v-if="progress" style="color: var(--accent)">{{ progress }}</p>
      </div>
    </template>

    <template v-else>
      <div v-for="d in plan.docs" :key="d.file" style="margin-bottom: 12px">
        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px">
          <b>{{ d.file }}</b>
          <NTag size="tiny" :bordered="false">编码 {{ d.encoding }}</NTag>
          <NTag size="tiny" :bordered="false">{{ d.sections?.length || 0 }} 章</NTag>
        </div>
        <NAlert v-if="d.scanned && !d.sections?.length" type="warning" style="margin-bottom: 8px">
          该 PDF 未检测到文字层（可能是扫描件）。可转存为图片素材，OCR 识别将在后续版本提供。
          <NButton size="tiny" style="margin-left: 8px" :disabled="!work.loaded" @click="pdfToImages(d)">按页转存为图片</NButton>
        </NAlert>
      </div>

      <div v-if="flatSections.length" style="border: 1px solid var(--border); border-radius: 8px; max-height: 220px; overflow: auto; margin-bottom: 12px">
        <div
          v-for="(s, i) in preview"
          :key="i"
          style="display: flex; gap: 10px; padding: 5px 12px; font-size: 13px; border-bottom: 1px solid var(--border)"
        >
          <span style="color: var(--text-dim); width: 26px">{{ i + 1 }}</span>
          <span style="flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap">{{ s.title }}</span>
          <span style="color: var(--text-dim)">{{ countWords(s.text) }} 字</span>
        </div>
        <div v-if="flatSections.length > 200" style="padding: 6px 12px; font-size: 12px; color: var(--text-dim)">
          …还有 {{ flatSections.length - 200 }} 章未显示
        </div>
      </div>

      <div v-if="plan.images.length" style="margin-bottom: 12px; font-size: 13px">
        检测到 {{ plan.images.length }} 张图片，将导入当前作品的素材库。
      </div>

      <div style="display: flex; flex-direction: column; gap: 10px; margin-bottom: 14px">
        <NRadioGroup v-model:value="target">
          <NRadio v-for="o in targetOptions" :key="o.value" :value="o.value" :disabled="o.disabled">{{ o.label }}</NRadio>
        </NRadioGroup>
        <NInput v-if="target === 'new'" v-model:value="newTitle" placeholder="新书名" style="width: 300px" />
        <NCheckbox v-model:checked="mergeOne" size="small">合并为单章（每个文件一章）</NCheckbox>
      </div>

      <div style="display: flex; justify-content: flex-end; gap: 8px">
        <NButton :disabled="busy" @click="reset">重新选择</NButton>
        <NButton type="primary" :loading="busy" @click="confirmImport">确认导入</NButton>
      </div>
    </template>
  </NModal>
</template>
