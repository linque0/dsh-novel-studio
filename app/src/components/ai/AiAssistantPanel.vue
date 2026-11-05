<script setup>
import {computed,nextTick,onBeforeUnmount,onMounted,ref,watch} from 'vue'
import {NButton,NConfigProvider,NDropdown,NInput,NModal,NPopover,NSelect} from 'naive-ui'
import {useAiStore} from '../../stores/ai'
import {useWorkStore} from '../../stores/work'
import {useUiStore} from '../../stores/ui'
import {useWritingStore} from '../../stores/writing.js'
import {useAssistantTaskStore} from '../../stores/assistant-task.js'
import {renderChat,plainChat} from '../../services/ai/chat-text'
import {autosave} from '../../services/autosave.js'
import {TASK_PROFILES} from '../../services/ai/task-profiles.js'
import {directionMessageId,messageCards,showRecoveredWriting} from './assistant-presentation.js'
import OIcon from '../OIcon.vue'
import PresetEvaluation from './PresetEvaluation.vue'
import DraftCard from './DraftCard.vue'
import WorkflowCard from './WorkflowCard.vue'
import PlanCard from './PlanCard.vue'
import DiffCard from './DiffCard.vue'
import KnowledgePanel from './KnowledgePanel.vue'
import CreativeWorkflow from './CreativeWorkflow.vue'
import StageSettings from './StageSettings.vue'
import RuleScopeSettings from './RuleScopeSettings.vue'
import { useCreativeWorkflowStore } from '../../stores/creative-workflow.js'
import WritingWorkspace from './WritingWorkspace.vue'
import AssistantTaskParameters from './AssistantTaskParameters.vue'

