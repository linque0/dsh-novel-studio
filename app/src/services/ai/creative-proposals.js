import { normalizeReview, normalizeRecheck } from './review-cycle.js'
import { normalizeChapterPlan } from './chapter-plan.js'
import { projectBook } from '../project/normalize.js'
import { taskEvidence } from './task-proposals.js'

export function creativeProposal(data,work,frozen,{runId,messageId}={}) {
  if(!data||JSON.stringify(data).length>300000)throw new Error('阶段产物为空或过长')
  const task=frozen.taskRequest
  const base={id:crypto.randomUUID(),workId:frozen.workId,chapterId:frozen.chapterId,runId,messageId,source:JSON.parse(JSON.stringify(frozen)),complete:true,status:'pending',createdAt:Date.now()}
  if(task.type==='chapter.plan')return {...base,kind:'chapter-plan',title:'场景计划',plan:normalizeChapterPlan(data)}
  if(task.type==='chapter.review'){
    const docs=projectBook(work).docs
    const review=normalizeReview(data,task.draftSource,ref=>{
      if(ref.sourceType==='candidate'&&task.predecessor?.id===ref.sourceId)return {text:task.predecessor.text,verified:true}
      const [verified]=taskEvidence([ref],work,frozen)
      const doc=docs.find(d=>d.id===verified.docId)
      return {text:doc.plainText,verified:true}
    })
    return {...base,kind:'chapter-review',title:'独立审稿',review}
  }
  if(task.type==='chapter.recheck')return {...base,kind:'chapter-recheck',title:'定向复核',check:normalizeRecheck(data,task.confirmedReview,task.revisedDraft)}
  throw new Error('不支持的创作阶段')
}
