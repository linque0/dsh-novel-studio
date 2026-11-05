<!-- Approved B detail surface: reading first, edit in place; advanced actions live in More. -->
<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { NPopover } from 'naive-ui'
import { useWorkStore } from '../../stores/work'
import Glyph from './OutlineGlyph.vue'
import { CONTAINER_COLORS, EVENT_SHAPES } from './outline-paper'
const props=defineProps({node:{type:Object,default:null},path:{type:Array,default:()=>[]},stats:{type:Object,default:()=>({total:0,done:0,blocks:0,depth:0})},connections:{type:Array,default:()=>[]},parent:{type:Object,default:null},isMini:Boolean})
const emit=defineEmits(['close','edit-node','chapter','shape','status','color','enter','toggle-inline','move-out','remove','reveal','inline-edit','text'])
const work=useWorkStore(),editing=ref(''),editingNodeId=ref(null),draft=ref(''),input=ref(null),showMore=ref(false),showStatus=ref(false),armed=ref(false)
const isContainer=computed(()=>props.node?.kind==='container'),isEvent=computed(()=>props.node?.kind==='event')
const statusOptions=[['planned','待展开'],['writing','进行中'],['done','已完成'],['revise','待修改']]
const status=computed(()=>Object.fromEntries(statusOptions)[props.node?.status]||'待展开')
const kind=computed(()=>({event:'事件',note:'便签',cite:'引用',anchor:'章节',volume:'卷',container:'容器',textbox:'文本框'})[props.node?.kind]||'模块')
const parentPath=computed(()=>props.path.filter(p=>p.id).map(p=>p.title).join(' / ')||'全书情节')
const linkedNodes=computed(()=>props.connections.map(c=>({connection:c,node:work.olnodes.find(n=>n.id===c.otherId&&!n.deletedAt)})))
const chapters=computed(()=>{
 const rows=linkedNodes.value.filter(x=>x.node?.kind==='anchor').map(x=>({nodeId:x.node.id,chapter:work.chapters.find(c=>c.id===x.node.refId&&!c.deletedAt)})).filter(x=>x.chapter)
 if(props.node?.kind==='anchor'){const chapter=work.chapters.find(c=>c.id===props.node.refId&&!c.deletedAt);if(chapter)rows.unshift({nodeId:props.node.id,chapter})}
 return rows.filter((x,i,a)=>a.findIndex(y=>y.chapter.id===x.chapter.id)===i)
})
const relations=computed(()=>linkedNodes.value.filter(x=>x.node?.kind!=='anchor').map(x=>x.connection))
const people=computed(()=>{
 const ids=linkedNodes.value.filter(x=>x.node?.kind==='cite'&&String(x.node.refId).startsWith('character:')).map(x=>x.node.refId.slice(10))
 return work.characters.filter(c=>!c.deletedAt&&(ids.includes(c.id)||(c.name?.length>=2&&String(props.node?.text||'').includes(c.name))))
})
function chapterTitle(chapter){const m=/^(第\s*.+?章)[\s·：:—-]*(.*)$/.exec(chapter.title||'');return m?{heading:m[1],sub:m[2]||`${chapter.wordCount||0} 字`}:{heading:chapter.title,sub:`${chapter.wordCount||0} 字`}}
let timer
watch(()=>props.node?.id,()=>{commit();showMore.value=false;showStatus.value=false;armed.value=false;clearTimeout(timer)})
onBeforeUnmount(()=>{commit();clearTimeout(timer)})
async function edit(field){editingNodeId.value=props.node.id;draft.value=field==='title'?props.node.title||'':props.node.text||'';editing.value=field;await nextTick();input.value?.focus()}
function commit(){if(!editing.value)return;const change={id:editingNodeId.value,field:editing.value,value:draft.value};editing.value='';editingNodeId.value=null;emit('edit-node',change)}
function armDelete(){if(!armed.value){armed.value=true;timer=setTimeout(()=>armed.value=false,3200)}else{armed.value=false;emit('remove')}}
</script>
<template>
 <aside v-if="node" class="oc-drawer draft-detail detail" @mousedown.stop @contextmenu.prevent.stop>
  <header class="detail-top"><span><Glyph :name="isContainer?'container':isEvent?'event':node.kind==='cite'?'link':node.kind" :size="14"/> {{kind}}详情</span><span class="detail-icons"><button type="button" aria-label="在文本视图中展开" @click="emit('text')"><Glyph name="expand" :size="15"/></button><button class="oc-drawer-x" type="button" aria-label="收起详情" @click="emit('close')"><Glyph name="close" :size="15"/></button></span></header>
  <div class="detail-content">
   <span class="tiny-label">{{parentPath}}</span>
   <input v-if="editing==='title'" ref="input" v-model="draft" class="detail-title-input" data-edit="title" aria-label="标题" maxlength="45" @blur="commit" @keydown.enter.prevent="commit" @keydown.esc.prevent="editing=''"/>
   <h2 v-else><button type="button" class="detail-title" aria-label="编辑标题" @click="edit('title')">{{node.title||'未命名'+kind}}</button></h2>
   <NPopover v-if="isEvent" v-model:show="showStatus" trigger="click" :show-arrow="false"><template #trigger><button type="button" class="detail-status"><i></i>{{status}}</button></template><div class="draft-status-options"><button v-for="[value,label] in statusOptions" :key="value" type="button" @click="emit('status',value);showStatus=false">{{label}}</button></div></NPopover>
   <section><h3>{{isContainer?'故事摘要':isEvent?'情节梗概':'内容'}}</h3><textarea v-if="editing==='body'" ref="input" v-model="draft" class="detail-body-input" data-edit="body" aria-label="情节梗概" rows="6" @blur="commit" @keydown.ctrl.enter.prevent="commit" @keydown.esc.prevent="editing=''"/><button v-else type="button" class="detail-prose" aria-label="编辑情节梗概" @click="edit('body')"><p v-for="(line,i) in (node.text||'写下这一幕发生的事…').split('\n').filter(Boolean)" :key="i">{{line}}</p></button></section>
   <section v-if="isContainer" class="detail-container"><h3>容器故事 <span>{{stats.total}} 个事件</span></h3><div class="detail-container-actions"><button type="button" @click="emit('toggle-inline')">{{isMini?'收起内容':'就地展开'}}</button><button type="button" @click="emit('enter')">进入容器 ↗</button><button v-if="parent" type="button" @click="emit('move-out')">移出上一层</button></div><p>已完成 {{stats.done}} / {{stats.total}}<template v-if="stats.blocks"> · {{stats.blocks}} 个子容器</template></p></section>
   <section><h3>关联章节 <span>{{chapters.length}}</span></h3><button v-for="row in chapters" :key="row.chapter.id" type="button" class="relation-row" @click="work.navTo('chapters',row.chapter.id)"><Glyph name="anchor" :size="15"/><div>{{chapterTitle(row.chapter).heading}}<span>{{chapterTitle(row.chapter).sub}}</span></div><Glyph name="chevron" :size="13"/></button><p v-if="!chapters.length" class="detail-empty-note">暂无关联章节</p></section>
   <section><h3>故事关系 <span>{{relations.length}}</span></h3><button v-for="c in relations" :key="c.id+c.direction+c.otherId" type="button" class="relation-text" @click="emit('reveal',c.otherId)"><b>{{c.kind==='伏笔'?'铺垫':c.direction==='in'?'来自':'去向'}}</b><span>{{c.otherTitle}}</span><em>{{c.label||c.kind}}</em></button><p v-if="!relations.length" class="detail-empty-note">暂无故事关系</p></section>
   <div v-if="people.length" class="detail-people"><span v-for="(p,i) in people.slice(0,3)" :key="p.id" class="avatar" :class="{second:i>0}">{{p.name?.[0]}}</span><span>{{people.map(p=>p.name).join('、')}}</span></div>
  </div>
  <footer class="detail-bottom"><button type="button" class="btn light" @click="commit();emit('text')"><Glyph name="text" :size="16"/>在文本视图中展开</button><NPopover v-model:show="showMore" trigger="click" :show-arrow="false" placement="top-end"><template #trigger><button type="button" class="btn plain" aria-label="更多节点操作">更多</button></template><div class="draft-node-more">
   <label v-if="isEvent">事件形状<select :value="node.shape||'process'" @change="emit('shape',$event.target.value)"><option v-for="(s,key) in EVENT_SHAPES" :key="key" :value="key">{{s.label}}</option></select></label>
   <template v-if="isContainer"><label>章节标签<input :value="node.chapter||''" @input="emit('chapter',$event.target.value)"/></label><div class="draft-color-row"><button v-for="[color,name] in CONTAINER_COLORS" :key="color" type="button" :style="{background:color}" :aria-label="name" @click="emit('color',color)"></button><button type="button" @click="emit('color','')">自动</button></div></template>
   <button type="button" @click="showMore=false;emit('inline-edit')">在画布内编辑</button><div class="oc-drawer-foot"><button type="button" class="danger" @click="armDelete">{{armed?'再点一次确认删除':isContainer?'删除容器及内部':'删除模块'}}</button></div>
  </div></NPopover></footer>
 </aside>
</template>
