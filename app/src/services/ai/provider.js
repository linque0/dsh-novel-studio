/**
 * services/ai/provider.js — 模型调用层
 *
 * 设计要点：
 * - 仅用 fetch + ReadableStream 实现 SSE 流式解析，零新依赖
 * - 双 API 格式（opts.apiFormat，见供应商预设的「API 格式」下拉）：
 *     'openai'（默认）    POST {baseURL}/chat/completions，stream:true；baseURL 形如 https://api.deepseek.com/v1
 *                          （末尾斜杠可有可无；DeepSeek/智谱 GLM/OpenAI/Ollama 本地等一套协议全覆盖）
 *     'anthropic'         POST {baseURL}/v1/messages（Anthropic Messages）；进入本文件 Anthropic 适配区，
 *                          请求/响应与 OpenAI 形态互转后归一输出，上层（dialogue 工具循环）无感
 * - 错误统一抛 AiProviderError，code 见 AI_ERROR_CODES：
 *     not-configured（未配置）/ network（网络失败，含超时）/ auth（鉴权失败 401/403）
 *     rate-limit（限流 429）/ insufficient-balance（余额不足 402）/ api（其他服务商错误）
 * - 超时语义：timeout 毫秒内未建立连接、或相邻两个数据块之间静默超过 timeout 即中止；
 *   总时长不限，长篇流式输出不受惩罚
 * - 返回 { text, usage, finishReason }；文本增量经 onDelta 回调逐段上抛；
 *   usage 为 { prompt_tokens, completion_tokens, total_tokens }（服务商未回传时为 null）
 */

export const AI_ERROR_CODES = {
  NOT_CONFIGURED: "not-configured",
  NETWORK: "network",
  AUTH: "auth",
  RATE_LIMIT: "rate-limit",
  INSUFFICIENT_BALANCE: "insufficient-balance",
  API: "api",
};

export class AiProviderError extends Error {
  /**
   * @param {string} code AI_ERROR_CODES 之一
   * @param {string} message 面向用户的中文提示
   * @param {{status?: number|null, detail?: string|null}} extra status=HTTP 状态码；detail=服务商原始报文片段
   */
  constructor(code, message, extra = {}) {
    super(message);
    this.name = "AiProviderError";
    this.code = code;
    this.status = extra.status ?? null;
    this.detail = extra.detail ?? null;
  }
}

/* ---- 内部工具 ---- */

