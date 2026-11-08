<!-- 拼板（设计稿 render.js:26）：按标签分栏，手柄拖动调整顺序，跨栏拖动先确认加标签。
     手机档改成「分组胶囊 + 单栏」，不把文字压成窄列。 -->
<script setup>
import { computed } from 'vue'
import OIcon from '../OIcon.vue'
import SnipCard from './SnipCard.vue'

const props = defineProps({
  groups: { type: Array, required: true },
  selectedId: { type: String, default: '' },
  current: { type: String, default: '' },
  dragging: { type: String, default: '' },
  over: { type: String, default: '' }
})
const emit = defineEmits(['select', 'edit', 'menu', 'tag', 'compose', 'group', 'dragstart', 'dragend', 'dragover', 'dragleave', 'drop'])

const currentGroup = computed(() => {
  const list = props.groups
  return list.some((g) => g.id === props.current) ? props.current : list[0]?.id || ''
})
const addTag = (id) => (props.groups.find(g=>g.id===id)?.tag || '')
</script>

<template>
  <section class="snip-board">
    <div class="snip-board-head">
      <span><OIcon name="tag" :size="14" />按标签分组</span>
      <span class="hint">拖动手柄调整顺序 · 跨组添加标签</span>
    </div>
    <div class="snip-mobile-groups" role="group" aria-label="拼板分组">
      <button
        v-for="g in groups"
        :key="g.id"
        type="button"
        :aria-pressed="currentGroup === g.id"
        @click="emit('group', g.id)"
      >{{ g.label }} {{ g.notes.length }}</button>
    </div>
    <div class="snip-lanes scroller">
      <div v-if="!groups.length" class="snip-empty"><OIcon name="note" :size="30" /><h2>没有找到灵感</h2><p>可清除筛选或回到全部灵感。</p></div>
      <section
        v-for="g in groups"
        :key="g.id"
        class="snip-lane"
        :class="{ 'mobile-current': currentGroup === g.id, 'drag-over': over === g.id }"
        :data-group="g.id"
        @dragover.prevent="emit('dragover', g.id)"
        @dragleave="emit('dragleave', g.id)"
        @drop.prevent="emit('drop', { group: g.id, event: $event })"
      >
        <div class="snip-lane-head">
          <div><h2>{{ g.label }}<span>{{ g.notes.length }} 条</span></h2></div>
          <button type="button" :aria-label="'记录' + g.label + '灵感'" @click="emit('compose', addTag(g.id))">＋</button>
        </div>
        <SnipCard
          v-for="n in g.notes"
          :key="n.id"
          :note="n"
          board
          draggable
          :group="g.id"
          :selected="n.id === selectedId"
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
