import { applies } from "./regex-core";
export function processRegex(
  text,
  row,
  context = {},
  env = {},
  state = { local: {}, global: {} },
) {
  const rules = row?.payload?.extensions?.regex_scripts || [];
  if (!rules.some((rule) => applies(rule, context)))
    return Promise.resolve({
      text: String(text || ""),
      trace: [],
      warnings: [],
    });
  return new Promise((resolve) => {
    const worker = new Worker(new URL("./regex-worker.js", import.meta.url), {
      type: "module",
    });
    let ruleTimer,
      stageTimer,
      current = "",
      finished = false;
    const finish = (result) => {
      if (finished) return;
      finished = true;
      clearTimeout(ruleTimer);
      clearTimeout(stageTimer);
      worker.terminate();
      resolve(result);
    };
    const failed = (reason) =>
      finish({
        text: String(text || ""),
        trace: [],
        warnings: [
          `正则 ${current || "处理阶段"}：${reason}，已恢复处理前文本`,
        ],
      });
    stageTimer = setTimeout(() => failed("超过3秒"), 3000);
    worker.onmessage = ({ data }) => {
      if (data.progress) {
        clearTimeout(ruleTimer);
        current = data.progress.name;
        ruleTimer = setTimeout(() => failed("单条超过500毫秒"), 500);
      } else if (data.error) failed(data.error);
      else if (data.result) finish(data.result);
    };
    worker.onerror = (event) => failed(event.message);
    worker.postMessage({
      text: String(text || ""),
      rules: JSON.parse(JSON.stringify(rules)),
      context,
      env: JSON.parse(JSON.stringify(env)),
      state: JSON.parse(JSON.stringify(state)),
    });
  });
}
export async function textViews(raw, row, placement, env, state, extra = {}) {
  const regular = await processRegex(
    raw,
    row,
    { placement, phase: "regular", ...extra },
    env,
    state,
  );
  const [display, prompt] = await Promise.all([
    processRegex(
      regular.text,
      row,
      { placement, phase: "display", ...extra },
      env,
      state,
    ),
    processRegex(
      regular.text,
      row,
      { placement, phase: "prompt", ...extra },
      env,
      state,
    ),
  ]);
  return {
    rawText: raw,
    text: regular.text,
    displayText: display.text,
    promptText: prompt.text,
    warnings: [...regular.warnings, ...display.warnings, ...prompt.warnings],
  };
}
