<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { liveQuery } from 'dexie'
import { NDropdown } from 'naive-ui'
import AppTopbar from './AppTopbar.vue'
import { db } from '../db/database'
import { resumeChapterOf } from '../db/repo'
import { formatShelfOpenTime } from '../services/shelf-sort'
import { createCoverPainter, latentContexts } from '../services/latent/latent-gl.js'
import { accentOf, cssGradientOf, hashString, paletteOf } from '../services/latent/palette.js'
import { mountFlowBackdrop } from '../services/latent/flow.js'

const props = defineProps({
  works: { type: Array, default: () => [] },
  total: { type: Number, default: 0 },
  loading: Boolean,
  busy: Boolean,
  query: { type: String, default: '' },
  openStats: { type: Object, default: () => ({}) },
  firstChapter: { type: Object, default: null },
  menuOptions: { type: Function, default: () => [] }
})
const emit = defineEmits(['update:query', 'select-work', 'open', 'menu', 'create', 'settings', 'navigate'])

/* 创作状态筛选只收窄本地列表：props.works 的顺序归父组件所有；配色只跟 work.id 走，
   所以同一本书过滤前后拿到同一个色板，聚焦键也不会因为列表换序而飘。 */
const STATUSES = ['全部', '连载', '完结', '构思', '搁置']
const status = ref('全部')
const filterOptions = STATUSES.map((item) => ({ label: item, key: item }))
const list = computed(() => (status.value === '全部' ? props.works : props.works.filter((w) => w.status === status.value)))

const focusId = ref(null)
const focusIndex = computed(() => {
  const index = list.value.findIndex((w) => w.id === focusId.value)
  return index < 0 ? 0 : index
})
const focused = computed(() => list.value[focusIndex.value] || null)

/* 删除聚焦作品后落到原索引的邻居：用上一轮 id 序列算位置，不看 DOM 顺序。
   prev 里 focusId 已消失，ids 在同一位置是它后面那本；越界退回前一本，再退第一张。 */
watch(() => list.value.map((w) => w.id), (ids, prev) => {
  if (!ids.length) { focusId.value = null; return }
  if (ids.includes(focusId.value)) return
  const at = prev ? prev.indexOf(focusId.value) : -1
  focusId.value = ids[Math.min(Math.max(at, 0), ids.length - 1)] || ids[0]
}, { immediate: true })

/* 三档步进与 CSS 的 --ls-card-w 同源：卡上只写 --x，位移量由这里给。 */
const viewWidth = ref(typeof window === 'undefined' ? 1280 : window.innerWidth)
const step = computed(() => (viewWidth.value < 560 ? 150 : viewWidth.value < 900 ? 196 : 248))

function wrapDistance(index, focus, total) {
  const raw = index - focus
  if (total <= 1) return raw
  const half = total / 2
  return (((raw + half) % total) + total) % total - half
}
function distanceOf(index) { return wrapDistance(index, focusIndex.value, list.value.length) }
function stateOf(index) {
  const abs = Math.abs(distanceOf(index))
  return abs === 0 ? 'is-focus' : abs === 1 ? 'is-near' : abs === 2 ? 'is-far' : 'is-out'
}
function stateName(index) { return stateOf(index).slice(3) }
function cardStyle(work, index) {
  return { '--x': distanceOf(index) * step.value + 'px', '--accent': accentOf(work), '--flat': cssGradientOf(work) }
}

function isVerticalTitle(title) {
  const text = String(title || '').trim()
  return text.length > 0 && text.length <= 6 && !/[A-Za-z0-9]/.test(text)
}
/* 书名的排版分支只在这里定：竖排 / 竖排六字小档 / 横排 / 横排长书名小档。
   横排书名每行只排 4~5 字，超过 8 字不降字号就会顶穿 .is-wide 的底部边界（几何见 latent-shelf.css 同名注释）。 */
function titleLayout(title) {
  const text = String(title || '').trim()
  if (isVerticalTitle(text)) return text.length >= 6 ? 'is-tall' : ''
  return text.length > 8 ? 'is-wide is-long' : 'is-wide'
}
function latinOf(work) {
  return String(work.id || '').replace(/-/g, '').slice(-6).toUpperCase() + ' · ' + captionCount(work) + ' CH'
}
function fmtWords(value) {
  const n = Number(value) || 0
  return n >= 10000 ? (n / 10000).toFixed(1) + ' 万字' : n + ' 字'
}
function captionCount(work) {
  if (focused.value?.id === work.id && chapterInfo.value.count) return chapterInfo.value.count
  return Number(work.chapterCount) || 0
}
function cardLabel(work) {
  return '《' + work.title + '》，' + (work.author || '未署名') + '，' + (work.status || '未分类') + '，' + captionCount(work) + ' 章'
}

