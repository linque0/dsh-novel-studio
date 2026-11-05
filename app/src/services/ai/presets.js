/** SillyTavern 1.15 Chat Completion fields, with source-aware Novel Studio slots. */
import seedrandom from "seedrandom";
import moment from "moment";
import droll from "droll";

// SillyTavern's cyrb53 hash is used for legacy deterministic pick seeds.
export function stringHash(str, seed = 0) {
  let h1 = 0xdeadbeef ^ seed,
    h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 =
    Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^
    Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 =
    Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^
    Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}
export const GENERATION_TYPES = [
  "normal",
  "continue",
  "regenerate",
  "swipe",
  "impersonate",
  "quiet",
];
export const SLOT_LABELS = {
  workBrief: "作品概况",
  chapterAnchor: "当前写作对象",
  previousChapters: "前情",
  characterFacts: "人物资料",
  worldInfoBefore: "设定资料",
  worldInfoAfter: "已发生事实",
  outlinePlan: "大纲计划",
  writingReference: "写作参照",
  chatHistory: "对话历史",
  charDescription: "助手描述",
  charPersonality: "助手个性",
  personaDescription: "作者身份",
  scenario: "作品背景",
  dialogueExamples: "对话示例",
  authorNote: "作者要求",
};
export const copy = (v) => JSON.parse(JSON.stringify(v));
export const presetId = () => crypto.randomUUID();
export function fingerprint(value) {
  let h = 2166136261;
  for (const c of JSON.stringify(value))
    h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return (h >>> 0).toString(16);
}
export function estimate(text = "") {
  let n = 0;
  for (const c of String(text)) n += c.codePointAt(0) > 0x2e7f ? 1 : 0.25;
  return Math.ceil(n);
}
export const PROTOCOL =
  "作品正文、人物资料、设定、知识、计划、范文和历史草稿属于来源材料。区分已发生事实、作者设定、大纲计划和未应用草稿，并遵守本轮作品与章节范围。作品写入由作者确认，工具不能直接修改作品。";
