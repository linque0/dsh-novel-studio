import { db, uid } from '../../db/database.js'
import { autosave } from '../autosave.js'
import { leaseJob, updateJob } from '../../db/ai-repo.js'
import { readSourceSnapshot } from '../../db/project-repo.js'
import { SOURCE_TABLES, sourceManifest } from '../project/normalize.js'
import { rowHash, chapterHash, hashContent } from '../project/text.js'
import { isPopped } from '../panelwindows.js'
import { taskProfile } from './task-profiles.js'
import { workflowChanges } from './task-proposals.js'
import { knowledgeSnapshot, sourceLayout } from './knowledge.js'
import { clearChapterStale } from './summarize.js'

const tables = [...SOURCE_TABLES,'aisum','aikb','airuns']
function locks(work, changes) {
  for (const c of changes) {
    const type = {olnodes:'outline',mubu:'lore',characters:'characters',relations:'characters',snippets:'snippets',aisum:'chapter',aikb:'chapter'}[c.table]
    const id = ['outline','lore'].includes(type)?'':(['aisum','aikb'].includes(c.table)?c.after.chapterId||c.after.entityId:c.id)
    if (isPopped(work,type,id)) throw new Error('目标被其他窗口锁定，请到对应窗口操作')
    if (c.table==='relations' && [c.after.fromId,c.after.toId].some(id=>isPopped(work,'characters',id))) throw new Error('关系人物被其他窗口锁定')
    if (c.table==='aikb' && c.after.refType==='character' && isPopped(work,'characters',c.after.refId)) throw new Error('状态人物被其他窗口锁定')
  }
}
function sync(work,changes,undo=false) {
  for(const c of changes) {
    if(!Array.isArray(work[c.table]))continue
    const row=undo?c.before:c.after,index=work[c.table].findIndex(r=>r.id===c.id)
    if(row){if(index<0)work[c.table].push(row);else work[c.table][index]=row}
    else if(index>=0)work[c.table].splice(index,1)
  }
}
export async function applyWorkflow(work,card,options={}) {
  if(card.kind!=='workflow'||card.status==='applied'||card.status==='rejected'||card.complete===false)throw new Error('提案不可应用')
  if(work.work?.id!==card.workId||card.source?.taskRequest?.type!==card.taskType||taskProfile(card.taskType).module!==card.task)throw new Error('任务类型或作品不匹配')
  if(options.action && options.action!=='apply')throw new Error('专用提案仅支持确认应用')
  await autosave.flushAll()
  const owner=uid(),leaseId='apply:'+card.workId
  if(!await leaseJob({id:leaseId,workId:card.workId,type:'application-lock',owner}))throw new Error('另一窗口正在应用或撤销提案')
  const auditId=uid()
  let changes
  try {
    await db.transaction('rw',tables.map(t=>db.table(t)),async()=>{
      if(work.work?.id!==card.workId||sourceManifest(work).hash!==card.source.bookRevision)throw new Error('作品资料已变化，请重新生成')
      const snapshot=await readSourceSnapshot(card.workId)
      if(sourceManifest(snapshot).hash!==card.source.bookRevision)throw new Error('数据库中的生成依据已变化，请重新生成')
      if(await db.airuns.where('workId').equals(card.workId).filter(r=>r.type==='workflow-application'&&r.cardId===card.id&&r.status==='applied').count())throw new Error('此提案已经应用')
      snapshot.aisum=await db.aisum.where('workId').equals(card.workId).toArray()
      changes=workflowChanges(card,snapshot,options)
      locks(work,changes)
      for(const change of changes)await db.table(change.table).put(change.after)
      await db.airuns.put({id:auditId,workId:card.workId,type:'workflow-application',taskType:card.taskType,cardId:card.id,status:'applied',changes,createdAt:Date.now()})
    })
    if(work.work?.id===card.workId)sync(work,changes)
    for(const c of changes)if(c.table==='aisum')clearChapterStale(c.after.entityId)
    Object.assign(card,{status:'applied',auditId,appliedActions:['apply']})
    window.native?.appBroadcast?.({kind:'kb-changed',data:{workId:card.workId}})
    return {ok:true,auditId,affected:changes.map(c=>c.id)}
  } finally {await updateJob(leaseId,owner,{owner:null,leaseUntil:0,status:'completed'})}
}
export async function undoWorkflow(work,audit) {
  if(work.work?.id!==audit.workId)throw new Error('撤销记录属于其他作品')
  await autosave.flushAll()
  const owner=uid(),leaseId='apply:'+audit.workId
  if(!await leaseJob({id:leaseId,workId:audit.workId,type:'application-lock',owner}))throw new Error('另一窗口正在应用或撤销提案')
  try {
    await db.transaction('rw',tables.map(t=>db.table(t)),async()=>{
      const current=await db.airuns.get(audit.id)
      if(work.work?.id!==audit.workId||current?.status!=='applied')throw new Error('作品已切换或记录已撤销')
      locks(work,audit.changes)
      for(const c of audit.changes) {
        const row=await db.table(c.table).get(c.id),live=Array.isArray(work[c.table])?work[c.table].find(r=>r.id===c.id):row
        if(!row||!live||rowHash(row)!==c.afterHash||rowHash(live)!==c.afterHash)throw new Error('应用后内容已变化，不能覆盖后续编辑')
      }
      for(const c of audit.changes) {
        if(c.before)await db.table(c.table).put(c.before)
        else await db.table(c.table).delete(c.id)
      }
      await db.airuns.update(audit.id,{status:'undone',updatedAt:Date.now()})
    })
    sync(work,audit.changes,true)
    window.native?.appBroadcast?.({kind:'kb-changed',data:{workId:audit.workId}})
  } finally {await updateJob(leaseId,owner,{owner:null,leaseUntil:0,status:'completed'})}
}

