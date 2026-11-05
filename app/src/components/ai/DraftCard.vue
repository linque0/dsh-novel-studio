<script setup>
import { computed, ref } from 'vue'
import { NButton, NDropdown, NInput, NSelect } from 'naive-ui'
import { useWorkStore } from '../../stores/work'
import { useAiStore } from '../../stores/ai'
import { useWritingStore } from '../../stores/writing.js'
import { taskApplyActions } from '../../services/ai/task-profiles.js'
import EvidenceList from './EvidenceList.vue'
import { useCreativeWorkflowStore } from '../../stores/creative-workflow.js'
const props = defineProps({ card: { type: Object, required: true },workflowControls:{type:Boolean,default:false} }),
  work = useWorkStore(),
  ai = useAiStore(),
  error = ref(''),
  title = ref(props.card.title || '新章节'),
  volumeId = ref(work.chapters.find((c) => c.id === props.card.anchorId)?.volumeId || work.liveVolumes[0]?.id || 'orphans'),
  afterId = ref(props.card.anchorId || ''),
  mode = ref('append'),
  confirm = ref(false),
  busy = ref(false)
const emit=defineEmits(['change','continue-draft','continue-saved'])
const preview=ref(false),useFrozenDirection=ref(false)
const draftText=computed({get:()=>props.card.editText??props.card.text,set:v=>{props.card.editText=v;emit('change')}})
const anchor=computed(()=>props.card.source?.taskRequest?.writingAnchor)
const applied = computed(() => props.card.status === 'applied'),
  canApply = computed(() => props.card.complete && !applied.value && props.card.status!=='rejected' && !busy.value && !ai.busy)
