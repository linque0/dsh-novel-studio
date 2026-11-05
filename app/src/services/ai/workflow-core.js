import { freezeDraft, protocolHash } from './review-cycle.js'

export const MAX_BATCH_CHAPTERS = 10
export const CREATIVE_STAGES = Object.freeze(['planning','drafting','review','revision','recheck'])
export function freezeSceneCheckpoint(run,plan,predecessor){return {bookRevision:run.bookRevision,planHash:protocolHash(plan),predecessor:predecessor?freezeDraft(predecessor):null}}
export function assertSceneCheckpoint(checkpoint,run,plan,predecessor){if(JSON.stringify(checkpoint)!==JSON.stringify(freezeSceneCheckpoint(run,plan,predecessor)))throw new Error('场景计划或前驱候选已变化，请新建任务，不能混用旧场景检查点');return true}
export function assertRecheckCurrent(check,draft){const a=freezeDraft(draft),b=check?.revisedDraft;if(!b||a.id!==b.id||a.revision!==b.revision||a.contentHash!==b.contentHash)throw new Error('修稿版本已变化，旧复核已失效，请重新审稿');return true}
export function unresolvedFindings(chapter){
  const checked=new Map((chapter.check?.items||[]).map(item=>[item.id,item.status]))
  return (chapter.review?.items||[]).filter(item=>{
    if(!chapter.autoSelection&&chapter.decisions?.[item.id]==='ignore')return false
    if(checked.has(item.id))return checked.get(item.id)!=='resolved'
    return item.severity==='error'||chapter.autoSelection&&item.severity==='warning'&&item.evidenceStatus!=='verified'
  }).map(item=>item.id)
}
const clone = value => JSON.parse(JSON.stringify(value))
export function createCreativeWorkflow({workId,chapterIds,bookRevision,sourceEntries=[],maxTokens=120000,requirement='',autoRevise=false,stageSnapshots={}}={}) {
  if(!workId||!bookRevision||!Array.isArray(chapterIds)||!chapterIds.length||chapterIds.length>MAX_BATCH_CHAPTERS||new Set(chapterIds).size!==chapterIds.length||chapterIds.some(id=>typeof id!=='string'||!id))throw new Error('请选择 1–10 个不同章节并冻结作品版本')
  if(!Number.isSafeInteger(maxTokens)||maxTokens<1024||maxTokens>10000000)throw new Error('批次预算须为 1024–10000000 tokens')
  return {id:crypto.randomUUID(),incarnation:crypto.randomUUID(),schemaVersion:1,type:'creative-workflow',workId,bookRevision,sourceEntries:clone(sourceEntries),status:'ready',requirement:String(requirement).slice(0,20000),autoRevise:!!autoRevise,stageSnapshots:clone(stageSnapshots),maxTokens,usedTokens:0,usage:{actual:0,estimated:0},chapters:chapterIds.map(chapterId=>({chapterId,phase:'ready',plan:null,sceneCursor:0,scenes:[],artifacts:[],decisions:{},guidance:''})),stages:[],activeToken:null,createdAt:Date.now(),updatedAt:Date.now()}
}
export function claimStage(run,index,stage) {
  if(!run.chapters[index]||!CREATIVE_STAGES.includes(stage)||run.activeToken)throw new Error('阶段无效或已有任务正在执行')
  if(run.usedTokens>=run.maxTokens)throw new Error('批次预算已耗尽')
  if(['revision','recheck'].includes(stage)&&run.stages.slice(run.chapters[index].cycleStart||0).some(s=>s.chapterIndex===index&&s.stage===stage&&s.status==='completed'))throw new Error('本轮修稿与复核次数已用完，请重新审稿')
  const token=crypto.randomUUID()
  run.activeToken=token;run.status='running';run.chapters[index].phase=stage
  run.stages.push({id:token,chapterIndex:index,stage,status:'running',startedAt:Date.now()})
  return token
}
export function finishStage(run,token,{used=0,estimated=false,...result}={}) {
  const entry=run.stages.find(s=>s.id===token)
  if(run.activeToken!==token||!entry||entry.status!=='running')throw new Error('阶段已中断，拒绝迟到结果')
  const charge=Math.max(0,Number(used)||0)
  run.usedTokens+=charge;run.usage[estimated?'estimated':'actual']+=charge
  Object.assign(entry,{status:'completed',completedAt:Date.now(),usedTokens:charge,estimated,result:clone(result)})
  run.activeToken=null;run.status='ready';run.updatedAt=Date.now()
  return entry
}
export function interruptWorkflow(run,error='已暂停，可从检查点继续') {
  for(const s of run.stages)if(s.status==='running')Object.assign(s,{status:'interrupted',error,completedAt:Date.now()})
  run.activeToken=null;run.status='interrupted';run.error=error;run.updatedAt=Date.now()
  return run
}
export function recordArtifact(run,index,card,dependencies=[]) {
  const chapter=run.chapters[index]
  if(!chapter)throw new Error('候选章节不存在')
  const artifact=clone({...card,revision:card.revision??0,status:card.status||'pending'})
  delete artifact.workflowStage
  artifact.dependencies=dependencies.map(d=>({...freezeDraft(d),text:undefined}))
  artifact.workflowBinding={runId:run.id,chapterIndex:index,artifactId:artifact.id}
  if(chapter.artifacts.some(a=>a.id===artifact.id))throw new Error('候选已登记')
  chapter.artifacts.push(artifact)
  return artifact
}
export function assertCandidateDependencies(run,card,seen=new Set()) {
  if(seen.has(card.id))throw new Error('候选依赖循环')
  seen.add(card.id)
  for(const dep of card.dependencies||[]) {
    const actual=run.chapters.flatMap(ch=>ch.artifacts).find(c=>c.id===dep.id)
    const dependencyChapter=run.chapters.find(ch=>ch.artifacts.some(c=>c.id===dep.id)),ownChapter=run.chapters.find(ch=>ch.artifacts.some(c=>c.id===card.id))
    if(dependencyChapter?.adoptedArtifactId&&dependencyChapter!==ownChapter&&dependencyChapter.adoptedArtifactId!==dep.id)throw new Error('前章已采纳其他候选，当前分支已失效')
    if(!actual||['rejected','incomplete','stale'].includes(actual.status))throw new Error('前驱候选已拒绝或失效，请重新生成下游章节')
    const current=freezeDraft(actual)
    if(current.contentHash!==dep.contentHash||current.revision!==dep.revision)throw new Error('前驱候选已编辑，请重新审查下游章节')
    assertCandidateDependencies(run,actual,new Set(seen))
  }
  return true
}
export function sourceRebaseAllowed(before,after,adopted=[]) {
  const old=new Map(before.map(e=>[e.table+':'+e.id,JSON.stringify(e)])),next=new Map(after.map(e=>[e.table+':'+e.id,JSON.stringify(e)]))
  const permitted=new Map(adopted.map(e=>[e.table+':'+e.id,JSON.stringify(e)]))
  for(const key of new Set([...old.keys(),...next.keys()]))if(old.get(key)!==next.get(key)&&permitted.get(key)!==next.get(key))return false
  return true
}
