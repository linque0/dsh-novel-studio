<script setup>
import {ref,computed,watch,onMounted,onBeforeUnmount,nextTick} from 'vue'
import {NConfigProvider,NModal,darkTheme} from 'naive-ui'
import OIcon from '../OIcon.vue'
import StageSettings from '../ai/StageSettings.vue'
import AiSettings from '../ai/AiSettings.vue'
import DreamModeEntries from './DreamModeEntries.vue'
import {enterLightSleepMode} from '../../services/ai/entry-modes.js'
import {useWorkStore} from '../../stores/work.js'
import {useUiStore} from '../../stores/ui.js'
import {useAiStore} from '../../stores/ai.js'
import {useStoryStore} from '../../stores/story.js'
import {orderedChapters} from '../../services/project/normalize.js'
import {autosave} from '../../services/autosave.js'
import {db} from '../../db/database.js'
import {popOut,isPopped,focusPopped} from '../../services/panelwindows.js'
import {listMemoryJobs,retryMemoryJob} from '../../services/ai/memory-queue.js'
import './story-scene.css'
defineEmits(['advanced'])
const work=useWorkStore(),ui=useUiStore(),ai=useAiStore(),story=useStoryStore()
const doc=computed(()=>story.active),chapters=computed(()=>orderedChapters(work)),current=computed(()=>work.activeChapter)
const instruction=ref(''),mode=ref('write'),pane=ref(''),genre=ref('自由构思'),guidance=ref(''),control=ref('narrator'),settings=ref(false),models=ref(false),confirmOpen=ref(false),localBusy=ref(false),localError=ref(''),targetWords=ref(3000),runs=ref([]),memory=ref([]),scroll=ref(null),follow=ref(true)
const busy=computed(()=>story.readOnly||localBusy.value||ai.busy)
const last=computed(()=>doc.value?.turns.at(-1)),variants=computed(()=>last.value?.variants||[])
const hasText=computed(()=>!!doc.value?.text.trim())
const model=computed(()=>ai.model?.split('/').at(-1)||'尚未配置模型')
const selectedCount=computed(()=>doc.value?.review?.items.filter(i=>doc.value.decisions?.[i.id]==='apply').length||0)
const panel=new URLSearchParams(location.search).get('panel')?.split(':')[0]
const theme={common:{primaryColor:'#d3b981',primaryColorHover:'#e2ca99',primaryColorPressed:'#b89b61',bodyColor:'#182125',cardColor:'#202b2f',modalColor:'#202b2f',textColorBase:'#e8e4da',borderColor:'#3b4849',borderRadius:'8px'}}
const starters=[{id:'奇幻冒险',number:'01',title:'走入未知之境',text:'一座只在月蚀时出现的城，今晚向一名送信人开了门。',label:'奇幻 · 探索'}, {id:'悬疑推理',number:'02',title:'解开一封来信',text:'她收到七天后的自己寄来的信，第一句是：不要相信明天的日出。',label:'悬疑 · 秘密'}, {id:'都市日常',number:'03',title:'与命运再相逢',text:'深夜末班车上，两个素未谋面的人，拿着同一把旧屋的钥匙。',label:'都市 · 关系'}]
async function act(fn){if(localBusy.value)return;localBusy.value=true;localError.value='';try{await fn()}catch(e){localError.value=e.message}finally{localBusy.value=false}}
function starter(s){if(busy.value)return;genre.value=s.id;instruction.value=s.text}
async function syncConfig(){const d=await story.ensure({genre:genre.value,guidance:guidance.value,controlPolicy:control.value});d.config={genre:genre.value,guidance:guidance.value,controlPolicy:control.value};await story.save(d);return d}
function rememberConfig(){if(doc.value&&!story.readOnly){Object.assign(doc.value.config,{genre:genre.value,guidance:guidance.value,controlPolicy:control.value});story.changed()}}
async function send(){
  if(busy.value)return
  if(!ai.ready){models.value=true;return}
  const input=instruction.value
  await act(async()=>{await syncConfig();follow.value=true;await story.advance(input,mode.value==='discuss'?'discuss':'advance');if(instruction.value===input)instruction.value='';if(mode.value==='discuss')pane.value='plot';await refresh()})
}
async function autoWrite(){if(!ai.ready){models.value=true;return}await act(async()=>{await syncConfig();follow.value=true;await story.autoAdvance({instruction:instruction.value,targetWords:targetWords.value});instruction.value='';pane.value='review';await refresh()})}
async function stage(type){if(!ai.ready){models.value=true;return}await act(async()=>{await story.runStage(type,type==='revise'?doc.value?.revisionGuidance||'':'');pane.value='review';await refresh()})}
async function choose(id){if(busy.value)return;await act(async()=>{await story.flush();await autosave.flushAll();work.selChapterId=id;work.selVolumeId=work.activeChapter?.volumeId||null;await story.load(work.work.id,id);follow.value=true;await nextTick();scroll.value?.scrollTo({top:0})})}
async function nextChapter(){await act(async()=>{if(doc.value?.status!=='confirmed'&&hasText.value)throw new Error('请先确认本章，再展开下一章');await story.flush();const c=await work.addChapter(null,'第'+(chapters.value.length+1)+'章');work.selChapterId=c.id;await autosave.flushAll();await story.ensure({genre:genre.value,guidance:guidance.value,controlPolicy:control.value});instruction.value='';pane.value='';await nextTick();scroll.value?.scrollTo({top:0})})}
async function toWorkshop(){await act(async()=>{await story.flush();await autosave.flushAll();work.tab='chapters';ui.agentCandidateId=null;story.formalView=false;ui.workbenchMode='writing'})}
async function toLightSleep(){await act(()=>enterLightSleepMode({ui,work,flush:async()=>{await story.flush();await autosave.flushAll()},isDetached:()=>isPopped(work,'ai',''),focusDetached:()=>focusPopped(work,'ai','')}))}
async function pop(){await act(async()=>{await story.flush();await autosave.flushAll();if(!window.native?.panelOpen)throw new Error('独立窗口需要桌面版');if(!await popOut(work,'agent','',work.work.title+' · 恍然梦'))throw new Error('正文正在其他窗口编辑，请先收回编辑权')})}
async function leave(){if(panel==='agent')window.native?.panelCloseSelf();else await act(async()=>{await story.flush();await work.closeWork()})}
async function refresh(){if(!work.work?.id)return;const id=work.work.id;const [rows,jobs]=await Promise.all([db.airuns.where('workId').equals(id).filter(r=>r.type==='story-run').toArray(),listMemoryJobs(id)]);if(work.work?.id===id){runs.value=rows.sort((a,b)=>b.createdAt-a.createdAt).map(row=>({...row,...(row.recovery?{recovery:{...row.recovery,toolOutput:row.recovery.cards?.find(c=>c.kind==='draft')?.text||row.recovery.toolOutput}}:{})}));memory.value=jobs}}
async function openPane(id){pane.value=pane.value===id?'':id;if(id==='history')await refresh()}
async function confirm(){await act(async()=>{await story.confirm();confirmOpen.value=false;await refresh()})}
function onKey(e){if(e.isComposing||e.keyCode===229)return;if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();send()}}
function onScroll(){const e=scroll.value;if(e)follow.value=e.scrollHeight-e.scrollTop-e.clientHeight<100}
function useConclusion(item){instruction.value='按这个方向继续：'+item.text;mode.value='write';pane.value=''}
watch(()=>[work.work?.id,work.selChapterId],()=>{localError.value='';pane.value='';story.progress='';instruction.value='';refresh().catch(e=>localError.value=e.message)})
watch(()=>[doc.value?.id,doc.value?.config.genre,doc.value?.config.guidance,doc.value?.config.controlPolicy],()=>{genre.value=doc.value?.config.genre||'自由构思';guidance.value=doc.value?.config.guidance||'';control.value=doc.value?.config.controlPolicy||'narrator'},{immediate:true})
watch(()=>doc.value?.revision,async()=>{if(follow.value){await nextTick();scroll.value?.scrollTo({top:scroll.value.scrollHeight,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'})}})
let previewFrame
watch(()=>story.preview,()=>{if(follow.value&&!previewFrame)previewFrame=requestAnimationFrame(()=>{previewFrame=null;if(scroll.value)scroll.value.scrollTop=scroll.value.scrollHeight})})
const memoryChanged=()=>refresh().catch(e=>localError.value=e.message)
onMounted(()=>{window.addEventListener('memory-queue-changed',memoryChanged);Promise.all([ai.loadSettings(),ai.loadPresets(),refresh()]).catch(e=>localError.value=e.message)})
onBeforeUnmount(()=>{cancelAnimationFrame(previewFrame);window.removeEventListener('memory-queue-changed',memoryChanged)})
</script>

<template>
 <NConfigProvider :theme="darkTheme" :theme-overrides="theme" class="story-provider">
 <main class="story-scene" aria-label="恍然梦故事现场">
  <aside class="story-rail" aria-label="故事章节">
   <div class="story-brand"><span class="story-sigil"><OIcon name="sparkle" :size="23" /></span><div>恍然梦<small>让故事，自行生长</small></div></div>
   <button class="story-book-link" :disabled="busy" @click="leave"><OIcon name="back" :size="15" />{{panel==='agent'?'关闭独立窗口':'返回书架'}}</button>
   <div class="story-book-title"><span>正在展开的故事</span><h1>{{work.work?.title||'新的故事'}}</h1><span class="story-mode-badge"><i></i>{{control==='narrator'?'AI 叙事主写':'角色参与'}}</span></div>
   <div class="story-directory-heading"><span>故事章节</span><button :disabled="busy" aria-label="新建下一章" title="下一章" @click="nextChapter"><OIcon name="plus" :size="16" /></button></div>
   <nav class="story-chapter-list"><button v-for="(c,index) in chapters" :key="c.id" :disabled="busy" :class="{'is-current':c.id===work.selChapterId}" :aria-current="c.id===work.selChapterId?'page':undefined" @click="choose(c.id)"><span class="story-chapter-index">{{String(index+1).padStart(2,'0')}}</span><span><strong>{{c.title||'未命名章节'}}</strong><small>{{c.id===work.selChapterId&&doc?doc.status==='confirmed'?'本章已确认':hasText?'故事进行中':'等待第一幕':c.wordCount?c.wordCount+' 字':'尚未展开'}}</small></span><span v-if="c.id===work.selChapterId" class="story-current-dot"></span></button><p v-if="!chapters.length">新的故事将从第一章开始。</p></nav>
   <div class="story-rail-bottom"><button @click="openPane('history')"><OIcon name="history" :size="17" />旅程记录</button><button :disabled="busy" @click="settings=true"><OIcon name="gear" :size="17" />创作配置</button><button :disabled="busy" @click="$emit('advanced')"><OIcon name="layers" :size="17" />高级创作工具</button><div class="story-local-note"><i></i>故事保存在本机</div></div>
  </aside>
  <section class="story-stage">
   <header class="story-topbar"><div class="story-breadcrumb">故事现场<span>/</span><strong>{{current?.title||'序幕'}}</strong></div><div class="story-top-actions"><span class="story-save" role="status">{{story.error?'保存或生成需处理':story.busy?'AI 正在创作':doc?.status==='confirmed'?'本章已确认':'当前工作稿'}}</span><DreamModeEntries active="dream" :disabled="busy" @light="toLightSleep" /><button v-if="panel!=='agent'" :disabled="busy" @click="pop" title="在独立窗口中打开" aria-label="打开独立窗口"><OIcon name="split" :size="17" /></button><button class="story-workshop-link" :disabled="busy" @click="toWorkshop"><OIcon name="manuscript" :size="16" />工坊编辑</button></div></header>
   <div v-if="localError||story.error" class="story-error" role="alert"><span>{{localError||story.error}}</span><button :disabled="busy" @click="act(()=>story.flush())">重试保存</button><button aria-label="收起提示" @click="localError='';story.error=''">×</button></div>
   <div class="story-body" :class="{'with-pane':!!pane}">
    <div class="story-reading-column">
     <div ref="scroll" class="story-scroll" @scroll.passive="onScroll">
      <section v-if="!hasText&&!story.busy" class="story-opening">
       <div class="story-opening-mark" aria-hidden="true"><span></span><OIcon name="sparkle" :size="29" /></div>
       <h2>故事，从此刻发生。</h2>
       <p>给一个念头，或把开场交给恍然梦。</p>
       <div class="story-starters"><button v-for="s in starters" :key="s.id" :class="{'is-picked':genre===s.id}" :disabled="busy" @click="starter(s)"><span class="story-starter-top"><small>{{s.label}}</small><span>{{s.number}}</span></span><strong>{{s.title}}</strong><span class="story-starter-description">{{s.text}}</span><span class="story-starter-action">从这个念头出发 <OIcon name="caret-right" :size="13" /></span></button></div>
       <button class="story-surprise" :disabled="busy" @click="instruction='';genre='自由构思';send()"><OIcon name="sparkle" :size="15" />没有想法？让 AI 自由开场</button>
      </section>
      <section v-show="hasText" class="story-manuscript">
       <div class="story-chapter-caption"><span>CHAPTER {{String(work.chapterOrdinal(work.selChapterId)||1).padStart(2,'0')}}</span><button :class="{'is-active':pane==='plot'}" @click="openPane('plot')"><OIcon name="network" :size="14" />剧情</button><button :class="{'is-active':pane==='review'}" @click="openPane('review')"><OIcon name="check" :size="14" />审阅</button></div>
       <h2>{{current?.title}}</h2><div class="story-title-rule"><span></span>✦<span></span></div>
       <div id="agent-story-editor-host"></div>
       <div v-if="last" class="story-turn-footer"><span>第 {{doc.turns.length}} 幕</span><div class="story-variant-controls"><button aria-label="上一版" :disabled="busy||last.selected===0" @click="act(()=>story.variant(last.selected-1))">‹</button><span>{{last.selected+1}} / {{variants.length}}</span><button aria-label="下一版" :disabled="busy||last.selected===variants.length-1" @click="act(()=>story.variant(last.selected+1))">›</button></div><button :disabled="busy" @click="act(()=>story.advance(instruction,'regenerate'))"><OIcon name="refresh" :size="14" />换一版</button></div>
       <button v-if="doc?.status==='confirmed'" class="story-next-chapter" :disabled="busy" @click="nextChapter">本章已收录，展开下一章 <OIcon name="caret-right" :size="15" /></button>
      </section>
      <section v-if="story.preview" class="story-stream-preview"><small>正在落笔</small><p>{{story.preview}}</p></section>
      <div v-if="story.busy" class="story-generating" role="status"><span class="story-typing"><i></i><i></i><i></i></span>{{story.progress}}</div>
     </div>
     <footer class="story-compose">
      <div class="story-compose-top"><div class="story-compose-modes" role="group" aria-label="创作方式"><button :class="{'is-active':mode==='write'}" :disabled="busy" @click="mode='write'">写故事</button><button :class="{'is-active':mode==='discuss'}" :disabled="busy" @click="mode='discuss'">聊剧情</button></div><span>{{story.progress&&!story.busy?story.progress:hasText?'你可以只阅读，也可以随时改变走向。':'不用先写正文，AI 会从开场开始。'}}</span><button class="story-config-toggle" :aria-expanded="pane==='config'" @click="openPane('config')"><OIcon name="gear" :size="14" />故事设定</button></div>
      <div class="story-input-shell"><textarea v-model="instruction" :disabled="busy" aria-label="可选故事指导" :placeholder="mode==='discuss'?'想聊人物、伏笔，还是故事接下来怎么走？':hasText?'想改变什么走向？也可以留空，让故事自己继续……':'给一个故事念头，或留空交给 AI 构思开场……'" rows="2" @keydown="onKey"></textarea><button v-if="story.busy" class="story-primary story-stop" :disabled="story.confirming" @click="story.stop()"><span class="story-stop-square"></span>{{story.confirming?'正在确认…':'停止生成'}}</button><button v-else class="story-primary" :disabled="localBusy||ai.busy||story.loading||isPopped(work,'chapter',work.selChapterId||'')" @click="send"><OIcon :name="mode==='discuss'?'network':'sparkle'" :size="17" />{{!ai.ready?'配置模型':mode==='discuss'?'一起推演':doc?.status==='confirmed'?'续写本章':hasText?'继续故事':'开始故事'}}</button></div>
      <div class="story-compose-bottom"><button class="story-model" :disabled="busy" @click="models=true"><i></i>{{model}}<span>⌄</span></button><span class="story-shortcut">Ctrl + Enter 发送</span><div class="story-compose-secondary"><button :disabled="busy||!hasText" @click="autoWrite">让 AI 写完本章</button><button :disabled="busy||!hasText||doc?.status==='confirmed'" @click="confirmOpen=true">{{doc?.status==='confirmed'?'本章已确认':'确认本章'}} <OIcon name="check" :size="14" /></button></div></div>
     </footer>
    </div>
    <Transition name="story-pane"><aside v-if="pane" class="story-inspector" :aria-label="pane==='review'?'本章审阅':pane==='config'?'故事设定':pane==='history'?'旅程记录':'剧情推演'"><header><div><span>创作手记</span><h2>{{pane==='review'?'本章审阅':pane==='config'?'故事设定':pane==='history'?'旅程记录':'剧情推演'}}</h2></div><button aria-label="收起侧栏" @click="pane=''"><OIcon name="close" :size="17" /></button></header>
     <section v-if="pane==='config'" class="story-inspector-content">
      <label>故事题材<select v-model="genre" :disabled="busy" @change="act(syncConfig)"><option v-for="g in ['自由构思','奇幻冒险','悬疑推理','都市日常','科幻探索','历史传奇']" :key="g">{{g}}</option></select></label>
      <label>叙事控制<select v-model="control" :disabled="busy" @change="act(syncConfig)"><option value="narrator">AI 主写全部角色</option><option value="participant">我参与主角的重要选择</option></select></label>
      <label>持续创作要求<textarea v-model="guidance" :disabled="busy" rows="6" placeholder="例如：第三人称，克制的情绪，人物能力必须付出代价。" @input="rememberConfig" @blur="act(syncConfig)"></textarea></label>
      <label>本章目标字数<input v-model.number="targetWords" type="number" min="500" max="20000" step="500" :disabled="busy" /></label>
      <p>“写完本章”最多推进 6 轮，受篇幅与预算限制。随时可停止，正文确认由你决定。</p><button :disabled="busy" @click="act(syncConfig)">保存故事设定</button>
     </section>
     <section v-else-if="pane==='plot'" class="story-inspector-content"><p>和恍然梦商量故事，再把选中的走向带回正文。</p><button :disabled="busy||!hasText" @click="mode='discuss';instruction='请根据当前故事，分析人物目标、未解决的矛盾，并提出下一幕的可选方向。';send()">推演下一幕</button><article v-for="item in doc?.discussion||[]" :key="item.id" class="story-discussion"><small>{{item.instruction||'剧情讨论'}}</small><p>{{item.text}}</p><button :disabled="busy" @click="useConclusion(item)">把这个方向带入下一幕</button></article><p v-if="!doc?.discussion?.length" class="story-muted">讨论不会自动写入小说正文或正式设定。</p></section>
     <section v-else-if="pane==='review'" class="story-inspector-content"><p>对当前工作稿独立审读，意见由你决定是否采用。</p><button :disabled="busy||!hasText" @click="stage('review')">{{doc?.review?'重新审读当前稿':'审读本章'}}</button><p v-if="!doc?.review" class="story-muted">检查人物动机、知情范围、时间顺序和能力代价。手改或继续故事后，旧意见会移入历史。</p><template v-if="doc?.review"><p v-if="!doc.review.items.length">模型未发现问题，仍需你审读确认。</p><article v-for="item in doc.review.items" :key="item.id" class="story-finding"><div><span>{{item.category}}</span><small>{{item.evidenceStatus==='verified'?'引文已定位':'待核实'}}</small></div><label class="story-checkbox"><input v-model="doc.decisions[item.id]" type="checkbox" true-value="apply" false-value="ignore" :disabled="busy" @change="story.changed()" />纳入修稿</label><blockquote v-if="item.quote">{{item.quote}}</blockquote><p class="story-problem">{{item.problem}}</p><p v-if="item.expected" class="story-muted">建议：{{item.expected}}</p></article><label>补充修改要求<textarea v-model="doc.revisionGuidance" rows="3" :disabled="busy" @input="story.changed()"></textarea></label><button class="story-primary" :disabled="busy||(!selectedCount&&!doc.revisionGuidance?.trim())" @click="stage('revise')">按所选意见修稿{{selectedCount?' · '+selectedCount+' 项':''}}</button></template><button v-if="doc?.confirmation" :disabled="busy" @click="stage('recheck')">复核原问题</button><p v-for="item in doc?.check?.items||[]" :key="item.id">{{item.status==='resolved'?'找到解决依据':'仍需处理'}} · {{item.explanation}}</p></section>
     <section v-else class="story-inspector-content"><h3>创作记录</h3><p v-if="!runs.length">故事开场后，每轮创作会保存在这里。</p><article v-for="run in runs" :key="run.id" class="story-run"><span>{{({story:'故事创作',review:'独立审稿',revise:'修稿',recheck:'复核'})[run.stage]}}</span><small>{{run.status==='completed'?'已保存':'已中断'}} · {{run.usage.actual+run.usage.estimated}} tokens</small><details v-if="run.recovery"><summary>中断恢复材料</summary><pre>{{run.recovery.toolOutput||run.recovery.rawContent||'本轮未收到完整内容，可重新生成。'}}</pre></details></article><h3>正文与记忆</h3><p v-if="!memory.length">本章确认后登记记忆更新任务。</p><article v-for="job in memory" :key="job.id" class="story-run"><span>正文已保存</span><small>{{({completed:'记忆已更新',failed:'部分失败',pending:'等待更新',running:'更新中',interrupted:'已中断',cancelled:'来源失效'})[job.status]||job.status}}</small><button v-if="['failed','interrupted'].includes(job.status)" :disabled="busy" @click="act(()=>retryMemoryJob(job.id))">重试失败步骤</button></article></section>
    </aside></Transition>
   </div>
  </section>
 </main>
 <NModal v-model:show="models" preset="card" title="连接创作模型" style="width:min(920px,94vw);max-height:90vh;overflow:auto"><AiSettings /></NModal>
 <NModal v-model:show="settings" preset="card" title="创作模型与写作规则" style="width:min(920px,94vw);max-height:90vh;overflow:auto"><StageSettings /></NModal>
 <NModal v-model:show="confirmOpen" preset="card" title="确认这一章" class="story-confirm-modal" style="width:min(480px,92vw)"><p>把当前工作稿的 {{doc?.text.replace(/\s/g,'').length||0}} 字保存为本章正式正文，并登记记忆更新。</p><p>{{doc?.review?'已完成独立审读，请确认你已处理需要修改的意见。':'本稿尚未独立审阅。你可以先审阅，或自行读完后确认。'}}</p><p>已有正式正文将被当前稿替换，保留撤销记录。</p><div class="story-confirm-actions"><button v-if="!doc?.review" :disabled="busy" @click="confirmOpen=false;pane='review';stage('review')">先审阅</button><button :disabled="busy" @click="confirmOpen=false">再读一读</button><button class="story-primary" :disabled="busy" @click="confirm">{{busy?'正在保存…':'确认保存本章'}}</button></div></NModal>
 </NConfigProvider>
</template>
