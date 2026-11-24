<!-- 宽幅居中玻璃专注编辑浮窗（新建 / 编辑合一）：
     左侧统一内容流承载「标题 → 正文 → 参考图片 → 网址链接」（不混排插入正文，保持纯文本 content 兼容）；
     右侧可收起属性栏承载卡色、标签、作品关联、转换与元信息。
     编辑态：图片/网址/属性即时落库并进撤销栈；标题与正文 800ms 防抖自动保存，关闭前自动冲刷。 -->
<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import OIcon from '../OIcon.vue'
import SnipModal from './SnipModal.vue'
import {
  formatWebLinkHost,
  normalizeExternalUrl,
  normalizeTag,
  normalizeTags,
  pickSnipCardColor,
  SNIP_CARD_COLORS,
  splitNote
} from './snippet-model.js'

const props = defineProps({
  mode: { type: String, default: 'edit' }, // 'edit' | 'compose'
  note: { type: Object, default: null },
  draft: { type: Object, default: null },
  initialTag: { type: String, default: '' },
  initialQuick: { type: String, default: '' },
  busy: Boolean,
  saveError: Boolean,
  conflict: Boolean,
  workTitle: { type: String, default: '' },
  knownTags: { type: Array, default: () => [] },
  assetUrl: { type: Function, required: true },
  pickImages: { type: Function, required: true },
  uploadBlobs: { type: Function, required: true }
})

const emit = defineEmits([
  'close',
  'create',
  'save',
  'update-draft',
  'update-quick',
  'resolve-conflict',
  'retry',
  'add-tag',
  'untag',
  'set-color',
  'add-images',
  'remove-image',
  'set-cover',
  'add-web-link',
  'update-web-link',
  'remove-web-link',
  'open-url',
  'open-lightbox',
  'open-link',
  'unlink',
  'preview',
  'convert',
  'remove'
])

const isCompose = computed(() => props.mode === 'compose')
const kindLabel = { chapter: '正文', mubu: '设定', character: '人物' }
const kindIcon = { chapter: 'books', mubu: 'note', character: 'user' }
const colorEntries = Object.entries(SNIP_CARD_COLORS)

const asideOpen = ref(typeof window === 'undefined' ? true : window.innerWidth >= 860)
const titleInput = ref(null)
const bodyInput = ref(null)

// 公共输入态（新建态使用本地状态，编辑态受 props.draft / props.note 驱动）
const titleVal = ref('')
const bodyVal = ref('')
const composing = ref(false)
const uploading = ref(false)
const dragImageOver = ref(false)
const formError = ref('')

// 新建态本地附加字段
const composeImages = ref([])
const composeWebLinks = ref([])
const composeTags = ref([])
const composeColor = ref(pickSnipCardColor())

// 网址新增与行内编辑态
const newUrl = ref('')
const newUrlTitle = ref('')
const urlError = ref('')
const editingLinkId = ref('')
const editLinkUrl = ref('')
const editLinkTitle = ref('')
const copiedLinkId = ref('')

// 标签输入
const tagText = ref('')

let autoSaveTimer = 0
let copyTimer = 0

function syncFromProps() {
  clearTimeout(autoSaveTimer)
  formError.value = ''
  urlError.value = ''
  editingLinkId.value = ''
  if (isCompose.value) {
    const parsed = splitNote({ content: props.initialQuick || '' })
    titleVal.value = parsed.title
    bodyVal.value = parsed.body
    composeImages.value = []
    composeWebLinks.value = []
    composeTags.value = props.initialTag ? normalizeTags([props.initialTag]) : []
    composeColor.value = pickSnipCardColor()
    return
  }
  const src = props.draft || { title: props.note?.title || '', body: props.note?.body || '' }
  titleVal.value = src.title ?? ''
  bodyVal.value = src.body ?? ''
}

watch(
  () => [props.mode, props.note?.id],
  () => {
    composing.value = false
    tagText.value = ''
    syncFromProps()
    nextTick(() => {
      autoResizeBody()
      titleInput.value?.focus({ preventScroll: true })
    })
  },
  { immediate: true }
)

