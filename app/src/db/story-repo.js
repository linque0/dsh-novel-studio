import {db} from './database.js'
import {chapterHash,rowHash} from '../services/project/text.js'
const saves=new Map()
const copy=v=>JSON.parse(JSON.stringify(v))
export const STORY_WINDOW_ORIGIN=crypto.randomUUID()
export const storyDocumentId=(workId,chapterId)=>'story-document:'+workId+':'+chapterId
export async function readStoryDocument(workId,chapterId){return db.airuns.get(storyDocumentId(workId,chapterId))}
export function saveStoryDocument(doc){
  const task=(saves.get(doc.id)||Promise.resolve()).catch(()=>{}).then(async()=>{
    const value=copy(doc)
    await db.transaction('rw',db.airuns,db.chapters,async()=>{
      const chapter=await db.chapters.get(value.chapterId)
      if(!chapter||chapter.deletedAt||chapter.workId!==value.workId)throw new Error('故事章节已删除，当前输入保留在窗口中')
      const old=await db.airuns.get(value.id)
      if((!old&&value.version)||old&&(old.incarnation!==value.incarnation||old.version!==value.version))throw new Error('工作稿在另一窗口或恢复后已变化，拒绝覆盖；当前输入仍保留')
      value.version=(old?.version||0)+1;value.updatedAt=Date.now()
      await db.airuns.put(value)
    })
    doc.version=value.version;doc.updatedAt=value.updatedAt
    window.native?.appBroadcast?.({kind:'story-document-changed',data:{workId:doc.workId,chapterId:doc.chapterId,version:doc.version,origin:STORY_WINDOW_ORIGIN}})
    return value
  })
  saves.set(doc.id,task);return task
}
export async function assertStoryStored(doc){
  const stored=await db.airuns.get(doc.id)
  if(!stored||stored.incarnation!==doc.incarnation||stored.version!==doc.version||stored.revision!==doc.revision||stored.text!==doc.text||stored.html!==doc.html)throw new Error('工作稿来源已变化，请重新审读')
}
export async function assertStoryBinding(binding){
  const stored=await db.airuns.get(binding.id)
  if(!stored||stored.type!=='story-document'||stored.incarnation!==binding.incarnation||stored.version!==binding.version||stored.revision!==binding.revision||stored.text!==binding.text||stored.html!==binding.html)throw new Error('待确认工作稿版本已变化，拒绝应用旧快照')
}
export async function recoverStoryConfirmation(doc){
  if(doc.status==='confirmed')return doc
  return db.transaction('rw',db.airuns,db.chapters,async()=>{
    const current=await db.airuns.get(doc.id),chapter=await db.chapters.get(doc.chapterId)
    if(!current||current.version!==doc.version||current.incarnation!==doc.incarnation||!chapter||chapter.deletedAt)return doc
    const cardId='story-confirm:'+doc.id+':'+doc.revision
    const audits=await db.airuns.where('workId').equals(doc.workId).filter(r=>r.type==='application'&&r.cardId===cardId&&r.status==='applied').toArray()
    const audit=audits.find(r=>r.changes?.some(c=>c.table==='chapters'&&c.id===chapter.id&&c.afterHash===rowHash(chapter)))
    if(!audit)return doc
    const recovered={...copy(doc),status:'confirmed',sourceHash:chapterHash(chapter),confirmationAuditId:audit.id,version:doc.version+1,updatedAt:Date.now()}
    await db.airuns.put(recovered)
    return recovered
  })
}