const ai=useAiStore(),work=useWorkStore(),ui=useUiStore(),writing=useWritingStore(),task=useAssistantTaskStore()
const creative=useCreativeWorkflowStore(),stageSettingsOpen=ref(false)
const question=ref(ai.pendingPrompt||''),refs=ref({...ai.pendingRefs}),knowledgeOpen=ref(false),evaluationOpen=ref(false),draftPreview=ref(null),chatPane=ref(null),composer=ref(null),uiError=ref(''),newContent=ref(false),nearEnd=ref(true),panelWidth=ref(400),root=ref(null),modelOpen=ref(false),presetOpen=ref(false)
const session=computed(()=>writing.active)
const palettes={
  original:{bg:'#f8f6ef',raised:'#fffdf8',ink:'#34332e',muted:'#625f56',line:'#e2ded2',accent:'#896e4e',selected:'#f0eadc'},
}
const colors=computed(()=>palettes.original)
const variables=computed(()=>Object.fromEntries(Object.entries(colors.value).map(([k,v])=>['--agent-'+k,v])))
const theme=computed(()=>null)
const themeOverrides=computed(()=>({common:{primaryColor:colors.value.accent,primaryColorHover:colors.value.accent,primaryColorPressed:colors.value.accent,primaryColorSuppl:colors.value.accent,bodyColor:colors.value.bg,cardColor:colors.value.raised,popoverColor:colors.value.raised,borderColor:colors.value.line,textColorBase:colors.value.ink,textColor1:colors.value.ink,textColor2:colors.value.ink,textColor3:colors.value.muted,fontFamily:'"Microsoft YaHei UI","PingFang SC",system-ui,sans-serif',borderRadius:'8px'},Input:{color:colors.value.raised,colorFocus:colors.value.raised,border:'1px solid '+colors.value.line,borderHover:'1px solid '+colors.value.accent,borderFocus:'1px solid '+colors.value.accent,textColor:colors.value.ink,placeholderColor:colors.value.muted},Popover:{color:colors.value.raised,textColor:colors.value.ink},Button:{textColor:colors.value.ink}}))
const taskOptions=computed(()=>[{label:'作品讨论',value:'discussion'},{label:'整章与连续创作 / 审稿修稿',value:'creative'},...Object.entries(TASK_PROFILES).filter(([id])=>!['chapter.directions','chapter.plan','chapter.draft','chapter.review','chapter.revise','chapter.recheck'].includes(id)).map(([value,p])=>({label:({chapters:'正文',outline:'大纲',lore:'设定',characters:'人物',snippets:'灵感'}[p.module])+' · '+p.label,value}))])
const taskType=computed(()=>task.mode==='discussion'?'discussion':task.mode==='writing'?session.value?.operation||'chapter.continue':task.type)
const taskLabel=computed(()=>task.mode==='discussion'?'作品讨论':TASK_PROFILES[taskType.value]?.label||'创作任务')
const text=computed({get:()=>task.mode==='writing'?session.value?.requirement||'':task.mode==='task'?task.requirement:question.value,set:value=>{if(task.mode==='writing'&&session.value){session.value.requirement=value;writing.changed(session.value)}else if(task.mode==='task')task.requirement=value;else question.value=value}})
const contextLabel=computed(()=>task.mode==='writing'&&session.value?session.value.chapterTitle+' · '+session.value.anchor.label:task.mode==='task'?(work.chapters.find(c=>c.id===task.chapterId)?.title||'作品资料'):(work.chapters.find(c=>c.id===(refs.value.chapterId||work.selChapterId))?.title||work.work?.title||''))
const sendLabel=computed(()=>task.mode==='discussion'?'发送讨论':task.mode==='task'?'生成待确认结果':session.value?.operation==='chapter.rewrite'?'生成选段改写':session.value?.directions.length?'按所选方向续写':'生成剧情方向')
const canSend=computed(()=>{if(ai.busy||!ai.ready)return false;if(task.mode==='discussion')return !!question.value.trim();if(task.mode==='task')return !!task.type;const s=session.value;if(!s||s.running)return false;if(s.operation==='chapter.rewrite'||!s.directions.length)return true;const d=s.directions.find(d=>d.id===s.selectedId);return !!(d?.complete&&d.draft.title.trim()&&d.draft.development.trim())})
const directionOwner=computed(()=>directionMessageId(ai.chat,session.value))
const recovered=computed(()=>showRecoveredWriting(ai.chat,session.value))
const recoveredCandidates=computed(()=>session.value?.candidates.filter(c=>!ai.chat.some(m=>m.workId===session.value.workId&&m.cards?.some(card=>card.id===c.id)))||[])
const errors=computed(()=>[...new Set([uiError.value,task.error,task.mode==='writing'?session.value?.error:'',ai.error?.message].filter(Boolean))])
const cards=msg=>messageCards(msg,session.value)
const canonical=card=>!!session.value?.candidates.some(c=>c.id===card.id)
const call=fn=>Promise.resolve().then(fn).catch(e=>{uiError.value=e.message})
async function openAgentWorkbench(){await autosave.flushAll();if(new URLSearchParams(location.search).has('panel')){const r=await window.native?.panelOpen?.({type:'agent',workId:work.work.id,entityId:''});if(!r?.ok)throw new Error('正文编辑权已在其他窗口，请先关闭正文窗口')}else ui.workbenchMode='agent';task.openParameters=false}

watch(()=>ai.pendingPrompt,v=>{if(v){question.value=v;refs.value={...ai.pendingRefs};task.mode='discussion'}})
watch(()=>work.work?.id,id=>{question.value='';refs.value={};if(task.workId!==id)task.reset(id);if(id)writing.load(id).then(()=>writing.reconcile()).catch(e=>{uiError.value=e.message})},{immediate:true})
watch(()=>[writing.visible,session.value?.id],([visible])=>{if(visible&&session.value){task.mode='writing';task.openParameters=false;nextTick(()=>composer.value?.focus())}else if(task.mode==='writing')task.mode='discussion'})
watch(()=>task.focusRevision,()=>nextTick(()=>composer.value?.focus()))

function onScroll(){const el=chatPane.value;if(!el)return;nearEnd.value=el.scrollHeight-el.scrollTop-el.clientHeight<64;if(nearEnd.value)newContent.value=false}
function jumpToEnd(){const el=chatPane.value;if(el){el.scrollTop=el.scrollHeight;nearEnd.value=true;newContent.value=false}}
watch(()=>[ai.chat.length,...ai.chat.map(m=>[m.content,m.streaming,m.cards?.length]),session.value?.directions.length,session.value?.candidates.length,session.value?.running],async()=>{
  const pinned=nearEnd.value,editing=chatPane.value?.contains(document.activeElement)&&['INPUT','TEXTAREA'].includes(document.activeElement?.tagName)
  await nextTick();if(pinned&&!editing)jumpToEnd();else newContent.value=true
},{deep:true})
let observer
onMounted(async()=>{observer=new ResizeObserver(entries=>{panelWidth.value=entries[0].contentRect.width});if(root.value)observer.observe(root.value);if(work.work)ai.switchWork(work.work.id);if(!ai.loaded)await ai.loadSettings();await ai.loadPresets();if(writing.visible&&session.value)task.mode='writing'})
onBeforeUnmount(()=>observer?.disconnect())

