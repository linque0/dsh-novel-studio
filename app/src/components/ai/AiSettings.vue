<script setup>
/* 模型设置（多供应商预设，ZCode 式管理）：左侧预设列表 + 右侧详情，全部即时保存。
 * - 每个预设 = 一套连接配置（名称 / Base URL / API 格式 / API Key）+ 模型列表（含启停）
 *   + 生成与记忆参数（温度 / 隐私 / 自动记忆，随预设切换）；向量模型与语义检索已独立到「知识库模型」页；
 * - 点列表项 = 切换当前使用中的预设（生成参数随之切换，立即生效）；
 * - API Key：明文只经 safeStorage（Windows DPAPI）加密通道落 ai.cred.<id>（store.saveProviderKey），
 *   本组件不持有明文状态、不回显明文；
 * - 「连接测试」走当前预设（provider.testConnection，按 apiFormat 分发 OpenAI / Anthropic 协议）；
 * - Anthropic Messages 格式不支持 /models 拉取与 embeddings，界面同步禁用并提示。
 * 全部经 stores/ai.js 动作落库（db.appconfig），本组件不直接写 Dexie。
 */
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { NButton, NInput, NInputNumber, NModal, NPopconfirm, NPopover, NSelect, NSwitch, NTag } from 'naive-ui'
import OIcon from '../OIcon.vue'
import { useAiStore } from '../../stores/ai'
import { lookupModelMeta } from '../../services/ai/modelmeta'
import { API_FORMAT_OPTIONS, PROVIDER_TEMPLATES } from '../../services/ai/provider-templates'

const ai = useAiStore()

const cur = computed(() => ai.activeProvider)

/* 连接信息本地编辑态（blur 即存；切换预设/外部更新时重同步） */
const form = reactive({ name: '', baseURL: '' })
const tempLocal = ref(0.7)
const keyInput = ref('')
const keyBusy = ref(false)
const testing = ref(false)
const testResult = ref(null) // { ok, text }
const addOpen = ref(false)
/* 模型列表：拉取结果 / 内联添加 / 提示条 */
const adding = ref(false)
const newModel = ref('')
const fetchedIds = ref([])
const fetchMsg = ref(null) // { ok, text }
/* 编辑模型配置弹窗（逐模型专属参数） */
const editOpen = ref(false)
const editName = ref('')
const editForm = reactive({ enabled: true, contextWindow: null, maxTokens: null, temperature: null, note: '' })
const editPrefilled = ref(false) // 本次打开是否用官方参考参数补位过（弹窗内提示）

/* Anthropic Messages 格式不支持拉取模型与向量模型 */
const noModelsApi = computed(() => cur.value?.apiFormat === 'anthropic')

function syncForm() {
  form.name = cur.value?.name || ''
  form.baseURL = cur.value?.baseURL || ''
  tempLocal.value = cur.value?.params?.temperature ?? 0.7
  keyInput.value = ''
  testResult.value = null
  fetchMsg.value = null
  fetchedIds.value = []
  adding.value = false
  newModel.value = ''
}

watch(() => ai.activeProviderId, syncForm)

onMounted(async () => {
  if (!ai.loaded) await ai.loadSettings()
  syncForm()
})

/* ---------- 预设列表 / 增删改 ---------- */

function selectProvider(id) {
  ai.setActiveProvider(id)
}

async function addFromTemplate(tpl) {
  addOpen.value = false
  await ai.addProvider({ ...tpl })
  window.$msg?.success(`已添加「${tpl.name}」预设，请填写 API 密钥`)
}

async function duplicateCur() {
  const id = await ai.duplicateProvider(cur.value.id)
  if (id) window.$msg?.success('已复制预设（密钥需重新填写）')
}

async function removeCur() {
  const name = cur.value?.name
  await ai.removeProvider(cur.value.id)
  window.$msg?.success(`已删除「${name}」`)
}

/* ---------- 连接信息：即时保存（blur / change） ---------- */

async function saveName() {
  if (!cur.value) return
  const v = form.name.trim()
  if (!v || v === cur.value.name) {
    form.name = cur.value?.name || ''
    return
  }
  await ai.updateProvider({ name: v })
}

async function saveBaseURL() {
  if (!cur.value) return
  const v = form.baseURL.trim()
  form.baseURL = v
  if (v === cur.value.baseURL) return
  await ai.updateProvider({ baseURL: v })
}

