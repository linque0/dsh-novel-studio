<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, provide, ref, shallowRef, watch } from 'vue'
import { useUiStore } from '../../stores/ui'
import { useWorkStore } from '../../stores/work'
import OIcon from '../OIcon.vue'
import OutlineSidebar from '../OutlineSidebar.vue'
import { OUTLINE_LAYOUT_KEY, normalizeOutlineWidth, outlineLayout } from './outline-layout.js'

const ui=useUiStore(),work=useWorkStore()
const root=ref(null),detailTarget=ref(null),width=ref(0),activeDrawer=ref(null),actions=shallowRef(null)
const hasDetails=computed(()=>work.outlineView==='canvas')
const layout=computed(()=>outlineLayout({width:width.value,leftWidth:ui.outlineLeftWidth,rightWidth:ui.outlineRightWidth,leftOpen:ui.outlineSideOpen,rightOpen:hasDetails.value&&ui.outlineDetailOpen}))
const narrow=computed(()=>layout.value.narrow)
const leftVisible=computed(()=>narrow.value?activeDrawer.value==='left':ui.outlineSideOpen)
const rightVisible=computed(()=>hasDetails.value&&(narrow.value?activeDrawer.value==='right':ui.outlineDetailOpen))
const selected=computed(()=>work.liveOlnodes().some(n=>n.id===work.selOlnodeId))
const panelWidth=side=>narrow.value?Math.min(Math.max(side==='left'?260:320,ui[side==='left'?'outlineLeftWidth':'outlineRightWidth']),Math.max(0,width.value-32)):layout.value[side]
let returnFocus=null
function open(side){if(narrow.value){if(!activeDrawer.value)returnFocus=document.activeElement;activeDrawer.value=side}else ui.setPref(side==='left'?'outlineSideOpen':'outlineDetailOpen',true)}
function close(side){if(narrow.value)activeDrawer.value=null;else ui.setPref(side==='left'?'outlineSideOpen':'outlineDetailOpen',false)}
provide(OUTLINE_LAYOUT_KEY,{detailTarget,narrow,open,close,actions,toggle:side=>(side==='left'?leftVisible.value:rightVisible.value)?close(side):open(side)})
function reset(side){ui.setPref(side==='left'?'outlineLeftWidth':'outlineRightWidth',side==='left'?220:318)}
function keyboard(side,e){
  if(!['ArrowLeft','ArrowRight','Home'].includes(e.key))return
  e.preventDefault();e.stopPropagation()
  if(e.key==='Home')return reset(side)
  const key=side==='left'?'outlineLeftWidth':'outlineRightWidth'
  const delta=(e.key==='ArrowRight'?1:-1)*(side==='left'?1:-1)*(e.shiftKey?40:10)
  ui.setPref(key,normalizeOutlineWidth(side,layout.value[side]+delta))
}
let cleanupDrag=null,observer=null
function startResize(side,e){
  if(narrow.value||e.button!==0)return
  e.preventDefault();e.stopPropagation();cleanupDrag?.(true)
  const key=side==='left'?'outlineLeftWidth':'outlineRightWidth',startX=e.clientX,startWidth=layout.value[side],remembered=ui[key]
  const previousSelect=document.body.style.userSelect,previousCursor=document.body.style.cursor
  document.body.style.userSelect='none';document.body.style.cursor='col-resize'
  root.value.classList.add('is-resizing')
  function move(ev){
    if(ev.pointerId!==e.pointerId)return
    const other=side==='left'?layout.value.right:layout.value.left
    const otherOpen=side==='left'?(hasDetails.value&&ui.outlineDetailOpen):ui.outlineSideOpen
    const maximum=width.value-56-480-16-(otherOpen?other+16:40)
    ui[key]=normalizeOutlineWidth(side,Math.min(maximum,startWidth+(ev.clientX-startX)*(side==='left'?1:-1)))
  }
  function finish(cancel=false){
    window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up);window.removeEventListener('pointercancel',cancelled);window.removeEventListener('blur',up)
    document.body.style.userSelect=previousSelect;document.body.style.cursor=previousCursor;root.value?.classList.remove('is-resizing');cleanupDrag=null
    if(cancel)ui[key]=remembered;else ui.setPref(key,ui[key])
  }
  const up=()=>finish(false),cancelled=()=>finish(true)
  cleanupDrag=finish
  window.addEventListener('pointermove',move);window.addEventListener('pointerup',up);window.addEventListener('pointercancel',cancelled);window.addEventListener('blur',up)
}
function drawerControls(){return [...(root.value?.querySelectorAll(`.ow-${activeDrawer.value} button,.ow-${activeDrawer.value} input,.ow-${activeDrawer.value} textarea,.ow-${activeDrawer.value} select,[role="dialog"] [tabindex="0"]`)||[])].filter(el=>!el.disabled&&el.getClientRects().length)}
function escape(e){
  if(ui.statsOpen||!activeDrawer.value)return
  if(e.key==='Escape'){e.preventDefault();e.stopPropagation();activeDrawer.value=null}
  if(e.key==='Tab'){
    const controls=drawerControls(),first=controls[0],last=controls.at(-1)
    if(!first){e.preventDefault();return}
    if(e.shiftKey&&(document.activeElement===first||!controls.includes(document.activeElement))){e.preventDefault();last.focus()}
    else if(!e.shiftKey&&(document.activeElement===last||!controls.includes(document.activeElement))){e.preventDefault();first.focus()}
  }
}
watch(activeDrawer,async(side,previous)=>{await nextTick();if(side)drawerControls()[0]?.focus();else if(previous&&returnFocus?.isConnected&&returnFocus.getClientRects().length)returnFocus.focus()})
watch(narrow,()=>{cleanupDrag?.(true);activeDrawer.value=null})
watch(hasDetails,()=>{activeDrawer.value=null})
onMounted(()=>{width.value=root.value.clientWidth;observer=new ResizeObserver(entries=>{width.value=root.value.clientWidth});observer.observe(root.value);window.addEventListener('keydown',escape,true)})
onBeforeUnmount(()=>{cleanupDrag?.(true);observer?.disconnect();window.removeEventListener('keydown',escape,true)})
</script>

