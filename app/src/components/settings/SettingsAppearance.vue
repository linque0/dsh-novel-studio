<script setup>
/* 外观页（总稿 app.mjs:39 appearance()）：两组设置 + 右侧预览。
 * 所有改动只走 ui.applyPref——它先写内存再落库，写库失败也保住当前选择（setPref 会 reject）。 */
import { computed } from 'vue'
import { useUiStore } from '../../stores/ui'
import {
  CJK_FONTS,
  LATIN_FONTS,
  UI_FONT_SCALE_MIN,
  UI_FONT_SCALE_MAX,
  UI_FONT_SCALE_STEP,
  UI_FONT_SCALE_PRESETS,
  normalizeUiFontScale
} from './settings-prefs.js'
import FlowSpeedSetting from './FlowSpeedSetting.vue'
import SettingsPreview from './SettingsPreview.vue'

const ui = useUiStore()
const uiScale = computed(() => normalizeUiFontScale(ui.uiFontScale))

function pick(key, value) {
  ui.applyPref(key, value)
}
function setScale(val) {
  const next = normalizeUiFontScale(val)
  if (next !== uiScale.value) ui.applyPref('uiFontScale', next)
}
function stepScale(delta) {
  setScale(uiScale.value + delta * UI_FONT_SCALE_STEP)
}
/* 滑杆与步进共用一条夹紧规则：85–140%（步进 5%），越界自动夹紧 */
function onScaleRange(event) {
  const raw = Number(event.target.value)
  if (!Number.isFinite(raw)) return
  setScale(raw)
}
function toggleTopbar() {
  ui.applyPref('topbarAutoHide', !ui.topbarAutoHide)
}
function togglePageTransitions() {
  ui.applyPref('pageTransitions', !ui.pageTransitions)
}
const isDarkTheme = computed(() => ui.panelTheme !== 'light')
function setPanelTheme(mode) {
  const target = mode === 'light' ? 'light' : 'dark'
  if (ui.panelTheme !== target) ui.applyPref('panelTheme', target)
}
function onThemeKeydown(event) {
  if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
    event.preventDefault()
    setPanelTheme('light')
  } else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
    event.preventDefault()
    setPanelTheme('dark')
  }
}
</script>

