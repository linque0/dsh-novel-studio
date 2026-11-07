<script setup>
import { ref, watch } from 'vue'
import { readWritingStatsRevision } from '../../db/repo.js'
import { snapshotPreview } from '../../services/writing-analysis-data.js'
const props=defineProps({revision:Object,chapter:Object})
const opened=ref(false),busy=ref(false),error=ref(false),value=ref(null)
let request=0
watch(()=>[props.revision.id,props.chapter?.id],()=>{request++;value.value=null;error.value=false;busy.value=false;opened.value=false})
async function load(){
 const n=++request
 busy.value=true;error.value=false
 try{
  const row=await readWritingStatsRevision(props.revision.id,props.chapter.work,props.chapter.rawId)
  if(n!==request)return
  value.value=snapshotPreview(row.content,row.fmt)
 }catch{if(n===request)error.value=true}finally{if(n===request)busy.value=false}
}
function toggle(e){opened.value=e.target.open;if(opened.value&&!value.value&&!busy.value)load()}
</script>
<template><details class="snapshot" :open="opened" @toggle="toggle"><summary><span><b>{{revision.title}}</b><small>{{value?value.words.toLocaleString('zh-CN')+' 字'+(value.legacy?' · 旧版兼容预览':''):'展开读取留存内容'}}</small></span></summary>
 <p v-if="busy" class="muted" role="status">正在读取版本…</p><div v-else-if="error" role="alert"><p class="muted">暂时无法读取此版本。</p><button class="soft" @click="load">重试读取</button></div>
 <blockquote v-else-if="value">{{value.plain.slice(0,20000)||'此版本没有正文。'}}</blockquote><small v-if="value?.plain.length>20000">显示前 20,000 字符的节选。</small>
</details></template>
