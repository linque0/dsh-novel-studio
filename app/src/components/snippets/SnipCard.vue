<!-- 灵感卡片（手札与拼板共用；设计稿 render.js:14 .note）。
     选中态、正文截断、标签、关联数都在这里；拖动只挂在手柄上（拼板），手札不出现。 -->
<script setup>
import { computed } from 'vue'
import OIcon from '../OIcon.vue'

const props = defineProps({
  note: { type: Object, required: true },
  selected: Boolean,
  board: Boolean,
  group: { type: String, default: '' },
  draggable: Boolean
})
const emit = defineEmits(['select', 'edit', 'menu', 'tag', 'dragstart', 'dragend'])

const dateTag = computed(() => (props.note.date || '').slice(5).replace('-', '.'))
const bodyText = computed(() => (props.note.body?.startsWith(props.note.title+'\n')?props.note.body.slice(props.note.title.length).trimStart():props.note.body) || (props.note.deletedAt ? '还没有正文。' : '还没有正文，点编辑继续写。'))
const windowSelection=()=>globalThis.getSelection?.()?.toString()
const full = computed(() => props.selected && !props.board)
</script>

<template>
  <article
    class="snip-note"
    :class="{ selected }"
    role="button"
    tabindex="0"
    :aria-label="'查看 ' + note.title"
    :data-id="note.id"
    @click="!windowSelection() && emit('select', note.id)"
    @keydown.enter.self.prevent="emit('select', note.id)"
    @keydown.space.self.prevent="emit('select', note.id)"
  >
    <div class="snip-note-top">
      <span>
        <time class="num">{{ board && dateTag ? dateTag + ' · ' : '' }}{{ note.time }}</time>
        <span v-if="selected" class="selected-label">已选中</span>
      </span>
      <span class="snip-note-actions">
        <button
          v-if="draggable && !note.deletedAt"
          type="button"
          class="snip-drag-handle"
          draggable="true"
          title="拖动调整位置，或使用更多菜单"
          aria-label="拖动调整位置，或使用更多菜单"
          :data-id="note.id"
          :data-group="group"
          @dragstart="emit('dragstart', { id: note.id, group, event: $event })"
          @dragend="emit('dragend')"
          @click.stop
        ><OIcon name="grip" :size="14" /></button>
        <button
          v-if="!note.deletedAt"
          type="button"
          :aria-label="'编辑 ' + note.title"
          @click.stop="emit('edit', note.id)"
        ><OIcon name="edit" :size="14" /></button>
        <button
          type="button"
          aria-label="片段操作"
          @click.stop="emit('menu', { id: note.id, group })"
        ><OIcon name="dots" :size="14" /></button>
      </span>
    </div>
    <h3>{{ note.title }}</h3>
    <div class="read-body" :class="{ excerpt: !full }">{{ bodyText }}</div>
    <div class="snip-note-foot">
      <div class="snip-tags">
        <button
          v-for="t in note.tags"
          :key="t"
          type="button"
          class="snip-tag"
          :data-tag="t"
          @click.stop="emit('tag', t)"
        >{{ t }}</button>
        <span v-if="!note.tags.length" class="snip-tag-empty">未标记</span>
      </div>
      <span class="snip-link-count"><OIcon name="link" :size="13" />{{ note.links.length }} 处关联</span>
    </div>
  </article>
</template>
