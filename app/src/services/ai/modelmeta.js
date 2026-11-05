/**
 * services/ai/modelmeta.js — 已知模型参数表
 *
 * 用途：编辑模型配置时按模型名自动预填「上下文窗口 / 最大输出」，可在弹窗中修改。
 * 检索日期：2026-10-12，覆盖 2026 年 10 月当前主力阵容；来源：developers.openai.com、
 * platform.claude.com / anthropic.com、ai.google.dev / blog.google、docs.x.ai、
 * api-docs.deepseek.com、docs.bigmodel.cn / z.ai、platform.kimi.com、
 * help.aliyun.com/zh/model-studio（百炼）、volcengine.com/docs/ark（火山方舟）、
 * mimo.mi.com、cloud.tencent.com（混元）、ai.baidu.com（文心）、ai.meta.com（Llama）。
 *
 * 匹配规则（lookupModelMeta）：先精确同名，再取最长前缀（gpt-4.1-mini → gpt-4.1、
 * kimi-k2-turbo → kimi-k2）；查不到返回 null——本地 Ollama 等自托管模型的上下文取决于
 * 运行时配置，无法静态给出，不预填。
 *
 * 注意：数值仅作预填参考，服务商可能随版本快照调整，以其当前文档为准。
 * maxTokens 为 null = 官方未公布固定输出上限，只预填上下文窗口。
 */
