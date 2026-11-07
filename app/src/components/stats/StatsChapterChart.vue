<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import StatsSectionHead from './StatsSectionHead.vue'
import StatsMetrics from './StatsMetrics.vue'
import StatsPagination from './StatsPagination.vue'
import { useStatsMotion } from './use-stats-motion.js'
const props=defineProps({model:Object,data:Object,state:Object,workName:Function})
const emit=defineEmits(['patch','chapter','day'])
const root=ref(null),pane=ref(null),page=ref(0),positions=new Map()
useStatsMotion(root,()=>props.state.chart)
const fmt=n=>n.toLocaleString('zh-CN'), sign=n=>(n>0?'+':n<0?'−':'')+fmt(Math.abs(n))
const labels={done:'已完成',revise:'待修改',draft:'草稿'}
const score=computed(()=>props.model.chapterStructure(props.state.work,props.state.volume,props.state.status))
const rows=computed(()=>score.value.groups.flatMap(g=>g.rows))
const pageRows=computed(()=>rows.value.slice(page.value*40,(page.value+1)*40))
const groups=computed(()=>score.value.groups.map(g=>({...g,rows:g.rows.filter(c=>pageRows.value.includes(c))})).filter(g=>g.rows.length))
const vs=computed(()=>props.model.volumes(props.state.work))
const counts=computed(()=>Object.fromEntries(Object.keys(labels).map(k=>[k,score.value.base.filter(c=>c.status===k).length])))
const volumeName=computed(()=>vs.value.find(v=>v.id===props.state.volume)?.title||'全部章节')
const matrix=computed(()=>{
 const selection=new Set(pageRows.value.map(c=>c.id))
 return props.model.chapterCalendar(props.state.work,props.state.volume,props.state.status,props.state.period,props.state.range,selection)
})
const peak=computed(()=>Math.max(1,...matrix.value.rows.flatMap(r=>r.days.map(d=>Math.abs(d.net)))))
const metrics=computed(()=>[{label:(props.state.volume==='all'?'当前':'本卷')+'正文',value:fmt(score.value.base.reduce((sum,c)=>sum+c.words,0)),unit:'字',accent:true},{label:(props.state.volume==='all'?'当前':'本卷')+'已完成',value:counts.value.done+' / '+score.value.base.length,unit:'章'}])
const kind=d=>!d.logs.length?'missing':d.net>0?'gain':d.net<0?'loss':d.active?'zero':'flat'
const symbols={gain:'+',loss:'−',zero:'=',flat:'≈',missing:'·'}
const title=(c,d)=>c.title+'，'+d.date+'，'+(d.logs.length?sign(d.net)+' 字':'无保存记录')+'，'+d.logs.length+' 条保存，'+d.versions.length+' 个版本'
const matrixKey=computed(()=>props.state.work+'|'+matrix.value.dates[0]+'|'+matrix.value.dates.at(-1))
function patch(k,value){emit('patch',{[k]:value})}
function remember(){if(pane.value)positions.set(matrixKey.value,[pane.value.scrollLeft,pane.value.scrollTop])}
async function restore(){
 await nextTick()
 if(!pane.value)return
 const saved=positions.get(matrixKey.value)
 pane.value.scrollLeft=saved?.[0]??pane.value.scrollWidth
 pane.value.scrollTop=saved?.[1]??0
}
watch(()=>[props.state.work,props.state.volume,props.state.status],()=>{page.value=0})
watch(()=>[props.state.chart,matrixKey.value,page.value],restore,{flush:'post',immediate:true})
function visibleCell(cell){
 const box=cell.getBoundingClientRect(),r=pane.value.getBoundingClientRect(),stub=pane.value.querySelector('th').offsetWidth
 if(box.left<r.left+stub+3)pane.value.scrollLeft+=box.left-r.left-stub-3
 if(box.right>r.right-4)pane.value.scrollLeft+=box.right-r.right+4
}
function move(e,r,c){
 if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(e.key))return
 e.preventDefault();const rr=Math.max(0,Math.min(matrix.value.rows.length-1,r+(e.key==='ArrowDown'?1:e.key==='ArrowUp'?-1:0)))
 const cc=e.key==='Home'?0:e.key==='End'?matrix.value.dates.length-1:Math.max(0,Math.min(matrix.value.dates.length-1,c+(e.key==='ArrowRight'?1:e.key==='ArrowLeft'?-1:0)))
 const next=pane.value.querySelector('[data-row="'+rr+'"][data-col="'+cc+'"]');e.currentTarget.tabIndex=-1;next.tabIndex=0;next.focus({preventScroll:true});visibleCell(next)
}
function select(c,date,e){emit(date?'day':'chapter',{id:c.id,date,trigger:e.currentTarget})}
const tabCell=(c,d)=>c.id===(pageRows.value.find(c=>c.id===props.state.chapterPick)?.id||pageRows.value[0]?.id)&&d.date===(matrix.value.dates.includes(props.state.chapterDay)?props.state.chapterDay:matrix.value.dates.at(-1))
</script>
<template>
<div ref="root" class="manuscript-grid" id="stats-view-chapters">
 <aside class="panel volume-rail"><div class="micro">MANUSCRIPT INDEX</div><h2>分卷目录</h2><button :aria-pressed="state.volume==='all'" @click="patch('volume','all')"><span>全部章节</span><small>{{model.inventory(state.work).chapters.length}} 章</small></button>
 <button v-for="(v,i) in vs" :key="v.id" :aria-pressed="state.volume===v.id" :data-volume="v.id" @click="patch('volume',v.id)"><small>{{String(i+1).padStart(2,'0')}}<template v-if="state.work==='all'"> · {{workName(v.work)}}</template></small><span>{{v.title}}</span><div class="rail-progress"><i :style="{width:(v.count?v.done/v.count*100:0)+'%'}"/></div><small>已完成 {{v.done}} / {{v.count}}</small></button></aside>
 <div class="main-stack">
 <section class="panel manuscript-panel">
  <StatsSectionHead kicker="01 / MANUSCRIPT" :title="state.chart==='revision'?'章节改稿轨迹':'章节字数分布'" :note="volumeName+' · '+(state.chart==='revision'?'保存字数差与留存版本':'字数与完成度按分卷统计')">
   <div class="chapter-head-tools"><div class="chapter-switch period" role="group" aria-label="章节分析图表"><button v-for="(label,k) in {structure:'章节结构',revision:'改稿轨迹'}" :key="k" :data-chart="k" :aria-pressed="state.chart===k" @click="remember();patch('chart',k)">{{label}}</button></div><span class="badge">{{state.status==='all'?'共':'筛出'}} {{rows.length}} 章</span></div>
  </StatsSectionHead>
  <StatsMetrics :items="metrics"/>
  <label class="mobile-volume"><span>分卷</span><select :value="state.volume" aria-label="分卷" @change="patch('volume',$event.target.value)"><option value="all">全部分卷</option><option v-for="v in vs" :key="v.id" :value="v.id">{{v.title}}</option></select></label>
  <div class="status-band" aria-hidden="true"><i v-for="(n,k) in counts" :key="k" :class="k" :style="{flex:n}"/></div>
  <div class="status-filter" role="group" aria-label="章节状态"><button :aria-pressed="state.status==='all'" data-status="all" @click="patch('status','all')">全部 {{score.base.length}}</button><button v-for="(n,k) in counts" :key="k" :data-status="k" :aria-pressed="state.status===k" @click="patch('status',k)"><i :class="k"/>{{labels[k]}} <span>{{n}}</span></button></div>
  <div v-if="!rows.length" class="empty"><b>没有符合条件的章节</b><p>可切换分卷、状态或作品范围。</p></div>
  <div v-else-if="state.chart==='structure'" class="score" data-motion-group="chapter-score">
   <div class="score-key"><span>原稿顺序 · 当前正文</span><span class="median-key"><i/>{{state.volume==='all'?'全部章节':'本卷'}}中位数 <b>{{fmt(score.median)}}</b> 字</span></div>
   <div class="chapter-axis score-axis"><span>章节 / 状态</span><span class="score-ticks"><span v-for="n in [0,1,2,3,4]" :key="n" :style="{left:n*25+'%'}">{{fmt(score.max*n/4)}}</span></span><span>字数</span></div>
   <div class="chapter-list"><div v-for="(g,i) in groups" :key="g.id" class="score-group"><div class="score-group-label"><b>{{String(i+1).padStart(2,'0')}}</b><span>{{g.title}}</span><small v-if="state.work==='all'">{{workName(g.work)}}</small></div>
    <button v-for="c in g.rows" :key="c.id" class="chapter-row score-row" :data-chapter="c.id" :data-row-motion="'chapter-'+c.id" :aria-pressed="state.chapterPick===c.id" :aria-label="c.title+'，'+c.words+' 字，'+(labels[c.status]||'未标记')" @click="select(c,null,$event)">
     <span class="chapter-title"><span class="chapter-no">{{String(score.base.indexOf(c)+1).padStart(2,'0')}}</span><span><strong>{{c.title}}</strong><small class="status" :class="c.status"><i/>{{labels[c.status]||'未标记'}}</small></span></span>
     <span class="word-track score-track"><i class="median-mark" :style="{'--median':score.median/score.max*100+'%'}" aria-hidden="true"/><i class="score-bar" :class="c.status" :data-bar-motion="'chapter-'+c.id" :style="{width:c.words/score.max*100+'%'}"/></span><b>{{fmt(c.words)}}</b>
    </button>
   </div></div>
   <details class="exact"><summary>查看章节精确数值</summary><div class="table-scroll"><table><thead><tr><th>章节</th><th>状态</th><th>当前字数</th></tr></thead><tbody><tr v-for="c in pageRows" :key="c.id"><td>{{c.title}}</td><td>{{labels[c.status]||'未标记'}}</td><td>{{fmt(c.words)}}</td></tr></tbody></table></div></details>
  </div>
  <div v-else class="revision-board" data-motion-group="revision-matrix">
   <div class="matrix-cap"><div><div class="matrix-key"><span><i class="gain">+</i>净增</span><span><i class="loss">−</i>净减</span><span><i class="zero">=</i>有写入 · 净零</span><span><i class="missing">·</i>无保存记录</span><span><i class="version">◆</i>留存版本</span></div><p>选一格查看保存与版本。{{matrix.dates.length>7?'横滑可查看更多日期。':''}}</p></div><span class="badge">{{matrix.dates[0]?.slice(5)}} — {{matrix.dates.at(-1)?.slice(5)}}</span></div>
   <div ref="pane" class="matrix-window" :data-day-count="matrix.dates.length" @scroll.passive="remember">
    <table class="revision-grid" aria-label="章节改稿轨迹"><thead><tr><th>章节</th><th v-for="date in matrix.dates" :key="date" :class="{'column-active':date===state.chapterDay}" :title="date"><span aria-hidden="true">{{date.endsWith('-01')?date.slice(5):date.slice(8)}}</span><span class="chart-sr">{{date}}</span></th></tr></thead>
    <tbody><tr v-for="(r,ri) in matrix.rows" :key="r.chapter.id" :class="{'row-active':state.chapterPick===r.chapter.id}"><th scope="row"><button :aria-pressed="state.chapterPick===r.chapter.id" @click="select(r.chapter,null,$event)"><span>{{String(page*40+ri+1).padStart(2,'0')}}</span><strong>{{r.chapter.title}}</strong></button><small v-if="state.work==='all'">{{workName(r.chapter.work)}}</small></th>
     <td v-for="(day,i) in r.days" :key="day.date" :class="{'column-active':day.date===state.chapterDay}"><button class="revision-cell" :class="kind(day)" :data-chapter="r.chapter.id" :data-date="day.date" :data-row="ri" :data-col="i" :data-kind="kind(day)" :data-matrix-mark="day.logs.length||day.versions.length?r.chapter.id+'|'+day.date:undefined" :data-versions="day.versions.length" :style="{'--strength':.16+Math.sqrt(Math.abs(day.net)/peak)*.56}" :aria-pressed="state.chapterPick===r.chapter.id&&state.chapterDay===day.date" :title="title(r.chapter,day)" :aria-label="title(r.chapter,day)" :tabindex="tabCell(r.chapter,day)?0:-1" @keydown="move($event,ri,i)" @click="select(r.chapter,day.date,$event)"><span aria-hidden="true">{{symbols[kind(day)]}}</span><i v-if="day.versions.length" aria-hidden="true"/></button></td>
    </tr></tbody></table>
   </div>
   <details class="exact"><summary>查看有记录的精确数值</summary><div class="table-scroll"><table><thead><tr><th>章节</th><th>日期</th><th>净增</th><th>保存</th><th>版本</th></tr></thead><tbody><template v-for="r in matrix.rows" :key="r.chapter.id"><template v-for="day in r.days" :key="day.date"><tr v-if="day.logs.length||day.versions.length"><td>{{r.chapter.title}}</td><td>{{day.date}}</td><td>{{day.logs.length?sign(day.net):'—'}}</td><td>{{day.logs.length}}</td><td>{{day.versions.length}}</td></tr></template></template></tbody></table></div></details>
  </div>
  <StatsPagination v-model:page="page" :total="rows.length"/>
 </section>
 <section class="panel"><StatsSectionHead kicker="02 / VOLUME PROGRESS" title="分卷完成度" note="已完成章节 / 正式章节"/>
  <button v-for="v in vs" :key="v.id" class="bar-row" @click="patch('volume',v.id)"><span>{{v.title}}</span><span class="meter"><i :style="{width:(v.count?v.done/v.count*100:0)+'%'}"/></span><b>{{v.done}} / {{v.count}}</b></button><p v-if="!vs.length" class="muted">还没有正式章节。</p>
 </section>
 </div><slot/>
</div>
</template>