/** URL 仅放行 http/https（app:// 渲染层 fetch 前置校验；本地端点如 Ollama/mock 属方案预设，不在拒绝之列） */
function isHttpUrl(u) {
  try {
    const parsed = new URL(u);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

const hostOf = (u) => {
  try {
    return new URL(u).host;
  } catch {
    return u;
  }
};

/** 拼 {baseURL}/chat/completions：容忍末尾斜杠与已带路径两种写法；baseURL 缺失/非法归入「未配置」 */
function buildUrl(baseURL) {
  const s = String(baseURL || "")
    .trim()
    .replace(/\/+$/, "");
  if (!s)
    throw new AiProviderError(
      AI_ERROR_CODES.NOT_CONFIGURED,
      "恍然梦未配置：请先在设置中填写 API 地址（baseURL）",
    );
  if (!isHttpUrl(s)) {
    throw new AiProviderError(
      AI_ERROR_CODES.NOT_CONFIGURED,
      `恍然梦未配置：API 地址无效（仅支持 http/https）——${s}`,
    );
  }
  return s.endsWith("/chat/completions") ? s : s + "/chat/completions";
}

/* ================= Anthropic Messages 适配（apiFormat: 'anthropic'） =================
 * 把 OpenAI 形态的调用（messages 含 system/tool 消息、tools、toolChoice）与 Anthropic
 * Messages API 互转；SSE 事件解析后归一为 OpenAI 形态输出
 * （{ text, toolCalls:[{id,type:'function',function:{name,arguments}}], usage, finishReason }），
 * dialogue.js 的工具循环与 usage 统计无需感知格式差异。
 */

const ANTHROPIC_VERSION = "2023-06-01";
const ANTHROPIC_DEFAULT_MAX_TOKENS = 4096; // Messages API 的 max_tokens 必填
const ANTHROPIC_STOP_REASON = {
  end_turn: "stop",
  stop_sequence: "stop",
  refusal: "stop",
  pause_turn: "stop",
  max_tokens: "length",
  tool_use: "tool_calls",
};

/** 拼 {baseURL}/v1/messages：容忍末尾斜杠 / 已带 /v1 / 已带 /v1/messages 三种写法 */
function buildAnthropicUrl(baseURL) {
  const s = String(baseURL || "")
    .trim()
    .replace(/\/+$/, "");
  if (!s)
    throw new AiProviderError(
      AI_ERROR_CODES.NOT_CONFIGURED,
      "恍然梦未配置：请先在设置中填写 API 地址（baseURL）",
    );
  if (!isHttpUrl(s))
    throw new AiProviderError(
      AI_ERROR_CODES.NOT_CONFIGURED,
      `恍然梦未配置：API 地址无效（仅支持 http/https）——${s}`,
    );
  if (s.endsWith("/v1/messages")) return s;
  if (s.endsWith("/v1")) return s + "/messages";
  return s + "/v1/messages";
}

/** OpenAI 形态 messages → Anthropic：system 上提合并；tool 消息转 tool_result；assistant tool_calls 转 tool_use */
function toAnthropicMessages(messages = []) {
  const systems = [];
  const out = [];
  for (const m of messages) {
    const role = m?.role;
    const content = m?.content;
    if (role === "system") {
      if (typeof content === "string" && content) systems.push(content);
      continue;
    }
    if (role === "tool") {
      /* Anthropic 要求 tool_result 位于 user 消息内且紧跟对应 tool_use；连续工具结果合并进同一 user turn */
      const block = {
        type: "tool_result",
        tool_use_id: String(m.tool_call_id || ""),
        content:
          typeof content === "string" ? content : JSON.stringify(content ?? ""),
      };
      const last = out[out.length - 1];
      if (
        last &&
        last.role === "user" &&
        Array.isArray(last.content) &&
        last.content.every((b) => b.type === "tool_result")
      )
        last.content.push(block);
      else out.push({ role: "user", content: [block] });
      continue;
    }
    if (role === "assistant") {
      const blocks = [];
      if (typeof content === "string" && content)
        blocks.push({ type: "text", text: content });
      for (const call of m.tool_calls || []) {
        let input = {};
        try {
          const parsed = JSON.parse(call?.function?.arguments || "{}");
          if (parsed && typeof parsed === "object") input = parsed;
        } catch {
          /* 参数不完整时以空对象占位，保持消息结构可发送 */
        }
        blocks.push({
          type: "tool_use",
          id: String(call?.id || ""),
          name: String(call?.function?.name || ""),
          input,
        });
      }
      if (!blocks.length) blocks.push({ type: "text", text: "" });
      out.push({ role: "assistant", content: blocks });
      continue;
    }
    out.push({
      role: "user",
      content:
        typeof content === "string"
          ? content
          : Array.isArray(content)
            ? content
            : String(content ?? ""),
    });
  }
  return { system: systems.join("\n\n"), messages: out };
}

function toAnthropicTools(tools = []) {
  return tools.map((t) => {
    const f = t?.function || {};
    return {
      name: String(f.name || ""),
      ...(f.description ? { description: String(f.description) } : {}),
      input_schema:
        f.parameters && typeof f.parameters === "object"
          ? f.parameters
          : { type: "object", properties: {} },
    };
  });
}

/** 'none' → null（调用方省略 tools）；'auto' → 默认不传；指定函数 → {type:'tool'} */
function toAnthropicToolChoice(toolChoice) {
  if (toolChoice === "none") return null;
  if (toolChoice === "required" || toolChoice === "any") return { type: "any" };
  if (
    toolChoice &&
    typeof toolChoice === "object" &&
    toolChoice.function?.name
  )
    return { type: "tool", name: String(toolChoice.function.name) };
  return { type: "auto" };
}

function buildAnthropicBody(opts) {
  const { model, messages, temperature, maxTokens } = opts;
  const { system, messages: msgs } = toAnthropicMessages(messages);
  const body = {
    model,
    messages: msgs,
    max_tokens:
      Number(maxTokens) > 0
        ? Math.round(Number(maxTokens))
        : ANTHROPIC_DEFAULT_MAX_TOKENS,
    stream: opts.stream !== false,
  };
  if (system) body.system = system;
  if (temperature != null) body.temperature = temperature;
  if (opts.top_p != null) body.top_p = opts.top_p;
  const choice = toAnthropicToolChoice(opts.toolChoice);
  if (opts.tools?.length && choice) {
    body.tools = toAnthropicTools(opts.tools);
    if (choice.type !== "auto") body.tool_choice = choice;
  }
  return body;
}

/** 外部 signal 与空闲超时合并为一个中止控制器（毫秒超时：未建立连接 / 相邻数据块静默超时） */
function createIdleGuard(timeout, signal) {
  const ctrl = new AbortController();
  const onOuterAbort = () => ctrl.abort(signal.reason);
  let timedOut = false;
  let idleTimer = null;
  if (signal) {
    if (signal.aborted) ctrl.abort(signal.reason);
    else signal.addEventListener("abort", onOuterAbort, { once: true });
  }
  return {
    signal: ctrl.signal,
    get timedOut() {
      return timedOut;
    },
    arm() {
      clearTimeout(idleTimer);
      if (timeout > 0) {
        idleTimer = setTimeout(() => {
          timedOut = true;
          ctrl.abort(new Error("ai-idle-timeout"));
        }, timeout);
      }
    },
    cleanup() {
      clearTimeout(idleTimer);
      if (signal) signal.removeEventListener("abort", onOuterAbort);
    },
  };
}

function normalizeUsage(u) {
  if (!u || typeof u !== "object") return null;
  const prompt = Number(u.prompt_tokens) || 0;
  const completion = Number(u.completion_tokens) || 0;
  return {
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: Number(u.total_tokens) || prompt + completion,
  };
}

/** 从错误响应体提取服务商 message（OpenAI 兼容：{error:{message}}；宽松兜底取顶层 message / 原文截断） */
function extractServerMessage(bodyText) {
  if (!bodyText) return "";
  try {
    const obj = JSON.parse(bodyText);
    const msg = obj?.error?.message ?? obj?.message;
    if (typeof msg === "string" && msg) return msg;
    return JSON.stringify(obj).slice(0, 300);
  } catch {
    return String(bodyText).slice(0, 300);
  }
}

/** 归类：先按服务商报文关键词（各家状态码语义不一），再按 HTTP 状态码兜底 */
function classifyFailure(status, serverMsg) {
  const msg = String(serverMsg || "");
  if (/insufficient[\s_-]?balance|余额不足/i.test(msg))
    return AI_ERROR_CODES.INSUFFICIENT_BALANCE;
  if (/rate[\s_-]?limit|too many requests|限流/i.test(msg))
    return AI_ERROR_CODES.RATE_LIMIT;
  if (
    /invalid[\s_-]?api[\s_-]?key|unauthorized|incorrect api key|鉴权|密钥无效|无权限/i.test(
      msg,
    )
  )
    return AI_ERROR_CODES.AUTH;
  if (status === 401 || status === 403) return AI_ERROR_CODES.AUTH;
  if (status === 402) return AI_ERROR_CODES.INSUFFICIENT_BALANCE;
  if (status === 429) return AI_ERROR_CODES.RATE_LIMIT;
  return AI_ERROR_CODES.API;
}

const FRIENDLY = {
  [AI_ERROR_CODES.AUTH]: (status) =>
    `鉴权失败（${status}）：API 密钥无效或无权限`,
  [AI_ERROR_CODES.RATE_LIMIT]: (status) =>
    `请求被限流（${status}）：请稍后重试`,
  [AI_ERROR_CODES.INSUFFICIENT_BALANCE]: (status) =>
    `余额不足（${status}）：请到服务商控制台充值`,
  [AI_ERROR_CODES.API]: (status) => `服务商返回错误（${status ?? "未知"}）`,
};

function throwFailure(status, serverMsg, detail) {
  const code = classifyFailure(status, serverMsg);
  const base = (FRIENDLY[code] || FRIENDLY[AI_ERROR_CODES.API])(status);
  throw new AiProviderError(code, serverMsg ? `${base}：${serverMsg}` : base, {
    status,
    detail: detail ? String(detail).slice(0, 500) : null,
  });
}

/* ---- 核心调用 ---- */

async function chatStreamOnce(opts, onDelta) {
  if (opts?.apiFormat === "anthropic")
    return anthropicChatStreamOnce(opts, onDelta);
  const {
    baseURL,
    apiKey = "",
    model,
    messages,
    temperature,
    maxTokens = null,
    timeout = 60000,
    signal = null,
    includeUsage = true,
    extraHeaders = {},
  } = opts || {};

  if (!model)
    throw new AiProviderError(
      AI_ERROR_CODES.NOT_CONFIGURED,
      "恍然梦未配置：请先在设置中选择模型",
    );
  if (!Array.isArray(messages) || !messages.length) {
    throw new AiProviderError(
      AI_ERROR_CODES.NOT_CONFIGURED,
      "AI 调用缺少 messages 消息数组",
    );
  }

  const url = buildUrl(baseURL);
  const headers = { "Content-Type": "application/json", ...extraHeaders };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const body = {
    model,
    messages,
    stream: opts.stream !== false,
    ...(temperature != null ? { temperature } : {}),
    ...Object.fromEntries(
      [
        "top_p",
        "frequency_penalty",
        "presence_penalty",
        "seed",
        "reasoning_effort",
        "verbosity",
      ]
        .filter((k) => opts[k] != null)
        .map((k) => [k, opts[k]]),
    ),
    ...(opts.tools?.length
      ? { tools: opts.tools, tool_choice: opts.toolChoice || "auto" }
      : {}),
    /* 模型专属参数（编辑模型配置）：配置了最大输出 Token 才随请求发送 */
    ...(maxTokens != null && Number(maxTokens) > 0
      ? { max_tokens: Math.round(Number(maxTokens)) }
      : {}),
    ...(includeUsage && opts.stream !== false
      ? { stream_options: { include_usage: true } }
      : {}),
  };

  // 外部 signal 与内部空闲超时合并为一个控制器
  const ctrl = new AbortController();
  let timedOut = false;
  let idleTimer = null;
  const armIdle = () => {
    clearTimeout(idleTimer);
    if (timeout > 0) {
      idleTimer = setTimeout(() => {
        timedOut = true;
        ctrl.abort(new Error("ai-idle-timeout"));
      }, timeout);
    }
  };
  const onOuterAbort = () => ctrl.abort(signal.reason);
  if (signal) {
    if (signal.aborted) ctrl.abort(signal.reason);
    else signal.addEventListener("abort", onOuterAbort, { once: true });
  }

  try {
    let res;
    try {
      armIdle();
      res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
    } catch (err) {
      if (timedOut)
        throw new AiProviderError(
          AI_ERROR_CODES.NETWORK,
          `连接超时：${timeout}ms 内未收到响应`,
        );
      if (signal?.aborted) throw err; // 调用方主动取消，原样上抛
      throw new AiProviderError(
        AI_ERROR_CODES.NETWORK,
        `网络请求失败：无法连接 ${hostOf(url)}`,
        { detail: String(err?.message || err) },
      );
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throwFailure(res.status, extractServerMessage(text), text);
    }

    const ctype = (res.headers.get("content-type") || "").toLowerCase();

    // 个别兼容服务无视 stream:true 直接回整段 JSON —— 宽容处理为一次性增量
    if (!res.body || ctype.includes("application/json")) {
      const text = await res.text().catch(() => "");
      let obj = null;
      try {
        obj = JSON.parse(text);
      } catch {
        /* ignore */
      }
      if (!obj)
        throw new AiProviderError(
          AI_ERROR_CODES.API,
          "服务商返回了无法解析的空响应",
          { detail: text.slice(0, 300) },
        );
      if (obj.error)
        throwFailure(obj.error.code ?? null, obj.error.message || "", text);
      const content = obj?.choices?.[0]?.message?.content;
      const toolCalls = obj?.choices?.[0]?.message?.tool_calls || [];
      toolCalls.forEach((call) => opts.onToolDelta?.(call));
      if (typeof content !== "string" && !toolCalls.length) {
        throw new AiProviderError(
          AI_ERROR_CODES.API,
          `服务商响应格式异常（content-type: ${ctype || "未知"}）`,
          { detail: text.slice(0, 300) },
        );
      }
      onDelta?.(content || "");
      const reasoning = obj?.choices?.[0]?.message?.reasoning_content || "";
      if (reasoning) opts.onReasoningDelta?.(reasoning);
      return {
        text: content || "",
        toolCalls,
        usage: normalizeUsage(obj.usage),
        finishReason: obj?.choices?.[0]?.finish_reason || "stop",
      };
    }

    // SSE 流式解析：逐块解码 → 按行切分 → data: 行取 JSON；[DONE] 结束
    const decoder = new TextDecoder("utf-8");
    const reader = res.body.getReader();
    let buf = "";
    let text = "";
    let usage = null;
    let finishReason = null;
    let sawDone = false;
    const calls = new Map();

    const handleLine = (line) => {
      if (!line || line.startsWith(":")) return false; // 注释/心跳行
      if (!line.startsWith("data:")) return false; // event:/id:/retry: 等忽略
      const payload = line.slice(5).trim();
      if (!payload) return false;
      if (payload === "[DONE]") return true;
      let obj;
      try {
        obj = JSON.parse(payload);
      } catch {
        return false; // 容忍残缺分片
      }
      if (obj.error)
        throwFailure(
          obj.error.code ?? null,
          obj.error.message || "",
          JSON.stringify(obj.error).slice(0, 500),
        );
      if (obj.usage) usage = normalizeUsage(obj.usage);
      for (const ch of obj.choices || []) {
        const d = ch?.delta || {};
        if (d.reasoning_content) opts.onReasoningDelta?.(d.reasoning_content);
        for (const part of d.tool_calls || []) {
          const index = part.index ?? 0;
          const call = calls.get(index) || {
            id: "",
            type: "function",
            function: { name: "", arguments: "" },
          };
          if (part.id) call.id = part.id;
          if (part.function?.name) call.function.name += part.function.name;
          if (part.function?.arguments)
            call.function.arguments += part.function.arguments;
          calls.set(index, call);
          opts.onToolDelta?.(call);
        }
        const delta =
          typeof d.content === "string"
            ? d.content
            : typeof d.text === "string"
              ? d.text
              : "";
        if (delta) {
          text += delta;
          onDelta?.(delta);
        }
        if (ch?.finish_reason) finishReason = ch.finish_reason;
      }
      return false;
    };

    try {
      while (!sawDone) {
        const { done, value } = await reader.read();
        if (done) break;
        armIdle();
        buf += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, idx).replace(/\r$/, "");
          buf = buf.slice(idx + 1);
          if (handleLine(line)) {
            sawDone = true;
            break;
          }
        }
      }
      if (!sawDone && buf.trim()) handleLine(buf.trim()); // 冲刷无换行收尾的残包
    } catch (err) {
      if (err instanceof AiProviderError) throw err;
      try {
        await reader.cancel();
      } catch {
        /* ignore */
      }
      if (timedOut)
        throw new AiProviderError(
          AI_ERROR_CODES.NETWORK,
          `响应超时：${timeout}ms 内未收到新数据块`,
        );
      if (signal?.aborted) throw err;
      throw new AiProviderError(
        AI_ERROR_CODES.NETWORK,
        `流式响应中断：${String(err?.message || err)}`,
        { detail: String(err) },
      );
    }

    return {
      text,
      toolCalls: [...calls.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([, v]) => v),
      usage,
      finishReason,
    };
  } finally {
    clearTimeout(idleTimer);
    if (signal) signal.removeEventListener("abort", onOuterAbort);
  }
}

