<script setup>
/* 写作概览（总稿 app.mjs:61 showStats）。
 * 五项数值与数据页右栏同一份读数（settings-data-actions 的 loadLibrarySummary），
 * 所以「此设备上的内容」与「写作概览」永远说同一件事。 */
import { inject, onMounted, ref } from 'vue'
import { formatCount, loadLibrarySummary } from '../settings-data-actions.js'
import { SETTINGS_TOAST_KEY } from '../settings-toast.js'
import SettingsDialog from '../SettingsDialog.vue'

const emit = defineEmits(['close'])
const toast = inject(SETTINGS_TOAST_KEY, null)

const visible = ref(false)
const stats = ref({ works: 0, chapters: 0, words: 0, characters: 0, lore: 0, trash: 0 })

const ROWS = [
  { key: 'works', label: '作品', unit: '部' },
  { key: 'chapters', label: '章节', unit: '章' },
  { key: 'words', label: '正文字数', unit: '字', numeric: true },
  { key: 'characters', label: '人物', unit: '人' },
  { key: 'lore', label: '世界设定', unit: '条' }
]

function close() {
  visible.value = false
  setTimeout(() => emit('close'), 0)
}

function valueOf(row) {
  const value = stats.value[row.key] || 0
  return `${row.numeric ? formatCount(value) : value} ${row.unit}`
}

onMounted(async () => {
  visible.value = true
  try {
    stats.value = await loadLibrarySummary()
  } catch (err) {
    toast?.show(String(err?.message || err))
  }
})
</script>

<template>
  <SettingsDialog :open="visible" title="写作概览" @update:open="close">
    <dl class="stats-list">
      <div v-for="row in ROWS" :key="row.key">
        <dt>{{ row.label }}</dt>
        <dd>{{ valueOf(row) }}</dd>
      </div>
    </dl>
    <p class="dialog-note">按当前工作区内容统计，不包含回收站中的条目。</p>

    <template #footer>
      <button type="button" class="btn" data-act="dialog-close" @click="close">关闭</button>
    </template>
  </SettingsDialog>
</template>
