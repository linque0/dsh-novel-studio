<script setup>
import { computed } from 'vue'
import { useWorkStore } from '../../stores/work'
import { useUiStore } from '../../stores/ui'
import { findReferences, findOutgoingReferences, targetById } from '../../services/doublelinks'
import OIcon from '../OIcon.vue'
import LoreRelRows from '../LoreRelRows.vue'
defineProps({ overlay: Boolean })
const work = useWorkStore(), ui = useUiStore()
const id = computed(() => ui.loreView === 'write' ? ui.loreScope !== 'all' ? ui.loreRootId || work.currentMubuRoot()?.id : ui.mubuSelectedId : ui.loreActiveId || ui.mubuSelectedId)
const current = computed(() => work.mubu.find(n => n.id === id.value && !n.deletedAt))
const incoming = computed(() => id.value ? findReferences({ kind: 'mubu', id: id.value }) : [])
const outgoing = computed(() => id.value ? findOutgoingReferences({ kind: 'mubu', id: id.value }, true) : [])
const children = computed(() => work.mubuChildren(id.value)), relations = computed(() => id.value ? work.loreLinksOf('mubu', id.value) : [])
function peek(t) { ui.lorePeek = { kind: t.kind, id: t.id, title: t.title } }
function relationPick(t) { const target = targetById(t.otherKind, t.otherId); if (target) peek(target) }
function addRelation() { if (id.value) ui.loreRelationPanel = { kind: 'mubu', id: id.value, x: Math.max(8, innerWidth - 390), y: 150 } }
</script>
<template>
  <Teleport to="body" :disabled="!overlay"><aside class="lore-reference-pane" :class="{ overlay }" aria-label="链接与引用">
    <header><span><OIcon name="link" :size="14" /> 链接与引用</span><button class="lore-icon" aria-label="关闭链接与引用" @click="ui.loreLinksOpen = false"><OIcon name="close" :size="14" /></button></header>
    <nav class="lore-reference-tabs" aria-label="引用面板"><button v-for="t in [{ id: 'backlinks', label: '反向链接', count: incoming.length }, { id: 'outline', label: '本页目录', count: children.length }, { id: 'relations', label: '关系', count: relations.length }]" :key="t.id" :class="{ active: ui.loreReferenceTab === t.id }" :aria-pressed="ui.loreReferenceTab === t.id" @click="ui.loreReferenceTab = t.id">{{ t.label }} <small>{{ t.count }}</small></button></nav>
    <div class="lore-reference-scroll">
      <template v-if="ui.loreReferenceTab === 'backlinks'"><p class="lore-reference-caption">引用「{{ (current?.text || '当前节点').slice(0, 20) }}」</p><button v-for="s in incoming" :key="s.kind + ':' + s.id" class="lore-backlink" :data-source="s.kind + ':' + s.id" @click="peek(s)"><small>{{ s.path || s.title }}</small><p>{{ s.excerpt }}</p></button><p v-if="!incoming.length" class="lore-reference-empty">还没有内容链接到这里。<br>在其他节点输入 [[ 即可建立引用。</p><h3>出链 <small>{{ outgoing.length }}</small></h3><button v-for="t in outgoing" :key="t.kind + ':' + t.id" class="lore-outgoing" :class="{ missing: t.missing }" @click="peek(t)"><OIcon name="link" :size="12" /><span>{{ t.title }}</span><OIcon name="caret-right" :size="11" /></button></template>
      <template v-else-if="ui.loreReferenceTab === 'outline'"><button v-for="n in children" :key="n.id" class="lore-outline-item" @click="ui.focusLoreNode(n.id, work.mubuPath(n.id))"><OIcon name="caret-right" :size="11" />{{ n.text || '空节点' }}</button><p v-if="!children.length" class="lore-reference-empty">还没有子节点</p></template>
      <template v-else><p class="lore-reference-caption">手动建立的设定关系</p><LoreRelRows :entries="relations" @pick="relationPick" /><p v-if="!relations.length" class="lore-reference-empty">还没有设定关系</p><button class="lore-btn" @click="addRelation">＋ 建立关系</button></template>
    </div>
  </aside></Teleport>
</template>