<template>
  <div class="appearance-layout">
    <div class="appearance-controls">
      <section class="setting-group">
        <div class="section-title">
          <h2>文字与排版</h2>
          <small>字体 · 界面缩放</small>
        </div>

        <div class="setting-row" data-setting="editorFont">
          <div class="setting-copy">
            <label for="editorFont">中文正文字体</label>
            <p>选择熟悉的中文字形</p>
          </div>
          <select id="editorFont" class="select" data-pref="editorFont" aria-label="中文正文字体" :value="ui.editorFont" @change="pick('editorFont', $event.target.value)">
            <option v-for="(font, key) in CJK_FONTS" :key="key" :value="key">{{ font.label }}</option>
          </select>
        </div>

        <div class="setting-row" data-setting="editorLatin">
          <div class="setting-copy">
            <label for="editorLatin">西文字体</label>
            <p>英文与数字的字形搭配</p>
          </div>
          <select id="editorLatin" class="select" data-pref="editorLatin" aria-label="西文字体" :value="ui.editorLatin" @change="pick('editorLatin', $event.target.value)">
            <option v-for="(font, key) in LATIN_FONTS" :key="key" :value="key">{{ font.label }}</option>
          </select>
        </div>

        <div class="setting-row font-size-setting ui-font-scale-setting" data-setting="uiFontScale">
          <div class="setting-copy">
            <label for="ui-font-scale-range">全局字体大小</label>
            <p>调整界面导航、目录、菜单与弹窗等全局文字大小（正文字号已移至正文工具栏）</p>
          </div>
          <div class="size-stepper">
            <button type="button" data-act="ui-scale-down" aria-label="减小全局字体大小" title="减小全局字体大小" :disabled="uiScale <= UI_FONT_SCALE_MIN" @click="stepScale(-1)">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14" /></svg>
            </button>
            <output id="ui-scale-value" for="ui-font-scale-range">{{ uiScale }}<small>%</small></output>
            <button type="button" data-act="ui-scale-up" aria-label="增大全局字体大小" title="增大全局字体大小" :disabled="uiScale >= UI_FONT_SCALE_MAX" @click="stepScale(1)">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
            </button>
          </div>
          <div class="scale-presets" role="group" aria-label="全局字体大小快捷档位">
            <button
              v-for="p in UI_FONT_SCALE_PRESETS"
              :key="p.key"
              type="button"
              class="scale-preset-btn"
              :class="{ active: uiScale === p.value }"
              :data-scale-preset="p.value"
              :aria-pressed="uiScale === p.value"
              @click="setScale(p.value)"
            ><span>{{ p.label }}</span><small>{{ p.value }}%</small></button>
          </div>
          <div class="size-range-row">
            <span>{{ UI_FONT_SCALE_MIN }}%</span>
            <input id="ui-font-scale-range" type="range" :min="UI_FONT_SCALE_MIN" :max="UI_FONT_SCALE_MAX" :step="UI_FONT_SCALE_STEP" aria-label="全局字体大小" :value="uiScale" @input="onScaleRange" />
            <span>{{ UI_FONT_SCALE_MAX }}%</span>
          </div>
        </div>
      </section>

      <section class="setting-group">
        <div class="section-title"><h2>流动背景</h2></div>
        <FlowSpeedSetting />
      </section>

      <section class="setting-group">
        <div class="section-title">
          <h2>写作空间</h2>
        </div>
        <div class="setting-row" data-setting="panelTheme">
          <div class="setting-copy">
            <strong id="panel-theme-label">主题切换</strong>
            <p>在浅色与深色面板之间切换，流动背景继续使用当前配色</p>
          </div>
          <div
            id="panel-theme"
            class="theme-segmented"
            role="radiogroup"
            aria-labelledby="panel-theme-label"
            :data-theme-value="isDarkTheme ? 'dark' : 'light'"
            @keydown="onThemeKeydown"
          >
            <span class="theme-segmented-thumb" aria-hidden="true"></span>
            <button
              type="button"
              class="theme-segmented-opt"
              role="radio"
              data-theme-opt="light"
              :aria-checked="!isDarkTheme"
              :tabindex="!isDarkTheme ? 0 : -1"
              @click="setPanelTheme('light')"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
              </svg>
              <span>浅色</span>
            </button>
            <button
              type="button"
              class="theme-segmented-opt"
              role="radio"
              data-theme-opt="dark"
              :aria-checked="isDarkTheme"
              :tabindex="isDarkTheme ? 0 : -1"
              @click="setPanelTheme('dark')"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
              <span>深色</span>
            </button>
          </div>
        </div>
        <div class="setting-row" data-setting="topbarAutoHide">
          <div class="setting-copy">
            <strong id="topbar-label">默认隐藏顶栏</strong>
            <p>移至顶部展开，可随时固定</p>
          </div>
          <button type="button" class="switch" id="topbar-switch" role="switch" aria-labelledby="topbar-label" :aria-checked="ui.topbarAutoHide" data-act="toggle-topbar" @click="toggleTopbar">
            <i></i>
          </button>
        </div>
        <div class="setting-row" data-setting="pageTransitions">
          <div class="setting-copy">
            <strong id="transitions-label">界面切换动画</strong>
            <p>关闭后书架与创作模块间将瞬时切换，不影响背景流动速度</p>
          </div>
          <button type="button" class="switch" id="transitions-switch" role="switch" aria-labelledby="transitions-label" :aria-checked="ui.pageTransitions" data-act="toggle-transitions" @click="togglePageTransitions">
            <i></i>
          </button>
        </div>
        <p class="section-note">全局字体大小调整界面各处文字；正文字号可在正文工具栏随时调节，不改变已有正文内容。</p>
      </section>
    </div>

    <SettingsPreview />
  </div>
</template>
