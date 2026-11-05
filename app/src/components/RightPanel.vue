<script setup>
import { computed, ref, watch } from 'vue'
import { NButton, NTag, NPopconfirm } from 'naive-ui'
import OIcon from './OIcon.vue'
import { useWorkStore } from '../stores/work'
import { useUiStore } from '../stores/ui'
import { pickFiles, arrayBufferToBlob, imageMime, IMAGE_EXTS } from '../services/fileio'
import { stripTags } from '../services/wordcount'
import { primaryRole } from '../services/character-tags'
import { ANNOTATION_KINDS, normalizeNoteColor, noteKindLabel, focusNoteMark, recolorNoteMark } from '../services/annotations'

const work = useWorkStore()
const ui = useUiStore()
const ch = computed(() => work.activeChapter)

/* ---------- 正文批注（右侧批注栏）：逐条对应正文中被批注的文字 ---------- */
const notes = computed(() => (ch.value ? work.annotationsForChapter(ch.value.id) : []))
const liveNotes = computed(() => notes.value.filter((n) => !n.orphan))
const orphanNotes = computed(() => notes.value.filter((n) => n.orphan))
const activeNoteId = ref(null)
const editingId = ref(null)
const draft = ref('')
const draftColor = ref(ANNOTATION_KINDS[0].color)
const editOrigin = ref(null)

watch(
  () => ch.value?.id,
  () => {
    activeNoteId.value = null
    editingId.value = null
    editOrigin.value = null
  }
)

function locate(n) {
  activeNoteId.value = n.id
  focusNoteMark(n.noteId)
}
function startEdit(n) {
  editingId.value = n.id
  draft.value = n.note || ''
  draftColor.value = normalizeNoteColor(n.color)
  editOrigin.value = { id: n.id, noteId: n.noteId, color: normalizeNoteColor(n.color) }
}
/** 取消编辑：颜色是即时预览落库的，需回滚到进入编辑时的值 */
function cancelEdit() {
  const o = editOrigin.value
  if (o) {
    work.updateAnnotation(o.id, { color: o.color })
    recolorNoteMark(o.noteId, o.color)
  }
  editingId.value = null
  editOrigin.value = null
}
function saveEdit(n) {
  work.updateAnnotation(n.id, { note: draft.value, color: draftColor.value })
  recolorNoteMark(n.noteId, draftColor.value)
  editingId.value = null
  editOrigin.value = null
}
function onEditColor(n, c) {
  draftColor.value = c
  // 颜色即时预览：正文下划线随之变化，保存时一并落库
  work.updateAnnotation(n.id, { color: c })
  recolorNoteMark(n.noteId, c)
}
function removeNote(n) {
  work.deleteAnnotation(n.id)
  if (activeNoteId.value === n.id) activeNoteId.value = null
  if (editingId.value === n.id) editingId.value = null
  window.$msg?.success('批注已移除')
}
function pruneOrphans() {
  const n = work.pruneOrphanAnnotations(ch.value.id)
  window.$msg?.success(n ? `已清理 ${n} 条失效批注` : '没有失效批注')
}
const fmtTime = (t) => new Date(t || Date.now()).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })

const outline = computed(() => (ch.value ? work.olnodeByRef(ch.value.id) : null))
function onSpeedNote(e) {
  if (!ch.value) return
  // 8.8.2-G1 懒挂载：首次输入才创建章节锚点节点
  const n = work.ensureChapterAnchor(ch.value.id)
  if (!n) return
  work.olnodeSetRich(n.id, e.target.value, null)
}

const gotoOutlineEditor = () => {
  if (!outline.value) return
  work.tab = 'outline'
  work.outlineView = 'text'
  work.selOlnodeId = outline.value.id
}

const presentChars = computed(() => {
  if (!ch.value) return []
  const text = ch.value.fmt === 'html' ? stripTags(ch.value.content) : ch.value.content || ''
  return work.liveCharacters
    .filter((c) => {
      const names = [c.name, ...(c.aliases || '').split(/[,，、/\s]+/)].filter((n) => n && n.length >= 1)
      return names.some((n) => text.includes(n))
    })
    .map((c) => ({ id: c.id, name: c.name, role: primaryRole(c) }))
})

const images = computed(() => {
  if (!ch.value) return []
  void work.urlTick
  return work.linksFor('chapter', ch.value.id).map((link) => ({ link, url: work.assetUrl(link.assetId) }))
})

async function uploadImages() {
  if (!ch.value) return
  const files = await pickFiles(IMAGE_EXTS)
  if (!files.length) return
  const ids = []
  for (const f of files) {
    const meta = await work.addAssetBlob(arrayBufferToBlob(f.data, imageMime(f.ext)), f.name)
    await work.linkAsset('chapter', ch.value.id, meta.id)
    ids.push(meta.id)
  }
  await work.warmUrls(ids)
}

watch(
  () => ch.value?.id,
  async () => {
    if (!ch.value) return
    const ids = work.linksFor('chapter', ch.value.id).map((l) => l.assetId)
    if (ids.length) await work.warmUrls(ids)
  },
  { immediate: true }
)
</script>

