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
  { label: '在控件间移动', keys: 'Tab' },
  { label: '返回上一个控件', keys: 'Shift + Tab' },
  { label: '关闭弹窗或分类', keys: 'Esc' },
  { label: '微调选中的字号滑块', keys: '← / →' },
  { label: '立即保存当前偏好', keys: 'Ctrl / ⌘ + S' }
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
      <div v-for="item in SHORTCUTS" :key="item.keys" class="shortcut">
        <span>{{ item.label }}</span>
        <kbd>{{ item.keys }}</kbd>
      </div>
      <p class="section-note">设置改动会自动保存；遇到保存失败时，也可手动重试。</p>
    </aside>

    <SettingsHelpDialog v-if="active === 'help'" @close="active = null" />
    <SettingsStatsDialog v-if="active === 'stats'" @close="active = null" />
  </div>
</template>
