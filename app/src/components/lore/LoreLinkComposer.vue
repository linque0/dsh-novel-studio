<script setup>
import { computed, onMounted, onBeforeUnmount, ref, nextTick } from 'vue'
import { useWorkStore } from '../../stores/work'
import { searchTargets, KIND_LABEL } from '../../services/doublelinks'
import { cleanLoreHtml, loreText, loreCaret, setLoreCaret } from '../../services/lore-editor-dom.js'
import OIcon from '../OIcon.vue'
const props = defineProps({ editorRoot: Object, scopeRoot: String })
const work = useWorkStore(), shown = ref(false), query = ref(''), active = ref(0), box = ref(null), point = ref({ x: 0, y: 0 })
let source = null, range = null, lastField = null, lastRange = null
const results = computed(() => searchTargets(query.value, 8).filter(t => !(t.kind === 'mubu' && t.id === sourceId())))
const sourceId = () => source?.dataset.loreId || source?.closest('[data-node]')?.dataset.node.slice(2)
function close() { shown.value = false; range = null }
function fieldFor(el) { const field = el?.closest?.('.ob-text,.lore-h1[contenteditable="true"]'); return field && (props.editorRoot?.closest('.lore-shell-wrap') || props.editorRoot)?.contains(field) ? field : null }
function position() { nextTick(() => { if (!box.value || !source) return; const r = range?.getBoundingClientRect(), b = r?.height ? r : source.getBoundingClientRect(); point.value = { x: Math.max(12, Math.min(innerWidth - box.value.offsetWidth - 12, b.left)), y: Math.max(80, Math.min(innerHeight - box.value.offsetHeight - 12, b.bottom + 8)) } }) }
function detect(field) {
  const selection = getSelection(); if (!selection?.isCollapsed || !field.contains(selection.anchorNode)) return
  const before = selection.getRangeAt(0).cloneRange(); before.selectNodeContents(field); before.setEnd(selection.anchorNode, selection.anchorOffset)
  const match = before.toString().match(/\[\[([^\[\]\n]*)$/)
  if (!match) { close(); return }
  source = field; query.value = match[1]; active.value = 0; range = selection.getRangeAt(0).cloneRange()
  let left = before.toString().length - match[0].length, n; const walker = document.createTreeWalker(field, NodeFilter.SHOW_TEXT)
  while ((n = walker.nextNode())) { if (left <= n.textContent.length) { range.setStart(n, left); break } left -= n.textContent.length }
  shown.value = true; position()
}
function insert(target, create = false) {
  if (!source?.isConnected || !range || !sourceId()) return close()
  const id = sourceId(); work.mubuCheckpoint()
  if (create) {
    const parent = props.scopeRoot || work.mubuRootOf(id)?.id || null
    const n = work.mubuAdd(parent, null, query.value.trim()); if (!n) return
    target = { kind: 'mubu', id: n.id, title: n.text }
  }
  const span = document.createElement('span'); span.className = 'dl-link'; span.dataset.dlTarget = target.kind + ':' + target.id; span.dataset.dlTitle = target.title; span.contentEditable = 'false'; span.textContent = target.title
  range.deleteContents(); range.insertNode(span); range.setStartAfter(span); range.collapse(true)
  getSelection().removeAllRanges(); getSelection().addRange(range)
  const offset = loreCaret(source)
  work.mubuSetText(id, loreText(source), cleanLoreHtml(source.innerHTML)); work.mubuRevision++
  const field = source; close(); nextTick(() => setLoreCaret(field, offset))
}
function input(e) { const field = fieldFor(e.target); if (field && !e.isComposing) detect(field) }
function composition(e) { const field = fieldFor(e.target); if (field) queueMicrotask(() => detect(field)) }
function key(e) {
  if (!shown.value || e.isComposing || e.keyCode === 229 || e.altKey) return
  if (!['ArrowUp', 'ArrowDown', 'Enter', 'Escape', 'Tab'].includes(e.key)) return
  e.preventDefault(); e.stopImmediatePropagation()
  if (e.key === 'Escape' || e.key === 'Tab') return close()
  if (e.key === 'Enter') { if (results.value[active.value]) insert(results.value[active.value]); else if (query.value.trim()) insert(null, true); return }
  const count = Math.max(1, results.value.length + (query.value.trim() ? 1 : 0))
  active.value = (active.value + (e.key === 'ArrowDown' ? 1 : -1) + count) % count
}
function selection() { const s = getSelection(), field = fieldFor(s?.anchorNode?.parentElement); if (field && s.rangeCount && !shown.value) { lastField = field; lastRange = s.getRangeAt(0).cloneRange() } }
function request(e) {
  if (!props.editorRoot?.contains(e.target)) return
  source = fieldFor(lastField) || props.editorRoot.querySelector('.ob-text') || props.editorRoot.closest('.lore-shell-wrap')?.querySelector('.lore-h1[contenteditable="true"]')
  if (!source) return
  if (lastRange && source.contains(lastRange.startContainer)) range = lastRange.cloneRange()
  else { setLoreCaret(source, source.textContent.length); range = getSelection().getRangeAt(0).cloneRange() }
  query.value = ''; active.value = 0; shown.value = true; position()
}
function outside(e) { if (shown.value && !e.target.closest('.lore-link-picker') && !fieldFor(e.target)) close() }
function scroll() { if (shown.value) close() }
onMounted(() => { document.addEventListener('input', input); document.addEventListener('compositionend', composition); document.addEventListener('keydown', key, true); document.addEventListener('selectionchange', selection); document.addEventListener('lore-insert-link', request); document.addEventListener('pointerdown', outside); window.addEventListener('scroll', scroll, true) })
onBeforeUnmount(() => { document.removeEventListener('input', input); document.removeEventListener('compositionend', composition); document.removeEventListener('keydown', key, true); document.removeEventListener('selectionchange', selection); document.removeEventListener('lore-insert-link', request); document.removeEventListener('pointerdown', outside); window.removeEventListener('scroll', scroll, true) })
</script>
<template>
  <Teleport to="body"><div v-if="shown" ref="box" class="lore-link-picker" role="dialog" aria-label="选择链接节点" :style="{ left: point.x + 'px', top: point.y + 'px' }" @mousedown.prevent>
    <header><OIcon name="link" :size="13" /> 链接到节点 <kbd>Esc</kbd></header>
    <button v-for="(t, i) in results" :key="t.kind + ':' + t.id" :class="{ active: active === i }" :data-target="t.kind + ':' + t.id" @click="insert(t)"><strong>{{ t.title }}</strong><small>{{ KIND_LABEL[t.kind] }} · {{ t.extra }}</small><kbd v-if="active === i">↵</kbd></button>
    <p v-if="!results.length">没有匹配节点</p><button v-if="query.trim()" class="create-linked" :class="{ active: active === results.length }" @click="insert(null, true)">＋ 创建「{{ query.trim() }}」</button><footer>↑ ↓ 选择 · Enter 插入 · 悬停链接预览</footer>
  </div></Teleport>
</template>
