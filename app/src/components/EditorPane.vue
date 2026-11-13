<script setup>
const nsPlugin = __NS_PLUGIN__
const chapterControlSlot = nsPlugin ? 'more-end' : 'bar-end'
import TaskLauncher from './ai/TaskLauncher.vue'
import WritingPaperPicker from './WritingPaperPicker.vue'
import ChapterTitleField from './ChapterTitleField.vue'
import '../styles/writing-paper.css'
import '../styles/studio-writing.css'
import { ref, shallowRef, computed, watch, nextTick, onBeforeUnmount, onMounted } from 'vue'
import { Editor, EditorContent } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import Link from '@tiptap/extension-link'
import TextStyle from '@tiptap/extension-text-style'
import Color from '@tiptap/extension-color'
import TextAlign from '@tiptap/extension-text-align'
import Placeholder from '@tiptap/extension-placeholder'
import { marked } from 'marked'
import { NButton, NDrawer, NDrawerContent, NInputNumber, NPopover, NSelect } from 'naive-ui'
import { useWorkStore } from '../stores/work'
import { useUiStore } from '../stores/ui'
import { autosave } from '../services/autosave'
import { db } from '../db/database.js'
import { fmtNum } from '../services/wordcount'
import { FontSize, MarkHighlight } from '../services/richtext'
import { isImageExt } from '../services/fileio'
import { DlLinkMark } from '../services/doublelinks'
import { AnnotationMark, setActiveEditor } from '../services/annotations'
import { isPopped, focusPopped, popOut } from '../services/panelwindows'
import EditorToolbar from './EditorToolbar.vue'
import EditorContextMenu from './EditorContextMenu.vue'
import ChapterTree from './ChapterTree.vue'
import RightPanel from './RightPanel.vue'
import OIcon from './OIcon.vue'
import { hashContent } from '../services/project/text.js'
import { restoreWritingSelection } from '../services/writing-position-core.js'
import { registerWritingCapture, queueWritingPosition, flushWritingPositions } from '../services/writing-position.js'

const work = useWorkStore()
const ui = useUiStore()
const editor = shallowRef(null)
const ctxMenu = ref(null)
const readDrawer = ref(false) // 阅读模式：章节抽屉开合
let writingSession = null
let readingBookmark = null
const panelType = new URLSearchParams(location.search).get('panel')?.split(':')[0]
const nextFrame = () => new Promise(resolve => requestAnimationFrame(resolve))

function detachWritingPosition() {
  if (!writingSession) return
  writingSession.capture()
  writingSession.dispose()
  writingSession = null
}

