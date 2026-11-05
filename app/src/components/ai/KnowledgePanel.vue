<script setup>
import { computed, onMounted, ref } from 'vue'
import { NButton, NInput, NSelect, NModal } from 'naive-ui'
import { useAiStore } from '../../stores/ai'
import { useWorkStore } from '../../stores/work'
import EvidenceList from './EvidenceList.vue'
const ai = useAiStore(),
  work = useWorkStore(),
  error = ref(''),
  editing = ref(null),
  editMode = ref('override'),
  editText = ref(''),
  targetId = ref(null)
const targets = computed(() => [
  ...work.liveCharacters.map((c) => ({ label: '人物 · ' + c.name, value: c.id })),
  ...work.mubu.filter((c) => !c.deletedAt).map((c) => ({ label: '设定 · ' + (c.text || '').slice(0, 40), value: c.id })),
])
const sourceNames={chapter:'正文',mubu:'设定',olnode:'大纲',outlineconnection:'大纲连线',character:'人物',relation:'人物关系',lorelink:'条目关联',snippet:'灵感',annotation:'批注',asset:'附件',outline:'旧版大纲',lore:'旧版设定',volume:'卷',work:'作品',lorecat:'分类'}
async function run(fn) {
  error.value = ''
  try {
    await fn()
  } catch (e) {
    error.value = e.message
  }
}
function build(rebuild = false) {
  const chapters = work.liveChapters
  window.$dialog?.warning({
    title: '确认事实提取范围',
    content: `本地索引全书设定、大纲、人物、关系、灵感和批注；将发送本作品${chapters.length}章的完整正文进行事实提取与全文摘要，包含长章中间部分。创作预设不参与提取。关闭本面板后主窗口继续构建。`,
    positiveText: '发送并构建',
    negativeText: '取消',
    onPositiveClick: () => run(() => ai.buildKnowledge({ allowRaw: true, rebuild })),
  })
}
async function edit(card) {
  editing.value = card
  editMode.value = 'override'
  editText.value = JSON.stringify(card.body, null, 2)
}
async function merge(card) {
  editing.value = card
  editMode.value = 'merge'
  targetId.value = null
}
async function confirmEdit() {
  const card = editing.value
  if (editMode.value === 'override') {
    await run(async () => {
      await ai.decideKnowledge(card.decisionKey || 'card:' + card.id, 'override', { body: JSON.parse(editText.value) })
      editing.value = null
    })
    return
  }
  const id = targetId.value
  if (!id) {
    error.value = '请选择唯一对应的实体'
    return
  }
  const type = work.liveCharacters.some((c) => c.id === id)
    ? 'character'
    : work.mubu.some((c) => !c.deletedAt && c.id === id)
      ? 'lore'
      : null
  if (!type) {
    error.value = '未找到对应实体'
    return
  }
  await run(async () => {
    await ai.decideKnowledge('entity:' + card.body.name, 'merge', { refType: type, refId: id })
    editing.value = null
  })
}
onMounted(() => ai.refreshKnowledge())
</script>
<template>
  <NModal
    :show="!!editing"
    preset="card"
    :title="editMode === 'merge' ? '确认实体归并' : '知识纠错'"
    style="width: 650px"
    @update:show="editing = null"
    ><NInput v-if="editMode === 'override'" v-model:value="editText" type="textarea" :autosize="{ minRows: 8, maxRows: 20 }" /><NSelect
      v-else
      v-model:value="targetId"
      :options="targets"
      filterable
      placeholder="选择已有实体"
    />
    <p v-if="error">{{ error }}</p>
    <NButton type="primary" @click="confirmEdit">确认</NButton></NModal
  >
  <div class="knowledge">
    <p v-if="ai.kb.sourceCoverage?.counts">资料可读：<span v-for="(count,type) in ai.kb.sourceCoverage.counts" :key="type">{{sourceNames[type]||type}} {{count}} · </span></p>
    <p v-if="ai.kb.sourceCoverage?.error" class="error">资料索引：{{ai.kb.sourceCoverage.error}}</p>
    <p>资料索引表示可读取；正文事实提取与摘要单独统计。灵感与大纲计划不会自动成为已发生事实。</p>
    <p>事实覆盖 {{ ai.kb.ready }}/{{ ai.kb.total }} 章 · 过期 {{ ai.kb.stale }} · 未提取 {{ ai.kb.missing }}</p>
    <div class="actions">
      <NButton size="small" @click="build()">更新变更章节</NButton><NButton size="small" @click="build(true)">重建全书</NButton
      ><NButton size="small" @click="ai.pauseKnowledge()">暂停</NButton
      ><NButton size="small" @click="run(() => ai.refreshKnowledge())">刷新</NButton
      ><NButton size="small" @click="run(() => ai.embedKnowledge())">构建语义索引</NButton>
    </div>
    <p v-if="error || ai.kb.error" class="error">{{ error || ai.kb.error }}</p>
    <p v-if="ai.kb.progress">
      构建：{{ ai.kb.progress.status }} · {{ ai.kb.progress.done || 0 }}/{{ ai.kb.progress.total || 0 }}（暂停后手动更新恢复）
    </p>
    <details>
      <summary>资料索引与未解析清单</summary>
      <p v-for="m in ai.kb.sourceCoverage?.sourceMetas||[]" :key="m.id">{{sourceNames[m.sourceType]||m.sourceType}} · {{m.status}} · {{m.doneChunks}}/{{m.totalChunks}} 块</p>
      <p v-for="(issue,i) in ai.kb.sourceCoverage?.issues||[]" :key="i">{{issue.type}} · {{issue.title||issue.sourceId}} {{issue.name||''}}</p>
    </details>
    <details>
      <summary>章节覆盖与失败清单</summary>
      <p v-for="m in ai.kb.metas" :key="m.id">
        {{ work.chapters.find((c) => c.id === m.chapterId)?.title || m.chapterId }} · {{ m.status }} {{ m.error }}
      </p>
    </details>
    <details>
      <summary>伏笔登记表</summary>
      <pre v-for="h in ai.kb.hooks" :key="h.id || h.hookId">{{ h }}</pre>
    </details>
    <p>AI 提取的摘要与事实先待确认；确认且来源有效后才参与后续检索。旧缓存也需核对。</p>
    <details v-for="s in ai.kb.summaries || []" :key="s.id">
      <summary>章节摘要 · {{ work.chapters.find(c=>c.id===s.entityId)?.title || s.entityId }} · {{ s.assertionStatus==='confirmed'?'已确认':'待确认' }}</summary>
      <pre>{{ s.summary }}</pre>
      <NButton size="tiny" :disabled="s.assertionStatus==='confirmed'" @click="run(()=>ai.confirmMemory('aisum',s.id))">确认摘要</NButton>
    </details>
    <details v-for="card in ai.kb.rows" :key="card.id">
      <summary>{{ card.kind }} · {{ card.title || card.body?.name || card.chapterId }} · {{ card.assertionStatus==='authorRecord'?'作者资料':card.assertionStatus==='confirmed'?'已确认':'待确认' }}</summary>
      <pre>{{ card.body }}</pre>
      <EvidenceList :evidence="card.evidence || []" />
      <div class="actions">
        <NButton v-if="card.assertionStatus!=='authorRecord'" size="tiny" :disabled="card.assertionStatus==='confirmed'" @click="run(()=>ai.confirmMemory('aikb',card.id))">确认事实</NButton>
        <NButton size="tiny" @click="edit(card)">纠错</NButton
        ><NButton v-if="card.kind === 'entity'" size="tiny" @click="merge(card)">确认归并</NButton
        ><NButton size="tiny" @click="run(() => ai.decideKnowledge(card.decisionKey || 'card:' + card.id, 'ignore'))">忽略</NButton>
      </div>
    </details>
  </div>
</template>
<style scoped>
.knowledge {
  font-size: 13px;
}
.actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
details {
  padding: 10px 0;
  border-bottom: 1px solid var(--border);
}
summary {
  cursor: pointer;
}
pre {
  white-space: pre-wrap;
  word-break: break-word;
}
.error {
  color: #d55;
}
</style>
