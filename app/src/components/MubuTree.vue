<script setup>
import { computed, ref, onMounted, onBeforeUnmount } from 'vue'
import { useWorkStore } from '../stores/work'
import { useUiStore } from '../stores/ui'
import OIcon from './OIcon.vue'
import LoreNavNode from './lore/LoreNavNode.vue'
const work = useWorkStore(), ui = useUiStore(), menu = ref(null), deleting = ref(false)
const emit = defineEmits(['galaxy-pick', 'select', 'focus-branch', 'scope-all', 'created', 'moved'])
const galaxy = computed(() => ui.loreView === 'map' && ui.loreMapMode === 'relations')
const roots = computed(() => work.mubuRoots())
const hits = computed(() => { const q = ui.mubuQuery.trim().toLowerCase(); return q ? work.liveMubu().filter(n => [n.text, ...(n.tags || [])].join(' ').toLowerCase().includes(q)) : null })
function focusBranch(id) { emit('focus-branch', id); menu.value = null }
function enter(id) {
  if (galaxy.value) emit('galaxy-pick', id)
  else emit('select', id)
}
function all() {
  if (galaxy.value) emit('galaxy-pick', null)
  else emit('scope-all')
}
function create(parentId = null, afterId = null) {
  work.mubuCheckpoint()
  if (parentId && work.mubu.find(node => node.id === parentId)?.fold) work.mubuToggleFold(parentId)
  const node = work.mubuAdd(parentId, afterId, '')
  menu.value = null
  if (!node) return
  if (galaxy.value) emit('galaxy-pick', node.id)
  else emit('created', node.id)
}
function moveToRoot(event) {
  const id = event.dataTransfer.getData('application/x-lore-node')
  if (id && work.mubuPlace(id, null, 'root')) emit('moved', id)
}
function showMenu({ node, event }) { const b = event.target.getBoundingClientRect(); menu.value = { node, x: Math.min(innerWidth - 215, Math.max(8, event.clientX || b.x)), y: Math.min(innerHeight - 250, Math.max(8, event.clientY || b.bottom)) }; deleting.value = false }
function remove() { work.mubuCheckpoint(); work.mubuRemove(menu.value.node.id); menu.value = null }
function close(e) { if (!e.target.closest('.lore-nav-context,.lore-nav-more')) menu.value = null }
function key(e) { if (e.key === 'Escape') menu.value = null }
onMounted(() => { document.addEventListener('pointerdown', close); document.addEventListener('keydown', key) })
onBeforeUnmount(() => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', key) })
</script>
<template>
  <div class="nav-pane" role="navigation" aria-label="设定目录">
    <button class="lore-rail" data-rail type="button" aria-label="展开设定目录" @click="ui.setPref('loreNavClosed', false)"><OIcon name="folder" :size="17" /><span>世界设定</span></button>
    <div class="nav-head"><OIcon name="folder" :size="16" /><h2>世界设定</h2><button class="nav-collapse" aria-label="收起设定目录" @click="ui.setPref('loreNavClosed', true)"><OIcon name="caret-right" :size="14" /></button></div>
    <label class="nav-search"><OIcon name="search" :size="14" /><input v-model="ui.mubuQuery" placeholder="搜索节点、标签…" aria-label="搜索节点或标签" /><button v-if="ui.mubuQuery" aria-label="清除筛选" @click="ui.mubuQuery = ''"><OIcon name="close" :size="12" /></button></label>
    <div class="nav-section-label">条目目录 <button class="nav-add" aria-label="新建顶层条目" @click="create()"><OIcon name="plus" :size="13" /></button></div>
    <div class="nav-tree">
      <button class="category all-scope" :class="{ current: ui.loreScope === 'all' }" :aria-pressed="ui.loreScope === 'all'" @click="all" @dragover.prevent @drop.prevent="moveToRoot"><OIcon name="container" :size="15" /><span>全部条目</span><small>{{ work.liveMubu().length }}</small></button>
      <div role="tree" aria-label="设定条目树"><LoreNavNode v-for="n in roots" :key="n.id" :node="n" @menu="showMenu" @pick="enter" @moved="emit('moved', $event)" /></div>
      <template v-if="hits"><div class="nav-section-label search-label">检索结果 <span>{{ hits.length }}</span></div><button v-for="n in hits" :key="'hit:' + n.id" class="nav-entry lore-search-result" @click="enter(n.id)"><strong>{{ n.text || '未命名节点' }}</strong><small>{{ work.mubuPath(n.id).slice(0, -1).map(n => n.text).join(' › ') }}</small></button><p v-if="!hits.length" class="nav-empty">没有匹配节点</p></template>
    </div>
    <footer class="nav-foot"><span>{{ work.liveLoreLinks.length }} 条世界关系</span><button @click="create()">＋ 新建节点</button></footer>
    <Teleport to="body"><div v-if="menu" class="lore-nav-context" :style="{ left: menu.x + 'px', top: menu.y + 'px' }" role="dialog" aria-label="节点操作">
      <strong>{{ (menu.node.text || '空节点').slice(0, 24) }}</strong>
      <template v-if="!deleting"><button @click="focusBranch(menu.node.id)">聚焦此条目</button><button @click="create(menu.node.id)">添加子条目</button><button @click="create(menu.node.parentId, menu.node.id)">添加同级条目</button><button @click="ui.mubuTagPanel = { nodeId: menu.node.id, x: menu.x, y: menu.y }; menu = null">编辑标签</button><button class="danger" @click="deleting = true">删除此条目及其子条目</button></template>
      <template v-else><p>删除后可在节点大纲中撤销恢复。</p><button class="danger" @click="remove">确认删除</button><button @click="deleting = false">取消</button></template>
    </div></Teleport>
  </div>
</template>
