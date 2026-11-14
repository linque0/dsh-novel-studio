<script setup>
import { onBeforeUnmount, ref } from 'vue'

const props = defineProps({
  axis: { type: String, required: true },
  label: { type: String, required: true },
  value: Number,
  min: Number,
  max: Number,
  controls: String,
  capsule: Boolean
})
const emit = defineEmits(['start', 'move', 'end', 'cancel', 'nudge', 'reset', 'activate'])
const dragging = ref(false)
let pointer = null
let suppressClick = false

function down(event) {
  if (pointer || event.button !== 0 || !event.isPrimary) return
  event.preventDefault()
  suppressClick = false
  pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, target: event.currentTarget }
  pointer.target.setPointerCapture(pointer.id)
  window.addEventListener('keydown', escape, true)
  window.addEventListener('blur', cancel)
}

function move(event) {
  if (!pointer || event.pointerId !== pointer.id) return
  const delta = { x: event.clientX - pointer.x, y: event.clientY - pointer.y }
  if (!dragging.value) {
    const distance = props.axis === 'move' ? Math.hypot(delta.x, delta.y) : Math.abs(delta[props.axis])
    if (distance < (props.capsule ? 5 : 2)) return
    dragging.value = suppressClick = true
    emit('start')
  }
  emit('move', delta)
}

function finish(commit) {
  if (!pointer) return
  const { id, target } = pointer
  pointer = null
  window.removeEventListener('keydown', escape, true)
  window.removeEventListener('blur', cancel)
  if (target.hasPointerCapture(id)) target.releasePointerCapture(id)
  if (dragging.value) emit(commit ? 'end' : 'cancel')
  dragging.value = false
}

function up(event) {
  if (pointer?.id !== event.pointerId) return
  move(event)
  finish(true)
}
function cancel() { finish(false) }
function lost(event) { if (pointer?.id === event.pointerId) cancel() }
function escape(event) {
  if (event.key !== 'Escape') return
  event.preventDefault()
  event.stopPropagation()
  suppressClick = true
  cancel()
}

function keydown(event) {
  if (event.key === 'Home') {
    event.preventDefault()
    emit('reset')
    return
  }
  const step = event.shiftKey ? 32 : 8
  const x = event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0
  const y = event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0
  if ((props.axis === 'x' && !x) || (props.axis === 'y' && !y) || (!x && !y)) return
  event.preventDefault()
  emit('nudge', { x, y })
}

function click(event) {
  if (!props.capsule) return
  if (event.detail && suppressClick) {
    suppressClick = false
    return
  }
  emit('activate')
}

onBeforeUnmount(cancel)
</script>

<template>
  <button type="button" class="writing-layout-handle" :class="{ 'is-adjusting': dragging }"
    :data-axis="axis" :data-capsule="capsule || undefined" :aria-label="label" :title="label"
    :role="axis === 'move' ? undefined : 'separator'" :aria-controls="controls"
    :aria-orientation="axis === 'x' ? 'vertical' : axis === 'y' ? 'horizontal' : undefined"
    :aria-valuenow="value" :aria-valuemin="min" :aria-valuemax="max"
    :aria-expanded="capsule ? false : undefined"
    @pointerdown="down" @pointermove="move" @pointerup="up" @pointercancel="lost"
    @lostpointercapture="lost" @keydown="keydown" @click.stop="click" @dblclick.prevent="!capsule && emit('reset')">
    <slot />
  </button>
</template>
