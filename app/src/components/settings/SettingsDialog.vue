<script setup>
/* 通用弹窗壳（总稿 app.mjs:59 openDialog/closeDialog）：原生 <dialog> 拿焦点陷阱与 ::backdrop，
 * 外壳只负责「开/关」的时机与焦点归还——焦点回到打开它的那颗按钮，键盘用户不会掉到页首。
 * 正文、底部按钮、错误行都由调用方通过插槽填：弹窗内容属于数据页/关于页那一棒。 */
import { nextTick, ref, watch } from 'vue'

const props = defineProps({
  open: { type: Boolean, default: false },
  title: { type: String, default: '' },
  closable: { type: Boolean, default: true },
  wide: { type: Boolean, default: false }
})
const emit = defineEmits(['update:open'])

const dlg = ref(null)
let returnFocus = null

/* 打开时记住来源元素；关闭时按原生 dialog 的顺序归还，元素已不在 DOM 就交给浏览器决定 */
function rememberFocus() {
  const active = document.activeElement
  returnFocus = active && active !== document.body ? active : null
}
function restoreFocus() {
  const target = returnFocus
  returnFocus = null
  if (target?.isConnected) target.focus({ preventScroll: true })
}

function close() {
  if (props.open && props.closable) emit('update:open', false)
}

watch(
  () => props.open,
  async (open) => {
    const el = dlg.value
    if (!el) return
    if (open) {
      if (el.open) return
      rememberFocus()
      el.showModal()
      await nextTick()
      /* 首控件优先：文本/下拉/按钮里第一个，复选框跳过（总稿的选择器同款） */
      requestAnimationFrame(() => el.querySelector('input:not([type=checkbox]),select,button')?.focus())
      return
    }
    if (el.open) el.close()
    restoreFocus()
  },
  { flush: 'post' }
)

/* Esc：原生 dialog 会先发 cancel 再自己关。这里接管关闭权，
 * 让 open 永远由父组件的状态说了算（否则父组件仍以为开着，再点打不开）。 */
function onCancel(event) {
  event.preventDefault()
  close()
}

/* 点遮罩关闭：只有落在 dialog 盒子之外才算遮罩（盒子内的 padding 也会命中 dialog 自身） */
function onDialogClick(event) {
  const el = dlg.value
  if (!el || event.target !== el) return
  const box = el.getBoundingClientRect()
  const outside = event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom
  if (outside) close()
}
</script>

<template>
  <dialog
    id="settings-dialog"
    ref="dlg"
    :class="{ wide }"
    aria-labelledby="settings-dialog-title"
    @cancel="onCancel"
    @click="onDialogClick"
  >
    <header class="dialog-head">
      <h2 id="settings-dialog-title">{{ title }}</h2>
      <button type="button" class="icon-btn" data-act="dialog-close" title="关闭弹窗" aria-label="关闭弹窗" :disabled="!closable" @click="close">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6" /></svg>
      </button>
    </header>
    <div class="dialog-body">
      <slot />
      <p class="dialog-error" role="alert"><slot name="error" /></p>
    </div>
    <footer v-if="$slots.footer" class="dialog-foot">
      <slot name="footer" />
    </footer>
  </dialog>
</template>