async function saveFormat(v) {
  if (!cur.value || v === cur.value.apiFormat) return
  await ai.updateProvider({ apiFormat: v })
  fetchedIds.value = []
  fetchMsg.value = null
  if (v === 'anthropic')
    window.$msg?.info?.('Anthropic Messages 不支持「拉取模型」与向量模型，请手动添加模型名')
}

async function toggleProvider(v) {
  if (!cur.value) return
  await ai.setProviderEnabled(cur.value.id, v)
}

/* 密钥：输入非空且失焦 → 自动加密保存（组件不持有明文状态） */
async function saveKey() {
  const text = keyInput.value.trim()
  if (!text || !cur.value) return
  keyBusy.value = true
  try {
    await ai.saveProviderKey(text)
    keyInput.value = ''
    window.$msg?.success('API 密钥已加密保存（当前预设）')
  } catch (e) {
    window.$msg?.error(String(e?.message || e))
  } finally {
    keyBusy.value = false
  }
}

async function clearKey() {
  keyBusy.value = true
  try {
    await ai.clearProviderKey()
    keyInput.value = ''
    window.$msg?.success('API 密钥已清除')
  } catch (e) {
    window.$msg?.error(String(e?.message || e))
  } finally {
    keyBusy.value = false
  }
}

/* ---------- 预设参数：即时保存 ---------- */

async function saveTemperature() {
  if (!cur.value) return
  if (Number(tempLocal.value) === Number(cur.value.params?.temperature)) return
  await ai.updateParams({ temperature: tempLocal.value })
}

function setPrivacy(v) {
  ai.updateParams({ privacy: v })
}

function setKbAuto(v) {
  ai.updateParams({ kb: { auto: v } })
}

/* ---------- 连接测试（走当前预设的 API 格式） ---------- */

async function onTest() {
  testing.value = true
  testResult.value = null
  try {
    const r = await ai.testConnection()
    testResult.value = r.ok
      ? { ok: true, text: `连接成功（${r.model || ai.model}）${r.reply ? ` · 回复：${String(r.reply).trim().slice(0, 40)}` : ''}` }
      : { ok: false, text: r.error?.message || '连接失败' }
  } catch (e) {
    testResult.value = { ok: false, text: String(e?.message || e) }
  } finally {
    testing.value = false
  }
}

/* ---------- 模型列表：拉取 / 手动添加 / 启停 / 点选使用 ---------- */

async function onFetch() {
  fetchMsg.value = null
  try {
    const ids = await ai.fetchModelList()
    fetchedIds.value = ids
    fetchMsg.value = { ok: true, text: `已拉取 ${ids.length} 个模型，点「＋ 添加」加入下方列表` }
  } catch (e) {
    fetchMsg.value = { ok: false, text: String(e?.message || e) }
  }
}

async function confirmAdd() {
  const m = newModel.value.trim()
  if (!m) return
  await ai.addModel(m)
  newModel.value = ''
}

function openEdit(m) {
  editName.value = m
  const cfg = ai.modelCfg[m] || {}
  const meta = lookupModelMeta(m)
  /* 已保存的专属配置优先；缺失字段用官方参考值补位 */
  editForm.enabled = cfg.enabled !== false
  editForm.contextWindow = cfg.contextWindow ?? meta?.contextWindow ?? null
  editForm.maxTokens = cfg.maxTokens ?? meta?.maxTokens ?? null
  editForm.temperature = cfg.temperature ?? null
  editForm.note = cfg.note || meta?.note || ''
  editPrefilled.value = !!meta && (cfg.contextWindow == null || cfg.maxTokens == null)
  editOpen.value = true
}

async function saveEdit() {
  await ai.saveModelCfg(editName.value, { ...editForm })
  editOpen.value = false
  window.$msg?.success(`「${editName.value}」模型配置已保存`)
}

/** 模型行上下文徽标（仿 ZCode 模型列表的「1M」标）：优先取已启用专属配置，否则取参数表匹配值 */
function ctxTag(m) {
  const cfg = ai.modelCfg[m]
  const n = Number(cfg && cfg.enabled ? cfg.contextWindow : 0) || Number(lookupModelMeta(m)?.contextWindow) || 0
  if (!n) return ''
  return n >= 1000000 ? '1M' : n >= 1000 ? `${Math.round(n / 1000)}K` : String(n)
}
</script>