async function bindWritingPosition(ed, chapter, position) {
  const workId = work.work?.id, chapterId = chapter.id
  const startedReading = ui.readMode
  let disposed=false, restoring=!!position, applying=false, activated=false, lastSignature=''
  let host=null, unregister=()=>{}
  const canRemember = () => !disposed && (!panelType || panelType==='chapter') &&
    work.work?.id===workId && !startedReading && !ui.readMode && !isPopped(work,'chapter',chapterId) && ed.isEditable
  const snapshot = () => ({chapterId,selection:{from:ed.state.selection.from,to:ed.state.selection.to},
    scrollTop:host?.scrollTop || 0,skin:ui.skin,contentHash:hashContent(chapter.content || '')})
  const capture = () => {
    if (!host || !activated || restoring || !canRemember()) return
    const value=snapshot(), signature=JSON.stringify(value)
    if (signature===lastSignature) return
    lastSignature=signature
    queueWritingPosition(workId,value)
  }
  const cancelRestore = () => { if (!applying) restoring=false; if (canRemember()) activated=true }
  const onScroll = () => { if (!restoring) capture() }
  const session = {
    ed,capture,snapshot,
    edited() { if (canRemember()) activated=true;capture() },
    selectionChanged() {
      if (restoring && !applying) restoring=false // explicit search/bookmark selection wins
      if (ed.isFocused && !applying) { if (canRemember()) activated=true;capture() }
    },
    dispose() {
      disposed=true;unregister()
      host?.removeEventListener('scroll',onScroll)
      for(const event of ['pointerdown','keydown','wheel','touchstart']) host?.removeEventListener(event,cancelRestore,true)
    }
  }
  writingSession=session
  await nextTick()
  await nextFrame() // EditorContent moves the editor DOM in its own mounted nextTick.
  if (disposed || editor.value!==ed || !ed.view.dom.isConnected) return
  host=ed.view.dom.closest('.rich-host')
  if (!host) return
  activated=canRemember() // A session mounted read-only stays passive until a real editable interaction.
  unregister=registerWritingCapture(capture)
  host.addEventListener('scroll',onScroll,{passive:true})
  for(const event of ['pointerdown','keydown','wheel','touchstart']) host.addEventListener(event,cancelRestore,{capture:true,passive:true})
  if (position) {
    await document.fonts.ready
    await nextFrame()
    if (disposed || !restoring || work.selChapterId!==chapterId || !canRemember()) { restoring=false;capture();return }
    applying=true
    ed.commands.setTextSelection(restoreWritingSelection(position,ed.state.doc.content.size))
    await nextFrame()
    if (disposed) return
    if (position.skin===ui.skin && position.contentHash===hashContent(chapter.content || '')) {
      host.scrollTop=Math.max(0,Number(position.scrollTop)||0)
    } else {
      const point=ed.view.coordsAtPos(ed.state.selection.from)
      host.scrollTop += point.top-host.getBoundingClientRect().top-host.clientHeight/3
    }
    // Let browser-delivered scroll events settle before enabling capture.
    await nextFrame()
    applying=false;restoring=false
    lastSignature=JSON.stringify(snapshot())
  } else capture() // Selecting a chapter in the editable workspace is navigation.
}

/* 章节已被拆出为面板窗口时，主窗口本章只读（9.2-W5 两级锁）；阅读模式同样只读预览（v1.0.26） */
const handoffTokens=new Set(),handoffPending=ref(false)
function prepareHandoff(e){if(e.detail?.pending)handoffTokens.add(e.detail.token);else handoffTokens.delete(e.detail?.token);handoffPending.value=handoffTokens.size>0}
const chapterPopped = computed(() => !!work.activeChapter && isPopped(work, 'chapter', work.activeChapter.id))
let refreshGeneration=0,refreshingEditor=false,remoteRefreshNeeded=false
watch([chapterPopped, () => ui.readMode, handoffPending], async ([popped, reading, handing], [wasPopped, wasReading]) => {
  if(wasPopped&&!popped)remoteRefreshNeeded=true
  if(popped||handing){refreshGeneration++;editor.value?.setEditable(false,false);return}
  if(remoteRefreshNeeded){
    const generation=++refreshGeneration,workId=work.work?.id,chapterId=work.selChapterId
    refreshingEditor=true;editor.value?.setEditable(false,false)
    try{
      const row=await db.chapters.get(chapterId)
      if(generation!==refreshGeneration||work.work?.id!==workId||work.selChapterId!==chapterId||chapterPopped.value||handoffPending.value)return
      if(!row||row.deletedAt)throw new Error('章节已删除，请重新选择章节')
      Object.assign(work.activeChapter,row)
      // A remote writer owns the new content and history. Recreate before allowing local input.
      mountEditor()
      refreshingEditor=false
      editor.value?.setEditable(!ui.readMode,false)
    }catch(e){window.$msg?.error('同步最新正文失败，暂保持只读：'+e.message)}
    return
  }
  if(refreshingEditor)return
  editor.value?.setEditable(!popped && !reading, false)
  /* 退出阅读恢复编辑并回焦（选区由 ProseMirror state 保留） */
  if (wasReading && !reading) editor.value?.commands.focus()
})

/* 阅读模式：全书章序巨排号（依 treeData 平坦序补零） */
const chapterNo = computed(() => {
  const n = work.activeChapter ? work.chapterOrdinal(work.activeChapter.id) : null
  return n ? String(n).padStart(2, '0') : ''
})

