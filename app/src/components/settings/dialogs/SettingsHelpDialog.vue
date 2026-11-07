<script setup>
/* 帮助与快捷键（总稿 app.mjs:60 showHelp）：三段说明 + 4 枚 kbd，文案逐字照总稿。
 * 说明里写的就是设置页真实的入口（外观页的字体/字号、数据页的备份与恢复），
 * 不引入工坊里不存在的操作。 */
import { onMounted, ref } from 'vue'
import SettingsDialog from '../SettingsDialog.vue'

const emit = defineEmits(['close'])

const visible = ref(false)

function close() {
  visible.value = false
  setTimeout(() => emit('close'), 0)
}

onMounted(() => {
  visible.value = true
})
</script>

<template>
  <SettingsDialog :open="visible" title="帮助与快捷键" @update:open="close">
    <div class="help-copy">
      <h3>让文字按你的习惯呈现</h3>
      <p>在「外观与排版」选择中文和西文字体，拖动字号滑块。右侧正文随之变化；小窗口可点「排版预览」查看。</p>
      <h3>妥善保管作品</h3>
      <p>备份会生成包含作品和偏好的完整文件。恢复前会先列出内容规模，确认之后才替换当前工作区。</p>
      <h3>使用键盘</h3>
      <p><kbd>Tab</kbd> 在控件间移动，<kbd>Esc</kbd> 关闭弹窗。选中字号滑块后用 <kbd>← / →</kbd> 微调，<kbd>Ctrl / ⌘ + S</kbd> 可立即保存当前偏好。</p>
    </div>

    <template #footer>
      <button type="button" class="btn" data-act="dialog-close" @click="close">知道了</button>
    </template>
  </SettingsDialog>
</template>
