<script setup>
/* 正文实时预览（总稿 app.mjs:38 preview()）：字号与字体都读 store，写回也走 applyPref，
 * 所以它既能反映外观页的改动，也能在窄屏独立成屏时自己调（.preview-mode-buttons）。
 * 正文取当前作品首章的前三段纯文本；没有作品或空章时回落到总稿的演示文本，
 * 保证右侧永远有东西可看——预览空着就失去了「即时看到效果」的意义。 */
import { computed, inject, ref, watch } from 'vue'
import { useUiStore } from '../../stores/ui'
import { useWorkStore } from '../../stores/work'
import { stripTags } from '../../services/wordcount.js'
import { CJK_FONTS, LATIN_FONTS } from './settings-prefs.js'
import { SETTINGS_TOAST_KEY } from './settings-toast.js'

const FALLBACK_WORK = '长夜将明'
const FALLBACK_CHAPTER = '第一章 · 雾港的灯'
const FALLBACK_BODY = [
  '林照记得每一艘进港的船，却不记得父亲离开那夜的潮汐。',
  '黄昏时分，他照例擦拭灯塔的透镜。海面上的雾比往日更浓，远处的船鸣像是从另一个年代传来。'
]
const FALLBACK_LATIN = 'The light returns at three.'
const LOAD_SAMPLE = '林照记得每一艘进港的船'

const ui = useUiStore()
const work = useWorkStore()
const toast = inject(SETTINGS_TOAST_KEY, null)

const firstChapter = computed(() => work.liveChapters?.[0] || null)
const hasWork = computed(() => !!work.work?.id && !!firstChapter.value)
const runningTitle = computed(() => (hasWork.value ? work.work.title || FALLBACK_WORK : FALLBACK_WORK))
const runningIndex = computed(() => {
  if (!hasWork.value) return '01'
  return String(work.liveChapters.indexOf(firstChapter.value) + 1).padStart(2, '0')
})
const chapterTitle = computed(() => {
  if (!hasWork.value) return FALLBACK_CHAPTER
  const title = String(firstChapter.value.title || '').trim()
  return title || `第 ${Number(runningIndex.value)} 章`
})
const paragraphs = computed(() => {
  if (!hasWork.value) return FALLBACK_BODY
  const text = stripTags(String(firstChapter.value.content ?? ''))
  const rows = text.split(/\n+/).map((row) => row.trim()).filter(Boolean).slice(0, 3)
  return rows.length ? rows : FALLBACK_BODY
})

const cjkFont = computed(() => CJK_FONTS[ui.editorFont] || CJK_FONTS.song)
const latinFont = computed(() => LATIN_FONTS[ui.editorLatin] || LATIN_FONTS.none)
/* 西文栈在前：拉丁字符落到西文字形，汉字回落中文栈（与 stores/ui.js 的 --editor-font 同序） */
const previewFont = computed(() => [latinFont.value.stack, cjkFont.value.stack].filter(Boolean).join(', '))
const previewSize = computed(() => `${ui.fontSize}px`)
const fontName = computed(() => cjkFont.value.label + (ui.editorLatin !== 'none' ? ' / ' + latinFont.value.label : ''))
const sizeName = computed(() => `${ui.fontSize} px · 行高 1.95`)

/* ---------- 字体载入：切字体先报「正在载入」，落定后写回常态文案 ----------
 * token 防竞态：连点字体时只允许最后一次载入改写 caption，
 * 否则先发后到的载入会把结论写成旧字体的。 */
const caption = ref('随设置即时变化')
let fontToken = 0

async function loadFonts() {
  if (typeof document === 'undefined' || !document.fonts?.load) return
  const token = (fontToken += 1)
  caption.value = '正在载入字体…'
  const family = String(cjkFont.value.stack).split(',')[0].trim()
  const jobs = [document.fonts.load(`17px ${family}`, LOAD_SAMPLE)]
  if (latinFont.value.stack) jobs.push(document.fonts.load(`17px ${latinFont.value.stack}`, FALLBACK_LATIN))
  try {
    await Promise.all(jobs)
    if (token === fontToken) caption.value = '随设置即时变化'
  } catch {
    if (token !== fontToken) return
    caption.value = '随设置即时变化'
    toast?.show('字体暂未载入，已使用系统字形。')
  }
}

watch(() => [ui.editorFont, ui.editorLatin], loadFonts)

/* ---------- 字号：窄屏预览里直接调，边界与外观页一致 ---------- */
const MIN_SIZE = 13
const MAX_SIZE = 24
function stepSize(delta) {
  const next = Math.min(MAX_SIZE, Math.max(MIN_SIZE, Number(ui.fontSize) + delta))
  if (next !== ui.fontSize) ui.applyPref('fontSize', next)
}
function onPickFont(event) {
  ui.applyPref('editorFont', event.target.value)
}
</script>

<template>
  <aside class="preview-column" aria-label="正文实时预览">
    <div class="preview-label">
      <span>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 4h6a4 4 0 0 1 3 2 4 4 0 0 1 3-2h6v16h-6a4 4 0 0 0-3 2 4 4 0 0 0-3-2H3zM12 6v16" /></svg>
        正文预览
      </span>
      <small id="preview-caption">{{ caption }}</small>
    </div>

    <div class="preview-mode-buttons">
      <select id="preview-editor-font" class="select" data-pref="editorFont" aria-label="预览中文字体" :value="ui.editorFont" @change="onPickFont">
        <option v-for="(font, key) in CJK_FONTS" :key="key" :value="key">{{ font.label }}</option>
      </select>
      <div class="size-stepper">
        <button type="button" data-act="font-down" aria-label="减小预览字号" title="减小预览字号" :disabled="ui.fontSize <= MIN_SIZE" @click="stepSize(-1)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14" /></svg>
        </button>
        <output id="preview-mobile-size">{{ ui.fontSize }}<small>px</small></output>
        <button type="button" data-act="font-up" aria-label="增大预览字号" title="增大预览字号" :disabled="ui.fontSize >= MAX_SIZE" @click="stepSize(1)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
        </button>
      </div>
    </div>

    <div id="preview-window" class="preview-window" :class="{ 'is-hidden': ui.topbarAutoHide }">
      <div class="preview-chrome">
        <span>{{ runningTitle }}</span>
        <span>正文</span>
      </div>
      <article class="preview-paper">
        <div class="preview-running">
          <span>{{ runningTitle }}</span>
          <span>·</span>
          <span>{{ runningIndex }}</span>
        </div>
        <h3>{{ chapterTitle }}</h3>
        <div id="preview-copy" class="preview-copy" :style="{ '--preview-font': previewFont, '--preview-size': previewSize }">
          <p v-for="(line, index) in paragraphs" :key="index">{{ line }}</p>
          <p class="latin-line">{{ FALLBACK_LATIN }}</p>
        </div>
      </article>
    </div>

    <div class="preview-meta">
      <span id="preview-font-name">{{ fontName }}</span>
      <span id="preview-size-name">{{ sizeName }}</span>
    </div>
  </aside>
</template>