/**
 * Anthropic Messages 流式调用（apiFormat:'anthropic'）：ANTHROPIC_STOP_REASON / toAnthropic* 见上方适配区。
 * 输出与 OpenAI 分支完全一致：{ text, toolCalls, usage, finishReason }。
 */
async function anthropicChatStreamOnce(opts, onDelta) {
  const {
    baseURL,
    apiKey = "",
    model,
    messages,
    timeout = 60000,
    signal = null,
    extraHeaders = {},
  } = opts || {};

  if (!model)
    throw new AiProviderError(
      AI_ERROR_CODES.NOT_CONFIGURED,
      "恍然梦未配置：请先在设置中选择模型",
    );
  if (!Array.isArray(messages) || !messages.length) {
    throw new AiProviderError(
      AI_ERROR_CODES.NOT_CONFIGURED,
      "AI 调用缺少 messages 消息数组",
    );
  }

  const url = buildAnthropicUrl(baseURL);
  const headers = {
    "Content-Type": "application/json",
    "anthropic-version": ANTHROPIC_VERSION,
    ...extraHeaders,
  };
  if (apiKey) headers["x-api-key"] = apiKey;
  const body = buildAnthropicBody(opts);
  const guard = createIdleGuard(timeout, signal);
  const toToolCalls = (blocks) =>
    (blocks || [])
      .filter((b) => b?.type === "tool_use")
      .map((b) => ({
        id: String(b.id || ""),
        type: "function",
        function: {
          name: String(b.name || ""),
          arguments: JSON.stringify(b.input ?? {}),
        },
      }));

  try {
    let res;
    try {
      guard.arm();
      res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: guard.signal,
      });
    } catch (err) {
      if (guard.timedOut)
        throw new AiProviderError(
          AI_ERROR_CODES.NETWORK,
          `连接超时：${timeout}ms 内未收到响应`,
        );
      if (signal?.aborted) throw err; // 调用方主动取消，原样上抛
      throw new AiProviderError(
        AI_ERROR_CODES.NETWORK,
        `网络请求失败：无法连接 ${hostOf(url)}`,
        { detail: String(err?.message || err) },
      );
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throwFailure(res.status, extractServerMessage(text), text);
    }

    const ctype = (res.headers.get("content-type") || "").toLowerCase();

    // 个别服务无视 stream:true 直接回整段 JSON —— 解析 content 块数组为一次性增量
    if (!res.body || ctype.includes("application/json")) {
      const text = await res.text().catch(() => "");
      let obj = null;
      try {
        obj = JSON.parse(text);
      } catch {
        /* ignore */
      }
      if (!obj)
        throw new AiProviderError(
          AI_ERROR_CODES.API,
          "服务商返回了无法解析的空响应",
          { detail: text.slice(0, 300) },
        );
      if (obj.type === "error" || obj.error)
        throwFailure(null, obj.error?.message || "", text);
      const blocks = Array.isArray(obj.content) ? obj.content : [];
      const reply = blocks
        .filter((b) => b?.type === "text")
        .map((b) => b.text || "")
        .join("");
      const toolCalls = toToolCalls(blocks);
      if (!reply && !toolCalls.length) {
        throw new AiProviderError(
          AI_ERROR_CODES.API,
          `服务商响应格式异常（content-type: ${ctype || "未知"}）`,
          { detail: text.slice(0, 300) },
        );
      }
      if (reply) onDelta?.(reply);
      toolCalls.forEach((call) => opts.onToolDelta?.(call));
      const u = obj.usage || {};
      const input = Number(u.input_tokens) || 0;
      const output = Number(u.output_tokens) || 0;
      return {
        text: reply,
        toolCalls,
        usage:
          input || output
            ? normalizeUsage({
                prompt_tokens: input,
                completion_tokens: output,
                total_tokens: input + output,
              })
            : null,
        finishReason:
          ANTHROPIC_STOP_REASON[obj.stop_reason] ||
          (obj.stop_reason ? "stop" : null),
      };
    }

    // SSE 流式解析：data: 行为 JSON，按事件 type 分发
    const decoder = new TextDecoder("utf-8");
    const reader = res.body.getReader();
    let buf = "";
    let text = "";
    let inputTokens = 0;
    let outputTokens = 0;
    let finishReason = null;
    let sawStop = false;
    const calls = new Map(); // content block index → { call, initial, gotDelta }

    const handleLine = (line) => {
      if (!line || line.startsWith(":")) return false;
      if (!line.startsWith("data:")) return false;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") return false;
      let obj;
      try {
        obj = JSON.parse(payload);
      } catch {
        return false; // 容忍残缺分片
      }
      const type = obj?.type;
      if (type === "error") {
        throwFailure(
          null,
          obj?.error?.message || "",
          JSON.stringify(obj.error || obj).slice(0, 500),
        );
      }
      if (type === "message_start") {
        inputTokens = Number(obj?.message?.usage?.input_tokens) || inputTokens;
        return false;
      }
      if (type === "content_block_start") {
        const block = obj?.content_block;
        if (block?.type === "tool_use") {
          const entry = {
            call: {
              id: String(block.id || ""),
              type: "function",
              function: { name: String(block.name || ""), arguments: "" },
            },
            initial: block.input,
            gotDelta: false,
          };
          calls.set(obj.index ?? 0, entry);
          opts.onToolDelta?.(entry.call);
        }
        return false;
      }
      if (type === "content_block_delta") {
        const delta = obj?.delta || {};
        if (delta.type === "text_delta" && typeof delta.text === "string") {
          text += delta.text;
          onDelta?.(delta.text);
        } else if (
          delta.type === "input_json_delta" &&
          typeof delta.partial_json === "string"
        ) {
          const entry = calls.get(obj.index ?? 0);
          if (entry) {
            entry.call.function.arguments += delta.partial_json;
            entry.gotDelta = true;
            opts.onToolDelta?.(entry.call);
          }
        } else if (
          delta.type === "thinking_delta" &&
          typeof delta.thinking === "string"
        ) {
          opts.onReasoningDelta?.(delta.thinking);
        }
        return false;
      }
      if (type === "content_block_stop") {
        /* 少数服务商在 start 事件里直接给完整 input 且不发增量 —— 此处兜底 */
        const entry = calls.get(obj.index ?? 0);
        if (
          entry &&
          !entry.gotDelta &&
          entry.initial &&
          typeof entry.initial === "object" &&
          Object.keys(entry.initial).length
        ) {
          entry.call.function.arguments = JSON.stringify(entry.initial);
          entry.gotDelta = true;
        }
        return false;
      }
      if (type === "message_delta") {
        outputTokens = Number(obj?.usage?.output_tokens) || outputTokens;
        if (obj?.delta?.stop_reason)
          finishReason =
            ANTHROPIC_STOP_REASON[obj.delta.stop_reason] || "stop";
        return false;
      }
      if (type === "message_stop") return true;
      return false;
    };

    try {
      while (!sawStop) {
        const { done, value } = await reader.read();
        if (done) break;
        guard.arm();
        buf += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, idx).replace(/\r$/, "");
          buf = buf.slice(idx + 1);
          if (handleLine(line)) {
            sawStop = true;
            break;
          }
        }
      }
      if (!sawStop && buf.trim()) handleLine(buf.trim()); // 冲刷无换行收尾的残包
    } catch (err) {
      if (err instanceof AiProviderError) throw err;
      try {
        await reader.cancel();
      } catch {
        /* ignore */
      }
      if (guard.timedOut)
        throw new AiProviderError(
          AI_ERROR_CODES.NETWORK,
          `响应超时：${timeout}ms 内未收到新数据块`,
        );
      if (signal?.aborted) throw err;
      throw new AiProviderError(
        AI_ERROR_CODES.NETWORK,
        `流式响应中断：${String(err?.message || err)}`,
        { detail: String(err) },
      );
    }

    return {
      text,
      toolCalls: [...calls.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([, v]) => v.call),
      usage:
        inputTokens || outputTokens
          ? normalizeUsage({
              prompt_tokens: inputTokens,
              completion_tokens: outputTokens,
              total_tokens: inputTokens + outputTokens,
            })
          : null,
      finishReason,
    };
  } finally {
    guard.cleanup();
  }
}

