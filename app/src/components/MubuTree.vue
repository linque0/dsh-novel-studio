<!--
  MubuTree.vue — 设定模块左侧层级大纲导航树，支持全文过滤、拖拽归根、右键菜单与星系定位联动。
-->
<script setup>
import { computed, ref, watch, onActivated, onBeforeUnmount, onDeactivated, onMounted } from 'vue'
import { useWorkStore } from '../stores/work'
import { useUiStore } from '../stores/ui'
import { LORE_NAV_WIDE_THRESHOLD, loreNavCollapseIds } from '../services/lore-nav-tree.js'
import OIcon from './OIcon.vue'
import LoreNavNode from './lore/LoreNavNode.vue'
const work = useWorkStore(), ui = useUiStore(), menu = ref(null), deleting = ref(false), hoistId = ref(null)
const emit = defineEmits(['galaxy-pick', 'select', 'focus-branch', 'scope-all', 'created', 'moved'])
const galaxy = computed(() => ui.loreView === 'map' && ui.loreMapMode === 'relations')
const isWide = computed(() => (ui.loreNavWidth || 0) >= LORE_NAV_WIDE_THRESHOLD)
const roots = computed(() => work.mubuRoots())
const hoistNode = computed(() => (hoistId.value ? work.liveMubu().find(n => n.id === hoistId.value) || null : null))
const hoistPath = computed(() => (hoistNode.value ? work.mubuPath(hoistNode.value.id) : []))
const treeRoots = computed(() => (hoistNode.value ? work.mubuChildren(hoistNode.value.id) : roots.value))
const menuCanHoist = computed(() => Boolean(menu.value && menu.value.node.id !== hoistId.value && work.mubuChildren(menu.value.node.id).length > 0))
const hits = computed(() => { const q = ui.mubuQuery.trim().toLowerCase(); return q ? work.liveMubu().filter(n => [n.text, ...(n.tags || [])].join(' ').toLowerCase().includes(q)) : null })
watch(() => work.work?.id, () => { hoistId.value = null; menu.value = null })
watch(hoistNode, (n) => { if (hoistId.value && !n) hoistId.value = null })
function focusBranch(id) { emit('focus-branch', id); menu.value = null }
function hoistBranch(id) {
  if (!id || !work.liveMubu().some(n => n.id === id)) return
  hoistId.value = id
  ui.loreNavFold = ui.loreNavFold.filter(fid => fid !== id)
  menu.value = null
}
function exitHoist() { hoistId.value = null; menu.value = null }
function stepUpHoist() {
  if (!hoistNode.value) return
  hoistId.value = hoistNode.value.parentId || null
}
function collapseBranches() {
  const activeId = ui.loreActiveId || ui.mubuSelectedId || ui.loreRootId
  const activePath = activeId ? work.mubuPath(activeId).map(n => n.id) : []
  ui.loreNavFold = loreNavCollapseIds(
    work.liveMubu(),
    id => work.mubuChildren(id),
    activePath,
    ui.loreNavFold,
    { pinOpenIds: hoistId.value ? [hoistId.value] : [] }
  )
}
function enter(id) {
  if (galaxy.value) emit('galaxy-pick', id)
  else emit('select', id)
}
function all() {
  hoistId.value = null
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
function moveToHoist(event) {
  if (!hoistNode.value) return
  const id = event.dataTransfer.getData('application/x-lore-node')
  if (id && id !== hoistNode.value.id && work.mubuPlace(id, hoistNode.value.id, 'inside')) emit('moved', id)
}
function showMenu({ node, event }) { const b = event.target.getBoundingClientRect(); menu.value = { node, x: Math.min(innerWidth - 215, Math.max(8, event.clientX || b.x)), y: Math.min(innerHeight - 280, Math.max(8, event.clientY || b.bottom)) }; deleting.value = false }
function remove() { work.mubuCheckpoint(); work.mubuRemove(menu.value.node.id); menu.value = null }
function close(e) { if (!e.target.closest('.lore-nav-context,.lore-nav-more')) menu.value = null }
function key(e) { if (e.key === 'Escape') menu.value = null }
let treeListenersBound = false
function bindTreeListeners() {
  if (treeListenersBound) return
  treeListenersBound = true
  document.addEventListener('pointerdown', close); document.addEventListener('keydown', key)
}
function unbindTreeListeners() {
  if (!treeListenersBound) return
  treeListenersBound = false
  document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', key)
}
onMounted(bindTreeListeners)
onActivated(bindTreeListeners)
onDeactivated(() => { menu.value = null; unbindTreeListeners() })
onBeforeUnmount(unbindTreeListeners)
</script>
<template>
  <div class="nav-pane" role="navigation" aria-label="设定目录">
    <button class="lore-rail" data-rail type="button" aria-label="展开设定目录" @click="ui.setPref('loreNavClosed', false)"><OIcon name="folder" :size="17" /><span>世界设定</span></button>
    <div class="nav-head"><OIcon name="folder" :size="16" /><h2>世界设定</h2><button class="nav-collapse" aria-label="收起设定目录" @click="ui.setPref('loreNavClosed', true)"><OIcon name="caret-right" :size="14" /></button></div>
    <label class="nav-search"><OIcon name="search" :size="14" /><input v-model="ui.mubuQuery" placeholder="搜索节点、标签…" aria-label="搜索节点或标签" /><button v-if="ui.mubuQuery" aria-label="清除筛选" @click="ui.mubuQuery = ''"><OIcon name="close" :size="12" /></button></label>
    <div class="nav-section-label">
      <span class="nav-section-title">条目目录</span>
      <span class="nav-section-actions">
        <button class="nav-add nav-collapse-tree" type="button" title="收起无关分支（再次点击全部折叠）" aria-label="收起无关分支/全部折叠" @click="collapseBranches"><OIcon name="layers" :size="13" /></button>
        <button class="nav-add" type="button" title="新建顶层条目" aria-label="新建顶层条目" @click="create()"><OIcon name="plus" :size="13" /></button>
      </span>
    </div>
    <div class="nav-tree">
      <button class="category all-scope" :class="{ current: ui.loreScope === 'all' && !hoistNode }" :aria-pressed="ui.loreScope === 'all' && !hoistNode" @click="all" @dragover.prevent @drop.prevent="moveToRoot"><OIcon name="container" :size="15" /><span>全部条目</span><small>{{ work.liveMubu().length }}</small></button>
      <div v-if="hoistNode" class="lore-nav-hoist" @dragover.prevent @drop.prevent="moveToHoist">
        <div class="lore-nav-hoist-top">
          <button class="lore-nav-hoist-back" type="button" title="返回上一级" aria-label="返回上一级" @click="stepUpHoist"><OIcon name="back" :size="12" /></button>
          <div class="lore-nav-hoist-crumbs" aria-label="目录层级路径">
            <button type="button" class="lore-nav-hoist-crumb" @click="exitHoist">全部</button>
            <template v-for="(anc, idx) in hoistPath.slice(0, -1)" :key="anc.id">
              <span class="lore-nav-hoist-sep" aria-hidden="true">›</span>
              <button type="button" class="lore-nav-hoist-crumb" :title="anc.text || '未命名节点'" @click="hoistBranch(anc.id)">{{ anc.text || '未命名节点' }}</button>
            </template>
          </div>
          <button class="lore-nav-hoist-exit" type="button" title="返回完整目录" aria-label="返回完整目录" @click="exitHoist"><OIcon name="close" :size="11" /></button>
        </div>
        <button class="lore-nav-hoist-current" type="button" :title="hoistNode.text || '未命名节点'" @click="enter(hoistNode.id)">
          <span>{{ hoistNode.text || '未命名节点' }}</span>
          <small>{{ treeRoots.length }}</small>
        </button>
      </div>
      <div role="tree" aria-label="设定条目树"><LoreNavNode v-for="n in treeRoots" :key="n.id" :node="n" :wide="isWide" @menu="showMenu" @pick="enter" @moved="emit('moved', $event)" /></div>
      <p v-if="hoistNode && !treeRoots.length" class="nav-empty">该分支暂无子条目</p>
      <template v-if="hits"><div class="nav-section-label search-label">检索结果 <span>{{ hits.length }}</span></div><button v-for="n in hits" :key="'hit:' + n.id" class="nav-entry lore-search-result" @click="enter(n.id)"><strong>{{ n.text || '未命名节点' }}</strong><small>{{ work.mubuPath(n.id).slice(0, -1).map(n => n.text).join(' › ') }}</small></button><p v-if="!hits.length" class="nav-empty">没有匹配节点</p></template>
    </div>
    <footer class="nav-foot"><span>{{ work.liveLoreLinks.length }} 条世界关系</span><button @click="create(hoistId || null)">＋ 新建节点</button></footer>
    <Teleport to="body"><div v-if="menu" class="lore-nav-context" :style="{ left: menu.x + 'px', top: menu.y + 'px' }" role="dialog" aria-label="节点操作">
      <strong>{{ (menu.node.text || '空节点').slice(0, 24) }}</strong>
      <template v-if="!deleting"><button @click="focusBranch(menu.node.id)">聚焦此条目</button><button v-if="menuCanHoist" @click="hoistBranch(menu.node.id)">在目录中下钻此分支</button><button v-if="hoistNode" @click="exitHoist">返回完整目录</button><button @click="create(menu.node.id)">添加子条目</button><button @click="create(menu.node.parentId, menu.node.id)">添加同级条目</button><button @click="ui.mubuTagPanel = { nodeId: menu.node.id, x: menu.x, y: menu.y }; menu = null">编辑标签</button><button class="danger" @click="deleting = true">删除此条目及其子条目</button></template>
      <template v-else><p>删除后可在节点大纲中撤销恢复。</p><button class="danger" @click="remove">确认删除</button><button @click="deleting = false">取消</button></template>
    </div></Teleport>
  </div>
</template>