/* ---------- 接续章：名次只能从该作品的章节序列里数，标题优先用父组件的订阅 ---------- */
const chapterRows = ref([])
const resumeChapter = ref(null)
const rankFailed = ref(false)
let chapterSub = null
function stopChapters() {
  try { chapterSub?.unsubscribe?.() } catch { /* 订阅已随组件销毁 */ }
  chapterSub = null
}
function watchChapters(id) {
  stopChapters()
  chapterRows.value = []
  resumeChapter.value = null
  rankFailed.value = false
  if (!id) return
  try {
    chapterSub = liveQuery(async () => {
      const rows = await db.chapters.where('workId').equals(id).toArray()
      return { rows, resume: await resumeChapterOf(id) }
    }).subscribe({
      next(value) {
        chapterRows.value = (value?.rows || [])
          .filter((c) => !c.deletedAt)
          .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
        resumeChapter.value = value?.resume || null
      },
      error() { chapterRows.value = []; resumeChapter.value = null; rankFailed.value = true }
    })
  } catch { rankFailed.value = true }
}
const chapterInfo = computed(() => {
  const rows = chapterRows.value
  const count = Number(focused.value?.chapterCount) || rows.length
  const at = resumeChapter.value ? rows.findIndex((c) => c.id === resumeChapter.value.id) : -1
  return { count, rank: rankFailed.value || at < 0 ? 0 : at + 1 }
})
const dockTitle = computed(() => {
  const fromParent = props.firstChapter && props.firstChapter.workId === focused.value?.id ? props.firstChapter : null
  return fromParent?.title || resumeChapter.value?.title || '尚未开始第一章'
})
const dockCountText = computed(() => {
  const info = chapterInfo.value
  return info.rank ? '第 ' + info.rank + ' 章 / 共 ' + info.count + ' 章' : '共 ' + info.count + ' 章'
})
const trackWidth = computed(() => {
  const info = chapterInfo.value
  return info.count && info.rank ? Math.round((info.rank / info.count) * 100) + '%' : '0%'
})
const openedText = computed(() => {
  const at = props.openStats?.[focused.value?.id]?.lastOpenedAt
  return at ? '上次打开 ' + formatShelfOpenTime(at) : '尚未打开'
})

/* ---------- 背景：GPU 优先、退化走 CPU 底；引擎在 flow.js，主窗口各页共用同一份 ---------- */
const reduceMotion = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches
const canvasEl = ref(null)
const flatCovers = ref(false)
let backdrop = null
let painter = null

function simWidth() {
  return viewWidth.value < 560 ? 320 : viewWidth.value < 900 ? 480 : 640
}
function paintPalette() {
  const work = focused.value
  if (!work) return
  backdrop?.setPalette?.(paletteOf(work), { duration: 300, seed: (hashString(work.id) % 997) / 997 })
  backdrop?.pulse?.(0.9)
}
/* 切页回来重挂时引擎自己换画布：碰过 WebGL 的画布取不到 2D 上下文。 */
function buildBackdrop() {
  backdrop?.dispose?.()
  backdrop = mountFlowBackdrop(canvasEl.value, {
    reducedMotion: reduceMotion,
    simWidth: simWidth(),
    maxEdge: viewWidth.value < 900 ? 1280 : 1600
  })
}

/* ---------- 封面：单例 painter，只画可见的 5 张，结果按 work.id 缓存 ---------- */
const coverEls = new Map()
const coverCache = new Map()
function bindCover(id, el) {
  if (!el) { coverEls.delete(id); return }
  coverEls.set(id, el)
  /* Vue 重建卡片（含从正文切回书架）时 ref 回调先于 onMounted 的首次绘制，
     不在绑定时补画，画布会一直空到下一次换书。 */
  paintCover(id, el)
}
function paintCover(id, canvas) {
  if (!painter?.supported || !canvas) return
  const work = list.value.find((w) => w.id === id)
  if (!work) return
  let image = coverCache.get(id)
  if (!image) {
    image = painter.paint(paletteOf(work), (hashString(work.id) % 997) / 997, 256, 384)
    if (!image) return
    coverCache.set(id, image)
  }
  const ctx = canvas.getContext('2d')
  if (ctx) ctx.putImageData(image, 0, 0)
}
async function paintCovers() {
  if (!painter?.supported) return
  await nextTick()
  const total = list.value.length
  const focus = focusIndex.value
  for (const [index, work] of list.value.entries()) {
    if (Math.abs(wrapDistance(index, focus, total)) > 2) continue
    paintCover(work.id, coverEls.get(work.id))
  }
}