/**
 * 流式对话：apiFormat='openai'（默认）POST {baseURL}/chat/completions；'anthropic' POST {baseURL}/v1/messages。
 * @param {object} opts { baseURL, apiKey, apiFormat?='openai', model, messages, temperature?, maxTokens?, timeout?=60000, signal?, includeUsage?=true, extraHeaders?, tools?, toolChoice? }
 * @param {(delta: string) => void} [onDelta] 文本增量回调（可能一次收到整段——服务商无视流式时）
 * @returns {Promise<{text: string, toolCalls: Array, usage: {prompt_tokens, completion_tokens, total_tokens}|null, finishReason: string|null}>}
 */
export async function chatStream(opts, onDelta) {
  try {
    return await chatStreamOnce(opts, onDelta);
  } catch (err) {
    // 个别服务商不接受 stream_options 字段 —— 退回不带该字段重试一次（usage 可能拿不到）
    const detail = String(err?.detail || "") + String(err?.message || "");
    if (
      !opts.signal?.aborted &&
      err instanceof AiProviderError &&
      err.status === 400 &&
      /stream_options/i.test(detail)
    ) {
      return chatStreamOnce({ ...opts, includeUsage: false }, onDelta);
    }
    throw err;
  }
}

/**
 * 连接测试（方案 §三：设置区「连接测试」按钮）。
 * 用最小请求探活；成功返回 { ok, reply, usage, model }，失败抛 AiProviderError（code 见 AI_ERROR_CODES）。
 */
