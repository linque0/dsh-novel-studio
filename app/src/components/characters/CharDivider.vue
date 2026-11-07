<!-- 人物面板矩阵的分隔条（原型 studio.css 的 .resize-handle）：16px 独立网格列、透明背景，
     悬停/聚焦才露出抓手。拖拽 / 双击复位 / 键盘调宽都只写 ui.charPrefs 并落 appconfig；
     数值算法全在 char-layout.js，DOM 里不留计算。 -->
<script setup>
import { computed, onBeforeUnmount } from 'vue'
import { useWorkStore } from '../../stores/work'
import { useUiStore } from '../../stores/ui'
import { CHAR_PANE, WIDE_MIN, clampWidth, keyboardDelta, resetWidth } from './char-layout.js'

const props = defineProps({ size: { type: String, required: true } }) // 'left' | 'right'
const work = useWorkStore()
const ui = useUiStore()

const view = computed(() => (work.charView === 'graph' ? 'graph' : 'profile'))
const prefs = computed(() => ui.charPrefs[view.value] || ui.charPrefs.profile)
const pane = computed(() => (CHAR_PANE[view.value] || CHAR_PANE.profile)[props.size === 'right' ? 'right' : 'left'])
const label = computed(() => (props.size === 'right' ? '侧栏' : '人物名录'))
const now = computed(() => clampWidth(props.size, prefs.value[props.size], view.value))

function commit(next) {
  const v = view.value
  const one = ui.charPrefs[v] || ui.charPrefs.profile
  void ui.setPref('charPrefs', { ...ui.charPrefs, [v]: { ...one, [props.size]: clampWidth(props.size, next, v) } })
}
let cleanup = null
/* 拖拽：窄档（<1100）列宽由布局接管，拖拽不参与（app.mjs:137 的首行判断同此） */
function onPointerDown(e) {
  if (e.button !== 0) return
  if (window.innerWidth < WIDE_MIN) return
  e.preventDefault()
  cleanup?.()
  const start = e.clientX
  const old = now.value
  const sign = props.size === 'right' ? -1 : 1
  const move = (ev) => commit(old + (ev.clientX - start) * sign)
  const up = () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    window.removeEventListener('pointercancel', up)
    window.removeEventListener('blur', up)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    cleanup = null
  }
  cleanup = up
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
  window.addEventListener('pointercancel', up)
  window.addEventListener('blur', up)
}
function onDblClick() {
  commit(resetWidth(view.value)[props.size])
}
function onKeydown(e) {
  if (e.key !== 'Home' && e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
  e.preventDefault()
  commit(e.key === 'Home' ? resetWidth(view.value)[props.size] : now.value + keyboardDelta(props.size, e.key))
}
onBeforeUnmount(() => cleanup?.())
</script>

<template>
  <div
    class="char-divider"
    :data-size="size"
    role="separator"
    aria-orientation="vertical"
    :aria-label="'调整' + label + '宽度'"
    tabindex="0"
    :aria-valuenow="now"
    :aria-valuemin="pane.min"
    :aria-valuemax="pane.max"
    @pointerdown="onPointerDown"
    @dblclick="onDblClick"
    @keydown="onKeydown"
  ></div>
</template>
