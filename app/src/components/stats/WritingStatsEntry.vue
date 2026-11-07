<script setup>
import { useUiStore } from '../../stores/ui'
import { useWorkStore } from '../../stores/work'
defineProps({ library: Boolean, disabled: Boolean })
const ui = useUiStore(), work = useWorkStore()
function open(e, library) {
  ui.statsWorkId = library ? null : work.work?.id || null
  // Focus returns to the exact entry that opened this surface.
  document.dispatchEvent(new CustomEvent('writing-stats-entry', { detail: e.currentTarget }))
  ui.statsOpen = true
}
</script>
<template>
  <button type="button" class="writing-stats-entry" aria-label="写作数据" title="写作数据" aria-haspopup="dialog" :disabled="disabled" @mousedown.prevent @click="open($event, library)">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M4 4v15h16M8 15v-3m4 3V8m4 7v-5m4 5V5"/>
    </svg>
  </button>
</template>