/* ---------- 交互 ---------- */
/* 环形取模：卡片位本来就是环状排布的，焦点却夹在两端，走到末本再往后就"死"住。 */
function focusTo(index) {
  const total = list.value.length
  if (!total) return
  const next = ((Math.round(index) % total) + total) % total
  const work = list.value[next]
  if (work) focusId.value = work.id
}
function moveFocus(delta) { focusTo(focusIndex.value + delta) }
function openFocused() {
  if (props.busy || props.loading) return
  if (focused.value) emit('open', focused.value)
}
function openWorkbench() {
  if (focused.value) emit('navigate', 'chapters', focused.value)
}
function pickStatus(key) { status.value = key }
function resetSearch() { emit('update:query', '') }
function menuFor(work) { return typeof props.menuOptions === 'function' ? props.menuOptions(work) : [] }
function onMenu(key) { if (focused.value) emit('menu', key, focused.value) }
function onTopbarNavigate(key) {
  if (key === 'shelf') return
  if (key === 'settings') { emit('settings'); return }
  if (focused.value) emit('navigate', key, focused.value)
}

let wheelLock = 0
function onWheel(event) {
  const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
  if (Math.abs(delta) < 6) return
  event.preventDefault()
  const now = Date.now()
  if (now - wheelLock < 200) return
  wheelLock = now
  moveFocus(delta > 0 ? 1 : -1)
}

const searchEl = ref(null)
function onKeydown(event) {
  const tag = String(event.target?.tagName || '').toLowerCase()
  if (tag === 'input' || tag === 'textarea' || event.target?.isContentEditable) {
    if (event.key === 'Escape') event.target.blur()
    return
  }
  if (event.key === '/') { event.preventDefault(); searchEl.value?.focus(); return }
  if (event.key === 'ArrowRight') { event.preventDefault(); moveFocus(1); return }
  if (event.key === 'ArrowLeft') { event.preventDefault(); moveFocus(-1); return }
  if (event.key === 'Enter' && focused.value) { event.preventDefault(); openFocused() }
}
function onResize() {
  viewWidth.value = window.innerWidth
  backdrop?.resize?.()
}

/* 验收脚本读这个钩子：后端与全站 WebGL 上下文数一次给全；
   __nsFlowBackdrop 是同一个函数的别名，主窗口各页的统计形状因此一致。 */
function latentStats() {
  const base = backdrop && typeof backdrop.stats === 'function' ? backdrop.stats() : {}
  return { ...base, contexts: latentContexts.count }
}

watch(() => focused.value?.id, (id) => {
  emit('select-work', id ?? null)
  watchChapters(id)
  paintPalette()
  paintCovers()
}, { immediate: true })

watch(() => list.value.map((w) => w.id).join('|'), () => {
  /* 离场作品的封面位图没有复用机会，跟着列表一起清掉。 */
  const live = new Set(props.works.map((w) => w.id))
  for (const id of [...coverCache.keys()]) if (!live.has(id)) coverCache.delete(id)
  paintCovers()
}, { flush: 'post' })

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('resize', onResize)
  buildBackdrop()
  painter = createCoverPainter()
  flatCovers.value = !painter?.supported
  paintPalette()
  paintCovers()
  /* 首帧里玻璃牌/卡片可能还没量到最终宽度，下一帧再补一遍（命中缓存，几乎无成本）。 */
  requestAnimationFrame(() => paintCovers())
  window.__nsFlowBackdrop = latentStats
  window.__nsLatentStats = latentStats
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('resize', onResize)
  /* 只撤自己那面旗：切到主窗口时钩子已被 Workbench 接管 */
  if (window.__nsFlowBackdrop === latentStats) delete window.__nsFlowBackdrop
  if (window.__nsLatentStats === latentStats) delete window.__nsLatentStats
  stopChapters()
  try { backdrop?.dispose?.() } catch { /* 已销毁 */ }
  try { painter?.dispose?.() } catch { /* 已销毁 */ }
  backdrop = null
  painter = null
  coverEls.clear()
  coverCache.clear()
})
</script>