<template>
  <div v-if="ch" class="right-panel">
    <!-- 吸附顶条：内容滚动时始终可见，保证任意滚动位置都能收起 -->
    <div class="rp-head">
      <span class="rp-cap">批注栏</span>
      <button class="rp-fold" title="收起批注栏，留出正文空间（从右缘细轨可再展开）" @click="ui.setPref('rightPanelOpen', false)">
        <OIcon name="caret-right" :size="13" />
      </button>
    </div>
    <div class="rp-section rp-notes">
      <div class="rp-title">
        本章批注
        <span class="rp-title-tools">
          <span v-if="notes.length" class="note-count">{{ liveNotes.length }} 条<span v-if="orphanNotes.length"> · {{ orphanNotes.length }} 失效</span></span>
          <NButton v-if="orphanNotes.length" size="tiny" quaternary @click="pruneOrphans">清理失效</NButton>
        </span>
      </div>
      <div v-if="!notes.length" style="font-size: 12px; color: var(--text-dim)">
        选中正文后右键「添加批注」，被批注的文字会带彩色下划线，在此逐条查看。
      </div>

      <div
        v-for="n in notes"
        :key="n.id"
        class="note-item"
        :class="{ active: activeNoteId === n.id, orphan: n.orphan }"
        :style="{ '--note-color': normalizeNoteColor(n.color) }"
        role="button"
        tabindex="0"
        @click="locate(n)"
        @keydown.enter="locate(n)"
      >
        <div class="note-head">
          <span class="note-dot" :style="{ background: normalizeNoteColor(n.color) }"></span>
          <span class="note-kind-label">{{ noteKindLabel(n.color) }}</span>
          <span class="note-time">{{ fmtTime(n.createdAt) }}</span>
        </div>
        <div class="note-quote" :class="{ dim: n.orphan }">{{ n.text || '（无引用文字）' }}</div>

        <template v-if="editingId === n.id">
          <textarea v-model="draft" class="rp-textarea note-edit-area" placeholder="批注内容…" @click.stop @keydown.stop></textarea>
          <div class="note-kind-row" @click.stop>
            <button
              v-for="k in ANNOTATION_KINDS"
              :key="k.key"
              type="button"
              class="note-kind"
              :class="{ on: normalizeNoteColor(draftColor) === k.color }"
              @click="onEditColor(n, k.color)"
            >
              <span class="note-kind-dot" :style="{ background: k.color }"></span>{{ k.label }}
            </button>
            <input
              :value="normalizeNoteColor(draftColor)"
              type="color"
              class="note-color-input"
              title="自定义下划线颜色"
              @input="onEditColor(n, $event.target.value)"
            />
          </div>
          <div class="note-actions" @click.stop>
            <NButton size="tiny" type="primary" @click="saveEdit(n)">保存</NButton>
            <NButton size="tiny" @click="cancelEdit">取消</NButton>
          </div>
        </template>
        <template v-else>
          <div v-if="n.note" class="note-body">{{ n.note }}</div>
          <div v-else class="note-body empty">（未填写批注内容）</div>
          <div v-if="n.orphan" class="note-orphan-tip">原文已改动，锚点失效——点击无法定位</div>
          <div class="note-actions" @click.stop>
            <NButton size="tiny" quaternary @click="startEdit(n)">编辑</NButton>
            <NPopconfirm @positive-click="removeNote(n)">
              <template #trigger><NButton size="tiny" quaternary type="error">删除</NButton></template>
              删除该批注（保留正文文字）？
            </NPopconfirm>
          </div>
        </template>
      </div>
    </div>

    <div class="rp-materials">
    <div class="rp-section">
      <div class="rp-title">
        本章大纲
        <NButton v-if="outline" size="tiny" @click="gotoOutlineEditor">去编辑</NButton>
      </div>
      <textarea
        class="rp-textarea"
        style="min-height: 80px"
        :value="outline?.text || ''"
        placeholder="本章要点速记（输入即挂到大纲画布）"
        @input="onSpeedNote"
      ></textarea>
    </div>

    <div class="rp-section">
      <div class="rp-title">本章出场人物</div>
      <div v-if="!presentChars.length" style="font-size: 12px; color: var(--text-dim)">正文中暂未检测到已建人物的名字</div>
      <div
        v-for="c in presentChars"
        :key="c.id"
        class="side-item"
        style="padding: 5px 8px"
        role="button"
        tabindex="0"
        @click="work.navTo('characters', c.id)"
        @keydown.enter="work.navTo('characters', c.id)"
      >
        <NTag size="tiny" :bordered="false">{{ c.role }}</NTag>
        <span>{{ c.name }}</span>
      </div>
    </div>

    <div class="rp-section">
      <div class="rp-title">
        本章插图
        <NButton size="tiny" @click="uploadImages"><OIcon name="plus" :size="11" /> 上传</NButton>
      </div>
      <div v-if="!images.length" style="font-size: 12px; color: var(--text-dim)">拖拽或粘贴图片到正文可直接添加</div>
      <div class="thumb-grid">
        <div v-for="it in images" :key="it.link.id" class="thumb">
          <img v-if="it.url" :src="it.url" />
          <button class="x" @click="work.unlinkAsset(it.link.id)"><OIcon name="close" :size="11" /></button>
        </div>
      </div>
    </div>

    <div class="rp-section">
      <div class="rp-title">本章信息</div>
      <div style="font-size: 12px; color: var(--text-dim); line-height: 2">
        字数：{{ ch.wordCount || 0 }}<br />
        状态：{{ { draft: '草稿', done: '完成', revise: '待修改' }[ch.status] }}<br />
        更新：{{ new Date(ch.updatedAt || Date.now()).toLocaleString('zh-CN') }}
      </div>
    </div>
    </div>
  </div>
</template>
