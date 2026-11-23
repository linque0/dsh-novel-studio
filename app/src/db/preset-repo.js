/**
 * AI 提示词预设（aipresets）与作品/全局宏状态（aipresetstate）持久化仓。
 * 通过乐观锁 revision 字段拦截跨窗口并发覆盖写。
 */
import { db } from "./database";
import {
  copy,
  defaultPreset,
  validatePreset,
  normalizePreset,
} from "../services/ai/presets";

/** 列出全部预设并归一化格式，若库中尚未持久化默认预设则补充兜底项。 */
export async function listPresets() {
  const rows = await db.aipresets.toArray();
  return (
    rows.some((r) => r.id === "novel-default")
      ? rows
      : [defaultPreset(), ...rows]
  ).map(normalizePreset);
}
/** 校验并保存预设（revision 乐观锁），可选同步激活到指定作品。 */
export async function savePreset(row, activateWorkId = null) {
  validatePreset(row);
  return db.transaction("rw", db.aipresets, db.aipresetstate, async () => {
    const previous = await db.aipresets.get(row.id);
    if (previous && previous.revision !== row.revision)
      throw new Error("预设已在另一窗口更新，请重新载入");
    const saved = {
      ...copy(row),
      formatVersion: 2,
      revision: (previous?.revision || row.revision || 0) + 1,
      updatedAt: Date.now(),
    };
    await db.aipresets.put(saved);
    if (activateWorkId) {
      const state = await presetState(activateWorkId);
      await db.aipresetstate.put({
        ...state,
        presetId: saved.id,
        revision: state.revision + 1,
        updatedAt: Date.now(),
      });
    }
    return saved;
  });
}
export async function deletePreset(id) {
  if (id === "novel-default") throw new Error("默认预设不能删除，可复制后编辑");
  await db.aipresets.delete(id);
}
export async function presetState(workId) {
  return (
    (await db.aipresetstate.get(workId)) || {
      id: workId,
      workId,
      presetId: "novel-default",
      local: {},
      revision: 0,
    }
  );
}
export async function globalState() {
  return (
    (await db.aipresetstate.get("__global__")) || {
      id: "__global__",
      global: {},
      revision: 0,
    }
  );
}
/** 原子提交单轮对话产出的作品级/全局级宏变量状态，以 revision 校验并发一致。 */
export async function commitState(local, global) {
  return db.transaction("rw", db.aipresetstate, async () => {
    for (const row of [local, global].filter(Boolean)) {
      const old = await db.aipresetstate.get(row.id);
      if ((old?.revision || 0) !== row.revision)
        throw new Error("宏状态已在另一窗口变化，请重试本轮对话");
    }
    for (const row of [local, global].filter(Boolean))
      await db.aipresetstate.put({
        ...copy(row),
        revision: row.revision + 1,
        updatedAt: Date.now(),
      });
  });
}
