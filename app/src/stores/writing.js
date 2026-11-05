import { defineStore } from 'pinia'
import { useWorkStore } from './work.js'
import { useAiStore } from './ai.js'
import { useUiStore } from './ui.js'
import { captureWritingAnchor, validateWritingAnchor } from '../services/ai/writing-anchor.js'
import { editDirection, mergeDirectionRows, selectedDirectionSnapshot } from '../services/ai/writing-directions.js'
import { sourceManifest } from '../services/project/normalize.js'
import { snapshotWork } from '../services/ai/contracts.js'
import { autosave, registerFlushHook } from '../services/autosave.js'
import { readSourceSnapshot } from '../db/project-repo.js'
import { loadWritingSession, saveWritingSession } from '../db/writing-repo.js'
import { db } from '../db/database.js'
import { rowHash } from '../services/project/text.js'
const timers=new Map(),dirty=new Map(),loads=new Map()
let installed=false
export const useWritingStore=defineStore('writing',{
  state:()=>({visible:false,byWork:{}}),
  getters:{active:s=>s.byWork[useWorkStore().work?.id]||null},
  actions:{
    install(){if(!installed){installed=true;registerFlushHook(async()=>{await this.reconcile();await this.flush()});let timer;window.addEventListener('writing-document-changed',()=>{clearTimeout(timer);timer=setTimeout(()=>this.reconcile().then(()=>this.flush()).catch(()=>{}),1100)})}},
    async reconcile(){
      const w=useWorkStore(),s=this.byWork[w.work?.id];if(!s)return
      const audits=await db.airuns.where('workId').equals(s.workId).filter(r=>r.type==='application').toArray()
      if(w.work?.id!==s.workId)return
      for(const card of s.candidates){
        const latest=audits.filter(a=>a.cardId===card.id).sort((a,b)=>b.createdAt-a.createdAt)[0]
        if(!latest)continue
        const status=latest.status==='applied'?'applied':'undone',auditId=status==='applied'?latest.id:null
        if(card.status!==status||card.auditId!==auditId){card.status=status;card.auditId=auditId;card.appliedActions=status==='applied'?[latest.action]:[];card.memoryPending=true;this.changed(s)}
      }
      for(const card of s.candidates.filter(c=>c.status==='applied'&&c.auditId)){
        const audit=await db.airuns.get(card.auditId)
        if(audit?.status!=='applied'||!audit.changes.length)continue
        const restored=audit.changes.every(c=>c.before&&rowHash(w[c.table]?.find(r=>r.id===c.id))===rowHash(c.before))
        if(!restored)continue
        const persisted=await Promise.all(audit.changes.map(c=>db.table(c.table).get(c.id)))
        if(w.work?.id!==s.workId||!persisted.every((r,i)=>rowHash(r)===rowHash(audit.changes[i].before)))continue
        await db.airuns.update(audit.id,{status:'undone',updatedAt:Date.now()})
        card.status='undone';card.auditId=null;card.appliedActions=[];card.memoryPending=true;this.changed(s)
      }
    },
    async load(workId){
      this.install();if(!workId||this.byWork[workId])return
      if(loads.has(workId))return loads.get(workId)
      const task=loadWritingSession(workId).then(async s=>{if(s&&!this.byWork[workId]){s.running=false;s.generation=null;s.saved=true;if(['directions','draft'].includes(s.phase))s.phase='partial';this.byWork[workId]=s;await this.reconcile()}}).finally(()=>loads.delete(workId))
      loads.set(workId,task);return task
    },
    async open({mode=null,fresh=false,reuseDirections=false}={}){
      this.install();const w=useWorkStore(),id=w.work?.id,ch=w.activeChapter,ed=window.__ns?.editor
      if(!id||!ch)throw new Error('请先创建并打开正文章节')
      // Capture before any async loading or focus change.
      let anchors=null,captureError
      try{anchors=Object.fromEntries(['insert','append','afterSelection',...(ed?.state.selection.empty?[]:['replace'])].map(m=>[m,captureWritingAnchor(ed,{workId:id,chapterId:ch.id,chapter:ch,mode:m})]))}catch(e){captureError=e}
      await this.load(id)
      if(w.work?.id!==id)throw new Error('作品已切换，请重新打开正文任务')
      if(!fresh&&this.byWork[id]?.chapterId===ch.id){this.visible=true;useAiStore().prepare('',{});return}
      if(!anchors)throw captureError
      const selectedMode=mode||(anchors.replace?'afterSelection':'insert')
      const anchor=anchors[selectedMode]
      if(!anchor)throw new Error('请先选中正文再启动改写')
      const previous=this.byWork[id]
      const session={id:crypto.randomUUID(),workId:id,chapterId:ch.id,chapterTitle:ch.title,anchors,anchor,mode:selectedMode,operation:selectedMode==='replace'?'chapter.rewrite':'chapter.continue',
        bookRevision:sourceManifest(snapshotWork(w)).hash,requirement:'',directionCount:5,directions:[],selectedId:null,generation:null,candidates:[],phase:'ready',error:'',running:false,createdAt:Date.now(),saved:false,persistVersion:0}
      if(reuseDirections&&previous){session.directions=JSON.parse(JSON.stringify(previous.directions));session.selectedId=previous.selectedId;session.requirement=previous.requirement;session.directionCount=previous.directionCount;session.parentSessionId=previous.id;session.directionsReused=true}
      this.byWork[id]=session;this.visible=true;useAiStore().prepare('',{});this.changed(session)
    },
    changed(s=this.active){if(!s)return;s.saved=false;dirty.set(s.id,s);clearTimeout(timers.get(s.id));timers.set(s.id,setTimeout(()=>this.flush(s).catch(()=>{}),450))},
    async flush(only=null){
      const items=only?[only]:[...dirty.values()]
      for(const s of items){if(!dirty.has(s.id))continue;clearTimeout(timers.get(s.id));dirty.delete(s.id)
        try{s.persistVersion=await saveWritingSession(s);s.saved=!dirty.has(s.id)}catch(e){
          if(e.code==='WRITING_CONFLICT'){
            const originalId=s.id;s.id=crypto.randomUUID();s.parentSessionId=originalId;s.persistVersion=0;s.createdAt=Date.now()
            s.recoveryNotice='另一窗口已更新同一任务。本窗口的修改已另存为独立草稿，两个版本均保留；已有候选仍绑定生成时的方向版本。'
            try{s.persistVersion=await saveWritingSession(s);s.saved=true}catch(retry){dirty.set(s.id,s);s.error=retry.message;throw retry}
          }else{dirty.set(s.id,s);s.error=e.message;throw e}
        }
      }
    },
    setMode(mode){const s=this.active;if(!s?.anchors[mode])throw new Error('当前任务没有此范围，请在正文重新选择');s.mode=mode;s.anchor=s.anchors[mode];s.operation=mode==='replace'?'chapter.rewrite':'chapter.continue';this.changed(s)},
    editDirection(id,patch){editDirection(this.active,id,patch);this.changed()},
    selectDirection(id){if(!this.active?.directions.some(d=>d.id===id))return;this.active.selectedId=id;this.changed()},
    keep(id){const d=this.active.directions.find(d=>d.id===id);if(d){d.kept=!d.kept;this.changed()}},
    removeDirection(id){const s=this.active;if(s.generation)(s.generation.removed||=[]).push(id);s.directions=s.directions.filter(d=>d.id!==id);if(s.selectedId===id)s.selectedId=null;this.changed()},
    addDirection(from=null){const s=this.active,draft=from?{...from.draft}:{title:'自定义方向',development:''};s.directions.push({id:crypto.randomUUID(),original:{...draft},draft,revision:0,edited:true,kept:true,complete:true});this.changed()},
    restoreDirection(id){const d=this.active.directions.find(d=>d.id===id);if(!d)return;const old={...d.draft};d.draft={...d.original};d.alternatives||=[];d.alternatives.push(old);d.revision++;d.edited=true;d.kept=true;this.changed()},
    async prepare(s){
      const w=useWorkStore(),ai=useAiStore()
      if(!s||w.work?.id!==s.workId||w.selChapterId!==s.chapterId)throw new Error('请先打开本任务对应的正文章节，或重新定位新任务')
      validateWritingAnchor(window.__ns?.editor,s.anchor)
      if(ai.busy)throw new Error('请等待当前请求完成，或停止后继续')
      if(!ai.loaded)await ai.loadSettings()
      if(!ai.ready)throw new Error('请先在设置中配置模型')
      if(ai.privacy)throw new Error('正文专用任务需要原文材料，隐私模式下无法启动')
      await autosave.flushAll()
      if(w.work?.id!==s.workId||sourceManifest(snapshotWork(w)).hash!==s.bookRevision||sourceManifest(await readSourceSnapshot(s.workId)).hash!==s.bookRevision)throw new Error('正文或作品资料已变化，请保留编辑稿并重新定位任务')
      validateWritingAnchor(window.__ns?.editor,s.anchor)
    },
    task(s,type,extra={}){return {type,workId:s.workId,chapterId:s.chapterId,writingSessionId:s.id,writingAnchor:JSON.parse(JSON.stringify(s.anchor)),selection:s.anchor.selection,...extra}},
    async startDirections(singleId=null){
      const s=this.active;if(!s||s.running)return;s.running=true
      try{
        await this.prepare(s)
        const targets=singleId?[singleId]:s.directions.filter(d=>!d.kept).map(d=>d.id),kept=s.directions.filter(d=>d.kept).length
        const count=singleId?1:Math.max(0,s.directionCount-kept)
        if(!count){s.error='当前方向均已保留；可解除保留后再换一批';return}
        if(!singleId)s.directions=s.directions.filter(d=>d.kept||targets.slice(0,count).includes(d.id))
        const token=crypto.randomUUID();s.generation={token,slots:targets.slice(0,count),revisions:Object.fromEntries(s.directions.map(d=>[d.id,d.revision]))};s.running=true;s.phase='directions';s.error='';this.changed(s)
        let message
        const question=(s.requirement||'为当前正文提供不同剧情演变方向')+`\n请生成 ${count} 个不同方向。`+(s.directions.filter(d=>d.kept).length?'\n避免重复这些已保留的创意：'+JSON.stringify(s.directions.filter(d=>d.kept).map(d=>d.draft)):'')
        const ok=await useAiStore().send(question,{taskRequest:this.task(s,'chapter.directions',{directionCount:count}),onDirectionRows:rows=>{if(s.generation?.token===token){mergeDirectionRows(s,rows,token);this.changed(s)}},onMessage:m=>{message=m}})
        if(s.generation?.token!==token)return
        const card=message?.cards?.find(c=>c.kind==='directions'&&c.complete)
        if(card)mergeDirectionRows(s,card.directions,token)
        s.phase=ok&&card?'choose':'partial';s.error=ok&&card?'':useAiStore().error?.message||'方向未完整生成，已保留完整卡片，可补充或选择现有方向'
      }catch(e){s.error=e.message;s.phase='ready'}finally{s.running=false;this.changed(s);await this.flush(s).catch(()=>{})}
    },
    async startDraft({direct=false,parent=null}={}){
      const s=this.active;if(!s||s.running)return;s.running=true
      try{
        await this.prepare(s)
        if(parent&&(s.operation!=='chapter.continue'||parent.status==='applied'||!s.candidates.includes(parent)))throw new Error('只能接续本任务尚未采纳的续写候选')
        const parentDraft=parent?{id:parent.id,text:parent.editText??parent.text}:null
        const anchor=parent?.source.taskRequest.writingAnchor||s.anchor
        validateWritingAnchor(window.__ns?.editor,anchor)
        const selected=parent?parent.source.taskRequest.selectedDirection:s.operation==='chapter.continue'&&!direct?selectedDirectionSnapshot(s):null
        s.running=true;s.phase='draft';s.error='';this.changed(s)
        let message
        const ok=await useAiStore().send(s.requirement|| (s.operation==='chapter.rewrite'?'仅改写冻结选段，保留事实与事件结果':'按选定方向衔接当前位置续写正文'),{taskRequest:this.task(s,s.operation,{writingAnchor:JSON.parse(JSON.stringify(anchor)),selection:anchor.selection,...(selected?{selectedDirection:selected}:{}),...(parentDraft?{parentDraft}:{})}),onMessage:m=>{
          message=m
          // Finalize before ai.send persists this same candidate to task history.
          for(const card of m.cards||[])if(card.kind==='draft'){card.messageId=m.id;if(parentDraft){card.parentCandidateId=parentDraft.id;card.text=parentDraft.text+card.text;card.opening=card.text}card.editText=card.text}
        }})
        if(message){for(const card of message.cards||[])if(card.kind==='draft')s.candidates.push(card);s.report=message.context}
        s.phase=ok?'candidates':'partial';if(!ok)s.error=useAiStore().error?.message||'正文未完整生成，已有结果已保留'
      }catch(e){s.error=e.message;s.phase='choose'}finally{s.running=false;this.changed(s);await this.flush(s).catch(()=>{})}
    },
    stop(){useAiStore().cancel()},
  },
})
