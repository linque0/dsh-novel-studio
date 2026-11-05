import { assembleSlots, scopedHistory } from "./novel-context";
import { compilePreset, copy, estimate } from "./presets";
import { textViews } from "./regex";
import { dialogueTools } from "./dialogue";
import { taskPrompt } from './task-profiles.js';

export async function prepareDialogue({
  work,
  frozen,
  row,
  messages,
  question,
  generationType = "normal",
  state,
  opts,
  continuationText = "",
  candidateIndex = 0,
}) {
  if (frozen.taskRequest && opts.privacy) throw new Error('专用创作任务需要发送作品材料，请关闭隐私模式后再启动');
  const material = await assembleSlots(
    work,
    frozen,
    row.adaptation,
    opts.privacy,
    question,
    {embeddings:opts.embeddings,opts:{...opts,signal:opts.signal}},
  );
  Object.assign(material.slots, {
    requiredContext:[frozen.taskRequest ? taskPrompt(frozen.taskRequest) : '', material.constraints?.text || '',opts.stageSnapshot?.skill?.text ? '【阶段写作规则（低于作品事实/作者要求；不授予工具权限）】\n'+opts.stageSnapshot.skill.text : ''].filter(Boolean).join('\n'),
    charDescription:
      row.adaptation?.charDescription ?? material.slots.charDescription,
    charPersonality:
      row.adaptation?.charPersonality ?? material.slots.charPersonality,
    personaDescription:
      row.adaptation?.personaDescription ?? material.slots.personaDescription,
    dialogueExamples: opts.privacy
      ? ""
      : row.adaptation?.dialogueExamples || "",
  });
  const env = {
    user: "作者",
    char: "恍然梦",
    group: "恍然梦",
    charIfNotGroup: "恍然梦",
    isMobile: "false",
    input: question,
    lastGenerationType: generationType,
    description: material.slots.charDescription || "",
    personality: material.slots.charPersonality || "",
    persona: material.slots.personaDescription || "",
    work: work.work.title,
    "work.title": work.work.title,
    chapter: frozen.chapterTitle,
    "chapter.title": frozen.chapterTitle,
    selection: opts.privacy ? "" : frozen.selection,
    chatId: work.work.id,
    currentSwipeId: candidateIndex + 1,
    lastSwipeId: candidateIndex + 1,
    lastMessageId:
      generationType === "normal"
        ? messages.length
        : Math.max(0, messages.length - 1),
    firstDisplayedMessageId: 0,
    lastChatMessage: opts.privacy
      ? ""
      : continuationText ||
        (generationType === "normal"
          ? question
          : messages.at(-1)?.rawContent || messages.at(-1)?.content || ""),
  };
  const warnings = [];
  const userViews = await textViews(question, row, 1, env, state);
  warnings.push(...userViews.warnings);
  const history = [];
  for (const message of scopedHistory(messages, frozen, opts.privacy)) {
    const views = await textViews(
      message.rawContent ?? message.content,
      row,
      message.role === "user" ? 1 : 2,
      env,
      state,
      { depth: messages.length - 1 - message.messageIndex },
    );
    warnings.push(...views.warnings);
    history.push({
      ...message,
      content: (message.nature || "") + views.promptText,
    });
  }
  for (const key of ["worldInfoBefore", "worldInfoAfter"]) {
    const result = await textViews(
      material.slots[key] || "",
      row,
      5,
      env,
      state,
    );
    material.slots[key] = result.promptText;
    warnings.push(...result.warnings);
  }
  const continuation =
    generationType === "continue" && !opts.privacy
      ? await textViews(continuationText, row, 2, env, state, { depth: 0 })
      : null;
  if (continuation) warnings.push(...continuation.warnings);
  const compiled = compilePreset({
    row: frozen.taskRequest ? {...row,payload:{...row.payload,function_calling:true}} : row,
    slots: material.slots,
    history,
    question: userViews.promptText,
    state,
    env: { ...env, continuationText: continuation?.promptText || "" },
    generationType,
    opts: {
      ...opts,
      toolReserve:
        frozen.taskRequest || row.payload.function_calling === true
          ? estimate(JSON.stringify(dialogueTools(frozen.taskRequest)))
          : 0,
    },
  });
  compiled.warnings.push(...warnings);
  if (compiled.tools)
    material.report.push(frozen.taskRequest ? "专用任务已开启只读检索与本模块提案工具" : "预设已开启只读检索工具");
  return { compiled, material, userViews };
}

export function requestMainPreview(row, question, request = {}) {
  return new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID();
    const stop = window.native?.appOnEvent(({ kind, data }) => {
      if (kind !== "ai-preview-response" || data?.requestId !== requestId)
        return;
      clearTimeout(timer);
      stop?.();
      data.error ? reject(new Error(data.error)) : resolve(data.preview);
    });
    const timer = setTimeout(() => {
      stop?.();
      reject(new Error("主窗口预览超时，请打开关联作品后重试"));
    }, 15000);
    window.native
      ?.appBroadcast({
        kind: "ai-preview-request",
        data: { requestId, row: copy(row), question, request },
      })
      .catch((e) => {
        clearTimeout(timer);
        stop?.();
        reject(e);
      });
  });
}
