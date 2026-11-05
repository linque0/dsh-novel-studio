import { runMemoryQueue, cancelMemoryJobs, recoverMemoryQueue } from './memory-queue.js';
import { useAiStore } from "../../stores/ai";
import { useWorkStore } from "../../stores/work";
import { autosave } from "../autosave";
import { db } from "../../db/database";
import { installProjectionPipeline, queueProjection } from '../project/pipeline.js';
import { canExecuteCreativeHere } from './workbench-view.js';

let installed = false;
let timer = null;
const queue = new Map();
const isMain = () => !new URLSearchParams(location.search).has("panel");
export async function handleAiEvent({ kind, data }) {
  if(kind==='story-document-changed'&&data?.workId&&data?.chapterId){
    const {STORY_WINDOW_ORIGIN}=await import('../../db/story-repo.js');if(data.origin===STORY_WINDOW_ORIGIN)return;
    const {useStoryStore}=await import('../../stores/story.js');await useStoryStore().refreshDocument(data.workId,data.chapterId);return;
  }
  if(kind==='creative-workflow-changed'&&data?.workId){
    const {CREATIVE_WINDOW_ORIGIN}=await import('../../db/workflow-repo.js');if(data.origin===CREATIVE_WINDOW_ORIGIN)return;
    const {useCreativeWorkflowStore}=await import('../../stores/creative-workflow.js');const flow=useCreativeWorkflowStore();
    await flow.load(data.workId,data.runId);return;
  }
  if(kind==='creative-workflow-request'&&isMain()){
    const {useCreativeWorkflowStore}=await import('../../stores/creative-workflow.js');const flow=useCreativeWorkflowStore();
    if(useWorkStore().work?.id!==data?.workId)return;
    await flow.load(data.workId,data.runId);await flow.dispatch(data.action,data.index||0);return;
  }
  if(kind==='creative-workflow-pause'&&canExecuteCreativeHere(location.search)){
    const {useCreativeWorkflowStore}=await import('../../stores/creative-workflow.js');const flow=useCreativeWorkflowStore();
    if(flow.active?.id===data?.runId)flow.pause({remote:true});return;
  }
  if(kind==='memory-queue-changed'){window.dispatchEvent(new CustomEvent('memory-queue-changed',{detail:data}));return;}
  if (kind === 'memory-queue-ready' && isMain()) {
    const ai=useAiStore(); if(!ai.loaded)await ai.loadSettings();
    await runMemoryQueue(ai,data); return;
  }
  if (kind === 'ai-source-changed') cancelMemoryJobs(data?.workId);
  if (kind === 'book-source-changed') { await queueProjection(data?.workId); return; }
  const ai = useAiStore();
  if (kind === "ai-preview-request" && isMain()) {
    try {
      if (useWorkStore().work?.id !== data.request.workId)
        throw new Error("关联作品未在主窗口打开，请打开该作品后预览");
      const preview = await ai.previewPreset(data.row, data.question, {
        ...data.request,
        localPreview: true,
      });
      window.native?.appBroadcast({
        kind: "ai-preview-response",
        data: {
          requestId: data.requestId,
          preview: JSON.parse(JSON.stringify(preview)),
        },
      });
    } catch (error) {
      window.native?.appBroadcast({
        kind: "ai-preview-response",
        data: { requestId: data.requestId, error: error.message },
      });
    }
    return;
  }
  if (kind === "ai-presets-changed") {
    await ai.loadPresets();
    return;
  }
  if (kind === "ai-settings-changed") {
    const wasPrivate = ai.privacy;
    await ai.loadSettings();
    if (!wasPrivate && ai.privacy) {
      cancelMemoryJobs();
      ai.cancel();
      ai.pauseKnowledge();
    }
    return;
  }
  if (kind === "ai-kb-request" && isMain()) {
    if (data?.action === "pause") ai.pauseKnowledge();
    else if (data?.action === "vectors" && data.workId === ai.workId)
      await ai.embedKnowledge();
    else if (data?.workId) await ai.buildKnowledge(data);
    return;
  }
  if (kind === "kb-changed") {
    if (data?.workId === ai.workId) await ai.refreshKnowledge();
    return;
  }
  if (kind !== "ai-source-changed" || !data?.workId) return;
  const work = useWorkStore();
  if (
    work.work?.id === data.workId &&
    data.table &&
    data.origin !== autosave.origin &&
    !autosave.hasPending(data.table, data.id)
  ) {
    const row = await db.table(data.table).get(data.id);
    const current = data.table==='works'?work.work:work[data.table]?.find((r) => r.id === data.id);
    if (current && row) Object.assign(current, row);
    else if (row && Array.isArray(work[data.table])) work[data.table].push(row);
  }
  if (work.work?.id === data.workId) await ai.refreshKnowledge();
  if (!isMain()) return;
  const ids = queue.get(data.workId) || new Set();
  if (data.table === "chapters") ids.add(data.id);
  else if (data.workId === ai.workId) {
    if (data.table === "volumes")
      ai.kb.metas.forEach((m) => ids.add(m.chapterId));
    ai.kb.rows
      .filter((r) => r.refId === data.id)
      .forEach((r) => {
        if (r.chapterId) ids.add(r.chapterId);
      });
  }
  if (ids.size) queue.set(data.workId, ids);
  schedule();
}
function schedule() {
  clearTimeout(timer);
  timer = setTimeout(async () => {
    const ai = useAiStore();
    if (!ai.loaded) await ai.loadSettings();
    if (!ai.options.kb.auto || ai.privacy || !ai.ready) {
      queue.clear();
      return;
    }
    if (ai.busy || ai.kb.progress?.status === "running") {
      schedule();
      return;
    }
    const entry = queue.entries().next().value;
    if (!entry) return;
    queue.delete(entry[0]);
    await ai.buildKnowledge({
      workId: entry[0],
      onlyIds: [...entry[1]],
      auto: true,
    });
    if (queue.size) schedule();
  }, 5000);
}
export function installAiRuntime() {
  if (installed) return;
  installed = true;
  installProjectionPipeline();
  if(isMain()){recoverMemoryQueue().catch(console.error);setInterval(()=>recoverMemoryQueue().catch(console.error),30000);}
  window.addEventListener('memory-queue-ready',e=>{if(isMain())handleAiEvent({kind:'memory-queue-ready',data:e.detail}).catch(console.error)});
  window.addEventListener('memory-queue-cancel',()=>cancelMemoryJobs());
  window.addEventListener("ai-source-changed", (e) => {
    handleAiEvent({ kind: "ai-source-changed", data: e.detail }).catch(
      console.error,
    );
  });
  window.addEventListener("pagehide", () => {
    cancelMemoryJobs();
    if (isMain()) useAiStore().pauseKnowledge();
  });
}
