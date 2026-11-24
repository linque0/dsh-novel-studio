<!-- 拼板卡片：图钉负责拖动，笔图标或双击打开宽幅编辑窗，网址胶囊点击直达默认浏览器。 -->
<script setup>
import { computed } from 'vue'
import OIcon from '../OIcon.vue'
import { formatWebLinkHost } from './snippet-model.js'

const props = defineProps({
  note: { type: Object, required: true },
  selected: Boolean,
  group: { type: String, default: '' },
  draggable: Boolean,
  assetUrl: { type: Function, default: () => '' }
})
const emit = defineEmits(['select', 'edit', 'menu', 'tag', 'open-url', 'dragstart', 'dragend'])

const dateTag = computed(() => (props.note.date || '').slice(5).replace('-', '.'))
const images = computed(() => props.note.images || [])
const webLinks = computed(() => props.note.webLinks || [])
const coverSrc = computed(() => (images.value[0] ? props.assetUrl(images.value[0].assetId) : ''))
const visibleWebLinks = computed(() => webLinks.value.slice(0, 2))
const extraWebCount = computed(() => Math.max(0, webLinks.value.length - 2))
const bodyText = computed(() => {
  const raw = props.note.body?.startsWith(props.note.title + '\n')
    ? props.note.body.slice(props.note.title.length).trimStart()
    : props.note.body
  if (raw) return raw
  if (images.value.length || webLinks.value.length) return ''
  return props.note.deletedAt ? '还没有正文。' : '还没有正文，点编辑继续写。'
})
const windowSelection = () => globalThis.getSelection?.()?.toString()
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
    @dblclick="!note.deletedAt && !windowSelection() && emit('edit', note.id)"
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
          title="打开编辑窗口"
          :aria-label="'编辑 ' + note.title"
          @click.stop="emit('edit', note.id)"
          @dblclick.stop
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
          @dblclick.stop
        ><OIcon name="pin" :size="15" /></button>
      </span>
    </div>
    <h3>{{ note.title }}</h3>
    <div v-if="images.length" class="snip-card-cover">
      <img v-if="coverSrc" :src="coverSrc" :alt="images[0]?.name || note.title" loading="lazy">
      <span v-else class="snip-card-cover-placeholder"><OIcon name="image" :size="18" /></span>
      <span v-if="images.length > 1" class="snip-card-cover-more num">+{{ images.length - 1 }}</span>
    </div>
    <div v-if="bodyText" class="read-body excerpt">{{ bodyText }}</div>
    <div v-if="visibleWebLinks.length" class="snip-card-weblinks" @click.stop @dblclick.stop>
      <button
        v-for="link in visibleWebLinks"
        :key="link.id"
        type="button"
        class="snip-web-pill"
        :title="'在默认浏览器中打开 ' + link.url"
        @click.stop="emit('open-url', link.url)"
      >
        <OIcon name="external" :size="11" />
        <span>{{ link.title || formatWebLinkHost(link.url) || link.url }}</span>
      </button>
      <span v-if="extraWebCount > 0" class="snip-web-pill-more num">+{{ extraWebCount }}</span>
    </div>
    <div class="snip-note-foot">
      <div class="snip-tags">
        <button
          v-for="t in note.tags"
          :key="t"
          type="button"
          class="snip-tag"
          :data-tag="t"
          @click.stop="emit('tag', t)"
          @dblclick.stop
        >{{ t }}</button>
        <span v-if="!note.tags.length" class="snip-tag-empty">未标记</span>
      </div>
      <span class="snip-link-count"><OIcon name="link" :size="13" />{{ note.links.length }} 处关联</span>
    </div>
  </article>
</template>
