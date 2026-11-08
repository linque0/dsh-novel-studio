<!-- 灵感工作区（设计稿 docs/前端美化/灵感-融合总稿-20261107/ 的整页）：
     页头（灵感 + 作品名 + 手札/拼板 + 检索 + 记一条）+ 左栏（筛选/标签/回收站）+ 手札或拼板 + 片段整理。
     数据真源仍是 work.snippets（content 首行 = 标题）与 work.selSnippetId（外部跳转/拆窗锁都用它）；
     每作品状态与未提交草稿落在 appconfig（ui.loadSnipState / loadSnipDrafts）。
     插件版不提供恍然梦入口：设计稿没有模块助手条，这里也不渲染。 -->
<script setup>
import {computed,ref,watch,onMounted,onBeforeUnmount,nextTick} from 'vue'
import {useWorkStore} from '../../stores/work'
import {useUiStore} from '../../stores/ui'
import {autosave} from '../../services/autosave'
import {snippetCommandsFor} from '../../services/snippet-commands.js'
import {fingerprint} from '../../services/snippet-history.js'
import {previewFor,targetById} from '../../services/doublelinks.js'
import OIcon from '../OIcon.vue'
import SnipNav from './SnipNav.vue'
import SnipJournal from './SnipJournal.vue'
import SnipBoard from './SnipBoard.vue'
import SnipInspector from './SnipInspector.vue'
import SnipDialog from './SnipDialog.vue'
import SnipModal from './SnipModal.vue'
import {boardGroups,joinContent,moveBefore,neighbourId,noteCounts,noteView,normalizeTags,normalizeLinks,normalizeTag,reconcileOrder,stableTagOrder,splitNote,stamp} from './snippet-model.js'
import {visibleNotes} from './snippet-model.js'
import '../../styles/snippets-fusion.css'
const work=useWorkStore(),ui=useUiStore(),shell=ref(null),width=ref(innerWidth)
const narrow=computed(()=>width.value<1200),drawer=computed(()=>width.value<950),phone=computed(()=>width.value<=680)
const today=stamp(Date.now()).date,quickError=ref(''),detailOpen=ref(false),dragging=ref(null),overGroup=ref(''),dialog=ref(null),toast=ref(null),actionBusy=ref(false)
const commands=snippetCommandsFor(work,ui),revision=ref(0),stopCommands=commands.subscribe(()=>revision.value++)
let toastTimer=0,lastUndo=null,restoring=false,internalSelection=false,loadingScope=false
const commandState=computed(()=>{revision.value;return {...commands.history.get(work.work?.id||'')}})
const canUndo=computed(()=>!!commandState.value.past.length&&!commandState.value.busy&&!commandState.value.pending)
const canRedo=computed(()=>!!commandState.value.future.length&&!commandState.value.busy&&!commandState.value.pending)
const names=computed(()=>{
 const map={}
 for(const c of work.liveChapters)map['chapter:'+c.id]=c.title||'未命名章节'
 for(const n of work.liveMubu())map['mubu:'+n.id]=(n.text||'').split('\n')[0]||'未命名节点'
 for(const c of work.liveCharacters)map['character:'+c.id]=c.name||'未命名人物'
 return map
})
const notes=computed(()=>(work.snippets||[]).map(row=>noteView(row,names.value)))
const counts=computed(()=>noteCounts(notes.value,ui.snipTagOrder)),view=computed(()=>ui.snipView),filter=computed(()=>ui.snipFilter),tag=computed(()=>ui.snipTag),sort=computed(()=>ui.snipSort),query=computed(()=>ui.snipQuery||'')
const visible=computed(()=>visibleNotes(notes.value,{filter:filter.value,tag:tag.value,query:query.value,sort:sort.value,order:ui.snipOrder}))
const groups=computed(()=>boardGroups(visible.value,ui.snipTagOrder,filter.value==='trash'))
const currentGroup=computed(()=>groups.value.some(g=>g.id===ui.snipGroup)?ui.snipGroup:groups.value[0]?.id||'')
const selectedId=computed(()=>work.selSnippetId||''),selected=computed(()=>notes.value.find(n=>n.id===selectedId.value)||null),draft=computed(()=>ui.snipDrafts.edit[selectedId.value]||null),quick=computed(()=>ui.snipDrafts.quick||'')
const draftConflict=computed(()=>!!draft.value?.base&&draft.value.base!==fingerprint(work.snippets.find(n=>n.id===selectedId.value)))
const showInspector=computed(()=>narrow.value?detailOpen.value:ui.snipInspector[view.value]),knownTags=computed(()=>counts.value.tags.map(t=>t.tag))
function notify(text,undo){clearTimeout(toastTimer);toast.value={text,undo:!!undo};lastUndo=undo||null;toastTimer=setTimeout(()=>{toast.value=null;lastUndo=null},undo?6000:3200)}
function setState(patch){ui.saveSnipState(patch)}
function pick(id){internalSelection=true;work.selSnippetId=id;nextTick(()=>internalSelection=false)}
async function action(fn,label){
 if(actionBusy.value)return null
 actionBusy.value=true;const workId=work.work?.id
 try{
  const result=await fn()
  if(work.work?.id!==workId)return null
  if(!result.ok){if(result.conflict)await commands.refresh(workId);notify(result.error?.message||'保存未完成，请重试。');return null}
  if(label&&!result.empty)notify(label,()=>stepHistory('undo'))
  return result
 }finally{actionBusy.value=false}
}
async function stepHistory(direction){const result=await action(()=>commands.step(direction),direction==='redo'?'已重做':'已撤销');if(result&&!visible.value.some(n=>n.id===selectedId.value))pick(visible.value[0]?.id||null)}
function runUndo(){if(lastUndo)lastUndo()}
function select(id){if(!id||window.getSelection()?.toString())return;pick(id);if(narrow.value)detailOpen.value=true;else if(!ui.snipInspector[view.value])setState({inspector:{...ui.snipInspector,[view.value]:true}})}
function closeDetail(){if(narrow.value)detailOpen.value=false;else setState({inspector:{...ui.snipInspector,[view.value]:false}})}
function toggleInspector(){if(narrow.value)detailOpen.value=!detailOpen.value;else setState({inspector:{...ui.snipInspector,[view.value]:!ui.snipInspector[view.value]}})}
async function capture(text,explicitTag){
 if(!String(text).trim()){quickError.value='先写下一点想法，再记录。';return false}
 quickError.value='';const {title,body}=splitNote({content:String(text).trim()}),useTag=explicitTag===undefined?tag.value:explicitTag
 const result=await action(()=>commands.capture(joinContent(title,body),useTag?[useTag]:[],text),'已记录灵感')
 if(!result)return false
 pick(result.result.id);setState({filter:'all',query:'',tag:useTag||'',order:reconcileOrder(ui.snipOrder,notes.value.filter(n=>!n.deletedAt).map(n=>n.id))})
 await nextTick();const group=groups.value.find(g=>g.notes.some(n=>n.id===result.result.id));if(group)setState({group:group.id})
 return result
}
async function onCompose(text){const result=await capture(text,dialog.value&&Object.hasOwn(dialog.value,'tag')?dialog.value.tag:tag.value);if(result)dialog.value=null}
function startEdit(id){
 const row=work.snippets.find(n=>n.id===id&&!n.deletedAt);if(!row)return
 pick(id);if(!ui.snipDrafts.edit[id]?.editing)ui.setSnipDraft(id,{...splitNote(row),base:fingerprint(row),editing:true})
 if(narrow.value)detailOpen.value=true;else setState({inspector:{...ui.snipInspector,[view.value]:true}})
 nextTick(()=>document.querySelector('.snip-edit-form [name=title]')?.focus({preventScroll:true}))
}
function updateDraft(value){const id=selectedId.value;if(!id)return;const previous=ui.snipDrafts.edit[id];ui.setSnipDraft(id,{...value,base:previous?.base||fingerprint(work.snippets.find(n=>n.id===id)),editing:true})}
function cancelEdit(){const id=selectedId.value;if(id)ui.setSnipDraft(id,null)}
function resolveConflict(){const id=selectedId.value,row=work.snippets.find(n=>n.id===id);if(draft.value&&row){ui.setSnipDraft(id,{...draft.value,base:fingerprint(row)});commands.history.get(work.work?.id||'').error=null;revision.value++}}
async function saveEdit({title,body}){
 if(!String(title).trim()){notify('请保留一个标题。');return}
 const id=selectedId.value,workId=work.work?.id,base=draft.value?.base||fingerprint(work.snippets.find(n=>n.id===selectedId.value))
 if(draft.value&&!draft.value.base)ui.setSnipDraft(id,{...draft.value,base},workId)
 const result=await action(()=>commands.patch(id,{content:joinContent(title,body)},{expected:base,clearDraft:true,submitted:{title,body}}),'已保存修改')
 if(result?.empty)ui.setSnipDraft(id,null,workId)
}
async function addTag(value){const t=String(value||'').trim().replace(/^#+/,'');if(!t||t.length>30){notify('标签需要 1–30 个字。');return}await action(()=>commands.patch(selectedId.value,row=>({tags:normalizeTags([...(row.tags||[]),t])})),'已添加标签')}
function removeTag(t){return action(()=>commands.patch(selectedId.value,row=>({tags:(row.tags||[]).filter(v=>v!==t)})),'已移除标签')}
function openLink(){dialog.value={type:'link'}}
async function addLink(value){const [kind,...rest]=String(value).split(':'),id=rest.join(':');const result=await action(()=>commands.patch(selectedId.value,row=>({links:normalizeLinks([...(row.links||[]),{kind,id}])})),'已添加关联');if(result)dialog.value=null}
function unlink(key){return action(()=>commands.patch(selectedId.value,row=>({links:(row.links||[]).filter(l=>l.kind+':'+l.id!==key)})),'已移除关联')}
function previewLink(link){
 const target=targetById(link.kind,link.id),pv=target?previewFor(target):null
 if(pv&&link.kind==='mubu'){
  const descendants=[],seen=new Set([link.id]);const visit=id=>{for(const node of work.liveMubu().filter(n=>n.parentId===id)){if(seen.has(node.id))continue;seen.add(node.id);descendants.push(node.text||'');visit(node.id)}};visit(link.id)
  if(descendants.length)pv.body=[pv.body,...descendants].filter(Boolean).join('\n\n')
 }
 dialog.value={type:'preview',preview:pv?{title:pv.title,path:[pv.kindLabel,work.work?.title,pv.meta].filter(Boolean).join(' / '),body:pv.body}:{fallback:'关联目标不可用',path:'目标可能已被移除',body:'暂时没有正文。'}}
}
const convertOptions=computed(()=>dialog.value?.payload?.kind==='chapter'?[{value:'',label:'未分卷'},...work.liveVolumes.map(v=>({value:v.id,label:'卷 · '+(v.title||'未命名')}))]:[{value:'',label:'全部设定 / 新根节点'},...work.liveMubu().map(n=>({value:n.id,label:work.mubuPath(n.id).map(x=>x.text||'未命名').join(' / ')}))])
async function doConvert(dest){const kind=dialog.value?.payload?.kind,result=await action(()=>commands.convert(selectedId.value,kind,dest||null),kind==='chapter'?'已创建章节':'已创建设定节点');if(result)previewLink(result.result)}
async function remove(id){const result=await action(()=>commands.patch(id,{deletedAt:Date.now()}),'已移入回收站');if(result){dialog.value=null;if(narrow.value)detailOpen.value=false}}
async function restore(id){const result=await action(()=>commands.patch(id,{deletedAt:null}),'已恢复灵感');if(result){dialog.value=null;if(narrow.value)detailOpen.value=false}}
function materializeOrder(){return ui.snipOrder.length?reconcileOrder(ui.snipOrder,notes.value.filter(n=>!n.deletedAt).map(n=>n.id)):visibleNotes(notes.value,{sort:sort.value}).map(n=>n.id)}
async function move(id,group,direction){
 const lane=groups.value.find(g=>g.id===group)?.notes||visible.value,other=neighbourId(lane,id,direction)
 if(!other){notify(direction<0?'已经是本组第一条。':'已经是本组最后一条。');return}
 const rest=lane.filter(n=>n.id!==id),at=rest.findIndex(n=>n.id===other),anchor=direction<0?other:rest[at+1]?.id||''
 await action(()=>commands.order(moveBefore(materializeOrder(),id,anchor)),'已调整片段顺序')
}
function onDragStart({id,group,event}){dragging.value={id,group};event?.dataTransfer?.setData('text/plain',id)}
function onDragOver(group){if(dragging.value&&filter.value!=='trash')overGroup.value=group}
function onDragLeave(group){if(overGroup.value===group)overGroup.value=''}
function onDragEnd(){dragging.value=null;overGroup.value=''}
async function onDrop({group,event}){
 const drag=dragging.value,g=groups.value.find(g=>g.id===group),target=event?.target?.closest('.snip-note')?.dataset.id||'';onDragEnd()
 if(!drag||!g||filter.value==='trash'||target===drag.id)return
 const note=notes.value.find(n=>n.id===drag.id);if(!note)return
 if(g.tag===null&&drag.group!==group){notify('此分组不会自动移除原标签，请在详情里整理。');return}
 if(g.tag===null||note.tags.includes(g.tag)){await action(()=>commands.order(moveBefore(materializeOrder(),drag.id,target)),'已调整片段顺序');return}
 dialog.value={type:'drop',note,payload:{id:drag.id,group:g.tag,from:drag.group},dropTarget:target}
}
async function confirmDrop(){const p=dialog.value?.payload;if(!p)return;const result=await action(()=>commands.tagAndOrder(p.id,p.group,moveBefore(materializeOrder(),p.id,dialog.value.dropTarget)),'已添加标签，原标签保留');if(result)dialog.value=null}
function openMenu({id,group}){dialog.value={type:'menu',note:notes.value.find(n=>n.id===id),payload:{id,group}}}
function onMenuAction(key){const {id,group}=dialog.value?.payload||{};dialog.value=null;if(key==='edit')startEdit(id);else if(key==='delete')remove(id);else if(key==='restore')restore(id);else move(id,group,key==='move-prev'?-1:1)}
function paneEl(){return shell.value?.querySelector(view.value==='board'?'.snip-lanes':'.snippet-surface')}
function saveScroll(){if(restoring||loadingScope||ui.snipStateWorkId!==work.work?.id)return;const el=paneEl();if(!el)return;setState({scroll:{...ui.snipScroll,[view.value]:{top:el.scrollTop,left:el.scrollLeft}}})}
async function restoreScroll(){await nextTick();const el=paneEl(),pos=ui.snipScroll[view.value];if(el){el.scrollTop=pos?.top||0;el.scrollLeft=pos?.left||0}requestAnimationFrame(()=>restoring=false)}
function setView(value){if(value===view.value)return;saveScroll();restoring=true;setState({view:value,...(draft.value?{inspector:{...ui.snipInspector,[value]:true}}:{})});restoreScroll()}
function viewKey(e,index){if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const view=e.key==='Home'?'journal':e.key==='End'?'board':index===0?'board':'journal';setView(view);nextTick(()=>shell.value.querySelectorAll('[role=tab]')[view==='journal'?0:1]?.focus({preventScroll:true}))}
function resetScope(patch){setState({...patch,scroll:{...ui.snipScroll,[view.value]:{top:0,left:0}}});restoreScroll()}
function setFilter(value){resetScope({filter:value,tag:''})}
function setTag(value){resetScope({tag:tag.value===value?'':value,filter:'all'})}
function clearFilter(){resetScope({filter:'all',tag:'',query:''})}
function onKeydown(e){
 if(e.isComposing||e.defaultPrevented||work.tab!=='snippets'||!shell.value?.getClientRects().length)return
 const typing=/^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName||'')||e.target?.isContentEditable
 if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();dialog.value=null;detailOpen.value=false;nextTick(()=>shell.value?.querySelector('.snip-search input')?.focus());return}
 if(e.key==='Escape'&&e.target?.closest('.snip-search')&&query.value){e.preventDefault();setState({query:''});return}
 if(e.altKey&&['1','2'].includes(e.key)&&!dialog.value&&!detailOpen.value){e.preventDefault();setView(e.key==='1'?'journal':'board');return}
 if(typing)return
 if((e.ctrlKey||e.metaKey)&&['z','y'].includes(e.key.toLowerCase())){e.preventDefault();stepHistory(e.shiftKey||e.key.toLowerCase()==='y'?'redo':'undo')}
}
function onResize(){
 if(width.value===innerWidth)return
 const active=document.activeElement,field=active?.closest('.snip-edit-form')?active.name:null,start=active?.selectionStart,end=active?.selectionEnd,wasOpen=detailOpen.value
 saveScroll();width.value=innerWidth
 if(!narrow.value&&wasOpen){detailOpen.value=false;setState({inspector:{...ui.snipInspector,[view.value]:true}})}else if(narrow.value&&field)detailOpen.value=true
 nextTick(()=>{restoreScroll();const el=field&&[...document.querySelectorAll('.snip-edit-form [name]')].find(e=>e.name===field&&e.getClientRects().length);if(el){el.focus({preventScroll:true});if(start!=null)el.setSelectionRange(start,end)}})
}
watch(()=>[notes.value,ui.snipStateWorkId,ui.snipPersistence.reading],()=>{if(ui.snipStateWorkId!==work.work?.id||ui.snipPersistence.reading||ui.snipPersistence.readError)return;const order=stableTagOrder(notes.value,ui.snipTagOrder);if(JSON.stringify(order)!==JSON.stringify(ui.snipTagOrder))setState({tagOrder:order})},{immediate:true})
watch(visible,rows=>{if(loadingScope||ui.snipPersistence.reading||ui.snipStateWorkId!==work.work?.id)return;if(!rows.some(n=>n.id===selectedId.value))pick(rows[0]?.id||null)},{flush:'post'})
watch(selectedId,id=>{
 if(loadingScope||ui.snipPersistence.reading||ui.snipStateWorkId!==work.work?.id)return
 setState({selected:id||''})
 if(!id||internalSelection)return;const n=notes.value.find(n=>n.id===id);if(n&&!visible.value.some(n=>n.id===id))resetScope({filter:n.deletedAt?'trash':'all',tag:'',query:''})
})
async function loadScope(id){
 loadingScope=true;await ui.loadSnipState(id);await nextTick()
 if(work.work?.id!==id)return
 const saved=ui.snipSelectedId,valid=visible.value.some(n=>n.id===saved)
 pick(valid?saved:visible.value.some(n=>n.id===selectedId.value)?selectedId.value:visible.value[0]?.id||null)
 setState({selected:selectedId.value||''});await nextTick();loadingScope=false;restoreScroll()
}
watch(()=>work.work?.id,id=>{dialog.value=null;detailOpen.value=false;loadScope(id)},{flush:'sync'})
onMounted(async()=>{await loadScope(work.work?.id);width.value=innerWidth;window.addEventListener('resize',onResize);window.addEventListener('keydown',onKeydown);shell.value?.addEventListener('scroll',saveScroll,{capture:true,passive:true});restoreScroll();shell.value?.classList.add('snip-arrive')})
onBeforeUnmount(()=>{saveScroll();void ui.flushSnipPersistence();shell.value?.removeEventListener('scroll',saveScroll,{capture:true});window.removeEventListener('resize',onResize);window.removeEventListener('keydown',onKeydown);clearTimeout(toastTimer);stopCommands()})
const linkOptions=computed(()=>{const has=new Set((selected.value?.links||[]).map(l=>l.kind+':'+l.id)),out=[];for(const [kind,items,group] of [['chapter',work.liveChapters,'正文'],['mubu',work.liveMubu(),'设定'],['character',work.liveCharacters,'人物']])for(const row of items){const value=kind+':'+row.id;if(!has.has(value))out.push({value,label:kind==='mubu'?work.mubuPath(row.id).map(n=>n.text||'未命名').join(' / '):row.title||row.name||'未命名',group})}return out})
const autosaveError=computed(()=>ui.autosave.error||ui.snipPersistence.readError||ui.snipPersistence.writeError||commandState.value.error)
async function retrySave(){await ui.retrySnipPersistence();await autosave.flushAll();if(commandState.value.pending){const result=await action(()=>commands.retry(),'已完成保存');if(result?.result?.id){if(result.result.kind)previewLink(result.result);else{pick(result.result.id);dialog.value=null}}}else if(commandState.value.error)commands.history.get(work.work?.id||'').error=null;revision.value++}
</script>


