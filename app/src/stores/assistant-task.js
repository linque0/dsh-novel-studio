import {defineStore} from 'pinia'
import {useWorkStore} from './work.js'
import {useAiStore} from './ai.js'
import {useUiStore} from './ui.js'
import {useWritingStore} from './writing.js'
import {TASK_PROFILES} from '../services/ai/task-profiles.js'

// Shared front-end form. Keep TaskLauncher's request fields and existing actions.
export const useAssistantTaskStore=defineStore('assistant-task',{
  state:()=>({workId:null,mode:'discussion',module:'chapters',type:'',requirement:'',chapterId:null,chapterIds:[],targetId:'',selection:'',error:'',openParameters:false,focusRevision:0}),
  getters:{selected:s=>TASK_PROFILES[s.type]},
  actions:{
    reset(workId){this.$reset();this.workId=workId},
    async open(module,type=null){
      const w=useWorkStore(),writing=useWritingStore()
      if(!w.work)return
      if(this.workId!==w.work.id)this.reset(w.work.id)
      if(module==='chapters'&&(!type||['chapter.continue','chapter.rewrite','chapter.directions'].includes(type))){
        await writing.open(type==='chapter.rewrite'?{mode:'replace',fresh:true}:{})
        this.mode='writing';this.module=module;this.type=writing.active.operation
      }else{
        this.mode='task';this.module=module;this.type=type||Object.entries(TASK_PROFILES).find(([,p])=>p.module===module)?.[0]||''
        this.chapterId=w.selChapterId||null;this.chapterIds=this.chapterId?[this.chapterId]:[]
        this.targetId={outline:w.selOlnodeId,characters:w.selCharacterId,snippets:w.selSnippetId}[module]||''
        const editor=window.__ns?.editor,s=editor?.state?.selection
        this.selection=module==='chapters'&&editor&&!editor.isDestroyed&&!s.empty?editor.state.doc.textBetween(s.from,s.to,'\n'):''
        this.error=''
      }
      useUiStore().aiDrawerOpen=true;this.openParameters=true;this.focusRevision++
    },
    async choose(type){
      if(type==='discussion'){this.mode='discussion';useWritingStore().visible=false;this.openParameters=false;this.focusRevision++;return}
      await this.open(TASK_PROFILES[type].module,type)
    },
    async start(){
      const ai=useAiStore(),work=useWorkStore();this.error=''
      if(!ai.loaded)await ai.loadSettings()
      if(!ai.ready){this.error='请先在工坊设置中配置模型';return false}
      const extraction=this.selected?.extraction
      const taskRequest={type:this.type,workId:work.work.id,chapterId:this.chapterId,targetId:this.module==='chapters'?this.chapterId:this.targetId||null,chapterIds:extraction?this.type==='memory.extract'?[this.chapterId]:this.chapterIds:[],selection:this.module==='chapters'?this.selection:''}
      ai.prepare('',{})
      const ok=await ai.send(this.requirement||this.selected.label,{taskRequest})
      if(ok){this.openParameters=false;ai.pendingPrompt='';ai.pendingRefs={}}
      else this.error=ai.error?.message||'生成未完成，请检查模型与任务范围'
      return ok
    },
  },
})
