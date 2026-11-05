<!-- 大纲中心（8.8.2）：文本 / 画布双视图；文本视图为 Word 式富文本编辑（text+html 双字段），右键快捷栏含关系链接 -->
<script setup>
import TaskLauncher from './ai/TaskLauncher.vue'
import OIcon from './OIcon.vue'
import { computed, ref, watch, nextTick } from 'vue'
import { NPopover } from 'naive-ui'
import { useWorkStore } from '../stores/work'
import { useUiStore } from '../stores/ui'
import { popOut } from '../services/panelwindows'
import { KIND_META } from './outline/canvas-model'
import DLinkTextMenu from './DLinkTextMenu.vue'
import OutlineCanvas from './OutlineCanvas.vue'
import OutlineWorkspace from './outline/OutlineWorkspace.vue'
import Glyph from './outline/OutlineGlyph.vue'
const nsPlugin = __NS_PLUGIN__

const work = useWorkStore()
const ui = useUiStore()
const editorEl = ref(null)
const canvasRef = ref(null)
/* 赤月戏：模块条上的「整理」走画布已有动作与数据 */
function tidyCanvas() {
  canvasRef.value?.tidyAll?.()
}
/* 赤月戏：模块条上的「独立窗口」走与「更多 → 拆窗」相同的真实动作 */
function popOutline() {
  popOut(work, 'outline', '', `${work.work?.title || ''} · 大纲`)
}

const COLORS = ['#3c3427', '#8c6f4e', '#c0392b', '#d35400', '#27ae60', '#2980b9', '#8e44ad', '#7f8c8d']
const HIGHLIGHTS = ['#fff3a3', '#ffd6a5', '#ffa8a8', '#b8f2c9', '#a8d8ff', '#e0c3fc']
const canEditTitle = (n) => !!n && n.kind !== 'anchor'

const cur = computed(() => {
  if (!work.work || !work.selOlnodeId) return null
  return work.olnodes.find((n) => n.id === work.selOlnodeId && !n.deletedAt) || null
})

const titleValue = computed(() => {
  const n = cur.value
  if (!n) return ''
  if (n.kind === 'anchor') return work.chapters.find((c) => c.id === n.refId)?.title || work.volumes.find((v) => v.id === n.refId)?.title || '（已删）'
  return n.title
})

/* 自由画布不再预置结构：默认不选中，文本视图显示空态引导 */

/* 容器内容联动（v0.4.2）：选中容器列出子模块内容；选中子模块显示所属容器面包屑 */
const curKids = computed(() => (cur.value?.kind === 'container' ? work.olnodeChildren(cur.value.id) : []))
const parentContainer = computed(() => {
  const pid = cur.value?.parentId
  if (!pid) return null
  return work.olnodes.find((x) => x.id === pid && !x.deletedAt && x.kind === 'container') || null
})
const kidLabel = (k) => k.title || (k.text || '').split('\n').find((x) => x.trim())?.trim().slice(0, 30) || '（空）'
const kidText = (k) => String(k.text || '').replace(/\[\[([^\[\]\n]+?)\|?([^\[\]\n]*?)\]\]/g, (m, t, d) => d || t).slice(0, 240)
function selectNode(id) {
  work.selOlnodeId = id
}

/* 切换节点时装载内容（html 优先）；输入期间以编辑器为准，不回写 DOM 防光标跳动。
 * 视图切换（画布↔文本）会经 v-if 重建 contenteditable——必须一并重载，
 * 否则编辑器为空白，输入即以空内容覆盖节点全文（v1.0.22 修复） */
function loadEditor() {
  const n = cur.value
  if (!editorEl.value) return
  if (!n) {
    editorEl.value.innerHTML = ''
    return
  }
  if (n.html != null) editorEl.value.innerHTML = n.html
  else editorEl.value.textContent = n.text || ''
}
watch(() => [work.selOlnodeId, work.outlineView], () => nextTick(loadEditor), { immediate: true })

