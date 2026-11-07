<script setup>
import { computed,ref,watch } from 'vue'
import StatsSectionHead from './StatsSectionHead.vue'
import StatsMetrics from './StatsMetrics.vue'
import StatsBreakdown from './StatsBreakdown.vue'
import StatsPagination from './StatsPagination.vue'
import { useStatsMotion } from './use-stats-motion.js'
const props=defineProps({data:Object,stats:Object,state:Object,workName:Function})
const emit=defineEmits(['select'])
const root=ref(null),page=ref(0),tag=ref(null),networkPage=ref(0)
useStatsMotion(root,()=>props.state.tab)
watch(()=>[props.state.work,props.state.tab],()=>{page.value=0;tag.value=null;networkPage.value=0})
watch(()=>[props.state.period,props.state.range],()=>page.value=0)
const labels={planned:'待写',writing:'进行中',done:'已完成',revise:'待修改'}
const names={outline:['STORY STRUCTURE','大纲事件','按故事容器查看各状态的事件数'],lore:['WORLD INDEX','设定分支','点击根分支，查看其节点目录'],characters:['CAST & CONNECTIONS','人物与关系','仅列出已建立的关系'],snippets:['IDEA ARCHIVE','灵感档案','标签分布为当前存量，最近新增随所选日期变化']}
const info=computed(()=>names[props.state.tab]||names.snippets)
const events=computed(()=>[...new Map(props.data.outline.flatMap(g=>g.events).map(e=>[e.id,e])).values()])
const tags=computed(()=>[...new Set(props.data.snippets.flatMap(r=>r.tags))].map(t=>({id:t,label:t,value:props.data.snippets.filter(r=>r.tags.includes(t)).length})))
const start=computed(()=>props.state.range?.[0]||props.data.day(props.data.end,1-props.state.period)),end=computed(()=>props.state.range?.[1]||props.data.end)
const recent=computed(()=>props.data.snippets.filter(r=>r.date&&r.date>=start.value&&r.date<=end.value&&(!tag.value||r.tags.includes(tag.value))).sort((a,b)=>b.createdAt-a.createdAt))
const roles=computed(()=>[...new Set(props.data.people.map(p=>p.role))])
const connected=computed(()=>new Set(props.data.relations.flatMap(r=>[r.from,r.to])))
const networkPeople=computed(()=>props.data.people.slice(networkPage.value*24,(networkPage.value+1)*24))
const workGroups=computed(()=>[...new Set(networkPeople.value.map(p=>p.work))].map(work=>{
 const people=networkPeople.value.filter(p=>p.work===work),ids=new Set(people.map(p=>p.id)),edges=props.data.relations.filter(r=>ids.has(r.from)&&ids.has(r.to))
 return {work,people:people.map((p,i)=>({...p,x:people.length<=4?[22,71,22,71][i]:i%2?73:23,y:people.length<=4?[25,25,76,76][i]:(Math.floor(i/2)+.5)/Math.ceil(people.length/2)*100})),edges}
}))
const metrics=computed(()=>{
 const d=props.data
 switch(props.state.tab){
 case 'outline':return [{label:'事件总数',value:events.value.length,unit:'件',accent:true},{label:'已完成',value:events.value.filter(e=>e.status==='done').length,unit:'件'}]
 case 'lore':return [{label:'根分支',value:d.lore.length,unit:'个',accent:true},{label:'设定节点',value:d.lore.reduce((s,r)=>s+r.records.length,0),unit:'个'},{label:'带标签节点',value:d.lore.flatMap(r=>r.records).filter(r=>r.tags.length).length,unit:'个'},{label:'手工关系',value:d.lorelinks.length,unit:'条'}]
 case 'characters':return [{label:'人物',value:d.people.length,unit:'位',accent:true},{label:'关系',value:d.relations.length,unit:'条'},{label:'未建立关系',value:d.people.filter(p=>!connected.value.has(p.id)).length,unit:'位'}]
 default:return [{label:'当前灵感',value:d.snippets.length,unit:'条',accent:true},{label:'已标记',value:d.snippets.filter(r=>r.tags.length).length+' / '+d.snippets.length,unit:'条'}]
 }
})
const pick=(kind,id,e)=>emit('select',{kind,id,trigger:e?.currentTarget})
const pageRows=rows=>rows.slice(page.value*30,(page.value+1)*30)
const position=(g,id)=>g.people.find(p=>p.id===id)
const edgeState=e=>props.state.detail?.kind!=='entity'?'rest':e.from===props.state.detail.id||e.to===props.state.detail.id?'active':'muted'
</script>
<template>
<div ref="root" class="module-grid" :id="'stats-view-'+state.tab">
<section class="panel">
 <StatsSectionHead :kicker="info[0]" :title="info[1]" :note="info[2]"/>
 <StatsMetrics :items="metrics"/>
 <template v-if="state.tab==='outline'">
  <div class="legend"><span v-for="(label,k) in labels" :key="k"><i :class="k"/>{{label}}</span></div>
  <button v-for="g in pageRows(data.outline)" :key="g.id" class="bar-row" @click="pick('entity',g.id,$event)"><span>{{g.title}}<small v-if="state.work==='all'">{{workName(g.work)}}</small></span><span class="status-band"><i v-for="(label,k) in labels" :key="k" :class="k" :style="{flex:g.events.filter(e=>e.status===k).length}"/></span><b>{{g.events.filter(e=>e.status==='done').length}} / {{g.events.length}}</b></button>
  <p v-if="!data.outline.length" class="empty">暂无大纲事件</p><StatsPagination v-model:page="page" :total="data.outline.length" :size="30"/>
 </template>
 <template v-else-if="state.tab==='lore'">
  <StatsBreakdown :rows="data.lore.map(g=>({id:g.id,label:g.title,value:g.records.length,work:state.work==='all'?workName(g.work):null}))" unit="节点" selectable empty="还没有设定节点" @select="pick('entity',$event)"/>
 </template>
 <template v-else-if="state.tab==='characters'">
  <div class="role-grid"><div v-for="role in roles" :key="role"><div class="micro">{{role}} · {{data.people.filter(p=>p.role===role).length}}</div><button v-for="p in data.people.filter(p=>p.role===role).slice(0,8)" :key="p.id" class="person-chip" @click="pick('entity',p.id,$event)">{{p.title}}</button></div></div>
  <h3>人物关系图</h3><div class="network">
   <section v-for="g in workGroups" :key="g.work"><span class="micro">{{workName(g.work)}}</span><div class="network-map" :style="g.people.length>4?{height:Math.max(180,Math.ceil(g.people.length/2)*68)+'px'}:null"><svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><line v-for="e in g.edges" :key="e.id" :data-edge-motion="e.id" :data-edge-state="edgeState(e)" :x1="position(g,e.from).x" :x2="position(g,e.to).x" :y1="position(g,e.from).y" :y2="position(g,e.to).y"/></svg><button v-for="p in g.people" :key="p.id" class="network-node" :style="{left:p.x+'%',top:p.y+'%'}" :aria-pressed="state.detail?.id===p.id" @click="pick('entity',p.id,$event)"><b>{{p.title}}</b><small>{{p.role}}</small></button></div></section>
  </div><p v-if="data.people.length>24" class="muted">每页显示 24 位人物及页内关系；选择人物可查看其全部关系。</p><StatsPagination v-model:page="networkPage" :total="data.people.length" :size="24"/>
  <p v-if="!data.people.length" class="empty">暂无人物</p>
  <details class="exact"><summary>查看全部人物与关系明细</summary><div class="edges"><div v-for="p in pageRows(data.people)" :key="p.id"><button @click="pick('entity',p.id,$event)">{{p.title}}</button><small>{{p.role}} · {{data.relations.filter(e=>e.from===p.id||e.to===p.id).length}} 条关系</small></div></div><StatsPagination v-model:page="page" :total="data.people.length" :size="30"/></details>
 </template>
 <template v-else>
  <StatsBreakdown :rows="tags" unit="条" selectable empty="还没有带标签的灵感" @select="tag=tag===$event?null:$event;page=0"/>
  <div class="split-title"><h3>最近新增</h3><button v-if="tag" class="soft" @click="tag=null">{{tag}} ×</button></div>
  <div class="ledger"><button v-for="r in pageRows(recent)" :key="r.id" class="ledger-row" @click="pick('entity',r.id,$event)"><time>{{r.date.slice(5)}}</time><span class="record-kind">灵感</span><strong>{{r.title}}</strong><span class="record-amount">{{r.tags.join(' / ')}}</span></button></div><p v-if="!recent.length" class="empty">此区间暂无带创建日期的新增灵感</p><StatsPagination v-model:page="page" :total="recent.length" :size="30"/>
 </template>
</section><slot/>
</div>
</template>