/* 写作头顶的拉丁章号：第 N 章 → CHAPTER ONE…；超过 20 章退回 CHAPTER {N}（只读展示，不可编辑） */
const LATIN_ORDINALS = ['ONE','TWO','THREE','FOUR','FIVE','SIX','SEVEN','EIGHT','NINE','TEN','ELEVEN','TWELVE','THIRTEEN','FOURTEEN','FIFTEEN','SIXTEEN','SEVENTEEN','EIGHTEEN','NINETEEN','TWENTY']
const headLatin = computed(() => {
  const n = work.activeChapter ? work.chapterOrdinal(work.activeChapter.id) : null
  return n ? `CHAPTER ${LATIN_ORDINALS[n - 1] || n}` : ''
})
/* 头部字数目标（设计 .ed-goal > .goal-text）：有每章目标则「N / M 字」，否则只显示本章字数（口径同 goalProgress） */
const headWords = computed(() => {
  const p = work.goalProgress
  return p.goal > 0 ? `${fmtNum(p.current)} / ${fmtNum(p.goal)} 字` : `${fmtNum(p.current)} 字`
})

async function popChapter() {
  if (!work.activeChapter) return
  await popOut(work, 'chapter', work.activeChapter.id, `${work.work?.title || ''} · ${work.activeChapter.title}`)
}

/* 阅读模式 Esc 两级：抽屉开着先关抽屉，否则退出阅读 */
function onReadKey(e) {
  if (!ui.readMode || e.key !== 'Escape' || e.defaultPrevented) return
  if (document.querySelector('.n-modal')) return // 改名弹窗等自行处理
  e.preventDefault()
  if (readDrawer.value) readDrawer.value = false
  else ui.readMode = false
}

let savedSelRange = null // 右键时刻的选区快照（浏览器/PM 可能在右键流程中塌缩选区）

function onMouseDownCapture(e) {
  const ed = editor.value
  if (!ed) return
  if (e.button === 2) {
    const { from, to, empty } = ed.state.selection
    savedSelRange = empty ? null : { from, to }
  } else {
    savedSelRange = null
  }
}

function onContextMenu(e) {
  const ed = editor.value
  if (!ed) return
  e.preventDefault()
  if (ui.readMode) return // 阅读模式只读：不弹格式化菜单（也不放行原生菜单）
  // 快照选区且右键落在其内 → 保持选区（菜单作用于选中文字）；否则光标移到右键处（Word 习惯）
  try {
    const pos = ed.view.posAtCoords({ left: e.clientX, top: e.clientY })
    if (pos && pos.pos != null) {
      const range = savedSelRange
      const keep = !!(range && pos.pos >= range.from && pos.pos <= range.to)
      if (!keep) {
        savedSelRange = null
        ed.commands.setTextSelection(pos.pos)
      }
    } else {
      savedSelRange = null
    }
  } catch {
    savedSelRange = null
  }
  ctxMenu.value?.open(e.clientX, e.clientY, savedSelRange)
}

const extensions = [
  StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
  Underline,
  TextStyle,
  FontSize,
  Color,
  MarkHighlight,
  DlLinkMark,
  AnnotationMark,
  Link.configure({ openOnClick: false, autolink: true }),
  TextAlign.configure({ types: ['heading', 'paragraph'] }),
  Placeholder.configure({ placeholder: '落笔成章……' })
]

/** 旧内容（Markdown/纯文本）打开时转 HTML，保存后以 fmt='html' 固化 */
function toEditorHtml(ch) {
  if (!ch) return ''
  if (ch.fmt === 'html') return ch.content || ''
  const text = ch.content || ''
  if (!text.trim()) return ''
  try {
    return marked.parse(text, { async: false, breaks: true })
  } catch {
    return '<p>' + text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '</p><p>') + '</p>'
  }
}

function handleImages(files) {
  if (!files?.length || !work.activeChapter) return false
  const imgs = [...files].filter((f) => f.type.startsWith('image/') || isImageExt((f.name.split('.').pop() || '').toLowerCase()))
  if (!imgs.length) return false
  ;(async () => {
    const ids = []
    for (const f of imgs) {
      const meta = await work.addAssetBlob(f, f.name || 'image')
      await work.linkAsset('chapter', work.activeChapter.id, meta.id)
      ids.push(meta.id)
    }
    await work.warmUrls(ids)
    window.$msg?.success(`已添加 ${imgs.length} 张插图到本章（右侧面板查看）`)
  })()
  return true
}