function onInput(e) {
  const n = cur.value
  if (!n) return
  const el = e.currentTarget
  work.olnodeSetRich(n.id, el.textContent || '', el.innerHTML)
}
function onPaste(e) {
  e.preventDefault()
  const t = e.clipboardData?.getData('text/plain') || ''
  if (t) document.execCommand('insertText', false, t)
}
function fmt(cmd, val = null) {
  if (!cur.value) return
  editorEl.value?.focus()
  document.execCommand(cmd, false, val)
  const el = editorEl.value
  if (el && cur.value) work.olnodeSetRich(cur.value.id, el.textContent || '', el.innerHTML)
}

/* 右键快捷栏：剪切/复制/粘贴 + 添加关系链接（选中内容变 [[标题]] 令牌） */
const dlMenu = ref(null)
function onCtx(e) {
  if (!cur.value) return
  const n = cur.value
  const el = editorEl.value
  dlMenu.value?.open(e, {
    get: () => (el ? el.textContent : n.text) || '',
    set: (v) => {
      if (el) {
        el.textContent = v
        work.olnodeSetRich(n.id, v, null)
      }
    }
  })
}
</script>

<template>
  <component :is="nsPlugin ? OutlineWorkspace : 'div'" class="outline-center-host" :style="nsPlugin ? null : {display:'contents'}">
  <TaskLauncher v-if="work.outlineView !== 'canvas'" module="outline" />
  <div class="outline-surface" style="flex: 1; display: flex; flex-direction: column; min-height: 0; padding: 16px 26px">
    <div v-if="nsPlugin && work.outlineView!=='canvas'" class="draft-canvas-head"><div class="bookline">{{work.work?.title}}<Glyph name="chevron" :size="11"/>全书情节</div><h1>故事大纲</h1><p class="subtitle">{{cur?titleValue:'选择一个条目开始编辑'}}</p><div class="draft-head-tools"><div class="viewtoggle"><button type="button" @click="work.outlineView='canvas';nextTick(()=>work.canvasFocusTick++)">画布</button><button type="button" class="on">文本</button></div></div></div>
    <div v-if="!nsPlugin && work.outlineView !== 'canvas'" class="module-heading" style="display: flex; align-items: center; gap: 10px; margin-bottom: 10px">
      <span class="serif" style="font-size: 18px; font-weight: 700">大纲</span>
      <span style="font-size: 12px; color: var(--text-dim)">自由模块画布 · 关系链接联动 · 文本与画布双视图</span>
      <button class="om-btn" title="撤销" :disabled="!work.olUndo.length" @click="work.olnodeUndo()">↶</button>
      <button class="om-btn" title="重做" :disabled="!work.olRedo.length" @click="work.olnodeRedo()">↷</button>
      <div style="flex: 1"></div>
      <div class="ol-viewtoggle">
        <button :class="{ on: work.outlineView === 'text' }" @click="work.outlineView = 'text'">文本</button>
        <button :class="{ on: work.outlineView === 'canvas' }" @click="work.outlineView = 'canvas'" >画布</button>
      </div>
    </div>


    <div class="outline-body">
      <section class="outline-main">
        <OutlineCanvas v-if="work.outlineView === 'canvas'" ref="canvasRef" style="flex: 1; min-height: 0" />

        <template v-else>
          <div class="outline-text-body">
      <p v-if="cur" class="ol-meta" style="font-size:12px;color:var(--text-dim)"><span class="ol-meta-tag">{{ cur.outlineNature==='written'?'已写内容纲 · 来源变化后需要重新总结':'未来大纲计划' }}</span><span class="ol-meta-state">{{ cur.progress==='completed'?'已完成':cur.progress==='drafted'?'已写待确认':'尚未完成' }}</span></p>
      <div v-if="cur" class="ol-editor-head">
        <input
          v-if="canEditTitle(cur)"
          class="rp-input ol-title-input"
          :value="cur.title"
          placeholder="条目标题"
          @change="(e) => work.olnodeSetTitle(cur.id, e.target.value.trim())"
        />
        <span v-else class="serif ol-title-static">{{ titleValue }}</span>
      </div>

      <div v-if="cur" class="ol-toolbar">
        <button class="ol-tb" title="加粗" @mousedown.prevent @click="fmt('bold')"><b>B</b></button>
        <button class="ol-tb" title="斜体" @mousedown.prevent @click="fmt('italic')"><i>I</i></button>
        <button class="ol-tb" title="下划线" @mousedown.prevent @click="fmt('underline')"><u>U</u></button>
        <button class="ol-tb" title="删除线" @mousedown.prevent @click="fmt('strikeThrough')"><s>S</s></button>
        <NPopover trigger="click" :show-arrow="false">
          <template #trigger>
            <button class="ol-tb" title="字体颜色" @mousedown.prevent><span style="border-bottom: 3px solid var(--accent)">A</span></button>
          </template>
          <div class="ob-swatches">
            <button v-for="c in COLORS" :key="c" class="swatch" :style="{ background: c }" :title="c" @mousedown.prevent @click="fmt('foreColor', c)" />
          </div>
        </NPopover>
        <NPopover trigger="click" :show-arrow="false">
          <template #trigger>
            <button class="ol-tb" title="底色" @mousedown.prevent>底</button>
          </template>
          <div class="ob-swatches">
            <button v-for="c in HIGHLIGHTS" :key="c" class="swatch" :style="{ background: c }" :title="c" @mousedown.prevent @click="fmt('hiliteColor', c)" />
          </div>
        </NPopover>
        <button class="ol-tb" title="清除格式" @mousedown.prevent @click="fmt('removeFormat')">清除</button>
        <span class="tb-sep" />
        <span class="ol-tb-hint" style="font-size: 11px; color: var(--text-dim)">选中文字后右键可「添加关系链接」；[[标题]] 令牌会在导图中显示为联动节点</span>
      </div>

      <div
        v-if="cur"
        ref="editorEl"
        class="ol-editor paper-texture"
        :style="cur.kind === 'container' || cur.parentId ? { flex: 'none', minHeight: '120px', maxHeight: '45%' } : null"
        contenteditable="true"
        spellcheck="false"
        data-dl-token
        @input="onInput"
        @paste="onPaste"
        @contextmenu="onCtx"
      ></div>
      <div v-else class="empty-shelf" style="padding-top: 120px">
        <div class="big">谋定而后动</div>
        <p>从左侧选择一个条目开始编辑，或新建故事线与子条目。</p>
      </div>

      <!-- 所属容器面包屑（选中容器内模块时） -->
      <div v-if="cur && parentContainer" class="ol-crumb">
        所属容器：
        <a href="javascript:;" @click.stop="selectNode(parentContainer.id)">{{ parentContainer.title || '容器' }}</a>
      </div>

      <!-- 容器内容展示（选中容器时列出子模块内容） -->
      <div v-if="cur && cur.kind === 'container' && curKids.length" class="ol-kids">
        <div class="rp-title">容器内容（{{ curKids.length }}）——点击卡片可跳转编辑</div>
        <div v-for="k in curKids" :key="k.id" class="ol-kid" role="button" tabindex="0" @click="selectNode(k.id)" @keydown.enter="selectNode(k.id)">
          <div class="ol-kid-head">
            <span class="ol-type-icon"><OIcon :name="KIND_META[k.kind]?.icon || 'diamond'" :size="12" /></span>
            <span class="ol-kid-label">{{ kidLabel(k) }}</span>
            <span class="ol-kid-type">{{ KIND_META[k.kind]?.label || '模块' }}</span>
          </div>
          <pre v-if="kidText(k)" class="ol-kid-text">{{ kidText(k) }}</pre>
        </div>
      </div>
          </div>
        </template>
      </section>
    </div>

    <DLinkTextMenu ref="dlMenu" />
  </div>
  </component>
</template>
