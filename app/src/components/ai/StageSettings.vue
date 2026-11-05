<script setup>
import { computed, onMounted, ref } from 'vue'
import { NButton, NSelect } from 'naive-ui'
import { useAiStore } from '../../stores/ai'
import { STAGES, normalizeStageConfig, recommendStageSkills, loadStageConfig, saveStageConfig, readWritingSkillFiles } from '../../services/ai/stage-config.js'
import { SKILL_SOURCE_NOTICES } from '../../services/ai/skill-sources.js'

const emit = defineEmits(['saved'])
const ai = useAiStore()
const config = ref(normalizeStageConfig())
const preview = ref(null)
const error = ref('')
const status = ref('')
const busy = ref(false)
const ready = ref(false)
const labels = { planning: '规划', drafting: '起草', review: '审稿', revision: '修稿', memory: '记忆提取' }
const providers = computed(() => ai.providers.filter(p => p.enabled !== false).map(p => ({ label: p.name || p.id, value: p.id })))
const presets = computed(() => ai.presets.map(p => ({ label: p.name || p.id, value: p.id })))
function skills(stage) {
  return config.value.skills.filter(s => !s.stage || s.stage === stage).map(s => ({ label: (s.builtin ? '内置 · ' : '') + s.name, value: s.id }))
}
function selectedSkill(stage) { return config.value.skills.find(s => s.id === config.value.stages[stage].skillId) }
function sourceRepositories(skill) { return [...new Set((skill?.provenance?.sources || []).map(s => s.repository))] }
function models(stage) {
  const p = ai.providers.find(p => p.id === config.value.stages[stage].providerId) || ai.activeProvider
  return (p?.models || []).filter(m => typeof m === 'string' || m.enabled !== false).map(m => ({ label: typeof m === 'string' ? m : m.name, value: typeof m === 'string' ? m : m.name }))
}
async function persist() {
  if (!ready.value || busy.value) return false
  busy.value = true; error.value = ''; status.value = ''
  try { config.value = await saveStageConfig(config.value); status.value = '阶段设置已保存'; emit('saved', config.value); return true }
  catch (e) { error.value = e.message; return false }
  finally { busy.value = false }
}
async function enableRecommended() {
  if (!ready.value || busy.value) return
  const previous = config.value
  config.value = recommendStageSkills(previous)
  if (await persist()) status.value = '已为未绑定阶段启用内置 Skill；已有绑定、模型和预设保持原样'
  else config.value = previous
}
async function inspect(event) {
  error.value = ''; preview.value = null
  try { preview.value = await readWritingSkillFiles(event.target.files) }
  catch (e) { error.value = e.message }
  finally { event.target.value = '' }
}
async function install() {
  if (!preview.value) return
  const previous = config.value
  config.value = normalizeStageConfig({ ...previous, skills: [...previous.skills.filter(s => s.id !== preview.value.id), preview.value] })
  await persist()
  if (!error.value) preview.value = null
  else config.value = previous
}
onMounted(async () => {
  try { if (!ai.loaded) await ai.loadSettings(); config.value = await loadStageConfig(); ready.value = true }
  catch (e) { error.value = e.message }
})
</script>

