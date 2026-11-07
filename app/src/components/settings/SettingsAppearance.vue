<script setup>
/* 外观页（总稿 app.mjs:39 appearance()）：两组设置 + 右侧预览。
 * 所有改动只走 ui.applyPref——它先写内存再落库，写库失败也保住当前选择（setPref 会 reject）。 */
import { useUiStore } from '../../stores/ui'
import { CJK_FONTS, LATIN_FONTS } from './settings-prefs.js'
import SettingsPreview from './SettingsPreview.vue'

const ui = useUiStore()
const MIN_SIZE = 13
const MAX_SIZE = 24

function pick(key, value) {
  ui.applyPref(key, value)
}
function stepSize(delta) {
  const next = Math.min(MAX_SIZE, Math.max(MIN_SIZE, Number(ui.fontSize) + delta))
  if (next !== ui.fontSize) ui.applyPref('fontSize', next)
}
/* 滑杆与步进共用一条夹紧规则：13–24 取整，越界不写库 */
function onRange(event) {
  const raw = Math.round(Number(event.target.value))
  if (!Number.isFinite(raw)) return
  ui.applyPref('fontSize', Math.min(MAX_SIZE, Math.max(MIN_SIZE, raw)))
}
function toggleTopbar() {
  ui.applyPref('topbarAutoHide', !ui.topbarAutoHide)
}
</script>

<template>
  <div class="appearance-layout">
    <div class="appearance-controls">
      <section class="setting-group">
        <div class="section-title">
          <h2>文字与排版</h2>
          <small>正文编辑 · 阅读</small>
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

        <div class="setting-row font-size-setting" data-setting="fontSize">
          <div class="setting-copy">
            <label for="font-size-range">正文字号</label>
            <p>调整正文编辑与阅读的大小</p>
          </div>
          <div class="size-stepper">
            <button type="button" data-act="font-down" aria-label="减小字号" title="减小字号" :disabled="ui.fontSize <= MIN_SIZE" @click="stepSize(-1)">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14" /></svg>
            </button>
            <output id="size-value" for="font-size-range">{{ ui.fontSize }}<small>px</small></output>
            <button type="button" data-act="font-up" aria-label="增大字号" title="增大字号" :disabled="ui.fontSize >= MAX_SIZE" @click="stepSize(1)">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
            </button>
          </div>
          <div class="size-range-row">
            <span>13</span>
            <input id="font-size-range" type="range" min="13" max="24" step="1" aria-label="正文字号" :value="ui.fontSize" @input="onRange" />
            <span>24</span>
          </div>
        </div>
      </section>

      <section class="setting-group">
        <div class="section-title">
          <h2>写作空间</h2>
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
        <p class="section-note">字体与字号只调整文字的呈现，不改变已有正文内容。</p>
      </section>
    </div>

    <SettingsPreview />
  </div>
</template>
