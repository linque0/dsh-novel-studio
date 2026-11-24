<!-- 灵感图片大图灯箱：基于 SnipModal 栈顶展示，支持键盘左右切换与 Esc 关闭。 -->
<script setup>
import { computed, onBeforeUnmount, onMounted } from 'vue'
import OIcon from '../OIcon.vue'
import SnipModal from './SnipModal.vue'

const props = defineProps({
  images: { type: Array, default: () => [] },
  index: { type: Number, default: 0 },
  assetUrl: { type: Function, required: true }
})
const emit = defineEmits(['close', 'change'])

const safeIndex = computed(() => {
  if (!props.images.length) return 0
  return Math.max(0, Math.min(props.images.length - 1, props.index))
})
const current = computed(() => props.images[safeIndex.value] || null)
const src = computed(() => (current.value ? props.assetUrl(current.value.assetId) : ''))

function step(delta) {
  if (props.images.length <= 1) return
  const next = (safeIndex.value + delta + props.images.length) % props.images.length
  emit('change', next)
}

function onKeydown(event) {
  if (event.key === 'ArrowLeft') {
    event.preventDefault()
    step(-1)
  } else if (event.key === 'ArrowRight') {
    event.preventDefault()
    step(1)
  }
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <SnipModal label="查看参考图片" class="snip-lightbox-scrim" @close="emit('close')">
    <div class="snip-lightbox" role="region" aria-label="图片预览" @click.stop>
      <div class="snip-lightbox-head">
        <div class="snip-lightbox-meta">
          <span class="snip-lightbox-name">{{ current?.name || '参考图片' }}</span>
          <span v-if="images.length > 1" class="snip-lightbox-count num">{{ safeIndex + 1 }} / {{ images.length }}</span>
        </div>
        <button type="button" class="snip-round" aria-label="关闭图片预览" @click="emit('close')">×</button>
      </div>
      <div class="snip-lightbox-stage">
        <button
          v-if="images.length > 1"
          type="button"
          class="snip-round snip-lightbox-nav prev"
          aria-label="上一张图片"
          @click="step(-1)"
        ><OIcon name="back" :size="16" /></button>
        <img v-if="src" :src="src" :alt="current?.name || '参考图片'" class="snip-lightbox-img">
        <div v-else class="snip-lightbox-missing">图片加载中或暂不可用</div>
        <button
          v-if="images.length > 1"
          type="button"
          class="snip-round snip-lightbox-nav next"
          aria-label="下一张图片"
          @click="step(1)"
        ><OIcon name="arrow-right" :size="16" /></button>
      </div>
    </div>
  </SnipModal>
</template>
