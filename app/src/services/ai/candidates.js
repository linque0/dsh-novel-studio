import { copy } from "./presets";
const FIELDS = [
  "content",
  "rawContent",
  "displayText",
  "promptText",
  "plainText",
  "reasoning",
  "cards",
  "source",
  "preset",
  "context",
  "complete",
  "finishReason",
  "rounds",
  "error",
  "runId",
  "toolOutput",
];
export function captureCandidate(message) {
  return copy(
    Object.fromEntries(
      FIELDS.filter((k) => message[k] !== undefined).map((k) => [
        k,
        message[k],
      ]),
    ),
  );
}
export function storeCandidate(message) {
  message.candidates ||= [];
  message.activeCandidate ||= 0;
  message.candidates[message.activeCandidate] = captureCandidate(message);
}
export function switchCandidate(message, index) {
  if (message.streaming) throw new Error("生成结束后可切换候选");
  if (!message.candidates?.[index]) throw new Error("候选不存在");
  storeCandidate(message);
  for (const key of FIELDS) delete message[key];
  Object.assign(message, copy(message.candidates[index]), {
    activeCandidate: index,
  });
}
