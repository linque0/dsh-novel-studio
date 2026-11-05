import {defineStore} from 'pinia'
import {useWorkStore} from './work.js'
import {useAiStore} from './ai.js'
import {useCreativeWorkflowStore} from './creative-workflow.js'
import {db} from '../db/database.js'
import {readSourceSnapshot} from '../db/project-repo.js'
import {leaseJob,updateJob} from '../db/ai-repo.js'
import {readStoryDocument,saveStoryDocument,assertStoryStored,storyDocumentId,recoverStoryConfirmation} from '../db/story-repo.js'
import {autosave,registerFlushHook} from '../services/autosave.js'
import {createStoryDocument,storyRequest,appendStoryTurn,editStoryDocument,selectStoryVariant,assertStoryReview,canAutoAdvance,storyPreview} from '../services/ai/story-core.js'
import {plainChapter,chapterHash,snapshotWork} from '../services/ai/contracts.js'
import {sourceManifest,orderedChapters} from '../services/project/normalize.js'
import {freezeContext} from '../services/ai/novel-context.js'
import {freezeDraft,confirmReview} from '../services/ai/review-cycle.js'
import {makeDraft} from '../services/ai/dialogue.js'
import {ensureChapterEditor} from '../services/ai/chapter-editor-bridge.js'
import {isPopped} from '../services/panelwindows.js'
import {reviseStoryHTML} from '../services/story-richtext.js'

