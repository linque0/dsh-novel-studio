<script setup>
/* 确认恢复备份（总稿 app.mjs:55,89 showRestore/restore-confirm）。
 *
 * 校验在打开之前就做完了（页面里的 pickBackupCandidate），这里只剩「让作者看清换掉什么，
 * 再亲手勾一次」。恢复序列照 appbus 的协议：先写撤销快照 → 广播 begin → 等一拍 →
 * 替换库 → 广播 restored → 重载；快照写不进 sessionStorage 时如实说明「恢复后无法撤销」，
 * 而不是给一个点了没反应的撤销按钮。 */
import { computed, inject, onMounted, ref } from 'vue'
import { applyBackupJson, formatStamp, writeRestoreSnapshot, RESTORE_UNDO_SKIPPED } from '../settings-data-actions.js'
import { SETTINGS_TOAST_KEY } from '../settings-toast.js'
import SettingsDialog from '../SettingsDialog.vue'

const props = defineProps({
  candidate: { type: Object, default: null }
})
const emit = defineEmits(['close'])

const toast = inject(SETTINGS_TOAST_KEY, null)

const visible = ref(false)
const agree = ref(false)
const busy = ref(false)
const error = ref('')

const library = computed(() => props.candidate?.library || { works: 0, chapters: 0, characters: 0, lore: 0 })
const createdAt = computed(() => formatStamp(props.candidate?.createdAt) || '未知时间')
const canConfirm = computed(() => agree.value && !busy.value)

function close() {
  visible.value = false
  setTimeout(() => emit('close'), 0)
}

function syncAgree(event) {
  agree.value = !!event.target.checked
}

async function confirm() {
  if (!canConfirm.value) return
  busy.value = true
  error.value = ''
  try {
    const snapshot = await writeRestoreSnapshot()
    /* 撤销能力只有 sessionStorage 里的快照算数（stores/ui.js 不归本棒改，也不该多一个会随重载丢失的状态）；
       快照写不进去（超 4MB 或配额）就如实说明恢复后无法撤销，而不是给一个点了没反应的撤销 */
    if (!snapshot.ok && snapshot.oversize) toast?.show(RESTORE_UNDO_SKIPPED)
    await applyBackupJson(props.candidate?.text)
  } catch (err) {
    error.value = String(err?.message || err)
    busy.value = false
  }
}

onMounted(() => {
  visible.value = true
})
</script>

<template>
  <SettingsDialog :open="visible" title="确认恢复备份" @update:open="close">
    <p>这份备份包含以下内容：</p>
    <div class="restore-summary">
      <div><span>作品</span><strong>{{ library.works }} 部</strong></div>
      <div><span>章节</span><strong>{{ library.chapters }} 章</strong></div>
      <div><span>人物</span><strong>{{ library.characters }} 人</strong></div>
      <div><span>设定</span><strong>{{ library.lore }} 条</strong></div>
    </div>
    <p class="dialog-note">备份创建于 {{ createdAt }}。恢复将替换当前作品数据及外观偏好。</p>
    <label class="confirm-line">
      <input id="restore-agree" type="checkbox" :checked="agree" @change="syncAgree" />
      <span>我已确认，用这份备份替换当前工作区。</span>
    </label>

    <template #footer>
      <button type="button" class="btn" data-act="dialog-close" @click="close">取消</button>
      <button type="button" class="btn danger" data-act="restore-confirm" :disabled="!canConfirm" @click="confirm">恢复备份</button>
    </template>
    <template #error>{{ error }}</template>
  </SettingsDialog>
</template>
