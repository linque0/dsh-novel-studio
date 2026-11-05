<script setup>
import {computed,ref,watch,onMounted,onBeforeUnmount,nextTick} from 'vue'
import {NConfigProvider,NModal} from 'naive-ui'
import OIcon from '../OIcon.vue'
import CandidateEditor from './CandidateEditor.vue'
import ReviewPanel from './ReviewPanel.vue'
import StageSettings from '../ai/StageSettings.vue'
import AiSettings from '../ai/AiSettings.vue'
import {useWorkStore} from '../../stores/work.js'
import {useUiStore} from '../../stores/ui.js'
import {useAiStore} from '../../stores/ai.js'
import {useCreativeWorkflowStore} from '../../stores/creative-workflow.js'
import {AGENT_PAGES,chapterWorkbenchState} from '../../services/ai/workbench-view.js'
import {orderedChapters} from '../../services/project/normalize.js'
import {autosave,registerFlushHook} from '../../services/autosave.js'
import {db} from '../../db/database.js'
import {isPopped,popOut} from '../../services/panelwindows.js'
import {loadCreativeWorkflows} from '../../db/workflow-repo.js'
import {listMemoryJobs,retryMemoryJob} from '../../services/ai/memory-queue.js'
import './agent-workbench.css'

const work=useWorkStore(),ui=useUiStore(),ai=useAiStore(),flow=useCreativeWorkflowStore()
const page=computed({get:()=>ui.agentPage,set:v=>ui.agentPage=v})
const view=ref('candidate'),selected=ref(''),reviewOpen=ref(true),settings=ref(false),modelSettings=ref(false),pending=ref(false)
const error=ref(''),notice=ref(''),instruction=ref(''),budget=ref(120000),batchIds=ref([]),autoRevision=ref(false),outlineText=ref(''),outlineBase=ref(''),memory=ref([]),history=ref([]),materialQuery=ref('')
const outlineDirty=ref(false)
const outlineDrafts=new Map()
let draftTimer,draftWrite=Promise.resolve(),draftGeneration=0
const draftKey=()=>work.work?.id&&work.selChapterId?'ai.outlineDraft:'+work.work.id+':'+work.selChapterId:null
function rememberOutline(){
  outlineDirty.value=true;draftGeneration++
  const key=draftKey();if(!key)return
  outlineDrafts.set(key,{text:outlineText.value,base:outlineBase.value})
  clearTimeout(draftTimer);draftTimer=setTimeout(()=>flushOutlineDrafts().catch(e=>error.value='章纲草稿保存失败：'+e.message),350)
}
async function flushOutlineDrafts(){
  clearTimeout(draftTimer)
  draftWrite=draftWrite.catch(()=>{}).then(async()=>{
    for(const [key,value]of outlineDrafts){await db.appconfig.put({key,value});if(outlineDrafts.get(key)===value)outlineDrafts.delete(key)}
  })
  await draftWrite
}
const unregisterDraftFlush=registerFlushHook(flushOutlineDrafts)
async function restoreOutline(){
  const generation=++draftGeneration,key=draftKey();resetOutline()
  if(!key)return
  const value=outlineDrafts.get(key)||(await db.appconfig.get(key))?.value
  if(generation!==draftGeneration||key!==draftKey()||!value)return
  outlineText.value=value.text;outlineBase.value=value.base;outlineDirty.value=true
}
const chapters=computed(()=>orderedChapters(work)),run=computed(()=>flow.active)
const state=computed(()=>chapterWorkbenchState(run.value,work.selChapterId))
const current=computed(()=>work.activeChapter),ch=computed(()=>state.value.chapter)
const candidate=computed(()=>ch.value?.artifacts.find(c=>c.id===selected.value)||state.value.candidate)
const outline=computed(()=>work.olnodes.find(n=>!n.deletedAt&&n.refId===work.selChapterId&&n.outlineNature!=='written'))
const disabled=computed(()=>pending.value||ai.busy||flow.running)
const candidateList=computed(()=>ch.value?.artifacts||[])
const currentMaterials=computed(()=>[...ai.chat].reverse().find(m=>m.workId===work.work?.id&&m.meta?.materials)?.meta?.materials || [...ai.chat].reverse().find(m=>m.workId===work.work?.id&&m.materials)?.materials)
const sourceMessage=computed(()=>[...ai.chat].reverse().find(m=>m.workId===work.work?.id&&(m.context?.materials||m.debug?.materials)))
const materials=computed(()=>currentMaterials.value||sourceMessage.value?.context?.materials||sourceMessage.value?.debug?.materials)
const library=computed(()=>[
  ...work.liveCharacters.map(c=>({id:c.id,kind:'人物',title:c.name||'未命名人物',text:c.content||Object.values(c.fields||{}).filter(v=>typeof v==='string').join(' · ')})),
  ...work.mubu.filter(n=>!n.deletedAt).map(n=>({id:n.id,kind:'设定',title:n.title||n.text?.split('\n')[0]||'设定条目',text:n.text||''})),
].filter(r=>!materialQuery.value||[r.title,r.text].some(t=>t.includes(materialQuery.value))).slice(0,100))
const theme={common:{primaryColor:'#275f66',primaryColorHover:'#34717a',primaryColorPressed:'#204f55',bodyColor:'#f4f6f3',cardColor:'#fffefa',modalColor:'#fffefa',textColorBase:'#263c3c',textColor1:'#263c3c',textColor2:'#415453',textColor3:'#657470',borderColor:'#d6dfd9',borderRadius:'6px'}}
const panel=new URLSearchParams(location.search).get('panel')?.split(':')[0]
const closeWindow=()=>window.native?.panelCloseSelf()

