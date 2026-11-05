import { interruptWorkflow } from './workflow-core.js'
import { chapterHash } from '../project/text.js'
export const mergeMemoryIntent = (prior={},next={}) => ({...prior,...next,memoryIntent:next.memoryIntent||prior.memoryIntent})
export function memoryJob(chapter,intent={},now=Date.now()) {
  if(!chapter?.id||!chapter.workId||chapter.deletedAt)throw new Error('记忆来源章节无效')
  const sourceHash=chapterHash(chapter)
  return {id:`memory:${chapter.workId}:${chapter.id}:${sourceHash}`,type:'memory-queue',schemaVersion:1,workId:chapter.workId,chapterId:chapter.id,sourceHash,applicationId:intent.applicationId||null,status:'pending',steps:{extraction:'pending',summary:'pending'},autoEligible:true,owner:null,leaseUntil:0,createdAt:now,updatedAt:now}
}
export const isMemoryCurrent = (job,chapter) => !!chapter&&!chapter.deletedAt&&chapter.workId===job.workId&&chapterHash(chapter)===job.sourceHash
export function recoverMemoryJob(job) {
  if(job.type==='story-document')return {...job,incarnation:crypto.randomUUID()}
  if(job.type==='story-run')return {...job,status:job.status==='running'||job.status==='paused'?'interrupted':job.status,owner:null,leaseUntil:0}
  if(job.type==='creative-workflow')return {...interruptWorkflow(JSON.parse(JSON.stringify(job)),'运行已中断；恢复备份后须手动继续'),incarnation:crypto.randomUUID(),owner:null,leaseUntil:0}
  return job.type==='memory-queue'?{...job,status:job.status==='running'?'interrupted':job.status,owner:null,leaseUntil:0,autoEligible:false}:job
}
