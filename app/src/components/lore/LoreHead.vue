<script setup>
import { computed, ref, watch } from 'vue'
import OIcon from '../OIcon.vue'
import { useWorkStore } from '../../stores/work'
import { useUiStore } from '../../stores/ui'
import { cleanLoreHtml, loreText } from '../../services/lore-editor-dom.js'
defineProps({ compact: Boolean, narrow: Boolean, navOpen: Boolean })
const emit = defineEmits(['view', 'scope', 'new', 'clear-filter', 'nav', 'position'])
const work = useWorkStore(), ui = useUiStore(), titleEl = ref(null)
const current = computed(() => work.mubu.find(n => n.id === (ui.loreView === 'write' ? ui.loreRootId || work.currentMubuRoot()?.id : ui.loreActiveId) && !n.deletedAt))
const all = computed(() => ui.loreScope === 'all' && ui.loreView === 'write')
const title = computed(() => ui.loreView === 'map' ? '视觉导图' : all.value ? '全部设定' : current.value?.text || '世界设定')
const path = computed(() => all.value ? [] : work.mubuPath(current.value?.id).filter(n => !n.deletedAt))
function enter(id) { work.setMubuSet(work.mubuRootOf(id)?.id); ui.focusLoreNode(id, work.mubuPath(id)) }
function syncTitle(force = false) { if (titleEl.value && (force || document.activeElement !== titleEl.value)) { if (ui.loreView === 'write' && current.value?.html && !all.value) titleEl.value.innerHTML = cleanLoreHtml(current.value.html); else titleEl.value.textContent = title.value } }
watch([title, titleEl], () => syncTitle(), { immediate: true, flush: 'post' })
watch(() => [current.value?.html, ui.loreRestoreTick], () => syncTitle(), { flush: 'post' })
watch(() => [current.value?.id, all.value, ui.loreView], () => syncTitle(true), { flush: 'post' })
function rename() { if (!current.value || all.value || ui.loreView !== 'write') return; const value = loreText(titleEl.value), html = cleanLoreHtml(titleEl.value?.innerHTML || ''); if (value !== current.value.text || html !== (current.value.html || '')) { work.mubuCheckpoint(value !== current.value.text ? 'title:' + current.value.id : null); work.mubuSetText(current.value.id, value, html) } }
async function titleKey(e) { if (e.isComposing || e.keyCode === 229) return; if ((e.ctrlKey || e.metaKey) && ['z', 'y'].includes(e.key.toLowerCase())) { e.preventDefault(); titleEl.value.blur(); await work.mubuUndo(e.key.toLowerCase() === 'y' || e.shiftKey ? 'redo' : 'undo'); syncTitle(true); return } if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); rename(); emit('new') } }
</script>
<template>
  <header class="lore-head lore-free-head" :class="{ 'lore-head--compact': compact }">
    <div class="lore-head-main">
      <div class="lore-crumbs lore-free-crumbs"><div class="lore-history"><button :disabled="!ui.loreReturn.length" aria-label="后退" title="后退 Alt+←" @click="ui.loreBack()"><OIcon name="arrow-left" :size="13" /></button><button :disabled="!ui.loreForward.length" aria-label="前进" title="前进 Alt+→" @click="ui.loreNext()"><OIcon name="arrow-right" :size="13" /></button></div><button class="lore-crumb-nav" :aria-expanded="narrow ? navOpen : !ui.loreNavClosed" @click="emit('nav')">世界设定</button><template v-for="n in path" :key="n.id"><i>›</i><button :title="n.text" :aria-current="n.id === current?.id ? 'page' : undefined" @click="enter(n.id)">{{ (n.text || '空节点').slice(0, 14) }}</button></template></div>
      <h1 ref="titleEl" class="lore-h1" :data-lore-id="current?.id" :contenteditable="ui.loreView === 'write' && !!current && !all" :role="ui.loreView === 'write' && current && !all ? 'textbox' : undefined" aria-label="当前节点名称" spellcheck="false" @input="rename" @blur="syncTitle" @keydown="titleKey" @keyup="emit('position')" @mouseup="emit('position')" />
      <div class="lore-meta"><template v-if="all">{{ work.liveMubu().length }} 个节点</template><template v-else-if="current">{{ work.mubuChildren(current.id).length }} 个子节点 <i>·</i> {{ work.mubuDescendants(current.id).length }} 个后代节点 <span v-if="current.tags?.length"><i>·</i> {{ current.tags.join(' / ') }}</span></template><template v-else>自由记录与整理你的世界</template><span v-if="ui.mubuQuery">筛选「{{ ui.mubuQuery }}」 <button @click="emit('clear-filter')">清除</button></span></div>
    </div>
    <div class="lore-head-actions"><nav class="lore-switch" role="tablist" aria-label="设定视图"><button v-for="v in [{ id: 'write', label: '节点大纲' }, { id: 'detail', label: '阅读视图' }, { id: 'map', label: '视觉导图' }]" :key="v.id" role="tab" :aria-selected="ui.loreView === v.id" :class="{ on: ui.loreView === v.id }" :data-lore-view="v.id" @click="emit('view', v.id)">{{ v.label }}</button></nav><button class="lore-icon lore-links-toggle" :class="{ active: ui.loreLinksOpen }" :aria-pressed="ui.loreLinksOpen" aria-label="链接与引用" title="链接与引用" @click="ui.loreLinksOpen = !ui.loreLinksOpen"><OIcon name="link" :size="15" /></button><button v-if="ui.loreView === 'write'" class="lore-btn primary" aria-label="新建节点" @click="emit('new')"><OIcon name="plus" :size="12" /><span class="lore-new-long">新建节点</span><span class="lore-new-short" aria-hidden="true">新建</span></button></div>
  </header>
</template>
