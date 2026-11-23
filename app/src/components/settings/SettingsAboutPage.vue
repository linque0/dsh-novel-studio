<!--
  SettingsAboutPage.vue — 设置中心「关于与快捷键」页（版本号、更新检查、帮助与数据概览弹窗入口）。
-->
<script setup>
/* 关于页（总稿 app.mjs:30 aboutPage）。
 * 版本号取自构建注入的 __NS_VERSION__（settings-version.js），不手抄；右侧键盘面板把
 * 外壳真实接管的四个按键写出来（Tab/Shift+Tab/Esc/←→/Ctrl+S 都是已实现的行为）。
 * 两行动作开的是设置页自己的弹窗，不跳去桌面版才会用的整窗帮助。 */
import { ref } from 'vue'
import { APP_VERSION } from './settings-version.js'
import { SETTINGS_CATALOG } from './settings-catalog.js'
import SettingsHelpDialog from './dialogs/SettingsHelpDialog.vue'
import SettingsStatsDialog from './dialogs/SettingsStatsDialog.vue'

const descOf = (id) => SETTINGS_CATALOG.find((item) => item.id === id)?.desc || ''

const active = ref(null)

const SHORTCUTS = [
  { title: '书架与查找', items: [
    ['切换书架选中的作品', '← / →'],
    ['打开选中的作品', 'Enter'],
    ['作品内搜索正文与资料', 'Ctrl + Shift + F']
  ] },
  { title: '正文写作', items: [
    ['立即保存正文', 'Ctrl + S'],
    ['撤销 / 重做正文编辑', 'Ctrl + Z / Y'],
    ['加粗选中文字', 'Ctrl + B']
  ] },
  { title: '大纲画布', items: [
    ['搜索并定位节点', 'Ctrl + K'],
    ['移动选中节点', '方向键'],
    ['加大移动步长', 'Shift + 方向键'],
    ['删除选中节点或连线', 'Delete'],
    ['撤销 / 重做画布操作', 'Ctrl + Z / Y']
  ] },
  { title: '设置与导航', items: [
    ['立即保存设置偏好', 'Ctrl + S'],
    ['跳转下一个 / 上一个控件', 'Tab / Shift + Tab'],
    ['微调有焦点的滑块', '← / →'],
    ['退出弹窗或设置', 'Esc']
  ] }
]
</script>

<template>
  <div class="about-layout">
    <div>
      <section data-setting="version">
        <div class="about-brand">
          <span class="about-mark" aria-hidden="true">工</span>
          <div>
            <h2>小说工坊</h2>
            <p>DSH 插件版 · v{{ APP_VERSION }}</p>
          </div>
        </div>
        <p class="about-intro">面向长篇创作的本地写作空间。<br />让正文、大纲、设定与人物在同一部作品中相连。</p>
        <a class="project-repository" href="https://github.com/linque0/dsh-novel-studio" target="_blank" rel="noopener noreferrer">
          <span><strong>项目仓库</strong><small>github.com/linque0/dsh-novel-studio</small></span>
          <span class="repo-mark" aria-hidden="true">↗</span>
        </a>
      </section>

      <section class="action-group">
        <div class="action-row" data-setting="help">
          <svg class="icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 4h6a4 4 0 0 1 3 2 4 4 0 0 1 3-2h6v16h-6a4 4 0 0 0-3 2 4 4 0 0 0-3-2H3zM12 6v16" /></svg>
          <div>
            <strong>帮助与快捷键</strong>
            <p>从常用操作开始，让工坊更顺手</p>
          </div>
          <button type="button" class="btn" data-act="help" aria-label="帮助与快捷键" @click="active = 'help'"><span>打开手册</span></button>
        </div>
        <div class="action-row" data-setting="stats">
          <svg class="icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="3" width="16" height="18" rx="3" /><path d="M8 8h8M8 12h8M8 16h5" /></svg>
          <div>
            <strong>写作概览</strong>
            <p>查看当前作品、章节与正文规模</p>
          </div>
          <button type="button" class="btn" data-act="stats" aria-label="写作概览" @click="active = 'stats'"><span>查看</span></button>
        </div>
      </section>

      <p class="about-summary">更换设备前，可在「备份与数据」中生成一份完整快照。</p>
    </div>

    <aside class="keyboard-panel">
      <h3>手边的快捷键</h3>
      <section v-for="group in SHORTCUTS" :key="group.title" class="shortcut-group">
        <h4>{{ group.title }}</h4>
        <div v-for="[label, keys] in group.items" :key="label" class="shortcut">
          <span>{{ label }}</span>
          <kbd>{{ keys }}</kbd>
        </div>
      </section>
      <p class="section-note">设置改动会自动保存；遇到保存失败时，也可手动重试。</p>
    </aside>

    <SettingsHelpDialog v-if="active === 'help'" @close="active = null" />
    <SettingsStatsDialog v-if="active === 'stats'" @close="active = null" />
  </div>
</template>

<style scoped>
.shortcut-group { padding: 10px 0 12px; border-top: 1px solid var(--set-line, #ffffff20); }
.shortcut-group h4 { margin: 0 0 4px; font-size: 12px; font-weight: 700; color: var(--set-ink, currentColor); }
.keyboard-panel .shortcut-group .shortcut { padding: 6px 0; }
.shortcut-group kbd { flex-shrink: 0; }
.about-layout .project-repository { display: flex; align-items: center; gap: 10px; padding: 11px 13px; border: 1px solid #a0cfff35; border-radius: 10px; background: rgb(13 25 44 / .40); color: #a9d9ff; text-decoration: none; overflow-wrap: anywhere; }
.about-layout .project-repository:hover { border-color: #a9d9ff90; background: rgb(13 25 44 / .62); }
.about-layout .project-repository strong, .project-repository small { display: block; }
.about-layout .project-repository small { font-size: 11px; line-height: 1.4; }
.about-layout .project-repository .repo-mark { margin-left: auto; flex: none; }
</style>
