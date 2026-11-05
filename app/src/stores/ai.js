import { defineStore } from "pinia";
import { db } from "../db/database";
import {
  chatStream,
  testConnection,
  listModels,
  AI_ERROR_CODES,
  AiProviderError,
} from "../services/ai/provider";
import { lookupModelMeta } from "../services/ai/modelmeta";
import { guessProviderName } from "../services/ai/provider-templates";
import { runDialogue, makeDraft } from "../services/ai/dialogue";
import { confirmDerived } from '../services/ai/task-application.js';
import {
  prepareDialogue,
  requestMainPreview,
} from "../services/ai/prepare-dialogue";
import { textViews } from "../services/ai/regex";
import { plainChat } from "../services/ai/chat-text";
import {
  captureCandidate,
  storeCandidate,
  switchCandidate,
} from "../services/ai/candidates";
import { freezeContext } from "../services/ai/novel-context";
import { copy, defaultPreset } from "../services/ai/presets";
import * as presetRepo from "../db/preset-repo";
import { useWorkStore } from "./work";
import { useUiStore } from "./ui";
import { uid } from "../db/database";
import {
  snapshotWork,
  checkAbort,
  plainChapter,
  chapterHash,
  entityHash,
} from "../services/ai/contracts";
import {
  knowledgeSnapshot,
  buildKnowledge,
  replayForeshadows,
} from "../services/ai/knowledge";
import { rebuildVectors } from "../services/ai/retrieval";
import * as aiRepo from "../db/ai-repo";
import { ensureProjection } from '../db/project-repo.js';
import { completedDirectionRows } from '../services/ai/writing-directions.js';
import { freezeProviderConfig,stageBudgetOptions } from '../services/ai/stage-config.js';

/** Preset-driven conversation and independent, fixed-prompt factual memory.
 * Secrets remain encrypted in appconfig. Generated proposals never write works here.
 * Each request freezes work/source/preset and commits macros once before dispatch.
 */

const emptyUsage = () => ({
  estimatedCalls: 0,
  prompt_tokens: 0,
  completion_tokens: 0,
  total_tokens: 0,
  calls: 0,
});

const sessions = new Map();
let kbAbort = null;

/**
 * 设置写入的广播时序保护：
 * - 广播（ai-settings-changed）会回发给发送窗口自身（electron/panels.js app:broadcast），
 *   接收端以 loadSettings 重读 appconfig；
 * - 多步写入（如 saveSettings：先写预设再写密钥）若在中间态广播，接收端会读到「写了一半」的库
 *   并以过期快照覆盖内存。故：写事务期间（withWrite 计数 > 0）抑制广播，事务结束补发一次。
 */
let settingsWriteDepth = 0;
let settingsWriteSeq = 0; // 已完成写事务的序号：loadSettings 读取期间若有写事务结束，则丢弃该次过期快照
let pendingBroadcast = false;
const flushBroadcast = () => {
  if (settingsWriteDepth === 0 && pendingBroadcast) {
    pendingBroadcast = false;
    window.native?.appBroadcast?.({ kind: "ai-settings-changed" });
  }
};
const emitSettings = () => {
  if (settingsWriteDepth > 0) {
    pendingBroadcast = true;
    return;
  }
  window.native?.appBroadcast?.({ kind: "ai-settings-changed" });
};
/** 写事务包装（嵌套安全）：事务内所有 emitSettings 合并为结束时的一次广播 */
const withWrite = async (fn) => {
  settingsWriteDepth++;
  try {
    return await fn();
  } finally {
    settingsWriteDepth = Math.max(0, settingsWriteDepth - 1);
    if (settingsWriteDepth === 0) settingsWriteSeq++;
    flushBroadcast();
  }
};
/** loadSettings 的本地防御：若本窗口正在写，等写完成后再读（避免读到中间态） */
async function waitForLocalWrites(timeout = 3000) {
  const end = Date.now() + timeout;
  while (settingsWriteDepth > 0 && Date.now() < end)
    await new Promise((r) => setTimeout(r, 25));
}
const APPCFG = {
  providers: "ai.providers", // 供应商预设数组（多套配置并存；密钥单独存 ai.cred.<id>）
  activeProviderId: "ai.activeProviderId", // 当前使用中的预设
  usage: "ai.usage",
  /* —— 旧单配置键：仅迁移时读取，迁移后删除，不再写入 —— */
  baseURL: "ai.baseURL",
  model: "ai.model",
  models: "ai.models",
  modelCfg: "ai.modelcfg",
  temperature: "ai.temperature",
  maxContext: "ai.maxContext",
  privacy: "ai.privacy",
  credential: "ai.credential",
  options: "ai.options",
};
/** 每预设一把 DPAPI 密文的键名（ai.cred.<providerId>；repo 备份按 ai.cred 前缀整体排除） */
const credKey = (id) => "ai.cred." + id;
const LEGACY_KEYS = [
  APPCFG.baseURL,
  APPCFG.model,
  APPCFG.models,
  APPCFG.modelCfg,
  APPCFG.temperature,
  APPCFG.maxContext,
  APPCFG.privacy,
  APPCFG.credential,
  APPCFG.options,
];

const clampTemperature = (v) =>
  Math.min(2, Math.max(0, Number.isFinite(Number(v)) ? Number(v) : 0.7));
const clampMaxContext = (v) =>
  Math.min(
    64000,
    Math.max(1000, Number.isFinite(Number(v)) ? Math.round(Number(v)) : 10000),
  );

/** 预设默认生成/记忆参数（每预设各带一份，随预设切换） */
const defaultParams = () => ({
  temperature: 0.7,
  maxContext: 10000,
  privacy: false,
  kb: { auto: false },
  embeddings: { enabled: false, model: "" },
});
const newProviderId = () => "p_" + uid().replace(/-/g, "").slice(0, 12);

/** 装载时补全/规整预设字段（防手编数据与旧版本残留） */
function normalizeProvider(raw) {
  if (!raw || typeof raw !== "object" || !raw.id) return null;
  const params = raw.params || {};
  return {
    id: String(raw.id),
    name: String(raw.name || "未命名供应商"),
    apiFormat: raw.apiFormat === "anthropic" ? "anthropic" : "openai",
    baseURL: String(raw.baseURL || ""),
    enabled: raw.enabled !== false,
    models: Array.isArray(raw.models)
      ? raw.models
          .map((m) =>
            typeof m === "string"
              ? { name: m.trim(), enabled: true }
              : { name: String(m?.name || "").trim(), enabled: m?.enabled !== false },
          )
          .filter((m) => m.name)
      : [],
    activeModel: String(raw.activeModel || ""),
    modelCfg:
      raw.modelCfg && typeof raw.modelCfg === "object" ? raw.modelCfg : {},
    params: {
      temperature: clampTemperature(params.temperature),
      maxContext: clampMaxContext(params.maxContext),
      privacy: !!params.privacy,
      kb: { auto: !!params.kb?.auto },
      embeddings: {
        enabled: !!params.embeddings?.enabled,
        model: String(params.embeddings?.model || ""),
      },
    },
  };
}

const activeOf = (s) =>
  s.providers.find((p) => p.id === s.activeProviderId) || null;

/** AbortController 为非序列化运行时对象，不进 Pinia state（模块级保存） */
let chatAbort = null;
let evaluationAbort = null;

