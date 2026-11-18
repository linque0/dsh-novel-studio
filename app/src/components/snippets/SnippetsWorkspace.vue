<!-- 灵感工作区：目录与显示设置、标签拼板、片段整理。
     数据真源仍是 work.snippets（content 首行 = 标题）与 work.selSnippetId（外部跳转/拆窗锁都用它）；
     每作品状态与未提交草稿落在 appconfig（ui.loadSnipState / loadSnipDrafts）。
     插件版不提供恍然梦入口：设计稿没有模块助手条，这里也不渲染。 -->
<script setup>
import {computed,ref,watch,onMounted,onBeforeUnmount,nextTick,useId} from 'vue'
import {useWorkStore} from '../../stores/work'
import {useUiStore} from '../../stores/ui'
import {autosave} from '../../services/autosave'
import {snippetCommandsFor} from '../../services/snippet-commands.js'
import {matchesSnippetContent,snippetContentFingerprint} from '../../services/snippet-history.js'
import {previewFor,targetById} from '../../services/doublelinks.js'
import OIcon from '../OIcon.vue'
import SnipNav from './SnipNav.vue'
import SnipBoard from './SnipBoard.vue'
import SnipCardMenu from './SnipCardMenu.vue'
import SnipInspector from './SnipInspector.vue'
import SnipDialog from './SnipDialog.vue'
import SnipModal from './SnipModal.vue'
import {
 boardGroups,clampSnipSidebarWidth,joinContent,moveBefore,neighbourId,noteCounts,noteView,normalizeTags,normalizeLinks,
 snippetDropPlacement,snippetNavGroups,SNIP_CARD_COLORS,SNIP_SIDEBAR,stableTagOrder,splitNote,tagGroupId,UNTAGGED_GROUP,visibleNotes
} from './snippet-model.js'
import {createSnippetDragMotion} from './snippet-drag-motion.js'
import '../../styles/snippets-fusion.css'
const work=useWorkStore(),ui=useUiStore(),shell=ref(null),width=ref(innerWidth)
const narrow=computed(()=>width.value<1200),drawer=computed(()=>width.value<950),phone=computed(()=>width.value<=680)
const sidebarId = useId()
const sidebarLabel = computed(() => ui.snipSidebarOpen ? '收起灵感侧栏' : '展开灵感侧栏')
const sidebarPreview=ref(null)
const sidebarWidth=computed(()=>sidebarPreview.value??ui.snipSidebarWidth)
let sidebarDrag=null
const quickError=ref(''),detailOpen=ref(false),dragging=ref(null),dropHint=ref(null),dialog=ref(null),toast=ref(null),actionBusy=ref(false)
const dragMotion=createSnippetDragMotion()
const floatingEditorId=ref('')
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
const counts=computed(()=>noteCounts(notes.value,ui.snipTagOrder)),filter=computed(()=>ui.snipFilter),tag=computed(()=>ui.snipTag),sort=computed(()=>ui.snipSort),query=computed(()=>ui.snipQuery||'')
const visible=computed(()=>visibleNotes(notes.value,{filter:filter.value,tag:tag.value,query:query.value,sort:sort.value,order:ui.snipOrder}))
const groups=computed(()=>{
 const lanes=boardGroups(visible.value,ui.snipTagOrder,filter.value==='trash')
 if(!dragging.value)return lanes
 const existing=new Set(lanes.map(g=>g.id))
 for(const {tag} of counts.value.tags){
  const id=tagGroupId(tag)
  if(!existing.has(id))lanes.push({id,label:tag,tag,notes:[]})
 }
 if(!existing.has(UNTAGGED_GROUP))lanes.push({id:UNTAGGED_GROUP,label:'未标记',tag:null,notes:[]})
 return lanes
})
const currentGroup=computed(()=>groups.value.some(g=>g.id===ui.snipGroup)?ui.snipGroup:groups.value[0]?.id||'')
const selectedId=computed(()=>work.selSnippetId||''),selected=computed(()=>notes.value.find(n=>n.id===selectedId.value)||null),draft=computed(()=>ui.snipDrafts.edit[selectedId.value]||null),quick=computed(()=>ui.snipDrafts.quick||'')
const floatingEdit=computed(()=>!!floatingEditorId.value&&floatingEditorId.value===selectedId.value&&!!selected.value&&!selected.value.deletedAt)
const draftConflict=computed(()=>!!draft.value?.base&&!matchesSnippetContent(work.snippets.find(n=>n.id===selectedId.value),draft.value.base))
const showInspector=computed(()=>narrow.value?detailOpen.value:ui.snipInspector.board),knownTags=computed(()=>counts.value.tags.map(t=>t.tag))
const navigation=computed(()=>snippetNavGroups(notes.value,ui.snipTagOrder,sort.value,ui.snipOrder))
const navProps=computed(()=>({
 workTitle:work.work?.title||'',groups:navigation.value,expanded:ui.snipExpandedGroups,selectedId:selectedId.value,
 filter:filter.value,tag:tag.value,trashCount:counts.value.trash,cardSize:ui.snipCardSize,sort:sort.value
}))
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
function select(id){if(!id||window.getSelection()?.toString())return;openNote(id)}
function openNote(id){
 pick(id)
 if(narrow.value)detailOpen.value=true
 else if(!ui.snipInspector.board)setState({inspector:{...ui.snipInspector,board:true}})
}
function closeDetail(){
 if(floatingEdit.value){floatingEditorId.value='';return}
 if(narrow.value)detailOpen.value=false
 else setState({inspector:{...ui.snipInspector,board:false}})
}
function toggleGroup(id){
 const expanded=ui.snipExpandedGroups
 setState({expandedGroups:expanded.includes(id)?expanded.filter(key=>key!==id):[...expanded,id]})
}
async function selectNavNote({group,note}){
 if(!visible.value.some(n=>n.id===note.id))resetScope({filter:group.filter||'all',tag:group.tag||'',query:''})
 const lanes=groups.value.filter(lane=>lane.notes.some(n=>n.id===note.id))
 const preferred=group.tag?group.id:currentGroup.value
 const lane=lanes.find(lane=>lane.id===preferred)||lanes[0]
 if(!lane)return
 setState({group:lane.id})
 if(dialog.value?.type==='directory')dialog.value=null
 openNote(note.id)
 await nextTick()
 const card=[...shell.value?.querySelectorAll('.snip-lane .snip-note')||[]].find(
  card=>card.dataset.id===note.id&&card.closest('.snip-lane').dataset.group===lane.id
 )
 card?.scrollIntoView({block:'nearest',inline:'nearest'})
}
function startSidebarResize(event){
 if(event.button!==0||sidebarDrag)return
 event.preventDefault()
 event.currentTarget.setPointerCapture(event.pointerId)
 sidebarDrag={id:event.pointerId,x:event.clientX,width:sidebarWidth.value}
}
function previewSidebarResize(event){
 if(sidebarDrag?.id!==event.pointerId)return
 sidebarPreview.value=clampSnipSidebarWidth(sidebarDrag.width+event.clientX-sidebarDrag.x)
}
function resetSidebarDrag(){sidebarDrag=null;sidebarPreview.value=null}
function commitSidebarResize(event){
 if(sidebarDrag?.id!==event.pointerId)return
 previewSidebarResize(event)
 setState({sidebarWidth:sidebarWidth.value})
 resetSidebarDrag()
}
function resizeSidebarWithKeys(event){
 if(!['ArrowLeft','ArrowRight','Home'].includes(event.key))return
 event.preventDefault()
 const width=event.key==='Home'?SNIP_SIDEBAR.initial:sidebarWidth.value+(event.key==='ArrowLeft'?-16:16)
 setState({sidebarWidth:clampSnipSidebarWidth(width)})
}
function finishCapture(id){
 setState({order:reconcileOrder(ui.snipOrder,notes.value.filter(n=>!n.deletedAt).map(n=>n.id))})
 if(!visible.value.some(n=>n.id===id))return
 if(phone.value&&!groups.value.find(g=>g.id===currentGroup.value)?.notes.some(n=>n.id===id))return
 pick(id)
}
async function capture(text,explicitTag){
 if(!String(text).trim()){quickError.value='先写下一点想法，再记录。';return false}
 quickError.value='';const {title,body}=splitNote({content:String(text).trim()}),useTag=explicitTag===undefined?tag.value:explicitTag
 const result=await action(()=>commands.capture(joinContent(title,body),useTag?[useTag]:[],text),'已记录灵感')
 if(!result)return false
 finishCapture(result.result.id)
 return result
}
async function onCompose(text){
 const compose=dialog.value
 const result=await capture(text,compose?.tag)
 if(result&&dialog.value===compose)dialog.value=null
}
function startEdit(id,floating=false){
 const row=work.snippets.find(n=>n.id===id&&!n.deletedAt);if(!row)return
 pick(id)
 if(floating){
  floatingEditorId.value=id
  detailOpen.value=false
 }else if(narrow.value)detailOpen.value=true
 else setState({inspector:{...ui.snipInspector,board:true}})
 nextTick(()=>{
  const scope=floating||narrow.value?document.querySelector('.snip-native[open] [data-dialog=detail]'):shell.value
  scope?.querySelector('.snip-edit-form [name=title]')?.focus({preventScroll:true})
 })
}
function updateDraft(value){
 const id=selectedId.value,row=work.snippets.find(n=>n.id===id&&!n.deletedAt)
 if(!row)return
 const previous=ui.snipDrafts.edit[id],saved=splitNote(row)
 if(value.title===saved.title&&value.body===saved.body){if(previous)ui.setSnipDraft(id,null);return}
 ui.setSnipDraft(id,{...value,base:previous?.base||snippetContentFingerprint(row),editing:true})
}
function cancelEdit(){const id=selectedId.value;if(id)ui.setSnipDraft(id,null)}
function resolveConflict(){const id=selectedId.value,row=work.snippets.find(n=>n.id===id);if(draft.value&&row){ui.setSnipDraft(id,{...draft.value,base:snippetContentFingerprint(row)});commands.history.get(work.work?.id||'').error=null;revision.value++}}
async function saveEdit({title,body}){
 if(!String(title).trim()){notify('请保留一个标题。');return}
 const id=selectedId.value,workId=work.work?.id,base=draft.value?.base||snippetContentFingerprint(work.snippets.find(n=>n.id===selectedId.value))
 if(draft.value&&!draft.value.base)ui.setSnipDraft(id,{...draft.value,base},workId)
 const result=await action(()=>commands.patch(id,{content:joinContent(title,body)},{expectedContent:base,clearDraft:true,submitted:{title,body}}),'已保存修改')
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
function materializeOrder(){return visibleNotes(notes.value,{sort:sort.value,order:ui.snipOrder}).map(n=>n.id)}
async function move(id,group,direction){
 const lane=groups.value.find(g=>g.id===group)?.notes||visible.value,other=neighbourId(lane,id,direction)
 if(!other){notify(direction<0?'已经是本组第一条。':'已经是本组最后一条。');return}
 const rest=lane.filter(n=>n.id!==id),at=rest.findIndex(n=>n.id===other),anchor=direction<0?other:rest[at+1]?.id||''
 await action(()=>commands.order(moveBefore(materializeOrder(),id,anchor)),'已调整片段顺序')
}
function onDragStart({id,group,event}){
 const lane=groups.value.find(g=>g.id===group),transfer=event.dataTransfer
 if(!lane||!transfer||actionBusy.value||filter.value==='trash'){event.preventDefault();return}
 transfer.effectAllowed='move'
 transfer.setData('text/plain',id)
 dragMotion.start(event.target.closest('.snip-note'),event)
 dragging.value={id,group,tag:lane.tag}
}
function dropPlacement(drag,lane,event){
 const card=event.target.closest('.snip-note'),bounds=card?.getBoundingClientRect()
 const after=!!bounds&&event.clientY>=bounds.top+bounds.height/2
 return snippetDropPlacement(lane.notes,drag.id,card?.dataset.id,after,drag.group===lane.id)
}
function onDragOver({group,event}){
 const drag=dragging.value,lane=groups.value.find(g=>g.id===group)
 if(!drag||!lane||filter.value==='trash')return
 const placement=dropPlacement(drag,lane,event),previous=dropHint.value
 if(!placement){dropHint.value=null;return}
 if(previous?.group===group&&previous.markerId===placement.markerId&&previous.edge===placement.edge)return
 dropHint.value={group,...placement}
}
function onDragLeave(group){if(dropHint.value?.group===group)dropHint.value=null}
function onDragEnd(){dragMotion.endDrag();dragging.value=null;dropHint.value=null}
function cancelDrag(){onDragEnd();dragMotion.cancelLanding()}
async function onDrop({group,event}){
 const drag=dragging.value,lane=groups.value.find(g=>g.id===group)
 const placement=drag&&lane&&filter.value!=='trash'?dropPlacement(drag,lane,event):null
 const landing=placement?dragMotion.hold(event,paneEl()):null
 onDragEnd()
 if(!placement)return
 const sameGroup=drag.group===group
 let order=materializeOrder()
 if(placement.edge!=='existing')order=moveBefore(order,drag.id,placement.beforeId)
 try{
  const result=sameGroup
   ?await action(()=>commands.order(order),'已调整片段顺序')
   :await action(()=>commands.moveToGroup(drag.id,drag.tag,lane.tag,order),'已移到「'+lane.label+'」')
  if(!result||result.empty)return
  if(!sameGroup&&paneEl()){
   const inScope=groups.value.some(g=>g.id===group&&g.notes.some(n=>n.id===drag.id))
   setState(inScope?{group}:{group,filter:'all',tag:'',query:''})
  }
  await nextTick()
  await dragMotion.land(landing,paneEl(),{id:drag.id,group,sameGroup,compact:phone.value})
 }finally{
  dragMotion.cancelLanding(landing)
 }
}
function openMenu({id,group,x,y,trigger}){
 const note=notes.value.find(n=>n.id===id)
 if(note)dialog.value={type:'menu',note,payload:{id,group},x,y,trigger}
}
function closeCardMenu(restoreFocus=false){
 const menu=dialog.value
 if(menu?.type!=='menu')return
 dialog.value=null
 if(restoreFocus&&menu.trigger?.isConnected)menu.trigger.focus({preventScroll:true})
}
async function setCardColor(color){
 const menu=dialog.value
 if(menu?.type!=='menu'||!menu.note||menu.note.deletedAt||!Object.hasOwn(SNIP_CARD_COLORS,color))return
 if(color===menu.note.cardColor){closeCardMenu(true);return}
 const result=await action(()=>commands.patch(menu.note.id,{cardColor:color}),'已更新卡片颜色')
 if(result&&dialog.value===menu)closeCardMenu(true)
}
function onMenuAction(key){
 const menu=dialog.value
 if(menu?.type!=='menu')return
 const {id,group}=menu.payload
 closeCardMenu(true)
 if(key==='edit')startEdit(id,true)
 else if(key==='delete')remove(id)
 else if(key==='restore')restore(id)
 else move(id,group,key==='move-prev'?-1:1)
}
function paneEl(){return shell.value?.querySelector('.snip-lanes')}
function onWorkspaceScroll(event){
 if(event.target!==paneEl())return
 closeCardMenu()
 saveScroll()
}
function saveScroll(){if(restoring||loadingScope||ui.snipStateWorkId!==work.work?.id)return;const el=paneEl();if(!el)return;setState({scroll:{...ui.snipScroll,board:{top:el.scrollTop,left:el.scrollLeft}}})}
async function restoreScroll(){restoring=true;await nextTick();const el=paneEl(),pos=ui.snipScroll.board;if(el){el.scrollTop=pos?.top||0;el.scrollLeft=pos?.left||0}requestAnimationFrame(()=>restoring=false)}
function resetScope(patch){cancelDrag();setState({...patch,scroll:{...ui.snipScroll,board:{top:0,left:0}}});restoreScroll()}
function setFilter(value){resetScope({filter:value,tag:''})}
function setTag(value){resetScope({tag:tag.value===value?'':value,filter:'all'})}
function setSearch(value){cancelDrag();setState({query:value})}
function selectGroup(group){cancelDrag();setState({group})}
function onKeydown(e){
 if(e.isComposing||e.defaultPrevented||work.tab!=='snippets'||!shell.value?.getClientRects().length)return
 const typing=/^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName||'')||e.target?.isContentEditable
 if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();dialog.value=null;detailOpen.value=false;floatingEditorId.value='';nextTick(()=>shell.value?.querySelector('.snip-search input')?.focus());return}
 if(e.key==='Escape'&&dialog.value?.type==='menu'){e.preventDefault();closeCardMenu(true);return}
 if(e.key==='Escape'&&e.target?.closest('.snip-search')&&query.value){e.preventDefault();setSearch('');return}
 if(typing)return
 if((e.ctrlKey||e.metaKey)&&['z','y'].includes(e.key.toLowerCase())){e.preventDefault();stepHistory(e.shiftKey||e.key.toLowerCase()==='y'?'redo':'undo')}
}
function onResize(){
 if(width.value===innerWidth)return
 cancelDrag()
 closeCardMenu()
 const active=document.activeElement,field=active?.closest('.snip-edit-form')?active.name:null,start=active?.selectionStart,end=active?.selectionEnd,wasOpen=detailOpen.value
 saveScroll();width.value=innerWidth
 if(drawer.value)resetSidebarDrag()
 if(!floatingEdit.value){
  if(!narrow.value&&wasOpen){detailOpen.value=false;setState({inspector:{...ui.snipInspector,board:true}})}
  else if(narrow.value&&field)detailOpen.value=true
 }
 nextTick(()=>{restoreScroll();const el=field&&[...document.querySelectorAll('.snip-edit-form [name]')].find(e=>e.name===field&&e.getClientRects().length);if(el){el.focus({preventScroll:true});if(start!=null)el.setSelectionRange(start,end)}})
}
watch(()=>[notes.value,ui.snipStateWorkId,ui.snipPersistence.reading],()=>{if(ui.snipStateWorkId!==work.work?.id||ui.snipPersistence.reading||ui.snipPersistence.readError)return;const order=stableTagOrder(notes.value,ui.snipTagOrder);if(JSON.stringify(order)!==JSON.stringify(ui.snipTagOrder))setState({tagOrder:order})},{immediate:true})
watch(visible,rows=>{if(loadingScope||ui.snipPersistence.reading||ui.snipStateWorkId!==work.work?.id)return;if(!rows.some(n=>n.id===selectedId.value))pick(rows[0]?.id||null)},{flush:'post'})
watch(selectedId,id=>{
 if(id!==floatingEditorId.value)floatingEditorId.value=''
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
watch(()=>work.work?.id,id=>{cancelDrag();resetSidebarDrag();dialog.value=null;detailOpen.value=false;floatingEditorId.value='';loadScope(id)},{flush:'sync'})
onMounted(async()=>{await loadScope(work.work?.id);width.value=innerWidth;window.addEventListener('resize',onResize);window.addEventListener('keydown',onKeydown);shell.value?.addEventListener('scroll',onWorkspaceScroll,{capture:true,passive:true});restoreScroll();shell.value?.classList.add('snip-arrive')})
onBeforeUnmount(()=>{cancelDrag();saveScroll();void ui.flushSnipPersistence();shell.value?.removeEventListener('scroll',onWorkspaceScroll,{capture:true});window.removeEventListener('resize',onResize);window.removeEventListener('keydown',onKeydown);clearTimeout(toastTimer);stopCommands()})
const linkOptions=computed(()=>{const has=new Set((selected.value?.links||[]).map(l=>l.kind+':'+l.id)),out=[];for(const [kind,items,group] of [['chapter',work.liveChapters,'正文'],['mubu',work.liveMubu(),'设定'],['character',work.liveCharacters,'人物']])for(const row of items){const value=kind+':'+row.id;if(!has.has(value))out.push({value,label:kind==='mubu'?work.mubuPath(row.id).map(n=>n.text||'未命名').join(' / '):row.title||row.name||'未命名',group})}return out})
const autosaveError=computed(()=>ui.autosave.error||ui.snipPersistence.readError||ui.snipPersistence.writeError||commandState.value.error)
async function retrySave(){
 await ui.retrySnipPersistence()
 await autosave.flushAll()
 if(commandState.value.pending){
  const previousDialog=dialog.value
  const result=await action(()=>commands.retry(),'已完成保存')
  if(result?.result?.id){
   if(result.result.kind)previewLink(result.result)
   else{
    if(result.phase==='execute'&&result.context?.clearQuick)finishCapture(result.result.id)
    else if(visible.value.some(n=>n.id===result.result.id))pick(result.result.id)
    if(dialog.value===previousDialog)dialog.value=null
   }
  }
 }else if(commandState.value.error)commands.history.get(work.work?.id||'').error=null
 revision.value++
}
</script>


<template>
  <div ref="shell" class="snip-shell">
    <!-- 页头 -->
    <div class="snip-head">
      <div class="snip-heading">
        <button v-if="drawer" type="button" class="snip-mobile-menu" aria-label="打开目录" @click="dialog = { type: 'directory' }">☰</button>
        <button
          v-else
          type="button"
          class="snip-round snip-sidebar-toggle"
          :aria-label="sidebarLabel"
          :title="sidebarLabel"
          :aria-expanded="ui.snipSidebarOpen"
          :aria-controls="sidebarId"
          @click="ui.setPref('snipSidebarOpen', !ui.snipSidebarOpen)"
        >
          <OIcon :name="ui.snipSidebarOpen ? 'back' : 'arrow-right'" :size="16" />
        </button>
        <h1>灵感</h1>
        <span class="snip-crumb">{{ work.work?.title }}</span>
      </div>
      <div class="snip-head-tools">
        <label class="snip-search">
          <OIcon name="search" :size="15" />
          <input :value="query" type="search" aria-label="搜索灵感、标签或关联" placeholder="搜索灵感、标签…" @input="setSearch($event.target.value)">
          <button v-if="query" type="button" class="snip-clear-search" aria-label="清除搜索" @click="resetScope({ query: '' })"><OIcon name="close" :size="15" /></button>
          <span v-else class="snip-key">Ctrl K</span>
        </label>
        <button v-if="filter !== 'trash'" type="button" class="snip-primary" :disabled="actionBusy" @click="dialog = { type: 'compose' }">＋ 记一条</button>
      </div>
    </div>

    <div class="snip-body" :class="{ 'is-nav-collapsed': !ui.snipSidebarOpen }" :style="{ '--snip-sidebar-width': sidebarWidth + 'px' }">
      <SnipNav
        v-show="!drawer && ui.snipSidebarOpen"
        :id="sidebarId"
        v-bind="navProps"
        @filter="setFilter"
        @tag="setTag"
        @toggle-group="toggleGroup"
        @select-note="selectNavNote"
        @card-size="setState({ cardSize: $event })"
        @sort="setState({ sort: $event })"
      />
      <div
        v-if="!drawer && ui.snipSidebarOpen"
        class="snip-resizer"
        role="separator"
        aria-label="调整灵感侧栏宽度"
        aria-orientation="vertical"
        :aria-controls="sidebarId"
        :aria-valuemin="SNIP_SIDEBAR.min"
        :aria-valuemax="SNIP_SIDEBAR.max"
        :aria-valuenow="sidebarWidth"
        tabindex="0"
        @pointerdown="startSidebarResize"
        @pointermove="previewSidebarResize"
        @pointerup="commitSidebarResize"
        @lostpointercapture="resetSidebarDrag"
        @dblclick="setState({ sidebarWidth: SNIP_SIDEBAR.initial })"
        @keydown="resizeSidebarWithKeys"
      ></div>

      <section class="snip-main">
        <div v-if="autosaveError" class="snip-save-error" role="alert">
          <span>保存未完成，内容仍保留在当前页面。</span>
          <button type="button" @click="retrySave">重试保存</button>
        </div>
        <div class="snip-grid" :class="{ 'no-inspector': !showInspector || narrow }">
          <SnipBoard
            :groups="groups"
            :card-size="ui.snipCardSize"
            :trash="filter === 'trash'"
            :scoped="!!tag || filter !== 'all' || !!query"
            :selected-id="selectedId"
            :current="currentGroup"
            :dragging="dragging"
            :drop-hint="dropHint"
            @select="select"
            @edit="startEdit"
            @menu="openMenu"
            @tag="setTag"
            @compose="dialog = { type: 'compose', tag: $event }"
            @group="selectGroup"
            @dragstart="onDragStart"
            @dragend="onDragEnd"
            @dragover="onDragOver"
            @dragleave="onDragLeave"
            @drop="onDrop"
            @clear="resetScope({ filter: 'all', tag: '', query: '' })"
          />

          <SnipInspector
            v-if="!narrow && !floatingEdit"
            :note="selected"
            :draft="draft"
            :conflict="draftConflict"
            @resolve-conflict="resolveConflict"
            @cancel-edit="cancelEdit"
            :busy="actionBusy"
            :save-error="!!autosaveError"
            @retry="retrySave"
            :work-title="work.work?.title || ''"
            :known-tags="knownTags"
            @close="closeDetail"
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
          v-bind="navProps"
          @filter="(v) => { setFilter(v); dialog = null }"
          @tag="(v) => { setTag(v); dialog = null }"
          @toggle-group="toggleGroup"
          @select-note="selectNavNote"
          @card-size="setState({ cardSize: $event })"
          @sort="setState({ sort: $event })"
        />
      </div>
    </SnipModal>
    <SnipModal v-if="selected && (floatingEdit || (narrow && showInspector))" :label="floatingEdit ? '编辑片段' : '片段详情'" @close="closeDetail">
      <div class="snip-dialog snip-detail-dialog" data-dialog="detail" :class="{ 'is-sheet': phone && !floatingEdit, 'snip-floating-editor': floatingEdit }" role="region" :aria-label="floatingEdit ? '编辑片段' : '片段详情'">
        <SnipInspector
          :note="selected"
          :draft="draft"
            :conflict="draftConflict"
            @resolve-conflict="resolveConflict"
            @cancel-edit="cancelEdit"
            :busy="actionBusy"
            :save-error="!!autosaveError"
            @retry="retrySave"
          :work-title="work.work?.title || ''"
          :known-tags="knownTags"
          @close="closeDetail"
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

    <SnipCardMenu
      v-if="dialog?.type === 'menu'"
      :note="dialog.note"
      :group="dialog.payload.group"
      :x="dialog.x"
      :y="dialog.y"
      :busy="actionBusy"
      :save-error="!!autosaveError"
      @close="closeCardMenu"
      @action="onMenuAction"
      @card-color="setCardColor"
      @retry="retrySave"
    />

    <SnipDialog
      v-else-if="dialog && dialog.type !== 'directory'"
      :type="dialog.type"
      :note="dialog.note || selected"
      :tag="dialog.tag ?? tag"
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
      @link="addLink"
      @convert="doConvert"
    />

    <div v-if="toast" class="snip-toast" role="status">
      <span>{{ toast.text }}</span>
      <button v-if="toast.undo" type="button" @click="runUndo">撤销</button>
    </div>
  </div>
</template>
