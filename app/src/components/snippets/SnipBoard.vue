<!-- 拼板（设计稿 render.js:26）：按标签分栏，拖动图钉调整顺序或更换标签组。
     手机档改成「分组胶囊 + 单栏」，不把文字压成窄列。 -->
<script setup>
import { computed } from 'vue'
import OIcon from '../OIcon.vue'
import SnipCard from './SnipCard.vue'
import { SNIP_CARD_SIZE } from './snippet-model.js'

const props = defineProps({
  groups: { type: Array, required: true },
  cardSize: { type: Number, default: SNIP_CARD_SIZE.initial },
  trash: Boolean,
  scoped: Boolean,
  selectedId: { type: String, default: '' },
  current: { type: String, default: '' },
  dragging: { type: Object, default: null },
  dropHint: { type: Object, default: null }
})
const emit = defineEmits(['select', 'edit', 'menu', 'tag', 'compose', 'group', 'dragstart', 'dragend', 'dragover', 'dragleave', 'drop', 'clear'])

const currentGroup = computed(() => {
  const list = props.groups
  return list.some((g) => g.id === props.current) ? props.current : list[0]?.id || ''
})
function dragOver(group, event) {
  if (!props.dragging) return
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
  emit('dragover', { group, event })
}
function dragLeave(group, event) {
  if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return
  emit('dragleave', group)
}
</script>

<template>
  <section
    class="snip-board"
    :style="{
      '--snip-card-scale': cardSize / SNIP_CARD_SIZE.initial,
      '--snip-card-lines': Math.round(8 + (cardSize - SNIP_CARD_SIZE.initial) / 4)
    }"
  >
    <div class="snip-board-head">
      <span><OIcon name="tag" :size="14" />按标签分组</span>
      <span v-if="!trash && groups.length" class="hint">拖动图钉调整顺序 · 跨栏更换标签组</span>
    </div>
    <div class="snip-mobile-groups" role="group" aria-label="拼板分组">
      <button
        v-for="g in groups"
        :key="g.id"
        type="button"
        :aria-pressed="currentGroup === g.id"
        :class="{ 'drag-over': dropHint?.group === g.id }"
        :data-group="g.id"
        @click="emit('group', g.id)"
        @dragover="dragOver(g.id, $event)"
        @dragleave="dragLeave(g.id, $event)"
        @drop.prevent="emit('drop', { group: g.id, event: $event })"
      >{{ g.label }} {{ g.notes.length }}</button>
    </div>
    <div class="snip-lanes scroller">
      <div v-if="!groups.length" class="snip-empty">
        <OIcon :name="trash ? 'trash' : 'note'" :size="30" />
        <h2>{{ trash ? '回收站是空的' : '没有找到灵感' }}</h2>
        <button v-if="scoped" type="button" class="snip-soft" @click="emit('clear')">返回全部灵感</button>
      </div>
      <section
        v-for="g in groups"
        :key="g.id"
        class="snip-lane"
        :class="{ 'mobile-current': currentGroup === g.id, 'drag-over': dropHint?.group === g.id }"
        :data-snip-empty-drop="dropHint?.group === g.id && !dropHint.markerId || undefined"
        :data-group="g.id"
        @dragover="dragOver(g.id, $event)"
        @dragleave="dragLeave(g.id, $event)"
        @drop.prevent="emit('drop', { group: g.id, event: $event })"
      >
        <div class="snip-lane-head">
          <div><h2>{{ g.label }}<span>{{ g.notes.length }} 条</span></h2></div>
          <button v-if="!trash" type="button" :aria-label="'记录' + g.label + '灵感'" @click="emit('compose', g.tag || '')">＋</button>
        </div>
        <SnipCard
          v-for="n in g.notes"
          :key="n.id"
          :note="n"
          draggable
          :group="g.id"
          :selected="n.id === selectedId"
          :class="{ 'snip-drag-source': dragging?.id === n.id && dragging.group === g.id }"
          :data-drop-edge="dropHint?.group === g.id && dropHint.markerId === n.id ? dropHint.edge : undefined"
          @select="emit('select', $event)"
          @edit="emit('edit', $event)"
          @menu="emit('menu', $event)"
          @tag="emit('tag', $event)"
          @dragstart="emit('dragstart', $event)"
          @dragend="emit('dragend')"
        />
      </section>
    </div>
  </section>
</template>