async function discuss(){
  const value=question.value.trim();if(!value||ai.busy||!ai.ready)return
  const contextRefs={...refs.value},editor=window.__ns?.editor
  if(!contextRefs.chapterId)contextRefs.chapterId=work.selChapterId
  if(!contextRefs.selection&&editor&&!editor.isDestroyed&&work.selChapterId===contextRefs.chapterId){const s=editor.state.selection;if(!s.empty)contextRefs.selection=editor.state.doc.textBetween(s.from,s.to,'\n')}
  question.value='';refs.value={};ai.pendingPrompt='';ai.pendingRefs={};await ai.send(value,{contextRefs})
}
async function submit(){
  if(!canSend.value)return;task.openParameters=false;uiError.value='';nearEnd.value=true
  if(task.mode==='discussion')await discuss()
  else if(task.mode==='task')await task.start()
  else if(session.value?.operation==='chapter.rewrite'||session.value?.directions.length)await writing.startDraft()
  else await writing.startDirections()
}
function onMenusKeydown(event){
  if(event.key!=='Escape'||!(task.openParameters||modelOpen.value||presetOpen.value))return
  event.preventDefault();event.stopPropagation()
  const label=task.openParameters?'功能调整':modelOpen.value?'当前模型':'当前预设'
  task.openParameters=false;modelOpen.value=false;presetOpen.value=false
  nextTick(()=>root.value?.querySelector('[aria-label=\"'+label+'\"]')?.focus())
}
function onKeyDown(event){if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing&&event.keyCode!==229){event.preventDefault();call(submit)}}
async function openPanel(spec,label){if(!window.native?.panelOpen){window.$msg?.info(`${label}窗口仅桌面版可用，网页版暂不支持`);return}try{const r=await window.native.panelOpen(spec);if(!r?.ok)window.$msg?.error(`${label}窗口打开失败（${r?.reason||'未知原因'}）。若刚更新过主进程代码，重启应用后再试。`)}catch(e){window.$msg?.error(`${label}窗口打开失败：${e?.message||e}`)}}
function presets(){task.openParameters=false;openPanel({type:'ai-presets',workId:work.work?.id||'__global__',entityId:work.selChapterId||''},'预设编辑')}
function settings(){openPanel({type:'settings',workId:work.work?.id||'__global__',entityId:'ai'},'模型设置')}
function draft(msg,event){const body=event.currentTarget.closest('.chat-message')?.querySelector('.chat-body'),selection=window.getSelection();const selected=selection&&body?.contains(selection.anchorNode)&&body?.contains(selection.focusNode)?selection.toString():'';draftPreview.value={msg,index:msg.activeCandidate||0,text:selected||plainChat(msg.content),selected:!!selected}}
function acceptDraft(){try{const p=draftPreview.value;if((p.msg.activeCandidate||0)!==p.index)throw new Error('候选已切换，请重新预览');ai.draftFromMessage(p.msg,p.text,{visibleSelection:p.selected});draftPreview.value=null}catch(e){window.$msg?.warning(e.message)}}
async function dismiss(msg,id){try{await ai.dismissCard(msg,id)}catch(e){window.$msg?.warning(e.message)}}
function messageOptions(msg){return msg.id===directionOwner.value?[{label:'复制回复',key:'copy'},{label:'保留已改方向，换其余',key:'retry',disabled:ai.busy||session.value?.running}]:[{label:'复制回复',key:'copy'},{label:'继续',key:'continue',disabled:ai.busy},{label:'重新生成',key:'retry',disabled:ai.busy}]}
function messageAction(key,msg){if(key==='copy')call(()=>navigator.clipboard.writeText(plainChat(msg.content)));if(key==='continue')ai.continueMessage(msg);if(key==='retry'){if(msg.id===directionOwner.value)call(()=>writing.startDirections());else ai.regenerateMessage(msg)}}
function continueDraft(card){task.mode='writing';call(()=>writing.startDraft({parent:card}))}
</script>

