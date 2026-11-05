<script setup>
import { ref, watch } from 'vue'
import { NModal, NButton, NEmpty } from 'naive-ui'
import { useWorkStore } from '../stores/work'
import { useUiStore } from '../stores/ui'

const work = useWorkStore()
const ui = useUiStore()
const revs = ref([])

watch(
  () => ui.revisionsCtx,
  async (ctx) => {
    if (ctx) revs.value = await work.revisionsFor(ctx.id)
  }
)

function fmt(t) {
  return new Date(t).toLocaleString('zh-CN')
}
const preview = (c) => {
  const t = (c || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ')
  return t.slice(0, 60)
}

async function rollback(rev) {
  await work.rollbackChapter(ui.revisionsCtx.id, rev.id)
  window.$msg?.success('已回滚到所选版本')
  ui.revisionsCtx = null
}
</script>

<template>
  <NModal
    :show="!!ui.revisionsCtx"
    preset="card"
    :title="`版本历史 · ${ui.revisionsCtx?.title || ''}`"
    style="width: 600px"
    @update:show="(v) => !v && (ui.revisionsCtx = null)"
  >
    <div style="max-height: 420px; overflow: auto">
      <div
        v-for="r in revs"
        :key="r.id"
        style="display: flex; align-items: center; gap: 10px; padding: 8px 6px; border-bottom: 1px solid var(--border)"
      >
        <div style="flex: 1; min-width: 0">
          <div style="font-size: 12px; color: var(--text-dim)">{{ fmt(r.createdAt) }}</div>
          <div style="font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap">
            {{ preview(r.content) || '（空白）' }}
          </div>
        </div>
        <NButton size="tiny" @click="rollback(r)">回滚到此版本</NButton>
      </div>
      <NEmpty v-if="!revs.length" description="暂无快照 —— 编辑内容并等待自动保存后，会按策略生成版本快照" style="margin: 26px 0" />
    </div>
  </NModal>
</template>