async function call(fn){if(pending.value)return;error.value='';notice.value='';pending.value=true;try{await fn();await refresh()}catch(e){error.value=e.message}finally{pending.value=false}}
async function refresh(){const id=work.work?.id;if(!id)return;const [jobs,runs]=await Promise.all([listMemoryJobs(id),loadCreativeWorkflows(id)]);if(work.work?.id===id){memory.value=jobs;history.value=runs}}
async function chooseChapter(id){await autosave.flushAll();if(work.work?.id){work.selChapterId=id;work.selVolumeId=work.activeChapter?.volumeId||null;ui.agentCandidateId=null;selected.value='';view.value='candidate'}}
function resetOutline(){outlineText.value=outline.value?.text||'';outlineBase.value=JSON.stringify([outline.value?.id,outline.value?.text,outline.value?.html]);outlineDirty.value=false}
async function saveOutline(){
  if(!current.value)throw new Error('请先选择章节')
  if(isPopped(work,'outline',''))throw new Error('章纲正在其他窗口编辑')
  if(outlineBase.value!==JSON.stringify([outline.value?.id,outline.value?.text,outline.value?.html]))throw new Error('章纲已在别处变化，请重新选择本章后编辑')
  let node=outline.value
  if(!node)node=work.olnodeAdd(null,{kind:'anchor',refId:current.value.id,title:current.value.title,outlineNature:'future',text:outlineText.value})
  else {work.olnodePushUndo(true);work.olnodeSetRich(node.id,outlineText.value,null)}
  await autosave.flushAll();if(autosave.hasPending('olnodes',node.id)){outlineBase.value=JSON.stringify([node.id,node.text,node.html]);rememberOutline();throw new Error('章纲保存失败，输入仍保留，请重试')}
  const key=draftKey();if(key){outlineDrafts.delete(key);await db.appconfig.delete(key)}resetOutline();notice.value='本章章纲已保存；旧运行继续遵守来源版本检查'
}
async function makeRun(ids=[work.selChapterId]){if(outlineDirty.value)await saveOutline();await flow.create({chapterIds:ids,requirement:instruction.value,maxTokens:Number(budget.value),autoRevise:autoRevision.value});selected.value='';notice.value='创作任务已登记'}
async function stage(action){if(state.value.index<0)await makeRun();const index=chapterWorkbenchState(flow.active,work.selChapterId).index;await flow.dispatch(action,index);selected.value='';if(action==='plan')view.value='plan';else view.value='candidate';if(action==='review')reviewOpen.value=true}
async function primary(){if(state.value.action==='adopted'){view.value='formal';return}if(state.value.action==='adopt'){view.value='candidate';notice.value='请在候选末尾审读并确认采纳';return}await stage(state.value.action)}
async function switchWriting(){await autosave.flushAll();if(run.value&&!flow.running)await flow.persist();ui.agentCandidateId=null;work.tab='chapters';ui.workbenchMode='writing'}
async function openWindow(){await autosave.flushAll();if(run.value&&!flow.running)await flow.persist();if(!window.native?.panelOpen)throw new Error('独立窗口需要桌面版；当前工作台可继续使用');if(!await popOut(work,'agent','',work.work.title+' · 恍然梦创作台'))throw new Error('正文已被其他窗口占用，请先关闭其正文窗口')}
async function addChapter(){if(isPopped(work,'chapter',''))throw new Error('正文编辑权在另一窗口');const row=await work.addChapter(null,'第'+(chapters.value.length+1)+'章');await autosave.flushAll();await chooseChapter(row.id)}
function locate(item){view.value='candidate';if(ch.value?.review)selected.value=ch.value.review.sourceDraft.id;nextTick(()=>{const el=document.querySelector('.hm-workbench .candidate-prose');if(el&&item.start!=null){el.focus();el.setSelectionRange(item.start,item.end);const line=el.value.slice(0,item.start).split('\n').length;el.scrollTop=Math.max(0,(line-3)*35)}})}
function openLibrary(kind){work.tab=kind==='人物'?'characters':'lore';ui.workbenchMode='writing'}
watch(()=>[work.work?.id,work.selChapterId],()=>{selected.value='';restoreOutline().catch(e=>error.value=e.message);if(!batchIds.value.length&&work.selChapterId)batchIds.value=[work.selChapterId]},{immediate:true})
watch(()=>[outline.value?.id,outline.value?.text,outline.value?.html],()=>{if(!outlineDirty.value)resetOutline()})
watch(()=>work.work?.id,async id=>{batchIds.value=[];history.value=[];memory.value=[];if(id){await flow.load(id);await refresh()}},{immediate:true})
let timer
const changed=()=>refresh().catch(e=>error.value=e.message)
const closeFailed=e=>{error.value=e.detail||'保存未完成，窗口已保留，请稍后重试关闭';window.$msg?.error(error.value)}
onMounted(()=>{window.addEventListener('agent-window-close-failed',closeFailed);window.addEventListener('memory-queue-changed',changed);timer=setInterval(()=>{if(ui.workbenchMode==='agent'){flow.load(work.work?.id,flow.active?.id).then(refresh).catch(e=>error.value=e.message)}},15000)})
onBeforeUnmount(()=>{clearInterval(timer);clearTimeout(draftTimer);unregisterDraftFlush();flushOutlineDrafts().catch(e=>console.error('[outline-draft]',e));window.removeEventListener('memory-queue-changed',changed);window.removeEventListener('agent-window-close-failed',closeFailed)})
</script>