function mountEditor() {
  refreshGeneration++
  refreshingEditor=false
  remoteRefreshNeeded=false
  detachWritingPosition()
  editor.value?.destroy()
  editor.value = null
  const ch = work.activeChapter
  if (!ch) return
  const id = ch.id
  const position = work.writingRestore?.chapterId===id ? work.writingRestore : null
  work.writingRestore = null
  editor.value = new Editor({
    content: toEditorHtml(ch),
    extensions,
    editable: !chapterPopped.value && !handoffPending.value && !ui.readMode,
    editorProps: {
      handleDOMEvents: {
        // 超链接在系统默认浏览器打开，不劫持应用窗口
        click: (_view, e) => {
          const a = e.target?.closest?.('a')
          if (a && a.href) {
            e.preventDefault()
            window.open(a.href, '_blank')
          }
          return false
        }
      },
      handleKeyDown: (_view, e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
          autosave.flushAll()
          window.$msg?.success('已保存')
          return true
        }
        return false
      },
      handlePaste: (_view, event) => handleImages(event.clipboardData?.files),
      handleDrop: (_view, event) => handleImages(event.dataTransfer?.files)
    },
    onUpdate: ({ editor: ed }) => {
      if (work.selChapterId === id && !chapterPopped.value && !handoffPending.value && !refreshingEditor) {
        work.setChapterContent(id, ed.getHTML(), 'html')
        window.dispatchEvent(new Event('writing-document-changed'))
        if (writingSession?.ed===ed) writingSession.edited()
      }
    },
    onSelectionUpdate: ({ editor: ed }) => { if (writingSession?.ed===ed) writingSession.selectionChanged() }
  })
  window.__ns.editor = editor.value
  window.__ns.editorTarget = {workId:work.work.id,chapterId:id}
  setActiveEditor(editor.value) // 右侧批注栏据此操作正文标记
  bindWritingPosition(editor.value,ch,position)
}

watch(
  () => work.selChapterId,
  () => {
    autosave.flushAll()
    if (readDrawer.value) readDrawer.value = false // 抽屉内切章即收起
    mountEditor()
  }
)
onMounted(() => {
  mountEditor()
  window.addEventListener('keydown', onReadKey)
  window.addEventListener('chapter-edit-handoff',prepareHandoff)
})
onBeforeUnmount(() => {
  detachWritingPosition()
  flushWritingPositions().catch(e=>console.warn('[writing-position]',e))
  autosave.flushAll()
  setActiveEditor(null)
  editor.value?.destroy()
  editor.value = null
  window.removeEventListener('keydown', onReadKey)
  window.removeEventListener('chapter-edit-handoff',prepareHandoff)
})

// Reading mode moves the same editor into a different scroll host, without replacing its state.
watch([() => ui.readMode, () => ui.skin], async ([reading], [wasReading]) => {
  const position = wasReading ? readingBookmark : writingSession?.snapshot()
  if (reading && !wasReading) readingBookmark=position
  detachWritingPosition()
  await nextTick()
  if (editor.value && work.activeChapter) {
    bindWritingPosition(editor.value,work.activeChapter,!reading && position?.chapterId===work.selChapterId ? position : null)
  }
  if (!reading) readingBookmark=null
})

const STATUS_OPTS = [
  { label: '草稿', value: 'draft' },
  { label: '完成', value: 'done' },
  { label: '待修改', value: 'revise' }
]

function onTitle({workId,chapterId,title}) {
  if(work.work?.id!==workId||isPopped(work,'chapter',chapterId))return
  work.renameChapter(chapterId,title)
}
function openHistory() {
  if (!work.activeChapter) return
  ui.revisionsCtx = { id: work.activeChapter.id, title: work.activeChapter.title }
}

