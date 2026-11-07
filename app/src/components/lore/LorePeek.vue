<script setup>
import { computed } from 'vue'
import { useUiStore } from '../../stores/ui'
import { useWorkStore } from '../../stores/work'
import { targetById, previewFor, jumpTo, findReferences } from '../../services/doublelinks'
import { cleanLoreHtml } from '../../services/lore-editor-dom.js'
import OIcon from '../OIcon.vue'
const emit = defineEmits(['link-click'])
const ui = useUiStore(), work = useWorkStore()
const target = computed(() => ui.lorePeek && targetById(ui.lorePeek.kind, ui.lorePeek.id))
const preview = computed(() => target.value && previewFor(target.value))
const children = computed(() => target.value?.kind === 'mubu' ? work.mubuChildren(target.value.id) : [])
const refs = computed(() => target.value ? findReferences(target.value).length : 0)
function enter() { const t = target.value; ui.lorePeek = null; if (t) jumpTo(t) }
</script>
<template>
  <Teleport to="body"><aside v-if="ui.lorePeek" class="lore-peek-panel" role="dialog" :aria-label="'侧边查看 ' + (target?.title || ui.lorePeek.title || '节点')" @click.capture="emit('link-click', $event)">
    <header><span><OIcon name="expand" :size="13" /> 侧边查看</span><button class="lore-icon" aria-label="关闭侧边查看" @click="ui.lorePeek = null"><OIcon name="close" :size="14" /></button></header>
    <div class="lore-peek-scroll"><small>{{ preview?.meta || '' }}</small><h2>{{ target?.title || ui.lorePeek.title || '目标不存在' }}</h2><template v-if="target"><template v-if="children.length"><div v-for="n in children" :key="n.id" class="lore-peek-child"><button :aria-label="'侧边进入' + n.text" @click="ui.lorePeek = { kind: 'mubu', id: n.id, title: n.text }">•</button><div v-html="cleanLoreHtml(n.html || String(n.text || '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('\n', '<br>'))" /></div></template><p v-else-if="preview?.body && preview.body.trim() !== target.title.trim()">{{ preview.body }}</p><div class="lore-peek-refcount">{{ refs }} 处内容引用<span v-if="target.kind === 'mubu'"> · {{ work.loreLinksOf('mubu', target.id).length }} 条设定关系</span></div></template><p v-else>目标节点已删除。撤销删除或从回收站恢复后，原链接会重新可用。</p></div>
    <footer><button class="lore-btn primary" :disabled="!target" @click="enter"><OIcon name="arrow-right" :size="13" /> 进入此节点</button></footer>
  </aside></Teleport>
</template>
