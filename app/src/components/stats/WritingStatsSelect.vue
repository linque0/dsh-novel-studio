<script setup>
import { ref } from 'vue'
import { NSelect } from 'naive-ui'

defineProps({
  value: String,
  options: { type: Array, required: true },
  label: { type: String, required: true },
  inline: Boolean,
  searchable: Boolean
})
const emit = defineEmits(['change'])
const show = ref(false)

function escape(event) {
  if (!show.value) return
  event.preventDefault()
  event.stopPropagation()
  show.value = false
}
</script>

<template>
  <NSelect
    v-model:show="show"
    class="stats-select"
    :value="value"
    :options="options"
    :filterable="searchable"
    :aria-label="label"
    :input-props="{ 'aria-label': label }"
    :to="inline ? false : '.writing-stats-full'"
    :menu-props="{ class: 'stats-select-menu' }"
    :placeholder="label"
    @keydown.esc.capture="escape"
    @update:value="emit('change', $event)"
  />
</template>
