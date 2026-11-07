<script setup>
import { computed,nextTick,onBeforeUnmount,onMounted,ref,watch } from 'vue'
import { useUiStore } from '../../stores/ui'
import { readWritingStats } from '../../db/repo.js'
import { todayStr } from '../../db/database'
import { buildWritingAnalysis } from '../../services/writing-analysis-data.js'
import { createWritingAnalysisModel } from '../../services/writing-analysis-model.js'
import { createStatsLoader,STATS_TABLES } from '../../services/writing-stats-core.js'
import StatsTrend from './StatsTrend.vue'
import StatsMetrics from './StatsMetrics.vue'
import StatsInspector from './StatsInspector.vue'
import WritingStatsAnalysis from './WritingStatsAnalysis.vue'
import OIcon from '../OIcon.vue'
import { useStatsMotion } from './use-stats-motion.js'
import '../../styles/writing-stats.css'
import '../../styles/writing-stats-fusion.css'

const ui=useUiStore(),quick=ref(null),full=ref(null),inspector=ref(null),scroll=ref(null)
const expanded=ref(false),width=ref(typeof innerWidth==='number'?innerWidth:1440)
const phone=computed(()=>width.value<=680),narrow=computed(()=>width.value<=1050)
const payload=ref(null),loadedScope=ref(null),busy=ref(false),error=ref(false),quickDate=ref(null)
const empty=buildWritingAnalysis({},{today:todayStr()})
const data=computed(()=>payload.value?.stats.analysis||empty),model=computed(()=>createWritingAnalysisModel(data.value))
const s=ref(createWritingAnalysisModel(empty).entry('all'))
const choices=computed(()=>{
 const list=payload.value?.choices||[],count=new Map(),seen=new Map()
 for(const w of list)count.set(w.label,(count.get(w.label)||0)+1)
 return list.map(w=>{const n=(seen.get(w.label)||0)+1;seen.set(w.label,n);return {...w,label:count.get(w.label)>1?w.label+' · '+n:w.label}})
})
const name=id=>choices.value.find(w=>w.id===id)?.label||'全部作品'
const ready=computed(()=>payload.value&&loadedScope.value===s.value.work)
const dates=computed(()=>model.value.timeline(s.value.work,data.value.end,s.value.period,s.value.range))
const week=computed(()=>model.value.timeline(s.value.work,data.value.end,7))
const inv=computed(()=>model.value.inventory(s.value.work))
const signed=n=>(n>0?'+':n<0?'−':'')+Math.abs(n).toLocaleString('zh-CN')
const quickDay=computed(()=>week.value.find(d=>d.date===quickDate.value))
const quickMetrics=computed(()=>[
 {key:'words',label:'当前正文字数',value:inv.value.words.toLocaleString('zh-CN'),unit:'字',accent:true},
 {key:'chapters',label:'正式章节数',value:inv.value.chapters.length,unit:'章'},
 {key:'today',label:'今日净增',value:week.value.at(-1)?.logs.length?signed(week.value.at(-1).net):'—',unit:week.value.at(-1)?.logs.length?'字':'',negative:week.value.at(-1)?.net<0}
])
const tabs={overview:'总览',manuscript:'正文',outline:'大纲',lore:'设定',characters:'人物',snippets:'灵感'}
const heading=computed(()=>s.value.tab==='overview'?(s.value.mode==='compare'?'作品对照':'创作历程'):s.value.tab==='manuscript'?'稿件案卷':tabs[s.value.tab]+'分析')
const subtitle=computed(()=>s.value.tab==='overview'?(s.value.mode==='compare'?'在同一时间范围内，比较不同作品的写作记录。':'沿着时间回看正文保存、版本与灵感。'):s.value.tab==='manuscript'?'读章节结构，或沿日期查看每一章的改稿记录。':'按作品查看当前存量和明细。')
const contextDetail=computed(()=>s.value.detail||(s.value.tab==='overview'&&s.value.mode==='journey'?{kind:'date',date:s.value.date,work:s.value.work}:null))
const loader=createStatsLoader(readWritingStats),anchor=ref({})
let trigger=null,lastTriggerRect=null,detailTrigger=null,fullY=0,compareReturn=null,chapterReturn=null,refreshTimer=null,channel=null,pendingScroll=null
const chartScroll=new Map()
useStatsMotion(quick,()=>s.value.work)
useStatsMotion(scroll,()=> 'analysis-navigation',{controlsOnly:true})
function entryElement(){return trigger?.isConnected?trigger:null}
function position(){
 width.value=innerWidth
 const el=entryElement(),r=el?.getBoundingClientRect()
 if(r?.height&&r.width&&r.bottom>0&&!el.closest('[inert]'))lastTriggerRect=r
 const box=lastTriggerRect
 if(box&&!phone.value)anchor.value={'--quick-right':Math.max(12,document.documentElement.clientWidth-box.right)+'px','--quick-top':Math.max(12,box.bottom+12)+'px'}
}
async function returnEntry(){
 await nextTick();const el=entryElement()
 if(!el)return
 if(!el.closest('[inert]')&&el.getBoundingClientRect().height){el.focus({preventScroll:true});return}
 const edge=el.closest('.wb-topbar-host')?.querySelector('.wb-topbar-edge')
 edge?.focus({preventScroll:true})
}
async function refresh(){
 if(!ui.statsOpen)return
 const work=s.value.work
 busy.value=true;error.value=false
 const result=await loader.read(work==='all'?null:work,s.value.period)
 if(!result||!ui.statsOpen)return
 busy.value=false
 if(result.error){error.value=true;return}
 payload.value=result.value;loadedScope.value=work
 if(work!=='all'&&!result.value.choices.some(w=>w.id===work)){s.value={...s.value,work:'all',mode:'compare',volume:'all',status:'all',detail:null,chapterPick:null,chapterDay:null};return}
 const ids=result.value.choices.map(w=>w.id),pair=s.value.pair.filter(id=>ids.includes(id))
 for(const id of ids)if(pair.length<2&&!pair.includes(id))pair.push(id)
 s.value={...s.value,pair}
 if(s.value.detail?.kind==='chapter'&&!data.value.chapters.some(c=>c.id===s.value.detail.id))s.value={...s.value,detail:null,chapterPick:null,chapterDay:null}
 const d=s.value.detail
 if(d?.kind==='entity'&&![...data.value.outline,...data.value.lore,...data.value.people,...data.value.snippets].some(r=>r.id===d.id))s.value={...s.value,detail:null}
 if(d?.kind==='record'&&!model.value.records(s.value.work,data.value.day(data.value.end,-89),data.value.end).some(r=>r.id===d.id))s.value={...s.value,detail:null}
 if(s.value.range&&(s.value.range[0]<data.value.day(data.value.end,1-s.value.period)||s.value.range[1]>data.value.end))s.value={...s.value,range:null,date:data.value.end,detail:null}
 await restorePosition()
}
function refreshSoon(e){
 if(!ui.statsOpen||e?.type==='visibilitychange'&&document.hidden)return
 if(e?.detail?.table&&!STATS_TABLES.includes(e.detail.table)&&!['revisions','wordlog'].includes(e.detail.table))return
 clearTimeout(refreshTimer);refreshTimer=setTimeout(refresh,140)
}
function rememberTrigger(e){trigger=e.detail?.element||e.detail;position()}
async function showQuick(){
 await nextTick()
 if(!ui.statsOpen||expanded.value)return
 if(quick.value?.open)return
 if(phone.value)quick.value?.showModal();else quick.value?.show()
 position();quick.value?.querySelector('h2')?.focus({preventScroll:true})
}
async function openFull(action){
 if(action)s.value=model.value.transition(s.value,{type:action,date:quickDate.value})
 quick.value?.close()
 expanded.value=true
 await nextTick()
 if(!ui.statsOpen||!expanded.value)return
 if(!full.value?.open)full.value?.showModal()
 await nextTick()
 if(scroll.value)scroll.value.scrollTop=fullY
 full.value?.querySelector('h1')?.focus({preventScroll:true})
  syncInspector()
}
async function collapse(){
 fullY=scroll.value?.scrollTop||0
 inspector.value?.close();full.value?.close();expanded.value=false
 await showQuick()
}
function close(restore=true){
 loader.invalidate();clearTimeout(refreshTimer);busy.value=false
 inspector.value?.close();quick.value?.close();full.value?.close()
 ui.statsOpen=false;expanded.value=false
 if(restore)returnEntry()
}
async function closeDetail(){
 s.value={...s.value,detail:null}
 inspector.value?.close()
 await nextTick()
 if(detailTrigger?.isConnected)detailTrigger.focus({preventScroll:true})
 else full.value?.querySelector('h1')?.focus({preventScroll:true})
}
function select(detail){
 detailTrigger=detail.trigger||document.activeElement
 const {trigger:_trigger,...value}=detail
 s.value={...s.value,detail:value,date:value.kind==='date'&&s.value.mode==='journey'?value.date:s.value.date}
}
async function chapterSelect({id,date,trigger:button}){
 detailTrigger=button||document.activeElement
 s.value={...s.value,chapterPick:id,chapterDay:date||null,detail:{kind:'chapter',id,date:date||null}}
}
async function historyChapter({id,date,trigger:button}){
 chapterReturn={s:s.value,y:scroll.value?.scrollTop||0,trigger:button||document.activeElement}
 s.value=model.value.transition(s.value,{type:'chapter-link',id,date})
 detailTrigger=null
 await nextTick();if(scroll.value)scroll.value.scrollTop=0
}
async function patch(value){
 const prev=s.value
 if('work' in value){s.value=model.value.transition(prev,{type:'work',work:value.work});chapterReturn=null;quickDate.value=null;return}
 if('mode' in value){s.value=model.value.transition(prev,{type:'mode',mode:value.mode});chapterReturn=null;return}
 if('period' in value)s.value=model.value.transition(prev,{type:'period',period:value.period})
 else if('range' in value)s.value=model.value.transition(prev,{type:'range',range:value.range})
 else s.value={...prev,...value}
 if('volume' in value||'status' in value){
  if(!model.value.chapters(s.value.work,s.value.volume,s.value.status).some(c=>c.id===s.value.chapterPick))s.value={...s.value,chapterPick:null,chapterDay:null,detail:null}
 }
 if('chart' in value){
  chartScroll.set(prev.work+'|'+prev.chart,scroll.value?.scrollTop||0)
  await nextTick();if(scroll.value)scroll.value.scrollTop=chartScroll.get(s.value.work+'|'+s.value.chart)||0
 }else if('tab' in value){await nextTick();if(scroll.value)scroll.value.scrollTop=0}
}
async function drill({work,trigger:button}){
 compareReturn={y:scroll.value?.scrollTop||0,trigger:button}
 s.value=model.value.transition(s.value,{type:'drill',work})
 await nextTick();if(scroll.value)scroll.value.scrollTop=0
}
async function back(){
 const from=chapterReturn&&s.value.tab==='manuscript'?chapterReturn:compareReturn
 if(chapterReturn&&s.value.tab==='manuscript'){s.value=chapterReturn.s;chapterReturn=null}
 else s.value=model.value.transition(s.value,{type:'back'})
 pendingScroll={work:s.value.work,top:from?.y||0,trigger:from?.trigger}
 await restorePosition()
}
async function restorePosition(){
 if(!pendingScroll||pendingScroll.work!==loadedScope.value||!ready.value)return
 const target=pendingScroll;pendingScroll=null
 await nextTick()
 if(scroll.value)scroll.value.scrollTop=target.top
 if(target.trigger?.isConnected)target.trigger.focus({preventScroll:true})
 else {
  const fromTile=!!target.trigger?.dataset?.work,id=target.trigger?.dataset?.work||target.trigger?.dataset?.drillWork
  const button=id&&[...full.value.querySelectorAll(fromTile?'[data-work]':'[data-drill-work]')].find(el=>(fromTile?el.dataset.work:el.dataset.drillWork)===id)
  button?.focus({preventScroll:true})
 }
}
function key(e){
 if(e.key!=='Escape')return
 e.preventDefault();e.stopPropagation()
 if(inspector.value?.open||expanded.value&&s.value.detail)closeDetail()
 else close()
}
function outside(e){
 if(!ui.statsOpen||expanded.value||phone.value)return
 if(quick.value?.contains(e.target)||entryElement()?.contains(e.target))return
 close(false)
}
function tabKey(e,index){
 if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return
 e.preventDefault();const keys=Object.keys(tabs),i=e.key==='Home'?0:e.key==='End'?keys.length-1:(index+(e.key==='ArrowLeft'?-1:1)+keys.length)%keys.length
 patch({tab:keys[i],detail:null});nextTick(()=>full.value?.querySelectorAll('[role=tab]')[i]?.focus({preventScroll:true}))
}
watch(()=>ui.statsOpen,async open=>{
 if(!open){loader.invalidate();quick.value?.close();full.value?.close();inspector.value?.close();return}
 s.value=model.value.entry(ui.statsWorkId||'all');payload.value=null;loadedScope.value=null;quickDate.value=null;fullY=0;chapterReturn=null;compareReturn=null;pendingScroll=null;chartScroll.clear();expanded.value=false
 await showQuick();refresh()
})
watch(()=>s.value.work,(n,p)=>{if(n!==p&&ui.statsOpen)refresh()})
async function syncInspector(){
 await nextTick()
 if(expanded.value&&full.value?.open&&narrow.value&&s.value.detail){
  if(!inspector.value?.open){inspector.value?.showModal();await nextTick();inspector.value?.querySelector('.close')?.focus({preventScroll:true})}
 }else inspector.value?.close()
}
watch(()=>[s.value.detail,narrow.value,expanded.value],syncInspector)
watch(phone,async()=>{
 if(!ui.statsOpen||expanded.value)return
 quick.value?.close();await showQuick()
})
watch(expanded,value=>{document.documentElement.classList.toggle('writing-analysis-open',value)})
onMounted(()=>{
 document.addEventListener('writing-stats-entry',rememberTrigger)
 document.addEventListener('pointerdown',outside,true)
 window.addEventListener('resize',position)
 window.addEventListener('book-source-changed',refreshSoon)
 window.addEventListener('writing-history-changed',refreshSoon)
 window.addEventListener('focus',refreshSoon)
 document.addEventListener('visibilitychange',refreshSoon)
 if(typeof BroadcastChannel==='function'){channel=new BroadcastChannel('novel-studio-writing-history');channel.onmessage=refreshSoon}
})
onBeforeUnmount(()=>{
 document.removeEventListener('writing-stats-entry',rememberTrigger);document.removeEventListener('pointerdown',outside,true)
 window.removeEventListener('resize',position);window.removeEventListener('book-source-changed',refreshSoon);window.removeEventListener('writing-history-changed',refreshSoon);window.removeEventListener('focus',refreshSoon);document.removeEventListener('visibilitychange',refreshSoon)
 channel?.close();loader.invalidate();clearTimeout(refreshTimer);document.documentElement.classList.remove('writing-analysis-open')
})
</script>
<template>
<Teleport to="body">
 <dialog ref="quick" class="writing-stats-fusion writing-stats-dialog writing-stats-quick" :style="[ui.rootStyle,anchor]" :aria-labelledby="expanded?'stats-quick-title':'writing-stats-title'" @keydown.stop="key" @cancel.prevent="close()" @click.self="phone&&close()">
  <div class="quick-head"><div class="micro"><i/>写作数据</div><button type="button" class="icon close stats-close" aria-label="关闭速览" @click="close()">×</button><h2 :id="expanded?'stats-quick-title':'writing-stats-title'" tabindex="-1">写作速览</h2>
   <label class="quick-scope"><span>统计范围</span><select :id="expanded?'stats-quick-work':'writing-stats-work'" :value="s.work==='all'?'':s.work" @change="patch({work:$event.target.value||'all'})"><option value="">全部作品</option><option v-for="w in choices" :key="w.id" :value="w.id">{{w.label}}</option></select><button class="stats-refresh icon" aria-label="刷新写作数据" title="刷新" :disabled="busy" @click="refresh"><OIcon name="refresh" :size="14"/></button></label>
  </div>
  <div v-if="error" class="stats-state" role="alert"><p>暂时无法读取写作数据。</p><button class="soft" @click="refresh">重试读取</button></div><p v-else-if="!ready" class="stats-state" role="status">正在读取写作数据…</p>
  <template v-else><div class="quick-content stats-scroll" :aria-busy="busy"><StatsMetrics :items="quickMetrics"/><div class="quick-chart-head"><h3>近 7 日正文净增</h3><div class="legend"><span><i class="up"/>净增</span><span><i class="down"/>净减</span></div></div><StatsTrend :days="week" compact :work="s.work" :model-value="quickDate" @select="quickDate=$event"/>
   <div class="quick-day" role="status"><template v-if="quickDay"><span>{{quickDay.date}}</span><b :class="quickDay.net<0?'loss':'accent'">{{quickDay.logs.length?signed(quickDay.net)+' 字'+(!quickDay.net&&quickDay.active?' · 有写入':''):'无保存记录'}}</b><small>{{quickDay.logs.length}} 条保存</small></template><span v-else>点选日期查看净增与保存条数</span></div><button v-if="quickDay" class="quick-link" @click="openFull('day-link')">查看当日明细 →</button>
  </div><div class="quick-actions stats-foot"><button class="soft" @click="openFull(s.work==='all'?'compare-link':'revise-link')">{{s.work==='all'?'对照作品':'待修改 '+inv.revise+' 章'}}</button><button class="primary" @click="openFull()">查看完整分析 <span>→</span></button></div></template>
 </dialog>
 <dialog ref="full" class="writing-stats-fusion writing-stats-dialog writing-stats-full expanded" :style="ui.rootStyle" :aria-labelledby="expanded?'writing-stats-title':'stats-analysis-title'" @keydown.stop="key" @cancel.prevent="s.detail?closeDetail():close()">
 <div ref="scroll" class="writing-stats-scroll stats-scroll" :aria-busy="busy">
  <header class="topbar analysis-bar"><span class="brand"><strong>小说工坊</strong><span>LATENT</span></span><nav class="tabs stats-tabs" role="tablist" aria-label="写作分析视图"><button v-for="(label,id,i) in tabs" :id="'stats-tab-'+(id==='manuscript'?'chapters':id)" :key="id" role="tab" :aria-selected="s.tab===id" :aria-pressed="s.tab===id" :tabindex="s.tab===id?0:-1" @keydown="tabKey($event,i)" @click="patch({tab:id,detail:null})">{{label}}</button></nav><div class="tools stats-head-actions"><button class="icon stats-btn" aria-label="收起为速览" title="收起为速览" @click="collapse">−</button><button class="icon stats-close" aria-label="关闭写作分析" @click="close()">×</button></div></header>
  <main class="analysis-main"><div class="mast" :class="{'overview-mast':s.tab==='overview'}"><div><div class="micro edition">写作分析 <span>/</span> {{name(s.work)}}</div><h1 :id="expanded?'writing-stats-title':'stats-analysis-title'" tabindex="-1">{{heading}}</h1><p v-if="s.tab!=='overview'">{{subtitle}}</p></div><div class="scope"><button v-if="chapterReturn&&s.tab==='manuscript'||s.back" class="soft" @click="back">← {{chapterReturn&&s.tab==='manuscript'?'返回日期明细':'返回对照'}}</button><label class="scope-work"><span>作品</span><select :id="expanded?'writing-stats-work':'stats-full-work'" :value="s.work==='all'?'':s.work" @change="patch({work:$event.target.value||'all'})"><option value="">全部作品</option><option v-for="w in choices" :key="w.id" :value="w.id">{{w.label}}</option></select></label><div v-if="['overview','manuscript','snippets'].includes(s.tab)" class="period stats-segment" role="group" aria-label="日期范围"><button v-for="n in [7,30,90]" :key="n" :aria-pressed="s.period===n" :data-period="n" @click="patch({period:n})">{{n}} 日</button></div><button class="icon stats-refresh" aria-label="刷新写作数据" title="刷新" :disabled="busy" @click="refresh"><OIcon name="refresh" :size="14"/></button></div></div>
  <div v-if="s.tab==='overview'" class="mode-rail"><div class="period" role="group" aria-label="总览视图"><button :aria-pressed="s.mode==='journey'" data-mode="journey" @click="patch({mode:'journey'})">创作历程</button><button :aria-pressed="s.mode==='compare'" data-mode="compare" @click="patch({mode:'compare'})">作品对照</button></div><span>{{subtitle}}</span></div>
  <div v-if="error" class="stats-state" role="alert"><p>暂时无法读取写作数据。</p><button class="soft" @click="refresh">重试读取</button></div><p v-else-if="!ready" class="stats-state" role="status">正在读取写作数据…</p>
  <WritingStatsAnalysis v-else :stats="payload.stats" :data="data" :model="model" :state="s" :choices="choices" @patch="patch" @detail="select" @chapter="chapterSelect" @day="chapterSelect" @drill="drill">
   <aside class="panel inspector-inline"><StatsInspector :detail="contextDetail" :data="data" :model="model" :state="s" :work-name="name" :closable="!!s.detail" @close="closeDetail" @chapter="historyChapter" @detail="select" @chapter-day="chapterSelect"/></aside>
  </WritingStatsAnalysis>
  <footer><span>小说工坊 · LATENT</span><span>已保存的本地数据</span></footer>
  </main>
 </div>
 </dialog>
 <dialog ref="inspector" class="writing-stats-fusion writing-stats-inspector" :style="ui.rootStyle" aria-labelledby="stats-inspector-title" @keydown.stop="key" @cancel.prevent="closeDetail" @click.self="closeDetail">
  <StatsInspector v-if="expanded&&narrow&&s.detail&&ready" :detail="s.detail" :data="data" :model="model" :state="s" :work-name="name" closable mobile @close="closeDetail" @chapter="historyChapter" @detail="select" @chapter-day="chapterSelect"/>
 </dialog>
</Teleport>
</template>
