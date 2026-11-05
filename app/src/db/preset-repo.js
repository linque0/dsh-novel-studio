import { db } from "./database";
import {
  copy,
  defaultPreset,
  validatePreset,
  normalizePreset,
} from "../services/ai/presets";

export async function listPresets() {
  const rows = await db.aipresets.toArray();
  return (
    rows.some((r) => r.id === "novel-default")
      ? rows
      : [defaultPreset(), ...rows]
  ).map(normalizePreset);
}
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
