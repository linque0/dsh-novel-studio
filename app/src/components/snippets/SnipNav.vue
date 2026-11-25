<!--
  SnipNav.vue — 灵感工作台左侧分组/标签过滤、排序及卡片尺寸滑块导航栏。
-->
<script setup>
import { computed, reactive, ref, useId, watch } from 'vue'
import OIcon from '../OIcon.vue'
import { SNIP_CARD_SIZE } from './snippet-model.js'

const NAV_INITIAL_LIMIT = 40
const NAV_EXPAND_STEP = 60

const props = defineProps({
  workTitle: { type: String, default: '' },
  groups: { type: Array, required: true },
  expanded: { type: Array, required: true },
  selectedId: { type: String, default: '' },
  filter: { type: String, default: 'all' },
  tag: { type: String, default: '' },
  trashCount: { type: Number, default: 0 },
  cardSize: { type: Number, required: true },
  sort: { type: String, required: true }
})
const emit = defineEmits(['filter', 'tag', 'toggle-group', 'select-note', 'card-size', 'sort'])
const sizing = ref(false)
const navLimits = reactive({})
const sizePanelId = useId()
const sliderId = sizePanelId + '-slider'
const sizeFill = computed(() => `${(props.cardSize - SNIP_CARD_SIZE.min) / (SNIP_CARD_SIZE.max - SNIP_CARD_SIZE.min) * 100}%`)
const openGroups = computed(() => new Set(props.expanded))
const sorts = { new: '最新', old: '最早', manual: '手动' }

function navLimitFor(group) {
  let limit = Math.max(NAV_INITIAL_LIMIT, navLimits[group.id] || 0)
  if (props.selectedId && group.notes.length > limit) {
    const idx = group.notes.findIndex((n) => n.id === props.selectedId)
    if (idx >= limit) limit = idx + 10
  }
  return limit
}
function visibleGroupNotes(group) {
  const limit = navLimitFor(group)
  return group.notes.length > limit ? group.notes.slice(0, limit) : group.notes
}
function hiddenGroupCount(group) {
  return Math.max(0, group.notes.length - navLimitFor(group))
}
function expandNavGroup(group) {
  navLimits[group.id] = Math.min(group.notes.length, navLimitFor(group) + NAV_EXPAND_STEP)
}
watch(() => props.groups, (list) => {
  const alive = new Set(list.map((g) => g.id))
  for (const key of Object.keys(navLimits)) if (!alive.has(key)) delete navLimits[key]
})

function isActive(group) {
  return group.tag ? props.tag === group.tag : !props.tag && props.filter === group.filter
}
function showGroup(group) {
  if (group.tag) emit('tag', group.tag)
  else emit('filter', group.filter)
}
</script>

<template>
  <nav class="snip-nav" aria-label="灵感导航">
    <div class="snip-nav-content">
      <div class="snip-nav-work">
        <div class="work-heading">当前作品</div>
        <h2 :title="workTitle">{{ workTitle }}</h2>
      </div>

      <template v-for="(group, index) in groups" :key="group.id">
        <h3 v-if="index === 3" class="snip-nav-heading">标签</h3>
        <div class="snip-nav-group">
          <div class="snip-nav-group-head" :class="{ selected: isActive(group) }">
            <button
              class="snip-nav-disclosure"
              type="button"
              :disabled="!group.notes.length"
              :aria-label="(openGroups.has(group.id) ? '折叠' : '展开') + group.label"
              :aria-expanded="openGroups.has(group.id)"
              @click="emit('toggle-group', group.id)"
            ><OIcon :name="openGroups.has(group.id) ? 'caret-down' : 'caret-right'" :size="12" /></button>
            <button
              class="snip-nav-row"
              type="button"
              :data-value="group.filter"
              :data-tag="group.tag"
              :title="group.label"
              :aria-pressed="isActive(group)"
              @click="showGroup(group)"
            >
              <OIcon v-if="group.icon" :name="group.icon" :size="15" />
              <span v-else class="hash">#</span>
              <span>{{ group.label }}</span><b>{{ group.notes.length }}</b>
            </button>
          </div>

          <ul v-if="openGroups.has(group.id) && group.notes.length" class="snip-nav-notes">
            <li v-for="note in visibleGroupNotes(group)" :key="note.id">
              <button
                class="snip-nav-note"
                type="button"
                :aria-current="selectedId === note.id || undefined"
                :data-card-color="note.cardColor"
                :title="note.title || '未命名'"
                @click="emit('select-note', { group, note })"
              >{{ note.title || '未命名' }}</button>
            </li>
            <li v-if="hiddenGroupCount(group) > 0" class="snip-nav-more-item">
              <button type="button" class="snip-nav-more" @click="expandNavGroup(group)">
                显示更多（剩余 {{ hiddenGroupCount(group) }} 条）
              </button>
            </li>
          </ul>
        </div>
      </template>
    </div>

    <footer class="snip-nav-footer">
      <div class="snip-nav-control">
        <span>排序</span>
        <div class="snip-nav-options" role="group" aria-label="卡片排序">
          <button v-for="(label, key) in sorts" :key="key" type="button" :aria-pressed="sort === key" @click="emit('sort', key)">{{ label }}</button>
        </div>
      </div>
      <div v-if="sizing" :id="sizePanelId" class="snip-size-control">
        <label class="snip-size-caption" :for="sliderId">缩放比例<span class="num" aria-hidden="true">{{ cardSize }}%</span></label>
        <div class="snip-size-slider" :style="{ '--snip-size-fill': sizeFill }">
          <span class="snip-size-track" aria-hidden="true"><span class="snip-size-fluid"></span></span>
          <input
            :id="sliderId"
            type="range"
            :min="SNIP_CARD_SIZE.min"
            :max="SNIP_CARD_SIZE.max"
            :value="cardSize"
            :aria-valuetext="cardSize + '%'"
            @input="emit('card-size', $event.currentTarget.valueAsNumber)"
          >
        </div>
      </div>
      <div class="snip-nav-bottom">
        <button type="button" class="snip-nav-bottom-button" :aria-expanded="sizing" :aria-controls="sizePanelId" @click="sizing = !sizing">
          <OIcon name="rows" :size="15" /><span>卡片大小</span>
        </button>
        <button type="button" class="snip-nav-bottom-button" data-value="trash" :aria-pressed="filter === 'trash'" @click="emit('filter', 'trash')">
          <OIcon name="trash" :size="15" /><span>回收站</span><b v-if="trashCount">{{ trashCount }}</b>
        </button>
      </div>
    </footer>
  </nav>
</template>