<template>
  <NConfigProvider :theme="theme" :theme-overrides="themeOverrides" class="ai-panel agent-panel" :style="variables">
    <div ref="root" class="agent-layout" @keydown="onMenusKeydown" :class="{'agent-narrow':panelWidth<350}">
      <div ref="chatPane" class="chat-scroll agent-conversation" role="log" aria-label="与恍然梦的对话" @scroll="onScroll">
        <div v-if="!ai.chat.length&&!recovered" class="agent-empty"><span class="agent-empty-mark" aria-hidden="true">✧</span><h3>让故事，向前一步。</h3><p>聊聊作品，或从下方选择创作任务。</p></div>
        <article v-for="msg in ai.chat" :key="msg.id||msg.ts" class="chat-message" :class="msg.role" :data-message-id="msg.id">
          <div v-if="msg.role==='assistant'" class="message-head"><span class="agent-avatar" aria-hidden="true">✧</span><span>恍然梦</span><span v-if="msg.source?.taskRequest" class="agent-message-kind">{{TASK_PROFILES[msg.source.taskRequest.type]?.label}}</span><span v-if="msg.streaming" class="agent-generating">生成中</span></div>
          <div v-if="msg.displayText??msg.content" class="message-text chat-body" v-html="renderChat(msg.displayText??msg.content)"></div>
          <WritingWorkspace v-if="msg.id===directionOwner&&session?.directions.length" :session="session" />
          <div v-if="msg.role==='assistant'&&msg.candidates?.length>1" class="candidate-controls"><NButton size="tiny" quaternary :disabled="ai.busy||msg.activeCandidate===0" @click="ai.selectCandidate(msg,msg.activeCandidate-1)">‹</NButton><span>候选 {{(msg.activeCandidate||0)+1}} / {{msg.candidates.length}}</span><NButton size="tiny" quaternary :disabled="ai.busy||msg.activeCandidate>=msg.candidates.length-1" @click="ai.selectCandidate(msg,msg.activeCandidate+1)">›</NButton></div>
          <template v-if="!msg.streaming">
            <template v-for="card in cards(msg)" :key="card.id">
              <details v-if="card.kind==='directions'&&(msg.id!==directionOwner||msg.candidates?.length>1)" class="agent-history-card"><summary>剧情方向 · {{card.directions.length}} 个</summary><div v-for="d in card.directions" :key="d.id"><strong>{{d.title}}</strong><p>{{d.development}}</p></div></details>
              <details v-else-if="card.workflowStage||['chapter-plan','chapter-review','chapter-recheck'].includes(card.kind)" class="proposal"><summary>{{card.title||'创作阶段材料'}} · 在创作任务中查看与确认</summary><pre>{{card.text||card.plan||card.review||card.check}}</pre><NButton size="small" @click="call(()=>creative.open())">打开创作任务</NButton></details>
              <div v-else-if="card.kind==='draft'" class="proposal writing-candidates"><div class="agent-card-caption">{{card.title||'正文候选'}}<span>{{card.status==='applied'?'已采纳':card.complete?'待采纳':'未完整'}}</span></div><DraftCard :card="card" :workflow-controls="canonical(card)" @change="canonical(card)&&writing.changed(session)" @continue-draft="continueDraft" @continue-saved="call(()=>writing.open({fresh:true,reuseDirections:true,mode:'insert'}))" /></div>
              <details v-else-if="card.kind!=='directions'" class="proposal" open><summary>{{card.title||card.name||(card.subject==='character'?'人物建议':'设定建议')}} · {{card.status==='applied'?'已应用':card.complete===false?'未完整':'待确认'}}</summary><WorkflowCard v-if="card.kind==='workflow'" :card="card" /><PlanCard v-else-if="card.kind==='plan'&&card.complete!==false" :card="card" /><DiffCard v-else-if="card.kind==='diff'&&card.complete!==false" :card="card" @dismiss="dismiss(msg,card.id)" /><NButton size="tiny" quaternary @click="dismiss(msg,card.id)">放弃此提案</NButton></details>
            </template>
          </template>
          <p v-if="msg.error" class="error" role="alert">{{msg.error.message}}</p>
          <details v-if="!msg.streaming&&!msg.complete&&msg.toolOutput&&!msg.cards?.length" class="scope"><summary>未完整的工具输出</summary><pre>{{msg.toolOutput}}</pre></details>
          <div v-if="msg.role==='assistant'&&!msg.streaming" class="message-actions"><NButton size="tiny" quaternary :disabled="!msg.complete||!!msg.error" @click="draft(msg,$event)">转为正文草稿</NButton><NDropdown trigger="click" :options="messageOptions(msg)" @select="key=>messageAction(key,msg)"><NButton size="tiny" quaternary aria-label="回复更多操作">•••</NButton></NDropdown></div>
          <details v-if="msg.rawContent||msg.reasoning?.rawText||msg.context" class="scope agent-message-details"><summary>资料与详细信息<span v-if="msg.preset"> · {{msg.preset.name}}</span></summary><details v-if="msg.rawContent"><summary>原始文本</summary><pre>{{msg.rawContent}}</pre></details><details v-if="msg.reasoning?.rawText"><summary>模型推理</summary><div class="message-text" v-html="renderChat(msg.reasoning.displayText??msg.reasoning.rawText)"></div></details><template v-if="msg.context"><p v-for="(r,i) in [...(msg.context.report||[]),...(msg.context.warnings||[])]" :key="i">{{r}}</p><p v-for="d in msg.context.dropped||[]" :key="d.label">裁剪：{{d.label}}</p><p>输入 {{msg.context.tokens?.used}} / {{msg.context.tokens?.inputCap}} · 输出预留 {{msg.context.tokens?.outputReserve}}</p><p v-for="r in msg.rounds||[]" :key="r.round">第 {{r.round}} 轮：{{r.used}} / {{r.inputCap}}</p></template></details>
        </article>
        <section v-if="recovered&&session" class="agent-recovered"><div class="agent-card-caption">已保存的正文任务</div><WritingWorkspace :session="session" part="all" :show-directions="!directionOwner" :visible-candidates="recoveredCandidates" /></section>
        <div v-if="ai.busy" class="agent-live-status" role="status"><span class="agent-status-dot"></span>{{ai.phase==='assembling'?'正在组织作品资料…':'正在生成…'}}</div>
      </div>
      <div class="agent-compose-area">
        <button v-if="newContent" class="agent-new-content" @click="jumpToEnd">有新内容 ↓</button>
        <p v-for="error in errors" :key="error" class="agent-error" role="alert">{{error}}</p>
        <p v-if="!ai.ready" class="agent-setup">配置模型后即可开始。<NButton size="tiny" text @click="settings">模型设置 ↗</NButton></p>
        <details v-if="session?.recoveryNotice" class="agent-recovery"><summary>本窗口修改已另存</summary>{{session.recoveryNotice}}</details>
        <div class="agent-composer compose">
          <div class="agent-context-row"><button class="agent-task-chip" :title="taskLabel+' · '+contextLabel" @click="task.openParameters=!task.openParameters">{{taskLabel}} <OIcon name="caret-down" :size="11" /></button><span v-if="contextLabel" class="agent-context" :title="contextLabel">{{contextLabel}}</span><span v-if="refs.selection||task.selection||task.mode==='writing'&&session?.anchor.selection" class="agent-context-selection">含选段</span></div>
          <NInput ref="composer" v-model:value="text" class="agent-prompt" type="textarea" :autosize="{minRows:2,maxRows:8}" :disabled="task.mode==='task'&&ai.busy" :placeholder="task.mode==='discussion'?'描述你的想法…':'本次目标、视角、篇幅与需要保留的内容…'" aria-label="发送给恍然梦的内容" @keydown="onKeyDown" />
          <div class="agent-composer-controls">
            <NPopover v-model:show="task.openParameters" trigger="click" placement="top-start" :show-arrow="false" :to="false" style="width:min(330px,calc(100vw - 44px));max-height:65vh;overflow:auto" class="agent-function-popover">
              <template #trigger><NButton size="small" quaternary class="agent-function-trigger" aria-label="功能调整" :aria-expanded="task.openParameters"><OIcon name="plus" :size="16" /><span>功能</span></NButton></template>
              <div class="agent-function-content"><strong>功能调整</strong><label>创作任务<NSelect :value="taskType" :options="taskOptions" :disabled="ai.busy" @update:value="v=>call(()=>v==='creative'?creative.open():task.choose(v))" /></label><AssistantTaskParameters />
                <NButton size="small" @click="call(openAgentWorkbench)">打开完整 AI 创作台</NButton><NButton size="small" @click="call(()=>creative.open());task.openParameters=false">整章与连续创作 · 审稿修稿</NButton><NButton size="small" @click="stageSettingsOpen=true;task.openParameters=false">阶段模型与写作 Skill</NButton>
                <template v-if="task.mode==='writing'&&session?.operation==='chapter.continue'"><NButton size="small" :disabled="ai.busy||session.running" @click="call(()=>writing.startDraft({direct:true}));task.openParameters=false">跳过方向，直接续写</NButton><NButton size="small" @click="writing.addDirection();task.openParameters=false">手写剧情方向</NButton><NButton v-if="session.directions.length" size="small" :disabled="ai.busy||session.running" @click="writing.startDirections();task.openParameters=false">保留已改方向，换其余</NButton></template>
                <label v-if="panelWidth<350">当前预设<NSelect :value="ai.selectedPresetId" :options="ai.presets.map(p=>({label:p.name,value:p.id}))" :disabled="ai.chatBusy" @update:value="v=>call(()=>ai.selectPreset(v))" /></label>
                <div class="agent-function-links"><NButton size="small" quaternary @click="knowledgeOpen=true;task.openParameters=false">作品知识</NButton><NButton size="small" quaternary @click="presets">预设编辑 ↗</NButton><NButton size="small" quaternary @click="evaluationOpen=true;task.openParameters=false">预设对照</NButton><NButton size="small" quaternary :disabled="ai.busy" @click="call(()=>ai.clearChat());task.openParameters=false">清空对话</NButton></div><p class="agent-caption">本次会话 {{ai.usage.session.total_tokens}} tokens · {{ai.usage.session.calls}} 次{{ai.usage.session.estimatedCalls?'（含估算）':''}}</p>
              </div>
            </NPopover>
            <NPopover v-model:show="modelOpen" trigger="click" placement="top" :show-arrow="false" :to="false" style="width:250px;max-width:calc(100vw - 44px)"><template #trigger><NButton size="small" quaternary class="agent-model-trigger" :title="ai.model||'选择模型'" aria-label="当前模型"><span class="agent-truncate">{{ai.model||'模型'}}</span><OIcon name="caret-down" :size="11" /></NButton></template><div class="agent-function-content"><label>供应商<NSelect :value="ai.activeProviderId" :options="ai.providers.filter(p=>p.enabled).map(p=>({label:p.name,value:p.id}))" :disabled="ai.busy" @update:value="v=>call(()=>ai.setActiveProvider(v))" /></label><label>模型<NSelect :value="ai.model" :options="ai.modelRows.filter(m=>m.enabled).map(m=>({label:m.name,value:m.name}))" :disabled="ai.busy" @update:value="v=>call(()=>ai.selectModel(v))" /></label><NButton size="small" quaternary @click="settings">管理模型 ↗</NButton></div></NPopover>
            <NPopover v-if="panelWidth>=350" v-model:show="presetOpen" trigger="click" placement="top-end" :show-arrow="false" :to="false" style="width:250px;max-width:calc(100vw - 44px)"><template #trigger><NButton size="small" quaternary class="agent-preset-trigger" aria-label="当前预设" :title="ai.presets.find(p=>p.id===ai.selectedPresetId)?.name"><span class="agent-truncate">{{ai.presets.find(p=>p.id===ai.selectedPresetId)?.name||'预设'}}</span><OIcon name="caret-down" :size="11" /></NButton></template><div class="agent-function-content"><label>写作预设<NSelect :value="ai.selectedPresetId" :options="ai.presets.map(p=>({label:p.name,value:p.id}))" :disabled="ai.chatBusy" @update:value="v=>call(()=>ai.selectPreset(v))" /></label><NButton size="small" quaternary @click="presets">预设编辑 ↗</NButton><NButton size="small" quaternary @click="evaluationOpen=true">预设对照</NButton></div></NPopover>
            <span class="agent-control-spacer"></span><NButton v-if="ai.busy" class="agent-send" circle size="small" aria-label="停止生成" title="停止生成" @click="ai.cancel()">■</NButton><NButton v-else class="agent-send" circle type="primary" size="small" :disabled="!canSend" :aria-label="sendLabel" :title="sendLabel" @click="call(submit)"><OIcon name="arrow-up" :size="17" /></NButton>
          </div>
        </div>
        <div class="agent-compose-footnote"><span>{{task.mode==='writing'?(session?.saved?'修改已保存':'正在保存修改'):'Enter 发送 · Shift+Enter 换行'}}</span><span v-if="task.mode==='writing'&&session?.directionsReused" title="沿用之前的创意，在当前位置重新核对">已保留创意</span></div>
      </div>
    </div>
    <NModal :show="!!draftPreview" preset="card" title="正文草稿转换预览" style="width:min(780px,90vw);max-height:85vh;overflow:auto" @update:show="draftPreview=null"><template v-if="draftPreview"><p>{{draftPreview.selected?'使用实际选中的可见文本':'使用当前候选去除展示 HTML 后的处理文本'}} · 候选 {{draftPreview.index+1}}</p><pre class="message-text">{{draftPreview.text}}</pre><NButton type="primary" :disabled="!draftPreview.text.trim()" @click="acceptDraft">确认为正文草稿</NButton></template></NModal>
    <NModal v-model:show="evaluationOpen" preset="card" title="预设输出对照评测" style="width:min(1000px,92vw);max-height:85vh;overflow:auto"><PresetEvaluation /></NModal>
    <NModal v-model:show="knowledgeOpen" preset="card" title="作品知识库" style="width:min(900px,92vw);max-height:85vh;overflow:auto"><KnowledgePanel /></NModal>
    <NModal v-model:show="creative.visible" preset="card" title="恍然梦 · 创作工作流" style="width:min(960px,94vw);max-height:88vh;overflow:auto"><CreativeWorkflow /></NModal>
    <NModal v-model:show="stageSettingsOpen" preset="card" title="阶段模型与写作 Skill" style="width:min(860px,94vw);max-height:85vh;overflow:auto"><StageSettings /><details><summary>作品设定规则范围</summary><RuleScopeSettings /></details></NModal>
  </NConfigProvider>
