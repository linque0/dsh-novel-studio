/**
 * services/ai/provider-templates.js — 供应商预设模板（「添加供应商」菜单与旧配置迁移命名共用）
 *
 * 每个模板是一套预填连接信息；apiFormat 决定实发请求协议（provider.js 双格式适配）：
 *   'openai'    OpenAI 兼容 POST /chat/completions（DeepSeek / 智谱 GLM / OpenAI / Ollama 等）
 *   'anthropic' Anthropic Messages POST /v1/messages
 */

export const PROVIDER_TEMPLATES = [
  {
    key: "deepseek",
    name: "DeepSeek",
    apiFormat: "openai",
    baseURL: "https://api.deepseek.com/v1",
    models: ["deepseek-chat"],
  },
  {
    key: "glm",
    name: "智谱 GLM",
    apiFormat: "openai",
    baseURL: "https://open.bigmodel.cn/api/paas/v4",
    models: ["glm-4-flash"],
  },
  {
    key: "openai",
    name: "OpenAI",
    apiFormat: "openai",
    baseURL: "https://api.openai.com/v1",
    models: ["gpt-4o-mini"],
  },
  {
    key: "ollama",
    name: "Ollama 本地",
    apiFormat: "openai",
    baseURL: "http://127.0.0.1:11434/v1",
    models: ["qwen2.5"],
  },
  {
    key: "claude",
    name: "Claude（Anthropic）",
    apiFormat: "anthropic",
    baseURL: "https://api.anthropic.com",
    models: ["claude-sonnet-5"],
  },
  { key: "blank", name: "空白预设", apiFormat: "openai", baseURL: "", models: [] },
];

/** API 格式下拉选项（设置界面用；value 与 provider.apiFormat 对应） */
export const API_FORMAT_OPTIONS = [
  {
    value: "openai",
    label: "Chat Completions（OpenAI 兼容 /chat/completions）",
    short: "Chat Completions",
  },
  {
    value: "anthropic",
    label: "Anthropic Messages（/v1/messages）",
    short: "Anthropic Messages",
  },
];

/** 旧单配置迁移时按 baseURL 猜测供应商名（未命中返回空串） */
export function guessProviderName(baseURL) {
  const s = String(baseURL || "")
    .trim()
    .replace(/\/+$/, "")
    .toLowerCase();
  if (!s) return "";
  const hit = PROVIDER_TEMPLATES.find(
    (t) => t.baseURL && s === t.baseURL.toLowerCase(),
  );
  return hit ? hit.name : "";
}
