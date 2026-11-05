<script setup>
import {computed,ref} from 'vue'
import {useCreativeWorkflowStore} from '../../stores/creative-workflow.js'
import {useUiStore} from '../../stores/ui.js'
import {useWorkStore} from '../../stores/work.js'
import {assertCandidateDependencies} from '../../services/ai/workflow-core.js'
const props=defineProps({candidateId:String,handoff:Boolean})
defineEmits(['close','adopted','formal'])
const flow=useCreativeWorkflowStore(),ui=useUiStore(),error=ref(''),saved=ref('')
const work=useWorkStore()
const acting=ref(false)
const chapterIndex=computed(()=>flow.active?.chapters.findIndex(ch=>ch.artifacts.some(c=>c.id===props.candidateId))??-1)
const chapter=computed(()=>flow.active?.chapters[chapterIndex.value])
const card=computed(()=>chapter.value?.artifacts.find(c=>c.id===props.candidateId))
const disabled=computed(()=>acting.value||flow.running||!card.value||['applied','rejected'].includes(card.value.status))
const invalid=computed(()=>{if(!card.value)return '';try{assertCandidateDependencies(flow.active,card.value);return ''}catch(e){return e.message}})
const parent=computed(()=>chapter.value?.artifacts.find(c=>c.id===card.value?.parentDraftId))
async function save(){const run=flow.active;error.value='';try{await flow.persist(run);saved.value='候选已保存'}catch(e){error.value=e.message}}
async function act(fn){
  if(acting.value||!card.value)return
  const target={run:flow.active,index:chapterIndex.value,card:card.value,revision:card.value.revision,text:card.value.editText??card.value.text,chapterId:chapter.value.chapterId}
  acting.value=true;error.value=''
  try{await flow.persist(target.run);if(flow.active!==target.run||target.card.revision!==target.revision||(target.card.editText??target.card.text)!==target.text)throw new Error('候选或运行已变化，请重新确认');await fn(target)}catch(e){error.value=e.message}finally{acting.value=false}
}
async function adopt(){await act(async target=>{await flow.adopt(target.index,target.card.id);saved.value='正文已保存，记忆任务已登记'})}
async function reject(){await act(async target=>{target.card.status='rejected';flow.changed(target.run);await flow.persist(target.run);saved.value='候选已放弃'})}
async function openWriting(){await act(async target=>{work.tab='chapters';work.selChapterId=target.chapterId;ui.agentCandidateId=target.card.id;ui.workbenchMode='writing'})}
</script>
<template>
  <section v-if="card" class="candidate-editor" aria-label="候选稿编辑">
    <div class="candidate-toolbar">
      <span class="candidate-version"><slot name="version">{{handoff?'候选精修':'正文候选'}} · v{{(card.revision||0)+1}}</slot></span>
      <span>{{card.status==='applied'?'作者已采纳':card.status==='rejected'?'已放弃':'尚未写入正式正文'}}</span>
      <button v-if="handoff" type="button" @click="$emit('close')">返回正式正文</button>
      <button v-else-if="!['applied','rejected'].includes(card.status)" type="button" :disabled="disabled" @click="openWriting">到手写工作台精修</button>
    </div>
    <p v-if="invalid||card.staleReason" class="agent-notice" role="alert">{{invalid||card.staleReason}}</p>
    <textarea class="candidate-prose" :value="card.editText??card.text" :readonly="disabled" aria-label="候选正文" spellcheck="false" @input="saved='';flow.editCandidate(card,$event.target.value)" @blur="save"></textarea>
    <details v-if="parent" class="candidate-comparison"><summary>对照修订前的候选</summary><pre>{{parent.editText??parent.text}}</pre></details>
    <footer class="candidate-footer">
      <span role="status">{{card.status==='applied'?'作者已采纳，正文已保存':card.status==='rejected'?'此候选已放弃':saved||'修改只保存在候选中'}}<small v-if="card.original&&!['applied','rejected'].includes(card.status)"> · 采纳将替换原绑定范围</small></span>
      <button v-if="card.status==='applied'" type="button" @click="handoff?$emit('close'):$emit('formal')">查看正式正文</button>
      <template v-else-if="card.status!=='rejected'">
      <button type="button" :disabled="disabled" @click="save">保存候选</button>
      <button type="button" :disabled="disabled" @click="reject">放弃</button>
      <button class="agent-primary" type="button" :disabled="disabled||!!invalid||!!card.staleReason" @click="adopt">采纳为正式正文</button>
      </template>
    </footer>
    <p v-if="error" role="alert" class="agent-error">{{error}}</p>
  </section>
  <p v-else class="agent-notice">当前候选已不在此运行中，请返回 AI 创作台选择稿件。<button type="button" @click="$emit('close')">返回正式正文</button></p>
</template>
<style scoped>
.candidate-editor{display:flex;flex:1;min-height:0;min-width:0;flex-direction:column;background:var(--hm-paper,var(--bg-panel));color:var(--hm-ink,var(--text));height:100%}.candidate-toolbar,.candidate-footer{display:flex;gap:12px;align-items:center;flex-wrap:wrap;padding:14px 24px;border-bottom:1px solid var(--hm-line,var(--border));font-size:13px}.candidate-toolbar>span:nth-child(2){color:var(--hm-muted,var(--text-dim))}.candidate-toolbar>button{margin-left:auto}.candidate-version{font-weight:600}.candidate-prose{border:0;resize:none;flex:1;min-height:200px;box-sizing:border-box;width:100%;padding:24px clamp(24px,7%,80px);background:transparent;color:inherit;font:18px/1.95 var(--editor-font,serif);outline-offset:-3px}.candidate-prose:focus{outline:2px solid var(--hm-accent,#275f66)}.candidate-footer{border-bottom:0;border-top:1px solid var(--hm-line,var(--border));font-size:13px}.candidate-footer>span{flex:1;min-width:120px}.candidate-comparison{max-height:200px;overflow:auto;padding:10px 24px}.candidate-comparison pre{white-space:pre-wrap;font:14px/1.8 var(--editor-font,serif)}button{cursor:pointer;border:1px solid var(--hm-line,var(--border));background:transparent;color:inherit;border-radius:5px;padding:7px 12px;font:inherit}button:disabled{opacity:.5;cursor:default}.agent-primary{background:var(--hm-accent,#275f66);color:white;border-color:transparent}.agent-error{color:#9a382e;padding:0 24px}.agent-notice{padding:10px 24px;line-height:1.7}small{font-size:12px}
</style>
