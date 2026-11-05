<script setup>
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { NButton, NInput, NInputNumber, NSelect, NCheckbox } from 'naive-ui'
import { useCreativeWorkflowStore } from '../../stores/creative-workflow.js'
import { useWorkStore } from '../../stores/work'
import { useAiStore } from '../../stores/ai'
import { orderedChapters } from '../../services/project/normalize.js'
import { assertReviewCurrent } from '../../services/ai/review-cycle.js'
import { listMemoryJobs, retryMemoryJob } from '../../services/ai/memory-queue.js'

const flow=useCreativeWorkflowStore(),work=useWorkStore(),ai=useAiStore()
const ids=ref([]),requirement=ref(''),auto=ref(false),budget=ref(120000),error=ref(''),jobs=ref([])
const run=computed(()=>flow.active)
const disabled=computed(()=>ai.busy||flow.running)
const phases={ready:'待确认',planned:'计划已生成',drafted:'候选已生成',reviewed:'已独立审稿',revised:'已生成修稿',planning:'规划中',drafting:'写稿中',review:'审稿中',revision:'修稿中',recheck:'复核中','needs-author':'需作者处理'}
const options=computed(()=>orderedChapters(work).map(c=>({label:c.title||'未命名章节',value:c.id})))
async function call(fn){error.value='';try{await fn();await refreshJobs()}catch(e){error.value=e.message}}
async function refreshJobs(){if(work.work?.id)jobs.value=await listMemoryJobs(work.work.id)}
function stale(ch,index){try{if(ch.review&&!ch.confirmation)assertReviewCurrent(ch.review,flow.latest(index));return ''}catch(e){return e.message}}
async function create(){await flow.create({chapterIds:ids.value,requirement:requirement.value,autoRevise:auto.value,maxTokens:budget.value})}
onMounted(()=>call(async()=>{ids.value=work.selChapterId?[work.selChapterId]:[];await flow.load();await refreshJobs()}))
const memoryChanged=()=>refreshJobs().catch(e=>{error.value=e.message})
let leaseTimer
onMounted(()=>{leaseTimer=setInterval(()=>{if(run.value?.owner)flow.load().catch(e=>{error.value=e.message})},30000)})
onMounted(()=>window.addEventListener('memory-queue-changed',memoryChanged))
onBeforeUnmount(()=>{clearInterval(leaseTimer);window.removeEventListener('memory-queue-changed',memoryChanged)})
watch(()=>work.work?.id,()=>{ids.value=work.selChapterId?[work.selChapterId]:[];call(()=>flow.load())})
</script>
<template>
  <div class="creative-workflow">
    <p>规划、写稿、独立审稿和修稿均生成候选。正式正文由你逐章采纳。</p>
    <div class="create-fields">
      <label>章节（最多 10 章，按作品顺序）<NSelect v-model:value="ids" multiple :options="options" :disabled="disabled" /></label>
      <label>本批创作要求<NInput v-model:value="requirement" type="textarea" :disabled="disabled" :autosize="{minRows:2,maxRows:6}" /></label>
      <label>本批 Token 预算<NInputNumber v-model:value="budget" :min="1024" :max="10000000" :disabled="disabled" /></label>
      <NCheckbox v-model:checked="auto" :disabled="disabled">自动生成一轮修稿候选与一次复核（仅定位证据的问题；仍需作者采纳）</NCheckbox>
      <NButton :disabled="disabled||!ids.length||ids.length>10" @click="call(create)">新建创作任务</NButton>
    </div>
    <template v-if="run">
      <div class="run-head"><strong>创作任务 · {{run.chapters.length}} 章</strong><span>{{run.status==='running'?'运行中':run.status==='completed'?'候选已生成':run.status==='interrupted'?'已中断':'已保存'}}</span></div>
      <p>用量 {{run.usedTokens}} / {{run.maxTokens}} tokens · 实际 {{run.usage.actual}} · 估算 {{run.usage.estimated}}</p>
      <div class="actions"><NButton type="primary" :disabled="disabled" @click="call(()=>flow.dispatch('run'))">{{run.status==='interrupted'?'从检查点继续':'生成连续候选'}}</NButton><NButton :disabled="!disabled" @click="flow.pause()">暂停</NButton><NButton :disabled="disabled" @click="call(()=>flow.persist())">保存编辑</NButton></div>
      <p v-if="run.error" role="alert">{{run.error}}</p>
      <section v-for="(ch,index) in run.chapters" :key="ch.chapterId" class="chapter-stage">
        <div class="run-head"><strong>{{work.chapters.find(c=>c.id===ch.chapterId)?.title||'目标章节'}}</strong><span>{{phases[ch.phase]||ch.phase}}</span></div>
        <div class="actions"><NButton size="small" :disabled="disabled||!!ch.artifacts.length" @click="call(()=>flow.dispatch('plan',index))">生成场景计划</NButton><NButton size="small" :disabled="disabled||!flow.latest(index)" @click="call(()=>flow.dispatch('review',index))">独立审稿 / 重新审稿</NButton></div>
        <details v-if="ch.plan"><summary>编辑场景计划 · {{ch.plan.scenes.length}} 个场景</summary><div v-for="(scene,n) in ch.plan.scenes" :key="scene.id" class="scene">
          <strong>场景 {{n+1}}</strong><label v-for="field in ['goal','pov','conflict','turn','ending']" :key="field">{{({goal:'目标',pov:'视角',conflict:'冲突',turn:'转折',ending:'结束状态'})[field]}}<NInput v-model:value="scene[field]" :disabled="disabled||!!ch.artifacts.length" @update:value="flow.changed()" /></label><label>目标字数<NInputNumber v-model:value="scene.targetWords" :min="1" :max="100000" :disabled="disabled||!!ch.artifacts.length" @update:value="flow.changed()" /></label><p>人物：{{scene.characters.join('、')}}</p>
        </div></details>
        <article v-for="card in ch.artifacts" :key="card.id" class="candidate">
          <strong>{{card.title||'正文候选'}} · v{{(card.revision||0)+1}}</strong><span> · {{card.status==='applied'?'作者已采纳':card.status==='rejected'?'已放弃':'待作者采纳'}}</span>
          <NInput :value="card.editText??card.text" type="textarea" :autosize="{minRows:5,maxRows:16}" :disabled="disabled||card.status==='applied'||card.status==='rejected'" @update:value="v=>flow.editCandidate(card,v)" />
          <p v-if="card.staleReason" role="alert">{{card.staleReason}}</p>
          <details v-if="card.parentDraftId"><summary>修稿对照</summary><label>修订前</label><pre>{{ch.artifacts.find(c=>c.id===card.parentDraftId)?.editText??ch.artifacts.find(c=>c.id===card.parentDraftId)?.text}}</pre><label>修订后</label><pre>{{card.editText??card.text}}</pre></details>
          <div class="actions"><NButton size="small" type="primary" :disabled="disabled||card.status==='applied'||card.status==='rejected'||!!card.staleReason" @click="call(()=>flow.adopt(index,card.id))">{{card.original?'确认替换原范围':'确认采纳到原位置'}}</NButton><NButton size="small" :disabled="disabled||card.status==='applied'" @click="card.status='rejected';flow.changed()">放弃候选</NButton></div>
        </article>
        <div v-if="ch.review" class="review-sheet"><strong>独立审稿清单</strong><p v-if="stale(ch,index)" role="alert">{{stale(ch,index)}}</p><p v-if="ch.autoSelection">本轮修稿意见由批量策略选择，尚未经作者逐项确认。</p>
          <div v-for="finding in ch.review.items" :key="finding.id" class="finding"><NCheckbox :checked="ch.decisions[finding.id]==='apply'" :disabled="disabled||!!ch.confirmation" @update:checked="v=>{ch.decisions[finding.id]=v?'apply':'ignore';flow.changed()}">{{finding.severity==='pass'?'模型未发现问题':finding.severity==='suggestion'?'文风建议':finding.severity==='error'?'问题':'提醒'}} · {{finding.category}} · {{finding.evidenceStatus==='verified'?'证据已定位':'待核实'}}</NCheckbox><blockquote v-if="finding.quote">{{finding.quote}}</blockquote><label>问题 / 作者修改意见<NInput v-model:value="finding.problem" :disabled="disabled||!!ch.confirmation" @update:value="flow.changed()" /></label><label>预期改法<NInput v-model:value="finding.expected" :disabled="disabled||!!ch.confirmation" @update:value="flow.changed()" /></label><details v-if="finding.evidence.length"><summary>来源证据</summary><p v-for="(e,i) in finding.evidence" :key="i">{{e.sourceType}} · {{e.sourceId}} · {{e.evidenceStatus}}：{{e.quote}}</p></details></div>
          <label>作者补充要求<NInput v-model:value="ch.guidance" type="textarea" :disabled="disabled||!!ch.confirmation" @update:value="flow.changed()" /></label><div class="actions"><NButton size="small" :disabled="disabled||!!ch.revisionId||!!stale(ch,index)" @click="call(()=>flow.dispatch('revise',index))">{{ch.confirmation&&!ch.revisionId?'重试已确认修稿':'按勾选意见生成修稿'}}</NButton><NButton size="small" :disabled="disabled||!ch.revisionId||!!ch.check" @click="call(()=>flow.dispatch('recheck',index))">定向复核一次</NButton></div>
        </div>
        <div v-if="ch.check"><strong>模型定向复核（仍需作者判断）</strong><p v-for="item in ch.check.items" :key="item.id">{{item.status==='resolved'?'已有解决证据':'未解决'}} · {{item.explanation}}<blockquote>{{item.quote}}</blockquote></p></div>
      </section>
      <details><summary>运行阶段、冻结配置和恢复材料</summary><div v-for="stage in run.stages" :key="stage.id"><p>{{stage.chapterIndex+1}} · {{stage.stage}} · {{stage.status}} · {{stage.usedTokens||0}} tokens</p><pre v-if="stage.recovery">{{stage.recovery}}</pre></div><pre>{{run.stageSnapshots}}</pre></details>
    </template>
    <section class="memory"><div class="run-head"><strong>章节记忆更新</strong><NButton size="tiny" @click="call(refreshJobs)">刷新状态</NButton></div><p v-if="!jobs.length">采纳正文后自动登记更新任务；正式人物与设定变更仍需另行确认。</p><p v-for="job in jobs" :key="job.id">{{work.chapters.find(c=>c.id===job.chapterId)?.title}} · {{job.status}} <span v-if="job.error">{{job.error}}</span><NButton size="tiny" :disabled="disabled||job.status==='completed'||job.status==='running'&&job.leaseUntil>Date.now()" @click="call(()=>retryMemoryJob(job.id))">重试 / 继续</NButton></p></section>
    <p v-if="error||flow.error" role="alert">{{error||flow.error}}</p>
  </div>
</template>
<style scoped>
.creative-workflow{font-size:13px;line-height:1.7}.create-fields,.scene,.finding{display:grid;gap:9px;margin:12px 0}.create-fields label,.scene label,.finding label{display:grid;gap:5px}.run-head,.actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.run-head{justify-content:space-between;margin-top:18px}.chapter-stage,.candidate,.review-sheet,.memory{border:1px solid var(--agent-line,#8885);border-radius:8px;padding:12px;margin:14px 0}.candidate>.n-input{margin:10px 0}.finding{border-bottom:1px solid var(--agent-line,#8885);padding-bottom:10px}pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:320px;overflow:auto}blockquote{margin:8px 0;padding-left:12px;border-left:2px solid var(--agent-accent,#888)}[role=alert]{color:#c75a45}
</style>