<template>
  <div class="ai-settings ai-prov">
    <!-- 左：供应商预设列表（点项 = 切换当前使用中的预设） -->
    <aside class="ai-prov-list">
      <div class="ai-prov-list-head">供应商预设</div>
      <div class="ai-prov-items">
        <button
          v-for="p in ai.providers"
          :key="p.id"
          type="button"
          class="ai-prov-item"
          :class="{ on: p.id === ai.activeProviderId, off: !p.enabled }"
          :title="p.enabled ? p.name : `${p.name}（已停用）`"
          @click="selectProvider(p.id)"
        >
          <span class="ai-prov-dot"></span>
          <span class="ai-prov-nm">{{ p.name }}</span>
        </button>
        <div v-if="!ai.providers.length" class="ai-prov-none">还没有预设</div>
      </div>
      <NPopover v-model:show="addOpen" trigger="click" placement="right-start" :show-arrow="false" :delay="80">
        <template #trigger>
          <button type="button" class="ai-prov-add"><OIcon name="plus" :size="12" /> 添加供应商</button>
        </template>
        <div class="ai-tpl-menu">
          <button
            v-for="t in PROVIDER_TEMPLATES"
            :key="t.key"
            type="button"
            class="ai-tpl-item"
            @click="addFromTemplate(t)"
          >
            <span class="ai-tpl-name">{{ t.name }}</span>
            <span class="ai-tpl-sub">{{ t.baseURL || '手动填写地址' }} · {{ t.apiFormat === 'anthropic' ? 'Anthropic Messages' : 'Chat Completions' }}</span>
          </button>
        </div>
      </NPopover>
    </aside>

    <!-- 右：当前预设详情 -->
    <section v-if="cur" class="ai-prov-detail">
      <div class="ai-detail-head">
        <span class="ai-prov-ico"><OIcon name="container" :size="15" /></span>
        <NInput
          v-model:value="form.name"
          size="small"
          class="ai-name-input"
          placeholder="供应商名称"
          @blur="saveName"
          @keydown.enter="saveName"
        />
        <NTag v-if="!cur.enabled" size="tiny" :bordered="false">已停用</NTag>
        <NButton size="tiny" quaternary title="复制预设（不含密钥）" @click="duplicateCur"><OIcon name="plus" :size="12" /></NButton>
        <NPopconfirm @positive-click="removeCur">
          <template #trigger>
            <NButton size="tiny" quaternary title="删除预设"><OIcon name="trash" :size="12" /></NButton>
          </template>
          删除「{{ cur.name }}」？该预设的密钥一并删除，其他预设不受影响。
        </NPopconfirm>
        <NSwitch size="small" :value="cur.enabled" title="启动 / 停止该供应商" @update:value="toggleProvider" />
      </div>

      <div class="ai-set-row">
        <span class="lb">Base URL</span>
        <NInput v-model:value="form.baseURL" size="small" placeholder="https://api.deepseek.com/v1" @blur="saveBaseURL" @keydown.enter="saveBaseURL" />
      </div>
      <div class="ai-set-row">
        <span class="lb">API 格式</span>
        <NSelect size="small" :value="cur.apiFormat" :options="API_FORMAT_OPTIONS" @update:value="saveFormat" />
      </div>
      <div class="ai-set-row">
        <span class="lb">API Key</span>
        <span class="ai-key-zone">
          <NInput
            v-model:value="keyInput"
            size="small"
            type="password"
            show-password-on="click"
            :placeholder="ai.hasCredential ? '已配置（输入新密钥可覆盖）' : '粘贴密钥，仅保存在本机（加密）'"
            class="ai-key-input"
            @blur="saveKey"
            @keydown.enter="saveKey"
          />
          <NTag v-if="ai.hasCredential" size="tiny" type="success" :bordered="false">已配置</NTag>
          <NButton v-if="ai.hasCredential" size="tiny" quaternary type="error" :disabled="keyBusy" @click="clearKey">清除</NButton>
        </span>
      </div>
      <div class="ai-set-note">密钥经系统凭据（Windows DPAPI）加密存放，每个预设一把；不进备份文件、不回显明文。输入后失焦即自动加密保存。</div>

      <!-- 模型列表：拉取服务商 /models 或手动添加；点行即选用，开关启停 -->
      <div class="ai-models">
        <div class="ai-models-head">
          <span class="lb">模型列表</span>
          <span class="ai-models-actions">
            <NButton
              size="tiny"
              :loading="ai.fetchingModels"
              :disabled="!form.baseURL.trim() || noModelsApi"
              :title="noModelsApi ? 'Anthropic Messages 格式不提供模型列表接口，请手动添加' : ''"
              @click="onFetch"
            >
              拉取模型
            </NButton>
            <NButton size="tiny" @click="adding = !adding">＋ 添加模型</NButton>
          </span>
        </div>
        <div v-if="adding" class="ai-model-add">
          <NInput v-model:value="newModel" size="small" placeholder="手动输入模型名，如 deepseek-chat / claude-sonnet-5" @keydown.enter="confirmAdd" />
          <NButton size="tiny" type="primary" :disabled="!newModel.trim()" @click="confirmAdd">添加</NButton>
        </div>
        <div v-if="fetchMsg" class="ai-fetch-msg" :class="fetchMsg.ok ? 'ok' : 'fail'">{{ fetchMsg.text }}</div>
        <div v-if="fetchedIds.length" class="ai-fetch-list">
          <div class="ai-fetch-title">
            <span>服务商返回 {{ fetchedIds.length }} 个模型</span>
            <NButton size="tiny" quaternary @click="fetchedIds = []">收起</NButton>
          </div>
          <div v-for="id in fetchedIds" :key="id" class="ai-fetch-row">
            <span class="ai-fetch-id" :title="id">{{ id }}</span>
            <NButton v-if="!ai.models.includes(id)" size="tiny" @click="ai.addModel(id)">＋ 添加</NButton>
            <NTag v-else size="tiny" type="success" :bordered="false">已添加</NTag>
          </div>
        </div>
        <div class="ai-model-list">
          <div
            v-for="row in ai.modelRows"
            :key="row.name"
            class="ai-model-row"
            :class="{ on: row.name === ai.model, off: !row.enabled }"
            :title="row.name === ai.model ? '当前使用的模型' : row.enabled ? '点击选用该模型' : '该模型已停止使用'"
            @click="ai.selectModel(row.name)"
          >
            <span class="ai-model-name" :title="ai.modelCfg[row.name]?.note ? `${ai.modelCfg[row.name].note}\n${row.name}` : row.name">{{ row.name }}</span>
            <NTag v-if="ctxTag(row.name)" size="tiny" :bordered="false" class="ai-model-ctx">{{ ctxTag(row.name) }}</NTag>
            <NTag v-if="ai.modelCfg[row.name]?.enabled" size="tiny" :bordered="false">专属</NTag>
            <NTag v-if="row.name === ai.model" size="tiny" type="success" :bordered="false">使用中</NTag>
            <button class="ai-model-edit" title="编辑模型配置" @click.stop="openEdit(row.name)"><OIcon name="edit" :size="11" /></button>
            <button class="ai-model-del" title="从列表移除" @click.stop="ai.removeModel(row.name)"><OIcon name="close" :size="11" /></button>
            <span class="ai-model-toggle" title="启动 / 停止该模型" @click.stop>
              <NSwitch size="small" :value="row.enabled" @update:value="(v) => ai.setModelEnabled(row.name, v)" />
            </span>
          </div>
          <div v-if="!ai.modelRows.length" class="ai-model-empty">
            列表为空——「拉取模型」获取服务商可用模型，或手动添加模型名{{ ai.model ? `（当前仍使用 ${ai.model}）` : '' }}
          </div>
        </div>
        <div class="ai-models-tip">点行即选用，使用中的模型立即生效；右侧开关可启动 / 停止单个模型。</div>
      </div>

      <!-- 预设参数：每个预设各带一份，切换预设时整套切换 -->
      <div class="ai-params-head">该预设参数</div>
      <div class="ai-set-row">
        <span class="lb">温度</span>
        <NInputNumber v-model:value="tempLocal" size="small" :min="0" :max="2" :step="0.1" style="width: 110px" @blur="saveTemperature" />
        <span class="ai-set-hint">0 严谨 · 1.2+ 更放肆</span>
      </div>
      <div class="ai-set-row">
        <span class="lb">隐私模式</span>
        <NSwitch :value="cur.params?.privacy" size="small" @update:value="setPrivacy" />
        <span class="ai-set-hint">仅发送摘要，不发送正文原文与检索片段</span>
      </div>
      <div class="ai-set-row">
        <span class="lb">自动记忆</span>
        <NSwitch :value="cur.params?.kb?.auto" :disabled="cur.params?.privacy" size="small" @update:value="setKbAuto" />
        <span class="ai-set-hint">默认关闭，开启后只更新改动章节与依赖</span>
      </div>
      <div class="ai-set-note">语义检索与向量模型已独立到左侧「知识库模型」设置；向量模型仍使用当前预设的连接。</div>

      <div class="ai-set-actions">
        <NButton size="small" :loading="testing" @click="onTest"><OIcon name="link" :size="12" /> 连接测试</NButton>
        <NTag v-if="ai.ready" size="tiny" type="success" :bordered="false">已就绪</NTag>
        <NTag v-else size="tiny" :bordered="false">{{ cur.enabled ? '未就绪' : '供应商已停用' }}</NTag>
        <span class="ai-set-hint">改动即时保存，无需再点保存设置</span>
      </div>
      <div v-if="testResult" class="ai-test-result" :class="testResult.ok ? 'ok' : 'fail'">{{ testResult.text }}</div>
    </section>

    <!-- 空态：没有任何预设 -->
    <section v-else class="ai-prov-empty">
      <p>还没有供应商预设。每个预设保存一套连接配置（地址 / API 格式 / 密钥 / 模型列表）与参数，可随时切换。</p>
      <NPopover v-model:show="addOpen" trigger="click" placement="bottom-start" :show-arrow="false">
        <template #trigger>
          <NButton size="small" type="primary">＋ 添加供应商</NButton>
        </template>
        <div class="ai-tpl-menu">
          <button
            v-for="t in PROVIDER_TEMPLATES"
            :key="t.key"
            type="button"
            class="ai-tpl-item"
            @click="addFromTemplate(t)"
          >
            <span class="ai-tpl-name">{{ t.name }}</span>
            <span class="ai-tpl-sub">{{ t.baseURL || '手动填写地址' }} · {{ t.apiFormat === 'anthropic' ? 'Anthropic Messages' : 'Chat Completions' }}</span>
          </button>
        </div>
      </NPopover>
    </section>

    <!-- 编辑模型配置（逐模型专属参数；生效规则见弹窗底部说明） -->
    <NModal v-model:show="editOpen" preset="card" style="width: 470px" title="编辑模型配置">
      <div class="ai-mc">
        <div class="ai-mc-name">{{ editName }}</div>
        <div v-if="editPrefilled" class="ai-mc-prefill">已按官方文档预填参考参数，可自行调整</div>
        <div class="ai-mc-row">
          <span class="ai-mc-lb">启用专属参数</span>
          <NSwitch v-model:value="editForm.enabled" size="small" />
        </div>
        <div class="ai-mc-row">
          <span class="ai-mc-lb">上下文窗口</span>
          <NInputNumber
            v-model:value="editForm.contextWindow"
            size="small"
            :min="0"
            :max="2000000"
            :step="1000"
            :disabled="!editForm.enabled"
            placeholder="留空跟随预设预算"
          >
            <template #suffix>tokens</template>
          </NInputNumber>
        </div>
        <div class="ai-mc-row">
          <span class="ai-mc-lb">最大输出 Token</span>
          <NInputNumber
            v-model:value="editForm.maxTokens"
            size="small"
            :min="0"
            :max="200000"
            :step="500"
            :disabled="!editForm.enabled"
            placeholder="留空不限制"
          />
        </div>
        <div class="ai-mc-row">
          <span class="ai-mc-lb">温度覆盖</span>
          <NInputNumber
            v-model:value="editForm.temperature"
            size="small"
            :min="0"
            :max="2"
            :step="0.1"
            :disabled="!editForm.enabled"
            placeholder="留空跟随预设温度"
          />
        </div>
        <div class="ai-mc-row">
          <span class="ai-mc-lb">备注</span>
          <NInput v-model:value="editForm.note" size="small" :disabled="!editForm.enabled" placeholder="选填，如「长上下文主力」" />
        </div>
        <div class="ai-mc-hint">
          启用后：上下文窗口与预设预算取更小值作为装配预算；最大输出随请求发送 max_tokens；温度覆盖优先于预设温度。关闭开关则该模型完全跟随预设设置。
        </div>
        <div class="ai-mc-foot">
          <NButton size="small" @click="editOpen = false">取消</NButton>
          <NButton size="small" type="primary" @click="saveEdit">保存</NButton>
        </div>
      </div>
    </NModal>
  </div>