export const useAiStore = defineStore("ai", {
  state: () => ({
    loaded: false,
    workId: null,
    runId: null,
    options: {
      kb: { auto: false },
      embeddings: { enabled: false, model: "" },
    },
    kb: {
      sourceCoverage:null,
      cards: [],
      rows: [],
      hooks: [],
      metas: [],
      stale: 0,
      missing: 0,
      ready: 0,
      total: 0,
      progress: null,
      error: "",
      paused: false,
    },
    presets: [],
    selectedPresetId: "novel-default",
    pendingPrompt: "",
    pendingRefs: {},
    /* ---------- 设置（appconfig ai.* 持久化；多供应商预设） ---------- */
    providers: [], // 供应商预设数组：{ id, name, apiFormat, baseURL, enabled, models[{name,enabled}], activeModel, modelCfg, params }
    activeProviderId: "", // 当前使用中的预设 id（点列表项切换；生成参数随之切换）
    credentials: {}, // { [providerId]: safeStorage 密文(base64) }；明文只存在于调用瞬时内存
    fetchingModels: false, // 拉取服务商模型列表中（设置区按钮 loading）
    /* ---------- 对话：idle | assembling | generating ---------- */
    phase: "idle",
    error: null, // { code, message }（能力任务与问答共用的统一提示条）
    /* ---------- 自由问答 ---------- */
    chat: [], // [{ role:'user'|'assistant', content, streaming?, degraded?, writeHint?, writeTask?, error?, ts }]
    chatBusy: false,
    evaluation: { running: false, results: [], error: null },
    /* ---------- 用量（响应 usage 累计：本会话 + 累计，方案 §六.5） ---------- */
    usage: { session: emptyUsage(), total: emptyUsage() },
  }),

  getters: {
    /** 当前使用中的供应商预设（无预设或 id 失效时 null） */
    activeProvider: (s) => activeOf(s),
    /* 以下为旧单配置字段名的投影 getter：组件与服务层按旧名读取，改造后其余代码零改动 */
    baseURL: (s) => activeOf(s)?.baseURL || "",
    model: (s) => activeOf(s)?.activeModel || "",
    /** 使用中预设的模型名数组（旧消费方按名字读取） */
    models: (s) => (activeOf(s)?.models || []).map((m) => m.name),
    /** 使用中预设的模型行（含启停位；设置面板渲染用） */
    modelRows: (s) => activeOf(s)?.models || [],
    modelCfg: (s) => activeOf(s)?.modelCfg || {},
    temperature: (s) => activeOf(s)?.params?.temperature ?? 0.7,
    maxContext: (s) => activeOf(s)?.params?.maxContext ?? 10000,
    privacy: (s) => !!activeOf(s)?.params?.privacy,
    /** 使用中预设的生成/记忆参数（kb.auto / embeddings 读取路径与旧 options 一致） */
    options: (s) => {
      const p = activeOf(s)?.params;
      return {
        kb: p?.kb || { auto: false },
        embeddings: p?.embeddings || { enabled: false, model: "" },
      };
    },
    credential: (s) => s.credentials[s.activeProviderId] || "",
    hasCredential: (s) => !!s.credentials[s.activeProviderId],
    /** 无启用预设 / 地址 / 模型 / 密钥任一项时为 false——全部 AI 入口据此置灰（方案 §三） */
    ready: (s) => {
      const p = activeOf(s);
      return !!(
        p &&
        p.enabled &&
        p.baseURL.trim() &&
        String(p.activeModel || "").trim() &&
        s.credentials[p.id]
      );
    },
    busy: (s) =>
      s.phase === "assembling" ||
      s.phase === "generating" ||
      s.chatBusy ||
      s.evaluation.running,
  },

  actions: {
    /* ---------- 设置装载 / 保存（多供应商预设） ---------- */

    /**
     * 装载：供应商预设 ai.providers + 当前预设 ai.activeProviderId + 每预设密文 ai.cred.<id>。
     * 旧单配置（ai.baseURL/model/models/modelcfg/...）在此一次性迁移为「默认供应商」预设并删除旧键；
     * 导入旧备份后重载会再次触发同一迁移（幂等）。
     */
    async loadSettings() {
      /* 本地写事务进行中：等写完成再读（避免读到写了一半的库） */
      await waitForLocalWrites();
      const seqBefore = settingsWriteSeq;
      try {
        const rows = await db.appconfig
          .where("key")
          .startsWith("ai.")
          .toArray();
        /* 读取期间有本地写事务结束：本次快照已过期（可能缺刚写入的密钥/预设），丢弃并交由写入方广播重载 */
        if (seqBefore !== settingsWriteSeq) {
          this.loaded = true;
          return;
        }
        const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
        let providers = Array.isArray(map[APPCFG.providers])
          ? map[APPCFG.providers].map(normalizeProvider).filter(Boolean)
          : [];
        const credentials = {};
        for (const [k, v] of Object.entries(map)) {
          if (v && k.startsWith("ai.cred.")) credentials[k.slice(8)] = String(v);
        }
        if (!providers.length) {
          const migrated = await this.migrateLegacySettings(map);
          if (migrated) {
            providers = [migrated.provider];
            if (migrated.credential)
              credentials[migrated.provider.id] = migrated.credential;
          }
        } else if (LEGACY_KEYS.some((k) => map[k] != null)) {
          /* 预设已存在而旧键残留（迁移中断 / 旧备份混入）——清理，保持单一数据源 */
          await db.appconfig.bulkDelete(LEGACY_KEYS).catch(() => {});
        }
        this.providers = providers;
        this.credentials = credentials;
        const want = String(map[APPCFG.activeProviderId] || "");
        this.activeProviderId = providers.some((p) => p.id === want)
          ? want
          : providers[0]?.id || "";
        if (map[APPCFG.usage] && typeof map[APPCFG.usage] === "object") {
          this.usage.total = { ...emptyUsage(), ...map[APPCFG.usage] };
        }
      } catch {
        /* 首次启动无配置，保持默认 */
      }
      this.loaded = true;
    },

    /**
     * 旧单配置 → 多预设（幂等）：合成一个预设并写新键、删旧键。返回 { provider, credential } 或 null。
     * 密钥密文原样搬运（DPAPI 密文绑定当前用户/机器，无需重加密）。
     */
    async migrateLegacySettings(map = {}) {
      const oldModels = Array.isArray(map[APPCFG.models])
        ? map[APPCFG.models]
        : [];
      const hasLegacy =
        map[APPCFG.baseURL] != null ||
        map[APPCFG.model] != null ||
        oldModels.length > 0 ||
        map[APPCFG.credential] != null;
      if (!hasLegacy) return null;
      const baseURL = String(map[APPCFG.baseURL] || "").trim();
      const names = [];
      for (const m of oldModels)
        if (typeof m === "string" && m.trim() && !names.includes(m.trim()))
          names.push(m.trim());
      const activeModel =
        String(map[APPCFG.model] || "").trim() || names[0] || "";
      if (activeModel && !names.includes(activeModel)) names.push(activeModel);
      const provider = normalizeProvider({
        id: newProviderId(),
        name: guessProviderName(baseURL) || "默认供应商",
        apiFormat: "openai",
        baseURL,
        models: names.map((name) => ({ name, enabled: true })),
        activeModel,
        modelCfg: map[APPCFG.modelCfg],
        params: {
          temperature: map[APPCFG.temperature],
          maxContext: map[APPCFG.maxContext],
          privacy: map[APPCFG.privacy],
          kb: { auto: !!map[APPCFG.options]?.kb?.auto },
          embeddings: {
            enabled: !!map[APPCFG.options]?.embeddings?.enabled,
            model: map[APPCFG.options]?.embeddings?.model,
          },
        },
      });
      const credential = map[APPCFG.credential]
        ? String(map[APPCFG.credential])
        : "";
      await db.appconfig.put({ key: APPCFG.providers, value: [provider] });
      await db.appconfig.put({
        key: APPCFG.activeProviderId,
        value: provider.id,
      });
      if (credential)
        await db.appconfig.put({
          key: credKey(provider.id),
          value: credential,
        });
      await db.appconfig.bulkDelete(LEGACY_KEYS).catch(() => {});
      return { provider, credential };
    },

    /* ---------- 供应商预设 CRUD（即时保存：每次变更整体落库并广播） ---------- */

    async persistProviders() {
      return withWrite(async () => {
        await db.appconfig.put({
          key: APPCFG.providers,
          value: JSON.parse(JSON.stringify(this.providers)),
        });
        await db.appconfig.put({
          key: APPCFG.activeProviderId,
          value: this.activeProviderId,
        });
        emitSettings();
      });
    },

    /** 更新指定预设（浅合并补丁）并落库 */
    async patchProvider(id, patch = {}) {
      const idx = this.providers.findIndex((p) => p.id === id);
      if (idx < 0) return;
      const list = this.providers.slice();
      list[idx] = { ...list[idx], ...patch };
      this.providers = list;
      await this.persistProviders();
    },

    /** 新建预设（模板来自 provider-templates 的「添加供应商」菜单）；新预设即设为当前使用 */
    async addProvider(tpl = {}) {
      const id = newProviderId();
      const models = (Array.isArray(tpl.models) ? tpl.models : [])
        .filter((m) => typeof m === "string" && m.trim())
        .map((m) => ({ name: m.trim(), enabled: true }));
      const provider = normalizeProvider({
        id,
        name: tpl.name || "新供应商",
        apiFormat: tpl.apiFormat,
        baseURL: tpl.baseURL,
        models,
        activeModel: models[0]?.name || "",
        params: defaultParams(),
      });
      this.providers = [...this.providers, provider];
      this.activeProviderId = id;
      await this.persistProviders();
      return id;
    },

    /** 复制预设（不复制密钥：副本通常对应另一把 key，由用户自行填写） */
    async duplicateProvider(id) {
      const src = this.providers.find((p) => p.id === id);
      if (!src) return "";
      const nid = newProviderId();
      const row = {
        ...JSON.parse(JSON.stringify(src)),
        id: nid,
        name: `${src.name} 副本`,
      };
      this.providers = [...this.providers, row];
      await this.persistProviders();
      return nid;
    },

    /** 删除预设：级联删除该预设密钥；删的是当前预设则切到其他启用预设（无则清空） */
    async removeProvider(id) {
      return withWrite(async () => {
        if (!this.providers.some((p) => p.id === id)) return;
        this.providers = this.providers.filter((p) => p.id !== id);
        const next = { ...this.credentials };
        delete next[id];
        this.credentials = next;
        await db.appconfig.delete(credKey(id));
        if (this.activeProviderId === id) {
          const alt =
            this.providers.find((p) => p.enabled) || this.providers[0];
          this.activeProviderId = alt?.id || "";
        }
        await this.persistProviders();
      });
    },

    /** 切换当前使用中的预设（生成参数随之切换）；切到隐私模式预设时取消进行中的生成 */
    async setActiveProvider(id) {
      const target = this.providers.find((p) => p.id === id);
      if (!target || id === this.activeProviderId) return;
      if (target.params?.privacy && !this.privacy) this.cancel();
      this.activeProviderId = id;
      await this.persistProviders();
    },

    /** 供应商总开关（启动 / 停止该预设）：停用的是当前预设时自动切到其他启用预设 */
    async setProviderEnabled(id, enabled) {
      return withWrite(async () => {
        const p = this.providers.find((x) => x.id === id);
        if (!p || p.enabled === !!enabled) return;
        await this.patchProvider(id, { enabled: !!enabled });
        if (!enabled && this.activeProviderId === id) {
          const alt = this.providers.find((x) => x.enabled && x.id !== id);
          if (alt) await this.setActiveProvider(alt.id);
        }
      });
    },

    /** 更新当前预设的连接信息（名称 / 地址 / API 格式） */
    async updateProvider(patch = {}) {
      const p = this.activeProvider;
      if (!p) return;
      const next = {};
      if ("name" in patch)
        next.name = String(patch.name || "").trim() || "未命名供应商";
      if ("baseURL" in patch) next.baseURL = String(patch.baseURL || "").trim();
      if ("apiFormat" in patch)
        next.apiFormat =
          patch.apiFormat === "anthropic" ? "anthropic" : "openai";
      if (Object.keys(next).length) await this.patchProvider(p.id, next);
    },

    /** 更新当前预设的生成/记忆参数（温度 / 隐私 / 自动记忆 / 语义检索 / 向量模型） */
    async updateParams(patch = {}) {
      const p = this.activeProvider;
      if (!p) return;
      if (patch.privacy === true && !this.privacy) this.cancel();
      const params = { ...p.params };
      if ("temperature" in patch)
        params.temperature = clampTemperature(patch.temperature);
      if ("maxContext" in patch)
        params.maxContext = clampMaxContext(patch.maxContext);
      if ("privacy" in patch) params.privacy = !!patch.privacy;
      if ("kb" in patch) params.kb = { ...params.kb, ...patch.kb };
      if ("embeddings" in patch)
        params.embeddings = { ...params.embeddings, ...patch.embeddings };
      await this.patchProvider(p.id, { params });
    },

    /** 保存当前预设密钥：明文经 safeStorage 加密落 ai.cred.<id>；本函数不持有明文、不写明文到任何持久层 */
    async saveProviderKey(plain) {
      return withWrite(async () => {
        const p = this.activeProvider;
        if (!p) throw new Error("请先在模型设置中添加供应商预设");
        const text = String(plain || "");
        if (!text) return this.clearProviderKey();
        const cipher = await window.native?.credentialEncrypt?.(text);
        if (!cipher)
          throw new Error(
            "本机凭据加密不可用（safeStorage），无法保存 API 密钥",
          );
        this.credentials = { ...this.credentials, [p.id]: cipher };
        await db.appconfig.put({ key: credKey(p.id), value: cipher });
        emitSettings();
      });
    },

    async clearProviderKey() {
      return withWrite(async () => {
        const p = this.activeProvider;
        if (!p) return;
        const next = { ...this.credentials };
        delete next[p.id];
        this.credentials = next;
        await db.appconfig.delete(credKey(p.id));
        emitSettings();
      });
    },

    /**
     * 兼容入口（旧组件与验收脚本）：把单配置补丁映射到当前预设；无预设时先建「默认供应商」。
     * apiKey 为明文入参：非空经 safeStorage 加密落 ai.cred.<id>，传空串清除；
     * 本函数不持有明文状态、不把明文写进任何持久层。
     * 整体为一次写事务：多键补丁（预设 + 密钥）只广播一次，避免中间态被并发重载覆盖。
     */
    async saveSettings(patch = {}) {
      return withWrite(async () => {
        if (!this.providers.length)
          await this.addProvider({ name: "默认供应商" });
        const p = this.activeProvider;
        if (!p) return;
        const provPatch = {};
        if ("options" in patch) {
          const { roles, ...live } = patch.options || {};
          const params = { ...p.params };
          if (live.kb)
            params.kb = { ...(p.params?.kb || { auto: false }), ...live.kb };
          if (live.embeddings)
            params.embeddings = {
              ...(p.params?.embeddings || { enabled: false, model: "" }),
              ...live.embeddings,
            };
          provPatch.params = params;
        }
        if (patch.privacy === true && !this.privacy) this.cancel();
        if (
          "privacy" in patch ||
          "temperature" in patch ||
          "maxContext" in patch
        ) {
          const params = { ...(provPatch.params || p.params) };
          if ("privacy" in patch) params.privacy = !!patch.privacy;
          if ("temperature" in patch)
            params.temperature = clampTemperature(patch.temperature);
          if ("maxContext" in patch)
            params.maxContext = clampMaxContext(patch.maxContext);
          provPatch.params = params;
        }
        if ("baseURL" in patch)
          provPatch.baseURL = String(patch.baseURL || "").trim();
        if ("model" in patch)
          provPatch.activeModel = String(patch.model || "").trim();
        if (Object.keys(provPatch).length)
          await this.patchProvider(p.id, provPatch);
        if ("apiKey" in patch) {
          const plain = String(patch.apiKey || "");
          if (plain) await this.saveProviderKey(plain);
          else await this.clearProviderKey();
        }
      });
    },

    /* ---------- 模型列表（拉取 / 手动添加 / 启停 / 点选使用；均作用于当前预设） ---------- */

    /** 加入当前预设的模型列表（手动输入或从拉取结果点加）；去重；使用中模型为空时自动选用它 */
    async addModel(name) {
      return withWrite(async () => {
        const p = this.activeProvider;
        const m = String(name || "").trim();
        if (!p || !m) return;
        if (!p.models.some((x) => x.name === m)) {
          const models = [...p.models, { name: m, enabled: true }];
          const patch = { models };
          if (!String(p.activeModel || "").trim()) patch.activeModel = m;
          await this.patchProvider(p.id, patch);
        }
        await this.autoFillModelCfg(m);
      });
    },

    /** 从当前预设移除模型；删的是使用中模型则自动切到该预设第一个启用模型；专属参数级联清理 */
    async removeModel(name) {
      const p = this.activeProvider;
      const m = String(name || "").trim();
      if (!p || !p.models.some((x) => x.name === m)) return;
      const models = p.models.filter((x) => x.name !== m);
      const nextCfg = { ...p.modelCfg };
      delete nextCfg[m];
      const patch = { models, modelCfg: nextCfg };
      if (p.activeModel === m)
        patch.activeModel =
          (models.find((x) => x.enabled) || models[0] || {}).name || "";
      await this.patchProvider(p.id, patch);
    },

    /** 模型启停（停止的模型不可选用；停用的是使用中模型则自动切到第一个启用模型） */
    async setModelEnabled(name, enabled) {
      const p = this.activeProvider;
      const m = String(name || "").trim();
      if (!p || !p.models.some((x) => x.name === m)) return;
      const models = p.models.map((x) =>
        x.name === m ? { ...x, enabled: !!enabled } : x,
      );
      const patch = { models };
      if (!enabled && p.activeModel === m)
        patch.activeModel = (models.find((x) => x.enabled) || {}).name || "";
      await this.patchProvider(p.id, patch);
    },

    /**
     * 自动填入模型参数（与 ZCode 模型编辑一致）：模型名命中参数表且尚无已保存配置时，
     * 自动创建专属参数（上下文窗口 / 最大输出 / 备注取自官方口径）并持久化——
     * 生效预算与 max_tokens 随之生效。已保存配置的模型不覆盖（用户手改值优先）。
     */
    async autoFillModelCfg(name) {
      const p = this.activeProvider;
      const m = String(name || "").trim();
      if (!p || !m || p.modelCfg[m]) return;
      const meta = lookupModelMeta(m);
      if (!meta || (!meta.contextWindow && !meta.maxTokens)) return;
      await this.patchProvider(p.id, {
        modelCfg: {
          ...p.modelCfg,
          [m]: {
            enabled: true,
            contextWindow: meta.contextWindow ?? null,
            maxTokens: meta.maxTokens ?? null,
            temperature: null,
            note: meta.note || "",
          },
        },
      });
    },

    /** 保存某模型的专属参数（编辑弹窗）；enabled=false 时运行时完全跟随预设参数 */
    async saveModelCfg(name, patch = {}) {
      const p = this.activeProvider;
      const m = String(name || "").trim();
      if (!p || !m) return;
      await this.patchProvider(p.id, {
        modelCfg: {
          ...p.modelCfg,
          [m]: {
            enabled: patch.enabled !== false,
            contextWindow:
              Number(patch.contextWindow) > 0
                ? Math.round(Number(patch.contextWindow))
                : null,
            maxTokens:
              Number(patch.maxTokens) > 0
                ? Math.round(Number(patch.maxTokens))
                : null,
            temperature:
              patch.temperature != null && Number(patch.temperature) >= 0
                ? clampTemperature(patch.temperature)
                : null,
            note: String(patch.note || "").slice(0, 100),
          },
        },
      });
    },

    /** 点选当前预设的使用中模型（立即持久化，无需再点保存）；停用模型不可选用；命中参数表时自动预填专属参数 */
    async selectModel(name) {
      return withWrite(async () => {
        const p = this.activeProvider;
        const m = String(name || "").trim();
        if (!p || !m) return;
        const row = p.models.find((x) => x.name === m);
        if (row && row.enabled === false) return;
        await this.autoFillModelCfg(m);
        if (p.activeModel === m) return;
        await this.patchProvider(p.id, { activeModel: m });
      });
    },

    /** 拉取当前预设的服务商模型列表：密钥可选（Ollama 本地无需）；Anthropic 格式不支持；错误经 errorFrom 归一为统一文案 */
    async fetchModelList() {
      const p = this.activeProvider;
      if (!p || !p.baseURL.trim()) {
        throw new AiProviderError(
          AI_ERROR_CODES.NOT_CONFIGURED,
          "恍然梦未配置：请先填写并保存 API 地址",
        );
      }
      this.fetchingModels = true;
      try {
        const apiKey = this.hasCredential ? await this.decryptCredential() : "";
        return await listModels({
          baseURL: p.baseURL.trim(),
          apiKey,
          apiFormat: p.apiFormat,
        });
      } catch (e) {
        throw this.errorFrom(e);
      } finally {
        this.fetchingModels = false;
      }
    },

    /** 密钥即时解密（仅本次调用内存使用；密文无效/解密失败 → 提示重新配置） */
    async decryptCredential(providerId = this.activeProviderId) {
      const cipher = this.credentials[providerId];
      if (!cipher) return "";
      const plain = await window.native?.credentialDecrypt?.(cipher);
      if (typeof plain !== "string")
        throw new Error(
          "API 密钥解密失败（密文无效或系统凭据已变化），请到设置中重新保存密钥",
        );
      return plain;
    },

    /** 组装 provider 调用参数（request/对话编排消费形态）：连接信息 + API 格式取自当前预设；未配置或网页版在此拦截 */
    async buildOpts(stage = {}) {
      if (!window.native?.credentialDecrypt) {
        throw new AiProviderError(
          AI_ERROR_CODES.NOT_CONFIGURED,
          "恍然梦仅桌面版可用（网页版无凭据加密通道）",
        );
      }
      const p = stage.providerId ? this.providers.find(p=>p.id===stage.providerId) : this.activeProvider;
      const selectedModel = stage.model || p?.activeModel;
      if (!p || !p.baseURL.trim() || !String(selectedModel || "").trim()) {
        throw new AiProviderError(
          AI_ERROR_CODES.NOT_CONFIGURED,
          "恍然梦未配置：请先在设置中添加供应商并填写 API 地址与模型",
        );
      }
      if (!p.enabled) {
        throw new AiProviderError(
          AI_ERROR_CODES.NOT_CONFIGURED,
          "当前供应商已停用：请在模型设置中启用它，或切换到其他供应商",
        );
      }
      if(stage.model&&!p.models?.some(m=>m.name===stage.model&&m.enabled!==false))throw new Error('阶段模型不属于所选供应商或已停用');
      const providerFingerprint=freezeProviderConfig(p,selectedModel).providerConfigFingerprint;
      if(stage.providerConfigFingerprint&&stage.providerConfigFingerprint!==providerFingerprint)throw new Error('阶段供应商配置已变化，请新建工作流后重试');
      const apiKey = await this.decryptCredential(p.id);
      if(freezeProviderConfig(p,selectedModel).providerConfigFingerprint!==providerFingerprint)throw new Error('阶段供应商配置已变化，请重试');
      if (!apiKey) {
        throw new AiProviderError(
          AI_ERROR_CODES.NOT_CONFIGURED,
          "恍然梦未配置：请先在设置中保存 API 密钥",
        );
      }
      return {
        baseURL: p.baseURL.trim(),
        apiKey,
        apiFormat: p.apiFormat === "anthropic" ? "anthropic" : "openai",
        ...this.generationOpts(p, selectedModel),
        embeddings:p.params?.embeddings||{enabled:false},
      };
    },
    generationOpts(p = this.activeProvider, selectedModel = null) {
      const model = String(selectedModel || p?.activeModel || "").trim();
      const cfg = p?.modelCfg?.[model]?.enabled ? p.modelCfg[model] : null;
      const known = lookupModelMeta(model);
      const limit = (a, b) => {
        const n = Math.min(
          Number(a) > 0 ? Number(a) : Infinity,
          Number(b) > 0 ? Number(b) : Infinity,
        );
        return Number.isFinite(n) ? n : 0;
      };
      return {
        model,
        inputBudget: p?.params?.maxContext ?? this.maxContext,
        contextWindow: limit(cfg?.contextWindow, known?.contextWindow),
        maxOutputTokens: limit(cfg?.maxTokens, known?.maxTokens),
        temperature:
          cfg?.temperature != null
            ? clampTemperature(cfg.temperature)
            : (p?.params?.temperature ?? this.temperature),
        maxTokens:
          Number(cfg?.maxTokens) > 0 ? Math.round(Number(cfg.maxTokens)) : 2048,
      };
    },

    /* ---------- 用量统计（session + total，total 持久化） ---------- */
    addUsage(u) {
      if (!u) return;
      const add = (t) => {
        t.prompt_tokens += Number(u?.prompt_tokens) || 0;
        t.completion_tokens += Number(u?.completion_tokens) || 0;
        t.total_tokens += Number(u?.total_tokens) || 0;
        t.calls++;
        if (u.estimated) t.estimatedCalls = (t.estimatedCalls || 0) + 1;
      };
      add(this.usage.session);
      add(this.usage.total);
      db.appconfig
        .put({
          key: APPCFG.usage,
          value: JSON.parse(JSON.stringify(this.usage.total)),
        })
        .catch(() => {});
    },

    /* ---------- 错误归一 ---------- */
    errorFrom(err) {
      if (err instanceof AiProviderError)
        return { code: err.code, message: err.message };
      if (err?.name === "AbortError")
        return { code: "aborted", message: "已取消" };
      return { code: "api", message: String(err?.message || err) };
    },

    /* ---------- 作品隔离、预设与统一对话 ---------- */

    /** 通用任务执行：装配 → 流式生成 → 卡片（提案，不落库）。失败置 phase=failed 并返回 null */
    switchWork(workId) {
      if (this.workId === workId) return;
      if (this.workId)
        sessions.set(this.workId, {
          chat: this.chat.filter((m) => !m.streaming),
        });
      this.cancel();
      this.workId = workId;
      this.chat = sessions.get(workId)?.chat || [];
      this.pendingPrompt = "";
      this.pendingRefs = {};
      this.selectedPresetId = "novel-default";
      this.loadPresets().catch((e) => {
        this.error = this.errorFrom(e);
      });
      this.restoreTaskHistory(workId).catch(e=>{this.error=this.errorFrom(e)});
      this.kb = {
        cards: [],
        rows: [],
        hooks: [],
        metas: [],
        stale: 0,
        missing: 0,
        ready: 0,
        total: 0,
        progress: null,
        error: "",
        paused: false,
      };
    },
    async restoreTaskHistory(workId) {
      const rows=await aiRepo.aiRows('airuns',workId);
      if(this.workId!==workId||this.chatBusy)return;
      const audits=rows.filter(r=>['application','workflow-application'].includes(r.type));
      const writingCandidates=new Map(rows.filter(r=>r.type==='writing-session').sort((a,b)=>a.updatedAt-b.updatedAt).flatMap(r=>(r.session?.candidates||[]).map(c=>[c.id,c])));
      const latest=[...new Map(rows.filter(r=>r.type==='agent-task'&&r.result).sort((a,b)=>a.createdAt-b.createdAt).map(r=>[r.result.id,r])).values()];
      for(const row of latest) {
        if(this.chat.some(m=>m.id===row.result.id))continue;
        const message=copy(row.result);
        message.cards=message.cards.filter(c=>c.status!=='rejected');
        for(const card of message.cards) {
          if(writingCandidates.has(card.id))Object.assign(card,copy(writingCandidates.get(card.id)));
          const audit=audits.filter(a=>a.cardId===card.id).sort((a,b)=>b.createdAt-a.createdAt)[0];
          if(audit){card.status=audit.status==='applied'?'applied':'undone';card.auditId=audit.status==='applied'?audit.id:null;card.appliedActions=audit.status==='applied'?[audit.action||'apply']:[]}
        }
        if(row.question)this.chat.push({id:message.id+':request',workId,role:'user',content:row.question,rawContent:row.question,source:message.source,ts:message.ts});
        this.chat.push(message);
      }
    },
    async dismissCard(message,id) {
      const card=message.cards.find(c=>c.id===id);
      if(card?.status==='applied')throw new Error('已应用的提案请先撤销');
      if(card)card.status='rejected';
      const record=await db.airuns.get(message.runId);
      if(record?.type==='agent-task'&&record.result){const stored=record.result.cards.find(c=>c.id===id);if(stored)stored.status='rejected';await aiRepo.putAiRow('airuns',record)}
      message.cards=message.cards.filter(c=>c.id!==id);
      storeCandidate(message);
    },
    async loadPresets() {
      const workId = this.workId;
      this.presets = await presetRepo.listPresets();
      if (workId) {
        const state = await presetRepo.presetState(workId);
        if (this.workId === workId)
          this.selectedPresetId = this.presets.some(
            (p) => p.id === state.presetId,
          )
            ? state.presetId
            : "novel-default";
      }
    },
    async selectPreset(id) {
      if (!this.presets.some((p) => p.id === id)) throw new Error("预设不存在");
      const workId = this.workId,
        state = await presetRepo.presetState(workId);
      await presetRepo.commitState({ ...state, presetId: id }, null);
      if (this.workId === workId) this.selectedPresetId = id;
      window.native?.appBroadcast?.({ kind: "ai-presets-changed" });
    },
    async savePreset(row, { activateWorkId = null } = {}) {
      const saved = await presetRepo.savePreset(row, activateWorkId);
      await this.loadPresets();
      window.native?.appBroadcast?.({ kind: "ai-presets-changed" });
      return saved;
    },
    async deletePreset(id) {
      await presetRepo.deletePreset(id);
      await this.loadPresets();
      window.native?.appBroadcast?.({ kind: "ai-presets-changed" });
    },
    prepare(text, contextRefs = {}) {
      this.pendingPrompt = text;
      this.pendingRefs = contextRefs;
      useUiStore().aiDrawerOpen = true;
    },
    cancel() {
      evaluationAbort?.abort();
      chatAbort?.abort();
      chatAbort = null;
      this.runId = null;
      this.chatBusy = false;
      this.phase = "idle";
      for (const m of this.chat.filter((m) => m.streaming)) {
        m.streaming = false;
        m.complete = false;
        m.error = { code: "aborted", message: "已停止，保留已生成内容" };
        m.cards?.forEach((c) => {
          c.complete = false;
          c.status = "incomplete";
        });
      }
    },
    async previewPreset(row, question = "本次发送预览", request = {}) {
      const live = useWorkStore();
      if (
        new URLSearchParams(location.search).has("panel") &&
        !request.localPreview
      )
        return requestMainPreview(row, question, {
          ...request,
          workId: live.work?.id,
        });
      if (!live.work) throw new Error("请在主窗口打开关联作品后预览");
      const work = snapshotWork(live);
      work.selectedChapterId = live.selChapterId;
      const frozen = freezeContext(work, request, question);
      const [local, global] = await Promise.all([
        presetRepo.presetState(work.work.id),
        presetRepo.globalState(),
      ]);
      const type =
        request.generationType === "regenerate"
          ? "swipe"
          : request.generationType || "normal";
      let messages = this.chat,
        continuationText = "",
        candidateIndex = 0;
      if (type === "continue" || type === "swipe") {
        const index = request.messageId
          ? messages.findIndex((m) => m.id === request.messageId)
          : messages.findLastIndex((m) => m.role === "assistant");
        if (index < 0)
          throw new Error("当前会话没有可继续或重新生成的助手回复");
        const target = messages[index];
        candidateIndex = target.candidates?.length || 1;
        continuationText =
          target.cards?.find((c) => c.kind === "draft")?.text ||
          target.rawContent ||
          target.content;
        messages = messages.slice(0, type === "continue" ? index + 1 : index);
      }
      const prepared = await prepareDialogue({
        work,
        frozen,
        row,
        messages,
        question,
        generationType: type,
        continuationText,
        candidateIndex,
        state: this.privacy
          ? { local: {}, global: {} }
          : { local: local.local, global: global.global },
        opts: { ...this.generationOpts(), privacy: this.privacy },
      });
      return {
        ...prepared.compiled,
        source: frozen,
        sourceReport: prepared.material.report,
      };
    },
    async send(question, request = {}) {
      if (!request.taskRequest && request.contextRefs?.taskRequest) request = {...request,taskRequest:request.contextRefs.taskRequest};
      if (request.taskRequest) {
        const task=request.taskRequest;
        request={...request,contextRefs:{...request.contextRefs,chapterId:task.chapterId,selection:task.selection,outlineId:task.module==='outline'||task.type.startsWith('outline.')?task.targetId:undefined,loreId:task.type.startsWith('lore.')?task.targetId:undefined,characterId:task.type.startsWith('character.')?task.targetId:undefined}};
      }
      const privacy = this.privacy;
      const q = String(question || "").trim(),
        live = useWorkStore();
      const variantId =
        request.regenerateMessageId || request.continueMessageId;
      if ((!q && !variantId) || this.busy || !live.work) return false;
      this.switchWork(live.work.id);
      const work = snapshotWork(live);
      work.selectedChapterId = live.selChapterId;
      const workId = work.work.id,
        runId = uid(),
        ctl = new AbortController();
      chatAbort = ctl;
      this.runId = runId;
      this.chatBusy = true;
      this.phase = "assembling";
      this.error = null;
      const current = () =>
        chatAbort === ctl &&
        this.runId === runId &&
        this.workId === workId &&
        !ctl.signal.aborted;
      let msg,
        viewTimer,
        compiled,
        row,
        viewVersion = 0;
      const notice = (t) => {
        if (current() && msg?.context && !msg.context.warnings.includes(t))
          msg.context.warnings.push(t);
      };
      const refreshViews = async () => {
        if (!compiled || !row || !msg) return;
        const version = ++viewVersion,
          raw = msg.rawContent || "";
        const views = await textViews(
          raw,
          row,
          2,
          compiled.macroEnv,
          compiled.macroState,
        );
        if (!current() || version !== viewVersion) return;
        Object.assign(msg, {
          content: views.text,
          displayText: views.displayText,
          promptText: views.promptText,
          plainText: plainChat(views.text),
        });
        views.warnings.forEach(notice);
        if (msg.reasoning?.rawText) {
          const r = await textViews(
            msg.reasoning.rawText,
            row,
            6,
            compiled.macroEnv,
            compiled.macroState,
          );
          if (current() && version === viewVersion) msg.reasoning = r;
          r.warnings.forEach(notice);
        }
      };
      try {
        const frozen = freezeContext(work, request, q),
          generationType = variantId
            ? request.continueMessageId
              ? "continue"
              : "swipe"
            : request.generationType === "regenerate"
              ? "swipe"
              : request.generationType || "normal";
        const index = variantId
          ? this.chat.findIndex((m) => m.id === variantId)
          : -1;
        const original = index >= 0 ? this.chat[index] : null,
          old = original ? captureCandidate(original) : null;
        if (variantId && (!original || original.workId !== workId))
          throw new Error("原候选不属于当前作品会话");
        if (
          request.continueMessageId &&
          (privacy ||
            old.source.sourceHash !== frozen.sourceHash ||
            old.source.layoutHash !== frozen.layoutHash ||
            (old.source.sourceVersions || []).some((v) => {
              const source = work[v.table]?.find((r) => r.id === v.id);
              return (
                !source ||
                (v.table === "chapters"
                  ? chapterHash(source)
                  : entityHash(source)) !== v.hash
              );
            }))
        )
          throw new Error(
            privacy
              ? "隐私模式不发送已有输出，请在本轮输入续写要求"
              : "继续生成的来源已变化，请重新生成候选",
          );
        const priorMessages = copy(
          index >= 0
            ? this.chat.slice(0, request.continueMessageId ? index + 1 : index)
            : this.chat,
        );
        const previousDraft = old?.cards?.find((c) => c.kind === "draft");
        if (original) {
          storeCandidate(original);
          original.activeCandidate = original.candidates.length;
          original.candidates.push({ content: "", cards: [], complete: false });
          msg = original;
          for (const key of [
            "error",
            "context",
            "preset",
            "finishReason",
            "rounds",
            "toolOutput",
            "reasoning",
          ])
            delete msg[key];
          Object.assign(msg, {
            content: "",
            rawContent: "",
            displayText: "",
            promptText: "",
            plainText: "",
            cards: [],
            source: frozen,
            runId,
            streaming: true,
            complete: false,
          });
        } else {
          const user = {
            id: uid(),
            workId,
            role: "user",
            content: q,
            rawContent: q,
            source: frozen,
            ts: Date.now(),
          };
          this.chat.push(user, {
            id: uid(),
            workId,
            runId,
            role: "assistant",
            content: "",
            rawContent: "",
            cards: [],
            source: frozen,
            streaming: true,
            complete: false,
            ts: Date.now(),
            candidates: [],
            activeCandidate: 0,
          });
          msg = this.chat.at(-1);
        }
        const stageModule = await import('../services/ai/stage-config.js');
        const selectedStage = request.stageSnapshot || (frozen.taskRequest ? stageModule.freezeStage(await stageModule.loadStageConfig(),stageModule.stageForTask(frozen.taskRequest.type),{providers:this.providers,presets:this.presets,currentProviderId:this.activeProviderId,currentModel:this.model}) : {});
        const [providerOpts, rows, local, global] = await Promise.all([
          this.buildOpts(selectedStage),
          presetRepo.listPresets(),
          presetRepo.presetState(workId),
          presetRepo.globalState(),
        ]);
        const opts=stageBudgetOptions(providerOpts,request.rootRemaining);
        if (!current()) return false;
        row = copy(selectedStage.presetSnapshot ||
          rows.find(
            (p) =>
              p.id ===
              (request.presetId || selectedStage.presetId || local.presetId || this.selectedPresetId),
          ) || defaultPreset(),
        );
        const prepared = await prepareDialogue({
          work,
          frozen,
          row,
          messages: priorMessages,
          question: q,
          generationType,
          state: privacy
            ? { local: {}, global: {} }
            : { local: local.local, global: global.global },
          opts: { ...opts, privacy: privacy, signal:ctl.signal,stageSnapshot:selectedStage,onUsage:u=>{this.addUsage(u);request.onStageUsage?.(u)} },
          continuationText:
            previousDraft?.text || old?.rawContent || old?.content || "",
          candidateIndex: msg.activeCandidate,
        });
        compiled = prepared.compiled;
        if(Number.isFinite(request.rootRemaining))prepared.material.report.push('有界批次使用关键词检索，向量检索不额外消耗批次预算');
        if (!current()) return false;
        if (!original) {
          const user = this.chat.at(-2);
          Object.assign(user, {
            content: prepared.userViews.text,
            displayText: prepared.userViews.displayText,
            promptText: prepared.userViews.promptText,
          });
        }
        await presetRepo.commitState(
          {
            ...local,
            presetId: row.id,
            local: privacy ? local.local : compiled.macroState.local,
          },
          privacy ? null : { ...global, global: compiled.macroState.global },
        );
        if (!current()) return false;
        msg.context = {
          report: prepared.material.report,
          blocks: compiled.report,
          trace: compiled.trace,
          warnings: compiled.warnings,
          dropped: compiled.dropped,
          tokens: compiled.tokens,
          materials:prepared.material.materials,
          budget:prepared.material.budget,
          retrieval:prepared.material.retrieval,
        };
        msg.stageSnapshot=copy({...selectedStage,providerId:selectedStage.providerId||this.activeProviderId,model:opts.model});
        msg.preset = compiled.presetSnapshot;
        this.phase = "generating";
        const response = await runDialogue({
          compiled,
          work,
          frozen,
          runId,
          messageId: msg.id,
          opts: {
            ...opts,
            signal: ctl.signal,
            privacy: privacy,
            rootRemaining:request.rootRemaining,
            onToolDelta: (call) => {
              if (current()) {
                msg.toolOutput = call.function?.arguments || "";
                if(frozen.taskRequest?.type==='chapter.story'&&call.function?.name==='submit_chapter')try{request.onStoryProgress?.(msg.toolOutput)}catch(e){notice(e.message)}
                if(frozen.taskRequest?.type==='chapter.directions'&&call.function?.name==='submit_plot_directions') {
                  const rows=completedDirectionRows(msg.toolOutput)
                  if(rows.length)try{request.onDirectionRows?.(rows)}catch(e){notice(e.message)}
                }
              }
            },
            onReasoningDelta: (d) => {
              if (current()) {
                msg.reasoning ||= { rawText: "" };
                msg.reasoning.rawText += d;
              }
            },
          },
          onCard: (card) => {
            if (current())
              msg.cards.push({
                ...card,
                complete: false,
                status: "incomplete",
              });
          },
          onDelta: (d) => {
            if (current()) {
              msg.rawContent += d;
              msg.content = msg.rawContent;
              if (!viewTimer)
                viewTimer = setTimeout(() => {
                  viewTimer = null;
                  refreshViews().catch((e) => notice(e.message));
                }, 120);
            }
          },
          onUsage: (u) => {this.addUsage(u);request.onStageUsage?.(u)},
          onNotice: notice,
        });
        if (!current()) return false;
        clearTimeout(viewTimer);
        Object.assign(msg, {
          rawContent: response.answer,
          cards: response.cards,
          complete: response.complete,
          finishReason: response.finishReason,
          rounds: response.reports,
        });
        if (request.continueMessageId) {
          const next = msg.cards.find((c) => c.kind === "draft");
          if (previousDraft && next)
            msg.cards = [
              makeDraft(previousDraft.text + next.text, frozen, {
                runId,
                messageId: msg.id,
                title: previousDraft.title,
                complete: msg.complete,
              }),
            ];
          else if (previousDraft && response.answer)
            msg.cards = [
              makeDraft(
                previousDraft.text +
                  (row.payload.continue_postfix ?? "") +
                  response.answer,
                frozen,
                {
                  runId,
                  messageId: msg.id,
                  title: previousDraft.title,
                  complete: msg.complete,
                },
              ),
            ];
          msg.rawContent =
            (old.rawContent ?? old.content) +
            (row.payload.continue_postfix ?? "") +
            response.answer;
        }
        await refreshViews();
        return true;
      } catch (e) {
        if (current()) {
          this.error = this.errorFrom(e);
          if (msg) {
            msg.error = this.error;
            msg.complete = false;
            msg.cards?.forEach((c) => {
              c.complete = false;
              c.status = "incomplete";
            });
          }
        }
        return false;
      } finally {
        clearTimeout(viewTimer);
        if (msg) {
          msg.streaming = false;
          request.onMessage?.(msg);
          storeCandidate(msg);
          if (msg.source?.taskRequest) {
            try {await aiRepo.putAiRow('airuns',{id:runId,workId,type:'agent-task',question:q,taskType:msg.source.taskRequest.type,status:ctl.signal.aborted?'cancelled':msg.complete?'completed':'incomplete',model:compiled?.opts?.model||this.model,preset:msg.preset,sourceVersions:msg.source.sourceVersions,createdAt:Date.now(),result:copy({id:msg.id,workId,runId,role:'assistant',content:msg.content,rawContent:msg.rawContent,cards:msg.cards,source:msg.source,complete:msg.complete,error:msg.error,finishReason:msg.finishReason,context:msg.context,ts:msg.ts})})}
            catch(e){notice('任务记录保存失败：'+e.message)}
          }
        }
        if (chatAbort === ctl) {
          chatAbort = null;
          this.chatBusy = false;
          this.phase = "idle";
          if (this.workId === workId) this.restoreTaskHistory(workId).catch(e=>{this.error=this.errorFrom(e)});
        }
      }
    },
    async evaluatePresets(ids, question, requirements = {}) {
      const live = useWorkStore();
      if (this.busy || !live.work || !this.ready)
        throw new Error("打开作品并配置模型后，等待当前生成结束再开始");
      if (ids.length !== 2 || ids[0] === ids[1] || !question.trim())
        throw new Error("请选择不同的两套预设并填写同一创作要求");
      const work = snapshotWork(live);
      work.selectedChapterId = live.selChapterId;
      const frozen = freezeContext(work, {}, question),
        workId = work.work.id,
        ctl = new AbortController();
      evaluationAbort = ctl;
      this.evaluation = { running: true, results: [], error: null };
      try {
        const [opts, rows, local, global] = await Promise.all([
          this.buildOpts(),
          presetRepo.listPresets(),
          presetRepo.presetState(workId),
          presetRepo.globalState(),
        ]);
        // Both arms share a fixed source and history. Evaluation never commits macro variables or proposals.
        const messages = copy(this.chat),
          state = this.privacy
            ? { local: {}, global: {} }
            : { local: local.local, global: global.global };
        for (const id of ids) {
          const row = copy(rows.find((p) => p.id === id));
          if (!row) throw new Error("评测预设不存在");
          const prepared = await prepareDialogue({
            work,
            frozen: copy(frozen),
            row,
            messages,
            question,
            state,
            opts: { ...opts, privacy: this.privacy },
          });
          for (let trial = 1; trial <= 3; trial++) {
            checkAbort(ctl.signal);
            if (live.work?.id !== workId)
              throw new Error("作品已切换，评测已停止");
            const r = await chatStream({
              ...opts,
              ...prepared.compiled.opts,
              signal: ctl.signal,
              messages: prepared.compiled.messages,
            });
            checkAbort(ctl.signal);
            this.addUsage(
              r.usage || {
                prompt_tokens: prepared.compiled.tokens.used,
                completion_tokens: Math.ceil(r.text.length / 2),
                estimated: true,
              },
            );
            const views = await textViews(
              r.text,
              row,
              2,
              prepared.compiled.macroEnv,
              prepared.compiled.macroState,
            );
            const checks = {
              language:
                requirements.language === "英文"
                  ? !/[\u4e00-\u9fff]/.test(views.text)
                  : /[\u4e00-\u9fff]/.test(views.text),
              firstPerson:
                requirements.person === "第一人称"
                  ? /我/.test(views.text)
                  : null,
              format:
                requirements.format === "JSON"
                  ? (() => {
                      try {
                        JSON.parse(views.text);
                        return true;
                      } catch {
                        return false;
                      }
                    })()
                  : requirements.format === "代码块"
                    ? /```/.test(views.text)
                    : null,
              explanation: /以下是|作为AI|创作说明|修改说明/i.test(views.text),
            };
            this.evaluation.results.push({
              preset: prepared.compiled.presetSnapshot,
              source: prepared.material.report,
              trial,
              rawText: r.text,
              text: views.text,
              checks,
              finishReason: r.finishReason,
              usage: r.usage || { estimated: true },
              rating: null,
              notes: "",
              warnings: views.warnings,
            });
          }
        }
      } catch (e) {
        this.evaluation.error = this.errorFrom(e);
      } finally {
        if (evaluationAbort === ctl) evaluationAbort = null;
        this.evaluation.running = false;
      }
      return this.evaluation.results;
    },
    selectCandidate(msg, index) {
      if (this.busy) throw new Error("生成结束后可切换候选");
      switchCandidate(msg, index);
    },
    continueMessage(msg) {
      return this.send("", {
        generationType: "continue",
        scope: msg.source.scope,
        contextRefs: {
          ...msg.source.refs,
          chapterId: msg.source.chapterId,
          selection: msg.source.selection,
        },
        continueMessageId: msg.id,
        taskRequest: msg.source.taskRequest,
      });
    },
    regenerateMessage(msg) {
      const index = this.chat.indexOf(msg),
        question = this.chat
          .slice(0, index)
          .reverse()
          .find((m) => m.role === "user");
      return this.send(
        question?.rawContent || question?.content || "重新生成上一条回复",
        {
          generationType: "swipe",
          scope: msg.source.scope,
          contextRefs: {
            ...msg.source.refs,
            chapterId: msg.source.chapterId,
            selection: msg.source.selection,
          },
          regenerateMessageId: msg.id,
          taskRequest: msg.source.taskRequest,
        },
      );
    },
    draftFromMessage(msg, text, { visibleSelection = false } = {}) {
      if (msg.source?.taskRequest && !msg.source.taskRequest.type.startsWith('chapter.')) throw new Error('该专用任务不能转换为正文草稿');
      if (msg.streaming || msg.error || !msg.complete)
        throw new Error("回复尚未完整结束，请继续或复制文本人工整理");
      const selected = String(text || "");
      if (
        !selected.trim() ||
        (!visibleSelection &&
          ![
            msg.content,
            msg.rawContent,
            msg.plainText,
            plainChat(msg.displayText || msg.content),
          ].some((s) => s?.includes(selected)))
      )
        throw new Error("所选文本不属于此候选");
      const card = makeDraft(selected, msg.source, {
        runId: msg.runId,
        messageId: msg.id,
        complete: msg.complete,
      });
      card.candidateIndex = msg.activeCandidate || 0;
      msg.cards.push(card);
      storeCandidate(msg);
      return card;
    },
    async clearChat() {
      this.cancel();
      this.chat = [];
      const state = await presetRepo.presetState(this.workId);
      await presetRepo.commitState({ ...state, local: {} }, null);
    },
    async refreshKnowledge() {
      const work = useWorkStore();
      if (!work.work || this.workId !== work.work.id) return;
      const workId = this.workId;
      const snap = await knowledgeSnapshot(snapshotWork(work));
      try{
        const projection=await ensureProjection(workId);
        if(this.workId===workId)this.kb.sourceCoverage={counts:projection.index.counts,issues:projection.index.issues||[],docs:projection.index.docs,chunks:projection.index.chunks,sourceMetas:snap.sourceMetas};
      }catch(e){if(this.workId===workId)this.kb.sourceCoverage={error:e.message};}
      if (this.workId !== workId) return;
      this.kb.cards = snap.cards;
      this.kb.rows = snap.rows.filter(
        (r) =>
          !snap.decisions.some(
            (d) =>
              d.action === "ignore" &&
              [
                r.decisionKey,
                "card:" + r.id,
                r.kind === "entity" ? "entity:" + r.body.name : null,
              ].includes(d.key),
          ),
      );
      this.kb.hooks = replayForeshadows(snap.cards);
      this.kb.metas = snap.metas;
      this.kb.ready = snap.valid.size;
      this.kb.total = snap.chapters.length;
      this.kb.stale = snap.stale.length;
      this.kb.missing = snap.missing.length;
      this.kb.summaries = await db.aisum.where('workId').equals(workId).toArray();
      const job = await aiRepo.jobById("knowledge:" + workId);
      if (job && !kbAbort)
        this.kb.progress =
          job.status === "running" && job.leaseUntil < Date.now()
            ? { ...job, status: "paused" }
            : job;
    },
    async buildKnowledge(request = {}) {
      const workId = request.workId || this.workId;
      if (!workId || kbAbort) return;
      if (new URLSearchParams(location.search).has("panel")) {
        window.native?.appBroadcast?.({
          kind: "ai-kb-request",
          data: { ...request, workId },
        });
        this.kb.error = "构建已交给主窗口，可关闭此面板";
        return;
      }
      if (this.privacy && !request.allowRaw)
        throw new Error("提取必须发送正文，请确认本次范围");
      if (request.auto && (this.privacy || !this.options.kb.auto)) return;
      const ctl = new AbortController();
      kbAbort = ctl;
      this.kb.paused = false;
      this.kb.error = "";
      try {
        const opts = await this.buildOpts();
        checkAbort(ctl.signal);
        const r = await buildKnowledge({
          workId,
          opts: { ...opts, signal: ctl.signal },
          owner: uid(),
          onlyIds: request.onlyIds,
          force: request.rebuild,
          auto: request.auto,
          /* 不设每日上限：限额无限（保留 reserveDaily 的当日用量记账） */
          usageCap: Infinity,
          shouldPause: () => this.kb.paused,
          onUsage: (u) => this.addUsage(u),
          onProgress: (p) => {
            if (this.workId === workId) this.kb.progress = p;
            window.native?.appBroadcast?.({
              kind: "kb-changed",
              data: { workId },
            });
          },
        });
        if (this.workId === workId) this.kb.progress = r;
      } catch (e) {
        if (this.workId === workId) this.kb.error = e.message;
      } finally {
        kbAbort = null;
        await this.refreshKnowledge();
        window.native?.appBroadcast?.({ kind: "kb-changed", data: { workId } });
      }
    },
    pauseKnowledge() {
      this.kb.paused = true;
      kbAbort?.abort();
      if (new URLSearchParams(location.search).has("panel"))
        window.native?.appBroadcast?.({
          kind: "ai-kb-request",
          data: { workId: this.workId, action: "pause" },
        });
    },
    async clearKnowledge() {
      if (kbAbort) throw new Error("请先暂停构建");
      await aiRepo.clearKnowledge(this.workId);
      await this.refreshKnowledge();
    },
    async confirmMemory(table, id) {
      await confirmDerived(useWorkStore(), table, id);
      await this.refreshKnowledge();
    },
    async decideKnowledge(key, action, extra = {}) {
      await aiRepo.putAiRow("aidecisions", {
        id: this.workId + ":" + key,
        workId: this.workId,
        key,
        action,
        ...extra,
      });
      if (action === "override") {
        for (const row of this.kb.rows.filter(
          (r) => r.decisionKey === key || key === "card:" + r.id,
        ))
          await aiRepo.putAiRow("aikb", {
            ...row,
            body: extra.body,
            corrected: true,
          });
      }
      if (key.startsWith("entity:") && action === "merge") {
        for (const row of this.kb.rows.filter(
          (r) => r.body.name === key.slice(7),
        ))
          await aiRepo.putAiRow("aikb", {
            ...row,
            refType: extra.refType,
            refId: extra.refId,
          });
      }
      await this.refreshKnowledge();
      window.native?.appBroadcast?.({
        kind: "kb-changed",
        data: { workId: this.workId },
      });
    },
    async embedKnowledge() {
      if (kbAbort) throw new Error("已有记忆任务，请先暂停");
      if (new URLSearchParams(location.search).has("panel")) {
        window.native?.appBroadcast?.({
          kind: "ai-kb-request",
          data: { workId: this.workId, action: "vectors" },
        });
        return;
      }
      if (this.privacy)
        throw new Error("语义索引需发送知识卡，隐私模式下不自动执行");
      if (!this.options.embeddings.model) throw new Error("请先设置向量模型");
      const ctl = new AbortController();
      kbAbort = ctl;
      this.kb.paused = false;
      try {
        const opts = await this.buildOpts();
        await rebuildVectors({
          work: snapshotWork(useWorkStore()),
          opts: { ...opts, signal: ctl.signal },
          model: this.options.embeddings.model,
          shouldPause: () => this.kb.paused,
          onUsage: (u) => this.addUsage(u),
          onProgress: (p) => {
            this.kb.progress = { ...p, status: "running" };
          },
        });
      } catch (e) {
        this.kb.error = e.message;
      } finally {
        kbAbort = null;
        this.kb.progress = {
          ...this.kb.progress,
          status: this.kb.paused ? "paused" : "completed",
        };
      }
    },
    /* ---------- 连接测试（设置区按钮，方案 §三；验收走 tools/mock-ai.mjs） ---------- */
    async testConnection() {
      let opts;
      try {
        opts = await this.buildOpts();
      } catch (e) {
        return { ok: false, error: this.errorFrom(e) };
      }
      try {
        const r = await testConnection({ ...opts, timeout: 15000 });
        this.addUsage(r.usage);
        return { ok: true, reply: r.reply, model: r.model };
      } catch (err) {
        return { ok: false, error: this.errorFrom(err) };
      }
    },
  },
});
