<script setup>
import { computed, ref } from 'vue'
import { fmtNum } from '../../services/wordcount.js'
const props=defineProps({days:{type:Array,default:()=>[]},compact:Boolean,cumulative:Boolean,modelValue:String,work:String,scale:Object,brush:Boolean,readout:Boolean})
const emit=defineEmits(['update:modelValue','select','range'])
const own=ref(null), plot=ref(null), drag=ref(null)
const selected=computed(()=>props.modelValue!==undefined?props.modelValue:own.value)
const fmt=n=>fmtNum(n), sign=n=>(n>0?'+':n<0?'−':'')+fmt(Math.abs(n))
const has=d=>d.logs?d.logs.length>0:d.active
const detail=d=>!has(d)?'无保存记录':sign(d.net)+' 字'+(!d.net&&d.active?' · 有写入':'')
const n=computed(()=>Math.max(1,props.days.length)), slot=computed(()=>720/n.value)
const H=computed(()=>props.cumulative?238:105), T=computed(()=>props.cumulative?120:6), B=computed(()=>H.value-15)
const bounds=computed(()=>{
 const max=props.scale?.max??Math.max(0,...props.days.map(d=>d.net)),min=props.scale?.min??Math.min(0,...props.days.map(d=>d.net))
 const step=max-min>2200?1000:max-min>800?500:max-min>150?100:10
 return [min?Math.floor(min/step)*step:0,max?Math.ceil(max/step)*step:step]
})
const y=v=>B.value-(v-bounds.value[0])/(bounds.value[1]-bounds.value[0])*(B.value-T.value)
const zero=computed(()=>y(0))
const cap=computed(()=>Math.max(1,...props.days.map(d=>d.cumulative||0))),floor=computed(()=>Math.min(0,...props.days.map(d=>d.cumulative||0)))
const cy=v=>96-(v-floor.value)/(cap.value-floor.value)*83
const path=computed(()=>props.days.map((d,i)=>(i?'L':'M')+' '+((i+.5)*slot.value)+' '+cy(d.cumulative||0)).join(' '))
const area=computed(()=>path.value+' L '+((n.value-.5)*slot.value)+' '+cy(0)+' L '+(.5*slot.value)+' '+cy(0)+' Z')
const index=computed(()=>props.days.findIndex(d=>d.date===selected.value))
const current=computed(()=>props.days[index.value])
const ticks=computed(()=>[0,Math.round((n.value-1)/3),Math.round((n.value-1)*2/3),n.value-1].filter((v,i,a)=>a.indexOf(v)===i))
let mute=0
function pick(d,e){if(performance.now()<mute&&e?.detail)return;own.value=d.date;emit('update:modelValue',d.date);emit('select',d.date)}
function key(e,i){
 if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return
 e.preventDefault();const j=e.key==='Home'?0:e.key==='End'?n.value-1:Math.max(0,Math.min(n.value-1,i+(e.key==='ArrowLeft'?-1:1)))
 const buttons=e.currentTarget.parentElement.children
 Array.from(buttons).forEach((b,k)=>b.tabIndex=k===j?0:-1);buttons[j]?.focus()
}
const at=x=>{const b=plot.value.getBoundingClientRect();return Math.max(0,Math.min(n.value-1,Math.floor((x-b.left)/b.width*n.value)))}
function down(e){if(!props.brush||e.button!==0)return;drag.value={id:e.pointerId,x:e.clientX,first:at(e.clientX),last:at(e.clientX),moved:false}}
function move(e){const d=drag.value;if(!d||d.id!==e.pointerId||Math.abs(e.clientX-d.x)<7&&!d.moved)return;d.moved=true;plot.value.setPointerCapture(e.pointerId);d.last=at(e.clientX)}
function up(e){const d=drag.value;drag.value=null;if(!d||d.id!==e.pointerId||!d.moved)return;mute=performance.now()+220;emit('range',[props.days[Math.min(d.first,d.last)].date,props.days[Math.max(d.first,d.last)].date])}
</script>
<template>
 <div v-if="days.some(has)" class="plot-wrap stats-trend" :class="cumulative?'full':compact?'quick':'mini'" :data-plot-motion="(cumulative?'full':compact?'quick':'mini')+':'+(work||'')">
  <div v-if="cumulative" class="plot-label"><i/>区间累计净增 <b>{{sign(days.at(-1)?.cumulative||0)}} 字</b></div>
  <div class="plot-frame">
   <div class="plot-axis" aria-hidden="true"><template v-if="cumulative"><span style="top:6%">{{sign(cap)}}</span><span style="top:39%">{{sign(floor)}}</span></template><span :style="{top:T/H*100+'%'}">{{sign(bounds[1])}}</span><span v-if="bounds[0]<0" :style="{top:zero/H*100+'%'}">0</span><span :style="{top:B/H*100+'%'}">{{sign(bounds[0])}}</span></div>
   <div ref="plot" class="plot-core" :style="{'--days':n}" @pointerdown="down" @pointermove="move" @pointerup="up" @pointercancel="drag=null">
    <svg :viewBox="'0 0 720 '+H" preserveAspectRatio="none" aria-hidden="true">
     <template v-if="cumulative"><path class="plot-area" :d="area" fill="var(--area)"/><path class="plot-curve" :d="path" fill="none" stroke="var(--mint)" stroke-width="1.8" vector-effect="non-scaling-stroke"/><line class="grid-line" x1="0" x2="720" y1="105" y2="105"/></template>
     <line v-for="t in [T,(T+B)/2,B]" :key="t" class="grid-line" x1="0" x2="720" :y1="t" :y2="t"/>
     <line class="zero-line" x1="0" x2="720" :y1="zero" :y2="zero"/>
     <g v-if="index>=0" class="plot-cursor" :data-cursor-x="(index+.5)*slot"><rect class="plot-selected" :x="index*slot" y="0" :width="slot" :height="H"/><line class="plot-cross" :x1="(index+.5)*slot" :x2="(index+.5)*slot" y1="0" :y2="H"/><circle v-if="cumulative" :cx="(index+.5)*slot" :cy="cy(current.cumulative||0)" r="3.5" fill="var(--mint)"/></g>
     <template v-for="(d,i) in days" :key="d.date"><rect v-if="has(d)" rx="2" :data-date-bar="d.date" :data-zero="zero" :class="d.net<0?'neg':d.net?'pos':'flat'" :x="(i+.5)*slot-Math.max(1,Math.min(slot*.62,34))/2" :y="d.net?Math.min(y(d.net),zero):zero-1.8" :width="Math.max(1,Math.min(slot*.62,34))" :height="Math.max(2,Math.abs(y(d.net)-zero))"/></template>
    </svg>
    <div class="plot-hits stats-trend-plot" role="group" aria-label="每日正文净增，方向键移动，Enter 查看"><button v-for="(d,i) in days" :key="d.date" class="stats-day" type="button" :aria-label="d.date+'，'+detail(d)" :title="d.date+'，'+detail(d)" :aria-pressed="d.date===selected" :tabindex="i===(index>=0?index:days.length-1)?0:-1" @keydown="key($event,i)" @click="pick(d,$event)"/></div>
    <div v-if="drag?.moved" class="brush-mark" :style="{left:Math.min(drag.first,drag.last)/n*100+'%',width:(Math.abs(drag.last-drag.first)+1)/n*100+'%'}"/>
   </div>
  </div>
  <div class="plot-ticks"><span v-for="i in ticks" :key="i" :style="{left:(n===1?50:i/(n-1)*100)+'%'}">{{days[i]?.date.slice(5).replace('-','/')}}</span></div>
  <p v-if="readout&&current" class="quick-day">{{current.date}} · {{detail(current)}} <small>{{current.logs?.length||0}} 条保存</small></p>
 </div>
 <div v-else class="plot-empty"><span>◌</span><strong>暂无写作记录</strong><small>此范围还没有正式章节的保存字数日志。</small></div>
</template>