</template>

<style scoped>
.ai-prov {
  display: flex;
  gap: 12px;
  align-items: stretch;
  font-size: 12.5px;
  color: var(--text);
  min-height: 460px;
}

/* ---- 左：预设列表 ---- */
.ai-prov-list {
  flex: none;
  width: 168px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-right: 10px;
  border-right: 1px solid var(--border);
}
.ai-prov-list-head {
  flex: none;
  font-size: 11px;
  color: var(--text-dim);
  padding: 0 2px;
}
.ai-prov-items {
  flex: 1;
  min-height: 120px;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.ai-prov-item {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 6px 8px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: none;
  color: var(--text);
  cursor: pointer;
  text-align: left;
  font: inherit;
  font-size: 12px;
}
.ai-prov-item:hover {
  background: color-mix(in srgb, var(--accent) 8%, transparent);
}
.ai-prov-item.on {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 10%, transparent);
}
.ai-prov-item.on .ai-prov-nm {
  color: var(--accent);
  font-weight: 600;
}
.ai-prov-item.off .ai-prov-nm {
  color: var(--text-dim);
}
.ai-prov-dot {
  flex: none;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #27ae60;
}
.ai-prov-item.off .ai-prov-dot {
  background: var(--text-faint, #999);
}
.ai-prov-nm {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ai-prov-none {
  padding: 10px 8px;
  font-size: 11.5px;
  color: var(--text-faint, var(--text-dim));
}
.ai-prov-add {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 7px 8px;
  border: 1px dashed var(--border);
  border-radius: 6px;
  background: none;
  color: var(--text-dim);
  cursor: pointer;
  font: inherit;
  font-size: 12px;
}
.ai-prov-add:hover {
  border-color: var(--accent);
  color: var(--accent);
}

/* ---- 添加供应商模板菜单 ---- */
.ai-tpl-menu {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 250px;
  max-width: 320px;
}
.ai-tpl-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 7px 9px;
  border: none;
  border-radius: 6px;
  background: none;
  color: var(--text);
  cursor: pointer;
  text-align: left;
  font: inherit;
}
.ai-tpl-item:hover {
  background: color-mix(in srgb, var(--accent) 10%, transparent);
}
.ai-tpl-name {
  font-size: 12.5px;
  font-weight: 600;
}
.ai-tpl-sub {
  font-size: 11px;
  color: var(--text-dim);
  word-break: break-all;
  font-family: var(--editor-font);
}

/* ---- 右：详情 ---- */
.ai-prov-detail {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.ai-detail-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 0 6px;
}
.ai-prov-ico {
  flex: none;
  display: inline-flex;
  color: var(--accent);
}
.ai-name-input {
  flex: 1;
  min-width: 0;
  max-width: 260px;
}
.ai-set-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px 0;
}
.ai-set-row .lb {
  flex: none;
  width: 62px;
  color: var(--text-dim);
  font-size: 11.5px;
}
.ai-set-row > :not(.lb) {
  flex: 1;
  min-width: 0;
}
.ai-set-row > .n-input-number,
.ai-set-row > .n-switch {
  flex: none;
}
.ai-set-hint {
  flex: none !important;
  color: var(--text-faint, var(--text-dim));
  font-size: 11px;
}
.ai-key-zone {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.ai-key-input {
  flex: 1 !important;
  min-width: 120px;
}
.ai-set-note {
  padding: 2px 0 4px 72px;
  color: var(--text-faint, var(--text-dim));
  font-size: 11px;
  line-height: 1.6;
}

/* 模型列表区（拉取 / 内联添加 / 点选使用 / 启停） */
.ai-models {
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 8px 10px;
  margin: 4px 0 6px 62px;
  background: var(--bg-editor, transparent);
}
.ai-models-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}
.ai-models-head .lb {
  flex: none;
  font-size: 11.5px;
  color: var(--text-dim);
}
.ai-models-actions {
  flex: 1;
  display: flex;
  justify-content: flex-end;
  gap: 6px;
}
.ai-model-add {
  display: flex;
  gap: 6px;
  margin-bottom: 6px;
}
.ai-fetch-msg {
  margin: 2px 0 6px;
  padding: 5px 8px;
  border-radius: 4px;
  font-size: 11.5px;
  line-height: 1.5;
  word-break: break-all;
}
.ai-fetch-msg.ok {
  border: 1px solid color-mix(in srgb, #27ae60 45%, transparent);
  background: color-mix(in srgb, #27ae60 10%, transparent);
}
.ai-fetch-msg.fail {
  border: 1px solid color-mix(in srgb, #c0392b 45%, transparent);
  background: color-mix(in srgb, #c0392b 8%, transparent);
}
.ai-fetch-list {
  border: 1px dashed var(--border);
  border-radius: 6px;
  margin-bottom: 8px;
  max-height: 200px;
  overflow: auto;
}
.ai-fetch-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 8px;
  font-size: 11px;
  color: var(--text-dim);
  position: sticky;
  top: 0;
  background: var(--bg-panel);
  z-index: 1;
}
.ai-fetch-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
}
.ai-fetch-row + .ai-fetch-row {
  border-top: 1px solid var(--border);
}
.ai-fetch-id {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--editor-font);
  font-size: 11.5px;
}
.ai-model-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.ai-model-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  cursor: pointer;
}
.ai-model-row:hover {
  border-color: var(--accent);
}
.ai-model-row.on {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 8%, transparent);
}
.ai-model-row.off .ai-model-name {
  color: var(--text-dim);
}
.ai-model-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  font-family: var(--editor-font);
}
.ai-model-row.on .ai-model-name {
  color: var(--accent);
  font-weight: 600;
}
.ai-model-edit {
  flex: none;
  border: none;
  background: none;
  color: var(--text-dim);
  cursor: pointer;
  padding: 2px;
  display: inline-flex;
}
.ai-model-edit:hover {
  color: var(--accent);
}
.ai-model-ctx {
  font-family: var(--editor-font);
  color: var(--text-dim);
}
.ai-model-del {
  flex: none;
  border: none;
  background: none;
  color: var(--text-dim);
  cursor: pointer;
  padding: 2px;
  display: inline-flex;
}
.ai-model-del:hover {
  color: #c0392b;
}
.ai-model-toggle {
  flex: none;
  display: inline-flex;
  align-items: center;
}
.ai-model-empty {
  padding: 8px;
  border: 1px dashed var(--border);
  border-radius: 6px;
  font-size: 11.5px;
  line-height: 1.6;
  color: var(--text-faint, var(--text-dim));
}
.ai-models-tip {
  padding-top: 4px;
  font-size: 11px;
  color: var(--text-faint, var(--text-dim));
}

