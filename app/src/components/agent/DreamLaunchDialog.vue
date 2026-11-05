<script setup>
import {computed,ref} from 'vue'
import {NModal,NButton,NInput} from 'naive-ui'
import {useUiStore} from '../../stores/ui.js'
import {useShelfStore} from '../../stores/shelf.js'
import {useWorkStore} from '../../stores/work.js'
import {sortShelfWorks} from '../../services/shelf-sort.js'
import {openDreamBook} from '../../services/ai/entry-modes.js'
const ui=useUiStore(),shelf=useShelfStore(),work=useWorkStore()
const title=ref(''),query=ref(''),busy=ref(false),error=ref(''),createdId=ref(null)
const books=computed(()=>sortShelfWorks(shelf.works,shelf.openStats).filter(b=>!query.value||(b.title||'').toLowerCase().includes(query.value.toLowerCase())))
async function enter(workId){if(busy.value)return;busy.value=true;error.value='';try{await openDreamBook({ui,work,workId})}catch(e){error.value=e.message}finally{busy.value=false}}
async function start(){
  if(busy.value)return
  busy.value=true;error.value=''
  try{
    if(!createdId.value){const row=await shelf.createWork({title:title.value.trim()||'未命名故事',genre:'其他',status:'构思',kind:'novel',withVolume:false});createdId.value=row.id}
    await openDreamBook({ui,work,workId:createdId.value})
  }catch(e){error.value=e.message}finally{busy.value=false}
}
</script>
<template>
  <NModal v-model:show="ui.dreamLauncherOpen" preset="card" title="恍然梦-入梦" :mask-closable="!busy" :close-on-esc="!busy" style="width:min(540px,94vw)" class="dream-launch-dialog">
    <p>让 AI 从空白写下开场，或继续你的故事。正文随时可以手动修改。</p>
    <div class="dream-launch-new"><NInput v-model:value="title" :disabled="busy||!!createdId" placeholder="故事名（可稍后修改）" :input-props="{'aria-label':'新故事名称'}" @keydown.enter="e=>{if(!e.isComposing)start()}" /><NButton type="primary" :disabled="busy" :loading="busy" data-dream-start @click="start">{{createdId?'继续进入新故事':'开始新故事'}}</NButton></div>
    <template v-if="shelf.works.length"><h3>继续已有作品</h3><NInput v-model:value="query" :disabled="busy" placeholder="查找作品" :input-props="{'aria-label':'查找已有故事'}" clearable /><div class="dream-launch-books"><button v-for="book in books" :key="book.id" type="button" :disabled="busy" :data-dream-book="book.id" @click="enter(book.id)"><strong>{{book.title}}</strong><span>{{book.chapterCount||0}} 章 · 进入故事现场 →</span></button><p v-if="!books.length">没有匹配的作品，试试其他书名。</p></div></template>
    <p v-if="error" role="alert" class="dream-launch-error">{{error}}</p>
  </NModal>
</template>
<style>
.dream-launch-dialog p{font-size:14px;line-height:1.8;color:var(--text-dim);margin:0 0 18px}.dream-launch-new{display:flex;gap:10px}.dream-launch-new>.n-input{min-width:0;flex:1}.dream-launch-dialog h3{font-size:14px;font-weight:500;margin:25px 0 12px}.dream-launch-books{max-height:min(300px,40vh);overflow:auto;margin-top:12px}.dream-launch-books>button{display:flex;align-items:center;justify-content:space-between;gap:16px;width:100%;padding:13px 5px;border:0;border-bottom:1px solid var(--border);background:none;color:var(--text);text-align:left;cursor:pointer}.dream-launch-books>button strong{font-size:14px;font-weight:500;overflow-wrap:anywhere}.dream-launch-books>button span{font-size:12px;color:var(--text-dim);flex-shrink:0}.dream-launch-books>button:hover{color:var(--accent)}.dream-launch-books>button:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}.dream-launch-books>button:disabled{opacity:.5;cursor:default}.dream-launch-dialog .dream-launch-error{margin-top:16px;color:#bd574c}@media(max-width:500px){.dream-launch-new{flex-direction:column}.dream-launch-books>button{align-items:flex-start;flex-direction:column;gap:5px}}
</style>
