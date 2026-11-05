import { defineStore } from 'pinia'
import { useAiStore } from './ai'
import { useWorkStore } from './work'
import { db } from '../db/database.js'
import { autosave } from '../services/autosave.js'
import { snapshotWork } from '../services/ai/contracts.js'
import { sourceManifest, orderedChapters } from '../services/project/normalize.js'
import { plainChapter, chapterHash } from '../services/project/text.js'
import { readSourceSnapshot } from '../db/project-repo.js'
import { loadCreativeWorkflows, saveCreativeWorkflow, assertStoredCandidate } from '../db/workflow-repo.js'
import { leaseJob, updateJob } from '../db/ai-repo.js'
import { createCreativeWorkflow, claimStage, finishStage, interruptWorkflow, recordArtifact, assertCandidateDependencies, sourceRebaseAllowed, freezeSceneCheckpoint, assertSceneCheckpoint, assertRecheckCurrent, unresolvedFindings } from '../services/ai/workflow-core.js'
import { freezeDraft, assertReviewCurrent, confirmReview, protocolHash } from '../services/ai/review-cycle.js'
import { normalizeChapterPlan } from '../services/ai/chapter-plan.js'
import { loadStageConfig, freezeStage, STAGES } from '../services/ai/stage-config.js'
import { taskApplyActions } from '../services/ai/task-profiles.js'
import { canExecuteCreativeHere } from '../services/ai/workbench-view.js'
import { ensureChapterEditor } from '../services/ai/chapter-editor-bridge.js'

