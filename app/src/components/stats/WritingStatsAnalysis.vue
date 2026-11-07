<script setup>
import { computed,ref,watch } from 'vue'
import StatsTrend from './StatsTrend.vue'
import StatsSectionHead from './StatsSectionHead.vue'
import StatsMetrics from './StatsMetrics.vue'
import StatsChapterChart from './StatsChapterChart.vue'
import StatsModules from './StatsModules.vue'
import StatsBreakdown from './StatsBreakdown.vue'
import StatsPagination from './StatsPagination.vue'
import { useStatsMotion } from './use-stats-motion.js'
const props=defineProps({stats:Object,data:Object,model:Object,state:Object,choices:Array})
const emit=defineEmits(['patch','detail','chapter','day','drill'])
const root=ref(null),recordPage=ref(0),bookPage=ref(0),from=ref(''),to=ref(''),rangeError=ref('')
useStatsMotion(root,()=>props.state.tab==='overview'?props.state.mode:props.state.tab)
const fmt=n=>(n||0).toLocaleString('zh-CN'),sign=n=>(n>0?'+':n<0?'−':'')+fmt(Math.abs(n))
const workName=id=>props.choices.find(w=>w.id===id)?.label||'全部作品'
const days=computed(()=>props.model.timeline(props.state.work,props.data.end,props.state.period,props.state.range))
const whole=computed(()=>props.model.timeline(props.state.work,props.data.end,props.state.period))
const notable=computed(()=>props.model.records(props.state.work,days.value[0].date,days.value.at(-1).date).filter(r=>r.kind!=='保存'))
const pair=computed(()=>props.state.pair.filter((id,i,a)=>props.data.works.some(w=>w.id===id)&&a.indexOf(id)===i).slice(0,2))
const port=computed(()=>props.model.portfolio(pair.value,props.data.end,props.state.period,props.state.range))
const weekGroups=computed(()=>{
 const first=(new Date(days.value[0].date+'T00:00:00Z').getUTCDay()+6)%7,cells=[...Array(first).fill(null),...days.value]
 return Array.from({length:Math.ceil(cells.length/7)},(_,i)=>cells.slice(i*7,i*7+7))
})
const metrics=computed(()=>[{label:'区间累计净增',value:days.value.some(d=>d.logs.length)?sign(days.value.at(-1).cumulative):'—',unit:'字',accent:true,negative:days.value.at(-1).cumulative<0},{label:'活跃日期',value:days.value.filter(d=>d.active).length,unit:'天'},{label:'当前正文存量',value:fmt(props.model.inventory(props.state.work).words),unit:'字',key:'words'}])
watch(()=>[props.state.period,props.state.range,props.data.end],()=>{from.value=days.value[0].date;to.value=days.value.at(-1).date;rangeError.value='';recordPage.value=0},{immediate:true})
const pickDate=(date,e,work=props.state.work)=>emit('detail',{kind:'date',date,work,trigger:e?.currentTarget})
const dateText=d=>!d.logs.length?'无保存记录':sign(d.net)+' 字'+(!d.net&&d.active?' · 有写入':'')
function submit(){if(from.value>to.value){rangeError.value='起始日期不能晚于结束日期。';return}emit('patch',{range:[from.value,to.value]});rangeError.value=''}
function choosePair(i,value){const p=props.state.pair.slice();if(p[1-i]===value)p[1-i]=p[i];p[i]=value;emit('patch',{pair:p,detail:null})}
</script>
<template>
<div ref="root">
<template v-if="state.tab==='overview'">
<div v-if="state.mode==='journey'" class="journey-grid" id="stats-view-overview">
 <div class="main-stack">
 <section class="panel canvas">
  <StatsSectionHead kicker="01 / WRITING TRACE" title="写作轨迹" :note="'每日保存字数差 · '+days[0].date.replaceAll('-','.')+' — '+days.at(-1).date.replaceAll('-','.')"><span class="badge current">{{state.range?'自选区间':'近 '+state.period+' 日'}}</span></StatsSectionHead>
  <StatsMetrics :items="metrics"/>
  <StatsTrend :days="days" cumulative brush :work="state.work" :model-value="state.detail?.date||state.date" @select="pickDate($event)" @range="emit('patch',{range:$event})"/>
  <div class="plot-foot"><div class="legend"><span><i class="up"/>净增</span><span><i class="down"/>净减</span><span><i class="zero"/>净零</span></div><span>拖选区间，或选择起止日期</span></div>
  <section class="calendar-strip" aria-label="活跃日历"><div class="calendar-title"><h3>活跃日历</h3><span>选中 {{(state.detail?.date||state.date).slice(5).replace('-','/')}}</span><div class="legend"><span><i class="zero"/>有写入、净零</span><span><i class="missing"/>无记录</span></div></div>
  <div class="heat-scroll"><div class="heat" :style="{'--weeks':weekGroups.length}"><div v-for="(week,i) in weekGroups" :key="i" class="heat-week"><span>{{week.find(Boolean)?.date.slice(5)}} 起</span><div><template v-for="(day,j) in week" :key="day?.date||j"><button v-if="day" class="heat-cell" :class="!day.logs.length?'missing':!day.net?'zero':day.net<0?'down':day.net>850?'strong':'up'" :data-date="day.date" :aria-label="day.date+'，'+dateText(day)" :title="day.date+'，'+dateText(day)" :aria-pressed="day.date===(state.detail?.date||state.date)" @click="pickDate(day.date,$event)">{{Number(day.date.slice(8))}}</button><span v-else/></template></div></div></div></div>
  </section>
  <form class="range-form" aria-label="自选日期区间" @submit.prevent="submit"><label>起始<input v-model="from" type="date" name="from" aria-label="起始日期" :min="whole[0].date" :max="data.end" required></label><label>结束<input v-model="to" type="date" name="to" aria-label="结束日期" :min="whole[0].date" :max="data.end" required></label><button class="soft" type="submit">应用</button><button v-if="state.range" class="soft" type="button" @click="emit('patch',{range:null})">清除区间</button><span class="range-error" role="status">{{rangeError}}</span></form>
  <details class="exact"><summary>查看逐日数值</summary><div class="table-scroll"><table><thead><tr><th>日期</th><th>保存条数</th><th>正文净增</th><th>区间累计净增</th></tr></thead><tbody><tr v-for="d in days.slice().reverse()" :key="d.date"><td>{{d.date}}</td><td>{{d.logs.length}}</td><td>{{d.logs.length?sign(d.net):'—'}}</td><td>{{sign(d.cumulative)}}</td></tr></tbody></table></div></details>
 </section>
 <section class="panel"><StatsSectionHead kicker="02 / DOCUMENTED MOMENTS" title="版本与灵感" note="仅展示此区间内有日期的记录"/><div class="ledger"><button v-for="r in notable.slice(recordPage*30,(recordPage+1)*30)" :key="r.id" class="ledger-row" @click="emit('detail',{kind:'record',id:r.id,trigger:$event.currentTarget})"><time>{{r.date.slice(5)}}</time><span class="record-kind">{{r.kind}}</span><strong>{{r.title}}</strong><span class="record-amount">{{r.kind==='版本'?'留存版本':r.tags.join(' / ')}}</span></button></div><p v-if="!notable.length" class="empty">暂无相关记录</p><StatsPagination v-model:page="recordPage" :total="notable.length" :size="30"/></section>
 </div><slot/>