export async function testConnection(opts) {
  const { text, usage } = await chatStream({
    ...opts,
    messages: [{ role: "user", content: "连接测试，请只回复：OK" }],
    temperature: 0,
    timeout: opts?.timeout ?? 15000,
  });
  return { ok: true, reply: text, usage, model: opts?.model };
}

/**
 * 拉取服务商模型列表（OpenAI 兼容 GET {baseURL}/models）。
 * apiKey 可选——Ollama 本地等无需密钥；解析 data[].id，兼容 models[].name/id 兜底。
 * @returns {Promise<string[]>} 模型 id 列表（去重、排序）；失败抛 AiProviderError
 */
export async function embed(opts = {}) {
  if (opts.apiFormat === "anthropic")
    throw new AiProviderError(
      AI_ERROR_CODES.API,
      "当前供应商为 Anthropic Messages 格式，该协议不提供向量（embeddings）接口：请改用 OpenAI 兼容格式，或切换到其他供应商",
    );
  const { baseURL, apiKey = "", model, texts, signal, timeout = 60000 } = opts;
  if (!model || !Array.isArray(texts) || !texts.length)
    throw new AiProviderError(
      AI_ERROR_CODES.NOT_CONFIGURED,
      "缺少向量模型或文本",
    );
  const url = buildUrl(baseURL).replace(/\/chat\/completions$/, "/embeddings");
  const ctl = new AbortController();
  const abort = () => ctl.abort(signal.reason);
  if (signal?.aborted) abort();
  else signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => ctl.abort(), timeout);
  try {
    const res = await fetch(url, {
      method: "POST",
      signal: ctl.signal,
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: "Bearer " + apiKey } : {}),
      },
      body: JSON.stringify({ model, input: texts }),
    });
    if (!res.ok)
      throwFailure(res.status, extractServerMessage(await res.text()));
    const body = await res.json();
    const data = body.data?.slice().sort((a, b) => a.index - b.index);
    if (
      !data ||
      data.length !== texts.length ||
      data.some(
        (r, i) =>
          r.index !== i ||
          !Array.isArray(r.embedding) ||
          !r.embedding.length ||
          r.embedding.some((x) => !Number.isFinite(x)),
      ) ||
      data.some((r) => r.embedding.length !== data[0].embedding.length)
    )
      throw new AiProviderError(AI_ERROR_CODES.API, "向量响应格式或维度无效");
    return {
      vectors: data.map((r) => r.embedding),
      usage: normalizeUsage(body.usage),
    };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