const copy=value=>JSON.parse(JSON.stringify(value))
const isMain=()=>canExecuteCreativeHere(location.search)
const busyRuns=new Set()
const timers=new Map()
// A failed save remains dirty after its debounce timer is gone. Remote refresh must never erase it.
const dirtyRuns=new Map()
export const useCreativeWorkflowStore=defineStore('creative-workflow',{
  state:()=>({visible:false,byWork:{},error:'',loading:false}),
  getters:{active:s=>s.byWork[useWorkStore().work?.id]||null,running(){return !!this.active?.owner||this.active?.status==='running'}},
  actions:{
    async load(workId=useWorkStore().work?.id,runId=null){
      if(!workId||busyRuns.has(this.byWork[workId]?.id)||timers.has(this.byWork[workId]?.id)||dirtyRuns.has(this.byWork[workId]?.id))return
      const rows=await loadCreativeWorkflows(workId),row=runId?rows.find(r=>r.id===runId):rows[0]
      if(row){
        if(this.byWork[workId]?.id===row.id&&(this.byWork[workId].version||0)>(row.version||0))return
        const lock=await db.airuns.get('creative-lock:'+workId)
        const live=lock?.status==='running'&&lock.owner&&lock.leaseUntil>Date.now()
        if(!live&&(row.status==='running'||row.owner||row.activeToken||row.stages.some(s=>s.status==='running'))){interruptWorkflow(row,'运行已中断；点击继续可从检查点恢复');row.owner=null}
        const current=this.byWork[workId]
        if(dirtyRuns.has(current?.id)||busyRuns.has(current?.id)||timers.has(current?.id)||current?.id===row.id&&(current.version||0)>(row.version||0))return
        this.byWork[workId]=row
      }
    },
    async open(){this.visible=true;await this.load()},
    async create({chapterIds,requirement='',autoRevise=false,maxTokens=120000}={}){
      const w=useWorkStore(),ai=useAiStore()
      if(ai.busy||this.running)throw new Error('请先完成或暂停当前任务')
      if(dirtyRuns.has(this.active?.id))await this.persist(this.active)
      await autosave.flushAll();if(!ai.loaded)await ai.loadSettings();await ai.loadPresets()
      const work=snapshotWork(w),chapters=orderedChapters(work),ids=chapterIds||[w.selChapterId]
      if(ids.some(id=>!chapters.some(c=>c.id===id)))throw new Error('请选择已存在的正文章节')
      const config=await loadStageConfig(),stageSnapshots={}
      for(const stage of STAGES){
        const selected=freezeStage(config,stage,{providers:ai.providers,presets:ai.presets,currentProviderId:ai.activeProviderId,currentModel:ai.model})
        stageSnapshots[stage]={...selected,providerId:selected.providerId||ai.activeProviderId,model:selected.model||ai.model,presetSnapshot:selected.presetSnapshot||copy(ai.presets.find(p=>p.id===ai.selectedPresetId)||ai.presets[0])}
      }
      const manifest=sourceManifest(work)
      const run=createCreativeWorkflow({workId:work.work.id,chapterIds:chapters.filter(c=>ids.includes(c.id)).map(c=>c.id),bookRevision:manifest.hash,sourceEntries:manifest.entries,maxTokens,requirement,autoRevise,stageSnapshots})
      this.byWork[run.workId]=run;this.error='';await this.persist(run);return run
    },
    async persist(run=this.active){if(!run)return;clearTimeout(timers.get(run.id));timers.delete(run.id);const stamp=(dirtyRuns.get(run.id)||0)+1;dirtyRuns.set(run.id,stamp);await saveCreativeWorkflow(run);if(dirtyRuns.get(run.id)===stamp)dirtyRuns.delete(run.id)},
    async prepareForClose(){
      const run=this.active;if(!run)return
      const local=busyRuns.has(run.id)
      if(local){this.pause();const deadline=Date.now()+8000;while(busyRuns.has(run.id)&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,25));if(busyRuns.has(run.id))throw new Error('任务仍在保存中，请稍后关闭')}
      if(!run.owner){do{await this.persist(run)}while(dirtyRuns.has(run.id))}
    },
    changed(run=this.active){if(!run)return;dirtyRuns.set(run.id,(dirtyRuns.get(run.id)||0)+1);clearTimeout(timers.get(run.id));timers.set(run.id,setTimeout(()=>this.persist(run).catch(e=>{this.error=e.message}),450))},
    async assertCurrent(run){
      const w=useWorkStore()
      if(w.work?.id!==run.workId)throw new Error('作品已切换，已暂停原任务')
      const memory=sourceManifest(snapshotWork(w)),persisted=sourceManifest(await readSourceSnapshot(run.workId))
      if(memory.hash!==run.bookRevision||persisted.hash!==run.bookRevision)throw new Error('作品资料已变化，请新建任务；已生成候选仍然保留')
    },
    async sendStage(run,index,stage,task,question){
      await this.assertCurrent(run)
      const inputHash=protocolHash({task,question})
      const recovered=run.stages.findLast(s=>s.chapterIndex===index&&s.stage===stage&&s.status==='completed'&&!s.consumed&&s.result?.inputHash===inputHash&&s.result.artifact)
      if(recovered)return {...copy(recovered.result.artifact),checkpointId:recovered.id}
      const token=claimStage(run,index,stage);await this.persist(run)
      const ai=useAiStore(),usage={actual:0,estimated:0};let message
      try{
        const ok=await ai.send(question||run.requirement||'按本章计划完成创作阶段',{
          taskRequest:{...task,workId:run.workId,chapterId:run.chapters[index].chapterId},
          stageSnapshot:run.stageSnapshots[stage==='recheck'?'review':stage],
          rootRemaining:Math.max(0,run.maxTokens-run.usedTokens),
          onStageUsage:u=>{usage[u.estimated?'estimated':'actual']+=Number(u.total_tokens)||0},onMessage:m=>{message=m;for(const card of m.cards||[])card.workflowStage=true},
        })
        if(run.activeToken!==token)throw new Error('任务已暂停，结果仅作为恢复材料保留')
        if(!ok||!message?.complete)throw new Error(ai.error?.message||'阶段输出未完整，可从检查点重试')
        await this.assertCurrent(run)
        const lock=await db.airuns.get('creative-lock:'+run.workId)
        if(lock?.owner!==run.owner||lock.leaseUntil<Date.now())throw new Error('工作流执行租约已失效')
        const card=message.cards?.find(c=>c.complete)
        if(!card)throw new Error('模型没有返回完整阶段产物')
        finishStage(run,token,{artifactId:card.id,artifact:copy(card),inputHash})
        return {...card,checkpointId:token}
      }catch(e){
        const step=run.stages.find(s=>s.id===token)
        if(step)step.recovery={messageId:message?.id,text:message?.rawContent||'',toolOutput:message?.toolOutput||''}
        interruptWorkflow(run,e.message);throw e
      }finally{
        run.usedTokens+=usage.actual+usage.estimated;run.usage.actual+=usage.actual;run.usage.estimated+=usage.estimated
        await this.persist(run)
      }
    },
    consumeStage(run,card){const entry=run.stages.find(s=>s.id===card.checkpointId);if(entry)entry.consumed=true},
    async dispatch(action,index=0,run=this.active){
      if(!run)throw new Error('请先创建创作任务')
      await this.persist(run)
      if(!isMain()){
        window.native?.appBroadcast?.({kind:'creative-workflow-request',data:{workId:run.workId,runId:run.id,action,index}})
        this.error='任务已交给主窗口执行';return
      }
      if(busyRuns.has(run.id)||useAiStore().busy)throw new Error('请先等待当前请求结束')
      const owner=crypto.randomUUID(),leaseId='creative-lock:'+run.workId
      if(!await leaseJob({id:leaseId,workId:run.workId,type:'creative-lock',owner}))throw new Error('另一窗口正在执行本作品任务')
      busyRuns.add(run.id);run.owner=owner;this.error=''
      const heartbeat=setInterval(()=>updateJob(leaseId,owner,{leaseUntil:Date.now()+120000}).catch(()=>{}),20000)
      try{
        await autosave.flushAll();await this.assertCurrent(run);run.status='ready';run.error=''
        if(action==='plan')await this.planChapter(run,index)
        else if(action==='draft')await this.draftChapter(run,index)
        else if(action==='review')await this.reviewChapter(run,index)
        else if(action==='revise')await this.reviseChapter(run,index)
        else if(action==='recheck')await this.recheckChapter(run,index)
        else if(action==='run')await this.runBatch(run)
        else throw new Error('未知创作动作')
        if(run.status!=='interrupted')run.status=action==='run'?'completed':'ready'
      }catch(e){interruptWorkflow(run,e.message);this.error=e.message}
      finally{clearInterval(heartbeat);busyRuns.delete(run.id);run.owner=null;await updateJob(leaseId,owner,{owner:null,leaseUntil:0,status:'completed'});await this.persist(run)}
    },
    async planChapter(run,index){
      const ch=run.chapters[index],w=useWorkStore()
      if(!w.olnodes.some(n=>!n.deletedAt&&n.refId===ch.chapterId&&n.outlineNature!=='written'&&(n.text||n.title)))throw new Error('本章缺少未来章纲，请先关联章纲再规划')
      const card=await this.sendStage(run,index,'planning',{type:'chapter.plan'},run.requirement||'基于本章章纲生成完整可编辑场景计划')
      ch.plan=card.plan;ch.sceneCursor=0;ch.phase='planned';this.consumeStage(run,card);await this.persist(run)
    },
    async draftChapter(run,index){
      const ch=run.chapters[index]
      if(ch.artifacts.some(c=>c.kind==='draft'&&c.complete&&c.status!=='rejected'))return
      if(!ch.plan)await this.planChapter(run,index)
      ch.plan=normalizeChapterPlan(ch.plan)
      const previous=index?run.chapters[index-1].artifacts.filter(c=>c.kind==='draft'&&c.complete&&c.status!=='rejected').at(-1):null
      if(index&&!previous)throw new Error('缺少前章候选，已停止下游创作')
      if(previous)assertCandidateDependencies(run,previous)
      if(ch.sceneCheckpoint)assertSceneCheckpoint(ch.sceneCheckpoint,run,ch.plan,previous)
      else {ch.sceneCheckpoint=freezeSceneCheckpoint(run,ch.plan,previous);await this.persist(run)}
      const fullWords=ch.plan.scenes.reduce((n,s)=>n+s.targetWords,0),segmented=fullWords>3500
      const scenes=segmented?ch.plan.scenes:[null]
      for(let cursor=ch.sceneCursor||0;cursor<scenes.length;cursor++){
        const task={type:'chapter.draft',chapterPlan:ch.plan,previousScenes:ch.scenes.join('\n\n'),...(segmented?{sceneIndex:cursor}:{}),...(previous?{predecessor:freezeDraft(previous)}:{})}
        const card=await this.sendStage(run,index,'drafting',task,run.requirement||'依据场景计划生成本次完整正文，候选材料不是正式事实')
        ch.scenes.push(card.text);ch.sceneCursor=cursor+1;ch.lastSource=card.source;this.consumeStage(run,card);await this.persist(run)
      }
      const original=plainChapter(useWorkStore().chapters.find(c=>c.id===ch.chapterId))
      const source=copy(ch.lastSource);source.taskRequest.selection=original
      const card={id:crypto.randomUUID(),kind:'draft',task:'plot',taskType:'chapter.draft',workId:run.workId,anchorId:ch.chapterId,anchorLabel:useWorkStore().chapters.find(c=>c.id===ch.chapterId)?.title,title:'整章候选',text:ch.scenes.join('\n\n'),original,source,sourceHash:source.sourceHash,complete:true,status:'pending',revision:0,createdAt:Date.now()}
      recordArtifact(run,index,card,previous?[previous]:[]);ch.phase='drafted';await this.persist(run)
    },
    latest(index,run=this.active){return run?.chapters[index]?.artifacts.filter(c=>c.kind==='draft'&&c.complete&&!['rejected','stale'].includes(c.status)).at(-1)},
    predecessor(run,index){
      if(!index)return {}
      const draft=this.latest(index,run),previous=run.chapters[index-1]
      const dependency=draft?.dependencies?.find(d=>previous.artifacts.some(c=>c.id===d.id))
      const card=previous.artifacts.find(c=>c.id===dependency?.id)
      if(!card)throw new Error('缺少本稿冻结的前驱候选，请重新生成')
      assertCandidateDependencies(run,draft)
      return {predecessor:freezeDraft(card)}
    },
    async reviewChapter(run,index){
      const ch=run.chapters[index],draft=this.latest(index,run)
      if(!draft)throw new Error('请先生成或选入正文候选')
      assertCandidateDependencies(run,draft)
      const card=await this.sendStage(run,index,'review',{type:'chapter.review',draftSource:freezeDraft(draft),...this.predecessor(run,index)},'独立审稿；核查事实、时间、人物知情、能力代价、章纲和衔接。文风建议单列，证据不足不判已确认错误。')
      ch.review=copy(card.review);ch.reviewCardId=card.id;ch.decisions={};ch.confirmation=null;ch.revisionId=null;ch.check=null;ch.phase='reviewed'
      // A fresh review is a new bounded repair cycle; prior artifacts remain intact.
      ch.cycleStart=run.stages.length;this.consumeStage(run,card);await this.persist(run)
    },
    async reviseChapter(run,index){
      const ch=run.chapters[index],draft=this.latest(index,run)
      if(!ch.review||!draft)throw new Error('请先独立审稿')
      assertCandidateDependencies(run,draft)
      assertReviewCurrent(ch.review,draft)
      if(run.stages.slice(ch.cycleStart||0).some(s=>s.chapterIndex===index&&s.stage==='revision'&&s.status==='completed'&&s.consumed))throw new Error('本轮已修稿，请复核或重新审稿')
      const confirmation=confirmReview(ch.review,draft,ch.decisions,ch.guidance||'')
      ch.confirmation=copy({...confirmation,origin:ch.autoSelection?'batch-policy':'author'})
      const card=await this.sendStage(run,index,'revision',{type:'chapter.revise',draftSource:freezeDraft(draft),confirmedReview:ch.confirmation,...this.predecessor(run,index)},'只落实确认清单，输出完整修订稿，保留未受影响段落。')
      const source=copy(draft.source),next={...card,taskType:'chapter.revise',source,text:card.text,original:draft.original,sourceHash:draft.sourceHash,anchorId:draft.anchorId,revision:(draft.revision||0)+1,parentDraftId:draft.id,title:'修稿候选',reviewEvidence:copy(ch.confirmation)}
      recordArtifact(run,index,next,[draft,...(draft.dependencies?.map(d=>run.chapters.flatMap(c=>c.artifacts).find(a=>a.id===d.id)).filter(Boolean)||[])])
      ch.revisionId=next.id
      ch.phase='revised';this.consumeStage(run,card);await this.persist(run)
    },
    async recheckChapter(run,index){
      const ch=run.chapters[index],draft=this.latest(index,run)
      if(!ch.confirmation||!draft?.parentDraftId||ch.revisionId!==draft.id)throw new Error('请先生成本轮修稿候选')
      assertCandidateDependencies(run,draft)
      const parent=ch.artifacts.find(c=>c.id===draft.parentDraftId)
      assertReviewCurrent(ch.confirmation,parent)
      const card=await this.sendStage(run,index,'recheck',{type:'chapter.recheck',draftSource:freezeDraft(parent),confirmedReview:ch.confirmation,revisedDraft:{...freezeDraft(draft),parentDraftId:draft.parentDraftId},...this.predecessor(run,index)},'只复核确认清单各问题；必须以修订稿连续证据说明，改了句子不等于问题已解决。')
      ch.check=card.check;ch.phase='ready';this.consumeStage(run,card);await this.persist(run)
    },
    async runBatch(run){
      for(let index=0;index<run.chapters.length;index++){
        if(run.status==='interrupted')throw new Error(run.error||'批次已暂停')
        const ch=run.chapters[index]
        await this.draftChapter(run,index)
        const draft=this.latest(index,run)
        assertCandidateDependencies(run,draft)
        if(!ch.review)await this.reviewChapter(run,index)
        else if(!ch.confirmation)assertReviewCurrent(ch.review,draft)
        if(run.autoRevise&&!ch.confirmation){
          ch.decisions=Object.fromEntries(ch.review.items.filter(i=>['error','warning'].includes(i.severity)&&i.evidenceStatus==='verified').map(i=>[i.id,'apply']));ch.autoSelection=true
          if(Object.keys(ch.decisions).length)await this.reviseChapter(run,index)
        }
        if(ch.confirmation&&!ch.revisionId)await this.reviseChapter(run,index)
        if(ch.confirmation&&ch.revisionId&&!ch.check)await this.recheckChapter(run,index)
        if(ch.check)assertRecheckCurrent(ch.check,this.latest(index,run))
        const unresolved=unresolvedFindings(ch).length>0
        ch.phase=unresolved?'needs-author':'ready';await this.persist(run)
        if(unresolved)throw new Error('当前章存在待核实或未解决问题，已暂停后续章节；请作者处理')
      }
    },
    pause({remote=false}={}){const run=this.active;if(!run)return;if(!isMain()||run.owner&&!busyRuns.has(run.id)){if(!remote)window.native?.appBroadcast?.({kind:'creative-workflow-pause',data:{workId:run.workId,runId:run.id}});return}interruptWorkflow(run);if(busyRuns.has(run.id))useAiStore().cancel();this.changed(run)},
    async adopt(index,artifactId){
      const run=this.active,ch=run.chapters[index],card=ch.artifacts.find(c=>c.id===artifactId),w=useWorkStore()
      if(!card||useAiStore().busy||busyRuns.has(run.id))throw new Error('请等待当前生成完成')
      await this.persist(run);await this.assertCurrent(run);assertCandidateDependencies(run,card);await assertStoredCandidate(card)
      if(w.selChapterId!==ch.chapterId || window.__ns?.editorTarget?.chapterId!==ch.chapterId)await ensureChapterEditor(run.workId,ch.chapterId)
      const action=taskApplyActions(card.source.taskRequest.type,card.original,card.source.taskRequest.writingAnchor)[0]
      await w.applyAiProposal(card,{action})
      ch.adoptedArtifactId=card.id
      const manifest=sourceManifest(snapshotWork(w)),row=w.chapters.find(c=>c.id===ch.chapterId),allowed=[manifest.entries.find(e=>e.table==='chapters'&&e.id===row.id)]
      if(!sourceRebaseAllowed(run.sourceEntries,manifest.entries,allowed))throw new Error('正文已保存，但其他资料也发生变化；其余候选须重新生成')
      run.sourceEntries=manifest.entries;run.bookRevision=manifest.hash
      for(const item of run.chapters.flatMap(c=>c.artifacts))if(item.status!=='applied'){
        item.source.bookRevision=manifest.hash
        for(const version of item.source.sourceVersions||[])if(version.table==='chapters'&&version.id===row.id)version.hash=chapterHash(row)
      }
      await this.persist(run)
    },
    async reviewCandidate(card){
      if(card.status==='applied'||!card.complete)throw new Error('请选择尚未采纳的完整候选')
      const run=await this.create({chapterIds:[card.anchorId]})
      recordArtifact(run,0,{...copy(card),dependencies:[],revision:card.revision||0});await this.persist(run);this.visible=true;await this.dispatch('review',0,run)
    },
    editCandidate(card,text){
      if(card.status==='applied')return
      card.editText=text;card.revision=(card.revision||0)+1
      const ch=this.active.chapters.find(ch=>ch.artifacts.some(c=>c.id===card.id))
      if(ch?.review&&(ch.review.sourceDraft.id===card.id||ch.check?.revisedDraft.id===card.id||ch.revisionId===card.id)){
        ch.reviewHistory||=[];ch.reviewHistory.push({review:ch.review,check:ch.check,confirmation:ch.confirmation})
        ch.review=null;ch.check=null;ch.confirmation=null;ch.revisionId=null;ch.decisions={};ch.phase='drafted'
      }
      for(const item of this.active.chapters.flatMap(ch=>ch.artifacts))try{assertCandidateDependencies(this.active,item);delete item.staleReason}catch(e){item.staleReason=e.message}
      this.changed()
    },
  },
})
