<script setup>
import { computed } from 'vue'
import { useWorkStore } from '../stores/work'
import { changeLoreImages, hasHiddenLoreImages } from '../services/lore-editor-dom'

const props = defineProps({ nodeId: String, html: String })
const work = useWorkStore()
const hidden = computed(() => hasHiddenLoreImages(props.html))

function restore() {
  const field = document.activeElement
  const id = field?.dataset?.loreImageNode || field?.closest('[data-lore-sort-row]')?.dataset.loreSortRow
  changeLoreImages(work, props.nodeId, null, { hidden: false }, () => {
    // 保留焦点中的编辑器不会重写 innerHTML，恢复时直接同步该编辑区的图片属性。
    if (id !== props.nodeId || !field.matches('[contenteditable="true"]')) return
    for (const image of field.querySelectorAll('img.lore-image[data-lore-image-hidden="true"]')) {
      image.removeAttribute('data-lore-image-hidden')
    }
  })
}
</script>

<template>
  <button
    v-if="hidden"
    type="button"
    class="lore-image-hidden-notice"
    aria-label="图片已隐藏，点击恢复本条目全部图片"
    title="恢复本条目全部图片"
    @click.stop="restore"
    @dblclick.stop
    @contextmenu.stop.prevent
    @keydown.stop
  >图片已隐藏</button>
</template>
