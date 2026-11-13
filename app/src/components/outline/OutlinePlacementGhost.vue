<script setup>
import OIcon from '../OIcon.vue'

defineProps({
  kind: String,
  label: String,
  icon: String,
  title: String,
  rect: { type: Object, required: true },
  paper: Object
})
</script>

<template>
  <div
    class="oc-node oc-placement-ghost"
    :class="['oc-' + kind, 'sh-process']"
    :data-placement-kind="kind"
    :style="{ left: rect.x + 'px', top: rect.y + 'px', width: rect.w + 'px', height: rect.h + 'px' }"
    aria-hidden="true"
  >
    <span v-if="paper" class="oc-paper" :class="'oc-paper-' + kind" :style="paper" />
    <span class="oc-placement-face">
      <OIcon :name="icon" :size="14" />
      <span>{{ title || label }}</span>
    </span>
  </div>
</template>

<style scoped>
.oc-node.oc-placement-ghost {
  display: grid;
  place-items: center;
  z-index: 30;
  box-sizing: border-box;
  padding: 0;
  outline: 1px dashed currentColor;
  outline-offset: -1px;
  pointer-events: none;
  opacity: .76;
  transition: none;
}
.oc-placement-ghost.oc-textbox { background: var(--bg-panel); }
.oc-placement-face {
  position: relative;
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  max-width: calc(100% - 20px);
  padding: 4px 8px;
  border-radius: 6px;
  background: var(--bg-panel, #f5f2e8);
  color: var(--text, #293c36);
  font-size: 13px;
}
.oc-placement-face > svg { flex: none; }
.oc-placement-face > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>

<style>
.oc-placement-surface {
  position: absolute;
  inset: 0;
  z-index: 10;
  cursor: crosshair;
}
.oc-placement-hint {
  position: absolute;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  padding: 5px 10px;
  border: 1px solid var(--border, #8b877355);
  border-radius: 999px;
  background: var(--bg-panel, #f5f2e8);
  color: var(--text, #293c36);
  font-size: 12px;
  white-space: nowrap;
  pointer-events: none;
}
.oc-module-tools > button[aria-pressed='true'],
.oc-module-tools > button.oc-placement-active {
  outline: 1px solid currentColor;
  outline-offset: -1px;
}
</style>
