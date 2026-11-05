<script setup>
import {ref,watch,nextTick,onMounted,onBeforeUnmount} from 'vue'

const props=defineProps({value:{type:String,default:''},chapterId:{type:String,required:true},workId:{type:String,required:true},readonly:Boolean,layoutKey:{type:String,default:''}})
const emit=defineEmits(['commit'])
const field=ref(null),text=ref(props.value)
// A delayed native event must stay attached to the chapter that mounted it.
const origin={workId:props.workId,chapterId:props.chapterId}
let composing=false,disposed=false,queued=false,observer,lastWidth=-1,lastSent=props.value
const singleLine=value=>String(value||'').replace(/[\r\n]+/g,' ')
function resize(){
  const el=field.value
  if(disposed||!el||!el.getBoundingClientRect().width)return
  const style=getComputedStyle(el),borders=parseFloat(style.borderTopWidth)+parseFloat(style.borderBottomWidth)
  el.style.height='0px'
  el.style.height=Math.ceil(el.scrollHeight+borders)+'px'
}
function scheduleResize(){if(disposed||queued)return;queued=true;nextTick(()=>{queued=false;resize()})}
async function fontLayout(){await nextTick();resize();await document.fonts.ready;scheduleResize()}
watch(()=>props.value,value=>{
  if(document.activeElement!==field.value||text.value===lastSent){text.value=value;lastSent=value}
  scheduleResize()
})
watch(()=>props.readonly,value=>{if(value){text.value=props.value;lastSent=props.value;scheduleResize()}})
watch(()=>props.layoutKey,fontLayout)
watch(text,scheduleResize)
function input(event){
  if(composing){scheduleResize();return}
  const el=event.target,value=singleLine(el.value),caret=singleLine(el.value.slice(0,el.selectionStart)).length
  if(value!==el.value){el.value=value;el.setSelectionRange(caret,caret)}
  text.value=value;scheduleResize()
}
function commit(){
  if(props.readonly||composing)return
  const title=singleLine(field.value?.value??text.value).trim()||'未命名章节'
  text.value=title
  if(title!==lastSent){lastSent=title;emit('commit',{...origin,title})}
  scheduleResize()
}
function keydown(event){
  if(event.key!=='Enter'||event.isComposing||event.keyCode===229||composing)return
  event.preventDefault();commit();event.currentTarget.blur()
}
function compositionEnd(event){composing=false;input(event);if(document.activeElement!==field.value)commit()}
onMounted(()=>{
  observer=new ResizeObserver(entries=>{const width=entries[0].contentRect.width;if(width!==lastWidth){lastWidth=width;scheduleResize()}})
  observer.observe(field.value);fontLayout()
})
onBeforeUnmount(()=>{disposed=true;observer?.disconnect()})
</script>
<template>
  <textarea ref="field" class="chapter-title-control" :value="text" :readonly="readonly" :title="text" rows="1" wrap="soft" aria-label="章节标题" placeholder="章节标题" @input="input" @change="commit" @blur="commit" @keydown="keydown" @compositionstart="composing=true" @compositionend="compositionEnd" />
</template>
<style scoped>
.chapter-title-control{display:block;box-sizing:border-box;min-width:0;max-width:100%;width:100%;min-height:0;padding:1px 2px;resize:none;overflow:hidden;white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word;text-overflow:clip;line-height:1.4;align-self:flex-start}
</style>
