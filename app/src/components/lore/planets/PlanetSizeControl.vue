<script setup>
import { PLANET_SIZE_MIN, PLANET_SIZE_MAX, planetSizeValue } from './planet-scene.js'

const props = defineProps({ value: { type: Number, required: true } })
const emit = defineEmits(['preview', 'commit'])

function commit(event) {
  const input = event.target
  const size = Number.isFinite(input.valueAsNumber) ? planetSizeValue(input.valueAsNumber) : props.value
  input.value = size
  emit('commit', size)
}
</script>

<template>
  <div class="lpn-center-setting lpn-center-slider size-control">
    <span>星体大小</span>
    <span class="lpn-speed-value">
      <input type="number" :min="PLANET_SIZE_MIN" :max="PLANET_SIZE_MAX" step="1"
        aria-label="星体大小百分比" :value="value" @change="commit" @keydown.enter.prevent="$event.target.blur()">
      <span aria-hidden="true">%</span>
    </span>
    <input type="range" :min="PLANET_SIZE_MIN" :max="PLANET_SIZE_MAX" step="1" aria-label="星体大小"
      :value="value" @input="emit('preview', $event.target.valueAsNumber)" @change="commit">
    <button type="button" class="lpn-pill size-reset" @click="emit('commit', 100)">恢复默认大小</button>
  </div>
</template>

<style scoped>
.size-control { grid-template-columns: minmax(0, 1fr) 80px; }
.size-reset { grid-column: 1 / -1; justify-self: end; padding: 5px 10px; font-size: 11px; }
</style>
