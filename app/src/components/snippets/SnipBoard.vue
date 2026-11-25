<!-- 拼板（设计稿 render.js:26）：按标签分栏，拖动图钉调整顺序或更换标签组。
     大样本按泳道渐进挂载（视口附近优先渲染，滚动/拖拽/导航跳转自动展开），避免一次性挂载数百张卡片阻塞首帧。
     手机档改成「分组胶囊 + 单栏」，不把文字压成窄列。 -->
<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import OIcon from '../OIcon.vue'
import SnipCard from './SnipCard.vue'
import { SNIP_CARD_SIZE } from './snippet-model.js'

const INITIAL_VISIBLE_LANES = 4
const INITIAL_LANE_CARDS = 6
const OFFSCREEN_LANE_CARDS = 2
const LANE_EXPAND_STEP = 12

const props = defineProps({
  groups: { type: Array, required: true },
  cardSize: { type: Number, default: SNIP_CARD_SIZE.initial },
  trash: Boolean,
  scoped: Boolean,
  selectedId: { type: String, default: '' },
  current: { type: String, default: '' },
  dragging: { type: Object, default: null },
  dropHint: { type: Object, default: null },
  assetUrl: { type: Function, default: () => '' }
})
const emit = defineEmits(['select', 'edit', 'menu', 'tag', 'open-url', 'compose', 'group', 'dragstart', 'dragend', 'dragover', 'dragleave', 'drop', 'clear', 'rendered-assets'])

const lanesEl = ref(null)
const laneLimits = reactive({})
const sentinels = new Map()
let observer = null

const currentGroup = computed(() => {
  const list = props.groups
  return list.some((g) => g.id === props.current) ? props.current : list[0]?.id || ''
})

function baseLimitFor(group, index) {
  return index < INITIAL_VISIBLE_LANES || group.id === currentGroup.value
    ? INITIAL_LANE_CARDS
    : OFFSCREEN_LANE_CARDS
}

function limitFor(group, index) {
  const base = baseLimitFor(group, index)
  const stored = laneLimits[group.id] || 0
  return Math.max(base, stored)
}

function renderedNotes(group, index) {
  const limit = limitFor(group, index)
  return group.notes.length > limit ? group.notes.slice(0, limit) : group.notes
}

function remainingCount(group, index) {
  return Math.max(0, group.notes.length - limitFor(group, index))
}

function expandLane(groupId, step = LANE_EXPAND_STEP) {
  const idx = props.groups.findIndex((g) => g.id === groupId)
  if (idx < 0) return
  const group = props.groups[idx]
  const current = limitFor(group, idx)
  if (current >= group.notes.length) return
  laneLimits[groupId] = Math.min(group.notes.length, current + step)
}

/** 确保指定分组内的目标卡片已挂载（用于目录跳转 scrollIntoView 与跨栏拖拽落点动效）。 */
function ensureVisible(groupId, noteId) {
  const idx = props.groups.findIndex((g) => g.id === groupId)
  if (idx < 0) return false
  const group = props.groups[idx]
  const noteIdx = noteId ? group.notes.findIndex((n) => n.id === noteId) : -1
  if (noteIdx < 0) return false
  const needed = noteIdx + 4
  if (limitFor(group, idx) < needed) {
    laneLimits[groupId] = Math.min(group.notes.length, needed)
  }
  return true
}

function setSentinelRef(groupId, el) {
  const prev = sentinels.get(groupId)
  if (prev && prev !== el) {
    observer?.unobserve(prev)
    sentinels.delete(groupId)
  }
  if (el) {
    sentinels.set(groupId, el)
    observer?.observe(el)
  }
}

function setupObserver() {
  observer?.disconnect()
  observer = null
  if (typeof IntersectionObserver !== 'function' || !lanesEl.value) return
  observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue
      const gid = entry.target.dataset.sentinelGroup
      if (gid) expandLane(gid)
    }
  }, { root: lanesEl.value, rootMargin: '120px 60px' })
  for (const el of sentinels.values()) observer.observe(el)
}

/* 选中项变化时若位于当前泳道未挂载尾部，自动展开至可见；避免整板重排。 */
watch(() => props.selectedId, (id) => {
  if (!id) return
  const curId = currentGroup.value
  const cur = props.groups.find((g) => g.id === curId)
  if (cur && cur.notes.some((n) => n.id === id)) {
    ensureVisible(cur.id, id)
    return
  }
  const first = props.groups.find((g) => g.notes.some((n) => n.id === id))
  if (first) ensureVisible(first.id, id)
}, { immediate: true })

/* 清理已移除分组的限额记录，避免切换筛选或作品后残留旧键。 */
watch(() => props.groups, (list) => {
  const alive = new Set(list.map((g) => g.id))
  for (const key of Object.keys(laneLimits)) {
    if (!alive.has(key)) delete laneLimits[key]
  }
})

/* 仅对当前实际挂载卡片的图片资产触发增量预热，避免大样本含图首帧全量解码。 */
const renderedAssetIds = computed(() => {
  const ids = []
  const seen = new Set()
  props.groups.forEach((group, index) => {
    for (const n of renderedNotes(group, index)) {
      for (const img of n.images || []) {
        if (img.assetId && !seen.has(img.assetId)) {
          seen.add(img.assetId)
          ids.push(img.assetId)
        }
      }
    }
  })
  return ids
})
watch(renderedAssetIds, (ids) => emit('rendered-assets', ids), { immediate: true })

onMounted(() => { nextTick(setupObserver) })
onBeforeUnmount(() => {
  observer?.disconnect()
  observer = null
  sentinels.clear()
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

defineExpose({ ensureVisible, expandLane })
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
    <div ref="lanesEl" class="snip-lanes scroller">
      <div v-if="!groups.length" class="snip-empty">
        <OIcon :name="trash ? 'trash' : 'note'" :size="30" />
        <h2>{{ trash ? '回收站是空的' : '没有找到灵感' }}</h2>
        <button v-if="scoped" type="button" class="snip-soft" @click="emit('clear')">返回全部灵感</button>
      </div>
      <section
        v-for="(g, gIndex) in groups"
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
          v-for="n in renderedNotes(g, gIndex)"
          :key="n.id"
          :note="n"
          draggable
          :group="g.id"
          :selected="n.id === selectedId"
          :asset-url="assetUrl"
          :class="{ 'snip-drag-source': dragging?.id === n.id && dragging.group === g.id }"
          :data-drop-edge="dropHint?.group === g.id && dropHint.markerId === n.id ? dropHint.edge : undefined"
          @select="emit('select', $event)"
          @edit="emit('edit', $event)"
          @menu="emit('menu', $event)"
          @tag="emit('tag', $event)"
          @open-url="emit('open-url', $event)"
          @dragstart="emit('dragstart', $event)"
          @dragend="emit('dragend')"
        />
        <div
          v-if="remainingCount(g, gIndex) > 0"
          :ref="(el) => setSentinelRef(g.id, el)"
          class="snip-lane-more-wrap"
          :data-sentinel-group="g.id"
          @dragenter="expandLane(g.id)"
        >
          <button type="button" class="snip-lane-more" @click="expandLane(g.id)">
            还有 {{ remainingCount(g, gIndex) }} 条 · 展开更多
          </button>
        </div>
      </section>
    </div>
  </section>
</template>
