<script setup>
import {computed,ref} from 'vue'
import {useCreativeWorkflowStore} from '../../stores/creative-workflow.js'
import {chapterWorkbenchState} from '../../services/ai/workbench-view.js'
const props=defineProps({chapterId:String})
const emit=defineEmits(['locate','changed'])
const flow=useCreativeWorkflowStore(),error=ref('')
const acting=ref(false)
const state=computed(()=>chapterWorkbenchState(flow.active,props.chapterId)),ch=computed(()=>state.value.chapter)
const disabled=computed(()=>flow.running||acting.value)
const selectedCount=computed(()=>ch.value?.review?.items.filter(i=>ch.value.decisions[i.id]==='apply').length||0)
const canRevise=computed(()=>selectedCount.value>0||!!ch.value?.guidance?.trim())
async function perform(action){
  if(disabled.value)return
  const run=flow.active,index=state.value.index,chapterId=props.chapterId
  error.value='';acting.value=true
  try{await flow.persist(run);if(flow.active!==run||props.chapterId!==chapterId)throw new Error('章节或任务已切换，请重新确认审稿操作');await flow.dispatch(action,index,run);emit('changed')}catch(e){error.value=e.message}finally{acting.value=false}
}
const severity={error:'问题',warning:'提醒',suggestion:'文风建议',pass:'模型未发现问题'}
</script>
<template>
  <section class="hm-review" aria-label="独立审稿意见">
    <header><h2>审稿意见</h2><p>{{ch?.review?'独立审读 · '+ch.review.items.length+' 项意见':'独立审读，不沿用生成时的自评。'}}</p></header>
    <template v-if="ch?.review">
      <p v-if="state.stale" class="agent-notice" role="alert">{{state.reason}}。旧意见保留供对照，请重新审稿。</p>
      <p v-if="ch.autoSelection" class="agent-notice">当前意见由批量策略选择，请逐项审读。</p>
      <article v-for="item in ch.review.items" :key="item.id" class="hm-finding">
        <div class="hm-finding-meta"><span>{{severity[item.severity]}} · {{item.category}}</span><span :class="{'is-unverified':item.evidenceStatus!=='verified'}">{{item.evidenceStatus==='verified'?'引文已定位':'待核实'}}</span></div>
        <label class="hm-check"><input type="checkbox" :checked="ch.decisions[item.id]==='apply'" :disabled="disabled||!!ch.confirmation||state.stale" @change="ch.decisions[item.id]=$event.target.checked?'apply':'ignore';flow.changed()" />纳入本次修稿</label>
        <button v-if="item.quote" class="hm-quote" type="button" @click="emit('locate',item)">{{item.quote}}<small>{{item.start==null?'人工查阅原文':'在稿件中定位 →'}}</small></button>
        <label>问题与作者修改意见<textarea v-model="item.problem" :disabled="disabled||!!ch.confirmation||state.stale" rows="2" @input="flow.changed()"></textarea></label>
        <details><summary>预期改法与来源</summary><textarea v-model="item.expected" :disabled="disabled||!!ch.confirmation||state.stale" rows="2" @input="flow.changed()"></textarea><p v-for="(e,n) in item.evidence" :key="n">{{e.sourceType}} · {{e.sourceId}}：{{e.quote}}（{{e.evidenceStatus==='verified'?'已定位':'待核实'}}）</p></details>
      </article>
      <label class="hm-guidance">作者补充要求<textarea v-model="ch.guidance" :disabled="disabled||!!ch.confirmation||state.stale" rows="3" placeholder="只修改需要处理的部分，保留其余文字。" @input="flow.changed()"></textarea></label>
      <button class="agent-primary" :disabled="disabled||!!ch.revisionId||state.stale||!canRevise" @click="perform('revise')">{{ch.confirmation?'重试已确认修稿':'按所选意见修稿'+(selectedCount?'（'+selectedCount+' 项）':'')}}</button>
      <button :disabled="disabled||!ch.revisionId||!!ch.check||state.stale" @click="perform('recheck')">定向复核原问题</button>
      <section v-if="ch.check" class="hm-recheck"><h3>模型复核结果</h3><p v-for="item in ch.check.items" :key="item.id"><b>{{item.status==='resolved'?'找到解决证据':'仍未解决'}}</b> · {{item.explanation}}<q>{{item.quote}}</q></p><p>复核结果仍需作者判断。</p></section>
    </template>
    <div v-else-if="state.action==='adopted'" class="hm-review-empty"><h3>作者已采纳本章</h3><p>正式正文已保存。记忆更新进度可在运行与历史中查看。</p></div>
    <div v-else class="hm-review-empty"><span class="hm-review-mark">01</span><h3>让初稿接受一次独立审读</h3><p>检查人物知情、时间、能力代价与目标完成。生成时的自评不会作为审稿结论。</p><button :disabled="disabled||!state.candidate" @click="perform('review')">开始独立审稿</button></div>
    <button v-if="ch?.review" class="hm-text-button" :disabled="disabled||state.index<0" @click="perform('review')">全文重新审稿</button>
    <p v-if="error" role="alert" class="agent-error">{{error}}</p>
  </section>
</template>
