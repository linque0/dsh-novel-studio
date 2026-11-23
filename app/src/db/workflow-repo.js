/**
 * 创作工作流运行记录（creative-workflow）的持久化仓：
 * 串行化单运行保存，并检查采纳锁（apply:<workId>）、备份代数 incarnation 与版本号 version。
 */
import { db } from './database.js'
import { assertCandidateDependencies } from '../services/ai/workflow-core.js'
import { freezeDraft } from '../services/ai/review-cycle.js'

const copy=value=>JSON.parse(JSON.stringify(value))
const saves=new Map()
export const CREATIVE_WINDOW_ORIGIN=crypto.randomUUID()
/** 读取作品下的创作任务记录，按最近更新时间倒序返回。 */
export async function loadCreativeWorkflows(workId) {
  const rows=await db.airuns.where('workId').equals(workId).filter(r=>r.type==='creative-workflow').toArray()
  return rows.sort((a,b)=>b.updatedAt-a.updatedAt)
}
/** 串行保存创作任务运行态，防止与正文采纳事务或跨窗编辑互相覆盖。 */
export function saveCreativeWorkflow(run) {
  const task=(saves.get(run.id)||Promise.resolve()).catch(()=>{}).then(async()=>{
  const snapshot=copy(run)
  const version=await db.transaction('rw',db.airuns,async()=>{
    const applying=await db.airuns.get('apply:'+run.workId)
    if(applying?.owner&&applying.status==='running'&&applying.leaseUntil>Date.now())throw new Error('正文正在采纳，请稍后保存创作任务编辑')
    const old=await db.airuns.get(run.id)
    if(!old&&snapshot.version)throw new Error('任务记录已被恢复或删除，拒绝重新发布旧运行')
    if(old&&old.incarnation!==snapshot.incarnation)throw new Error('任务已从备份恢复，拒绝恢复前的迟到保存')
    if(old&&(old.version||0)!==(snapshot.version||0))throw new Error('另一窗口已更新此创作任务，请重新打开，当前修改未覆盖它')
    snapshot.version=(old?.version||0)+1;snapshot.updatedAt=Date.now()
    await db.airuns.put(snapshot)
    run.version=snapshot.version
    return snapshot.version
  })
  window.native?.appBroadcast?.({kind:'creative-workflow-changed',data:{workId:run.workId,runId:run.id,origin:CREATIVE_WINDOW_ORIGIN}})
  return version
  });saves.set(run.id,task);return task
}
/** 采纳前校验候选产物已落库、内容哈希未脏且前置阶段依赖全部有效。 */
export async function assertStoredCandidate(card) {
  const binding=card.workflowBinding
  if(!binding)return
  const run=await db.airuns.get(binding.runId)
  const stored=run?.chapters[binding.chapterIndex]?.artifacts.find(c=>c.id===binding.artifactId)
  if(!stored||run.workId!==card.workId||['rejected','stale','incomplete'].includes(stored.status))throw new Error('此创作候选已失效')
  if(freezeDraft(stored).contentHash!==freezeDraft(card).contentHash)throw new Error('候选修改尚未保存，请先保存编辑')
  assertCandidateDependencies(run,stored)
  return {run,stored}
}