<template>
  <div ref="shell" class="snip-shell" :data-view="view">
    <!-- 页头 -->
    <div class="snip-head">
      <div class="snip-heading">
        <button v-if="drawer" type="button" class="snip-mobile-menu" aria-label="打开目录" @click="dialog = { type: 'directory' }">☰</button>
        <h1>灵感</h1>
        <span class="snip-crumb">{{ work.work?.title }}</span>
      </div>
      <div class="snip-head-tools">
        <div class="snip-view-switch" :data-view="view" role="tablist" aria-label="灵感视图">
          <i aria-hidden="true"></i>
          <button type="button" role="tab" :aria-selected="view === 'journal'" :tabindex="view === 'journal' ? 0 : -1" @click="setView('journal')" @keydown="viewKey($event, 0)">手札</button>
          <button type="button" role="tab" :aria-selected="view === 'board'" :tabindex="view === 'board' ? 0 : -1" @click="setView('board')" @keydown="viewKey($event, 1)">拼板</button>
        </div>
        <label class="snip-search">
          <OIcon name="search" :size="15" />
          <input :value="query" type="search" aria-label="搜索灵感、标签或关联" placeholder="搜索灵感、标签…" @input="setState({ query: $event.target.value })">
          <span class="snip-key">Ctrl K</span>
        </label>
        <button v-if="filter !== 'trash'" type="button" class="snip-primary" :disabled="actionBusy" @click="dialog = { type: 'compose' }">＋ 记一条</button>
      </div>
    </div>

    <div class="snip-body">
      <SnipNav
        :work-title="work.work?.title || ''"
        :counts="counts"
        :filter="filter"
        :tag="tag"
        :more-tags="ui.snipMoreTags"
        @filter="setFilter"
        @tag="setTag"
        @toggle-more="setState({ moreTags: !ui.snipMoreTags })"
      />

      <section class="snip-main">
        <div v-if="autosaveError" class="snip-save-error" role="alert">
          <span>保存未完成，内容仍保留在当前页面。</span>
          <button type="button" @click="retrySave">重试保存</button>
        </div>
        <div class="snip-toolbar">
          <div class="snip-scope">
            <span>{{ tag ? '# ' + tag : { all: '全部灵感', untagged: '未标记', linked: '有关联', trash: '回收站' }[filter] }}</span>
            <span class="num">{{ visible.length }} 条</span>
            <button v-if="tag || query || filter !== 'all'" type="button" class="snip-text-button" @click="clearFilter">清除筛选 ×</button>
          </div>
          <div class="snip-tools">
            <label class="snip-sort"><span>排序</span>
              <select :value="sort" aria-label="排序" @change="setState({ sort: $event.target.value })">
                <option value="new">最新创建</option>
                <option value="old">最早创建</option>
                <option value="manual">手动顺序</option>
              </select>
            </label>
            <button
              type="button"
              class="snip-soft snip-detail-toggle"
              :aria-pressed="showInspector"
              :disabled="!selected"
              @click="toggleInspector"
            >片段详情</button>
          </div>
        </div>

        <div class="snip-grid" :class="{ 'no-inspector': !showInspector || narrow }">
          <SnipJournal
            v-if="view === 'journal'"
            :notes="visible"
            :selected-id="selectedId"
            :tag="tag"
            :trash="filter === 'trash'"
            :quick="quick"
            :today="today"
            :error="quickError"
            :busy="actionBusy"
            @capture="capture"
            @update:quick="ui.saveSnipDrafts({ quick: $event })"
            @select="select"
            @edit="startEdit"
            @menu="openMenu"
            @tag="setTag"
            @compose="dialog = { type: 'compose', tag: $event }"
            @clear="clearFilter"
            @scroll="saveScroll"
          />
          <SnipBoard
            v-else
            :groups="groups"
            :selected-id="selectedId"
            :current="currentGroup"
            :over="overGroup"
            @select="select"
            @edit="startEdit"
            @menu="openMenu"
            @tag="setTag"
            @compose="dialog = { type: 'compose', tag: $event }"
            @group="setState({ group: $event })"
            @dragstart="onDragStart"
            @dragend="onDragEnd"
            @dragover="onDragOver"
            @dragleave="onDragLeave"
            @drop="onDrop"
          />

          <SnipInspector
            v-if="!narrow"
            :note="selected"
            :draft="draft"
            :conflict="draftConflict"
            @resolve-conflict="resolveConflict"
            @cancel-edit="cancelEdit"
            :busy="actionBusy"
            :save-error="!!autosaveError"
            @retry="retrySave"
            wide
            :board="view === 'board'"
            :work-title="work.work?.title || ''"
            :known-tags="knownTags"
            @close="closeDetail"
            @edit="startEdit"
            @save="saveEdit"
            @update-draft="updateDraft"
            @add-tag="addTag"
            @untag="removeTag"
            @unlink="unlink"
            @open-link="openLink"
            @preview="previewLink"
            @convert="kind => (dialog = { type: 'convert', note: selected, payload: { kind } })"
            @remove="remove"
            @restore="restore"
          />
        </div>
      </section>
    </div>

    <!-- 窄档：目录抽屉 / 片段详情抽屉 -->
    <SnipModal label="灵感目录" v-if="drawer && dialog?.type === 'directory'" class="snip-drawer-scrim" @close="dialog = null">
      <div class="snip-dialog snip-directory-dialog" data-dialog="directory" role="dialog" aria-label="灵感目录">
        <div class="snip-drawer-head">
          <h2>灵感目录</h2>
          <button type="button" class="snip-round" aria-label="关闭目录" @click="dialog = null">×</button>
        </div>
        <SnipNav
          :work-title="work.work?.title || ''"
          :counts="counts"
          :filter="filter"
          :tag="tag"
          :more-tags="ui.snipMoreTags"
          @filter="(v) => { setFilter(v); dialog = null }"
          @tag="(v) => { setTag(v); dialog = null }"
          @toggle-more="setState({ moreTags: !ui.snipMoreTags })"
        />
      </div>
    </SnipModal>
    <SnipModal label="片段详情" v-if="narrow && showInspector && selected" @close="closeDetail">
      <div class="snip-dialog snip-detail-dialog" data-dialog="detail" :class="{ 'is-sheet': phone }" role="dialog" aria-label="片段详情">
        <SnipInspector
          :note="selected"
          :draft="draft"
            :conflict="draftConflict"
            @resolve-conflict="resolveConflict"
            @cancel-edit="cancelEdit"
            :busy="actionBusy"
            :save-error="!!autosaveError"
            @retry="retrySave"
          :board="view === 'board'"
          :work-title="work.work?.title || ''"
          :known-tags="knownTags"
          @close="closeDetail"
          @edit="startEdit"
          @save="saveEdit"
            @update-draft="updateDraft"
          @add-tag="addTag"
          @untag="removeTag"
          @unlink="unlink"
          @open-link="openLink"
          @preview="previewLink"
          @convert="kind => (dialog = { type: 'convert', note: selected, payload: { kind } })"
          @remove="remove"
          @restore="restore"
        />
      </div>
    </SnipModal>

    <SnipDialog
      v-if="dialog && dialog.type !== 'directory'"
      :type="dialog.type"
      :note="dialog.note || selected"
      :tag="dialog.tag || tag"
      :payload="dialog.payload || {}"
      :link-options="linkOptions"
      :convert-options="convertOptions"
      :quick="quick"
      :preview="dialog.preview || null"
      :error="quickError"
            :busy="actionBusy"
            :save-error="!!autosaveError"
            @retry="retrySave"
      :sheet="narrow"
      @close="dialog = null"
      @compose="onCompose"
      @update:quick="ui.saveSnipDrafts({ quick: $event })"
      @action="onMenuAction"
      @link="addLink"
      @convert="doConvert"
      @confirm-drop="confirmDrop"
    />

    <div v-if="toast" class="snip-toast" role="status">
      <span>{{ toast.text }}</span>
      <button v-if="toast.undo" type="button" @click="runUndo">撤销</button>
    </div>
  </div>
</template>
