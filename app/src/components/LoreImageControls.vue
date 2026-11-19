<script setup>
import { nextTick, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { useWorkStore } from '../stores/work'
import { changeLoreImages } from '../services/lore-editor-dom'

const props = defineProps({
  surface: { type: Object, default: null },
  enabled: { type: Boolean, default: true },
  zoom: { type: Number, default: 1 },
  resizeLimit: { type: Number, default: 0 },
  viewport: String
})
const work = useWorkStore()
const selection = shallowRef(null)
const frame = shallowRef(null)
const menu = shallowRef(null)
const menuButton = ref(null)
const edges = [
  { name: 'n', x: 0, y: -1 }, { name: 'e', x: 1, y: 0 },
  { name: 's', x: 0, y: 1 }, { name: 'w', x: -1, y: 0 },
  { name: 'ne', x: 1, y: -1 }, { name: 'se', x: 1, y: 1 },
  { name: 'sw', x: -1, y: 1 }, { name: 'nw', x: -1, y: -1 }
]
let observer
let drag

function locateImage(target) {
  const image = target.closest?.('img.lore-image')
  const field = image?.closest('.ob-text[contenteditable="true"], [data-lore-image-node]')
  const id = field?.dataset.loreImageNode || field?.closest('[data-lore-sort-row]')?.dataset.loreSortRow
  const node = work.mubu.find(item => item.id === id && !item.deletedAt)
  if (!node || !props.surface?.contains(field)) return null
  return {
    image, field, id, workId: work.work?.id, html: node.html,
    index: Array.from(field.querySelectorAll('img.lore-image')).indexOf(image)
  }
}

function stopResize() {
  if (!drag) return
  const { preview, handle, pointer } = drag
  drag = null
  preview.cancel()
  if (handle.hasPointerCapture(pointer)) handle.releasePointerCapture(pointer)
}

function clear() {
  stopResize()
  observer?.disconnect()
  selection.value = null
  frame.value = null
  menu.value = null
}

function isCurrent(target) {
  return target && target.workId === work.work?.id && props.surface?.contains(target.image) &&
    work.mubu.some(node => node.id === target.id && !node.deletedAt && node.html === target.html)
}

function updateFrame() {
  const target = selection.value
  if (!target) return
  const { image, field } = target
  if (!isCurrent(target) || !image.getClientRects().length) return clear()
  const rect = image.getBoundingClientRect()
  const pane = field.closest('.ob-editor, .lore-tm-wrap')?.getBoundingClientRect()
  const left = Math.max(0, pane?.left ?? 0)
  const top = Math.max(0, pane?.top ?? 0)
  const right = Math.min(window.innerWidth, pane?.right ?? window.innerWidth)
  const bottom = Math.min(window.innerHeight, pane?.bottom ?? window.innerHeight)
  frame.value = {
    left: `${rect.left}px`, top: `${rect.top}px`,
    width: `${rect.width}px`, height: `${rect.height}px`,
    clipPath: `inset(${Math.max(0, top - rect.top)}px ${Math.max(0, rect.right - right)}px ${Math.max(0, rect.bottom - bottom)}px ${Math.max(0, left - rect.left)}px)`
  }
  if (rect.bottom < top || rect.top > bottom || rect.right < left || rect.left > right) {
    frame.value = null
    menu.value = null
  } else if (rect.left >= left && rect.top >= top && rect.right <= right && rect.bottom <= bottom) {
    delete frame.value.clipPath
  }
}

function select(target) {
  clear()
  selection.value = target
  observer ??= new ResizeObserver(updateFrame)
  observer.observe(target.image)
  updateFrame()
}

function onClick(event) {
  const target = locateImage(event.target)
  if (!target) return
  select(target)
  event.stopPropagation()
}

function onDoubleClick(event) {
  if (locateImage(event.target)) event.stopPropagation()
}

function onContextMenu(event) {
  const target = locateImage(event.target)
  if (!target) return
  event.preventDefault()
  event.stopPropagation()
  select(target)
  const rect = target.image.getBoundingClientRect()
  menu.value = { x: event.clientX || rect.left, y: event.clientY || rect.bottom }
  nextTick(() => {
    const el = menuButton.value
    if (!el || !menu.value) return
    menu.value = {
      x: Math.max(8, Math.min(menu.value.x, window.innerWidth - el.offsetWidth - 8)),
      y: Math.max(8, Math.min(menu.value.y, window.innerHeight - el.offsetHeight - 8))
    }
    el.focus({ preventScroll: true })
  })
}

function commit(target, patch) {
  if (!isCurrent(target)) return false
  return changeLoreImages(work, target.id, target.index, patch, () => {
    if (patch.width != null) target.image.setAttribute('width', String(patch.width))
    if (patch.hidden) target.image.dataset.loreImageHidden = 'true'
  })
}

function hide() {
  const target = selection.value
  commit(target, { hidden: true })
  clear()
}

function frames(width) {
  const style = { width: `${width}px`, maxHeight: 'none' }
  return [style, style]
}

function startResize(event, edge) {
  const target = selection.value
  if (event.button !== 0 || !isCurrent(target)) return
  const { image, field } = target
  const rect = image.getBoundingClientRect()
  if (!rect.width || !rect.height) return
  const pane = field.closest('.ob-editor, .lore-tm-wrap') || field.parentElement
  const style = getComputedStyle(field)
  const padding = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight)
  const scale = props.zoom || 1
  const initialWidth = rect.width / scale
  const maximum = Math.max(1, Math.floor(Math.min(
    (pane?.clientWidth || field.clientWidth) / scale, Math.max(props.resizeLimit, field.clientWidth - padding)
  )))
  const preview = image.animate(frames(initialWidth), { duration: 1000, fill: 'both' })
  preview.pause()
  preview.currentTime = 1
  const handle = event.currentTarget
  handle.setPointerCapture(event.pointerId)
  menu.value = null
  drag = {
    target, handle, pointer: event.pointerId, edge, preview, maximum,
    width: initialWidth, initialWidth, ratio: rect.height / rect.width, scale,
    x: event.clientX, y: event.clientY
  }
}

