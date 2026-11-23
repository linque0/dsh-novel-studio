/**
 * 正文创作会话（writing-session）持久化仓：
 * 通过队列串行化同一会话的写入，并用版本号乐观锁抛出 WRITING_CONFLICT 防止跨窗冲突。
 */
import { db } from './database.js'
const versions=new Map(),queues=new Map()
/** 读取指定作品最近的正文创作会话并记录当前持久化版本。 */
export async function loadWritingSession(workId) {
  const rows=await db.airuns.where('workId').equals(workId).filter(r=>r.type==='writing-session').toArray()
  const row=rows.sort((a,b)=>(b.createdAt||0)-(a.createdAt||0)||(b.updatedAt||0)-(a.updatedAt||0))[0]
  if(!row)return null
  versions.set(row.id,row.version||0)
  return {...row.session,persistVersion:row.version||0}
}
/** 串行提交正文会话状态，若库内 version 已被其他窗口推进则抛 WRITING_CONFLICT。 */
export function saveWritingSession(session) {
  const copy=JSON.parse(JSON.stringify(session)),prior=queues.get(copy.id)||Promise.resolve()
  const task=prior.catch(()=>{}).then(async()=>{
    const expected=versions.get(copy.id)??copy.persistVersion??0
    const version=await db.transaction('rw',db.airuns,async()=>{
      const old=await db.airuns.get(copy.id)
      if((old?.version||0)!==expected){const error=new Error('此正文任务已在另一窗口更新');error.code='WRITING_CONFLICT';throw error}
      const next=expected+1
      await db.airuns.put({id:copy.id,workId:copy.workId,type:'writing-session',createdAt:copy.createdAt,updatedAt:Date.now(),version:next,session:copy})
      return next
    })
    versions.set(copy.id,version);return version
  })
  queues.set(copy.id,task)
  return task.finally(()=>{if(queues.get(copy.id)===task)queues.delete(copy.id)})
}