<template>
  <section class="stage-settings">
    <p class="agent-context">各阶段留空时继承当前供应商、模型和提示词预设。Skill 只提供写作文本，不运行脚本或工具。</p>
    <p>已内置 5 项经来源审查的中文改编 Skill。可逐阶段选择，也可为未绑定阶段启用推荐组合；清空选择并保存即可停用。</p>
    <NButton size="small" :disabled="!ready || busy" :loading="busy" @click="enableRecommended">为未绑定阶段启用推荐 Skill</NButton>
    <div v-for="stage in STAGES" :key="stage" class="stage-row">
      <strong>{{ labels[stage] }}</strong>
      <NSelect v-model:value="config.stages[stage].providerId" clearable placeholder="继承供应商" :options="providers" :aria-label="labels[stage]+'供应商'" @update:value="config.stages[stage].model = undefined" />
      <NSelect v-model:value="config.stages[stage].model" clearable filterable placeholder="继承模型" :options="models(stage)" :aria-label="labels[stage]+'模型'" />
      <NSelect v-model:value="config.stages[stage].presetId" clearable placeholder="继承提示词预设" :options="presets" :aria-label="labels[stage]+'提示词预设'" />
      <NSelect v-model:value="config.stages[stage].skillId" :disabled="!ready || busy" clearable placeholder="不使用 Skill" :options="skills(stage)" :aria-label="labels[stage]+'写作 Skill'" />
      <details v-if="selectedSkill(stage)" class="skill-details">
        <summary>{{ selectedSkill(stage).name }} · 查看文本与来源</summary>
        <p v-if="selectedSkill(stage).builtin">中文改编 v{{ selectedSkill(stage).provenance.adapterVersion }} · 审查日期 {{ selectedSkill(stage).provenance.reviewedAt }} · {{ selectedSkill(stage).charCount }} 字符。运行时冻结本次文本与来源；后续设置变化不改已启动任务。</p>
        <pre class="skill-preview">{{ selectedSkill(stage).text }}</pre>
        <ul v-if="selectedSkill(stage).builtin" class="skill-sources">
          <li v-for="source in selectedSkill(stage).provenance.sources" :key="source.id">
            <a :href="source.url" target="_blank" rel="noopener noreferrer">{{ source.repository }} / {{ source.path }}</a>
            <div>{{ source.license }} · commit {{ source.commit }}</div>
            <div>源文件 SHA-256：{{ source.sha256 }}</div>
          </li>
        </ul>
        <details v-for="repository in sourceRepositories(selectedSkill(stage))" :key="repository">
          <summary>{{ repository }} · MIT 许可原文</summary>
          <pre class="skill-preview">{{ SKILL_SOURCE_NOTICES[repository] }}</pre>
        </details>
      </details>
    </div>
    <NButton size="small" :disabled="!ready || busy" :loading="busy" @click="persist">保存阶段设置</NButton>
    <details class="agent-message-details">
      <summary>导入本地写作 Skill</summary>
      <p>选择包含 SKILL.md 的文件夹，或单独的 SKILL.md；相对引用仅接受 .md / .txt，总文本最多 24000 字符。先预览，确认后安装。</p>
      <label>选择文件夹 <input type="file" webkitdirectory multiple @change="inspect" /></label>
      <label>选择 SKILL.md <input type="file" accept=".md" @change="inspect" /></label>
      <div v-if="preview">
        <p>{{ preview.name }} · {{ preview.charCount }} 字符 · {{ preview.contentHash }}</p>
        <pre class="skill-preview">{{ preview.text }}</pre>
        <NButton size="small" :disabled="!ready || busy" :loading="busy" @click="install">确认安装文本 Skill</NButton>
        <NButton size="small" text @click="preview = null">取消</NButton>
      </div>
    </details>
    <p v-if="error" class="agent-error" role="alert">{{ error }}</p>
    <p v-if="status" role="status">{{ status }}</p>
  </section>
</template>

<style scoped>
.stage-settings { display: grid; gap: 12px; color: var(--agent-text, inherit); }
.stage-row { display: grid; grid-template-columns: 72px repeat(2, minmax(0, 1fr)); gap: 8px; align-items: center; }
.stage-row strong { grid-row: span 2; }
.skill-details { grid-column: 1 / -1; min-width: 0; }
.skill-sources { padding-left: 20px; overflow-wrap: anywhere; }
.skill-sources li { margin-block: 10px; }
.skill-preview { max-height: 260px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; }
label { display: block; margin: 8px 0; }
@media (max-width: 480px) { .stage-row { grid-template-columns: 1fr; } .stage-row strong { grid-row: auto; } }
</style>
