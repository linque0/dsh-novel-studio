import { assertReviewCurrent } from './review-cycle.js'
import { assertCandidateDependencies, assertRecheckCurrent } from './workflow-core.js'

export function canExecuteCreativeHere(search = '') {
  const panel = new URLSearchParams(search).get('panel')?.split(':')[0]
  return !panel || panel === 'agent'
}
export function chapterWorkbenchState(run, chapterId) {
  const index = run?.chapters.findIndex(ch => ch.chapterId === chapterId) ?? -1
  const chapter = run?.chapters[index]
  const candidate = chapter?.artifacts.filter(c => c.complete && !['rejected','stale'].includes(c.status)).at(-1)
  const result = {index,chapter,candidate,stale:false,reason:'',action:'plan',label:'待规划',actionLabel:'生成场景计划'}
  if (!chapter) return result
  if (!candidate) return {...result,action:chapter.plan?'draft':'plan',label:chapter.plan?'场景已规划':'待规划',actionLabel:chapter.plan?'按计划起草':'生成场景计划'}
  try {
    assertCandidateDependencies(run,candidate)
    if(chapter.review) {
      if(candidate.id === chapter.review.sourceDraft.id) assertReviewCurrent(chapter.review,candidate)
      else if(candidate.parentDraftId !== chapter.review.sourceDraft.id) throw new Error('审稿不属于当前候选')
      if(chapter.check)assertRecheckCurrent(chapter.check,candidate)
    }
  } catch(e) {return {...result,stale:true,reason:e.message,action:'review',label:'需重审',actionLabel:'重新独立审稿'}}
  if(candidate.status==='applied')return {...result,action:'adopted',label:'作者已采纳',actionLabel:'查看正式正文'}
  if(chapter.revisionId && candidate.id === chapter.revisionId)return {...result,action:chapter.check?'adopt':'recheck',label:chapter.check?'待作者采纳':'修稿待复核',actionLabel:chapter.check?'审读并采纳':'定向复核'}
  if(chapter.review)return {...result,action:'revise',label:'意见待确认',actionLabel:'按所选意见修稿'}
  return {...result,action:'review',label:'候选待审',actionLabel:'独立审稿'}
}
export const AGENT_PAGES = Object.freeze([
  {id:'create',label:'创作台',icon:'edit'},
  {id:'planning',label:'故事规划',icon:'network'},
  {id:'production',label:'章节生产',icon:'layers'},
  {id:'review',label:'审稿与修订',icon:'check'},
  {id:'materials',label:'作品资料',icon:'bookmark'},
  {id:'runs',label:'运行与历史',icon:'history'},
])