/* 预设参数区 */
.ai-params-head {
  margin: 8px 0 2px 62px;
  padding-top: 8px;
  border-top: 1px dashed var(--border);
  font-size: 11px;
  color: var(--text-dim);
}

.ai-set-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 0 0 72px;
  flex-wrap: wrap;
}
.ai-set-actions :deep(.n-button__content) {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.ai-test-result {
  margin: 6px 0 0 72px;
  padding: 6px 9px;
  border-radius: 6px;
  font-size: 11.5px;
  line-height: 1.6;
  word-break: break-all;
}
.ai-test-result.ok {
  border: 1px solid color-mix(in srgb, #27ae60 45%, transparent);
  background: color-mix(in srgb, #27ae60 10%, transparent);
  color: var(--text);
}
.ai-test-result.fail {
  border: 1px solid color-mix(in srgb, #c0392b 45%, transparent);
  background: color-mix(in srgb, #c0392b 8%, transparent);
  color: var(--text);
}

/* 空态 */
.ai-prov-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  padding: 30px 18px;
  font-size: 12px;
  color: var(--text-dim);
  text-align: center;
}
.ai-prov-empty p {
  margin: 0;
  max-width: 380px;
  line-height: 1.8;
}

/* 编辑模型配置弹窗 */
.ai-mc {
  display: flex;
  flex-direction: column;
  gap: 10px;
  font-size: 12.5px;
}
.ai-mc-name {
  font-size: 13px;
  font-weight: 700;
  color: var(--accent);
  font-family: var(--editor-font);
  word-break: break-all;
}
.ai-mc-prefill {
  margin-top: -4px;
  font-size: 11px;
  color: var(--text-dim);
  line-height: 1.5;
}
.ai-mc-row {
  display: flex;
  align-items: center;
  gap: 12px;
}
.ai-mc-lb {
  flex: none;
  width: 96px;
  color: var(--text-dim);
  font-size: 12px;
}
.ai-mc-row .n-input-number,
.ai-mc-row .n-input {
  flex: 1;
}
.ai-mc-hint {
  padding: 7px 9px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--accent) 8%, transparent);
  color: var(--text-dim);
  font-size: 11px;
  line-height: 1.7;
}
.ai-mc-foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
