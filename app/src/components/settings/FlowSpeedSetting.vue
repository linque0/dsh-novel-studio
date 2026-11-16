<script setup>
import { onBeforeUnmount } from 'vue'
import { useUiStore } from '../../stores/ui'
import { normalizeFlowSpeed } from '../../services/latent/flow-motion.js'

const ui = useUiStore()
const speedLabel = value => value === 0 ? '静止' : `${value.toFixed(1)}×`

function preview(event) {
  ui.flowSpeedPreview = normalizeFlowSpeed(event.target.valueAsNumber)
}

function commit(event) {
  const next = normalizeFlowSpeed(event.target.valueAsNumber)
  if (next !== ui.flowSpeed) void ui.applyPref('flowSpeed', next)
  ui.flowSpeedPreview = null
}

onBeforeUnmount(() => { ui.flowSpeedPreview = null })
</script>

<template>
  <div class="setting-row flow-speed-row" data-setting="flowSpeed">
    <label for="flow-speed">流动速度</label>
    <div class="speed-input">
      <input id="flow-speed" type="range" min="0" max="2" step="0.1"
        :value="ui.effectiveFlowSpeed" :aria-valuetext="speedLabel(ui.effectiveFlowSpeed)"
        @input="preview" @change="commit" @blur="commit" />
      <output for="flow-speed">{{ speedLabel(ui.effectiveFlowSpeed) }}</output>
    </div>
  </div>
</template>

<style scoped>
.flow-speed-row { flex-wrap: wrap; gap: 8px 16px; }
.speed-input { display: flex; align-items: center; gap: 12px; flex: 0 1 220px; min-width: 0; }
.speed-input input { flex: 1; min-width: 64px; margin: 0; accent-color: var(--set-accent); cursor: pointer; }
.speed-input output { min-width: 3em; text-align: right; font-variant-numeric: tabular-nums; }
</style>