</template>

<style scoped>
.agent-panel{height:100%;min-height:0;color:var(--agent-ink);background:var(--agent-bg);font-family:"Microsoft YaHei UI","PingFang SC",system-ui,sans-serif;font-size:14px}.agent-layout{height:100%;min-height:0;min-width:0;display:flex;flex-direction:column;position:relative;container-type:inline-size}.agent-conversation{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:var(--agent-line) transparent;padding:20px 16px 8px}.chat-message{min-width:0;margin-bottom:20px}.chat-message.user{margin-left:auto;padding:10px 12px;border-radius:12px 12px 3px 12px;background:var(--agent-selected);width:fit-content;max-width:calc(100% - 24px)}.message-head{display:flex;gap:6px;align-items:center;margin-bottom:9px;color:var(--agent-muted);font-size:12px}.agent-avatar{font-size:17px;color:var(--agent-accent)}.agent-message-kind{margin-left:auto;font-size:12px}.agent-generating{font-size:12px}.message-text{font-size:14px;line-height:1.75;overflow-wrap:anywhere;user-select:text}.message-text :deep(p){margin:7px 0}.message-text :deep(p:first-child){margin-top:0}.message-text :deep(p:last-child){margin-bottom:0}.message-text :deep(pre){overflow:auto;background:var(--agent-raised);padding:10px;border-radius:6px;white-space:pre-wrap}.message-text :deep(table){border-collapse:collapse;width:100%;font-size:12px}.message-text :deep(td),.message-text :deep(th){border:1px solid var(--agent-line);padding:5px}.message-actions{display:flex;gap:6px;align-items:center;margin-top:8px;color:var(--agent-muted)}.proposal{min-width:0;border:1px solid var(--agent-line);border-radius:8px;margin:12px 0;background:var(--agent-raised)}.agent-card-caption{display:flex;justify-content:space-between;gap:8px;padding:10px 12px 0;font-size:12px;font-weight:600}.agent-card-caption span{font-weight:400;color:var(--agent-muted)}.proposal>summary{padding:10px;font-size:13px}.scope,.agent-history-card{font-size:12px;line-height:1.65;color:var(--agent-muted);margin-top:10px}.scope details{margin-top:8px}.scope p{margin:6px 0}summary{cursor:pointer}.candidate-controls{display:flex;gap:10px;align-items:center;margin:8px 0;font-size:12px;color:var(--agent-muted)}.agent-compose-area{flex:none;padding:8px 16px 10px;background:var(--agent-bg);position:relative}.agent-composer{border:1px solid var(--agent-line);border-radius:12px;background:var(--agent-raised);padding:9px 8px 6px;transition:border-color .15s}.agent-composer:focus-within{border-color:var(--agent-accent)}.agent-context-row{display:flex;align-items:center;gap:6px;margin:0 4px 5px;min-width:0;font-size:12px;color:var(--agent-muted)}.agent-task-chip{border:0;border-radius:5px;background:var(--agent-selected);color:var(--agent-ink);padding:4px 6px;display:flex;align-items:center;gap:3px;white-space:nowrap;cursor:pointer;font:inherit}.agent-context{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}.agent-context-selection{white-space:nowrap}.agent-prompt:deep(.n-input__border),.agent-prompt:deep(.n-input__state-border){border:0!important;box-shadow:none!important}.agent-prompt:deep(.n-input-wrapper){padding:0 5px}.agent-prompt:deep(textarea){font-size:14px;line-height:1.65}.agent-composer-controls{display:flex;align-items:center;gap:2px;margin-top:8px;min-width:0}.agent-model-trigger,.agent-preset-trigger{min-width:0;max-width:105px}.agent-composer-controls:deep(.n-button__content){min-width:0;gap:4px}.agent-truncate{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.agent-control-spacer{flex:1;min-width:0}.agent-send{flex:none}.agent-function-content{display:grid;gap:14px;min-width:0;font-size:13px}.agent-function-content label{display:grid;gap:6px}.agent-function-content>strong{font-size:14px}.agent-function-links{display:grid;grid-template-columns:1fr 1fr;gap:4px;border-top:1px solid var(--agent-line);padding-top:9px}.agent-caption{margin:0;font-size:12px;color:var(--agent-muted);line-height:1.65}.agent-compose-footnote{display:flex;justify-content:space-between;gap:6px;margin-top:7px;font-size:12px;color:var(--agent-muted)}.agent-error,.error{font-size:12px;color:#c75445;line-height:1.6;white-space:pre-wrap;overflow-wrap:anywhere}.agent-error{margin:0 0 8px;max-height:100px;overflow:auto}.agent-setup{margin:0 0 8px;color:var(--agent-muted);font-size:12px}.agent-empty{margin:auto;min-height:200px;height:100%;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;gap:10px;padding:24px 8px}.agent-empty h3{font-size:17px;font-weight:500;color:var(--agent-ink);margin:0}.agent-empty p{font-size:12px;line-height:1.7;color:var(--agent-muted);margin:0}.agent-empty-mark{color:var(--agent-accent);font-size:26px;margin-bottom:6px}.agent-live-status{display:flex;gap:8px;align-items:center;color:var(--agent-muted);font-size:12px;padding:5px 0 14px}.agent-status-dot{width:6px;height:6px;border-radius:50%;background:var(--agent-accent)}.agent-new-content{position:absolute;top:-34px;right:16px;z-index:2;background:var(--agent-raised);border:1px solid var(--agent-line);border-radius:18px;color:var(--agent-ink);padding:6px 12px;font-size:12px;cursor:pointer;box-shadow:0 2px 8px #0001}.agent-recovery{font-size:12px;color:var(--agent-muted);margin-bottom:8px}.agent-narrow .agent-function-trigger span{display:none}.agent-narrow .agent-model-trigger{max-width:135px}.agent-panel :deep(.draft-card){padding:10px 12px;font-size:13px}.agent-panel :deep(.draft-card .actions){gap:6px}.agent-panel :deep(pre){white-space:pre-wrap;overflow-wrap:anywhere}.agent-panel button:focus-visible{outline:2px solid var(--agent-accent);outline-offset:2px}@media(prefers-reduced-motion:reduce){.agent-composer{transition:none}}
</style>
