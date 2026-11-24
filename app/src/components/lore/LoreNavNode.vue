<script setup>
import { computed } from 'vue'
import OIcon from '../OIcon.vue'
import LoreWeightIcon from '../LoreWeightIcon.vue'
import { useWorkStore } from '../../stores/work'
import { useUiStore } from '../../stores/ui'
import { kindOf } from './lore-kinds.js'
import { entryWeightMeta } from '../../services/lore-weights.js'
import { loreNavDepthCap, loreNavGuideX, loreNavIndentPx } from '../../services/lore-nav-tree.js'
const props = defineProps({ node: Object, depth: { type: Number, default: 0 }, wide: { type: Boolean, default: false } })
const emit = defineEmits(['menu', 'pick', 'moved'])
const work = useWorkStore(), ui = useUiStore()
const children = computed(() => work.mubuChildren(props.node.id))
const closed = computed(() => ui.loreNavFold.includes(props.node.id))
const weight = computed(() => work.mubuEntryWeight(props.node))
const weightMeta = computed(() => entryWeightMeta(weight.value))
const indentPx = computed(() => loreNavIndentPx(props.depth, { wide: props.wide }))
const guideX = computed(() => loreNavGuideX(props.depth, { wide: props.wide }))
const capped = computed(() => props.depth >= loreNavDepthCap(props.wide))
const rowStyle = computed(() => ({ '--nav-depth': props.depth, '--nav-indent': `${indentPx.value}px` }))
const groupStyle = computed(() => (guideX.value != null ? { '--guide-x': `${guideX.value}px` } : undefined))
const tooltip = computed(() => {
  const title = props.node.text || '未命名节点'
  const base = props.depth >= 4 ? work.mubuPath(props.node.id).map(n => n.text || '未命名节点').join(' › ') : title
  return weight.value !== 'standard' ? `${base} · ${weightMeta.value.label}` : base
})
function fold() { ui.loreNavFold = closed.value ? ui.loreNavFold.filter(id => id !== props.node.id) : [...ui.loreNavFold, props.node.id] }
const current = computed(() => {
  return (ui.loreActiveId || ui.mubuSelectedId || ui.loreRootId) === props.node.id
})
function start(e) { e.dataTransfer.setData('application/x-lore-node', props.node.id); e.dataTransfer.effectAllowed = 'move' }
function drop(e) {
  const id = e.dataTransfer.getData('application/x-lore-node'); if (!id) return
  const r = e.currentTarget.getBoundingClientRect(), at = (e.clientY - r.top) / r.height
  const zone = at < .25 ? 'before' : at > .75 ? 'after' : 'inside'
  if (work.mubuPlace(id, props.node.id, zone)) emit('moved', id)
}
</script>
<template>
  <div class="lore-nav-branch" role="treeitem" :aria-level="depth + 1" :aria-expanded="children.length ? !closed : undefined" :aria-selected="current">
    <div class="lore-nav-row" :class="{ current, 'is-root': depth === 0, 'is-leaf': !children.length, 'is-capped': capped }" :style="rowStyle" @dragover.prevent @drop.prevent.stop="drop" @contextmenu.prevent="emit('menu', { node, event: $event })">
      <button v-if="children.length" class="lore-nav-fold" :class="{ folded: closed }" :aria-label="(closed ? '展开' : '折叠') + node.text" @click="fold"><OIcon name="caret-right" :size="11" /></button><span v-else class="lore-nav-fold-space" />
      <button class="lore-nav-node" :class="depth === 0 ? 'category' : 'nav-entry'" :data-id="node.id" :data-kind="kindOf(node).kind" :data-weight="weight" :title="tooltip" draggable="true" @dragstart="start" @click="emit('pick', node.id)"><i v-if="depth > 0 && !children.length" /><span class="lore-nav-label">{{ node.text || '未命名节点' }}</span><em v-if="capped" class="lore-nav-depth" :aria-label="`第${depth + 1}层`">L{{ depth + 1 }}</em><span v-if="weight !== 'standard'" class="lore-nav-weight" :class="`is-${weight}`" :title="`权重：${weightMeta.label}`"><LoreWeightIcon :weight="weight" :size="12" /></span></button>
      <button class="lore-nav-more" :aria-label="(node.text || '节点') + '的操作'" @click="emit('menu', { node, event: $event })"><OIcon name="dots" :size="13" /></button>
    </div>
    <div v-if="!closed && children.length" class="lore-nav-group" :class="{ 'no-guide': guideX == null }" :style="groupStyle" role="group"><LoreNavNode v-for="child in children" :key="child.id" :node="child" :depth="depth + 1" :wide="wide" @menu="emit('menu', $event)" @pick="emit('pick', $event)" @moved="emit('moved', $event)" /></div>
  </div>
</template>