export const MODEL_META = [
  /* ---------- OpenAI ---------- */
  { match: 'gpt-6', contextWindow: 1050000, maxTokens: 128000, note: 'GPT-6 Astra，2026-09 发布' },
  { match: 'gpt-5.2', contextWindow: 400000, maxTokens: 128000 },
  { match: 'gpt-5', contextWindow: 400000, maxTokens: 128000, note: '5/5.1 系同规格；输入上限 272K，输出含推理 tokens' },
  { match: 'gpt-4.1', contextWindow: 1047576, maxTokens: 32768 },
  { match: 'gpt-4o', contextWindow: 128000, maxTokens: 16384 },
  { match: 'o3', contextWindow: 200000, maxTokens: 100000, note: '输出含推理 tokens' },
  { match: 'o4-mini', contextWindow: 200000, maxTokens: 100000, note: '输出含推理 tokens' },
  { match: 'gpt-oss', contextWindow: 131072, maxTokens: null },

  /* ---------- Anthropic Claude ---------- */
  { match: 'claude-opus-5', contextWindow: 1000000, maxTokens: 128000 },
  { match: 'claude-sonnet-5', contextWindow: 1000000, maxTokens: 128000 },
  { match: 'claude-opus-4-8', contextWindow: 1000000, maxTokens: 128000 },
  { match: 'claude-', contextWindow: 200000, maxTokens: 64000, note: 'Claude 4.x 通用口径；经兼容代理接入时以代理限额为准' },

  /* ---------- Google Gemini ---------- */
  { match: 'gemini-4', contextWindow: 1050000, maxTokens: 128000, note: 'Gemini 4 Argon；1M 输出为受限实验档，不预填' },
  { match: 'gemini-3-pro', contextWindow: 1000000, maxTokens: 64000 },
  { match: 'gemini-2.5-pro', contextWindow: 1048576, maxTokens: 65536 },
  { match: 'gemini-2.5-flash', contextWindow: 1048576, maxTokens: 65536 },

  /* ---------- xAI Grok ---------- */
  { match: 'grok-4-fast', contextWindow: 2000000, maxTokens: null },
  { match: 'grok-4.5', contextWindow: 500000, maxTokens: null },
  { match: 'grok-4.7', contextWindow: 500000, maxTokens: null },
  { match: 'grok-', contextWindow: 256000, maxTokens: null, note: 'Grok 4 口径；输出无固定上限，受剩余上下文约束' },

  /* ---------- DeepSeek（api-docs.deepseek.com） ---------- */
  { match: 'deepseek-v4.1-flash', contextWindow: 1000000, maxTokens: 384000, note: '2026-09-10 发布，输出沿用 V4 系口径' },
  { match: 'deepseek-v4-pro', contextWindow: 1000000, maxTokens: 384000 },
  { match: 'deepseek-v4-flash', contextWindow: 1000000, maxTokens: 384000 },
  { match: 'deepseek-v3.2', contextWindow: 131072, maxTokens: 8192, note: '输出最大可调 64K' },
  { match: 'deepseek-reasoner', contextWindow: 131072, maxTokens: 8192, note: '8K 指最终回答，思维链另计至多 32K' },
  { match: 'deepseek-chat', contextWindow: 131072, maxTokens: 8192, note: 'DeepSeek V3.x 口径' },

  /* ---------- 智谱 GLM（docs.bigmodel.cn / z.ai） ---------- */
  { match: 'glm-5.3-flashx', contextWindow: 1000000, maxTokens: null, note: 'Flash 加速版（200 tokens/s），输出上限未单列' },
  { match: 'glm-5.3-flash', contextWindow: 1000000, maxTokens: null, note: '官方标注 1M 上下文，输出上限未单列' },
  { match: 'glm-5.3', contextWindow: 1000000, maxTokens: 131072 },
  { match: 'glm-5.2[1m]', contextWindow: 1000000, maxTokens: 131072 },
  { match: 'glm-5.2', contextWindow: 204800, maxTokens: 131072, note: '默认 200K 窗口；1M 需 glm-5.2[1m]' },
  { match: 'glm-5.1', contextWindow: 204800, maxTokens: null },
  { match: 'glm-4.6', contextWindow: 204800, maxTokens: 131072 },
  { match: 'glm-4.5', contextWindow: 131072, maxTokens: 98304 },
  { match: 'glm-4-flash', contextWindow: 131072, maxTokens: 4096 },

  /* ---------- Moonshot Kimi（platform.kimi.com） ---------- */
  { match: 'kimi-k3', contextWindow: 1000000, maxTokens: null, note: '官方未公布输出上限' },
  { match: 'kimi-k2', contextWindow: 262144, maxTokens: 16384 },
  { match: 'kimi-latest', contextWindow: 262144, maxTokens: 16384 },

  /* ---------- 阿里 Qwen（help.aliyun.com/zh/model-studio 百炼） ---------- */
  { match: 'qwen3.8-max', contextWindow: 1000000, maxTokens: 131072, note: '思维链至多 262144，另计' },
  { match: 'qwen3.7-max', contextWindow: 1000000, maxTokens: 65536 },
  { match: 'qwen3-max', contextWindow: 1000000, maxTokens: 32768 },
  { match: 'qwen3.7-plus', contextWindow: 1000000, maxTokens: null },
  { match: 'qwen-plus', contextWindow: 131072, maxTokens: 16384 },

  /* ---------- 字节豆包（volcengine.com/docs/ark 火山方舟） ---------- */
  { match: 'doubao-seed-1.8', contextWindow: 262144, maxTokens: 32768 },
  { match: 'doubao-seed-1.6', contextWindow: 262144, maxTokens: 16384, note: '前缀覆盖 thinking / flash 变体' },

  /* ---------- 小米 MiMo（mimo.mi.com） ---------- */
  { match: 'mimo-v2.6-flash', contextWindow: 1000000, maxTokens: 131072 },
  { match: 'mimo-v2.6', contextWindow: 1000000, maxTokens: null, note: 'Pro 输出上限未确认' },

  /* ---------- MiniMax ---------- */
  { match: 'minimax-m2', contextWindow: 204800, maxTokens: 131072, note: '前缀覆盖 M2.5' },

  /* ---------- 百度文心（ai.baidu.com 千帆） ---------- */
  { match: 'ernie-5', contextWindow: 131072, maxTokens: null, note: '文心 5.0 128K 上下文，输出上限未单列' },

  /* ---------- Meta Llama 4 ---------- */
  { match: 'llama-4-scout', contextWindow: 1310720, maxTokens: 16384, note: 'Meta 标称 10M；1M 为托管服务常见口径' },
  { match: 'llama-4-maverick', contextWindow: 1048576, maxTokens: 16384, note: '标称 1M；多数托管 256K' }
]

/**
 * 按模型名查参考参数：先精确同名，再最长前缀匹配。
 * @param {string} id 模型名
 * @returns {{ match: string, contextWindow: number, maxTokens: number|null, note?: string }|null}
 */
export function lookupModelMeta(id) {
  const s = String(id || '').trim().toLowerCase()
  if (!s) return null
  const exact = MODEL_META.find((m) => m.match.toLowerCase() === s)
  if (exact) return exact
  let best = null
  for (const m of MODEL_META) {
    const k = m.match.toLowerCase()
    if (s.startsWith(k) && (!best || k.length > best.match.length)) best = m
  }
  return best
}
