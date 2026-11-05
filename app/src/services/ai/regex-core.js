import { expandMacros, copy } from "./presets.js";

export function escapeRegexMacro(value) {
  return String(value ?? "").replace(
    /[\n\r\t\v\f\0.^$*+?{}[\]\\/|()]/g,
    (s) =>
      ({
        "\n": "\\n",
        "\r": "\\r",
        "\t": "\\t",
        "\v": "\\v",
        "\f": "\\f",
        "\0": "\\0",
      })[s] || "\\" + s,
  );
}
export function regexFromString(value) {
  const match = String(value).match(/^\/([\s\S]*)\/([dgimsuvy]*)$/);
  return match ? new RegExp(match[1], match[2]) : new RegExp(value);
}
export function applies(
  rule,
  { placement, phase = "regular", depth, isEdit = false },
) {
  if (rule.disabled || !rule.findRegex || !rule.placement?.includes(placement))
    return false;
  if (isEdit && !rule.runOnEdit) return false;
  if (typeof depth === "number") {
    if (rule.minDepth != null && rule.minDepth >= -1 && depth < rule.minDepth)
      return false;
    if (rule.maxDepth != null && rule.maxDepth >= 0 && depth > rule.maxDepth)
      return false;
  }
  return (
    (phase === "display" && rule.markdownOnly) ||
    (phase === "prompt" && rule.promptOnly) ||
    (phase === "regular" && !rule.markdownOnly && !rule.promptOnly)
  );
}
export function runRule(
  rule,
  text,
  env = {},
  state = { local: {}, global: {} },
) {
  const vars = copy(state),
    warnings = [];
  const expand = (s, escape = false) => {
    if (!escape) return expandMacros(s, env, vars, { warnings });
    // Only substituted values are escaped; regex operators in the pattern remain operators.
    const escaped = Object.fromEntries(
      Object.entries(env).map(([k, v]) => [k, escapeRegexMacro(v)]),
    );
    const escapedVars = {
      local: Object.fromEntries(
        Object.entries(vars.local).map(([k, v]) => [k, escapeRegexMacro(v)]),
      ),
      global: Object.fromEntries(
        Object.entries(vars.global).map(([k, v]) => [k, escapeRegexMacro(v)]),
      ),
    };
    return expandMacros(s, escaped, escapedVars, { warnings });
  };
  const pattern =
    Number(rule.substituteRegex) === 1
      ? expand(rule.findRegex)
      : Number(rule.substituteRegex) === 2
        ? expand(rule.findRegex, true)
        : rule.findRegex;
  const regex = regexFromString(pattern);
  return text.replace(regex, (...args) => {
    const groups = typeof args.at(-1) === "object" ? args.at(-1) : {};
    const captures = args.slice(0, typeof args.at(-1) === "object" ? -3 : -2);
    const replacement = String(rule.replaceString || "")
      .replace(/\{\{match\}\}/gi, "$0")
      .replace(/\$(\d+)|\$<([^>]+)>/g, (_, number, name) => {
        let match = String(
          (number ? captures[Number(number)] : groups[name]) ?? "",
        );
        for (const trim of rule.trimStrings || [])
          match = match.replaceAll(expand(trim), "");
        return match;
      });
    return expand(replacement);
  });
}
export function runStage(
  { text, rules = [], context = {}, env = {}, state },
  progress = () => {},
) {
  let value = String(text || "");
  const trace = [];
  for (const [index, rule] of rules.entries()) {
    if (!applies(rule, context)) continue;
    progress({ index, name: rule.scriptName || rule.id || String(index + 1) });
    const before = value;
    value = runRule(rule, value, env, state);
    if (value.length > 1000000) throw new Error("正则处理结果超过100万字符");
    trace.push({
      index,
      name: rule.scriptName || rule.id,
      before,
      after: value,
    });
  }
  return { text: value, trace, warnings: [] };
}