</div>
<div v-else class="atlas-layout" :class="{'has-inspector':state.detail}" id="stats-view-overview">
 <div class="main-stack">
 <section class="panel compare-panel">
  <StatsSectionHead kicker="01 / SIDE BY SIDE" title="两部作品的写作走势" note="每日正文净增 · 两图共用日期与刻度"><div class="comparison-range"><span class="badge">{{days[0].date}} — {{days.at(-1).date}}</span><button v-if="state.range" class="soft" @click="emit('patch',{range:null})">清除区间</button></div></StatsSectionHead>
  <div class="compare-plots">
   <article v-for="(item,i) in port.rows" :key="item.work"><div class="compare-plot-head"><label><span>对照 {{i+1}}</span><select :aria-label="'对照作品 '+(i+1)" :value="item.work" @change="choosePair(i,$event.target.value)"><option v-for="w in data.works" :key="w.id" :value="w.id">{{workName(w.id)}}</option></select></label><button class="soft" :data-drill-work="item.work" @click="emit('drill',{work:item.work,trigger:$event.currentTarget})">深入 →</button></div>
   <div class="compare-net"><b :class="item.days.at(-1).cumulative<0?'loss':'accent'">{{item.days.some(d=>d.logs.length)?sign(item.days.at(-1).cumulative):'—'}}</b><small>字 · 区间净增 · {{item.days.filter(d=>d.active).length}} 活跃日</small></div>
   <StatsTrend :days="item.days" :scale="port" :work="item.work" :model-value="state.detail?.work===item.work?state.detail.date:null" @select="pickDate($event,null,item.work)"/>
   <details class="exact"><summary>查看逐日数值</summary><div class="table-scroll"><table><thead><tr><th>日期</th><th>净增</th><th>保存</th></tr></thead><tbody><tr v-for="d in item.days.slice().reverse()" :key="d.date"><td>{{d.date}}</td><td>{{d.logs.length?sign(d.net):'—'}}</td><td>{{d.logs.length}}</td></tr></tbody></table></div></details>
   </article>
  </div><p v-if="pair.length<2" class="muted">{{data.works.length?'书库里只有一部作品，可先查看它的创作历程。':'书库里还没有作品。创建作品后，写作数据会显示在这里。'}}</p>
 </section>
 <section class="panel library"><StatsSectionHead kicker="02 / LIBRARY" title="作品索引" note="当前存量 · 点击作品深入"><span class="badge">{{data.works.length}} 部</span></StatsSectionHead><div class="atlas-books stats-bars"><button v-for="(w,i) in data.works.slice(bookPage*12,(bookPage+1)*12)" :key="w.id" class="book-tile" :data-work="w.id" @click="emit('drill',{work:w.id,trigger:$event.currentTarget})"><div class="book-top"><span class="cover" :style="{'--cover':w.color}">{{w.mark}}</span><div><small>{{String(i+bookPage*12+1).padStart(2,'0')}} / {{w.genre}}</small><strong>{{workName(w.id)}}</strong></div><span>→</span></div><div class="book-total"><b>{{fmt(model.inventory(w.id).words)}}</b> 字 <span>{{model.inventory(w.id).chapters.length}} 章</span></div><div class="book-completion"><i v-for="status in ['done','revise','draft']" :key="status" :class="status" :style="{flex:model.chapters(w.id,'all',status).length}"/></div><small>已完成 {{model.inventory(w.id).done}} / {{model.inventory(w.id).chapters.length}}</small></button></div><StatsPagination v-model:page="bookPage" :total="data.works.length" :size="12"/></section>
 <section class="panel"><StatsSectionHead kicker="03 / VOLUME SCALE" title="分卷规模" note="按当前正式章节字数比较"/><StatsBreakdown :rows="model.volumes('all').map(v=>({id:v.id,label:workName(v.work)+' · '+v.title,value:v.words}))" unit="字" selectable @select="emit('patch',{tab:'manuscript',chart:'structure',volume:$event,status:'all',chapterPick:null,chapterDay:null,detail:null})"/></section>
 </div><slot v-if="state.detail"/>
</div>
</template>
<StatsChapterChart v-else-if="state.tab==='manuscript'" :model="model" :data="data" :state="state" :work-name="workName" @patch="emit('patch',$event)" @chapter="emit('chapter',$event)" @day="emit('day',$event)"><slot/></StatsChapterChart>
<StatsModules v-else :stats="stats" :data="data" :state="state" :work-name="workName" @select="emit('detail',$event)"><slot/></StatsModules>
</div>
</template>
