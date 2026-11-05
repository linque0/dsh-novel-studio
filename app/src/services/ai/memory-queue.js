import { db, uid } from '../../db/database.js'
import { readSourceSnapshot } from '../../db/project-repo.js'
import { sourceManifest } from '../project/normalize.js'
import { hashContent } from '../project/text.js'
import { buildKnowledge } from './knowledge.js'
import { updateJob } from '../../db/ai-repo.js'
import { isMemoryCurrent } from './memory-queue-core.js'
import { freezeStage, loadStageConfig } from './stage-config.js'
const active=new Map()
let drain=Promise.resolve()
const deferred=new Map()
let retryTimer=null
function retryDeferred() {
  clearTimeout(retryTimer)
  if(!deferred.size)return
  retryTimer=setTimeout(()=>{const requests=[...deferred.values()];deferred.clear();for(const {ai,request} of requests)runMemoryQueue(ai,request).catch(console.error)},1000)
}
export const listMemoryJobs=async workId=>{await recoverMemoryQueue();return (await db.airuns.where('workId').equals(workId).toArray()).filter(r=>r.type==='memory-queue').sort((a,b)=>b.createdAt-a.createdAt)}
export function cancelMemoryJobs(workId) {for(const [key,entry]of deferred)if(!workId||entry.request.workId===workId)deferred.delete(key);retryDeferred();for(const run of active.values())if(!workId||run.workId===workId)run.ctl.abort()}
export async function recoverMemoryQueue() {
  const changed=new Set()
  await db.transaction('rw',db.airuns,async()=>{for(const row of await db.airuns.toArray())if(row.type==='memory-queue'&&row.status==='running'&&row.leaseUntil<Date.now()){await db.airuns.put({...row,status:'interrupted',owner:null,leaseUntil:0,autoEligible:false});changed.add(row.workId)}})
  for(const workId of changed)window.dispatchEvent(new CustomEvent('memory-queue-changed',{detail:{workId}}))
}
export async function retryMemoryJob(id) {
  const row=await db.airuns.get(id)
  if(row?.type!=='memory-queue')throw new Error('记忆任务不存在')
  if(row.status==='running'&&row.leaseUntil>Date.now())throw new Error('记忆任务正在运行')
  if(!isMemoryCurrent(row,await db.chapters.get(row.chapterId)))throw new Error('正文已变化，不能重试旧记忆任务')
  await db.airuns.put({...row,status:'pending',autoEligible:true,error:'',owner:null,leaseUntil:0})
  const detail={workId:row.workId,jobId:id}
  window.dispatchEvent(new CustomEvent('memory-queue-ready',{detail}))
  window.native?.appBroadcast?.({kind:'memory-queue-ready',data:detail})
}
export function runMemoryQueue(ai,request={}) {
  const next=drain.catch(()=>{}).then(()=>drainMemoryQueue(ai,request))
  drain=next
  return next
}
async function drainMemoryQueue(ai,{workId,jobId}={}) {
  if(ai.privacy||!ai.ready)return
  if(ai.busy||ai.kb.progress?.status==='running'){
    // Only this session's explicit saved-job events enter this volatile queue.
    if(jobId){deferred.set(jobId,{ai,request:{workId,jobId}});retryDeferred()}
    return
  }
  const jobs=(await listMemoryJobs(workId)).filter(j=>(!jobId||j.id===jobId)&&j.status==='pending'&&j.autoEligible)
  for(const job of jobs) {
    if(ai.privacy)return
    const owner=uid(),ctl=new AbortController()
    const claimed=await db.transaction('rw',db.airuns,async()=>{
      const current=await db.airuns.get(job.id)
      if(current?.status!=='pending'||!current.autoEligible)return false
      await db.airuns.put({...current,status:'running',owner,leaseUntil:Date.now()+120000});return true
    })
    if(!claimed)continue
    active.set(job.id,{ctl,workId})
    const heartbeat=setInterval(()=>updateJob(job.id,owner,{leaseUntil:Date.now()+120000}).catch(()=>ctl.abort()),20000)
    let status='failed',error=''
    try {
      const chapter=await db.chapters.get(job.chapterId)
      if(!isMemoryCurrent(job,chapter))throw new Error('来源正文已变化')
      const sourceVersion=sourceManifest(await readSourceSnapshot(workId)).hash
      const selected=freezeStage(await loadStageConfig(),'memory',{providers:ai.providers,presets:ai.presets})
      const stage={...selected,providerId:selected.providerId||ai.activeProviderId,model:selected.model||ai.model,presetSnapshot:selected.presetSnapshot||JSON.parse(JSON.stringify(ai.presets.find(p=>p.id===ai.selectedPresetId)||ai.presets[0]||null))}
      await updateJob(job.id,owner,{sourceVersion,stageSnapshot:stage})
      const guard={id:job.id,owner,sourceVersion,workId}
      const assertSourceCurrent=async()=>{
        const current=await db.airuns.get(job.id)
        if(ctl.signal.aborted||ai.privacy||current?.owner!==owner||current.status!=='running'||current.leaseUntil<Date.now()||sourceManifest(await readSourceSnapshot(workId)).hash!==sourceVersion) {ctl.abort();throw new Error('记忆任务来源或租约已失效')}
      }
      const opts=await ai.buildOpts(stage)
      await assertSourceCurrent()
      await buildKnowledge({workId,onlyIds:[job.chapterId],queue:true,owner:uid(),opts:{...opts,stageSnapshot:stage,signal:ctl.signal,queueGuard:guard,assertSourceCurrent},shouldPause:()=>ctl.signal.aborted||ai.privacy,onUsage:u=>ai.addUsage(u)})
      await assertSourceCurrent()
      const [meta,summary]=await Promise.all([db.aikbmeta.get(`${workId}:${job.chapterId}`),db.aisum.where('[entityType+entityId]').equals(['chapter',job.chapterId]).first()])
      const steps={extraction:meta?.status==='success'&&meta.sourceHash===job.sourceHash?'completed':'failed',summary:summary?.contentHash===hashContent(chapter.content||'')&&summary?.sourceHash===job.sourceHash?'completed':'failed'}
      status=Object.values(steps).every(v=>v==='completed')?'completed':'failed'
      await updateJob(job.id,owner,{steps})
      if(status==='failed')error='记忆或摘要未完整生成，可手动重试；正文已保留'
    } catch(e) {status=ctl.signal.aborted?'interrupted':'failed';error=e.message}
    finally {clearInterval(heartbeat);active.delete(job.id);await updateJob(job.id,owner,{status,error,owner:null,leaseUntil:0,autoEligible:false});await ai.refreshKnowledge();window.dispatchEvent(new CustomEvent('memory-queue-changed',{detail:{workId}}));window.native?.appBroadcast?.({kind:'memory-queue-changed',data:{workId}})}
  }
}
