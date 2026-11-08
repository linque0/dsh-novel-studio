import {db,uid,now} from '../db/database'
import {putRow} from '../db/repo'
import {SOURCE_TABLES} from './project/normalize.js'
import {autosave} from './autosave'
import {countWords} from './wordcount.js'
import {createSnippetHistory,fingerprint} from './snippet-history.js'
import {joinContent,splitNote,normalizeTags,normalizeLinks} from '../components/snippets/snippet-model.js'

const clone=value=>JSON.parse(JSON.stringify(value)),kindTable={chapter:'chapters',mubu:'mubu',character:'characters',snippet:'snippets'}
const conflict=message=>Object.assign(new Error(message||'内容已在其他位置修改，未覆盖新数据。'),{code:'CONFLICT'})
function hasReference(row,table,target){
 const id=target.id,kind={chapters:'chapter',mubu:'mubu',snippets:'snippet',outlines:'outline'}[target.table]
 if((row.links||[]).some(l=>l.id===id&&(l.kind||l.type)===kind)||(row.aiLinks||[]).some(l=>l.id===id))return true
 if(target.table==='mubu'&&table==='mubu'&&row.parentId===id)return true
 if(target.table==='chapters'&&['olnodes','outlines','annotations'].includes(table)&&[row.refId,row.chapterId].includes(id))return true
 if(table==='lorelinks'&&((row.fromId===id&&row.fromKind===kind)||(row.toId===id&&row.toKind===kind)))return true
 if(table==='links'&&row.entityId===id)return true
 const text=[row.content,row.html,row.text,row.bio,row.description].filter(x=>typeof x==='string').join('\n')
 return !!kind&&[kind+':'+id,kind+'%3A'+encodeURIComponent(id)].some(token=>text.includes('data-dl-target="'+token+'"')||text.includes("data-dl-target='"+token+"'")||text.includes('[['+token+']]'))
}
/** All rows and source notifications commit together; expected data excludes save timestamps only. */
async function applyChanges(workId,changes,{created=[]}={}){
 const tables=[...new Set([...SOURCE_TABLES,'appconfig','wordlog'])]
 await db.transaction('rw',tables.map(t=>db.table(t)),async()=>{
  const w=await db.works.get(workId);if(!w||w.deletedAt)throw conflict('作品已不可用。')
  const projected=new Map()
  for(const c of changes){
   if(!['snippets','chapters','outlines','mubu','appconfig'].includes(c.table))throw Error('不支持的灵感操作')
   const row=await db.table(c.table).get(c.id),actual=c.scope==='order'?{order:row?.value?.order||[]}:row||null
   if(c.table==='appconfig'&&c.id!=='snipstate:'+workId)throw Error('不能修改其他作品状态')
   if(c.table!=='appconfig'&&c.after?.workId!==workId)throw Error('不能跨作品修改')
   if(fingerprint(actual)!==fingerprint(c.before))throw conflict()
   projected.set(c.table+':'+c.id,c.after)
  }
  for(const c of changes.filter(c=>c.table==='snippets')){
   const old=new Set((c.before?.links||[]).map(l=>l.kind+':'+l.id))
   for(const link of c.after.links||[]){
    if(old.has(link.kind+':'+link.id))continue
    const table=kindTable[link.kind],target=table&&(projected.get(table+':'+link.id)||await db.table(table).get(link.id))
    if(!target||target.deletedAt||target.workId!==workId)throw conflict('关联目标已不可用，请重新选择。')
   }
  }
  if(created.length){
   for(const table of SOURCE_TABLES.filter(t=>t!=='works')){
    const source=table==='links'?await db.links.toArray():await db.table(table).where('workId').equals(workId).toArray()
    for(const original of source){const row=projected.get(table+':'+original.id)||original;if(row.deletedAt)continue
     if(created.some(target=>hasReference(row,table,target)))throw conflict('新建内容已被其他条目引用，未撤销以免破坏关联。')
    }
   }
  }
  for(const c of changes){
   if(c.scope==='order'){const current=await db.appconfig.get(c.id);await db.appconfig.put({key:c.id,value:{...(current?.value||{}),order:c.after.order}})}
   else await putRow(c.table,clone(c.after),{recordWordDelta:c.table==='chapters',inTransaction:true})
  }
 })
}
const instances=new WeakMap()
export function snippetCommandsFor(work,ui){
 if(instances.has(work))return instances.get(work)
 const listeners=new Set(),update=()=>listeners.forEach(fn=>fn())
 const history=createSnippetHistory({
  before:async()=>{await autosave.flushAll();if(ui.autosave.error||ui.autosave.pending)throw Error('已有修改尚未保存，请先重试保存。');if(!await ui.flushSnipPersistence())throw Error('草稿或界面状态尚未保存，请先重试。')},
  apply:applyChanges,changed:update,
  committed:async(workId,pending)=>{
   for(const c of pending.changes){
    if(c.scope==='order'){ui.saveSnipState({order:c.after.order,sort:pending.phase==='undo'?pending.entry.context?.beforeSort||'manual':pending.entry.context?.afterSort||'manual'},workId);continue}
    if(work.work?.id!==workId)continue
    const rows=work[c.table];if(!Array.isArray(rows))continue
    const index=rows.findIndex(r=>r.id===c.id),row=clone(c.after)
    if(index<0)rows.push(row);else rows.splice(index,1,row)
    if(c.table==='mubu')work.mubuRevision++
   }
   if(pending.phase==='execute'){
    const ctx=pending.entry.context||{}
    const session=ui.getSnipSession(workId)
    if(ctx.clearDraftId){
     const current=session.drafts.edit[ctx.clearDraftId],source=pending.changes.find(c=>c.table==='snippets'&&c.id===ctx.clearDraftId)?.after
     if(!current||current.title===ctx.submitted?.title&&current.body===ctx.submitted?.body)ui.setSnipDraft(ctx.clearDraftId,null,workId)
     else if(source)ui.setSnipDraft(ctx.clearDraftId,{...current,base:fingerprint(source)},workId)
    }
    if(ctx.clearQuick&&session.drafts.quick===ctx.quickContent)ui.saveSnipDrafts({quick:''},workId)
   }
   update()
  }
 })
 const currentId=()=>{if(!work.work?.id)throw Error('请先打开作品');return work.work.id}
 const readNote=async(id,workId)=>{const row=await db.snippets.get(id);if(!row||row.workId!==workId)throw conflict('灵感已不可用。');return row}
 const run=prepare=>{const workId=currentId();return history.execute(workId,()=>prepare(workId))}
 const change=(table,before,after)=>({table,id:after.id,before:before?clone(before):null,after:clone(after)})
 const api={
  history,subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn)},
  async refresh(workId=currentId()){
   const bundle=await Promise.all(['snippets','chapters','outlines','mubu'].map(t=>db.table(t).where('workId').equals(workId).toArray()))
   if(work.work?.id===workId)['snippets','chapters','outlines','mubu'].forEach((t,i)=>work[t]=bundle[i])
  },
  capture(content,tags=[],quickContent=content){return run(async workId=>{
   const t=now(),row={id:uid(),workId,content,tags:normalizeTags(tags),links:[],createdAt:t,updatedAt:t,deletedAt:null}
   return {changes:[change('snippets',null,row)],createdIds:[row.id],result:{id:row.id},context:{clearQuick:true,quickContent}}
  })},
  patch(id,patch,{expected,clearDraft=false,submitted}={}){return run(async workId=>{
   const before=await readNote(id,workId)
   if(expected&&fingerprint(before)!==expected)throw conflict('原片段已变化，草稿已保留，请核对后重新保存。')
   const after={...clone(before),...(typeof patch==='function'?patch(clone(before)):patch)}
   return {changes:fingerprint(before)===fingerprint(after)?[]:[change('snippets',before,after)],result:{id},context:clearDraft?{clearDraftId:id,submitted}:{}}
  })},
  order(order){return run(async workId=>{
   const row=await db.appconfig.get('snipstate:'+workId),before={order:row?.value?.order||[]}
   return {changes:[{table:'appconfig',id:'snipstate:'+workId,scope:'order',before,after:{order}}],context:{beforeSort:ui.snipSort,afterSort:'manual'}}
  })},
  tagAndOrder(id,tag,order){return run(async workId=>{
   const before=await readNote(id,workId),after={...clone(before),tags:normalizeTags([...(before.tags||[]),tag])},row=await db.appconfig.get('snipstate:'+workId)
   return {changes:[change('snippets',before,after),{table:'appconfig',id:'snipstate:'+workId,scope:'order',before:{order:row?.value?.order||[]},after:{order}}],context:{beforeSort:ui.snipSort,afterSort:'manual'}}
  })},
  convert(id,kind,dest){return run(async workId=>{
   const source=await readNote(id,workId),{title,body}=splitNote(source),t=now(),targetId=uid(),changes=[]
   if(kind==='chapter'){
    const volume=dest?await db.volumes.get(dest):null
    if(dest&&(!volume||volume.deletedAt||volume.workId!==workId))throw conflict('分卷已不可用。')
    const all=await db.chapters.where('workId').equals(workId).toArray(),sortOrder=Math.max(-1000,...all.filter(c=>!c.deletedAt&&(c.volumeId||null)===(dest||null)).map(c=>c.sortOrder||0))+1000
    const row={id:targetId,workId,volumeId:dest||null,title:title||'灵感章节',content:body,fmt:'text',wordCount:countWords(body),status:'draft',sortOrder,createdAt:t,updatedAt:t,deletedAt:null}
    changes.push(change('chapters',null,row),change('outlines',null,{id:uid(),workId,level:'chapter',refId:targetId,content:'',createdAt:t,updatedAt:t,deletedAt:null}))
   }else{
    const all=await db.mubu.where('workId').equals(workId).toArray(),parent=dest?all.find(n=>n.id===dest&&!n.deletedAt):null
    if(dest&&!parent)throw conflict('设定位置已不可用。')
    const sortOrder=Math.max(-1000,...all.filter(n=>!n.deletedAt&&(n.parentId||null)===(dest||null)).map(n=>n.sortOrder||0))+1000
    const node={id:targetId,workId,parentId:dest||null,text:title||'新设定',html:null,sortOrder,fold:false,createdAt:t,updatedAt:t,deletedAt:null}
    changes.push(change('mubu',null,node))
    if(body)changes.push(change('mubu',null,{...node,id:uid(),parentId:targetId,text:body,sortOrder:0}))
   }
   const after={...clone(source),links:normalizeLinks([...(source.links||[]),{kind:kind==='chapter'?'chapter':'mubu',id:targetId}])}
   changes.push(change('snippets',source,after))
   return {changes,createdIds:changes.filter(c=>!c.before).map(c=>c.id),result:{id:targetId,kind:kind==='chapter'?'chapter':'mubu',sourceId:id}}
  })},
  step:direction=>history.step(currentId(),direction),retry:()=>history.retry(currentId())
 }
 instances.set(work,api);return api
}