<template>
  <section class="latent-shelf">
    <div class="ls-backdrop-wrap" aria-hidden="true">
      <canvas ref="canvasEl" class="ls-backdrop"></canvas>
      <div class="ls-layer dots"></div>
      <div class="ls-layer vignette"></div>
      <div class="ls-layer grain"></div>
    </div>

    <AppTopbar active="shelf" :busy="busy || loading" :has-work="!!focused" :target-title="focused?.title" @navigate="onTopbarNavigate" @create="emit('create')">
      <template #search>
        <input ref="searchEl" class="ls-search" type="search" :value="query" placeholder="搜索书名 / 作者" aria-label="搜索作品" @input="emit('update:query', $event.target.value)" />
      </template>
    </AppTopbar>

    <div class="ls-stage" @wheel="onWheel">
      <div class="ls-filter-wrap">
        <NDropdown trigger="click" :options="filterOptions" @select="pickStatus">
          <button class="ls-count" type="button" aria-label="按创作状态筛选">{{ status }} · {{ list.length }} / {{ total }}</button>
        </NDropdown>
      </div>

      <div v-if="loading" class="ls-row" aria-busy="true">
        <div class="ls-skeletons"><span v-for="n in 5" :key="n" class="ls-skeleton"></span></div>
      </div>
      <div v-else-if="list.length" class="ls-row">
        <button
          v-for="(work, index) in list"
          :key="work.id"
          class="ls-card"
          :class="[stateOf(index), { 'is-flat': flatCovers }]"
          type="button"
          :data-work-id="work.id"
          :data-state="stateName(index)"
          :style="cardStyle(work, index)"
          :aria-label="cardLabel(work)"
          @click="focusTo(index)"
          @dblclick="openFocused"
        >
          <span class="ls-plate">
            <span class="ls-glass">
              <canvas :ref="(el) => bindCover(work.id, el)" class="ls-cover-art" width="256" height="384"></canvas>
              <span class="ls-glyph-top"><span>{{ work.genre || '其他' }}</span><span>{{ work.status || '构思' }}</span></span>
              <span class="ls-glyph-rule"></span>
              <span class="ls-glyph-latin">{{ latinOf(work) }}</span>
              <span class="ls-glyph-title" :class="titleLayout(work.title)">{{ work.title }}</span>
              <span class="ls-glyph-foot"><span class="ls-colophon"></span><span class="ls-colophon-char">记</span><span class="ls-rule"></span><span class="ls-glyph-author">{{ work.author || '未署名' }}</span></span>
            </span>
          </span>
          <h3>{{ work.title }}</h3>
          <p>{{ work.author || '未署名' }} · {{ captionCount(work) }} 章</p>
        </button>
      </div>
      <div v-else class="ls-empty">
        <span class="ls-empty-mark" aria-hidden="true">册</span>
        <h2>{{ total ? '没有找到作品' : '第一本书，从这里开始。' }}</h2>
        <p>{{ total ? '换个关键词或创作状态，看看别的故事。' : '写下第一行，让故事在这里慢慢成书。' }}</p>
        <button class="ls-empty-action" type="button" @click="total ? resetSearch() : emit('create')">{{ total ? '清除搜索' : '新书上架' }}</button>
      </div>

      <div v-if="focused && !loading" class="ls-focus">
        <h1 class="ls-title">{{ focused.title }}</h1>
        <div class="ls-meta">
          <b>{{ focused.author || '未署名' }}</b><i>·</i>
          <span>{{ focused.genre || '其他' }} · {{ focused.status || '构思' }}</span><i>·</i>
          <span>{{ captionCount(focused) }} 章</span><i>·</i>
          <span>{{ fmtWords(focused.totalWords) }}</span>
        </div>
        <div class="ls-actions">
          <button class="ls-primary" type="button" :aria-disabled="busy || loading ? 'true' : 'false'" @click="openFocused">继续写作</button>
          <button class="ls-ghost" type="button" @click="openWorkbench">打开工作台</button>
        </div>
      </div>
    </div>

    <div v-if="focused && !loading" class="ls-dock">
      <div class="ls-dock-line"><span>{{ dockTitle }}</span><span>{{ dockCountText }}</span></div>
      <div class="ls-track"><i :style="{ width: trackWidth }"></i></div>
      <div class="ls-dock-line"><span>{{ openedText }}</span><span>{{ focused.genre || '其他' }}</span></div>
    </div>

    <div class="ls-dock-right">
      <button class="ls-round" type="button" aria-label="新建作品" @click="emit('create')">＋</button>
      <NDropdown v-if="focused" trigger="click" :options="menuFor(focused)" @select="onMenu">
        <button class="ls-round" type="button" aria-label="更多操作">⋯</button>
      </NDropdown>
      <button v-else class="ls-round" type="button" aria-label="更多操作" aria-disabled="true">⋯</button>
    </div>
  </section>
</template>

<style scoped src="../styles/skins/latent-shelf.css"></style>
