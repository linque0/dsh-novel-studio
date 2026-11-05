<script setup>
import { useWorkStore } from '../../stores/work'
import EvidenceList from './EvidenceList.vue'
const props = defineProps({ card: { type: Object, required: true } })
const work = useWorkStore()
async function original(i) {
  try { await work.applyAiProposal(props.card, { action: 'original:' + i }); window.$msg?.success('原创实体已登记') }
  catch (e) { window.$msg?.warning(e.message) }
}
async function undo() {
  try { await work.undoAiApplication(props.card.auditId); props.card.status = 'undone'; props.card.appliedActions = []; window.$msg?.success('本次应用已撤销') }
  catch (e) { window.$msg?.warning(e.message) }
}
</script>
<template>
  <EvidenceList :evidence="card.evidence || []" />
  <div v-for="(w, i) in card.warnings || []" :key="i" class="warning">{{ w }}</div>
  <details v-if="card.originalProposals?.length"><summary>原创草案（需单独确认）</summary>
    <div v-for="(p, i) in card.originalProposals" :key="i">{{ p.type }} · {{ p.name }}：{{ p.description }} <button :disabled="card.appliedActions?.includes('original:' + i)" @click="original(i)">登记此实体</button></div>
  </details>
  <button v-if="card.auditId && card.status !== 'undone'" type="button" @click="undo">撤销本次应用</button>
</template>
<style scoped>
.warning{padding:4px 7px;background:color-mix(in srgb,#d9a94a 12%,transparent);color:var(--text)}button{font-size:11px;color:var(--accent);cursor:pointer;margin-top:5px}
</style>