const allowed = action => !props.card.taskType || taskApplyActions(props.card.taskType,props.card.original,anchor.value).includes(action)
async function reviewCandidate(){try{await useCreativeWorkflowStore().reviewCandidate(props.card)}catch(e){error.value=e.message}}
const target = computed(() => work.chapters.find((c) => c.id === props.card.anchorId && !c.deletedAt))
async function apply() {
  error.value = ''
  busy.value = true
  try {
    await work.applyAiProposal(props.card, { action: mode.value, title: title.value, volumeId: volumeId.value, afterId: afterId.value,useFrozenDirection:useFrozenDirection.value })
    confirm.value = false
    window.$msg?.success('草稿已保存，可撤销')
    emit('change')
  } catch (e) {
    error.value = e.message
  } finally {
    busy.value = false
  }
}
async function extractMemory() {
  const id=props.card.anchorId
  if(!id || ai.busy)return
  useWritingStore().visible=false
  const ok=await ai.send('从刚保存的章节提取摘要、事件、人物状态和伏笔，生成待确认记忆提案。',{taskRequest:{type:'memory.extract',workId:work.work.id,chapterId:id,chapterIds:[id]}})
  if(!ok)error.value='正文已保存；记忆提取未完成，可重试。'+(ai.error?.message||'')
}
async function undo() {
  busy.value = true
  try {
    await work.undoAiApplication(props.card.auditId)
    props.card.status = 'undone'
    props.card.appliedActions = []
    props.card.auditId = null
    props.card.memoryPending=true
    emit('change')
  } catch (e) {
    error.value = e.message
  } finally {
    busy.value = false
  }
}
async function copyText() {
  try {
    await navigator.clipboard.writeText(draftText.value)
    window.$msg?.success('正文已复制')
  } catch (e) {
    error.value = e.message
  }
}
function open(action) {
  mode.value = action
  if(anchor.value){apply();return}
  confirm.value = true
  error.value = ''
}
const moreActions=computed(()=>[{label:'复制正文',key:'copy'},...(props.card.taskType&&applied.value?[{label:'更新章节记忆（待确认）',key:'memory',disabled:busy.value||ai.busy}]:[])])
function more(key){if(key==='copy')copyText();if(key==='memory')extractMemory()}
</script>
<template>
  <div class="draft-card">
    <p v-if="card.summary" class="draft-summary">{{ card.summary }}</p>
    <p class="target">
      {{ card.anchorLabel || '未关联章节' }} · {{ draftText.length }} 字 ·
      {{ applied ? '已保存' : card.complete ? '完整草稿' : '尚未完整，先继续生成' }}
    </p>
    <template v-if="anchor"><p>{{ anchor.label }}</p><label>编辑待采纳正文<NInput v-model:value="draftText" type="textarea" :disabled="applied||busy" :autosize="{minRows:5,maxRows:18}" /></label><NButton size="tiny" @click="preview=!preview">{{preview?'关闭预览':'对照与接入预览'}}</NButton><div v-if="preview" class="writing-preview"><small>前文（预览，不改正文）</small><pre>{{anchor.left}}</pre><template v-if="card.original"><small>原选段</small><pre>{{card.original}}</pre></template><small>待采纳内容</small><pre class="preview-new">{{draftText}}</pre><small>后文</small><pre>{{anchor.right}}</pre></div><details v-if="card.source?.taskRequest?.selectedDirection"><summary>本候选采用的剧情方向</summary><p>{{card.source.taskRequest.selectedDirection.title}} · v{{card.source.taskRequest.selectedDirection.revision+1}}</p><pre>{{card.source.taskRequest.selectedDirection.development}}</pre><label><input v-model="useFrozenDirection" type="checkbox" />即使方向卡已修改，仍采用本候选绑定的这一版方向</label></details></template>
    <details v-else>
      <summary>展开正文</summary>
      <pre>{{ card.text }}</pre>
    </details>
    <EvidenceList :evidence="card.evidence || []" />
    <p v-for="(w,i) in card.warnings || []" :key="i">{{ w }}</p>
    <details v-if="card.review"><summary>核查说明</summary><pre>{{ card.review }}</pre></details>
    <div class="actions">
      <NButton size="small" :disabled="busy||ai.busy||!card.complete||applied" @click="reviewCandidate">独立审稿与修稿</NButton>
      <NButton v-if="allowed('insert')" type="primary" size="small" :disabled="!canApply||!target||!draftText.trim()" @click="mode='insert';apply()">采纳到原位置</NButton>
      <NButton v-if="allowed('append')" type="primary" size="small" :disabled="!canApply || !target" @click="open('append')">追加到章节</NButton
      ><NButton v-if="allowed('replace')" type="primary" size="small" :disabled="!canApply || !card.original" @click="open('replace')">替换选段</NButton
      ><NButton v-if="allowed('newchapter')" size="tiny" :disabled="!canApply" @click="open('newchapter')">保存为新章节</NButton
      ><NButton v-if="card.auditId && applied" size="small" quaternary :disabled="busy||ai.busy" @click="undo">撤销应用</NButton>
      <NButton v-if="workflowControls&&anchor&&card.taskType==='chapter.continue'&&!applied" size="tiny" :disabled="busy||ai.busy||!draftText.trim()" @click="emit('continue-draft',card)">接着写草稿</NButton>
      <NButton v-if="workflowControls&&anchor&&applied" size="tiny" :disabled="busy||ai.busy" @click="emit('continue-saved',card)">采纳后再续写</NButton>
      <NDropdown trigger="click" :options="moreActions" @select="more"><NButton size="small" quaternary aria-label="正文候选更多操作">•••</NButton></NDropdown>
    </div>
    <div v-if="confirm" class="confirm">
      <template v-if="mode === 'newchapter'"
        ><NInput v-model:value="title" placeholder="新章节标题" /><NSelect
          v-model:value="volumeId"
          :options="[{ label: '未分卷', value: 'orphans' }, ...work.liveVolumes.map((v) => ({ label: v.title, value: v.id }))]" /><NSelect
          v-model:value="afterId"
          :options="[
            { label: '放在卷末', value: '' },
            ...work.liveChapters
              .filter((c) => (c.volumeId || 'orphans') === volumeId)
              .map((c) => ({ label: '在 ' + c.title + ' 之后', value: c.id })),
          ]" /></template
      ><template v-else
        ><p>{{ mode === 'append' ? '将追加到生成时关联章节末尾：' : '将替换生成时选段：' }}{{ card.anchorLabel }}</p>
        <pre v-if="mode === 'replace'">{{ card.original }}</pre>
        <p>保留原有其他内容。版本变化、其他窗口锁定或选段跨越关系链接／批注时停止应用。</p></template
      ><p v-if="card.taskType">正文独立保存，章节记忆可稍后更新并另行确认。</p>
      <div class="actions">
        <NButton type="primary" size="small" :loading="busy" :disabled="!canApply" @click="apply">确认保存</NButton><NButton size="small" :disabled="busy" @click="confirm = false">取消</NButton>
      </div>
    </div>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <p v-if="applied&&card.taskType" class="target">正文已保存 · 章节记忆待更新</p>
  </div>
</template>
<style scoped>
.writing-preview{margin:8px 0;padding:8px;border:1px solid var(--border);max-height:420px;overflow:auto}.writing-preview pre{white-space:pre-wrap;overflow-wrap:anywhere}.preview-new{border-left:3px solid var(--accent);padding-left:8px}
.draft-card {
  padding: 10px;
  font-size: 12px;
}
.target {
  color: var(--text-dim);
}
.actions {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin: 10px 0;
}
.confirm {
  padding: 12px;
  border: 1px solid var(--border);
}
.confirm > * {
  margin-bottom: 10px;
}
pre {
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.8;
}
summary {
  cursor: pointer;
}
.error {
  color: #d55;
}
</style>
