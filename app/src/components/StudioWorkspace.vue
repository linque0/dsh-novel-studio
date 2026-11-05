<script setup>
import {ref,watch,onMounted,onBeforeUnmount,nextTick} from 'vue'
import Workbench from './Workbench.vue'
import AgentWorkbench from './agent/AgentWorkbench.vue'
import EditorPane from './EditorPane.vue'
import {useUiStore} from '../stores/ui'
import {useWorkStore} from '../stores/work'
import {autosave} from '../services/autosave.js'
import {isPopped} from '../services/panelwindows.js'
import {registerChapterEditorBridge} from '../services/ai/chapter-editor-bridge.js'
import {useCreativeWorkflowStore} from '../stores/creative-workflow.js'
import {useStoryStore} from '../stores/story.js'
import StoryEditor from './agent/StoryEditor.vue'
const ui=useUiStore(),work=useWorkStore(),mounted=ref(false)
const story=useStoryStore()
watch(()=>[work.work?.id,work.selChapterId],([id,chapterId])=>story.load(id,chapterId).catch(e=>story.error=e.message),{immediate:true})
let dispose,previousFlush,flushOnClose,previousPrepare,preparePanel
onMounted(()=>{
  mounted.value=true
  previousFlush=window.__flushNow
  flushOnClose=async()=>{await story.prepareForClose();await useCreativeWorkflowStore().prepareForClose();await autosave.flushAll();if(ui.autosave.pending)throw new Error('编辑尚未保存，请处理保存错误后再关闭')}
  window.__flushNow=flushOnClose
  previousPrepare=window.__prepareForPanel
  preparePanel=async()=>{await autosave.flushAll();if(ui.autosave.pending)throw new Error('正文尚未保存，无法移交编辑权')}
  window.__prepareForPanel=preparePanel
  dispose=registerChapterEditorBridge({getWorkId:()=>work.work?.id,ensure:async chapterId=>{
    if(!work.liveChapters.some(c=>c.id===chapterId))throw new Error('目标章节不存在')
    if(isPopped(work,'chapter',chapterId))throw new Error('正文编辑权在另一窗口，请先关闭该正文窗口')
    await autosave.flushAll()
    if(ui.autosave.pending)throw new Error('正文尚未保存，请处理保存错误后重试')
    work.selChapterId=chapterId;work.selVolumeId=work.activeChapter?.volumeId||null
    await nextTick()
    const ed=window.__ns?.editor,target=window.__ns?.editorTarget
    if(!ed||ed.isDestroyed||target?.workId!==work.work.id||target.chapterId!==chapterId||!ed.isEditable)throw new Error('目标正文编辑会话尚未就绪或只读')
    return ed
  }})
})
watch(()=>[work.work?.id,work.selChapterId,ui.agentCandidateId],()=>{
  if(!ui.agentCandidateId)return
  const flow=useCreativeWorkflowStore(),candidate=flow.active?.chapters.find(ch=>ch.artifacts.some(c=>c.id===ui.agentCandidateId))
  if(flow.active?.workId!==work.work?.id||candidate?.chapterId!==work.selChapterId)ui.agentCandidateId=null
})
watch(()=>ui.workbenchMode,async()=>{
  const ed=window.__ns?.editor,host=ed?.view.dom.closest('.rich-host'),top=host?.scrollTop
  await nextTick()
  if(host&&top!=null)host.scrollTop=top
})
onBeforeUnmount(()=>{dispose?.();if(window.__flushNow===flushOnClose)window.__flushNow=previousFlush;if(window.__prepareForPanel===preparePanel)window.__prepareForPanel=previousPrepare})
</script>
<template>
  <div class="studio-workspaces" :data-workbench="ui.workbenchMode">
    <Workbench v-show="ui.workbenchMode==='writing'" />
    <AgentWorkbench v-show="ui.workbenchMode==='agent'" />
    <Teleport v-if="mounted" :to="ui.workbenchMode==='agent'?'#agent-editor-host':'#writing-editor-host'"><EditorPane /></Teleport>
    <Teleport v-if="mounted&&story.active" :to="ui.workbenchMode==='agent'?'#agent-story-editor-host':'#writing-story-editor-host'"><StoryEditor :key="story.active.id" /></Teleport>
  </div>
</template>
<style scoped>.studio-workspaces{height:100%;min-height:0;min-width:0;position:relative}</style>