/* ---------- 正文字数目标底栏（每章目标；appconfig wordgoal:<workId> 持久化，即时保存） ---------- */
const goalShow = ref(false)
const goalInput = ref(null)
/** 进度条填充宽度（显示层钳制 0–100，超额仍按 100% 画） */
const goalFill = computed(() => Math.min(100, Math.max(0, work.goalProgress.percent)) + '%')
function toggleGoal(v) {
  if (v && !goalShow.value) goalInput.value = work.wordGoal > 0 ? work.wordGoal : null
  goalShow.value = v
}
async function saveGoal() {
  await work.setWordGoal(Number(goalInput.value) || 0)
  goalShow.value = false
}
async function clearGoal() {
  await work.setWordGoal(0)
  goalShow.value = false
}
</script>

<template>
  <TaskLauncher v-if="!nsPlugin && !ui.readMode" module="chapters" />
  <div class="editor-wrap" :data-writing-paper="ui.writingPaperStyle" :data-paper-skin="ui.skin" :data-paper-theme="ui.theme" :data-paper-quiet="ui.readMode || ui.focusMode" :class="{ 'read-mode': ui.readMode }">
    <div class="editor-head" v-if="work.activeChapter && !ui.readMode">
      <ChapterTitleField
        :key="work.activeChapter.id"
        class="title-input"
        :value="work.activeChapter.title"
        :chapter-id="work.activeChapter.id"
        :work-id="work.work.id"
        :layout-key="[ui.skin,ui.editorFont,ui.editorLatin,ui.fontSize].join(':')"
        :readonly="chapterPopped"
        @commit="onTitle"
      />
      <div v-if="headLatin" class="ed-latin" aria-hidden="true">{{ headLatin }}</div>
      <div class="ed-rule" aria-hidden="true"></div>
      <div class="ed-goal">
        <span class="goal-track" aria-hidden="true"><i :style="{ width: goalFill }"></i></span>
        <NPopover :show="goalShow" trigger="click" :show-arrow="false" placement="bottom-start" @update:show="toggleGoal">
          <template #trigger>
            <button class="goal-text" type="button" :title="work.wordGoal > 0 ? '修改每章字数目标' : '设定每章字数目标'">{{ headWords }}</button>
          </template>
          <div class="wg-goal-pop">
            <div class="wg-goal-title">每章字数目标</div>
            <NInputNumber
              v-model:value="goalInput"
              size="small"
              :min="0"
              :max="2000000"
              :step="500"
              placeholder="如 3000；0 或留空 = 取消"
              style="width: 200px"
              @keydown.enter="saveGoal"
            />
            <div class="wg-goal-actions">
              <NButton v-if="work.wordGoal > 0" size="tiny" quaternary type="error" @click="clearGoal">取消目标</NButton>
              <NButton size="tiny" type="primary" :disabled="!(Number(goalInput) > 0)" @click="saveGoal">保存</NButton>
            </div>
          </div>
        </NPopover>
      </div>
    </div>
    <template v-if="!work.activeChapter">
      <div class="empty-shelf" style="padding-top: 140px">
        <div class="big">笔落惊风雨</div>
        <p>从左侧「＋章」新建一章开始写作，章节内容会即时自动保存。</p>
      </div>
    </template>
    <template v-if="work.activeChapter && editor">
      <EditorToolbar v-show="!chapterPopped && !ui.readMode" paper-controls bookmark-control :key="work.selChapterId" :editor="editor">
        <template #paper><WritingPaperPicker /></template>
        <!-- 插件主行按设计只保留格式与发送；状态/历史仍可从更多格式访问。 -->
        <template #[chapterControlSlot]>
          <div class="editor-bar-status" @click.stop @mousedown.stop>
            <NSelect
              size="tiny"
              :value="work.activeChapter.status"
              :options="STATUS_OPTS"
              :disabled="chapterPopped"
              placeholder="章节状态"
              style="width: 84px"
              @click.stop
              @mousedown.stop
              @update:value="(v) => work.setChapterStatus(work.activeChapter.id, v)"
            />
            <NButton size="tiny" quaternary @click.stop="openHistory" @mousedown.stop>历史</NButton>
          </div>
        </template>
      </EditorToolbar>
      <div v-show="!chapterPopped" class="rich-host paper-texture writing-paper-surface" @mousedown.capture="onMouseDownCapture" @contextmenu.capture="onContextMenu">
        <div class="ed-read-col">
          <!-- 阅读模式专用头（v1.0.26）：巨排章号 + 章题下划短线；随正文滚动，不进入文档模型 -->
          <header v-show="ui.readMode" class="ed-read-head">
            <div class="ed-read-no" aria-hidden="true">{{ chapterNo }}</div>
            <h1 class="ed-read-title">{{ work.activeChapter.title }}</h1>
            <div class="ed-read-rule"></div>
          </header>
          <div id="regular-writing-editor" style="display:contents"></div>
        </div>
      </div>
      <!-- 正文宿主只有一个：多挂一份会让切换时新挂载的编辑器被卸载 -->
      <Teleport defer to="#regular-writing-editor">
        <EditorContent :key="work.selChapterId" :editor="editor" class="rich-inner" />
      </Teleport>
      <div v-show="chapterPopped" class="panel-lock-note">
        <span>「{{ work.activeChapter.title }}」已在独立窗口编辑，本窗口此章暂为只读</span>
        <NButton size="small" type="primary" @click="focusPopped(work, 'chapter', work.activeChapter.id)">前往窗口</NButton>
      </div>
      <EditorContextMenu v-if="!chapterPopped && !ui.readMode" ref="ctxMenu" :editor="editor" />

      <!-- 阅读模式：目录细边条（点击滑出章节抽屉）+ 底右字数（v1.0.26） -->
      <button v-if="ui.readMode" class="ed-read-edge" type="button" title="目录：展开章节列表（Esc 关闭）" @click="readDrawer = true">
        <OIcon name="caret-right" :size="13" />
      </button>
      <div v-if="ui.readMode && !chapterPopped" class="ed-read-count">{{ work.activeChapter.wordCount || 0 }} 字</div>
      <NDrawer v-if="ui.readMode" v-model:show="readDrawer" placement="left" :width="300" :close-on-esc="false">
        <NDrawerContent title="目录" closable :native-scrollbar="false" body-content-style="padding: 6px 10px 10px;">
          <ChapterTree navigation-only />
        </NDrawerContent>
      </NDrawer>
    </template>
  </div>
