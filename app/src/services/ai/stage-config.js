/** Text-only writing guidance. Never loads modules, runs commands, or stores credentials. */
import { BUILTIN_WRITING_SKILLS } from './builtin-writing-skills.js'
export { BUILTIN_WRITING_SKILLS }
export const STAGES = Object.freeze(['planning', 'drafting', 'review', 'revision', 'memory'])
export const SKILL_TEXT_BUDGET = 24000
const fail = message => { throw new Error(message) }
const hash = text => { let h = 2166136261; for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619); return (h >>> 0).toString(16).padStart(8, '0') }
const binding = value => typeof value === 'string' && value.trim() ? value.trim() : undefined
const safeClone = value => {
  if (Array.isArray(value)) return value.map(safeClone)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => !/^(?:api[_-]?key|key|token|accessToken|refreshToken|authorization|credential|credentials|password|secret|cipher)$/i.test(key)).map(([key, entry]) => [key, safeClone(entry)]))
  return value
}
const stable = value => JSON.stringify(value, function(key,entry){return entry&&typeof entry==='object'&&!Array.isArray(entry)?Object.fromEntries(Object.entries(entry).sort(([a],[b])=>a.localeCompare(b))):entry})
export function freezeProviderConfig(provider,model) {
  const config=safeClone({baseURL:String(provider.baseURL||'').trim(),apiFormat:provider.apiFormat==='anthropic'?'anthropic':'openai',model,modelCfg:provider.modelCfg?.[model]||{},params:provider.params||{}})
  return {providerConfigFingerprint:hash(stable(config))}
}
export function stageBudgetOptions(opts,rootRemaining) {
  return Number.isFinite(rootRemaining)?{...opts,embeddings:{...opts.embeddings,enabled:false}}:opts
}
const unsafeText = /(?:\b(?:subagents?|subagent_type|allowed-tools|hooks?|mcp__\w+|execute_command|run_command|tool_calls?)\b|\b(?:invoke|execute|run|call)\s+(?:a\s+|the\s+)?(?:bash|powershell|shell|python|node|tools?|commands?|scripts?)\b|(?:调用|执行|启动)(?:工具|脚本|命令|子代理|子智能体))/i
function validateText(text) {
  if (typeof text !== 'string' || !text.trim() || text.length > SKILL_TEXT_BUDGET) fail('Skill 文本为空或超过 24000 字符预算')
  if (unsafeText.test(text) || /```\s*(?:bash|sh|powershell|javascript|python|cmd)\b/i.test(text)) fail('仅允许写作文本 Skill，不允许脚本、工具、Hook 或子代理包')
  return text
}
export function stageForTask(type = '') {
  if (type.startsWith('memory.') || /\.extract$|\.summarize$|\.states$|\.relations$/.test(type)) return 'memory'
  if (/\.(review|recheck)$/.test(type)) return 'review'
  if (/\.(revise|rewrite)$/.test(type)) return 'revision'
  if (/\.(plan|directions|design|create|generate)$/.test(type)) return 'planning'
  return 'drafting'
}
export function normalizeStageConfig(raw = {}) {
  const stages = Object.fromEntries(STAGES.map(stage => [stage, Object.fromEntries(['providerId', 'model', 'presetId', 'skillId'].flatMap(key => { const v = binding(raw?.stages?.[stage]?.[key]); return v ? [[key, v]] : [] }))]))
  const custom = (Array.isArray(raw?.skills) ? raw.skills : []).filter(s => {
    if (!String(s?.id || '').startsWith('builtin:')) return true
    if (!BUILTIN_WRITING_SKILLS.some(skill => skill.id === s.id)) fail('未知的内置 Skill 身份')
    return false // Rehydrate trusted text and provenance, never accept an imported override.
  })
  const skills = [...BUILTIN_WRITING_SKILLS, ...custom].map(s => {
    const text = validateText(s.text), contentHash = hash(text)
    const builtin = BUILTIN_WRITING_SKILLS.includes(s)
    return { id: binding(s.id) || `skill_${contentHash}`, name: String(s.name || '写作 Skill').slice(0, 120), text, contentHash, charCount: text.length,
      ...(builtin ? { builtin: true, stage: s.stage, provenance: safeClone(s.provenance) } : {}) }
  })
  if (new Set(skills.map(s => s.id)).size !== skills.length) fail('Skill ID 重复')
  return { version: 1, stages, skills }
}
export function recommendStageSkills(raw = {}) {
  const config = normalizeStageConfig(raw)
  for (const skill of BUILTIN_WRITING_SKILLS) if (!config.stages[skill.stage].skillId) config.stages[skill.stage].skillId = skill.id
  return config
}
export function freezeStage(raw, stage, { providers = [], presets = [],currentProviderId,currentModel } = {}) {
  if (!STAGES.includes(stage)) fail('未知创作阶段')
  const config = normalizeStageConfig(raw), selected = config.stages[stage]
  const result = { stage, inherited: !selected.providerId && !selected.model && !selected.presetId, skill: null }
  if (selected.providerId || currentProviderId) {
    const provider = providers.find(p => p.id === (selected.providerId||currentProviderId) && p.enabled !== false)
    if (!provider) fail('阶段绑定的供应商不可用')
    result.providerId = provider.id
    const model = selected.model || (!selected.providerId&&currentModel) || provider.activeModel
    if (!model || !provider.models?.some(m => (typeof m === 'string' ? m === model : m.name === model && m.enabled !== false))) fail('阶段绑定的模型不可用')
    result.model = model
    Object.assign(result,freezeProviderConfig(provider,model))
  } else if (selected.model) {
    if (!providers.some(p => p.enabled !== false && p.models?.some(m => typeof m === 'string' ? m === selected.model : m.name === selected.model && m.enabled !== false))) fail('阶段绑定的模型不可用')
    result.model = selected.model
  }
  if (selected.presetId) {
    const preset = presets.find(p => p.id === selected.presetId)
    if (!preset) fail('阶段绑定的预设不可用')
    result.presetId = preset.id
    result.presetSnapshot = safeClone(preset)
  }
  if (selected.skillId) {
    const skill = config.skills.find(s => s.id === selected.skillId)
    if (!skill) fail('阶段绑定的 Skill 不可用')
    if (skill.stage && skill.stage !== stage) fail('内置 Skill 不适用于当前阶段')
    result.skill = { ...safeClone(skill), textBudget: SKILL_TEXT_BUDGET }
  }
  return result
}
function safePath(input) {
  const p = String(input).replace(/\\/g, '/')
  if (!p || /^(?:\/|[a-z]+:)/i.test(p) || /[?#%\u0000]/.test(p) || p.split('/').some(s => !s || s === '.' || s === '..')) fail('Skill 引用路径不安全')
  return p
}
export async function readWritingSkillFiles(files) {
  const list = Array.from(files || [])
  if (!list.length || list.length > 64) fail('请选择不超过 64 个文本文件')
  const rows = new Map()
  let total = 0
  for (const file of list) {
    const path = safePath(file.webkitRelativePath || file.name)
    if (!/\.(md|txt)$/i.test(path)) fail('Skill 包只能包含 .md 和 .txt 文件')
    if (rows.has(path)) fail('Skill 包含重复路径')
    const text = validateText(await file.text())
    total += text.length
    if (total > SKILL_TEXT_BUDGET) fail('Skill 包超过 24000 字符预算')
    rows.set(path, text)
  }
  const roots = [...rows.keys()].filter(p => /(^|\/)SKILL\.md$/i.test(p))
  if (roots.length !== 1) fail('请选择一个 SKILL.md 入口')
  const root = roots[0], base = root.slice(0, root.lastIndexOf('/') + 1), visited = new Set(), parts = []
  function visit(path) {
    if (visited.has(path)) return
    const text = rows.get(path)
    if (text === undefined) fail('缺少引用文件：' + path)
    visited.add(path); parts.push(`【${path.slice(base.length)}】\n${text}`)
    for (const match of text.matchAll(/!?\[[^\]]*\]\(([^)]+)\)|^\s*\[[^\]]+\]:\s*(\S+)/gm)) {
      const reference = (match[1] || match[2]).trim().replace(/^<|>$/g, '')
      if (reference.startsWith('#')) continue
      const relative = safePath(reference)
      if (!/\.(md|txt)$/i.test(relative)) fail('Skill 引用只能指向本地文本')
      visit(path.slice(0, path.lastIndexOf('/') + 1) + relative)
    }
  }
  visit(root)
  const text = validateText(parts.join('\n\n')), contentHash = hash(text)
  return { id: `skill_${contentHash}`, name: rows.get(root).match(/^#\s+(.+)$/m)?.[1]?.slice(0, 120) || base.split('/').filter(Boolean).at(-1) || '写作 Skill', text, contentHash, charCount: text.length }
}
export async function loadStageConfig() {
  const { db } = await import('../../db/database.js')
  return normalizeStageConfig((await db.appconfig.get('ai.stageConfig'))?.value)
}
export async function saveStageConfig(raw) {
  const config = normalizeStageConfig(raw)
  const { db } = await import('../../db/database.js')
  await db.appconfig.put({ key: 'ai.stageConfig', value: config })
  return config
}
