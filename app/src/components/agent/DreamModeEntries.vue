<script setup>
import OIcon from '../OIcon.vue'
defineProps({shelf:Boolean,active:{type:String,default:''},disabled:Boolean})
defineEmits(['dream','light'])
</script>
<template>
  <div class="dream-mode-entries" role="group" aria-label="恍然梦模式">
    <button type="button" data-ai-mode="dream" aria-label="恍然梦-入梦" :disabled="disabled" :aria-pressed="active==='dream'" title="恍然梦-入梦：由 AI 主写故事，可随时手动编辑" @click="$emit('dream')"><OIcon name="sparkle" :size="15" /><span>恍然梦-入梦</span></button>
    <button v-if="!shelf" type="button" data-ai-mode="light" aria-label="恍然梦-浅眠" :disabled="disabled" :aria-pressed="active==='light'" title="恍然梦-浅眠：展开或收起 AI 辅助创作" @click="$emit('light')"><OIcon name="star" :size="15" /><span>恍然梦-浅眠</span></button>
  </div>
</template>
<style>
.dream-mode-entries{display:inline-flex;align-items:center;gap:6px;flex-shrink:0;white-space:nowrap}.dream-mode-entries>button{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:32px;padding:6px 9px;border:1px solid var(--topbar-line,var(--story-line,var(--border)));border-radius:6px;background:transparent;color:inherit;font:13px/1.4 'Microsoft YaHei',sans-serif;cursor:pointer;transition:background .15s,border-color .15s}.dream-mode-entries>button:hover:not(:disabled),.dream-mode-entries>button[aria-pressed=true]{color:var(--topbar-accent,var(--story-gold,var(--accent)));border-color:currentColor;background:color-mix(in srgb,currentColor 7%,transparent)}.dream-mode-entries>button:focus-visible{outline:2px solid var(--topbar-accent,var(--story-gold,var(--accent)));outline-offset:2px}.dream-mode-entries>button:disabled{opacity:.4;cursor:default}@media(max-width:1100px){.dream-mode-entries{gap:4px}.dream-mode-entries>button{font-size:12px;padding:5px 7px}}@media(prefers-reduced-motion:reduce){.dream-mode-entries>button{transition:none}}
</style>