// 外部（如撤销/重做或右侧栏提交）改动已保存正文且本地未脏时同步刷新
watch(
  () => [props.note?.title, props.note?.body, props.draft?.title, props.draft?.body],
  () => {
    if (isCompose.value || composing.value) return
    const src = props.draft || { title: props.note?.title || '', body: props.note?.body || '' }
    if (titleVal.value !== (src.title ?? '')) titleVal.value = src.title ?? ''
    if (bodyVal.value !== (src.body ?? '')) {
      bodyVal.value = src.body ?? ''
      nextTick(autoResizeBody)
    }
  }
)

watch(
  () => props.note?.tags,
  () => {
    if (!isCompose.value && props.note?.tags?.includes(normalizeTag(tagText.value))) tagText.value = ''
  }
)

const displayImages = computed(() => (isCompose.value ? composeImages.value : props.note?.images || []))
const displayWebLinks = computed(() => (isCompose.value ? composeWebLinks.value : props.note?.webLinks || []))
const displayTags = computed(() => (isCompose.value ? composeTags.value : props.note?.tags || []))
const displayColor = computed(() => (isCompose.value ? composeColor.value : props.note?.cardColor || 'default'))

const dirty = computed(() => {
  if (isCompose.value) {
    return Boolean(titleVal.value.trim() || bodyVal.value.trim() || composeImages.value.length || composeWebLinks.value.length)
  }
  return titleVal.value !== (props.note?.title ?? '') || bodyVal.value !== (props.note?.body ?? '')
})

const saveStatus = computed(() => {
  if (isCompose.value) return null
  if (props.saveError) return { kind: 'error', text: '保存失败' }
  if (props.conflict) return { kind: 'conflict', text: '内容冲突' }
  if (props.busy || uploading.value) return { kind: 'saving', text: '保存中…' }
  if (dirty.value && !titleVal.value.trim()) return { kind: 'warn', text: '请填写标题' }
  if (dirty.value) return { kind: 'pending', text: '自动保存中…' }
  return { kind: 'saved', text: '已保存' }
})

function autoResizeBody() {
  const el = bodyInput.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = Math.max(200, el.scrollHeight) + 'px'
}

function scheduleAutoSave() {
  clearTimeout(autoSaveTimer)
  if (isCompose.value || composing.value || props.conflict || !dirty.value) return
  if (!titleVal.value.trim()) return
  autoSaveTimer = setTimeout(() => {
    flushEditSave(true)
  }, 800)
}

function onTextInput() {
  formError.value = ''
  autoResizeBody()
  if (isCompose.value) {
    const combined = [titleVal.value.trim(), bodyVal.value].filter(Boolean).join('\n\n')
    emit('update-quick', combined)
    return
  }
  emit('update-draft', { title: titleVal.value, body: bodyVal.value })
  scheduleAutoSave()
}

function onCompositionEnd() {
  composing.value = false
  onTextInput()
}

function flushEditSave(silent = false) {
  clearTimeout(autoSaveTimer)
  if (isCompose.value || composing.value || props.busy || props.conflict || !dirty.value) return false
  if (!titleVal.value.trim()) {
    if (!silent) formError.value = '请保留一个标题后再保存。'
    return false
  }
  emit('save', { title: titleVal.value, body: bodyVal.value, silent })
  return true
}

function submitCompose() {
  if (composing.value || props.busy || uploading.value) return
  const cleanTitle = titleVal.value.trim()
  const cleanBody = bodyVal.value.trim()
  if (!cleanTitle && !cleanBody && !composeImages.value.length && !composeWebLinks.value.length) {
    formError.value = '先写下一点想法，或添加图片、网址再创建。'
    titleInput.value?.focus({ preventScroll: true })
    return
  }
  let finalTitle = cleanTitle
  let finalBody = bodyVal.value
  if (!finalTitle) {
    if (cleanBody) {
      const split = splitNote({ content: cleanBody })
      finalTitle = split.title || '新灵感'
      finalBody = split.body
    } else if (composeImages.value.length) {
      finalTitle = '图片灵感'
    } else {
      finalTitle = '网页收藏'
    }
  }
  formError.value = ''
  emit('create', {
    title: finalTitle,
    body: finalBody,
    tags: [...composeTags.value],
    cardColor: composeColor.value,
    images: [...composeImages.value],
    webLinks: [...composeWebLinks.value]
  })
}

