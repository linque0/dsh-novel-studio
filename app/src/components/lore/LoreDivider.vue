<!-- 面板矩阵的分隔条（原型 .divider）：16px 独立网格列、透明背景，悬停/聚焦才露出 4×48 抓手。
     拖拽 / 双击复位 / 键盘调宽都写回 ui 的 lore*Width（数值算法在 lore-layout.js，Excel 之外的逻辑一律不进 DOM）。 -->
<script setup>
import { computed, onBeforeUnmount } from 'vue'
import { useUiStore } from '../../stores/ui'
import { LORE_PANE, clampWidth, keyboardDelta, resetWidth } from './lore-layout.js'

const props = defineProps({ size: { type: String, required: true } })
const ui = useUiStore()

const KEY = { nav: 'loreNavWidth', list: 'loreListWidth', detail: 'loreDetailWidth' }
const LABEL = { nav: '目录', list: '同级列表', detail: '摘要' }
const key = computed(() => KEY[props.size] || KEY.nav)
const pane = computed(() => LORE_PANE[props.size] || LORE_PANE.nav)
const label = computed(() => LABEL[props.size] || LABEL.nav)
const now = computed(() => clampWidth(props.size, ui[key.value]))

function set(w) {
  ui[key.value] = clampWidth(props.size, w)
}
let cleanup = null
/* 拖拽：窄档（≤1099）列宽由布局接管，拖拽不参与（原型 resize() 首行同样直接 return） */
function onPointerDown(e) {
  if (e.button !== 0) return
  if (window.innerWidth <= 1099) return
  e.preventDefault()
  cleanup?.()
  const start = e.clientX
  const old = now.value
  const sign = props.size === 'detail' ? -1 : 1
  const move = (ev) => set(old + (ev.clientX - start) * sign)
  const up = () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    window.removeEventListener('pointercancel', up)
    window.removeEventListener('blur', up)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    cleanup = null
    ui.setPref(key.value, clampWidth(props.size, now.value))
  }
  cleanup = up
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
  window.addEventListener('pointercancel', up)
  window.addEventListener('blur', up)
}
function commit(next) {
  ui[key.value] = clampWidth(props.size, next)
  ui.setPref(key.value, ui[key.value])
}
function onDblClick() {
  commit(resetWidth(props.size))
}
function onKeydown(e) {
  if (e.key !== 'Home' && e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
  e.preventDefault()
  commit(e.key === 'Home' ? resetWidth(props.size) : now.value + keyboardDelta(props.size, e.key, e.shiftKey))
}
onBeforeUnmount(() => cleanup?.())
</script>

<template>
  <div
    class="lore-divider"
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