<template>
  <div ref="root" class="ow-workspace" :class="{'is-narrow':narrow}" :data-layout="narrow?'drawer':'docked'">
    <div v-if="narrow" class="ow-mobile-controls"><button type="button" @click="open('left')"><OIcon name="rows" :size="14"/> 故事结构</button><span>{{work.work?.title}}</span><button v-if="hasDetails" type="button" @click="open('right')">详情 <OIcon name="caret-left" :size="12"/></button></div>
    <button v-if="narrow&&activeDrawer" class="ow-scrim" type="button" aria-label="关闭侧栏" @click="activeDrawer=null"></button>
    <aside v-show="leftVisible" class="ow-left" :style="{width:panelWidth('left')+'px'}" :role="narrow?'dialog':undefined" :aria-modal="narrow?'true':undefined" aria-label="故事结构"><OutlineSidebar/></aside>
    <div v-if="!narrow&&leftVisible" class="ow-resizer ow-left-resizer" role="separator" tabindex="0" aria-label="调整故事结构宽度" aria-orientation="vertical" :aria-valuenow="layout.left" aria-valuemin="180" aria-valuemax="420" title="拖动调宽，双击复位" @pointerdown="startResize('left',$event)" @dblclick.prevent="reset('left')" @keydown="keyboard('left',$event)"></div>
    <button v-if="!narrow&&!leftVisible" class="ow-rail ow-left-rail" type="button" aria-label="展开故事结构" @click="open('left')"><OIcon name="rows" :size="17"/><span>故事结构</span><small>{{work.liveOlnodes().length}}</small><OIcon name="caret-right" :size="12"/></button>
    <section class="ow-main"><slot/></section>
    <div v-if="!narrow&&rightVisible" class="ow-resizer ow-right-resizer" role="separator" tabindex="0" aria-label="调整详情宽度" aria-orientation="vertical" :aria-valuenow="layout.right" aria-valuemin="260" aria-valuemax="480" title="拖动调宽，双击复位" @pointerdown="startResize('right',$event)" @dblclick.prevent="reset('right')" @keydown="keyboard('right',$event)"></div>
    <aside v-show="rightVisible" class="ow-right" :style="{width:panelWidth('right')+'px'}" :role="narrow?'dialog':undefined" :aria-modal="narrow?'true':undefined" aria-label="节点详情">
      <div v-if="!selected" class="ow-detail-empty"><header>节点详情<button type="button" aria-label="收起详情" @click="close('right')"><OIcon name="close" :size="14"/></button></header><div><OIcon name="diamond" :size="28"/><h2>让情节逐渐清晰</h2><p>选择一个事件、便签或容器，<br>在这里编辑内容与故事关系。</p></div></div>
      <div ref="detailTarget" class="ow-detail-target"></div>
    </aside>
    <button v-if="!narrow&&hasDetails&&!rightVisible" class="ow-rail ow-right-rail" type="button" aria-label="展开详情" @click="open('right')"><OIcon name="edit" :size="17"/><span>详情</span><OIcon name="caret-left" :size="12"/></button>
  </div>
</template>
