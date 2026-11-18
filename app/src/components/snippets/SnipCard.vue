<!-- 拼板卡片：图钉负责拖动，菜单负责编辑和颜色选择。 -->
<script setup>
import { computed } from 'vue'
import OIcon from '../OIcon.vue'

const props = defineProps({
  note: { type: Object, required: true },
  selected: Boolean,
  group: { type: String, default: '' },
  draggable: Boolean
})
const emit = defineEmits(['select', 'edit', 'menu', 'tag', 'dragstart', 'dragend'])

const dateTag = computed(() => (props.note.date || '').slice(5).replace('-', '.'))
const bodyText = computed(() => (props.note.body?.startsWith(props.note.title+'\n')?props.note.body.slice(props.note.title.length).trimStart():props.note.body) || (props.note.deletedAt ? '还没有正文。' : '还没有正文，点编辑继续写。'))
const windowSelection=()=>globalThis.getSelection?.()?.toString()
function openMenu(event) {
  const trigger = event.currentTarget
  const atPointer = event.type === 'contextmenu' && (event.clientX || event.clientY)
  const bounds = trigger.getBoundingClientRect()
  emit('menu', {
    id: props.note.id, group: props.group, trigger,
    x: atPointer ? event.clientX : bounds.left,
    y: atPointer ? event.clientY : bounds.bottom
  })
}
</script>

<template>
  <article
    class="snip-note"
    :class="{ selected }"
    role="button"
    tabindex="0"
    :aria-label="'查看 ' + note.title"
    aria-keyshortcuts="Shift+F10"
    :data-id="note.id"
    :data-card-color="note.cardColor"
    @click="!windowSelection() && emit('select', note.id)"
    @contextmenu.prevent.stop="openMenu"
    @keydown.shift.f10.self.prevent.stop="openMenu"
    @keydown.enter.self.prevent="emit('select', note.id)"
    @keydown.space.self.prevent="emit('select', note.id)"
  >
    <div class="snip-note-top">
      <span>
        <time class="num">{{ dateTag ? dateTag + ' · ' : '' }}{{ note.time }}</time>
        <span v-if="selected" class="selected-label">已选中</span>
      </span>
      <span class="snip-note-actions">
        <button
          v-if="!note.deletedAt"
          type="button"
          :aria-label="'编辑 ' + note.title"
          @click.stop="emit('edit', note.id)"
        ><OIcon name="edit" :size="14" /></button>
        <button
          v-if="draggable && !note.deletedAt"
          type="button"
          class="snip-drag-handle"
          draggable="true"
          title="拖动图钉调整顺序或更换标签组"
          :aria-label="'拖动「' + note.title + '」调整顺序或更换标签组'"
          :data-id="note.id"
          :data-group="group"
          @dragstart="emit('dragstart', { id: note.id, group, event: $event })"
          @dragend="emit('dragend')"
          @click.stop
        ><OIcon name="pin" :size="15" /></button>
      </span>
    </div>
    <h3>{{ note.title }}</h3>
    <div class="read-body excerpt">{{ bodyText }}</div>
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
