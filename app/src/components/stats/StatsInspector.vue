<script setup>
import { computed, ref, watch } from 'vue'
import StatsTrend from './StatsTrend.vue'
import StatsRevision from './StatsRevision.vue'
import StatsPagination from './StatsPagination.vue'
import { useStatsMotion } from './use-stats-motion.js'
const props=defineProps({detail:Object,data:Object,model:Object,state:Object,workName:Function,closable:Boolean,mobile:Boolean})
const emit=defineEmits(['close','chapter','detail','chapterDay'])
const root=ref(null),page=ref(0)
useStatsMotion(root,()=>props.detail?.kind||'empty')
watch(()=>[props.detail,props.state.period,props.state.range],()=>page.value=0)
const fmt=n=>(n||0).toLocaleString('zh-CN'),sign=n=>(n>0?'+':n<0?'−':'')+fmt(Math.abs(n))
const labels={done:'已完成',revise:'待修改',draft:'草稿',planned:'待写',writing:'进行中'}
const chapter=computed(()=>props.detail?.kind==='chapter'?props.data.chapters.find(c=>c.id===props.detail.id):null)
const days=computed(()=>chapter.value?props.model.chapterCalendar(chapter.value.work,chapter.value.volume||'unassigned','all',props.state.period,props.state.range,new Set([chapter.value.id])).rows[0]?.days||[]:[])
const day=computed(()=>days.value.find(d=>d.date===props.detail.date))
const dates=computed(()=>props.model.timeline(props.state.work,props.data.end,props.state.period,props.state.range))
const dateRecords=computed(()=>props.detail?.kind==='date'?props.model.records(props.detail.work,props.detail.date,props.detail.date):[])
const logs=computed(()=>chapter.value?(day.value?day.value.logs:days.value.flatMap(d=>d.logs).reverse()):dateRecords.value.filter(r=>r.kind==='保存'))
const versions=computed(()=>chapter.value?(day.value?day.value.versions:days.value.flatMap(d=>d.versions).reverse()):dateRecords.value.filter(r=>r.kind==='版本'))
const net=computed(()=>logs.value.reduce((sum,r)=>sum+r.delta,0))
const otherRecords=computed(()=>dateRecords.value.filter(r=>r.kind==='灵感'))
const record=computed(()=>props.detail?.kind==='record'?props.model.records(props.state.work,dates.value[0]?.date||props.data.end,dates.value.at(-1)?.date||props.data.end).find(r=>r.id===props.detail.id):null)
const entity=computed(()=>props.detail?.kind==='entity'?[...props.data.outline,...props.data.lore,...props.data.people,...props.data.snippets].find(r=>r.id===props.detail.id):null)
const title=computed(()=>props.detail?.kind==='date'?props.detail.date.replaceAll('-','.'):chapter.value?.title||record.value?.title||entity.value?.title||'查看明细')
const subtitle=computed(()=>chapter.value?props.workName(chapter.value.work)+' / '+(props.data.volumes.find(v=>v.id===chapter.value.volume)?.title||'未分卷'):props.detail?.kind==='date'?props.workName(props.detail.work):'从图表或清单中选择一项。')
const netText=computed(()=>!logs.value.length?'暂无写作记录':net.value===0&&logs.value.some(r=>r.delta!==0)?'有写入 · 当日净增为零':'当日正文净增')
const detailKey=computed(()=>props.detail?[props.detail.kind,props.detail.id,props.detail.work,props.detail.date].join('|'):'empty')
const slice=items=>items.slice(page.value*20,(page.value+1)*20)
const connections=computed(()=>entity.value?props.data.relations.filter(e=>e.from===entity.value.id||e.to===entity.value.id):[])
const sourceTitle=r=>props.data.chapters.find(c=>c.id===r.chapter)?.title||'来源章节不可用'
const choose=(id,date,e)=>emit('chapter',{id,date,trigger:e.currentTarget})
const block=computed(()=>record.value?.text||entity.value?.text||'')
</script>
<template>
<div ref="root" :data-detail-motion="detailKey">
 <div class="detail-head"><div class="micro"><i/>{{detail?.kind==='date'?'DAY INSPECTOR':chapter?'CHAPTER FILE':'DETAIL INSPECTOR'}}</div><button v-if="closable" type="button" class="icon close" aria-label="关闭明细" @click="emit('close')">×</button><h2 :id="mobile?'stats-inspector-title':undefined">{{title}}</h2><p>{{subtitle}}</p></div>
 <div v-if="detail" class="detail-body chapter-inspector">
  <template v-if="chapter">
   <div class="detail-stat"><span>当前正文字数</span><b>{{fmt(chapter.words)}}<small class="unit"> 字</small></b><span class="status" :class="chapter.status"><i/>{{labels[chapter.status]||'未标记'}}</span></div>
   <div v-if="day" class="chapter-day-stat" :data-chapter-day-detail="day.date"><time>{{day.date.replaceAll('-','.')}}</time><b :class="day.net<0?'loss':'accent'">{{day.logs.length?sign(day.net)+' 字'+(!day.net&&day.active?' · 有写入':''):'无保存记录'}}</b><small>{{logs.length}} 条保存 · {{versions.length}} 个版本</small></div>
   <div v-if="state.chart==='revision'" class="chapter-trend"><h3>区间每日净增</h3><StatsTrend :days="days" :work="chapter.id" :model-value="detail.date" @select="emit('chapterDay',{id:chapter.id,date:$event})"/></div>
  </template>
  <template v-else-if="detail.kind==='date'">
   <div class="detail-stat"><span>{{netText}}</span><b :class="net<0?'loss':'accent'">{{logs.length?sign(net):'—'}}<small v-if="logs.length" class="unit"> 字</small></b><small>{{logs.length}} 条保存记录</small></div>
   <h3>涉及章节 <small>点击查看章节案卷</small></h3>
   <template v-for="r in slice(logs)" :key="r.id"><button v-if="r.chapter" class="detail-row" @click="choose(r.chapter,r.date,$event)"><span>{{sourceTitle(r)}}</span><b :class="r.delta<0?'loss':'accent'">{{sign(r.delta)}}</b></button><p v-else class="detail-row"><span>来源章节不可用</span><b :class="r.delta<0?'loss':'accent'">{{sign(r.delta)}}</b></p></template>
   <p v-if="!logs.length" class="muted">这一天没有章节保存字数日志。</p>
  </template>
  <template v-if="chapter||detail.kind==='date'">
   <h3>{{day||detail.kind==='date'?'当日':'区间'}}保留版本 <small>{{versions.length}}</small></h3>
   <template v-for="v in slice(versions)" :key="v.id"><StatsRevision v-if="chapter||data.chapters.find(c=>c.id===v.chapter)" :revision="v" :chapter="chapter||data.chapters.find(c=>c.id===v.chapter)"/></template>
   <p v-if="!versions.length" class="muted">没有留存版本。</p>
   <template v-if="chapter"><h3>{{day?'当日':'区间'}}保存记录 <small>{{logs.length}}</small></h3><div v-if="logs.length" class="save-list"><div v-for="(r,i) in slice(logs)" :key="r.id" class="detail-row"><span>{{r.date}}<template v-if="day"> · 第 {{i+page*20+1}} 条</template></span><b :class="r.delta<0?'loss':'accent'">{{sign(r.delta)}} 字</b></div></div><p v-else class="muted">无保存记录</p></template>
   <h3 v-if="otherRecords.length">新增灵感</h3><button v-for="r in slice(otherRecords)" :key="r.id" class="detail-row" @click="emit('detail',{kind:'record',id:r.id,trigger:$event.currentTarget})">{{r.title}}</button>
   <StatsPagination v-model:page="page" :total="Math.max(logs.length,versions.length,otherRecords.length)" :size="20"/>
  </template>
  <template v-else-if="record||entity">
   <blockquote v-if="block">{{block}}</blockquote>
   <template v-if="record?.kind==='版本'"><StatsRevision v-if="data.chapters.find(c=>c.id===record.chapter)" :revision="record" :chapter="data.chapters.find(c=>c.id===record.chapter)"/></template>
   <button v-if="record?.chapter" class="soft" @click="choose(record.chapter,record.date,$event)">查看章节 →</button>
   <p v-if="record?.tags" class="muted">{{record.tags.join(' · ')}}</p>
   <div v-if="entity?.events"><div v-for="e in slice(entity.events)" :key="e.id" class="detail-row"><span>{{e.title}}</span><span class="status" :class="e.status"><i/>{{labels[e.status]||'未标记'}}</span></div><StatsPagination v-model:page="page" :total="entity.events.length" :size="20"/></div>
   <div v-if="entity?.records"><ul class="tree"><li v-for="r in slice(entity.records)" :key="r.id">{{r.title}}</li></ul><StatsPagination v-model:page="page" :total="entity.records.length" :size="20"/></div>
   <template v-if="entity?.role"><h3>已有关系</h3><button v-for="r in slice(connections)" :key="r.id" class="detail-row" @click="emit('detail',{kind:'entity',id:r.from===entity.id?r.to:r.from,trigger:$event.currentTarget})"><span>{{data.people.find(p=>p.id===(r.from===entity.id?r.to:r.from))?.title}}</span><small>{{r.label}}</small></button><p v-if="!connections.length" class="muted">尚未建立关系</p><StatsPagination v-model:page="page" :total="connections.length" :size="20"/></template>
  </template>
 </div>
</div>
</template>