function handleClose() {
  clearTimeout(autoSaveTimer)
  if (!isCompose.value && dirty.value && !props.conflict && titleVal.value.trim()) {
    emit('save', { title: titleVal.value, body: bodyVal.value, silent: true })
  }
  emit('close')
}

function onKeydown(event) {
  if (event.isComposing || composing.value) return
  const mod = event.ctrlKey || event.metaKey
  if (mod && event.key.toLowerCase() === 's') {
    event.preventDefault()
    if (isCompose.value) submitCompose()
    else flushEditSave(false)
  } else if (mod && event.key === 'Enter' && isCompose.value) {
    event.preventDefault()
    submitCompose()
  }
}

/* ---------- 图片：选图 / 拖拽 / Ctrl+V 粘贴 / 设封面 / 移除 ---------- */
async function handlePickImages() {
  if (uploading.value || props.busy) return
  uploading.value = true
  try {
    const added = await props.pickImages()
    if (!added?.length) return
    if (isCompose.value) {
      const existing = new Set(composeImages.value.map((i) => i.assetId))
      composeImages.value = [...composeImages.value, ...added.filter((i) => !existing.has(i.assetId))]
    } else {
      emit('add-images', added)
    }
  } finally {
    uploading.value = false
  }
}

async function handleImageFiles(rawFiles) {
  const files = [...(rawFiles || [])].filter((f) => f && /^image\//i.test(f.type || ''))
  if (!files.length || uploading.value || props.busy) return false
  uploading.value = true
  try {
    const added = await props.uploadBlobs(files)
    if (!added?.length) return false
    if (isCompose.value) {
      const existing = new Set(composeImages.value.map((i) => i.assetId))
      composeImages.value = [...composeImages.value, ...added.filter((i) => !existing.has(i.assetId))]
    } else {
      emit('add-images', added)
    }
    return true
  } finally {
    uploading.value = false
  }
}

async function onPaste(event) {
  const items = [...(event.clipboardData?.items || [])]
  const files = items
    .filter((item) => item.kind === 'file' && /^image\//i.test(item.type || ''))
    .map((item) => item.getAsFile())
    .filter(Boolean)
  if (!files.length) return
  event.preventDefault()
  await handleImageFiles(files)
}

function onImageDragOver(event) {
  if ([...(event.dataTransfer?.types || [])].includes('Files')) {
    event.preventDefault()
    dragImageOver.value = true
  }
}

function onImageDragLeave(event) {
  if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return
  dragImageOver.value = false
}

async function onImageDrop(event) {
  dragImageOver.value = false
  const files = event.dataTransfer?.files
  if (!files?.length) return
  event.preventDefault()
  await handleImageFiles(files)
}

function removeImage(assetId) {
  if (isCompose.value) {
    composeImages.value = composeImages.value.filter((i) => i.assetId !== assetId)
  } else {
    emit('remove-image', assetId)
  }
}

function setCoverImage(assetId) {
  if (isCompose.value) {
    const idx = composeImages.value.findIndex((i) => i.assetId === assetId)
    if (idx > 0) {
      const target = composeImages.value[idx]
      composeImages.value = [target, ...composeImages.value.slice(0, idx), ...composeImages.value.slice(idx + 1)]
    }
  } else {
    emit('set-cover', assetId)
  }
}

function openLightbox(index) {
  emit('open-lightbox', { images: displayImages.value, index })
}

/* ---------- 网址链接：新增 / 行内编辑 / 复制 / 删除 / 默认浏览器打开 ---------- */
function addWebLink() {
  urlError.value = ''
  const href = normalizeExternalUrl(newUrl.value)
  if (!href) {
    urlError.value = '请输入有效的网页地址（支持 http / https，可省略协议）。'
    return
  }
  if (displayWebLinks.value.some((l) => l.url === href)) {
    urlError.value = '这条网址已经添加过了。'
    return
  }
  const item = {
    id: 'wl-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6),
    url: href,
    title: newUrlTitle.value.trim().slice(0, 80)
  }
  if (isCompose.value) {
    composeWebLinks.value = [...composeWebLinks.value, item]
  } else {
    emit('add-web-link', item)
  }
  newUrl.value = ''
  newUrlTitle.value = ''
}

function startEditLink(item) {
  editingLinkId.value = item.id
  editLinkUrl.value = item.url
  editLinkTitle.value = item.title || ''
  urlError.value = ''
}

function cancelEditLink() {
  editingLinkId.value = ''
  urlError.value = ''
}

function saveEditLink(id) {
  urlError.value = ''
  const href = normalizeExternalUrl(editLinkUrl.value)
  if (!href) {
    urlError.value = '请输入有效的 http / https 网址。'
    return
  }
  if (displayWebLinks.value.some((l) => l.id !== id && l.url === href)) {
    urlError.value = '已存在相同的网址链接。'
    return
  }
  const updated = { id, url: href, title: editLinkTitle.value.trim().slice(0, 80) }
  if (isCompose.value) {
    composeWebLinks.value = composeWebLinks.value.map((l) => (l.id === id ? updated : l))
  } else {
    emit('update-web-link', updated)
  }
  editingLinkId.value = ''
}

function removeWebLink(id) {
  if (editingLinkId.value === id) editingLinkId.value = ''
  if (isCompose.value) {
    composeWebLinks.value = composeWebLinks.value.filter((l) => l.id !== id)
  } else {
    emit('remove-web-link', id)
  }
}

async function copyWebLink(item) {
  try {
    if (window.native?.clipboardWriteText) await window.native.clipboardWriteText(item.url)
    else await navigator.clipboard?.writeText(item.url)
    copiedLinkId.value = item.id
    clearTimeout(copyTimer)
    copyTimer = setTimeout(() => { copiedLinkId.value = '' }, 1600)
  } catch { /* ignore clipboard failure */ }
}

/* ---------- 右侧属性栏：卡色与标签 ---------- */
function selectColor(color) {
  if (isCompose.value) composeColor.value = color
  else emit('set-color', color)
}

function submitTag() {
  const t = normalizeTag(tagText.value)
  if (!t) return
  if (isCompose.value) {
    if (!composeTags.value.includes(t)) composeTags.value = [...composeTags.value, t]
    tagText.value = ''
  } else {
    emit('add-tag', t)
  }
}

function removeTag(t) {
  if (isCompose.value) composeTags.value = composeTags.value.filter((v) => v !== t)
  else emit('untag', t)
}

onMounted(() => {
  nextTick(() => {
    autoResizeBody()
    titleInput.value?.focus({ preventScroll: true })
  })
})

onBeforeUnmount(() => {
  clearTimeout(autoSaveTimer)
  clearTimeout(copyTimer)
})
</script>

<template>
  <SnipModal :label="isCompose ? '新建灵感' : '编辑灵感'" class="snip-editor-scrim" @close="handleClose">
    <div
      class="snip-dialog snip-editor-modal"
      :class="{ 'is-aside-collapsed': !asideOpen }"
      data-dialog="editor"
      role="dialog"
      :aria-label="isCompose ? '新建灵感' : '灵感编辑'"
      @keydown="onKeydown"
      @paste="onPaste"
    >
      <!-- 固定顶栏 -->
      <header class="snip-editor-head">
        <div class="snip-editor-head-left">
          <span class="snip-editor-color-dot" :data-card-color="displayColor"></span>
          <span class="snip-eyebrow">{{ isCompose ? '新建灵感' : '灵感编辑' }}</span>
          <span v-if="isCompose && initialTag" class="snip-editor-scope-pill"># {{ initialTag }}</span>
        </div>
        <div class="snip-editor-head-right">
          <template v-if="isCompose">
            <span class="snip-editor-hint">Ctrl ↵ 创建</span>
            <button type="button" class="snip-primary snip-editor-create-btn" :disabled="busy || uploading" @click="submitCompose">
              创建灵感 <OIcon name="arrow-right" :size="14" />
            </button>
          </template>
          <template v-else-if="saveStatus">
            <button
              v-if="saveStatus.kind === 'error'"
              type="button"
              class="snip-editor-status is-error"
              :disabled="busy"
              @click="emit('retry')"
            >{{ saveStatus.text }} · 重试</button>
            <span v-else class="snip-editor-status" :class="'is-' + saveStatus.kind">
              <OIcon v-if="saveStatus.kind === 'saved'" name="check" :size="12" />
              {{ saveStatus.text }}
            </span>
          </template>
          <button
            type="button"
            class="snip-soft snip-editor-aside-toggle"
            :aria-expanded="asideOpen"
            :title="asideOpen ? '收起右侧属性栏' : '展开右侧属性栏'"
            @click="asideOpen = !asideOpen"
          >
            <OIcon name="split" :size="14" />
            <span>属性</span>
          </button>
          <button type="button" class="snip-round" aria-label="关闭编辑窗口" @click="handleClose">×</button>
        </div>
      </header>

      <!-- 主体双栏：左侧统一内容流（标题/正文/图片/网址），右侧可收起属性栏 -->
      <div class="snip-editor-layout">
        <div
          class="snip-editor-main scroller"
          :class="{ 'is-drag-image': dragImageOver }"
          @dragover="onImageDragOver"
          @dragleave="onImageDragLeave"
          @drop="onImageDrop"
        >
          <div v-if="saveError" class="snip-save-error" role="alert">
            <span>保存未完成，内容已保留。</span>
            <button type="button" :disabled="busy" @click="emit('retry')">重试保存</button>
          </div>
          <div v-if="conflict && !isCompose" class="snip-conflict" role="alert">
            <p>原片段已在其他位置修改，当前草稿仍保留。请先核对已保存版本。</p>
            <details open>
              <summary>当前已保存版本</summary>
              <strong>{{ note?.title }}</strong>
              <pre>{{ note?.body }}</pre>
            </details>
            <button type="button" class="snip-soft" @click="emit('resolve-conflict')">已核对，继续编辑</button>
          </div>
          <div v-if="formError" class="snip-form-error" role="alert">{{ formError }}</div>

          <!-- 1. 标题 -->
          <input
            ref="titleInput"
            v-model="titleVal"
            type="text"
            name="editor-title"
            class="snip-editor-title"
            aria-label="灵感标题"
            placeholder="写一个清晰的标题…"
            @input="onTextInput"
            @compositionstart="composing = true"
            @compositionend="onCompositionEnd"
            @keydown.enter.prevent="bodyInput?.focus({ preventScroll: true })"
          >

          <!-- 2. 正文（纯文本，不混排媒体） -->
          <textarea
            ref="bodyInput"
            v-model="bodyVal"
            name="editor-body"
            class="snip-editor-body"
            aria-label="灵感正文"
            placeholder="记录想法、场景片段、人物对白或灵感笔记…"
            @input="onTextInput"
            @compositionstart="composing = true"
            @compositionend="onCompositionEnd"
          ></textarea>

          <!-- 3. 参考图片区（同一内容区，位于正文下方） -->
          <section class="snip-media-section" aria-label="参考图片">
            <div class="snip-media-head">
              <div class="snip-media-title">
                <OIcon name="image" :size="15" />
                <span>参考图片</span>
                <b class="num">{{ displayImages.length }}</b>
              </div>
              <div class="snip-media-actions">
                <span class="snip-media-tip">支持拖入图片或 Ctrl+V 粘贴截图</span>
                <button type="button" class="snip-soft snip-media-upload-btn" :disabled="busy || uploading" @click="handlePickImages">
                  <OIcon name="upload" :size="13" />
                  <span>{{ uploading ? '上传中…' : '添加图片' }}</span>
                </button>
              </div>
            </div>

            <div v-if="displayImages.length" class="snip-img-grid">
              <div v-for="(img, idx) in displayImages" :key="img.assetId" class="snip-img-tile">
                <button
                  type="button"
                  class="snip-img-thumb-btn"
                  :aria-label="'查看大图 ' + img.name"
                  @click="openLightbox(idx)"
                >
                  <img v-if="assetUrl(img.assetId)" :src="assetUrl(img.assetId)" :alt="img.name">
                  <span v-else class="snip-img-loading">加载中…</span>
                </button>
                <span v-if="idx === 0" class="snip-img-cover-badge">封面</span>
                <div class="snip-img-tile-bar">
                  <button
                    v-if="idx > 0"
                    type="button"
                    class="snip-img-action"
                    title="设为卡片封面"
                    @click.stop="setCoverImage(img.assetId)"
                  ><OIcon name="star" :size="13" /></button>
                  <button
                    type="button"
                    class="snip-img-action is-danger"
                    title="移除图片"
                    :aria-label="'移除图片 ' + img.name"
                    @click.stop="removeImage(img.assetId)"
                  ><OIcon name="trash" :size="13" /></button>
                </div>
              </div>
            </div>

            <button
              v-else
              type="button"
              class="snip-img-dropzone"
              :disabled="busy || uploading"
              @click="handlePickImages"
            >
              <OIcon name="image" :size="18" />
              <span>点击选择图片，或直接拖拽 / Ctrl+V 粘贴到此处</span>
            </button>
          </section>

          <!-- 4. 网址链接区（同一内容区，位于图片下方） -->
          <section class="snip-media-section snip-web-section" aria-label="网址链接">
            <div class="snip-media-head">
              <div class="snip-media-title">
                <OIcon name="external" :size="15" />
                <span>网址链接</span>
                <b class="num">{{ displayWebLinks.length }}</b>
              </div>
              <span class="snip-media-tip">点击链接将通过系统默认浏览器打开</span>
            </div>

            <form class="snip-web-add" @submit.prevent="addWebLink">
              <input
                v-model="newUrl"
                type="text"
                name="web-url"
                aria-label="网址链接地址"
                placeholder="输入或粘贴网址，如 https://example.com"
                @input="urlError = ''"
              >
              <input
                v-model="newUrlTitle"
                type="text"
                name="web-title"
                class="snip-web-title-input"
                aria-label="链接标题（选填）"
                placeholder="备注标题（选填）"
                maxlength="80"
              >
              <button type="submit" class="snip-soft snip-web-add-btn" :disabled="busy || !newUrl.trim()">
                <OIcon name="plus" :size="13" />添加
              </button>
            </form>
            <div v-if="urlError" class="snip-form-error" role="alert">{{ urlError }}</div>

            <div v-if="displayWebLinks.length" class="snip-web-list">
              <div v-for="item in displayWebLinks" :key="item.id" class="snip-web-item">
                <form v-if="editingLinkId === item.id" class="snip-web-edit-row" @submit.prevent="saveEditLink(item.id)">
                  <input v-model="editLinkUrl" type="text" aria-label="编辑网址" placeholder="https://..." required>
                  <input v-model="editLinkTitle" type="text" aria-label="编辑标题" placeholder="备注标题（选填）" maxlength="80">
                  <button type="submit" class="snip-primary snip-web-save-btn">保存</button>
                  <button type="button" class="snip-soft" @click="cancelEditLink">取消</button>
                </form>
                <template v-else>
                  <button
                    type="button"
                    class="snip-web-open"
                    :title="'在默认浏览器中打开 ' + item.url"
                    @click="emit('open-url', item.url)"
                  >
                    <span class="snip-web-icon"><OIcon name="external" :size="14" /></span>
                    <span class="snip-web-text">
                      <strong>{{ item.title || formatWebLinkHost(item.url) || item.url }}</strong>
                      <small>{{ item.title ? formatWebLinkHost(item.url) : item.url }}</small>
                    </span>
                  </button>
                  <div class="snip-web-item-actions">
                    <button type="button" title="编辑网址" aria-label="编辑网址" @click="startEditLink(item)">
                      <OIcon name="edit" :size="13" />
                    </button>
                    <button type="button" :title="copiedLinkId === item.id ? '已复制' : '复制网址'" aria-label="复制网址" @click="copyWebLink(item)">
                      <OIcon :name="copiedLinkId === item.id ? 'check' : 'link'" :size="13" />
                    </button>
                    <button type="button" class="is-danger" title="移除网址" aria-label="移除网址" @click="removeWebLink(item.id)">
                      <OIcon name="trash" :size="13" />
                    </button>
                  </div>
                </template>
              </div>
            </div>
            <p v-else class="snip-caption">暂未添加网页参考链接。</p>
          </section>
        </div>

        <!-- 右侧可收起属性栏 -->
        <aside v-if="asideOpen" class="snip-editor-aside scroller" aria-label="片段属性与关联">
          <div class="snip-section-title" style="margin-top: 0">卡片颜色</div>
          <div class="snip-color-options snip-editor-colors" role="group" aria-label="卡片颜色">
            <button
              v-for="[color, label] in colorEntries"
              :key="color"
              type="button"
              :data-card-color="color"
              :aria-label="'卡片颜色：' + label"
              :aria-pressed="displayColor === color"
              :title="label"
              @click="selectColor(color)"
            ></button>
          </div>

          <div class="snip-section-title">标签<span>{{ displayTags.length }}</span></div>
          <div class="snip-tags">
            <span v-for="t in displayTags" :key="t" class="snip-edit-tag">
              # {{ t }}
              <button type="button" :aria-label="'移除标签' + t" @click="removeTag(t)">×</button>
            </span>
            <span v-if="!displayTags.length" class="snip-tag-empty">尚未标记</span>
          </div>
          <form class="snip-tag-form" @submit.prevent="submitTag">
            <input v-model="tagText" name="editor-tag" aria-label="添加标签" placeholder="添加标签…" maxlength="31" list="snip-editor-known-tags">
            <datalist id="snip-editor-known-tags">
              <option v-for="t in knownTags" :key="t" :value="t"></option>
            </datalist>
            <button type="submit" aria-label="添加标签">＋</button>
          </form>

          <template v-if="!isCompose && note">
            <div class="snip-section-title">已有关联 <span>{{ note.links.length }}</span></div>
            <div v-for="l in note.links" :key="l.kind + ':' + l.id" class="snip-link-row">
              <button
                type="button"
                class="snip-ref"
                :data-target="l.kind + ':' + l.id"
                @click="emit('preview', l)"
              >
                <OIcon :name="kindIcon[l.kind] || 'note'" :size="15" />
                <span>{{ kindLabel[l.kind] || l.kind }}</span>
                <strong>{{ l.missing ? '目标已不可用' : l.name }}</strong>
                <i class="arrow">→</i>
              </button>
              <button type="button" class="snip-unlink" :aria-label="'移除关联' + (l.name || '')" @click="emit('unlink', l.kind + ':' + l.id)">×</button>
            </div>
            <p v-if="!note.links.length" class="snip-caption">尚未关联其他内容。</p>
            <button type="button" class="snip-soft snip-edit-button" style="margin-top: 8px" @click="emit('open-link')">＋ 添加关联</button>

            <div class="snip-convert">
              <button type="button" class="snip-soft" @click="emit('convert', 'chapter')"><OIcon name="books" :size="15" />转为章节</button>
              <button type="button" class="snip-soft" @click="emit('convert', 'mubu')"><OIcon name="note" :size="15" />转为设定</button>
            </div>
            <p class="snip-caption">{{ dirty ? '转换使用已保存的内容。' : '转换后保留原灵感。' }}</p>

            <div class="snip-meta-lines">
              创建于 <time class="num">{{ (note.date || '').replaceAll('-', '.') }} {{ note.time }}</time><br>
              所属作品　{{ workTitle }}
            </div>
            <button
              type="button"
              class="snip-soft snip-danger snip-delete-button"
              @click="emit('remove', note.id)"
            >移入回收站</button>
          </template>
          <p v-else class="snip-caption" style="margin-top: 16px">
            创建后可继续添加作品内章节/设定/人物关联，或一键转为正文与设定节点。
          </p>
        </aside>
      </div>
    </div>
  </SnipModal>
</template>
