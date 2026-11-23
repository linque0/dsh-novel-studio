<!--
  SnipCardMenu.vue — 灵感卡片上下文操作浮层（卡片配色切换、编辑/置顶/删除与保存失败重试）。
-->
<script setup>
import { nextTick, onMounted, ref } from 'vue'
import { NPopover } from 'naive-ui'
import OIcon from '../OIcon.vue'
import { SNIP_CARD_COLORS } from './snippet-model.js'

defineProps({
  note: { type: Object, required: true },
  group: { type: String, default: '' },
  x: { type: Number, required: true },
  y: { type: Number, required: true },
  busy: Boolean,
  saveError: Boolean
})
const emit = defineEmits(['close', 'action', 'card-color', 'retry'])
const content = ref(null)

onMounted(async () => {
  await nextTick()
  content.value?.focus({ preventScroll: true })
})
</script>

<template>
  <NPopover
    show
    raw
    trigger="manual"
    placement="bottom-start"
    :show-arrow="false"
    :x="x"
    :y="y"
    class="snip-shell snip-card-popover"
    @clickoutside="emit('close')"
  >
    <div ref="content" class="snip-menu-list" role="dialog" aria-label="片段操作" tabindex="-1" @keydown.esc.prevent.stop="emit('close', true)">
      <div v-if="saveError" class="snip-save-error" role="alert">
        <span>保存未完成</span>
        <button type="button" :disabled="busy" @click="emit('retry')">重试</button>
      </div>
      <div v-if="!note.deletedAt" class="snip-color-picker">
        <span>卡片颜色</span>
        <div class="snip-color-options" role="group" aria-label="卡片颜色">
          <button
            v-for="(label, color) in SNIP_CARD_COLORS"
            :key="color"
            type="button"
            :data-card-color="color"
            :aria-label="label"
            :aria-pressed="note.cardColor === color"
            :title="label"
            :disabled="busy"
            @click="emit('card-color', color)"
          ></button>
        </div>
      </div>
      <button v-if="!note.deletedAt" type="button" @click="emit('action', 'edit')"><OIcon name="edit" :size="15" />编辑片段</button>
      <template v-if="group && !note.deletedAt">
        <button type="button" :disabled="busy" @click="emit('action', 'move-prev')">上移一位</button>
        <button type="button" :disabled="busy" @click="emit('action', 'move-next')">下移一位</button>
      </template>
      <button v-if="note.deletedAt" type="button" :disabled="busy" @click="emit('action', 'restore')"><OIcon name="refresh" :size="15" />恢复灵感</button>
      <button v-else type="button" class="snip-danger" :disabled="busy" @click="emit('action', 'delete')"><OIcon name="trash" :size="15" />移入回收站</button>
    </div>
  </NPopover>
</template>
