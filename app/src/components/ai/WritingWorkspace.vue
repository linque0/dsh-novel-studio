<script setup>
import {NButton,NDropdown,NInput} from 'naive-ui'
import {useWritingStore} from '../../stores/writing.js'
import {useAiStore} from '../../stores/ai.js'
import DraftCard from './DraftCard.vue'
const props=defineProps({session:{type:Object,required:true},part:{type:String,default:'directions'},showDirections:{type:Boolean,default:true},visibleCandidates:{type:Array,default:null}})
const writing=useWritingStore(),ai=useAiStore()
function call(fn){Promise.resolve().then(fn).catch(e=>{props.session.error=e.message})}
function edit(id,key,value){try{writing.editDirection(id,{[key]:value})}catch(e){props.session.error=e.message}}
function menu(d){return [{label:'单独换一版',key:'retry',disabled:ai.busy||props.session.running},{label:'复制方向',key:'copy'},{label:'恢复原稿',key:'restore'},{label:'移除方向',key:'remove'}]}
function action(key,d){if(key==='retry')writing.startDirections(d.id);if(key==='copy')writing.addDirection(d);if(key==='restore')writing.restoreDirection(d.id);if(key==='remove')writing.removeDirection(d.id)}
</script>
<template>
  <section class="writing-workspace" :data-writing-session="session.id" aria-label="正文任务结果">
    <template v-if="showDirections&&part!=='candidates'&&session.directions.length">
      <div class="writing-section-head"><strong>剧情方向</strong><span>{{session.directions.length}} 个</span><NDropdown trigger="click" :options="[{label:'保留已改方向，换其余',key:'refresh',disabled:ai.busy||session.running},{label:'手写一个方向',key:'custom'}]" @select="key=>key==='refresh'?writing.startDirections():writing.addDirection()"><NButton size="tiny" quaternary aria-label="剧情方向操作">•••</NButton></NDropdown></div>
      <article v-for="(d,i) in session.directions" :key="d.id" class="direction-card" :class="{selected:session.selectedId===d.id}" :data-direction-id="d.id">
        <div class="direction-head"><label><input type="radio" :name="session.id" :checked="session.selectedId===d.id" @change="writing.selectDirection(d.id)" />方向 {{i+1}}</label><span v-if="d.edited" class="direction-edited">已编辑</span><NButton size="tiny" quaternary :aria-pressed="d.kept" @click="writing.keep(d.id)">{{d.kept?'已保留':'保留'}}</NButton><NDropdown trigger="click" :options="menu(d)" @select="key=>action(key,d)"><NButton size="tiny" quaternary :aria-label="'方向 '+(i+1)+' 更多操作'">•••</NButton></NDropdown></div>
        <NInput class="direction-title" :value="d.draft.title" :maxlength="120" placeholder="方向标题" @update:value="v=>edit(d.id,'title',v)" />
        <NInput class="direction-development" :value="d.draft.development" type="textarea" :maxlength="5000" :autosize="{minRows:2,maxRows:12}" placeholder="直接修改剧情演变…" @update:value="v=>edit(d.id,'development',v)" />
        <details v-if="d.alternatives?.length" class="direction-versions"><summary>其他版本 · {{d.alternatives.length}}</summary><div v-for="(alt,j) in d.alternatives" :key="j"><p>{{alt.title}} · {{alt.development}}</p><NButton size="tiny" @click="writing.editDirection(d.id,{title:alt.title,development:alt.development})">使用这一版</NButton></div></details>
      </article>
      <div class="writing-result-actions"><NButton size="small" quaternary @click="writing.addDirection()">＋ 手写方向</NButton><NButton size="small" type="primary" :disabled="ai.busy||session.running||!session.directions.find(d=>d.id===session.selectedId)?.draft.development.trim()||!session.directions.find(d=>d.id===session.selectedId)?.draft.title.trim()" @click="writing.startDraft()">按所选方向续写</NButton></div>
    </template>
    <div v-if="part==='all'||part==='candidates'" class="writing-candidates"><div v-for="card in visibleCandidates??session.candidates" :key="card.id"><DraftCard :card="card" workflow-controls @change="writing.changed(session)" @continue-draft="c=>writing.startDraft({parent:c})" @continue-saved="call(()=>writing.open({fresh:true,reuseDirections:true,mode:'insert'}))" /></div></div>
  </section>
</template>
<style scoped>
.writing-workspace{min-width:0;color:inherit}.writing-section-head{display:flex;gap:8px;align-items:center;margin:4px 0 10px;font-size:13px}.writing-section-head span{color:var(--agent-muted)}.writing-section-head button{margin-left:auto}.direction-card{min-width:0;margin:10px 0;padding:10px;border:1px solid var(--agent-line,var(--border));border-radius:8px;background:var(--agent-raised,var(--bg-panel));transition:border-color .14s,background .14s}.direction-card.selected{border-color:var(--agent-accent,var(--accent));background:var(--agent-selected);box-shadow:inset 2px 0 var(--agent-accent,var(--accent))}.direction-head{display:flex;align-items:center;gap:4px;margin-bottom:6px;font-size:12px;color:var(--agent-muted)}.direction-head label{display:flex;align-items:center;gap:6px;cursor:pointer;margin-right:auto}.direction-head input{accent-color:var(--agent-accent)}.direction-edited{font-size:11px}.direction-title{font-weight:600}.direction-development{margin-top:3px}.direction-title :deep(.n-input__border),.direction-development :deep(.n-input__border){border-color:transparent!important}.direction-title :deep(.n-input),.direction-development :deep(.n-input){background:transparent}.direction-versions{margin-top:8px;font-size:12px;color:var(--agent-muted)}summary{cursor:pointer}.writing-result-actions{display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;margin:12px 0}.writing-candidates{min-width:0}@media(prefers-reduced-motion:reduce){.direction-card{transition:none}}
.direction-title,.direction-development{background:transparent}.direction-card.selected{box-shadow:none}.direction-edited{font-size:12px}
</style>
