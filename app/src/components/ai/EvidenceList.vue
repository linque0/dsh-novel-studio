<script setup>
import { nextTick, computed } from 'vue'
import { locateEditorPatch } from '../../services/ai/application'
import { useWorkStore } from '../../stores/work'
import { resolveEvidence } from '../../services/ai/contracts'
const props = defineProps({ evidence: { type: [Array,Object], default: () => [] } })
const entries=computed(()=>Array.isArray(props.evidence)?props.evidence:props.evidence?[props.evidence]:[])
const work = useWorkStore()
async function jump(ref) {
  const current = resolveEvidence(ref, work)
  if (!current || current.sourceHash !== ref.sourceHash) { window.$msg?.warning('来源已变化，请重新核对证据'); return }
  if(ref.sourceType==='lorelink'||ref.sourceType==='relation') {
    const relation=(ref.sourceType==='lorelink'?work.lorelinks:work.relations).find(r=>r.id===ref.sourceId)
    if(relation)work.navTo(ref.sourceType==='relation'||relation.fromKind==='character'?'characters':'lore',relation.fromId)
    return
  }
  const tabs = { chapter: 'chapters', character: 'characters', lore: 'lore', mubu:'lore', outline: 'outline', olnode:'outline',outlineconnection:'outline',snippet:'snippets',annotation:'chapters' }
  if(!tabs[ref.sourceType]){window.$msg?.info('来源已核对，请在对应资料中查看');return}
  if(ref.sourceType==='annotation'){const a=work.annotations.find((r)=>r.id===ref.sourceId);if(a)work.navTo('chapters',a.chapterId);return}
  work.navTo(tabs[ref.sourceType], ref.sourceId)
  if (ref.sourceType === 'chapter' && ref.quote) {
    await nextTick()
    const ed = window.__ns?.editor
    if (ed && !ed.isDestroyed && work.selChapterId === ref.sourceId) try { const range = locateEditorPatch(ed, ref.quote); ed.commands.setTextSelection({ from: range.from, to: range.to }); ed.commands.focus() } catch { window.$msg?.info('已打开证据章节，请对照摘引核对位置') }
  }
  if (['outline','olnode','outlineconnection'].includes(ref.sourceType)) { work.selOlnodeId = ref.sourceId; work.canvasFocusTick++ }
}
</script>
<template>
  <details v-if="entries.length" class="ai-evidence"><summary>依据（{{ entries.length }}）</summary>
    <div v-for="(ref, i) in entries" :key="i"><button type="button" @click="jump(ref)">{{ ref.label || ref.sourceId }}</button><blockquote v-if="ref.quote">{{ ref.quote }}</blockquote></div>
  </details>
</template>
<style scoped>
.ai-evidence{font-size:11.5px;margin:6px 0;color:var(--text-dim)}button{color:var(--accent);border:0;background:none;cursor:pointer}blockquote{margin:3px 0;padding-left:8px;border-left:2px solid var(--border);white-space:pre-wrap}
</style>
