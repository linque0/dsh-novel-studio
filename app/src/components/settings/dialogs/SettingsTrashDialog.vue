<script setup>
/* 回收站（总稿 app.mjs:56-59,90-95 trashBody/showTrash）。
 *
 * 列表读全库软删条目：右栏写的是「此设备上的内容 N 项」，弹窗里的「全部 N」必须是同一个数，
 * 否则作者会以为还有条目没显示。还原/彻底删除仍走 work store 的既有动作（不直连 IndexedDB）。
 * 彻底删除的二次确认由页面换成另一个弹窗（openDialog 的语义就是替换），这里只上报请求。 */
import { computed, inject, onMounted, ref } from 'vue'
import { useWorkStore } from '../../../stores/work'
import { kindLabel, loadTrash, purgeTrashRow, restoreTrashRow, TRASH_KINDS, formatStamp } from '../settings-data-actions.js'
import { SETTINGS_TOAST_KEY } from '../settings-toast.js'
import SettingsDialog from '../SettingsDialog.vue'

const props = defineProps({
  filter: { type: String, default: 'all' }
})
const emit = defineEmits(['close', 'changed', 'purge', 'update:filter'])

const work = useWorkStore()
const toast = inject(SETTINGS_TOAST_KEY, null)

const visible = ref(false)
const rows = ref([])
const counts = ref({ all: 0 })
const error = ref('')

const tabs = computed(() => {
  const list = [{ kind: 'all', label: '全部', count: counts.value.all || 0 }]
  for (const item of TRASH_KINDS) {
    const count = counts.value[item.kind] || 0
    if (count > 0) list.push({ kind: item.kind, label: item.label, count })
  }
  return list
})
const filtered = computed(() => (props.filter === 'all' ? rows.value : rows.value.filter((row) => row.kind === props.filter)))

function close() {
  visible.value = false
  setTimeout(() => emit('close'), 0)
}

async function reload() {
  const data = await loadTrash()
  rows.value = data.rows
  counts.value = data.counts
  /* 筛掉的这一类被清空后回到「全部」，否则会停在一张空页上 */
  if (props.filter !== 'all' && !data.counts[props.filter]) emit('update:filter', 'all')
}

function pick(kind) {
  emit('update:filter', kind)
}

function stamp(row) {
  const text = formatStamp(row.deletedAt)
  return text ? `${kindLabel(row.kind)} · ${text}` : kindLabel(row.kind)
}

async function restore(row) {
  error.value = ''
  try {
    const name = await restoreTrashRow(work, row)
    await reload()
    toast?.show(`已恢复「${name}」。`)
    emit('changed')
  } catch (err) {
    error.value = String(err?.message || err)
  }
}

function requestPurge(row) {
  emit('purge', row)
  visible.value = false
}

onMounted(async () => {
  visible.value = true
  await reload()
})
</script>

<template>
  <SettingsDialog :open="visible" title="回收站" wide @update:open="close">
    <div class="trash-tabs" role="group" aria-label="按内容筛选回收站">
      <button
        v-for="tab in tabs"
        :key="tab.kind"
        type="button"
        data-act="trash-filter"
        :data-kind="tab.kind"
        :class="{ on: props.filter === tab.kind }"
        @click="pick(tab.kind)"
      >
        {{ tab.label }} {{ tab.count }}
      </button>
    </div>

    <div>
      <div v-for="row in filtered" :key="row.id" class="trash-row">
        <div>
          <strong>{{ row.name }}</strong>
          <small>{{ stamp(row) }}</small>
        </div>
        <button type="button" class="btn small" data-act="trash-restore" :data-id="row.id" @click="restore(row)">恢复</button>
        <button type="button" class="btn soft small" data-act="trash-purge" :data-id="row.id" @click="requestPurge(row)">彻底删除</button>
      </div>
      <div v-if="!filtered.length" class="empty">
        <h2>回收站是空的</h2>
        <p>删除的条目会先保留在这里。</p>
      </div>
    </div>

    <template #footer>
      <button type="button" class="btn" data-act="dialog-close" @click="close">完成</button>
    </template>
    <template #error>{{ error }}</template>
  </SettingsDialog>
</template>
