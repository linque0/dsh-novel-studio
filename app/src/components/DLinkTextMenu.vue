<!-- 纯文本/富文本编辑区共用右键快捷栏：剪切复制粘贴 + 添加关系链接。
     textarea 模式（大纲旧文本/人物小传/灵感）：关系链接以 [[标题]] 令牌写入，支持令牌命中与移除；
     contenteditable 模式（大纲节点编辑器）：关系链接以令牌文本插入光标处，由宿主 onInput 落库 -->
<script setup>
import { reactive, ref, nextTick, onMounted, onBeforeUnmount } from 'vue'
import DLinkPicker from './DLinkPicker.vue'
import { buildToken, tokenAtOffset, tokenAtPoint } from '../services/doublelinks'

const st = reactive({ open: false, x: 0, y: 0, picker: false, mode: 'ta', host: null, get: null, set: null, onToken: null, q: '', savedRange: null })
const rootEl = ref(null)

/**
 * 打开快捷栏。opts = { get, set, mode? }：
 *  - textarea（默认）：get/set 读写纯文本，宿主需可 focus；
 *  - mode='ce'：contenteditable 宿主，set 可为空（execCommand 触发宿主 input 事件自动落库）。
 */
function open(e, opts) {
  const ta = e.target?.closest?.('textarea')
  const ce = !ta ? e.target?.closest?.('[contenteditable="true"]') : null
  if (!ta && !ce) return
  if (!opts?.get || (!opts?.set && !ce)) return
  e.preventDefault()
  st.mode = ta ? 'ta' : 'ce'
  st.host = ta || ce
  st.get = opts.get
  st.set = opts.set || null
  st.picker = false
  st.q = ''
  st.x = e.clientX
  st.y = e.clientY
  if (st.mode === 'ta') {
    const hit = tokenAtPoint(ta, e.clientX, e.clientY)
    st.onToken = hit || tokenAtOffset(String(opts.get() || ''), ta.selectionStart ?? -1)
  } else {
    st.onToken = null
    const sel = window.getSelection()
    st.savedRange = sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null
  }
  st.open = true
  nextTick(clamp)
}

function clamp() {
  const el = rootEl.value
  if (!el) return
  const r = el.getBoundingClientRect()
  st.x = Math.max(8, Math.min(st.x, window.innerWidth - r.width - 8))
  st.y = Math.max(8, Math.min(st.y, window.innerHeight - r.height - 8))
}

function close() {
  st.open = false
  st.picker = false
  st.host = null
  st.onToken = null
  st.savedRange = null
}

const value = () => String(st.get?.() || '')
const selStart = () => st.host?.selectionStart ?? 0
const selEnd = () => st.host?.selectionEnd ?? 0
const selEmpty = () => (st.mode === 'ce' ? !window.getSelection()?.toString() : selStart() === selEnd())
const selectedText = () => (st.mode === 'ce' ? window.getSelection()?.toString() || '' : value().slice(selStart(), selEnd()))

function restoreCeRange() {
  if (st.mode !== 'ce' || !st.savedRange) return
  try {
    const sel = window.getSelection()
    sel.removeAllRanges()
    sel.addRange(st.savedRange)
    st.host?.focus()
  } catch {
    /* 后台窗口允许失败 */
  }
}

function ceCommand(cmd, val = null) {
  restoreCeRange()
  document.execCommand(cmd, false, val)
  if (st.mode === 'ce' && st.set) st.set(st.host?.textContent || '')
}

function doCut() {
  const t = selectedText()
  if (!t) return close()
  window.native?.clipboardWriteText?.(t)
  if (st.mode === 'ce') ceCommand('delete')
  else {
    const s = selStart()
    commit(value().slice(0, s) + value().slice(selEnd()), s)
  }
  close()
}
function doCopy() {
  const t = selectedText()
  if (!t) return close()
  window.native?.clipboardWriteText?.(t)
  close()
}
async function doPaste() {
  let t = ''
  try {
    t = (await window.native?.clipboardReadText?.()) || ''
  } catch {
    t = ''
  }
  if (!t) return close()
  if (st.mode === 'ce') ceCommand('insertText', t)
  else {
    const s = selStart()
    commit(value().slice(0, s) + t + value().slice(selEnd()), s + t.length)
  }
  close()
}

/** textarea 专用：写回并复位光标 */
function commit(v, caret) {
  st.set(v)
  nextTick(() => {
    try {
      st.host.focus()
      if (caret != null) st.host.setSelectionRange(caret, caret)
    } catch {
      /* 后台窗口允许失败 */
    }
  })
  close()
}

function openPicker() {
  st.q = selectedText().replace(/\s+/g, ' ').trim().slice(0, 20)
  st.picker = true
}

/** 选中内容 → 关系链接：textarea 写令牌文本；contenteditable 在光标处插入令牌文本 */
function applyPick(t) {
  const token = buildToken(t.title, selectedText())
  if (st.mode === 'ce') {
    ceCommand('insertText', token)
    close()
    return
  }
  const s = selStart()
  commit(value().slice(0, s) + token + value().slice(selEnd()), s + token.length)
}

function removeToken() {
  const tok = st.onToken
  if (!tok || st.mode !== 'ta') return close()
  commit(value().slice(0, tok.start) + tok.display + value().slice(tok.end), tok.start + tok.display.length)
}

function onWinMouseDown(e) {
  if (st.open && rootEl.value && !rootEl.value.contains(e.target)) close()
}
function onWinKey(e) {
  if (e.key === 'Escape' && st.open) close()
}
function onWinWheel(e) {
  if (st.open && rootEl.value && !rootEl.value.contains(e.target)) close()
}

onMounted(() => {
  window.addEventListener('mousedown', onWinMouseDown, true)
  window.addEventListener('keydown', onWinKey)
  window.addEventListener('wheel', onWinWheel, { passive: true })
  window.addEventListener('resize', close)
})
onBeforeUnmount(() => {
  window.removeEventListener('mousedown', onWinMouseDown, true)
  window.removeEventListener('keydown', onWinKey)
  window.removeEventListener('wheel', onWinWheel)
  window.removeEventListener('resize', close)
})

defineExpose({ open, close })
</script>

<template>
  <div v-if="st.open" ref="rootEl" class="ctx-menu" :style="{ left: st.x + 'px', top: st.y + 'px' }" @contextmenu.prevent>
    <template v-if="st.picker">
      <div class="ctx-dlwrap">
        <DLinkPicker :initial-query="st.q" @pick="applyPick" />
        <div style="display: flex; margin-top: 8px">
          <button class="ctx-btn" type="button" @click="st.picker = false">返回</button>
        </div>
      </div>
    </template>
    <template v-else>
      <div class="ctx-item" :class="{ disabled: selEmpty() }" @mousedown.prevent @click="!selEmpty() && doCut()"><span>剪切</span></div>
      <div class="ctx-item" :class="{ disabled: selEmpty() }" @mousedown.prevent @click="!selEmpty() && doCopy()"><span>复制</span></div>
      <div class="ctx-item" @mousedown.prevent @click="doPaste()"><span>粘贴为纯文本</span><span class="hint">Ctrl+V</span></div>
      <div class="ctx-sep" />
      <div class="ctx-item" @mousedown.prevent @click="openPicker()"><span>添加关系链接…</span><span class="hint">[[ ]]</span></div>
      <div v-if="st.onToken" class="ctx-item" @mousedown.prevent @click="removeToken()"><span>移除该关系链接</span></div>
    </template>
  </div>
</template>