<template>
  <NConfigProvider :theme="null" :theme-overrides="theme" class="hm-provider">
  <main class="hm-workbench" aria-label="恍然梦 AI 创作台">
    <nav class="hm-navigation" aria-label="恍然梦导航">
      <button class="hm-brand" type="button" @click="page='create'"><OIcon name="sparkle" :size="24" /><span>恍然梦<small>AI 创作工作台</small></span></button>
      <div class="hm-book"><span>正在创作</span><strong :title="work.work?.title">{{work.work?.title}}</strong></div>
      <button v-for="item in AGENT_PAGES" :key="item.id" :class="{'is-active':page===item.id}" :aria-current="page===item.id?'page':undefined" @click="page=item.id"><OIcon :name="item.icon" :size="17" />{{item.label}}</button>
      <div class="hm-nav-bottom"><button @click="settings=true"><OIcon name="gear" :size="17" />创作配置</button><button @click="call(switchWriting)"><OIcon name="manuscript" :size="17" />手写工作台</button><button v-if="panel!=='agent'" @click="call(()=>work.closeWork())"><OIcon name="back" :size="17" />返回书架</button><button v-else @click="closeWindow"><OIcon name="close" :size="17" />关闭独立窗口</button></div>
    </nav>
    <section class="hm-stage">
      <header class="hm-topbar"><div><span>{{AGENT_PAGES.find(p=>p.id===page)?.label}}</span><strong>{{current?.title||'选择一章开始创作'}}</strong></div><span class="hm-save-state" role="status">{{ui.autosave.saving?'正在保存':ui.autosave.pending?'编辑待保存':'本地稿件已同步'}}</span><button v-if="panel!=='agent'" @click="call(openWindow)"><OIcon name="split" :size="16" />独立窗口</button><button @click="call(switchWriting)">转入手写</button></header>
      <div v-if="error||flow.error" class="hm-alert" role="alert">{{error||flow.error}}<button @click="error='';flow.error=''" aria-label="收起错误">×</button></div>
      <div v-if="notice" class="hm-feedback" role="status">{{notice}}</div>
      <div class="hm-body" :class="{'has-review':reviewOpen&&['create','review'].includes(page)}">
        <aside class="hm-chapters" aria-label="章节目录"><div class="hm-chapters-head"><span>{{chapters.length}} 章</span><button :disabled="disabled" @click="call(addChapter)" aria-label="新建章节"><OIcon name="plus" :size="16" /></button></div><template v-for="(chapter,n) in chapters" :key="chapter.id"><div v-if="n===0||chapter.volumeId!==chapters[n-1].volumeId" class="hm-volume">{{work.volumes.find(v=>v.id===chapter.volumeId)?.title||'未分卷'}}</div><button class="hm-chapter-row" :disabled="pending" :class="{'is-selected':chapter.id===work.selChapterId}" :aria-current="chapter.id===work.selChapterId?'true':undefined" @click="call(()=>chooseChapter(chapter.id))"><span class="hm-chapter-number">{{String(n+1).padStart(2,'0')}}</span><span><strong>{{chapter.title||'未命名章节'}}</strong><small>{{chapterWorkbenchState(run,chapter.id).label}}<template v-if="chapter.wordCount"> · {{chapter.wordCount}} 字</template></small></span></button></template><p v-if="!chapters.length">先新建一章，再填写本章目标。</p></aside>
        <div class="hm-main">
          <section v-show="['create','review','planning'].includes(page)" class="hm-chapter-work">
            <div class="hm-chapter-heading"><span class="hm-chapter-kicker">{{work.work?.title}} / {{String(work.chapterOrdinal(work.selChapterId)||1).padStart(2,'0')}}</span><div><h1>{{current?.title||'从一章开始'}}</h1><span class="hm-status" :class="{'is-warning':state.stale}">{{state.label}}</span></div><p v-if="page==='planning'">把这一章要发生的变化写清楚。</p></div>
            <div class="hm-view-tabs" role="tablist" aria-label="章节视图"><button v-for="tab in [{id:'plan',label:'章纲与场景'},{id:'candidate',label:'候选正文'},{id:'formal',label:'正式正文'}]" :key="tab.id" role="tab" :aria-selected="view===tab.id" :class="{'is-active':view===tab.id}" @click="view=tab.id">{{tab.label}}</button><button class="hm-review-toggle" :aria-expanded="reviewOpen" @click="reviewOpen=!reviewOpen">{{reviewOpen?'收起审稿':'展开审稿'}}</button></div>
            <div v-show="view==='formal'&&page!=='planning'" id="agent-editor-host" class="hm-formal-editor shared-editor-host"></div>
            <div v-if="view==='plan'||page==='planning'" class="hm-plan">
              <label>本章章纲<textarea v-model="outlineText" @input="rememberOutline" :disabled="disabled||isPopped(work,'outline','')" rows="7" placeholder="人物想达成什么？阻力是什么？这一章结束时发生什么变化？"></textarea></label><button :disabled="disabled||!current" @click="call(saveOutline)">保存关联章纲</button>
              <div v-if="ch?.plan" class="hm-scenes"><h2>场景计划 <small>{{ch.plan.scenes.length}} 场</small></h2><section v-for="(scene,n) in ch.plan.scenes" :key="scene.id"><span class="hm-scene-number">{{n+1}}</span><div><label v-for="field in [{id:'goal',label:'目标'},{id:'pov',label:'视角'},{id:'conflict',label:'冲突'},{id:'turn',label:'转折'},{id:'ending',label:'结束状态'}]" :key="field.id">{{field.label}}<input v-model="scene[field.id]" :disabled="disabled||!!ch.artifacts.length" @input="flow.changed()" @blur="call(()=>flow.persist())" /></label><label>目标字数<input v-model.number="scene.targetWords" type="number" min="1" max="100000" :disabled="disabled||!!ch.artifacts.length" @input="flow.changed()" /></label></div></section></div>
              <div v-else class="hm-plan-next"><h2>从章纲到可写的场景</h2><p>规划视角、参与人物、冲突与结束状态。你可以调整计划后再起草。</p></div>
            </div>
            <div v-if="view==='candidate'&&page!=='planning'" class="hm-candidate-area"><CandidateEditor v-if="candidate" :candidate-id="candidate.id" @formal="view='formal'"><template #version><label class="hm-version-select">稿件<select v-model="selected" aria-label="稿件版本"><option value="">当前候选</option><option v-for="card in candidateList" :key="card.id" :value="card.id">{{card.parentDraftId?'修稿':'初稿'}} · v{{(card.revision||0)+1}} · {{card.status==='applied'?'已采纳':card.status==='rejected'?'已放弃':'候选'}}</option></select></label></template></CandidateEditor><div v-else class="hm-first-draft"><span class="hm-empty-rule"></span><h2>让这一章，成为可审读的初稿。</h2><p>先确认章纲与本次指导，再让恍然梦起草。<br>生成结果保留为候选，由你逐章采纳。</p><button :disabled="disabled||!current" @click="view='plan'">查看本章章纲 <OIcon name="caret-right" :size="14" /></button></div></div>
            <div class="hm-direction" :class="{'is-compact':!!candidate}"><details :open="!candidate"><summary v-if="candidate">创作指导与新任务</summary><label>本次创作指导<textarea v-model="instruction" :disabled="disabled" rows="2" placeholder="例如：用对话推进试探，保留人物尚未知晓的秘密。"></textarea></label><div class="hm-direction-actions"><button :disabled="disabled||!current" @click="call(()=>makeRun())">新建本章任务</button><button v-if="!['adopt','adopted'].includes(state.action)&&!(reviewOpen&&ch?.review&&['revise','recheck'].includes(state.action))" class="agent-primary" :disabled="disabled||!current||!ai.ready" @click="call(primary)">{{state.actionLabel}} <OIcon name="caret-right" :size="14" /></button></div></details><button v-if="!ai.ready" class="hm-model-missing" @click="modelSettings=true">先配置可用模型</button></div>
          </section>
          <section v-if="page==='production'" class="hm-page hm-production"><h1>章节生产</h1><p>按作品顺序生成连续候选，最多 10 章。作者逐章审读和采纳。</p><div class="hm-batch-controls"><label>本批指导<textarea v-model="instruction" rows="2" :disabled="disabled"></textarea></label><label>Token 预算<input v-model.number="budget" type="number" min="1024" max="10000000" :disabled="disabled" /></label><label class="hm-check"><input v-model="autoRevision" type="checkbox" :disabled="disabled" />生成一轮修稿与复核候选</label></div><div class="hm-table-wrap"><table><thead><tr><th>选择</th><th>章节</th><th>章纲</th><th>稿件状态</th></tr></thead><tbody><tr v-for="chapter in chapters" :key="chapter.id"><td><input v-model="batchIds" :value="chapter.id" type="checkbox" :disabled="disabled" :aria-label="'选择'+chapter.title" /></td><td><button @click="call(()=>chooseChapter(chapter.id));page='create'">{{chapter.title}}</button></td><td>{{work.olnodes.some(n=>!n.deletedAt&&n.refId===chapter.id&&n.outlineNature!=='written'&&(n.text||n.title))?'已关联':'待补章纲'}}</td><td>{{chapterWorkbenchState(run,chapter.id).label}}</td></tr></tbody></table></div><button class="agent-primary" :disabled="disabled||!batchIds.length||batchIds.length>10||!ai.ready" @click="call(async()=>{await makeRun(batchIds);await flow.dispatch('run')})">生成 {{batchIds.length}} 章连续候选</button><button v-if="run" :disabled="disabled||!ai.ready" @click="call(()=>flow.dispatch('run'))">继续当前批次</button></section>
          <section v-if="page==='materials'" class="hm-page"><h1>作品资料</h1><p>作者资料与本次召回分开查看，未采纳候选不会成为正式记忆。</p><input v-model="materialQuery" class="hm-search" aria-label="搜索人物与设定" placeholder="查找人物、设定与关键词" /><div class="hm-library"><article v-for="row in library" :key="row.kind+row.id"><span>{{row.kind}}</span><h2>{{row.title}}</h2><p>{{row.text||'尚未填写内容'}}</p><button @click="openLibrary(row.kind)">在写作工作台编辑</button></article></div><details class="hm-material-report"><summary>本次使用与省略的材料</summary><template v-if="materials"><h3>已纳入</h3><p v-for="(row,n) in materials.included" :key="n">{{row.id||row.sourceId}} · {{row.required?'必要':'可选'}}</p><h3>省略原因</h3><p v-for="(row,n) in materials.omitted" :key="n">{{row.id||row.sourceId}} · {{row.reason}}</p></template><p v-else>当前会话尚无材料报告。生成任务后，可在运行请求中查看冻结的材料清单。</p></details></section>
          <section v-if="page==='runs'" class="hm-page"><div class="hm-page-heading"><h1>运行与历史</h1><button @click="call(refresh)">刷新</button></div><article v-if="run" class="hm-run-detail"><h2>当前任务 · {{run.chapters.length}} 章</h2><p>{{run.status==='running'?'正在执行':run.status==='completed'?'候选已生成':run.status==='interrupted'?'已中断，可从检查点恢复':'已保存'}} · {{run.usedTokens}} / {{run.maxTokens}} tokens</p><p>供应商实际 {{run.usage.actual}} · 估算 {{run.usage.estimated}}</p><button :disabled="disabled||!ai.ready" @click="call(()=>flow.dispatch('run'))">从检查点继续</button><button :disabled="!flow.running" @click="flow.pause()">暂停</button><ol class="hm-stage-list"><li v-for="entry in run.stages" :key="entry.id"><strong>第 {{entry.chapterIndex+1}} 章 · {{({planning:'规划',drafting:'起草',review:'审稿',revision:'修稿',recheck:'复核'})[entry.stage]}}</strong><span>{{entry.status==='completed'?'产物已保存':entry.status==='running'?'执行中':'已中断'}}</span><details v-if="entry.recovery"><summary>中断恢复材料</summary><pre>{{entry.recovery}}</pre></details></li></ol><details><summary>本次冻结的模型、预设和 Skill</summary><pre>{{run.stageSnapshots}}</pre></details></article><h2>记忆更新</h2><p v-if="!memory.length">采纳后在同一保存事务中登记记忆任务。</p><article v-for="job in memory" :key="job.id" class="hm-memory-job"><div><strong>{{work.chapters.find(c=>c.id===job.chapterId)?.title}}</strong><p>正文已保存 · {{({completed:'记忆已更新',running:'记忆更新中',failed:'记忆部分失败',pending:'等待更新',interrupted:'记忆已中断',cancelled:'旧来源已失效'})[job.status]||job.status}}</p><p v-if="job.error">{{job.error}}</p></div><button :disabled="disabled||job.status==='completed'||job.status==='running'&&job.leaseUntil>Date.now()" @click="call(()=>retryMemoryJob(job.id))">重试失败步骤</button></article><h2>已保存的创作任务</h2><button v-for="savedRun in history" :key="savedRun.id" class="hm-history-row" :disabled="disabled" @click="call(()=>flow.load(work.work.id,savedRun.id))"><span>{{new Date(savedRun.createdAt).toLocaleString('zh-CN')}} · {{savedRun.chapters.length}} 章</span><span>{{savedRun.id===run?.id?'当前任务':'打开记录'}} →</span></button></section>
        </div>
        <ReviewPanel v-if="reviewOpen&&['create','review'].includes(page)" :chapter-id="work.selChapterId" @locate="locate" @changed="selected=''" />
      </div>
      <footer class="hm-run-strip"><span class="hm-run-dot" :class="{'is-running':flow.running}"></span><span>{{flow.running?'恍然梦正在执行本书任务':run?'当前任务已保存，可继续创作':'等待你的创作安排'}}</span><span v-if="run">{{run.usedTokens.toLocaleString()}} / {{run.maxTokens.toLocaleString()}} tokens</span><button v-if="flow.running" @click="flow.pause()">暂停</button><button @click="page='runs'">运行详情 <OIcon name="caret-right" :size="13" /></button></footer>
    </section>
    <NModal v-model:show="settings" preset="card" title="阶段模型与写作 Skill" style="width:min(860px,94vw);max-height:85vh;overflow:auto"><StageSettings /></NModal>
    <NModal v-model:show="modelSettings" preset="card" title="模型设置" style="width:min(960px,94vw);max-height:85vh;overflow:auto"><AiSettings /></NModal>
  </main>
  </NConfigProvider>
</template>
