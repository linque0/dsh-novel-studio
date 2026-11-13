<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { NPopover } from 'naive-ui'
import OIcon from './OIcon.vue'
import { useWorkStore } from '../stores/work'
import { useAiStore } from '../stores/ai'
import { useUiStore } from '../stores/ui'

const props = defineProps({ editor: { type: Object, required: true }, compact: { type: Boolean, default: false },paperControls:{type:Boolean,default:false},bookmarkControl:{type:Boolean,default:true} })
const toolbar=ref(null),toolbarWidth=ref(0)
const isCompact=computed(()=>props.compact||props.paperControls&&toolbarWidth.value<1100)
const moreShow = ref(false)
let widthObserver
const work = useWorkStore()
const ai = useAiStore()
const ui = useUiStore()

const tick = ref(0)
const onTr = () => tick.value++
props.editor.on('transaction', onTr)
onBeforeUnmount(() => props.editor.off('transaction', onTr))
onBeforeUnmount(()=>widthObserver?.disconnect())

/* 不带 focus() 的命令链（失焦确定性）；点击后由 refocus 恢复编辑器光标 */
const chain = () => props.editor.chain()
function refocus() {
  try {
    props.editor.view.focus()
  } catch {
    /* 后台窗口下允许失败 */
  }
}

/* 书签（当前章节） */
const bmOn = computed(() => {
  const ch = work.activeChapter
  return !!ch && work.isChapterBookmarked(ch.id)
})
function toggleBm() {
  const ch = work.activeChapter
  if (!ch) return
  const added = work.toggleChapterBookmark(ch.id)
  window.$msg?.success(added ? '已加入书签' : '已移除书签')
}

function enterReading() {
  if (!work.activeChapter) return
  moreShow.value = false
  ui.readMode = true
}

function openImport() {
  moreShow.value = false
  ui.importOpen = true
}

function openExport() {
  if (!work.work) return window.$msg?.warning('请先打开一部作品')
  moreShow.value = false
  ui.exportOpen = true
}

/* 发送给 DSH（方案 §五.1）：锚点 = 当前章，编辑器有选中文本时一并作为补充指令透传 */
const AI_UNSET_HINT = 'DSH 未配置：请先在设置中完成 DSH 配置'
function aiPlotBranch() {
  if (!ai.ready) return window.$msg?.warning(AI_UNSET_HINT)
  const ch = work.activeChapter
  if (!ch) return
  const s = props.editor.state.selection
  const sel = s && !s.empty ? props.editor.state.doc.textBetween(s.from, s.to, '\n').trim() : ''
  ai.prepare('请基于当前章节帮助我创作。', {chapterId:ch.id,selection:sel})
}

onMounted(() => {
  if(props.paperControls){widthObserver=new ResizeObserver(entries=>{toolbarWidth.value=entries[0].contentRect.width});widthObserver.observe(toolbar.value)}
  if (!ai.loaded) ai.loadSettings() // 保障入口置灰判定基于已装载的配置（幂等）
})
const isActive = (name, attrs) => {
  void tick.value
  return props.editor.isActive(name, attrs)
}
</script>

<template>
  <div ref="toolbar" class="editor-toolbar" :class="{compact:isCompact,'has-paper-controls':paperControls}" @click="refocus">
    <button class="tb" data-act="undo" title="撤销" @click="chain().undo().run()">↶</button>
    <button class="tb" data-act="redo" title="重做" @click="chain().redo().run()">↷</button>
    <span class="tb-sep" />

    <button class="tb" data-act="bold" :class="{ on: isActive('bold') }" title="加粗" @click="chain().toggleBold().run()"><b>B</b></button>
    <button class="tb" data-act="italic" :class="{ on: isActive('italic') }" title="斜体" @click="chain().toggleItalic().run()"><i>I</i></button>
    <button class="tb" data-act="underline" :class="{ on: isActive('underline') }" title="下划线" @click="chain().toggleUnderline().run()"><u>U</u></button>
    <button class="tb" data-act="strike" :class="{ on: isActive('strike') }" title="删除线" @click="chain().toggleStrike().run()"><s>S</s></button>
    <span class="tb-sep" />

    <button class="tb" data-act="paragraph" :class="{ on: isActive('paragraph') }" title="正文" @click="chain().setParagraph().run()">正文</button>
    <button class="tb" data-act="h1" :class="{ on: isActive('heading', { level: 1 }) }" title="标题一" @click="chain().toggleHeading({ level: 1 }).run()">H1</button>
    <button class="tb" data-act="h2" :class="{ on: isActive('heading', { level: 2 }) }" title="标题二" @click="chain().toggleHeading({ level: 2 }).run()">H2</button>
    <button class="tb" data-act="h3" :class="{ on: isActive('heading', { level: 3 }) }" title="标题三" @click="chain().toggleHeading({ level: 3 }).run()">H3</button>
    <span class="tb-sep" />

    <NPopover trigger="click" :show-arrow="false" placement="bottom-start" v-model:show="moreShow">
      <template #trigger>
        <button class="tb" data-act="more-features" title="更多功能：书签、阅读模式、导入与导出正文、章节状态与历史">更多功能 ⌄</button>
      </template>
      <div class="tb-more tb-more-features">
        <button
          class="tb"
          v-if="bookmarkControl"
          data-action="bookmark"
          data-act="bookmark"
          :class="{ on: bmOn }"
          :title="bmOn ? '移除书签' : '收藏本书签'"
          @click="toggleBm"
        ><OIcon :name="bmOn ? 'star-filled' : 'star'" :size="14" /><span>{{ bmOn ? '移除书签' : '收藏书签' }}</span></button>
        <!-- 阅读模式：工具栏在阅读态整体隐藏，这里只作「进入」入口；
             退出走 Esc 与齿轮菜单的「退出阅读」，不在弹层里重复一份够不着的按钮。 -->
        <button class="tb tb-read" data-act="reading-mode" title="阅读模式：隐藏工具栏与侧栏，限宽只读" @click="enterReading"><OIcon name="books" :size="14" /><span>阅读模式</span></button>
        <span class="tb-sep" />
        <button class="tb" data-act="import" @click="openImport"><OIcon name="upload" :size="14" /><span>导入正文…</span></button>
        <button class="tb" data-act="export" @click="openExport"><OIcon name="download" :size="14" /><span>导出正文…</span></button>
        <div v-if="$slots['more-end']" class="tb-more-chapter" @click.stop @mousedown.stop>
          <slot name="more-end" />
        </div>
      </div>
    </NPopover>
    <!-- 顶栏右端：章节状态 / 历史（编辑皮肤由 EditorPane 注入）——必须排在「发给 DSH」之前的 tb-sep 前 -->
    <slot name="bar-end" />
    <span class="tb-sep" />
    <button class="tb" data-act="send" :disabled="!ai.ready" :title="ai.ready ? '发送给 DSH（锚点为当前章节，选中文本一并参考）' : AI_UNSET_HINT" @click="aiPlotBranch">发给 DSH</button>
  </div>
</template>