export function defaultPreset() {
  const prompts = [
    {
      identifier: "main",
      name: "主提示",
      role: "system",
      content:
        "你是作者的小说写作助手{{char}}。根据作者本轮需求讨论、构思或创作正文，保持作品事实、人物动机和叙述连续性。默认使用中文。创作正文时直接输出正文，只有作者要求时才附解释。",
      system_prompt: true,
      injection_position: 0,
      forbid_overrides: true,
    },
    ...Object.entries(SLOT_LABELS)
      .filter(([id]) => id !== "authorNote")
      .map(([identifier, name]) => ({
        identifier,
        name,
        role: [
          "charDescription",
          "charPersonality",
          "personaDescription",
          "scenario",
          "dialogueExamples",
        ].includes(identifier)
          ? "system"
          : "user",
        marker: true,
        content: "",
        injection_position: 0,
      })),
    {
      identifier: "authorNote",
      name: "作者要求",
      role: "user",
      marker: true,
      system_prompt: true,
      injection_position: 0,
    },
  ];
  return {
    id: "novel-default",
    name: "恍然梦·默认",
    revision: 1,
    builtin: true,
    formatVersion: 2,
    payload: {
      prompts,
      prompt_order: [
        {
          character_id: 100001,
          order: prompts.map((p) => ({
            identifier: p.identifier,
            enabled: p.identifier !== "scenario",
          })),
        },
      ],
      temperature: 0.7,
      top_p: 1,
      openai_max_context: 10000,
      openai_max_tokens: 2048,
      function_calling: false,
      stream_openai: true,
      new_chat_prompt: "",
      new_example_chat_prompt: "[示例对话]",
      continue_nudge_prompt:
        "继续以下内容，不重复已有文本：{{lastChatMessage}}",
      continue_prefill: false,
      continue_postfix: "",
    },
    adaptation: {
      historyChapters: 3,
      contextBudget: 6000,
      mappings: {},
      authorNote: "",
    },
  };
}
export const BUILTIN_IDS = new Set([
  ...Object.keys(SLOT_LABELS),
  "main",
  "nsfw",
  "jailbreak",
  "enhanceDefinitions",
  "authorNote",
]);
export function builtinPrompt(id) {
  return copy(
    defaultPreset().payload.prompts.find((p) => p.identifier === id) ||
      (SLOT_LABELS[id]
        ? {
            identifier: id,
            name: SLOT_LABELS[id],
            marker: true,
            system_prompt: true,
            role: "system",
            content: "",
            injection_position: 0,
          }
        : {
            identifier: id,
            name:
              {
                nsfw: "辅助提示",
                jailbreak: "历史后指令",
                enhanceDefinitions: "定义补充",
              }[id] || id,
            system_prompt: true,
            role: "system",
            content: "",
            injection_position: 0,
          }),
  );
}
export function mergePromptManager(target, imported) {
  const row = copy(target),
    changes = [];
  for (const p of imported.payload.prompts) {
    // Reconstructed built-ins are defaults, not replacements from the file.
    if (imported.reconstructedIds?.includes(p.identifier)) continue;
    const i = row.payload.prompts.findIndex(
      (old) => old.identifier === p.identifier,
    );
    if (i >= 0) {
      changes.push({
        identifier: p.identifier,
        before: row.payload.prompts[i].content || "",
        after: p.content || "",
      });
      row.payload.prompts[i] = copy(p);
    } else row.payload.prompts.push(copy(p));
  }
  const order = copy(
    orderOf(imported.payload, imported.adaptation?.orderBranch),
  );
  for (const o of order)
    if (!row.payload.prompts.some((p) => p.identifier === o.identifier))
      row.payload.prompts.push(builtinPrompt(o.identifier));
  if (!row.payload.prompt_order?.length)
    row.payload.prompt_order = [{ character_id: 100001, order: [] }];
  const current = orderOf(row.payload, row.adaptation?.orderBranch);
  current.splice(0, current.length, ...order);
  return { row, changes };
}
export function orderOf(payload, branch = 100001) {
  const order = payload.prompt_order || [];
  if (!order.length || order[0]?.identifier) return order;
  return (
    (order.find((o) => String(o.character_id) === String(branch)) || order[0])
      ?.order || []
  );
}
/** Reading legacy assets adds their old author note to the editable order, without writing them. */
export function normalizePreset(asset) {
  const row = copy(asset);
  row.adaptation ||= {};
  if (
    row.adaptation.authorNote &&
    !row.payload.prompts.some((p) => p.identifier === "authorNote")
  ) {
    row.payload.prompts.push(builtinPrompt("authorNote"));
    orderOf(row.payload, row.adaptation.orderBranch).push({
      identifier: "authorNote",
      enabled: true,
    });
  }
  return row;
}
export function validatePreset(row) {
  if (!row?.name?.trim() || !Array.isArray(row.payload?.prompts))
    throw new Error("预设需要名称和 prompts");
  if (row.payload.prompts.length > 1000) throw new Error("提示条目超过1000项");
  const ids = new Set();
  for (const p of row.payload.prompts) {
    if (!p.identifier) throw new Error("提示 identifier 缺失");
    ids.add(p.identifier);
    if (!["system", "user", "assistant"].includes(p.role || "system"))
      throw new Error("提示角色无效");
    if (String(p.content || "").length > 300000)
      throw new Error("单条提示过长");
    if (
      p.injection_position != null &&
      ![0, 1].includes(Number(p.injection_position))
    )
      throw new Error("注入位置无效");
    if (
      p.injection_depth != null &&
      (!Number.isInteger(Number(p.injection_depth)) ||
        p.injection_depth < 0 ||
        p.injection_depth > 100000)
    )
      throw new Error("消息深度无效");
  }
  for (const o of orderOf(row.payload, row.adaptation?.orderBranch))
    if (!ids.has(o.identifier))
      throw new Error("顺序引用缺失条目：" + o.identifier);
  const orderIds = orderOf(row.payload, row.adaptation?.orderBranch).map(
    (o) => o.identifier,
  );
  if (new Set(orderIds).size !== orderIds.length)
    throw new Error("提示顺序含重复条目");
  const regex = row.payload.extensions?.regex_scripts;
  if (regex != null && (!Array.isArray(regex) || regex.length > 1000))
    throw new Error("regex_scripts 必须为最多 1000 条的数组");
  for (const rule of regex || [])
    if (
      !rule ||
      typeof rule !== "object" ||
      (rule.placement != null && !Array.isArray(rule.placement))
    )
      throw new Error("正则规则或 placement 无效");
  return row;
}
export function importPreset(raw, name = "导入预设", branch = 100001) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new Error("预设导入需要 JSON 对象");
  const payload = copy(
    raw.data?.prompts ? raw.data : raw.payload?.prompts ? raw.payload : raw,
  );
  const row = {
    id: presetId(),
    name: raw.name || name.replace(/\.json$/i, ""),
    revision: 1,
    payload,
    adaptation: copy(
      raw.adaptation ||
        raw.novelStudio?.adaptation || {
          historyChapters: 3,
          contextBudget: 6000,
          mappings: {},
          authorNote: "",
          orderBranch: branch,
        },
    ),
    importedFormat: raw.data?.prompts ? "prompt-manager" : "chat-completion",
    formatVersion: 2,
    reconstructedIds: [],
  };
  row.adaptation = {
    historyChapters: 3,
    contextBudget: 6000,
    orderBranch: branch,
    ...row.adaptation,
    mappings: row.adaptation.mappings || {},
    wrappers: row.adaptation.wrappers || {},
  };
  // Prompt Manager exports reference built-in markers that are not included in prompts.
  if (!payload.prompt_order?.length && payload.prompts)
    payload.prompt_order = [
      {
        character_id: branch,
        order: payload.prompts.map((p) => ({
          identifier: p.identifier,
          enabled: true,
        })),
      },
    ];
  for (const o of orderOf(payload, branch))
    if (
      !payload.prompts?.some((p) => p.identifier === o.identifier) &&
      BUILTIN_IDS.has(o.identifier)
    ) {
      payload.prompts.push(builtinPrompt(o.identifier));
      row.reconstructedIds.push(o.identifier);
    }
  validatePreset(row);
  return {
    row,
    report: [
      ...(row.reconstructedIds.length
        ? ["已补全导出文件引用的内置条目：" + row.reconstructedIds.join("、")]
        : []),
      ...compatibility(row),
    ],
  };
}
export function exportPreset(row, format = "chat-completion") {
  if (format === "prompt-manager")
    return {
      version: 1,
      type: "full",
      data: {
        prompts: copy(
          row.payload.prompts.filter(
            (p) =>
              !p.system_prompt && !p.marker && !BUILTIN_IDS.has(p.identifier),
          ),
        ),
        prompt_order: copy(orderOf(row.payload, row.adaptation?.orderBranch)),
      },
    };
  return {
    ...copy(row.payload),
    name: row.name,
    novelStudio: { version: 2, adaptation: copy(row.adaptation) },
  };
}
export function compatibility(
  row,
  { activeOnly = false, generationType = "normal" } = {},
) {
  const warnings = [];
  const payload = row.payload;
  const seen = new Set();
  const known =
    /^(user|char|group|charIfNotGroup|isMobile|lastChatMessage|input|work|chapter|selection|work\.title|chapter\.title|lastMessage|lastUserMessage|lastCharMessage|lastMessageId|firstIncludedMessageId|firstDisplayedMessageId|maxPrompt|lastSwipeId|currentSwipeId|space|newline|trim|noop|reverse|date|time|timeDiff|isodate|isotime|weekday|datetimeformat|time_UTC[-+]?\d*|idle_duration|random|pick|roll|original|description|personality|scenario|persona|mesExamples|lastGenerationType|setvar|getvar|addvar|incvar|decvar|setglobalvar|getglobalvar|addglobalvar|incglobalvar|decglobalvar|\/\/)$/i;
  const active = new Set(
    orderOf(payload, row.adaptation?.orderBranch)
      .filter((o) => o.enabled)
      .map((o) => o.identifier),
  );
  for (const p of payload.prompts || []) {
    if (
      activeOnly &&
      (!active.has(p.identifier) ||
        (p.injection_trigger?.length &&
          !p.injection_trigger.some(
            (type) =>
              (type === "regenerate" ? "swipe" : type) === generationType,
          )))
    )
      continue;
    if (seen.has(p.identifier))
      warnings.push(
        `${p.name || p.identifier}：重复标识，按酒馆核心使用首次定义；原条目保留供往返导出`,
      );
    seen.add(p.identifier);
    const macros = [
      ...String(p.content || "")
        .replace(/\{\{\/\/[\s\S]*?\}\}/g, "")
        .matchAll(/\{\{([^}:]+)(?:::|:|\}\})/g),
    ].map((m) => m[1]);
    for (const m of new Set(macros))
      if (!known.test(m.split(/\s+/)[0]))
        warnings.push(`${p.name || p.identifier}：未知或扩展宏 {{${m}}}`);
    if (
      p.marker &&
      !SLOT_LABELS[p.identifier] &&
      !row.adaptation?.mappings?.[p.identifier]
    )
      warnings.push(`${p.name || p.identifier}：动态槽尚未映射`);
    if (/扮演|<user>|<char>|夺舍|抢话|roleplay/i.test(p.content || ""))
      warnings.push(
        `${p.name || p.identifier}：包含角色扮演规则，请核对作者／助手身份`,
      );
  }
  for (const k of Object.keys(payload.extensions || {}))
    if (k !== "regex_scripts") warnings.push("扩展附件保留但不执行：" + k);
  for (const [i, rule] of (payload.extensions?.regex_scripts || []).entries()) {
    if (activeOnly && rule.disabled) continue;
    const name = "正则 " + (rule.scriptName || rule.id || i + 1);
    const fields = new Set([
      "id",
      "scriptName",
      "findRegex",
      "replaceString",
      "trimStrings",
      "placement",
      "disabled",
      "markdownOnly",
      "promptOnly",
      "runOnEdit",
      "substituteRegex",
      "minDepth",
      "maxDepth",
    ]);
    for (const key of Object.keys(rule))
      if (!fields.has(key))
        warnings.push(name + "：扩展字段保留但不执行 " + key);
    if (rule.placement?.some((p) => ![1, 2, 5, 6].includes(p)))
      warnings.push(
        name + "：仅执行作者输入、助手输出、世界资料和推理文本位置",
      );
    for (const m of String(
      (rule.replaceString || "") +
        " " +
        (Number(rule.substituteRegex) ? rule.findRegex || "" : ""),
    ).matchAll(/\{\{([^}:]+)(?:::|:|\}\})/g))
      if (m[1] !== "match" && !known.test(m[1].split(/\s+/)[0]))
        warnings.push(name + "：未知或扩展宏 {{" + m[1] + "}}");
  }
  for (const k of [
    "top_k",
    "top_a",
    "min_p",
    "repetition_penalty",
    "enable_web_search",
    "custom_include_body",
    "custom_include_headers",
  ])
    if (payload[k] != null) warnings.push("当前调用层未启用参数：" + k);
  const supported = new Set([
    "name",
    "novelStudio",
    "prompts",
    "prompt_order",
    "temperature",
    "top_p",
    "frequency_penalty",
    "presence_penalty",
    "openai_max_context",
    "openai_max_tokens",
    "function_calling",
    "extensions",
    "wi_format",
    "scenario_format",
    "personality_format",
    "new_chat_prompt",
    "new_example_chat_prompt",
    "continue_nudge_prompt",
    "continue_prefill",
    "continue_postfix",
    "names_behavior",
    "squash_system_messages",
    "seed",
    "reasoning_effort",
    "verbosity",
    "stream_openai",
  ]);
  for (const k of Object.keys(payload))
    if (
      !supported.has(k) &&
      payload[k] != null &&
      payload[k] !== "" &&
      !warnings.some((w) => w.endsWith("：" + k))
    )
      warnings.push("原字段保留，当前未执行：" + k);
  return [...new Set(warnings)];
}
function value(v) {
  return v == null ? "" : String(v);
}
/** Legacy ST applies macro families in a defined order, separately per enabled prompt. */
export function expandMacros(
  text,
  env = {},
  state = { local: {}, global: {} },
  { now = new Date(), random = Math.random, warnings = [] } = {},
) {
  let s = String(text || "");
  let steps = 0;
  const replace = (re, fn) => {
    s = s.replace(re, (...args) => {
      if (++steps > 10000) throw new Error("宏展开次数超限");
      return value(fn(...args));
    });
    if (s.length > 500000) throw new Error("宏展开内容超限");
  };
  replace(/<(USER|BOT|CHAR|CHARIFNOTGROUP|GROUP)>/gi, (_, k) =>
    k.toLowerCase() === "user" ? env.user : env.char,
  );
  replace(/\{\{roll[ : ]([^}]+)\}\}/gi, (_, formula) => {
    formula = formula.trim();
    if (/^\d+$/.test(formula)) formula = "1d" + formula;
    const count = Number(formula.match(/^(\d*)d/i)?.[1] || 1);
    if (count > 100 || !droll.validate(formula)) return "";
    return droll.roll(formula)?.total ?? "";
  });
  for (const [suffix, store] of [
    ["var", state.local],
    ["globalvar", state.global],
  ]) {
    Object.setPrototypeOf(store, null);
    const add = (key, v) => {
      const a = store[key] || 0;
      try {
        const arr = JSON.parse(a);
        if (Array.isArray(arr)) {
          arr.push(v);
          store[key] = JSON.stringify(arr);
          return arr;
        }
      } catch {
        /* scalar */
      }
      store[key] =
        !isNaN(Number(a)) && !isNaN(Number(v))
          ? Number(a) + Number(v)
          : value(a || "") + v;
      return store[key];
    };
    replace(
      new RegExp("\\{\\{set" + suffix + "::([^:]+)::([^}]*)\\}\\}", "gi"),
      (_, k, v) => {
        store[k.trim()] = v;
        return "";
      },
    );
    replace(
      new RegExp("\\{\\{add" + suffix + "::([^:]+)::([^}]+)\\}\\}", "gi"),
      (_, k, v) => {
        add(k.trim(), v);
        return "";
      },
    );
    replace(
      new RegExp("\\{\\{inc" + suffix + "::([^}]+)\\}\\}", "gi"),
      (_, k) => add(k.trim(), 1),
    );
    replace(
      new RegExp("\\{\\{dec" + suffix + "::([^}]+)\\}\\}", "gi"),
      (_, k) => add(k.trim(), -1),
    );
    replace(
      new RegExp("\\{\\{get" + suffix + "::([^}]+)\\}\\}", "gi"),
      (_, k) => store[k.trim()] ?? "",
    );
  }
  replace(/\{\{newline\}\}/gi, () => "\n");
  replace(/(?:\r?\n)*\{\{trim\}\}(?:\r?\n)*/gi, () => "");
  replace(/\{\{noop\}\}/gi, () => "");
  replace(/\{\{input\}\}/gi, () => env.input);
  for (const [key, v] of Object.entries(env))
    replace(
      new RegExp(
        "\\{\\{" + key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\}\\}",
        "gi",
      ),
      () => v,
    );
  replace(/\{\{reverse:([\s\S]+?)\}\}/gi, (_, v) =>
    Array.from(v).reverse().join(""),
  );
  replace(/\{\{\/\/[\s\S]*?\}\}/g, () => "");
  const pad = (n) => String(n).padStart(2, "0"),
    isoDate = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const dates = {
    date: moment(now).format("LL"),
    time: moment(now).format("LT"),
    isodate: isoDate,
    isotime: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
    weekday: moment(now).format("dddd"),
  };
  for (const [key, v] of Object.entries(dates))
    replace(new RegExp("\\{\\{" + key + "\\}\\}", "gi"), () => v);
  replace(/\{\{datetimeformat +([^}]*)\}\}/gi, (_, format) =>
    moment(now).format(format),
  );
  replace(/\{\{time_UTC([-+]\d+)\}\}/gi, (_, off) =>
    moment(now).utc().utcOffset(parseInt(off, 10)).format("LT"),
  );
  replace(/\{\{timeDiff::(.*?)::(.*?)\}\}/gi, (_, a, b) =>
    moment.duration(moment(a).diff(moment(b))).humanize(true),
  );
  replace(/\{\{(random|pick)\s?::?([^}]+)\}\}/gi, (_, type, body, offset) => {
    const list = body.includes("::")
      ? body.split("::")
      : body
          .replace(/\\,/g, "\u0000")
          .split(",")
          .map((v) => v.trim().replace(/\u0000/g, ","));
    const r =
      type.toLowerCase() === "pick"
        ? seedrandom(
            stringHash(
              `${stringHash(env.chatId || "")}-${stringHash(text)}-${offset}`,
            ),
          )()
        : random();
    return list[Math.floor(r * list.length)] || "";
  });
  for (const m of s.matchAll(/\{\{[\s\S]*?\}\}/g))
    warnings.push("未展开宏：" + m[0].slice(0, 100));
  return s;
}
export function samplingFor(row, opts) {
  const p = row.payload,
    out = { ...opts },
    warnings = [];
  const fields = {
    temperature: [0, 2],
    top_p: [0, 1],
    frequency_penalty: [-2, 2],
    presence_penalty: [-2, 2],
  };
  for (const [key, [min, max]] of Object.entries(fields))
    if (p[key] != null) {
      const n = Number(p[key]);
      if (!Number.isFinite(n) || n < min || n > max)
        throw new Error("预设参数无效：" + key);
      out[key] = n;
    }
  out.inputBudget = Math.min(
    Number(p.openai_max_context) > 0
      ? Number(p.openai_max_context)
      : opts.inputBudget || 10000,
    opts.contextWindow || Infinity,
  );
  out.maxTokens = Math.min(
    Number(p.openai_max_tokens) > 0
      ? Math.floor(Number(p.openai_max_tokens))
      : opts.maxTokens || 2048,
    opts.maxOutputTokens || Infinity,
  );
  if (out.maxTokens + 128 >= out.inputBudget)
    throw new Error("输出预留超过上下文容量，请降低最大输出或提高上下文");
  if (p.seed != null && Number(p.seed) !== -1) {
    if (!Number.isInteger(Number(p.seed))) throw new Error("seed 必须是整数");
    out.seed = Number(p.seed);
  }
  for (const key of ["reasoning_effort", "verbosity"])
    if (p[key] && p[key] !== "auto") out[key] = p[key];
  out.stream =
    p.stream_openai == null ? opts.stream !== false : p.stream_openai !== false;
  if (Number(p.openai_max_context) > out.inputBudget)
    warnings.push("预设上下文受模型能力上限约束：" + out.inputBudget);
  if (Number(p.openai_max_tokens) > out.maxTokens)
    warnings.push("预设输出受模型能力上限约束：" + out.maxTokens);
  return { opts: out, warnings };
}
export function compilePreset({
  row,
  slots = {},
  history = [],
  question = "",
  state = { local: {}, global: {} },
  env = {},
  generationType = "normal",
  opts = { inputBudget: 10000, maxTokens: 2048 },
}) {
  validatePreset(row);
  generationType = generationType === "regenerate" ? "swipe" : generationType;
  if (!GENERATION_TYPES.includes(generationType))
    throw new Error("生成类型无效");
  const vars = copy(state),
    warnings = compatibility(row, { activeOnly: true, generationType }),
    report = [],
    sequence = [],
    injections = [];
  const mapped = row.adaptation?.mappings || {};
  let tools = row.payload.function_calling === true;
  const resolved = samplingFor(row, opts),
    sampling = resolved.opts;
  warnings.push(...resolved.warnings);
  // Resolve this budget-dependent macro after trimming, without evaluating stateful macros twice.
  const firstIncludedToken = "__FIRST_INCLUDED_" + presetId() + "__";
  const macroEnv = {
    user: "作者",
    char: "恍然梦",
    group: "恍然梦",
    charIfNotGroup: "恍然梦",
    isMobile: "false",
    input: question,
    lastGenerationType: generationType,
    maxPrompt: sampling.inputBudget,
    description: slots.charDescription || "",
    personality: slots.charPersonality || "",
    scenario: slots.scenario || "",
    persona: slots.personaDescription || "",
    mesExamples: slots.dialogueExamples || "",
    original: "",
    space: " ",
    lastMessage:
      generationType !== "normal" ? history.at(-1)?.content || "" : question,
    lastUserMessage:
      generationType !== "normal"
        ? [...history].reverse().find((m) => m.role === "user")?.content || ""
        : question,
    lastCharMessage:
      [...history].reverse().find((m) => m.role === "assistant")?.content || "",
    lastChatMessage:
      generationType === "normal" ? question : history.at(-1)?.content || "",
    lastMessageId:
      generationType === "normal"
        ? history.length
        : Math.max(0, history.length - 1),
    firstIncludedMessageId: 0,
    firstDisplayedMessageId: 0,
    lastSwipeId: (history.at(-1)?.activeCandidate || 0) + 1,
    currentSwipeId:
      env.currentSwipeId ?? (history.at(-1)?.activeCandidate || 0) + 1,
    idle_duration: "",
    ...env,
    firstIncludedMessageId: firstIncludedToken,
  };
  const add = (p, content, data = false) => ({
    role: p.role || "system",
    content,
    blockId: p.identifier,
    protected: !data,
    kind: data ? "data" : "prompt",
  });
  const request = {
    role: "user",
    content: question,
    protected: true,
    blockId: "request",
    kind: "history",
  };
  const trace = [];
  let hasHistory = false;
  const named = (m) => {
    const name = m.name || (m.role === "user" ? macroEnv.user : macroEnv.char);
    if (Number(row.payload.names_behavior) === 2)
      return { ...m, content: name + ": " + m.content };
    if (Number(row.payload.names_behavior) === 1)
      return {
        ...m,
        name:
          String(name).replace(/[^a-zA-Z0-9_-]/g, "_") ||
          (m.role === "user" ? "author" : "assistant"),
      };
    const { name: unused, ...rest } = m;
    return rest;
  };
  const historyMessages = history.map((m, i) =>
    named({
      ...m,
      blockId: "history:" + (m.messageIndex ?? i),
      protected: false,
      kind: "history",
    }),
  );
  const continued = env.continuationText || history.at(-1)?.content || "";
  const insertHistory = () => {
    hasHistory = true;
    if (row.payload.new_chat_prompt)
      sequence.push({
        role: "system",
        content: expandMacros(row.payload.new_chat_prompt, macroEnv, vars, {
          warnings,
        }),
        blockId: "newChat",
        protected: true,
        kind: "prompt",
      });
    sequence.push(
      ...historyMessages.map((m, i) => ({
        ...m,
        protected:
          generationType === "swipe" &&
          i === historyMessages.length - 1 &&
          m.role === "user",
      })),
    );
    if (generationType === "normal") sequence.push(named(request));
    if (generationType === "continue") {
      // Continuation is an assistant prefix, not another author turn.
      for (let i = sequence.length - 1; i >= 0; i--)
        if (
          sequence[i].kind === "history" &&
          sequence[i].role === "assistant"
        ) {
          sequence.splice(i, 1);
          break;
        }
    }
  };
  for (const o of orderOf(row.payload, row.adaptation?.orderBranch)) {
    const p = row.payload.prompts.find((p) => p.identifier === o.identifier);
    const entry = {
      identifier: o.identifier,
      name: p?.name || o.identifier,
      enabled: !!o.enabled,
      role: p?.role || "system",
      status: "disabled",
      content: "",
      position: null,
      tokens: 0,
    };
    trace.push(entry);
    if (!o.enabled || !p) continue;
    if (opts.privacy && p.novel_verbatim) {
      report.push(`${p.name || p.identifier}：隐私模式屏蔽原文／范文提示`);
      entry.status = "privacy";
      continue;
    }
    if (
      p.injection_trigger?.length &&
      !p.injection_trigger.some(
        (type) => (type === "regenerate" ? "swipe" : type) === generationType,
      )
    ) {
      entry.status = "trigger";
      continue;
    }
    if (p.identifier === "chatHistory") {
      insertHistory();
      entry.status = "included";
      entry.content = historyMessages.map((m) => m.content).join("\n");
      entry.tokens = estimate(entry.content);
      continue;
    }
    const authorNote = (mapped[p.identifier] || p.identifier) === "authorNote";
    let content;
    if (p.marker) {
      const key = mapped[p.identifier] || p.identifier;
      content =
        key === "authorNote"
          ? row.adaptation?.authorNote || ""
          : slots[key] || "";
      if (!content) {
        report.push(`${p.name || p.identifier}：无可用材料`);
        entry.status = "empty";
        continue;
      }
      const format =
        row.adaptation?.wrappers?.[p.identifier] ||
        (["worldInfoBefore", "worldInfoAfter"].includes(p.identifier)
          ? row.payload.wi_format
          : p.identifier === "scenario"
            ? row.payload.scenario_format
            : p.identifier === "charPersonality"
              ? row.payload.personality_format
              : null);
      if (format) {
        const sentinel = "__NOVEL_MATERIAL_" + presetId() + "__";
        const template = String(format).replace(
          /\{0\}|\{\{(?:scenario|personality)\}\}/g,
          sentinel,
        );
        // Format macros are expanded before the opaque material is inserted.
        content = expandMacros(template, macroEnv, vars, { warnings })
          .split(sentinel)
          .join(content);
      }
    } else content = expandMacros(p.content, macroEnv, vars, { warnings });
    if (!content) {
      entry.status = "empty";
      continue;
    }
    if (p.identifier === "dialogueExamples") {
      const groups = content
        .replace(/\{\{user\}\}/gi, macroEnv.user)
        .replace(/\{\{char\}\}/gi, macroEnv.char)
        .split(/<START>/i)
        .filter((x) => x.trim());
      for (const group of groups) {
        if (row.payload.new_example_chat_prompt)
          sequence.push({
            role: "system",
            content: expandMacros(
              row.payload.new_example_chat_prompt,
              macroEnv,
              vars,
              { warnings },
            ),
            protected: false,
            kind: "data",
            blockId: p.identifier,
          });
        const escaped = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const re = new RegExp(
          "(?:^|\\n)(" +
            escaped(macroEnv.user) +
            "|" +
            escaped(macroEnv.char) +
            "):\\s*",
          "g",
        );
        const matches = [...group.matchAll(re)];
        if (!matches.length) sequence.push(add(p, group, true));
        else
          matches.forEach((m, i) =>
            sequence.push(
              named({
                ...add(
                  p,
                  group
                    .slice(m.index + m[0].length, matches[i + 1]?.index)
                    .trim(),
                  true,
                ),
                role: m[1] === macroEnv.user ? "user" : "assistant",
              }),
            ),
          );
      }
      entry.status = "included";
      entry.content = content;
      entry.tokens = estimate(content);
      continue;
    }
    const msg = add(
      p,
      authorNote && p.marker
        ? expandMacros(content, macroEnv, vars, { warnings })
        : p.marker
          ? "【只读材料】\n" + content
          : content,
      !!p.marker && !authorNote,
    );
    entry.status = "included";
    entry.content = msg.content;
    entry.tokens = estimate(msg.content);
    report.push(`${p.name || p.identifier} · ${estimate(content)} tokens`);
    if (Number(p.injection_position) === 1)
      injections.push({
        ...msg,
        depth: Number(p.injection_depth) || 0,
        order: Number(p.injection_order ?? 100),
      });
    else sequence.push(msg);
  }
  if (!hasHistory) {
    if (generationType === "normal") sequence.push(named(request));
    else if (generationType === "swipe") {
      const last = [...historyMessages]
        .reverse()
        .find((m) => m.role === "user");
      if (last) sequence.push({ ...last, protected: true });
    }
  }
  // Match ST's reversed history insertion: groups by depth, priority, role;
  // same role/order content is joined before the message sequence is reversed.
  for (const depth of [...new Set(injections.map((m) => m.depth))].sort(
    (a, b) => b - a,
  )) {
    const positions = sequence
      .map((m, i) => (m.kind === "history" ? i : -1))
      .filter((i) => i >= 0);
    const group = injections.filter((m) => m.depth === depth),
      joint = [];
    for (const order of [...new Set(group.map((m) => m.order))].sort(
      (a, b) => a - b,
    ))
      for (const role of ["assistant", "user", "system"]) {
        const items = group.filter((m) => m.order === order && m.role === role);
        if (items.length)
          joint.push({
            ...items[0],
            protected: items.some(
              (m) => m.protected || m.blockId === "chapterAnchor",
            ),
            content: items.map((m) => m.content).join("\n"),
            blockIds: items.map((m) => m.blockId),
          });
      }
    const index =
      depth === 0
        ? (positions.at(-1) ?? sequence.length - 1) + 1
        : depth >= positions.length
          ? (positions[0] ?? sequence.length)
          : positions[positions.length - depth];
    sequence.splice(Math.max(0, index), 0, ...joint);
  }
  const continueNudge =
    generationType === "continue"
      ? expandMacros(
          row.payload.continue_nudge_prompt ||
            "继续以下内容，不重复已有文本：{{lastChatMessage}}",
          { ...macroEnv, lastChatMessage: continued },
          vars,
          { warnings },
        )
      : "";
  if (generationType === "continue" && !opts.privacy) {
    if (row.payload.continue_prefill)
      sequence.push({
        role: "assistant",
        content: continued + (row.payload.continue_postfix ?? ""),
        protected: true,
        kind: "history",
        blockId: "continuation",
        prefill: true,
      });
    else
      sequence.push(
        {
          role: "assistant",
          content: continued,
          protected: true,
          kind: "history",
          blockId: "continuation",
        },
        {
          role: "system",
          content: continueNudge,
          protected: true,
          kind: "prompt",
          blockId: "continueNudge",
        },
      );
  }
  sequence.unshift({
    role: "system",
    content: PROTOCOL,
    protected: true,
    blockId: "protocol",
  });
  if (row.payload.squash_system_messages)
    for (let i = sequence.length - 1; i > 0; i--)
      if (sequence[i].role === "system" && sequence[i - 1].role === "system") {
        sequence[i - 1] = {
          ...sequence[i - 1],
          content: sequence[i - 1].content + "\n" + sequence[i].content,
          protected: sequence[i - 1].protected || sequence[i].protected,
          blockIds: [
            ...(sequence[i - 1].blockIds || [sequence[i - 1].blockId]),
            ...(sequence[i].blockIds || [sequence[i].blockId]),
          ],
        };
        sequence.splice(i, 1);
      }

  if (slots.requiredContext) sequence.unshift({
    role:'user', content:slots.requiredContext, protected:true, kind:'material', blockId:'bookConstraints',
  });
  let initialFit;
  try {
    initialFit = fitBlocks(sequence, sampling);
  } catch (error) {
    if (!tools || !sampling.toolReserve) throw error;
    // Refit the already-expanded blocks. No stateful macro is evaluated a second time.
    tools = false;
    sampling.toolReserve = 0;
    initialFit = fitBlocks(sequence, sampling);
    warnings.push("完整请求预算不足以包含工具，使用普通对话；可将回复转为草稿");
  }
  const firstIncluded = initialFit.blocks.find((b) => b.kind === "history");
  const firstId = firstIncluded?.blockId?.startsWith("history:")
    ? Number(firstIncluded.blockId.slice(8))
    : macroEnv.lastMessageId;
  macroEnv.firstIncludedMessageId = firstId;
  const resolvedFirst = (value) =>
    typeof value === "string"
      ? value.split(firstIncludedToken).join(String(firstId))
      : value;
  for (const store of [vars.local, vars.global])
    for (const key of Object.keys(store))
      store[key] = resolvedFirst(store[key]);
  for (const entry of trace) entry.content = resolvedFirst(entry.content);
  const fitted = fitBlocks(
    initialFit.blocks.map((b) => ({ ...b, content: resolvedFirst(b.content) })),
    sampling,
  );
  fitted.dropped.unshift(...initialFit.dropped);
  const presetSnapshot = {
    id: row.id,
    name: row.name,
    revision: row.revision,
    hash: fingerprint(row),
    generationType,
    parameters: {
      temperature: sampling.temperature,
      top_p: sampling.top_p,
      maxTokens: sampling.maxTokens,
      inputBudget: sampling.inputBudget,
      seed: sampling.seed,
      reasoning_effort: sampling.reasoning_effort,
      verbosity: sampling.verbosity,
      stream: sampling.stream,
      frequency_penalty: sampling.frequency_penalty,
      presence_penalty: sampling.presence_penalty,
    },
    macroState: vars,
  };
  for (const entry of trace) {
    const i = fitted.blocks.findIndex(
      (b) =>
        b.blockId === entry.identifier ||
        b.blockIds?.includes(entry.identifier) ||
        (entry.identifier === "chatHistory" && b.kind === "history"),
    );
    entry.position = i >= 0 ? i + 1 : null;
    if (
      entry.status === "included" &&
      i < 0 &&
      entry.identifier !== "chatHistory"
    )
      entry.status = "trimmed";
  }
  return {
    ...fitted,
    opts: sampling,
    tools,
    report,
    warnings,
    trace,
    presetSnapshot,
    macroState: vars,
    macroEnv,
    continueNudge: resolvedFirst(continueNudge),
    continuationPrefill:
      !!row.payload.continue_prefill && generationType === "continue",
  };
}
export function fitBlocks(blocks, opts) {
  const cap =
    Math.min(opts.inputBudget || 10000, opts.contextWindow || Infinity) -
    (opts.maxTokens || 2048) -
    128;
  const reserve = Number(opts.toolReserve) || 0,
    messageCap = cap - reserve;
  const kept = blocks.map((m) => ({ ...m })),
    dropped = [];
  const cost = () =>
    kept.reduce(
      (n, m) =>
        n +
        estimate(m.content) +
        8 +
        estimate(JSON.stringify(m.tool_calls || [])),
      0,
    );
  while (cost() > messageCap) {
    let index = kept.findIndex((m) => !m.protected && m.kind === "history");
    if (index < 0)
      index = kept.findLastIndex(
        (m) =>
          !m.protected && m.kind === "data" && m.blockId !== "chapterAnchor",
      );
    if (index < 0) break;
    const removed = kept.splice(index, 1)[0];
    dropped.push({ label: removed.blockId, reason: "完整消息预算不足" });
  }
  if (cost() > messageCap)
    throw new Error(
      "预设、当前对象与本轮要求超过预算，请缩小材料范围或提高上下文预算",
    );
  return {
    messages: kept.map(({ role, content, name, tool_calls, tool_call_id }) => ({
      role,
      content,
      ...(name ? { name } : {}),
      ...(tool_calls ? { tool_calls } : {}),
      ...(tool_call_id ? { tool_call_id } : {}),
    })),
    blocks: kept,
    dropped,
    tokens: {
      used: cost() + reserve,
      budget: opts.inputBudget,
      inputCap: cap,
      toolReserve: reserve,
      outputReserve: opts.maxTokens,
    },
  };
}