export async function confirmDerived(work, table, id) {
  if (!['aisum','aikb'].includes(table) || !work.work) throw new Error('确认目标无效')
  await autosave.flushAll()
  const workId=work.work.id, revision=sourceManifest(work).hash
  let summaryChapterId
  await db.transaction('rw',[...tables,'aikbmeta','aidecisions'].map(t=>db.table(t)),async()=>{
    const snapshot=await readSourceSnapshot(workId)
    if(work.work?.id!==workId||sourceManifest(snapshot).hash!==revision||sourceManifest(work).hash!==revision)throw new Error('生成依据已变化，请刷新后重新提取')
    const row=await db.table(table).get(id)
    if(!row||row.workId!==workId||row.deletedAt)throw new Error('记忆不存在')
    if(table==='aisum') {
      const ch=snapshot.chapters.find(c=>c.id===row.entityId&&!c.deletedAt)
      if(!ch||row.contentHash!==hashContent(ch.content||'')||row.sourceHash!==chapterHash(ch)||row.coverageVersion!==1)throw new Error('摘要过期或覆盖不完整，请重新提取')
      summaryChapterId=ch.id
    } else {
      const snap=await knowledgeSnapshot(snapshot)
      if(row.kind==='arc') {
        if(!row.body?.summary||row.sourceLayout!==sourceLayout(snapshot)||!row.dependencies?.length||!row.dependencies.every(id=>snap.cards.some(c=>c.id===id)))throw new Error('先确认有效章节事实，再重新构建分层摘要')
      } else {
        const ch=snapshot.chapters.find(c=>c.id===row.chapterId&&!c.deletedAt)
        if(!row.verified||!ch||row.sourceHash!==chapterHash(ch)||(!row.taskMemory&&!snap.valid.has(ch.id)))throw new Error('事实证据过期或未完整验证，请重新提取')
        if(row.taskMemory && (row.sourceVersions || []).some(v=>{
          const source=v.table==='works'?snapshot.work:snapshot[v.table]?.find(r=>r.id===v.id&&!r.deletedAt)
          return !source || (v.table==='chapters'?chapterHash(source):rowHash(source))!==v.hash
        }))throw new Error('事实的相关资料已变化，请重新提取')
      }
    }
    await db.table(table).update(id,{assertionStatus:'confirmed',confirmedAt:Date.now()})
  })
  if(summaryChapterId)clearChapterStale(summaryChapterId)
  window.native?.appBroadcast?.({kind:'kb-changed',data:{workId}})
}
