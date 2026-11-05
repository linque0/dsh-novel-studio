<script setup>
import { reactive, ref, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { parseTarget, targetById, findByTitle, jumpTo } from '../services/doublelinks'
import { ANNOTATION_KINDS, normalizeNoteColor, noteKindOf } from '../services/annotations'
import { useWorkStore } from '../stores/work'
import { useAiStore } from '../stores/ai'
import { uid } from '../db/database'
import { useWritingStore } from '../stores/writing.js'
import DLinkPicker from './DLinkPicker.vue'

const nsPlugin = __NS_PLUGIN__
const props = defineProps({ editor: { type: Object, required: true } })
const work = useWorkStore()
const ai = useAiStore()

const st = reactive({ open: false, x: 0, y: 0, sub: null, subX: 0, subY: 0, linkEdit: false, linkHref: '', dlPicker: false, dlFrom: 0, dlTo: 0, savedFrom: null, savedTo: null, dlQuery: '', noteEdit: false, noteText: '', noteColor: ANNOTATION_KINDS[0].color, noteFrom: 0, noteTo: 0, noteExistingId: null, noteQuote: '' })
const rootEl = ref(null)

const SIZES = [12, 14, 16, 18, 20, 24, 28, 32]
const COLORS = ['#3c3427', '#8c6f4e', '#c0392b', '#d35400', '#27ae60', '#2980b9', '#8e44ad', '#7f8c8d']
const HIGHLIGHTS = ['#fff3a3', '#ffd6a5', '#ffa8a8', '#b8f2c9', '#a8d8ff', '#e0c3fc']

/* 不带 focus() 的命令链：命令作用于 ProseMirror 内部选区，窗口失焦时也保持确定性 */
const chain = () => props.editor.chain()
const act = reactive({})

function refresh() {
  const ed = props.editor
  act.bold = ed.isActive('bold')
  act.italic = ed.isActive('italic')
  act.underline = ed.isActive('underline')
  act.strike = ed.isActive('strike')
  act.para = ed.isActive('paragraph')
  act.h1 = ed.isActive('heading', { level: 1 })
  act.h2 = ed.isActive('heading', { level: 2 })
  act.h3 = ed.isActive('heading', { level: 3 })
  act.bullet = ed.isActive('bulletList')
  act.ordered = ed.isActive('orderedList')
  act.quote = ed.isActive('blockquote')
  act.link = ed.isActive('link')
  act.linkHref = ed.getAttributes('link')?.href || ''
  act.size = String(ed.getAttributes('textStyle')?.fontSize || '')
  act.align = ['left', 'center', 'right', 'justify'].find((a) => ed.isActive({ textAlign: a })) || 'left'
  act.dl = ed.isActive('dlLink')
  act.dlTarget = ed.getAttributes('dlLink')?.target || ''
  act.dlTitle = ed.getAttributes('dlLink')?.title || ''
  act.note = ed.isActive('annotation')
  act.noteId = ed.getAttributes('annotation')?.noteId || ''
  act.noteColor = ed.getAttributes('annotation')?.color || ''
}

/* ---------- 关系链接（多模块内容互联）：选中文字标记为指向全书任意内容的关系链接 ---------- */
const dlDisabled = () => selEmpty() && !act.dl && st.savedFrom == null

function openDlPicker() {
  const hasSaved = st.savedFrom != null
  if (hasSaved) {
    // 用右键时刻的选区快照（此刻编辑器选区可能已被塌缩）
    st.dlFrom = st.savedFrom
    st.dlTo = st.savedTo
  } else if (act.dl) {
    // 光标落在已有关系链接内：把作用范围扩展到整个关系链接再编辑
    chain().extendMarkRange('dlLink').run()
    const sel2 = props.editor.state.selection
    st.dlFrom = sel2.from
    st.dlTo = sel2.to
  } else {
    if (selEmpty()) return
    st.dlFrom = props.editor.state.selection.from
    st.dlTo = props.editor.state.selection.to
  }
  // 选中内容作为全局搜索关键词（无选区时用当前关系链接标题）
  let kw = ''
  try {
    kw = hasSaved || !selEmpty() ? props.editor.state.doc.textBetween(st.dlFrom, st.dlTo, ' ') : act.dlTitle
  } catch {
    kw = ''
  }
  st.dlQuery = String(kw || '').replace(/\s+/g, ' ').trim().slice(0, 20)
  st.dlPicker = true
}
function onPickDl(t) {
  props.editor
    .chain()
    .setTextSelection({ from: st.dlFrom, to: st.dlTo })
    .setMark('dlLink', { target: t.kind + ':' + t.id, title: t.title })
    .run()
  st.dlPicker = false
  close()
  refocus()
}
function removeDl() {
  chain().extendMarkRange('dlLink').unsetMark('dlLink').run()
  close()
  refocus()
}
function jumpDl() {
  const resolved = targetById(parseTarget(act.dlTarget)?.kind, parseTarget(act.dlTarget)?.id)
  jumpTo(resolved || findByTitle(act.dlTitle))
  close()
}

/* ---------- 正文批注：选中文字 → 建/改批注（正文留下划线锚点，内容进右侧批注栏） ---------- */
const noteDisabled = () => selEmpty() && !act.note && st.savedFrom == null

/** 范围两侧已有的批注 id（避免同类型标记重叠把原批注切断） */
function existingNoteIdForRange(from, to) {
  const doc = props.editor.state.doc
  const pick = (pos) => {
    try {
      const r = doc.resolve(Math.min(Math.max(pos, 0), doc.content.size))
      return r.marks().find((m) => m.type.name === 'annotation') || null
    } catch {
      return null
    }
  }
  const m = pick(from) || pick(Math.max(from, to - 1))
  return m?.attrs?.noteId || ''
}

function openNote() {
  const ed = props.editor
  let from
  let to
  if (st.savedFrom != null) {
    // 右键落在选区上：作用于选中文字
    from = st.savedFrom
    to = st.savedTo
  } else if (selEmpty()) {
    if (!act.note) return
    // 光标落在既有批注内：扩展为整条批注再编辑
    chain().extendMarkRange('annotation').run()
    const s = ed.state.selection
    from = s.from
    to = s.to
  } else {
    const s = ed.state.selection
    from = s.from
    to = s.to
  }
  st.noteFrom = from
  st.noteTo = to
  const existingId = act.note && selEmpty() ? act.noteId : existingNoteIdForRange(from, to)
  st.noteExistingId = existingId || null
  const rec = existingId ? work.annotations.find((x) => x.id === existingId && !x.deletedAt) : null
  let quote = ''
  try {
    quote = ed.state.doc.textBetween(from, to, ' ')
  } catch {
    quote = ''
  }
  st.noteQuote = String(quote || rec?.text || '').replace(/\s+/g, ' ').trim().slice(0, 40)
  st.noteText = rec?.note || ''
  st.noteColor = rec?.color || normalizeNoteColor(act.noteColor)
  st.noteEdit = true
}

function applyNote() {
  const ed = props.editor
  const chapterId = work.selChapterId
  if (!chapterId) return close()
  const color = normalizeNoteColor(st.noteColor)
  let noteId = st.noteExistingId
  if (noteId) work.updateAnnotation(noteId, { note: st.noteText, color, text: st.noteQuote })
  else {
    noteId = uid()
    work.addAnnotation({ chapterId, noteId, text: st.noteQuote, note: st.noteText, color })
  }
  try {
    ed.chain().setTextSelection({ from: st.noteFrom, to: st.noteTo }).setMark('annotation', { noteId, color }).run()
  } catch {
    /* 选区越界：记录已建，侧栏按「已失效」提示清理 */
  }
  close()
  refocus()
}

function removeNote() {
  const id = st.noteExistingId || act.noteId || ''
  try {
    chain().extendMarkRange('annotation').unsetMark('annotation').run()
  } catch {
    /* 光标不在批注内：仅删记录 */
  }
  if (id) work.deleteAnnotation(id)
  close()
  refocus()
}

const selEmpty = () => props.editor.state.selection.empty

function selectionText() {
  const { from, to, empty } = props.editor.state.selection
  return empty ? '' : props.editor.state.doc.textBetween(from, to, '\n')
}
function doCut() {
  const t = selectionText()
  if (!t) return close()
  window.native?.clipboardWriteText?.(t)
  chain().deleteSelection().run()
  close()
}
function doCopy() {
  const t = selectionText()
  if (!t) return close()
  window.native?.clipboardWriteText?.(t)
  close()
}
async function pastePlain() {
  let t = ''
  try {
    t = (await window.native?.clipboardReadText?.()) || ''
  } catch {
    t = ''
  }
  if (t) chain().insertContent(t).run()
  close()
  refocus()
}

function doLink() {
  st.linkEdit = true
  st.linkHref = act.link ? act.linkHref : 'https://'
}
function applyLink() {
  const href = st.linkHref.trim()
  let ok = false
  try {
    const u = new URL(href)
    const h = u.hostname.toLowerCase()
    ok =
      (u.protocol === 'http:' || u.protocol === 'https:') &&
      h !== 'localhost' &&
      h !== '0.0.0.0' &&
      h !== '::1' &&
      !/^127\.|^10\.|^192\.168\.|^169\.254\.|^172\.(1[6-9]|2\d|3[01])\./.test(h)
  } catch {
    ok = false
  }
  if (!ok) {
    window.$msg?.warning('仅支持公网 http/https 链接')
    return
  }
  chain().extendMarkRange('link').setLink({ href, target: '_blank', rel: 'noopener noreferrer' }).run()
  close()
  refocus()
}
function removeLink() {
  chain().extendMarkRange('link').unsetLink().run()
  close()
  refocus()
}
function openLink() {
  if (act.linkHref) window.open(act.linkHref, '_blank')
  close()
}

function refocus() {
  try {
    props.editor.view.focus()
  } catch {
    /* 后台窗口下允许失败 */
  }
}

/* ---------- 发送给恍然梦（方案 §五.1）：锚点 = 当前章，右键时有选中文本则一并作为补充指令透传 ---------- */
const AI_UNSET_HINT = '恍然梦未配置：请先在设置中完成恍然梦配置'
function aiSelText() {
  /* 右键落在选区上时编辑器选区可能已塌缩，用右键时刻的快照（与关系链接/批注同口径） */
  if (st.savedFrom != null) {
    try {
      return props.editor.state.doc.textBetween(st.savedFrom, st.savedTo, '\n')
    } catch {
      return ''
    }
  }
  return selectionText()
}
function aiPlotBranch() {
  if (!ai.ready) return window.$msg?.warning(AI_UNSET_HINT)
  const chapterId = work.selChapterId
  if (!chapterId) return close()
  const sel = aiSelText().trim()
  ai.prepare('请基于当前选段帮助我创作。', {chapterId,selection:sel})
  close()
}
function writingTask(mode){
  if(st.savedFrom!=null)props.editor.commands.setTextSelection({from:st.savedFrom,to:st.savedTo})
  useWritingStore().open({mode,fresh:true}).catch(e=>window.$msg?.warning(e.message));close()
}
function run(fn) {
  fn()
  close()
  refocus()
}

async function open(x, y, savedSel = null) {
  refresh()
  st.savedFrom = savedSel && savedSel.to > savedSel.from ? savedSel.from : null
  st.savedTo = st.savedFrom != null ? savedSel.to : null
  st.dlQuery = ''
  st.x = x
  st.y = y
  st.open = true
  st.sub = null
  st.linkEdit = false
  st.dlPicker = false
  st.noteEdit = false
  await nextTick()
  const el = rootEl.value
  if (el) {
    const r = el.getBoundingClientRect()
    st.x = Math.max(8, Math.min(x, window.innerWidth - r.width - 8))
    st.y = Math.max(8, Math.min(y, window.innerHeight - r.height - 8))
  }
}
function close() {
  st.open = false
  st.sub = null
  st.linkEdit = false
  st.dlPicker = false
  st.noteEdit = false
}

/** 展开二级飞出菜单：fixed 定位，按父项实测坐标放置并防出屏（escape 祖先 overflow 裁剪） */
async function openSub(key, e) {
  st.sub = key
  const r = e.currentTarget.getBoundingClientRect()
  await nextTick()
  const el = document.querySelector('.ctx-sub')
  if (!el) return
  const w = el.offsetWidth
  const h = el.offsetHeight
  let x = r.right + 4
  if (x + w > window.innerWidth - 8) x = Math.max(8, r.left - w - 4)
  let y = r.top - 6
  if (y + h > window.innerHeight - 8) y = Math.max(8, window.innerHeight - 8 - h)
  st.subX = x
  st.subY = y
}

function onWinMouseDown(e) {
  if (st.open && rootEl.value && !rootEl.value.contains(e.target)) close()
}
function onKey(e) {
  if (e.key === 'Escape' && st.open) close()
}
function onScroll(e) {
  if (!st.open) return
  // 菜单内部滚动不关闭；编辑区滚动时关闭
  if (rootEl.value && rootEl.value.contains(e.target)) {
    st.sub = null
    return
  }
  close()
}
onMounted(() => {
  if (!ai.loaded) ai.loadSettings() // 保障入口置灰判定基于已装载的配置（幂等）
  window.addEventListener('mousedown', onWinMouseDown, true)
  window.addEventListener('keydown', onKey)
  window.addEventListener('resize', close)
  window.addEventListener('wheel', onScroll, { passive: true })
})
onBeforeUnmount(() => {
  window.removeEventListener('mousedown', onWinMouseDown, true)
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('resize', close)
  window.removeEventListener('wheel', onScroll)
})

defineExpose({ open, close })
</script>

<template>
  <div v-if="st.open" ref="rootEl" class="ctx-menu" :style="{ left: st.x + 'px', top: st.y + 'px' }" @contextmenu.prevent @scroll="st.sub = null">
    <template v-if="st.noteEdit">
      <div class="ctx-notedit">
        <div class="ctx-note-quote">{{ st.noteQuote || '（未选中文字）' }}</div>
        <textarea
          v-model="st.noteText"
          class="rp-textarea ctx-note-area"
          placeholder="批注内容：这段文字要改什么、疑问点、埋的伏笔……"
          @keydown.stop
        ></textarea>
        <div class="ctx-note-label">下划线颜色 · 用途</div>
        <div class="note-kind-row">
          <button
            v-for="k in ANNOTATION_KINDS"
            :key="k.key"
            type="button"
            class="note-kind"
            :class="{ on: normalizeNoteColor(st.noteColor) === k.color }"
            :style="{ '--k-color': k.color }"
            @click="st.noteColor = k.color"
          >
            <span class="note-kind-dot" :style="{ background: k.color }"></span>{{ k.label }}
          </button>
        </div>
        <div class="ctx-note-custom">
          <input v-model="st.noteColor" type="color" class="note-color-input" title="自定义下划线颜色" />
          <input v-model="st.noteColor" class="rp-input" placeholder="#c0392b" @keyup.enter="applyNote" />
        </div>
        <div class="ctx-note-cur">当前：{{ noteKindOf(st.noteColor)?.label || '自定义' }} {{ normalizeNoteColor(st.noteColor) }}</div>
        <div style="display: flex; gap: 6px; margin-top: 8px">
          <button class="ctx-btn primary" @click="applyNote">{{ st.noteExistingId ? '保存批注' : '添加批注' }}</button>
          <button v-if="st.noteExistingId" class="ctx-btn" @click="removeNote">移除</button>
          <button class="ctx-btn" @click="st.noteEdit = false">返回</button>
        </div>
      </div>
    </template>

    <template v-else-if="st.linkEdit">
      <div class="ctx-linkedit">
        <input v-model="st.linkHref" class="rp-input" placeholder="https://…" @keyup.enter="applyLink" />
        <div style="display: flex; gap: 6px; margin-top: 8px">
          <button class="ctx-btn primary" @click="applyLink">确定</button>
          <button v-if="act.link" class="ctx-btn" @click="removeLink">移除</button>
          <button class="ctx-btn" @click="st.linkEdit = false">返回</button>
        </div>
      </div>
    </template>

    <template v-else-if="st.dlPicker">
      <div class="ctx-dlwrap">
        <DLinkPicker :initial-query="st.dlQuery" @pick="onPickDl" />
        <div style="display: flex; margin-top: 8px">
          <button class="ctx-btn" @click="st.dlPicker = false">返回</button>
        </div>
      </div>
    </template>

    <template v-else>
      <div class="ctx-item" :class="{ disabled: selEmpty() }" @click="!selEmpty() && doCut()">
        <span>剪切</span><span class="hint">Ctrl+X</span>
      </div>
      <div class="ctx-item" :class="{ disabled: selEmpty() }" @click="!selEmpty() && doCopy()">
        <span>复制</span><span class="hint">Ctrl+C</span>
      </div>
      <div class="ctx-item" @click="run(pastePlain)"><span>纯文本粘贴</span></div>

      <div class="ctx-sep" />
      <div class="ctx-item" :class="{ on: act.bold }" @click="run(() => chain().toggleBold().run())"><span>加粗</span><span class="hint">Ctrl+B</span></div>
      <div class="ctx-item" :class="{ on: act.italic }" @click="run(() => chain().toggleItalic().run())"><span>斜体</span><span class="hint">Ctrl+I</span></div>
      <div class="ctx-item" :class="{ on: act.underline }" @click="run(() => chain().toggleUnderline().run())"><span>下划线</span><span class="hint">Ctrl+U</span></div>
      <div class="ctx-item" :class="{ on: act.strike }" @click="run(() => chain().toggleStrike().run())"><span>删除线</span></div>

      <div class="ctx-sep" />
      <div class="ctx-item has-sub" :class="{ open: st.sub === 'heading' }" @mouseenter="openSub('heading', $event)" @click="openSub('heading', $event)">
        <span>标题</span><span class="arrow">▸</span>
        <div v-if="st.sub === 'heading'" class="ctx-sub" :style="{ left: st.subX + 'px', top: st.subY + 'px' }">
          <div class="ctx-item" :class="{ on: act.para }" @click="run(() => chain().setParagraph().run())"><span>正文</span></div>
          <div class="ctx-item" :class="{ on: act.h1 }" @click="run(() => chain().toggleHeading({ level: 1 }).run())"><span>标题一</span></div>
          <div class="ctx-item" :class="{ on: act.h2 }" @click="run(() => chain().toggleHeading({ level: 2 }).run())"><span>标题二</span></div>
          <div class="ctx-item" :class="{ on: act.h3 }" @click="run(() => chain().toggleHeading({ level: 3 }).run())"><span>标题三</span></div>
        </div>
      </div>

      <div class="ctx-item has-sub" :class="{ open: st.sub === 'size' }" @mouseenter="openSub('size', $event)" @click="openSub('size', $event)">
        <span>字号{{ act.size ? ' · ' + act.size : '' }}</span><span class="arrow">▸</span>
        <div v-if="st.sub === 'size'" class="ctx-sub" :style="{ left: st.subX + 'px', top: st.subY + 'px' }">
          <div v-for="s in SIZES" :key="s" class="ctx-item" :class="{ on: act.size === String(s) }" @click="run(() => chain().setFontSize(s).run())">
            <span>{{ s }} 号</span>
          </div>
          <div class="ctx-sep" />
          <div class="ctx-item" @click="run(() => chain().unsetFontSize().run())"><span>默认字号</span></div>
        </div>
      </div>

      <div class="ctx-item has-sub" :class="{ open: st.sub === 'color' }" @mouseenter="openSub('color', $event)" @click="openSub('color', $event)">
        <span>字体颜色</span><span class="arrow">▸</span>
        <div v-if="st.sub === 'color'" class="ctx-sub" :style="{ left: st.subX + 'px', top: st.subY + 'px' }">
          <div class="swatch-grid">
            <button v-for="c in COLORS" :key="c" class="swatch" :style="{ background: c }" :title="c" @click="run(() => chain().setColor(c).run())" />
          </div>
        </div>
      </div>

      <div class="ctx-item has-sub" :class="{ open: st.sub === 'highlight' }" @mouseenter="openSub('highlight', $event)" @click="openSub('highlight', $event)">
        <span>突出显示</span><span class="arrow">▸</span>
        <div v-if="st.sub === 'highlight'" class="ctx-sub" :style="{ left: st.subX + 'px', top: st.subY + 'px' }">
          <div class="swatch-grid">
            <button
              v-for="c in HIGHLIGHTS"
              :key="c"
              class="swatch"
              :style="{ background: c }"
              :title="c"
              @click="run(() => chain().setHighlight({ color: c }).run())"
            />
          </div>
          <div class="ctx-item" @click="run(() => chain().unsetHighlight().run())"><span>清除底色</span></div>
        </div>
      </div>

      <div class="ctx-item has-sub" :class="{ open: st.sub === 'align' }" @mouseenter="openSub('align', $event)" @click="openSub('align', $event)">
        <span>对齐</span><span class="arrow">▸</span>
        <div v-if="st.sub === 'align'" class="ctx-sub" :style="{ left: st.subX + 'px', top: st.subY + 'px' }">
          <div class="ctx-item" :class="{ on: act.align === 'left' }" @click="run(() => chain().setTextAlign('left').run())"><span>左对齐</span></div>
          <div class="ctx-item" :class="{ on: act.align === 'center' }" @click="run(() => chain().setTextAlign('center').run())"><span>居中</span></div>
          <div class="ctx-item" :class="{ on: act.align === 'right' }" @click="run(() => chain().setTextAlign('right').run())"><span>右对齐</span></div>
          <div class="ctx-item" :class="{ on: act.align === 'justify' }" @click="run(() => chain().setTextAlign('justify').run())"><span>两端对齐</span></div>
        </div>
      </div>

      <div class="ctx-sep" />
      <div class="ctx-item" :class="{ on: act.bullet }" @click="run(() => chain().toggleBulletList().run())"><span>项目符号</span></div>
      <div class="ctx-item" :class="{ on: act.ordered }" @click="run(() => chain().toggleOrderedList().run())"><span>编号</span></div>
      <div class="ctx-item" :class="{ on: act.quote }" @click="run(() => chain().toggleBlockquote().run())"><span>引用</span></div>

      <div class="ctx-sep" />
      <div class="ctx-item" @click="doLink"><span>{{ act.link ? '编辑链接…' : '链接…' }}</span></div>
      <div v-if="act.link" class="ctx-item" @click="openLink"><span>打开链接</span></div>
      <div v-if="act.link" class="ctx-item" @click="removeLink"><span>清除链接</span></div>

      <div class="ctx-sep" />
      <div class="ctx-item" :class="{ disabled: noteDisabled() }" @click="openNote">
        <span>{{ act.note && !noteDisabled() ? '编辑批注…' : '批注…' }}</span>
        <span v-if="act.note" class="note-mini-dot" :style="{ background: normalizeNoteColor(act.noteColor) }"></span>
        <span v-else class="hint">批注</span>
      </div>
      <div v-if="act.note" class="ctx-item" @click="removeNote"><span>移除批注</span></div>

      <div class="ctx-sep" />
      <div class="ctx-item" :class="{ disabled: dlDisabled() }" @click="openDlPicker">
        <span>{{ act.dl && !dlDisabled() ? '编辑关系…' : '关系链接…' }}</span><span class="hint">互联</span>
      </div>
      <div v-if="act.dl" class="ctx-item" @click="jumpDl"><span>跳到目标</span></div>
      <div v-if="act.dl" class="ctx-item" @click="removeDl"><span>移除关系链接</span></div>

      <!-- 插件构建：AI 由 DSH 会话承担，这三个入口整组不渲染（组件本体保留）。 -->
      <template v-if="!nsPlugin">
        <div class="ctx-sep" />
        <div class="ctx-item" @click="writingTask('insert')"><span>恍然梦 · 在此续写剧情</span></div>
        <div v-if="!selEmpty()||st.savedFrom!=null" class="ctx-item" @click="writingTask('replace')"><span>恍然梦 · 改写选段</span></div>
        <div class="ctx-item" :class="{ disabled: !ai.ready }" :title="ai.ready ? '发送给恍然梦（锚点为当前章节）' : AI_UNSET_HINT" @click="ai.ready && aiPlotBranch()">
          <span>发送给恍然梦</span><span class="hint">梦</span>
        </div>
      </template>

      <div class="ctx-sep" />
      <div class="ctx-item" @click="run(() => chain().undo().run())"><span>撤销</span><span class="hint">Ctrl+Z</span></div>
      <div class="ctx-item" @click="run(() => chain().redo().run())"><span>重做</span><span class="hint">Ctrl+Y</span></div>
      <div class="ctx-item" @click="run(() => chain().selectAll().run())"><span>全选</span><span class="hint">Ctrl+A</span></div>
      <div class="ctx-item" @click="run(() => chain().unsetAllMarks().clearNodes().run())"><span>清除格式</span></div>
    </template>
  </div>
</template>
