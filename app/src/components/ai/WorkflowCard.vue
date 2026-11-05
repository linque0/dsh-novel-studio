<script setup>
import { computed, ref } from 'vue'
import { NButton, NCheckbox } from 'naive-ui'
import { useWorkStore } from '../../stores/work'
import { useAiStore } from '../../stores/ai'
import EvidenceList from './EvidenceList.vue'
const props=defineProps({card:{type:Object,required:true}}),work=useWorkStore(),ai=useAiStore(),error=ref(''),confirm=ref(false),busy=ref(false),includeLinks=ref(false)
const outline = computed(() => {
  const rows = []
  const walk = (nodes, depth = 0) => nodes.forEach(n => { rows.push({...n, depth}); walk(n.children || [], depth + 1) })
  walk(props.card.payload.nodes || [])
  return rows
})
const chapterName = id => work.chapters.find(c => c.id === id)?.title || ''
const characterName = id => props.card.payload.characters?.find(c => c.key === id || c.id === id)?.name || work.characters.find(c => c.id === id)?.name || '待确认人物'
const priorLore = id => work.mubu.find(r => r.id === id)?.text || ''
const priorCharacter = id => work.characters.find(r => r.id === id)
const factText = body => body.content || body.change || body.description || body.summary || Object.values(body).filter(v => typeof v === 'string').join(' · ')
async function apply(){error.value='';busy.value=true;try{await work.applyAiProposal(props.card,{action:'apply',includeLinks:includeLinks.value});confirm.value=false;await ai.refreshKnowledge()}catch(e){error.value=e.message}finally{busy.value=false}}
async function undo(){error.value='';busy.value=true;try{await work.undoAiApplication(props.card.auditId);props.card.status='undone';props.card.appliedActions=[];props.card.auditId=null;await ai.refreshKnowledge()}catch(e){error.value=e.message}finally{busy.value=false}}
</script>
<template>
  <div class="workflow-card">
    <p>目标：{{ card.anchorLabel }} · {{ card.taskType==='outline.summarize'?'已写内容纲（有来源摘要）':card.taskType==='outline.plan'?'未来计划':card.title }}</p>
    <details open><summary>结果预览</summary>
      <article v-for="(node,i) in outline" :key="i" :style="{marginLeft:node.depth*14+'px'}">
        <strong>{{ node.title }}</strong><span v-if="node.chapterId" class="muted"> · {{ chapterName(node.chapterId) }}</span><pre>{{ node.points }}</pre>
        <EvidenceList :evidence="node.evidence" />
      </article>
      <article v-for="(entry,i) in card.payload.entries || []" :key="i">
        <details v-if="entry.id"><summary>现有设定</summary><pre>{{ priorLore(entry.id) }}</pre></details>
        <strong>{{ entry.id?'修订稿':'新设定' }}</strong><pre>{{ entry.text }}</pre>
        <EvidenceList :evidence="entry.evidence" />
      </article>
      <article v-for="character in card.payload.characters || []" :key="character.key">
        <strong>{{ character.name }}</strong><span class="muted"> · {{ character.id?'更新人物':'新人物' }}</span>
        <details v-if="character.id"><summary>现有人物资料</summary><p v-for="(value,key) in priorCharacter(character.id)?.fields || {}" :key="key">{{ key }}：{{ value }}</p><pre>{{ priorCharacter(character.id)?.content }}</pre></details>
        <p v-if="character.aliases.length">别名：{{ character.aliases.join('、') }}</p><p v-for="(value,key) in character.fields" :key="key">{{ key }}：{{ value }}</p><pre v-if="character.bio">{{ character.bio }}</pre>
        <EvidenceList :evidence="character.evidence" />
      </article>
      <article v-for="(relation,i) in card.payload.relations || []" :key="i">
        <strong>{{ characterName(relation.from) }} → {{ characterName(relation.to) }}</strong><p>{{ relation.label }}<span v-if="relation.chapterId"> · 生效章节：{{ chapterName(relation.chapterId) }}</span></p><p v-if="relation.knownBy">知情范围：{{ relation.knownBy }}</p>
        <EvidenceList :evidence="relation.evidence" />
      </article>
      <article v-for="(state,i) in card.payload.states || []" :key="i"><strong>{{ characterName(state.character) }} · {{ state.dimension }}</strong><p>发生章节：{{ chapterName(state.chapterId) }}</p><pre>{{ state.change }}</pre><EvidenceList :evidence="state.evidence" /></article>
      <article v-for="(item,i) in card.payload.items || []" :key="i">
        <strong>{{ item.title }}</strong><pre>{{ item.content }}</pre><p v-if="item.knownFacts">书内事实：{{ item.knownFacts }}</p><p v-if="item.newIdea">新创意：{{ item.newIdea }}</p><p v-if="item.links.length">建议关联：{{ item.links.length }} 项（勾选后归档）</p>
        <EvidenceList :evidence="item.evidence" />
      </article>
      <article v-if="card.payload.summary"><strong>已发生剧情摘要</strong><pre>{{ card.payload.summary }}</pre></article>
      <article v-for="(fact,i) in card.payload.facts || []" :key="i"><strong>{{ {event:'事件',charstate:'人物状态',foreshadow:'伏笔'}[fact.kind] }}：{{ fact.title }}</strong><p v-if="fact.characterId">人物：{{ characterName(fact.characterId) }}</p><pre>{{ factText(fact.body) }}</pre><EvidenceList :evidence="fact.evidence" /></article>
    </details>
    <EvidenceList :evidence="card.evidence" />
    <p v-for="(w,i) in card.warnings" :key="i" class="warning">{{ w }}</p>
    <details><summary>核查说明</summary><pre>{{ card.review }}</pre></details>
    <NCheckbox v-if="card.task==='snippets'" v-model:checked="includeLinks" :disabled="busy||card.status==='applied'">同时保存建议关联（不修改关联目标）</NCheckbox>
    <div class="actions"><NButton :disabled="busy||card.complete===false||card.status==='applied'||card.status==='rejected'" size="small" @click="confirm=true">应用提案</NButton><NButton v-if="card.auditId&&card.status==='applied'" :disabled="busy" size="small" @click="undo">撤销应用</NButton></div>
    <div v-if="confirm" class="confirmation"><p>将以上内容保存到对应模块。来源已变化时停止应用；人物与关系会整批保存。</p><div class="actions"><NButton type="primary" :loading="busy" @click="apply">确认保存</NButton><NButton :disabled="busy" @click="confirm=false">取消</NButton></div></div>
    <p v-if="error" role="alert" class="error">{{ error }}</p>
  </div>
</template>
<style scoped>
.workflow-card{padding:10px;font-size:12px}.actions{display:flex;gap:8px;margin:10px 0;flex-wrap:wrap}.confirmation{padding:10px;border:1px solid var(--border)}article{padding:10px 0;border-bottom:1px solid var(--border)}pre{white-space:pre-wrap;word-break:break-word;line-height:1.7}.error{color:#d55}.warning,.muted{color:var(--text-dim)}
</style>