const copy=x=>JSON.parse(JSON.stringify(x)),dirty=new Set(),timers=new Map()
let flushRegistered=false
export const useStoryStore=defineStore('story-authoring',{
  state:()=>({documents:{},executing:false,autoWriting:false,confirming:false,stopRequested:false,error:'',progress:'',preview:'',liveMessage:null,loading:false,formalView:false}),
  getters:{
    active(s){const w=useWorkStore();return s.documents[storyDocumentId(w.work?.id,w.selChapterId)]||null},
    busy(s){return s.executing||s.autoWriting||s.confirming},
    readOnly(s){const w=useWorkStore();return s.executing||s.autoWriting||s.confirming||isPopped(w,'chapter',w.selChapterId||'')},
  },
  actions:{
    async load(workId,chapterId){
      if(!flushRegistered){registerFlushHook(()=>this.flush());flushRegistered=true}
      if(!workId||!chapterId)return
      const id=storyDocumentId(workId,chapterId)
      if(dirty.has(id)||this.documents[id])return
      this.loading=true
      try{let doc=await readStoryDocument(workId,chapterId);if(doc)doc=await recoverStoryConfirmation(doc);if(doc&&!dirty.has(id)&&!this.documents[id])this.documents[id]=doc}finally{this.loading=false}
    },
    async ensure(config={}){
      const w=useWorkStore()
      if(!w.work)throw new Error('请先打开作品')
      if(isPopped(w,'chapter',w.selChapterId||''))throw new Error('本章正在其他窗口编辑')
      if(!w.activeChapter){const c=await w.addChapter(null,'第一章');w.selChapterId=c.id}
      const workId=w.work.id,chapterId=w.selChapterId
      await autosave.flushAll();await this.load(workId,chapterId)
      if(w.work?.id!==workId||w.selChapterId!==chapterId)throw new Error('作品或章节已切换')
      let doc=this.active
      if(!doc){const c=w.activeChapter;doc=createStoryDocument({workId,chapterId,text:plainChapter(c),html:c.fmt==='html'?c.content:'',sourceHash:chapterHash(c),config});this.documents[doc.id]=doc;await this.save(doc)}
      return doc
    },
    async refreshDocument(workId,chapterId){
      const id=storyDocumentId(workId,chapterId),current=this.documents[id]
      const stored=await readStoryDocument(workId,chapterId)
      if(!stored||current&&stored.version<=current.version&&stored.incarnation===current.incarnation)return
      if(dirty.has(id)||this.executing){this.error='其他窗口已更新工作稿，当前未保存修改仍保留，请先处理版本冲突';return}
      this.documents[id]=stored
    },
    async save(doc=this.active){
      if(!doc)return
      clearTimeout(timers.get(doc.id));timers.delete(doc.id)
      const revision=doc.revision,config=JSON.stringify(doc.config)
      dirty.add(doc.id)
      try{await saveStoryDocument(doc);if(doc.revision===revision&&JSON.stringify(doc.config)===config)dirty.delete(doc.id);this.error=''}catch(e){this.error=e.message;throw e}
    },
    async flush(){for(const id of [...dirty])await this.save(this.documents[id])},
    changed(doc=this.active){if(!doc)return;dirty.add(doc.id);clearTimeout(timers.get(doc.id));timers.set(doc.id,setTimeout(()=>this.save(doc).catch(()=>{}),350))},
    edit(value){if(this.readOnly)throw new Error('请先停止生成，或收回其他窗口的编辑权');editStoryDocument(this.active,value);this.changed()},
    async variant(index){if(this.busy)throw new Error('请先停止生成');selectStoryVariant(this.active,index);await this.save()},
    stop(){if(this.confirming)return;this.stopRequested=true;useAiStore().cancel();this.progress='正在停止并保留已完成内容…'},
    async prepareForClose(){if(this.busy){this.stop();const deadline=Date.now()+8000;while(this.busy&&Date.now()<deadline)await new Promise(r=>setTimeout(r,30));if(this.busy)throw new Error('故事正在保留恢复材料，请稍后关闭')}await this.flush()},
    async advance(instruction='',operation='advance'){
      if(this.busy)return
      this.stopRequested=false
      return this.runStage('story',instruction,{operation})
    },
    async runStage(stage,instruction='',extra={}){
      if(this.executing||this.confirming||useAiStore().busy||useCreativeWorkflowStore().running)throw new Error('请等待当前生成结束')
      const doc=await this.ensure(),w=useWorkStore(),ai=useAiStore(),owner=crypto.randomUUID(),leaseId='creative-lock:'+doc.workId
      await this.save(doc)
      if(!await leaseJob({id:leaseId,workId:doc.workId,type:'creative-lock',owner}))throw new Error('另一窗口正在创作本作品')
      this.executing=true;this.error='';this.liveMessage=null;this.preview=''
      this.progress=stage==='review'?'正在独立审读本章…':stage==='revise'?'正在按所选意见修稿…':stage==='recheck'?'正在复核原问题…':extra.operation==='discuss'?'正在推演剧情…':doc.text?'故事正在继续…':'正在写下故事的第一幕…'
      const revision=doc.revision,configHash=JSON.stringify(doc.config),manifest=sourceManifest(snapshotWork(w)).hash
      const run={id:'story-run:'+crypto.randomUUID(),type:'story-run',schemaVersion:1,workId:doc.workId,chapterId:doc.chapterId,documentId:doc.id,revision,stage,status:'running',owner,createdAt:Date.now(),usage:{actual:0,estimated:0}}
      const heartbeat=setInterval(()=>updateJob(leaseId,owner,{leaseUntil:Date.now()+120000}).catch(()=>this.stop()),20000)
      let message
      try{
        await db.airuns.put(copy(run))
        let task
        if(stage==='story')task=storyRequest(doc,instruction,extra.operation||'advance')
        else if(stage==='review')task={type:'chapter.review',draftSource:freezeDraft(doc)}
        else if(stage==='revise'){assertStoryReview(doc);task={type:'chapter.revise',draftSource:freezeDraft(doc),confirmedReview:confirmReview(doc.review,doc,doc.decisions||{},instruction)}}
        else if(stage==='recheck'){if(!doc.confirmation)throw new Error('当前稿件没有可复核的已确认修稿清单');task={type:'chapter.recheck',confirmedReview:doc.confirmation,revisedDraft:freezeDraft(doc),draftSource:doc.confirmation.sourceDraft}}
        else throw new Error('未知故事阶段')
        task={...task,workId:doc.workId,chapterId:doc.chapterId,storyDocumentId:doc.id}
        run.task=copy(task)
        const ok=await ai.send(instruction|| (extra.operation==='discuss'?'讨论当前故事下一步的可选走向，不生成正文':'请完成当前故事阶段；创作要素未指定时自主构思，直接交付可读结果'),{
          taskRequest:task,rootRemaining:extra.remaining??32000,
          onStoryProgress:raw=>{if(!this.stopRequested&&extra.operation!=='discuss'&&w.work?.id===doc.workId&&w.selChapterId===doc.chapterId)this.preview=storyPreview(raw)},
          onMessage:m=>{message=m;this.liveMessage=m;for(const c of m.cards||[])c.workflowStage=true},
          onStageUsage:u=>{run.usage[u.estimated?'estimated':'actual']+=Number(u.total_tokens)||0},
        })
        run.model=message?.stageSnapshot?.model||message?.model||ai.model;run.stageSnapshot=copy(message?.stageSnapshot||{});run.presetSnapshot=copy(message?.preset||{});run.source=copy(message?.source||{});run.context=copy(message?.context||{})
        const card=message?.cards?.find(c=>c.complete)
        if(this.stopRequested||!ok||!message?.complete||!card)throw new Error(ai.error?.message||'生成已停止或输出未完整；已保留恢复材料')
        const lease=await db.airuns.get(leaseId)
        if(lease?.owner!==owner||lease.leaseUntil<Date.now())throw new Error('创作执行权已失效')
        if(w.work?.id!==doc.workId||w.selChapterId!==doc.chapterId||doc.revision!==revision||JSON.stringify(doc.config)!==configHash)throw new Error('稿件或故事配置已变化，结果仅保留为恢复材料')
        if(manifest!==sourceManifest(snapshotWork(w)).hash||manifest!==sourceManifest(await readSourceSnapshot(doc.workId)).hash)throw new Error('作品资料已变化，结果仅保留为恢复材料')
        await assertStoryStored(doc)
        if(this.stopRequested||w.work?.id!==doc.workId||w.selChapterId!==doc.chapterId||doc.revision!==revision)throw new Error('任务已停止或写作对象已变化，结果仅保留为恢复材料')
        if(stage==='story'&&extra.operation==='discuss'){doc.discussion||=[];doc.discussion.push({id:card.id,instruction,text:card.text,revision:doc.revision})}
        else if(stage==='story')appendStoryTurn(doc,{id:card.id,text:card.text,source:card.source,instruction},{regenerate:extra.operation==='regenerate'})
        else if(stage==='review'){doc.review=copy(card.review);doc.decisions={};doc.check=null}
        else if(stage==='revise'){
          const html=reviseStoryHTML(doc.html,doc.text,card.text)
          editStoryDocument(doc,{text:card.text,html})
          if(doc.revision===revision){doc.revision++;if(doc.review){doc.reviewHistory.push(doc.review);doc.review=null}}
          doc.confirmation=copy(task.confirmedReview)
        }
        else doc.check=copy(card.check)
        doc.lastRunId=run.id;await this.save(doc);run.status='completed';run.resultId=card.id
        this.progress=stage==='story'?'工作稿已保存':stage==='review'?'独立审稿已保存，意见仍需作者判断':'结果已保存'
        return run
      }catch(e){run.status='interrupted';run.error=e.message;run.recovery=copy({rawContent:message?.rawContent||'',toolOutput:message?.toolOutput||'',cards:message?.cards||[]});this.error=e.message;throw e}
      finally{
        clearInterval(heartbeat);run.owner=null;run.updatedAt=Date.now()
        try{try{await db.airuns.put(copy(run))}finally{await updateJob(leaseId,owner,{owner:null,leaseUntil:0,status:'completed'})}}
        finally{this.executing=false;this.liveMessage=null;this.preview=''}
      }
    },
    async autoAdvance({instruction='',targetWords=3000,maxTokens=32000}={}){
      if(this.busy)return
      const doc=await this.ensure();this.stopRequested=false;this.autoWriting=true
      let round=0,remaining=maxTokens
      try{
        while(!this.stopRequested&&canAutoAdvance({round,remaining,targetWords},doc)){
          this.progress=`自动创作 ${round+1}/6 轮`
          const result=await this.runStage('story',round===0?instruction:'根据当前故事继续推进，接近本章目标时自然收束。',{remaining})
          remaining-=result.usage.actual+result.usage.estimated;round++
        }
        if(!this.stopRequested&&round>0&&remaining>=4096)await this.runStage('review','',{remaining})
        this.progress=this.stopRequested?'已停止，工作稿已保留':`本次已完成 ${round} 轮，${doc.review?'审稿意见可查看':'可继续创作或审阅'}`
      }finally{this.autoWriting=false}
    },
    async confirm(){
      if(this.busy||useAiStore().busy)throw new Error('请等待生成结束')
      const doc=this.active,w=useWorkStore()
      if(!doc?.text.trim())throw new Error('当前工作稿为空')
      if(doc.status==='confirmed'&&doc.sourceHash===chapterHash(w.activeChapter))return
      this.confirming=true
      const frozen={id:doc.id,incarnation:doc.incarnation,revision:doc.revision,text:doc.text,html:doc.html}
      try{
      await this.save(doc);await autosave.flushAll();await assertStoryStored(doc)
      const chapter=w.activeChapter
      if(!chapter||chapter.id!==doc.chapterId||chapterHash(chapter)!==doc.sourceHash)throw new Error('正式正文已修改或撤销，请先对照处理后重新确认工作稿')
      const prior=orderedChapters(w).slice(0,w.chapterOrdinal(doc.chapterId)-1)
      for(const c of prior){const pending=await readStoryDocument(doc.workId,c.id);if(pending&&pending.status!=='confirmed')throw new Error('请先确认前面的故事章节')}
      const source=freezeContext(snapshotWork(w),{taskRequest:{type:'chapter.draft',workId:doc.workId,chapterId:doc.chapterId}})
      const card=makeDraft(doc.text,source,{title:chapter.title})
      card.id='story-confirm:'+doc.id+':'+doc.revision;card.original=plainChapter(chapter);card.storyHTML=doc.html
      // The author explicitly confirms a fresh current-source snapshot; old generation evidence is retained in turns.
      await ensureChapterEditor(doc.workId,doc.chapterId)
      await assertStoryStored(doc)
      if(doc.id!==frozen.id||doc.incarnation!==frozen.incarnation||doc.revision!==frozen.revision||doc.text!==frozen.text||doc.html!==frozen.html)throw new Error('确认期间工作稿发生变化，请重新审读')
      card.storyBinding={...frozen,version:doc.version}
      await w.applyAiProposal(card,{action:card.original?'replace':'append'})
      if(doc.revision!==frozen.revision||doc.text!==frozen.text||doc.html!==frozen.html)throw new Error('正文已保存，但工作稿又有变化，请重新核对')
      doc.status='confirmed';doc.sourceHash=chapterHash(w.chapters.find(c=>c.id===doc.chapterId));doc.confirmationAuditId=card.auditId;await this.save(doc)
      this.progress='本章已确认，正式正文已保存；记忆更新任务已登记'
      }finally{this.confirming=false}
    },
  },
})