</template>

<style scoped>
.editor-wrap>.editor-head{max-height:45vh;overflow-y:auto;overflow-x:hidden}
.ed-read-title{overflow-wrap:anywhere;word-break:break-word}
/* Keep manuscript scrollbars on the page surface instead of inheriting the
   window's native dark track. Reset standard properties so Chromium uses the
   rounded thumb below. */
.editor-wrap :deep(.rich-host) {
  --manuscript-scroll-thumb: color-mix(in srgb, var(--text-dim) 38%, transparent);
  --manuscript-scroll-hover: color-mix(in srgb, var(--text-dim) 64%, transparent);
  scrollbar-color: auto;
  scrollbar-width: auto;
}
.editor-wrap :deep(.rich-host::-webkit-scrollbar) {
  width: 10px;
  height: 10px;
}
.editor-wrap :deep(.rich-host::-webkit-scrollbar-track),
.editor-wrap :deep(.rich-host::-webkit-scrollbar-corner) {
  background: transparent;
}
.editor-wrap :deep(.rich-host::-webkit-scrollbar-thumb) {
  min-height: 40px;
  border: 3px solid transparent;
  border-radius: 999px;
  background: var(--manuscript-scroll-thumb);
  background-clip: padding-box;
}
.editor-wrap :deep(.rich-host::-webkit-scrollbar-thumb:hover),
.editor-wrap :deep(.rich-host::-webkit-scrollbar-thumb:active) {
  border-width: 2px;
  background-color: var(--manuscript-scroll-hover);
}
.editor-wrap :deep(.rich-host::-webkit-scrollbar-button) {
  display: none;
  width: 0;
  height: 0;
}
</style>
