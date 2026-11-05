<script setup>
import { ref, watch, nextTick, onBeforeUnmount } from 'vue'

const props = defineProps({ autoHide: Boolean })
const emit = defineEmits(['update:autoHide'])
const content = ref(null)
const edge = ref(null)
const expanded = ref(false)
let hideTimer
let pointerInside = false
let dismissed = false

function cancelHide() { clearTimeout(hideTimer) }
function reveal() { cancelHide(); if (!dismissed) expanded.value = true }
function activate() {
  dismissed = false
  reveal()
  nextTick(() => content.value?.querySelector('button:not([disabled]),a[href],input:not([disabled])')?.focus())
}
function floatingUiOpen() {
  return [...document.querySelectorAll('.n-dropdown-menu,.n-base-select-menu,.n-popover,.n-modal')]
    .some(el => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden')
}
function holdsInteraction() {
  const active = document.activeElement
  if (content.value?.contains(active) && (active.matches(':focus-visible') || /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName))) return true
  // Naive menus are teleported outside this element; keep the header accessible.
  return floatingUiOpen()
}
function scheduleHide() {
  cancelHide()
  if (!props.autoHide) return
  hideTimer = setTimeout(() => {
    if (pointerInside) return
    if (holdsInteraction()) return scheduleHide()
    expanded.value = false
  }, 240)
}
function enter() { if (!pointerInside) dismissed = false; pointerInside = true; reveal() }
function leave() { pointerInside = false; dismissed = false; scheduleHide() }
function escape(event) {
  if (!props.autoHide || event.key !== 'Escape' || floatingUiOpen()) return
  dismissed = true
  edge.value?.focus()
  expanded.value = false
}
watch(() => props.autoHide, () => { cancelHide(); dismissed = false; expanded.value = false })
onBeforeUnmount(cancelHide)
</script>

<template>
  <div class="wb-topbar-host" :class="{ 'is-auto': autoHide, 'is-expanded': expanded }" @mouseenter="enter" @mouseleave="leave" @keydown="escape" @focusout="scheduleHide">
    <button v-if="autoHide" ref="edge" type="button" class="wb-topbar-edge" aria-label="展开顶栏" title="鼠标移到顶部展开顶栏" :aria-expanded="expanded" @mouseenter="reveal" @focus="reveal" @click="activate"><span>顶栏</span></button>
    <div ref="content" class="wb-topbar-content" :inert="autoHide && !expanded" @focusin="reveal">
      <slot />
      <button type="button" class="wb-topbar-pin" :aria-label="autoHide ? '固定顶栏' : '自动隐藏顶栏'" :aria-pressed="autoHide" :title="autoHide ? '关闭自动隐藏并固定顶栏' : '自动隐藏顶栏，鼠标移到顶部时展开'" @click="emit('update:autoHide', !autoHide)">{{ autoHide ? '固定顶栏' : '收起顶栏' }}<span aria-hidden="true">{{ autoHide ? '⌖' : '⌃' }}</span></button>
    </div>
  </div>
</template>

<style>
.wb-topbar-host { position:relative; flex:none; z-index:60; }
.wb-topbar-content { position:relative; display:flex; flex-direction:column; }
.wb-topbar-host.is-auto { height:8px; }
.wb-topbar-host.is-auto .wb-topbar-content { position:absolute; top:0; left:0; right:0; background:var(--bg-panel); transform:translateY(calc(-100% - 18px)); visibility:hidden; transition:transform .22s cubic-bezier(.2,.75,.2,1),visibility .22s; box-shadow:0 8px 24px #0002; }
/* 展开时让顶栏回到文档流并占位，避免覆盖大纲标题与模块工具条；收起时仍只保留 8px 感应条。 */
.wb-topbar-host.is-auto.is-expanded { height:auto; }
.wb-topbar-host.is-auto.is-expanded .wb-topbar-content { position:relative; transform:translateY(0); visibility:visible; }
.wb-topbar-edge { position:absolute; top:0; left:0; width:100%; height:8px; padding:0; border:0; background:color-mix(in srgb,var(--accent) 13%,transparent); cursor:pointer; }
.wb-topbar-edge::after { content:''; display:block; width:46px; height:2px; margin:auto; border-radius:2px; background:var(--accent); opacity:.7; }
.wb-topbar-edge span { position:absolute; left:50%; top:2px; transform:translateX(-50%); color:var(--text-dim); font-size:9px; opacity:0; }
.wb-topbar-edge:focus-visible { height:20px; outline:2px solid var(--accent); }
.wb-topbar-pin { position:absolute; bottom:-17px; left:50%; transform:translateX(-50%); z-index:2; display:flex; align-items:center; gap:6px; height:18px; padding:0 10px; border:1px solid var(--border); border-top:0; border-radius:0 0 5px 5px; color:var(--text-dim); background:var(--bg-panel); font:10px/1.5 system-ui; cursor:pointer; }
.wb-topbar-pin:hover { color:var(--accent); background:var(--bg-hover); }
@media(prefers-reduced-motion:reduce) { .wb-topbar-host.is-auto .wb-topbar-content { transition:none; } }
</style>
