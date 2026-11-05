<script setup>
import { computed, reactive, ref } from 'vue'
import { NButton, NCheckbox, NInput, NSelect } from 'naive-ui'
import { useWorkStore } from '../../stores/work'
import { autosave } from '../../services/autosave'
import { projectBook, orderedChapters } from '../../services/project/normalize.js'
import { ruleCandidates } from '../../services/ai/book-memory.js'
import { isPopped } from '../../services/panelwindows'

const emit = defineEmits(['saved'])
const work = useWorkStore()
const forms = reactive({})
const messages = reactive({})
const saving = ref(null)
const candidates = computed(() => {
  if (!work.work) return []
  // Scope editing needs registered setting text only; do not project chapter bodies.
  const docs = projectBook({ work: work.work, mubu: work.mubu }).docs
  const rules = ruleCandidates({ docs, work })
  return work.mubu.filter(row => !row.deletedAt && rules.some(r => r.sourceId === row.id)).map(row => ({ row, rules: rules.filter(r => r.sourceId === row.id) }))
})
const chapters = computed(() => orderedChapters(work).map(c => ({ label: c.title || c.id, value: c.id })))
const outlines = computed(() => work.olnodes.filter(r => !r.deletedAt).map(r => ({ label: r.title || r.text?.slice(0, 60) || r.id, value: r.id })))
const targets = computed(() => [...chapters.value, ...outlines.value])
const scopes = [{ label: '未分类（保守保留）', value: 'unclassified' }, { label: '全局规则', value: 'global' }, { label: '局部规则', value: 'local' }]
function form(row) {
  if (!forms[row.id]) {
    const p = row.rulePolicy || {}
    forms[row.id] = { scope: ['global', 'local'].includes(p.scope) ? p.scope : 'unclassified', confirmed: p.status === 'confirmed', chapterId: p.chapterId || null, outlineId: p.outlineId || null, targetIds: [...(p.targetIds || [])], keywords: (p.keywords || []).join('、') }
  }
  return forms[row.id]
}
async function save(row) {
  const workId = work.work?.id, f = form(row)
  messages[row.id] = ''
  if(isPopped(work,'lore','')){messages[row.id]='设定正由其他窗口编辑，请到该窗口关闭或完成编辑后再分类';return}
  if (f.scope === 'global' && !f.confirmed) { messages[row.id] = '全局规则需要作者明确确认'; return }
  const keywords = [...new Set(f.keywords.split(/[、，,\n]/).map(v => v.trim()).filter(Boolean))]
  if (f.scope === 'local' && ((f.chapterId && !chapters.value.some(c => c.value === f.chapterId)) || (f.outlineId && !outlines.value.some(o => o.value === f.outlineId)) || f.targetIds.some(id => !targets.value.some(t => t.value === id)))) { messages[row.id] = '适用章节或纲点已删除，请重新选择'; return }
  if (f.scope === 'local' && !f.chapterId && !f.outlineId && !f.targetIds.length && !keywords.length) { messages[row.id] = '请至少指定一项局部适用范围'; return }
  if (!workId || !work.mubu.includes(row) || row.deletedAt) { messages[row.id] = '设定条目已变化，请重新打开设置'; return }
  const policy = { status: f.confirmed ? 'confirmed' : 'needsReview', ...(f.scope !== 'unclassified' ? { scope: f.scope } : {}) }
  if (f.scope === 'local') Object.assign(policy, { ...(f.chapterId ? { chapterId: f.chapterId } : {}), ...(f.outlineId ? { outlineId: f.outlineId } : {}), targetIds: [...f.targetIds], keywords })
  saving.value = row.id
  try {
    row.rulePolicy = policy
    autosave.mark('mubu', row)
    await autosave.flushAll()
    if (autosave.hasPending('mubu', row.id)) throw new Error('写入尚未完成，已保留待保存修改，请重试')
    if (work.work?.id === workId) { messages[row.id] = '适用范围已保存'; emit('saved', { id: row.id, rulePolicy: policy }) }
  } catch (error) { messages[row.id] = error.message }
  finally { saving.value = null }
}
</script>

<template>
  <section class="rule-scope-settings">
    <p>自动识别设定中含“必须、不得、禁止”等表述的规则候选。分类针对整个设定条目，不改写内容；旧条目未保存前保持原状，未分类规则继续保守保留。</p>
    <p v-if="!candidates.length">当前作品没有待分类的设定规则候选。</p>
    <article v-for="entry in candidates" :key="entry.row.id" class="rule-entry">
      <strong>{{ entry.row.title || entry.rules[0]?.text.slice(0, 60) || '设定条目' }}</strong>
      <ul><li v-for="rule in entry.rules" :key="rule.id">{{ rule.text }}</li></ul>
      <NSelect v-model:value="form(entry.row).scope" :options="scopes" aria-label="规则适用范围" />
      <template v-if="form(entry.row).scope === 'local'">
        <NSelect v-model:value="form(entry.row).chapterId" clearable filterable :options="chapters" placeholder="适用章节（可选）" aria-label="适用章节" />
        <NSelect v-model:value="form(entry.row).outlineId" clearable filterable :options="outlines" placeholder="适用纲点（可选）" aria-label="适用纲点" />
        <NSelect v-model:value="form(entry.row).targetIds" multiple clearable filterable :options="targets" placeholder="其他适用章节或纲点" aria-label="其他适用目标" />
        <NInput v-model:value="form(entry.row).keywords" placeholder="匹配关键词，以顿号或逗号分隔" aria-label="规则匹配关键词" />
        <small>命中任一章节、纲点、目标或查询关键词时使用该规则。</small>
      </template>
      <NCheckbox v-model:checked="form(entry.row).confirmed">作者已确认该条目规则</NCheckbox>
      <NButton size="small" :disabled="saving !== null||isPopped(work,'lore','')" :loading="saving === entry.row.id" @click="save(entry.row)">保存此条目分类</NButton>
      <p v-if="messages[entry.row.id]" role="status">{{ messages[entry.row.id] }}</p>
    </article>
  </section>
</template>

<style scoped>
.rule-scope-settings, .rule-entry { display: grid; gap: 10px; }
.rule-entry { border-top: 1px solid var(--agent-border, #8884); padding-top: 12px; }
.rule-entry ul { margin: 0; padding-left: 20px; white-space: pre-wrap; overflow-wrap: anywhere; }
.rule-entry small { opacity: .75; }
</style>