function moveResize(event) {
  if (!drag || event.pointerId !== drag.pointer) return
  const { edge, ratio, initialWidth, maximum, x, y, preview, scale } = drag
  const change = ((event.clientX - x) * edge.x + (event.clientY - y) * edge.y * ratio) /
    (edge.x ** 2 + (edge.y * ratio) ** 2)
  drag.width = Math.min(maximum, Math.max(Math.min(32, maximum), Math.round(initialWidth + change / scale)))
  preview.effect.setKeyframes(frames(drag.width))
  updateFrame()
}

function finishResize(event) {
  if (!drag || event.pointerId !== drag.pointer) return
  const { target, width, initialWidth } = drag
  stopResize()
  if (Math.abs(width - initialWidth) >= 1 && commit(target, { width })) {
    selection.value = locateImage(target.image)
  }
  updateFrame()
}

function dismissOutside(event) {
  if (!selection.value || event.target.closest?.('.lore-image-chrome')) return
  if (event.target !== selection.value.image) clear()
}

function onEscape(event) {
  if (event.key !== 'Escape' || !selection.value) return
  event.preventDefault()
  event.stopPropagation()
  clear()
}

watch(() => [props.surface, props.enabled], ([surface, enabled], _, onCleanup) => {
  if (!surface || !enabled) return
  surface.addEventListener('click', onClick, true)
  surface.addEventListener('dblclick', onDoubleClick, true)
  surface.addEventListener('contextmenu', onContextMenu, true)
  window.addEventListener('pointerdown', dismissOutside, true)
  window.addEventListener('keydown', onEscape, true)
  window.addEventListener('scroll', updateFrame, true)
  window.addEventListener('resize', updateFrame)
  onCleanup(() => {
    surface.removeEventListener('click', onClick, true)
    surface.removeEventListener('dblclick', onDoubleClick, true)
    surface.removeEventListener('contextmenu', onContextMenu, true)
    window.removeEventListener('pointerdown', dismissOutside, true)
    window.removeEventListener('keydown', onEscape, true)
    window.removeEventListener('scroll', updateFrame, true)
    window.removeEventListener('resize', updateFrame)
    clear()
  })
}, { flush: 'post' })
watch(() => [work.work?.id, work.mubuRevision, props.viewport], updateFrame, { flush: 'post' })
onBeforeUnmount(clear)
</script>

<template>
  <Teleport to="body">
    <div v-if="frame" class="lore-image-selection lore-image-chrome" :style="frame">
      <span
        v-for="edge in edges"
        :key="edge.name"
        class="lore-image-resize"
        :data-edge="edge.name"
        aria-hidden="true"
        @pointerdown.prevent.stop="startResize($event, edge)"
        @pointermove="moveResize"
        @pointerup="finishResize"
        @pointercancel="clear"
        @lostpointercapture="stopResize"
      />
    </div>
    <button
      v-if="menu"
      ref="menuButton"
      type="button"
      class="lore-image-menu lore-image-chrome"
      :style="{ left: menu.x + 'px', top: menu.y + 'px' }"
      @click="hide"
    >隐藏图片</button>
  </Teleport>
</template>
