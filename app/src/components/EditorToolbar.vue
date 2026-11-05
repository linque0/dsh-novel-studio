<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { NButton, NSelect, NPopover, NColorPicker } from 'naive-ui'
import OIcon from './OIcon.vue'
import { useWorkStore } from '../stores/work'
import { useAiStore } from '../stores/ai'

const nsPlugin = __NS_PLUGIN__
const props = defineProps({ editor: { type: Object, required: true }, compact: { type: Boolean, default: false },paperControls:{type:Boolean,default:false},bookmarkControl:{type:Boolean,default:true} })
const toolbar=ref(null),toolbarWidth=ref(0)
const isCompact=computed(()=>props.compact||props.paperControls&&toolbarWidth.value<1100)
/* 插件版不提供纸面切换（DSH 里纸面由皮肤决定），选择器整块不进弹层 */
const paperInMore=computed(()=>!nsPlugin&&props.paperControls&&toolbarWidth.value<720)
let widthObserver
const work = useWorkStore()
const ai = useAiStore()

const tick = ref(0)
const onTr = () => tick.value++
props.editor.on('transaction', onTr)
onBeforeUnmount(() => props.editor.off('transaction', onTr))
onBeforeUnmount(()=>widthObserver?.disconnect())

const SIZES = ['12', '14', '15', '16', '18', '20', '24', '28', '32', '40'].map((s) => ({ label: s + ' 号', value: s }))
const HIGHLIGHTS = ['#fff3a3', '#ffd6a5', '#ffa8a8', '#b8f2c9', '#a8d8ff', '#e0c3fc']
const COLORS = ['#3c3427', '#8c6f4e', '#c0392b', '#d35400', '#27ae60', '#2980b9', '#8e44ad', '#7f8c8d']

const sizeVal = computed(() => {
  void tick.value
  return String(props.editor.getAttributes('textStyle')?.fontSize || '')
})
const curColor = computed(() => {
  void tick.value
  return props.editor.getAttributes('textStyle')?.color || '#3c3427'
})

/* 不带 focus() 的命令链（失焦确定性）；点击后由 refocus 恢复编辑器光标 */
const chain = () => props.editor.chain()
function refocus() {
  try {
    props.editor.view.focus()
  } catch {
    /* 后台窗口下允许失败 */
  }
}

function applySize(v) {
  if (!v) chain().unsetFontSize().run()
  else chain().setFontSize(Number(v)).run()
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

/* 超链接 */
const showLink = ref(false)
const linkHref = ref('https://')
function openLink() {
  linkHref.value = props.editor.getAttributes('link')?.href || 'https://'
  showLink.value = true
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
function applyLink() {
  const href = linkHref.value.trim()
  let ok = false
  try {
    const u = new URL(href)
    const h = u.hostname.toLowerCase()
    const privateHost =
      h === 'localhost' ||
      h === '0.0.0.0' ||
      h === '::1' ||
      /^127\.|^10\.|^192\.168\.|^169\.254\.|^172\.(1[6-9]|2\d|3[01])\./.test(h)
    ok = (u.protocol === 'http:' || u.protocol === 'https:') && !privateHost
  } catch {
    ok = false
  }
  if (!ok) {
    window.$msg?.warning('仅支持公网 http/https 链接')
    return
  }
  chain().extendMarkRange('link').setLink({ href, target: '_blank', rel: 'noopener noreferrer' }).run()
  showLink.value = false
}
function removeLink() {
  chain().extendMarkRange('link').unsetLink().run()
  showLink.value = false
}

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

    <NPopover trigger="click" :show-arrow="false" placement="bottom-start">
      <template #trigger>
        <button class="tb" data-act="more-formats" title="更多格式：字号、颜色、底色、链接、书签、章节状态与历史">更多格式 ⌄</button>
      </template>
      <div class="tb-more">
        <!-- 去重：对齐 / 列表 / 引用 / 清除格式 与右键菜单完全重合（EditorContextMenu.vue:442-544），不再重复一遍。
             这里只留右键需要多展开一级、或右键根本没有的条目。 -->
        <NPopover trigger="click" :show-arrow="false" placement="right-start">
          <template #trigger>
            <button class="tb" :class="{ on: !!sizeVal }" data-act="font-size" title="字号">字号{{ sizeVal ? ' · ' + sizeVal : '' }} ⌄</button>
          </template>
          <div class="tb-pick-list">
            <button
              v-for="s in SIZES"
              :key="s.value"
              class="tb"
              :class="{ on: sizeVal === s.value }"
              @click="applySize(s.value)"
            >{{ s.label }}</button>
            <button class="tb" title="恢复默认字号" @click="applySize(null)">默认</button>
          </div>
        </NPopover>
        <NPopover trigger="click" :show-arrow="false">
          <template #trigger>
            <button class="tb" data-act="color" title="字体颜色">
              <span :style="{ borderBottom: '3px solid ' + curColor, lineHeight: '13px' }">A</span>
            </button>
          </template>
          <div class="tb-pick-swatches">
            <button
              v-for="c in COLORS"
              :key="c"
              class="tb tb-swatch"
              :style="{ background: c }"
              :title="'文字色 ' + c"
              @click="chain().setColor(c).run()"
            />
            <button class="tb tb-swatch-clear" title="恢复默认文字色" @click="chain().unsetColor().run()">默认</button>
          </div>
        </NPopover>
        <NPopover trigger="click" :show-arrow="false">
          <template #trigger>
            <button class="tb" data-act="highlight" :class="{ on: isActive('highlight') }" title="突出显示">底色</button>
          </template>
          <div class="tb-pick-swatches">
            <button
              v-for="c in HIGHLIGHTS"
              :key="c"
              class="tb tb-swatch"
              :style="{ background: c }"
              data-act="highlight"
              :title="'底色 ' + c"
              @click="chain().setHighlight({ color: c }).run()"
            />
            <button class="tb tb-swatch-clear" title="清除底色" @click="chain().unsetHighlight().run()"><OIcon name="close" :size="11" /></button>
          </div>
        </NPopover>
        <NPopover trigger="click" :show-arrow="false" :show="showLink" @update:show="(v) => (showLink = v)">
          <template #trigger>
            <button class="tb" data-act="link" :class="{ on: isActive('link') }" title="超链接" @click="openLink"><OIcon name="link" :size="14" /></button>
          </template>
          <div class="tb-pick-link">
            <input v-model="linkHref" class="rp-input" placeholder="https://…" style="flex: 1" @keyup.enter="applyLink" />
            <NButton size="small" type="primary" @click="applyLink">确定</NButton>
            <NButton v-if="isActive('link')" size="small" @click="removeLink">移除</NButton>
          </div>
        </NPopover>
        <button
          class="tb"
          v-if="bookmarkControl"
          data-action="bookmark"
          data-act="bookmark"
          :class="{ on: bmOn }"
          :title="bmOn ? '移除书签' : '收藏本书签'"
          @click="toggleBm"
        ><OIcon :name="bmOn ? 'star-filled' : 'star'" :size="14" /></button>
        <span v-if="paperInMore" class="tb-paper-in-more" @click.stop><slot name="paper" /></span>
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
