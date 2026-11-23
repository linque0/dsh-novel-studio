<!--
  LoreMapEditor.vue — 设定思维导图画布中的浮动富文本节点编辑器与图片粘贴/拖拽控制器。
-->
<script setup>
import { nextTick, onMounted, ref, watch } from 'vue'
import { useWorkStore } from '../../stores/work'
import { useLoreImages } from '../../composables/useLoreImages'
import { cleanLoreHtml, loreCaret, loreContentHtml, loreText, setLoreCaret } from '../../services/lore-editor-dom'
import LoreImageControls from '../LoreImageControls.vue'
import LoreLinkComposer from './LoreLinkComposer.vue'

const props = defineProps({
  node: { type: Object, required: true },
  toolbar: Object,
  point: Object,
  scopeRoot: String,
  zoom: Number,
  viewport: String,
  width: Number
})
const emit = defineEmits(['finish'])
const work = useWorkStore()
const editor = ref(null)
const field = ref(null)
let formatting = false
const formats = [
  ['bold', 'B', '加粗'], ['italic', 'I', '斜体'], ['underline', 'U', '下划线'],
  ['strikeThrough', 'S', '删除线'], ['removeFormat', '清除格式', '清除格式']
]
const { imageInput, imageAccept, chooseImages, onImageFiles, onLorePaste, onLoreDragOver, onLoreDrop } = useLoreImages(editor, {
  work, selectedId: () => props.node.id, parentId: () => props.node.parentId || null,
  checkpoint: () => work.mubuCheckpoint()
})

function sync() {
  const el = field.value
  if (!el) return
  const html = loreContentHtml(props.node)
  if (el.innerHTML === html) return
  const caret = document.activeElement === el ? loreCaret(el) : null
  el.innerHTML = html
  if (caret !== null) setLoreCaret(el, caret)
}

function save(group = 'text:' + props.node.id) {
  if (!field.value || !work.mubu.some(node => node.id === props.node.id && !node.deletedAt)) return
  const text = loreText(field.value)
  const html = cleanLoreHtml(field.value.innerHTML)
  if (text === props.node.text && html === loreContentHtml(props.node)) return
  work.mubuCheckpoint(group)
  work.mubuSetText(props.node.id, text, html)
}

function format(command) {
  field.value?.focus({ preventScroll: true })
  formatting = true
  try {
    document.execCommand(command)
  } finally {
    formatting = false
  }
  save(null)
}

function requestLink() {
  field.value?.dispatchEvent(new CustomEvent('lore-insert-link', { bubbles: true }))
}

async function onKey(event) {
  if (event.isComposing || event.keyCode === 229) return
  const modifier = event.ctrlKey || event.metaKey
  const key = event.key.toLowerCase()
  if (modifier && ['z', 'y'].includes(key)) {
    event.preventDefault()
    event.stopPropagation()
    await work.mubuUndo(key === 'y' || event.shiftKey ? 'redo' : 'undo')
    await nextTick(sync)
  } else if (key === 'escape' || modifier && key === 'enter') {
    event.preventDefault()
    event.stopPropagation()
    emit('finish')
  }
}

onMounted(() => {
  sync()
  const el = field.value
  const point = props.point
  const range = point && document.caretRangeFromPoint(point.x, point.y)
  if (range && el.contains(range.startContainer)) {
    el.focus({ preventScroll: true })
    const selection = getSelection()
    selection.removeAllRanges()
    selection.addRange(range)
  } else setLoreCaret(el, Infinity)
})
watch(() => [props.node.html, props.node.text], sync, { flush: 'post' })
</script>

<template>
  <div ref="editor" class="lore-tm-editor" :data-lore-sort-row="node.id">
    <LoreImageControls :surface="editor" :zoom="zoom" :viewport="viewport" :resize-limit="width" />
    <LoreLinkComposer :editor-root="editor" :scope-root="scopeRoot" />
    <div
      ref="field" class="lore-tm-content lore-tm-entry-input" contenteditable="true" role="textbox"
      aria-label="编辑设定条目" aria-multiline="true" spellcheck="false"
      :data-lore-id="node.id" :data-lore-image-node="node.id" data-lore-entry-editor
      @input="!$event.isComposing && !formatting && save()" @compositionend="save()"
      @keydown="onKey" @paste="onLorePaste" @dragover="onLoreDragOver" @drop.stop="onLoreDrop"
      @click.stop @dblclick.stop
    />
    <input ref="imageInput" type="file" :accept="imageAccept" multiple hidden @change="onImageFiles" />
    <Teleport v-if="toolbar" :to="toolbar">
      <div class="lore-tm-editor-tools" role="toolbar" aria-label="导图条目编辑" @mousedown.prevent>
        <button v-for="[cmd, label, name] in formats" :key="cmd" type="button" :title="name" @click="format(cmd)">{{ label }}</button>
        <button type="button" title="插入双链" @click="requestLink">链接</button>
        <button type="button" title="插入图片" @click="chooseImages">图片</button>
        <button type="button" title="完成编辑（Ctrl+Enter）" @click="emit('finish')">完成</button>
      </div>
    </Teleport>
  </div>
</template>
