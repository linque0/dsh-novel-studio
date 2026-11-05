<script setup>
import { computed } from 'vue'
import { NModal, NTabs, NTabPane, NButton, NEmpty, NPopconfirm } from 'naive-ui'
import { useWorkStore } from '../stores/work'
import { useUiStore } from '../stores/ui'

const work = useWorkStore()
const ui = useUiStore()

const items = computed(() => work.recycleItems())
const total = computed(
  () => items.value.chapters.length + items.value.characters.length + items.value.mubu.length + items.value.snippets.length
)
const fmt = (t) => new Date(t).toLocaleString('zh-CN')
</script>

<template>
  <NModal v-model:show="ui.trashOpen" preset="card" title="回收站" style="width: 640px">
    <NEmpty v-if="!total" description="回收站是空的" style="margin: 30px 0" />
    <NTabs v-else type="line" size="small">
      <NTabPane :name="'ch'" :tab="`正文 (${items.chapters.length})`">
        <div v-for="c in items.chapters" :key="c.id" class="trash-row">
          <span style="flex: 1">{{ c.title }} <span class="dim">{{ fmt(c.deletedAt) }}</span></span>
          <NButton size="tiny" @click="work.restoreItem('chapters', c)">恢复</NButton>
          <NPopconfirm @positive-click="work.purgeItem('chapters', c)">
            <template #trigger><NButton size="tiny" quaternary type="error">彻底删除</NButton></template>
            彻底删除后无法恢复，确定？
          </NPopconfirm>
        </div>
      </NTabPane>
      <NTabPane :name="'chars'" :tab="`人物 (${items.characters.length})`">
        <div v-for="c in items.characters" :key="c.id" class="trash-row">
          <span style="flex: 1">{{ c.name }} <span class="dim">{{ fmt(c.deletedAt) }}</span></span>
          <NButton size="tiny" @click="work.restoreItem('characters', c)">恢复</NButton>
          <NPopconfirm @positive-click="work.purgeItem('characters', c)">
            <template #trigger><NButton size="tiny" quaternary type="error">彻底删除</NButton></template>
            彻底删除后无法恢复，确定？
          </NPopconfirm>
        </div>
      </NTabPane>
      <NTabPane :name="'lore'" :tab="`设定 (${items.mubu.length})`">
        <div v-for="n in items.mubu" :key="n.id" class="trash-row">
          <span style="flex: 1">{{ (n.text || '（空）').slice(0, 24) }} <span class="dim">{{ fmt(n.deletedAt) }}</span></span>
          <NButton size="tiny" @click="work.mubuRestore(n.id)">恢复</NButton>
          <NPopconfirm @positive-click="work.mubuPurge(n.id)">
            <template #trigger><NButton size="tiny" quaternary type="error">彻底删除</NButton></template>
            彻底删除（含其子节点）后无法恢复，确定？
          </NPopconfirm>
        </div>
      </NTabPane>
      <NTabPane :name="'sn'" :tab="`灵感 (${items.snippets.length})`">
        <div v-for="s in items.snippets" :key="s.id" class="trash-row">
          <span style="flex: 1">{{ (s.content || '').slice(0, 20) }} <span class="dim">{{ fmt(s.deletedAt) }}</span></span>
          <NButton size="tiny" @click="work.restoreItem('snippets', s)">恢复</NButton>
          <NPopconfirm @positive-click="work.purgeItem('snippets', s)">
            <template #trigger><NButton size="tiny" quaternary type="error">彻底删除</NButton></template>
            彻底删除后无法恢复，确定？
          </NPopconfirm>
        </div>
      </NTabPane>
    </NTabs>
  </NModal>
</template>

<style scoped>
.trash-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 4px;
  border-bottom: 1px solid var(--border);
  font-size: 13px;
}
.trash-row .dim {
  color: var(--text-dim);
  font-size: 11px;
  margin-left: 8px;
}
</style>
