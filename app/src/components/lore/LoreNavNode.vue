<script setup>
import { computed } from 'vue'
import OIcon from '../OIcon.vue'
import { useWorkStore } from '../../stores/work'
import { useUiStore } from '../../stores/ui'
import { kindOf } from './lore-kinds.js'
const props = defineProps({ node: Object, depth: { type: Number, default: 0 } })
const emit = defineEmits(['menu'])
const work = useWorkStore(), ui = useUiStore()
const children = computed(() => work.mubuChildren(props.node.id))
const closed = computed(() => ui.loreNavFold.includes(props.node.id))
function fold() { ui.loreNavFold = closed.value ? ui.loreNavFold.filter(id => id !== props.node.id) : [...ui.loreNavFold, props.node.id] }
function enter() { work.setMubuSet(work.mubuRootOf(props.node.id)?.id); ui.focusLoreNode(props.node.id, work.mubuPath(props.node.id)) }
function start(e) { e.dataTransfer.setData('application/x-lore-node', props.node.id); e.dataTransfer.effectAllowed = 'move' }
function drop(e) {
  const id = e.dataTransfer.getData('application/x-lore-node'); if (!id) return
  const r = e.currentTarget.getBoundingClientRect(), at = (e.clientY - r.top) / r.height
  const zone = at < .25 ? 'before' : at > .75 ? 'after' : 'inside'
  work.mubuCheckpoint(); work.mubuMove(id, props.node.id, zone); work.mubuRevision++
}
</script>
<template>
  <div class="lore-nav-branch" role="treeitem" :aria-level="depth + 1" :aria-expanded="children.length ? !closed : undefined" :aria-selected="ui.loreScope !== 'all' && (ui.loreRootId || work.mubuSetId) === node.id">
    <div class="lore-nav-row" :class="{ current: ui.loreScope !== 'all' && (ui.loreRootId || work.mubuSetId) === node.id }" :style="{ '--nav-depth': depth }" @dragover.prevent @drop.prevent.stop="drop" @contextmenu.prevent="emit('menu', { node, event: $event })">
      <button v-if="children.length" class="lore-nav-fold" :class="{ folded: closed }" :aria-label="(closed ? '展开' : '折叠') + node.text" @click="fold"><OIcon name="caret-right" :size="11" /></button><span v-else class="lore-nav-fold-space" />
      <button class="lore-nav-node" :class="depth === 0 ? 'category' : 'nav-entry'" :data-id="node.id" :data-kind="kindOf(node).kind" :title="node.text" draggable="true" @dragstart="start" @click="enter"><OIcon v-if="depth === 0" :name="kindOf(node).icon" :size="14" /><i v-else /><span>{{ node.text || '未命名节点' }}</span></button>
      <button class="lore-nav-more" :aria-label="(node.text || '节点') + '的操作'" @click="emit('menu', { node, event: $event })"><OIcon name="dots" :size="13" /></button>
    </div>
    <div v-if="!closed && children.length" role="group"><LoreNavNode v-for="child in children" :key="child.id" :node="child" :depth="depth + 1" @menu="emit('menu', $event)" /></div>
  </div>
</template>