export async function listModels(opts = {}) {
  if (opts.apiFormat === "anthropic")
    throw new AiProviderError(
      AI_ERROR_CODES.API,
      "Anthropic Messages 格式不提供模型列表接口（/models）：请手动添加模型名",
    );
  const {
    baseURL,
    apiKey = "",
    timeout = 15000,
    signal = null,
    extraHeaders = {},
  } = opts;
  if (!baseURL || !String(baseURL).trim()) {
    throw new AiProviderError(
      AI_ERROR_CODES.NOT_CONFIGURED,
      "恍然梦未配置：请先在设置中填写 API 地址（baseURL）",
    );
  }
  const base = buildUrl(baseURL).replace(/\/chat\/completions$/, "");
  const url = base + "/models";
  const headers = { ...extraHeaders };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctrl.abort(new Error("ai-list-timeout"));
  }, timeout);
  const onOuterAbort = () => ctrl.abort(signal?.reason);
  if (signal) {
    if (signal.aborted) ctrl.abort(signal.reason);
    else signal.addEventListener("abort", onOuterAbort, { once: true });
  }

  try {
    let res;
    try {
      res = await fetch(url, { method: "GET", headers, signal: ctrl.signal });
    } catch (err) {
      if (timedOut)
        throw new AiProviderError(
          AI_ERROR_CODES.NETWORK,
          `拉取模型列表超时：${timeout}ms 内未收到响应`,
        );
      if (signal?.aborted) throw err;
      throw new AiProviderError(
        AI_ERROR_CODES.NETWORK,
        `网络请求失败：无法连接 ${hostOf(url)}`,
        { detail: String(err?.message || err) },
      );
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throwFailure(res.status, extractServerMessage(text), text);
    }
    const obj = await res.json().catch(() => null);
    const rows = Array.isArray(obj?.data)
      ? obj.data
      : Array.isArray(obj?.models)
        ? obj.models
        : [];
    const ids = [
      ...new Set(
        rows
          .map((m) => (typeof m === "string" ? m : m?.id || m?.name))
          .filter((s) => typeof s === "string" && s.trim())
          .map((s) => s.trim()),
      ),
    ].sort();
    if (!ids.length) {
      throw new AiProviderError(
        AI_ERROR_CODES.API,
        "服务商未返回任何模型（该地址可能不支持 /models 接口，可手动添加模型名）",
      );
    }
    return ids;
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener("abort", onOuterAbort);
  }
}
