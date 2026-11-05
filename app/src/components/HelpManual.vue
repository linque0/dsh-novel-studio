<!-- 帮助 · 使用手册（v1.0.7 内置）：docs/使用手册.md 以 ?raw 导入 + marked 渲染，
     顶栏「帮助」按钮打开，可滚动阅读，随构建更新（手册即源码，永不失同步） -->
<script setup>
import { computed } from 'vue'
import { NModal, NButton } from 'naive-ui'
import { useUiStore } from '../stores/ui'
import { marked } from 'marked'
import manual from '../../docs/使用手册.md?raw'

const ui = useUiStore()
const html = computed(() => marked.parse(manual, { async: false }))
</script>

<template>
  <NModal :show="ui.helpOpen" preset="card" class="help-modal" style="width: 780px; max-width: 92vw" @update:show="(v) => (ui.helpOpen = v)">
    <template #header>
      <div class="m-head">
        <span class="cn">使用手册</span>
        <span class="en">Manual&nbsp;·&nbsp;Novel&nbsp;Studio</span>
      </div>
    </template>
    <div class="help-body" v-html="html"></div>
    <template #footer>
      <div class="m-foot">
        <span class="colophon">小说工坊 · 本地优先 · 手册与源码同源打包</span>
        <NButton size="small" @click="ui.helpOpen = false">关闭</NButton>
      </div>
    </template>
  </NModal>
</template>

<style scoped>
/* 面板头：衬线中文 + Playfair 微标 + 双细线（书版式扉页感） */
.m-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding-bottom: 2px;
}
.m-head .cn { font-family: var(--g-serif); font-size: 16px; font-weight: 700; color: var(--ikb); }
.m-head .en { font-family: var(--g-disp); font-size: 8px; letter-spacing: 0.26em; color: var(--text-dim); text-transform: uppercase; font-weight: 600; }
/* 面板脚：左版本 colophon + 右关闭 */
.m-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
}
.m-foot .colophon {
  font-family: var(--g-serif);
  font-size: 10px;
  letter-spacing: 0.14em;
  color: var(--text-faint);
}
.help-body {
  max-height: 68vh;
  overflow: auto;
  padding: 4px 10px 8px;
  font-family: var(--g-serif);
  font-size: var(--fs-md);
  line-height: 1.85;
  color: var(--text);
}
.help-body :deep(h1) {
  font-size: 19px;
  margin: 4px 0 12px;
  color: var(--ikb);
  letter-spacing: 0.04em;
}
.help-body :deep(h2) {
  font-size: 15.5px;
  margin: 20px 0 8px;
  padding-bottom: 4px;
  border-bottom: 1px solid var(--border);
  color: var(--text);
}
.help-body :deep(h3) {
  font-size: 14px;
  margin: 14px 0 6px;
}
.help-body :deep(table) {
  border-collapse: collapse;
  width: 100%;
  margin: 8px 0;
  font-size: var(--fs-sm);
}
.help-body :deep(th),
.help-body :deep(td) {
  border: 1px solid var(--border);
  padding: 5px 10px;
  text-align: left;
}
.help-body :deep(th) {
  background: var(--accent-soft);
  font-weight: 600;
}
.help-body :deep(code) {
  background: var(--bg-hover);
  border-radius: 4px;
  padding: 1px 5px;
  font-size: 12px;
  font-family: Consolas, monospace;
}
.help-body :deep(blockquote) {
  border-left: 3px solid var(--ikb);
  margin: 8px 0;
  padding: 2px 12px;
  color: var(--text-dim);
  background: var(--accent-soft);
  border-radius: 0 6px 6px 0;
}
.help-body :deep(hr) {
  border: none;
  border-top: 1px solid var(--border);
  margin: 14px 0;
}
</style>

<!-- NModal 的 class 落在 .n-card 自身上（teleport 到 body，scoped 选不中）：
     非 scoped 纸感底板 + IKB 顶规；主题变量经 App.vue 的 body 镜像继承 -->
<style>
.help-modal.n-card {
  background: var(--bg-panel);
  border: 1px solid var(--border-strong);
  border-top: 2px solid var(--ikb);
  box-shadow: 0 14px 40px rgba(30, 30, 30, 0.2);
}
.help-modal .n-card__content,
.help-modal .n-card__footer,
.help-modal .n-card-header {
  background: transparent;
}
</style>
