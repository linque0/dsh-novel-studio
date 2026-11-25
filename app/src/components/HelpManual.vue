<!-- 帮助 · 使用手册（双栏高对比度模态框）：
     左侧 4 大分组固定导航 + 关键词实时过滤，右侧独立滚动阅读区；
     数据源收敛于 ./help/manual-data.js，全部条目与当前代码真实实现一一核对。 -->
<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import { NModal, NButton } from 'naive-ui'
import { useUiStore } from '../stores/ui'
import { APP_VERSION } from './settings/settings-version.js'
import {
  MANUAL_GROUPS,
  MANUAL_SECTIONS,
  MANUAL_SECTION_LIST,
  searchManual
} from './help/manual-data.js'

const nsPlugin = typeof __NS_PLUGIN__ !== 'undefined' && __NS_PLUGIN__
const ui = useUiStore()

const activeId = ref('overview')
const searchQuery = ref('')
const showSearchList = ref(false)
const devOpen = ref(false)
const mainScrollRef = ref(null)
const searchInputRef = ref(null)

/** 简洁线性 SVG 图标表（24 viewBox / 1.6px 描边 / 继承 currentColor） */
const ICONS = {
  book: '<path d="M3 5.5A2.5 2.5 0 0 1 5.5 3H11a3 3 0 0 1 3 3v14a2 2 0 0 0-2-2H5.5A2.5 2.5 0 0 0 3 20.5z"/><path d="M21 5.5A2.5 2.5 0 0 0 18.5 3H13a3 3 0 0 0-3 3v14a2 2 0 0 1 2-2h6.5a2.5 2.5 0 0 1 2.5 2.5z"/>',
  compass: '<circle cx="12" cy="12" r="9"/><polygon points="15.5,8.5 13.4,13.4 8.5,15.5 10.6,10.6"/>',
  steps: '<path d="M4 18h4v-4h4v-4h4V6h4"/><path d="M4 10l4-4 3 3"/>',
  manuscript: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8.5 8h7M8.5 12h7M8.5 16h4.5"/>',
  network: '<rect x="3" y="3.5" width="6" height="5" rx="1.2"/><rect x="15" y="3.5" width="6" height="5" rx="1.2"/><rect x="9" y="15.5" width="6" height="5" rx="1.2"/><path d="M6 8.5V12h12V8.5M12 12v3.5"/>',
  users: '<circle cx="9" cy="8.5" r="3.2"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0"/><circle cx="17" cy="9.5" r="2.3"/><path d="M15.8 14.3a4.2 4.2 0 0 1 4.7 4.2"/>',
  layers: '<path d="M12 3l9 4.8-9 4.8-9-4.8z"/><path d="M3 12.2L12 17l9-4.8"/><path d="M3 16.4L12 21l9-4.6"/>',
  sparkle: '<path d="M12 3l2.2 6.8L21 12l-6.8 2.2L12 21l-2.2-6.8L3 12l6.8-2.2z"/>',
  stats: '<path d="M4 20h16"/><path d="M7 20v-7"/><path d="M12 20V6"/><path d="M17 20v-10"/>',
  orbit: '<circle cx="12" cy="12" r="3"/><ellipse cx="12" cy="12" rx="9.5" ry="4.2" transform="rotate(-24 12 12)"/><circle cx="18.6" cy="8.8" r="1.4" fill="currentColor" stroke="none"/>',
  link: '<path d="M10 13.5a4.5 4.5 0 0 0 6.8.4l2.5-2.5a4.5 4.5 0 0 0-6.4-6.4L11.4 6.5"/><path d="M14 10.5a4.5 4.5 0 0 0-6.8-.4L4.7 12.6a4.5 4.5 0 0 0 6.4 6.4l1.5-1.5"/>',
  sliders: '<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="9" cy="6" r="2" fill="var(--hm-surface)"/><circle cx="16" cy="12" r="2" fill="var(--hm-surface)"/><circle cx="11" cy="18" r="2" fill="var(--hm-surface)"/>',
  shield: '<path d="M12 3l7.5 3v5.5c0 4.6-3.1 8.1-7.5 9.5-4.4-1.4-7.5-4.9-7.5-9.5V6z"/><path d="M9 12l2 2 4-4"/>',
  archive: '<rect x="3" y="4" width="18" height="4.5" rx="1.2"/><path d="M5 8.5v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-10"/><path d="M9.5 13h5"/>',
  lock: '<rect x="5" y="11" width="14" height="9.5" rx="2"/><path d="M8 11V7.5a4 4 0 0 1 8 0V11"/>',
  save: '<path d="M5 4h11l3 3v12a1.5 1.5 0 0 1-1.5 1.5h-12A1.5 1.5 0 0 1 4 19V5.5A1.5 1.5 0 0 1 5 4z"/><path d="M8 4v5h7V4"/><rect x="8" y="13.5" width="8" height="7" rx="0.8"/>',
  search: '<circle cx="11" cy="11" r="6.8"/><path d="M20 20l-4.2-4.2"/>',
  chevron: '<path d="M6 9l6 6 6-6"/>',
  arrowRight: '<path d="M5 12h14"/><path d="M13 6l6 6-6 6"/>',
  arrowLeft: '<path d="M19 12H5"/><path d="M11 6l-6 6 6 6"/>'
}

const WEIGHT_COLORS = {
  core: '#47D7E8',
  key: '#5CE1F2',
  standard: '#D6E2F5',
  accent: '#96B6FF',
  trivial: '#7E96C2'
}

/** 延续幻流工作台深色主题；仅在历史浅色皮肤（如原版/琉光且非暗夜主题）时切换浅色高对比度变量 */
const isLightSurface = computed(() => {
  if (nsPlugin) return false
  if (ui.skin === 'dsh' || !ui.skin) return false
  return ui.theme !== 'night'
})

const hasQuery = computed(() => searchQuery.value.trim().length > 0)
const searchHits = computed(() => searchManual(searchQuery.value))
const hitIdSet = computed(() => new Set(searchHits.value.map((h) => h.id)))

const filteredGroups = computed(() => {
  if (!hasQuery.value) return MANUAL_GROUPS
  return MANUAL_GROUPS.map((group) => ({
    ...group,
    sections: group.sections.filter((sec) => hitIdSet.value.has(sec.id))
  })).filter((group) => group.sections.length > 0)
})

const currentSection = computed(() => MANUAL_SECTIONS[activeId.value] || MANUAL_SECTIONS.overview)

const currentIndex = computed(() => MANUAL_SECTION_LIST.findIndex((item) => item.id === activeId.value))
const prevSection = computed(() => (currentIndex.value > 0 ? MANUAL_SECTION_LIST[currentIndex.value - 1] : null))
const nextSection = computed(() =>
  currentIndex.value >= 0 && currentIndex.value < MANUAL_SECTION_LIST.length - 1
    ? MANUAL_SECTION_LIST[currentIndex.value + 1]
    : null
)

const modalTitle = computed(() => (nsPlugin ? '小说工坊使用手册' : '小说工坊桌面版使用手册'))
const colophonText = computed(() =>
  nsPlugin ? `小说工坊插件版 · v${APP_VERSION}` : `小说工坊桌面版 · v${APP_VERSION}`
)

function scrollMainTop() {
  nextTick(() => {
    if (mainScrollRef.value) mainScrollRef.value.scrollTop = 0
  })
}

function selectSection(id) {
  if (!MANUAL_SECTIONS[id]) return
  activeId.value = id
  showSearchList.value = false
  scrollMainTop()
}

function onSearchInput() {
  if (hasQuery.value) {
    showSearchList.value = true
    scrollMainTop()
  } else {
    showSearchList.value = false
  }
}

function clearSearch() {
  searchQuery.value = ''
  showSearchList.value = false
  nextTick(() => searchInputRef.value?.focus())
}

function onSearchKeydown(e) {
  if (e.key === 'Escape' && hasQuery.value) {
    e.stopPropagation()
    clearSearch()
  } else if (e.key === 'Enter' && hasQuery.value && searchHits.value.length) {
    e.preventDefault()
    selectSection(searchHits.value[0].id)
  }
}

watch(
  () => ui.helpOpen,
  (open) => {
    if (open) {
      activeId.value = 'overview'
      searchQuery.value = ''
      showSearchList.value = false
      devOpen.value = false
      scrollMainTop()
    }
  }
)
</script>

<template>
  <NModal
    :class="isLightSurface ? 'hm-light' : 'hm-dark'"
    :show="ui.helpOpen"
    preset="card"
    class="help-modal"
    style="width: 960px; max-width: 94vw"
    :content-style="{ padding: '0' }"
    @update:show="(v) => (ui.helpOpen = v)"
  >
    <template #header>
      <div class="hm-head">
        <span class="hm-head-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" v-html="ICONS.book" />
        </span>
        <span class="hm-head-cn">{{ modalTitle }}</span>
        <span class="hm-head-en">Manual&nbsp;·&nbsp;Novel&nbsp;Studio</span>
      </div>
    </template>

    <div class="hm-shell">
      <!-- 左侧固定导航栏（216px）：顶部检索 + 4 大分组目录 -->
      <aside class="hm-sidebar" aria-label="使用手册目录">
        <div class="hm-search-wrap">
          <svg class="hm-search-ico" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" v-html="ICONS.search" />
          <input
            ref="searchInputRef"
            v-model="searchQuery"
            type="text"
            class="hm-search-input"
            placeholder="搜索功能、快捷键…"
            aria-label="搜索手册内容"
            @input="onSearchInput"
            @keydown="onSearchKeydown"
          />
          <button
            v-if="hasQuery"
            type="button"
            class="hm-search-clear"
            title="清空搜索"
            aria-label="清空搜索"
            @click="clearSearch"
          >×</button>
        </div>

        <div v-if="hasQuery" class="hm-search-meta">
          <span>匹配 {{ searchHits.length }} 节</span>
          <button
            v-if="!showSearchList && searchHits.length"
            type="button"
            class="hm-link-btn"
            @click="showSearchList = true; scrollMainTop()"
          >全部结果</button>
        </div>

        <nav class="hm-nav-scroll">
          <template v-if="filteredGroups.length">
            <div v-for="group in filteredGroups" :key="group.id" class="hm-nav-group">
              <div class="hm-nav-group-label">{{ group.label }}</div>
              <button
                v-for="item in group.sections"
                :key="item.id"
                type="button"
                class="hm-nav-item"
                :class="{ active: !showSearchList && activeId === item.id }"
                :aria-current="!showSearchList && activeId === item.id ? 'page' : undefined"
                @click="selectSection(item.id)"
              >
                <svg class="hm-nav-ico" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" v-html="ICONS[item.icon]" />
                <span class="hm-nav-title">{{ item.title }}</span>
              </button>
            </div>
          </template>
          <div v-else class="hm-nav-empty">
            未找到相关条目，试试「星系」「导出」「双链」或「快捷键」。
          </div>
        </nav>
      </aside>

      <!-- 右侧独立滚动阅读区 -->
      <main ref="mainScrollRef" class="hm-main" aria-live="polite">
        <!-- 搜索结果总览态 -->
        <section v-if="hasQuery && showSearchList" class="hm-article">
          <header class="hm-sec-head">
            <div class="hm-sec-kicker">搜索结果</div>
            <h2 class="hm-sec-title">关键词「{{ searchQuery.trim() }}」</h2>
            <p class="hm-sec-sub">共定位到 {{ searchHits.length }} 个相关章节，点击任意卡片即可直达阅读。</p>
          </header>

          <div v-if="searchHits.length" class="hm-hit-list">
            <button
              v-for="hit in searchHits"
              :key="hit.id"
              type="button"
              class="hm-hit-card"
              @click="selectSection(hit.id)"
            >
              <div class="hm-hit-top">
                <span class="hm-hit-badge">{{ hit.groupLabel }}</span>
                <strong class="hm-hit-title">{{ hit.title }}</strong>
                <span class="hm-hit-go">直达 →</span>
              </div>
              <p class="hm-hit-snippet">{{ hit.snippet }}</p>
            </button>
          </div>
          <div v-else class="hm-empty-state">
            <p>没有匹配到「{{ searchQuery.trim() }}」，可以换用更简短的功能词。</p>
            <button type="button" class="hm-ghost-btn" @click="clearSearch">清空搜索并返回手册</button>
          </div>
        </section>

        <!-- 正文模块阅读态 -->
        <article v-else class="hm-article">
          <div v-if="hasQuery" class="hm-back-search">
            <button type="button" class="hm-link-btn" @click="showSearchList = true; scrollMainTop()">
              ← 返回「{{ searchQuery.trim() }}」的 {{ searchHits.length }} 条匹配结果
            </button>
          </div>

          <header class="hm-sec-head">
            <div class="hm-sec-kicker">
              <svg class="hm-sec-ico" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" v-html="ICONS[currentSection.icon]" />
              <span>{{ currentSection.groupLabel }}</span>
            </div>
            <h2 class="hm-sec-title">{{ currentSection.title }}</h2>
            <p class="hm-sec-sub">{{ currentSection.subtitle }}</p>
          </header>

          <!-- 分组 1 · 工作台全景：6 格可点击创作链路 -->
          <section v-if="currentSection.pipeline" class="hm-block">
            <div class="hm-block-label">核心创作链路（点击模块直达说明）</div>
            <div class="hm-pipeline">
              <button
                v-for="(node, idx) in currentSection.pipeline"
                :key="node.target"
                type="button"
                class="hm-pipe-card"
                @click="selectSection(node.target)"
              >
                <div class="hm-pipe-top">
                  <span class="hm-pipe-badge">{{ node.badge }}</span>
                  <span class="hm-pipe-idx">0{{ idx + 1 }}</span>
                </div>
                <strong class="hm-pipe-name">{{ node.name }}</strong>
                <span class="hm-pipe-role">{{ node.role }}</span>
              </button>
            </div>
          </section>

          <!-- 分组 1 · 三步开写 -->
          <section v-if="currentSection.steps" class="hm-block">
            <div class="hm-step-list">
              <div v-for="step in currentSection.steps" :key="step.num" class="hm-step-card">
                <span class="hm-step-num">{{ step.num }}</span>
                <div class="hm-step-body">
                  <h3>{{ step.title }}</h3>
                  <p>{{ step.desc }}</p>
                  <div v-if="step.chips?.length" class="hm-chip-row">
                    <span v-for="chip in step.chips" :key="chip" class="hm-pill">{{ chip }}</span>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <!-- 分组 2 · 世界观设定：三栏视图对比卡 -->
          <section v-if="currentSection.viewModes" class="hm-block">
            <div class="hm-block-label">三种视图模式对比</div>
            <div class="hm-compare-grid">
              <div v-for="mode in currentSection.viewModes" :key="mode.name" class="hm-compare-card">
                <div class="hm-compare-head">
                  <h3>{{ mode.name }}</h3>
                  <span class="hm-tag-accent">{{ mode.badge }}</span>
                </div>
                <div class="hm-compare-scene">{{ mode.scene }}</div>
                <p>{{ mode.desc }}</p>
                <div class="hm-chip-row">
                  <kbd v-for="chip in mode.chips" :key="chip" class="hm-kbd">{{ chip }}</kbd>
                </div>
              </div>
            </div>
          </section>

          <!-- 分组 3 · 关系星系交互对照表 -->
          <section v-if="currentSection.interactions" class="hm-block">
            <div v-for="group in currentSection.interactions" :key="group.category" class="hm-table-group">
              <div class="hm-block-label">{{ group.category }}</div>
              <div class="hm-table-wrap">
                <table class="hm-table">
                  <thead>
                    <tr>
                      <th style="width: 31%">操作 / 按键</th>
                      <th style="width: 26%">效果</th>
                      <th>使用说明</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="row in group.rows" :key="row.action">
                      <td>
                        <span class="hm-kbd-group">
                          <template v-for="(k, idx) in row.keys" :key="k">
                            <span v-if="idx > 0" class="hm-kbd-sep">/</span>
                            <kbd class="hm-kbd">{{ k }}</kbd>
                          </template>
                        </span>
                      </td>
                      <td class="hm-td-strong">{{ row.action }}</td>
                      <td class="hm-td-muted">{{ row.note }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          <!-- 分组 3 · 连线视觉区分图例 -->
          <section v-if="currentSection.lineLegends" class="hm-block">
            <div class="hm-block-label">关系连线视觉区分</div>
            <div class="hm-legend-grid">
              <div v-for="item in currentSection.lineLegends" :key="item.title" class="hm-legend-card">
                <div class="hm-legend-line" :class="'is-' + item.style" aria-hidden="true">
                  <i class="hm-dot" />
                  <span class="hm-stroke" />
                  <i class="hm-dot" />
                </div>
                <h3>{{ item.title }}</h3>
                <p>{{ item.desc }}</p>
              </div>
            </div>
          </section>

          <!-- 分组 3 · 五级条目权重体系 -->
          <section v-if="currentSection.weights" class="hm-block">
            <div class="hm-block-label">条目五级权重分级（支持标签自动继承）</div>
            <div class="hm-weight-strip">
              <div v-for="w in currentSection.weights" :key="w.id" class="hm-weight-item">
                <div class="hm-weight-top">
                  <i class="hm-weight-dot" :style="{ backgroundColor: WEIGHT_COLORS[w.id] }" />
                  <strong>{{ w.label }}</strong>
                </div>
                <p>{{ w.desc }}</p>
              </div>
            </div>
          </section>

          <!-- 分组 4 · 本地优先三项保障卡片 -->
          <section v-if="currentSection.pillars" class="hm-block">
            <div class="hm-pillar-grid">
              <div v-for="p in currentSection.pillars" :key="p.title" class="hm-pillar-card">
                <span class="hm-pillar-ico" aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" v-html="ICONS[p.icon]" />
                </span>
                <h3>{{ p.title }}</h3>
                <p>{{ p.desc }}</p>
              </div>
            </div>
          </section>

          <!-- 通用 2 列功能卡片网格 -->
          <section v-if="currentSection.cards" class="hm-block">
            <div class="hm-card-grid">
              <div v-for="card in currentSection.cards" :key="card.title" class="hm-card">
                <div class="hm-card-head">
                  <h3>{{ card.title }}</h3>
                </div>
                <p>{{ card.desc }}</p>
                <div v-if="card.tags?.length" class="hm-chip-row">
                  <span v-for="tag in card.tags" :key="tag" class="hm-pill">{{ tag }}</span>
                </div>
              </div>
            </div>
          </section>

          <!-- 分组 3 · 常用快捷键速查 -->
          <section v-if="currentSection.shortcuts" class="hm-block">
            <div class="hm-block-label">高频快捷键速查</div>
            <div class="hm-shortcut-grid">
              <div v-for="sg in currentSection.shortcuts" :key="sg.group" class="hm-shortcut-card">
                <h3>{{ sg.group }}</h3>
                <div v-for="it in sg.items" :key="it.desc" class="hm-shortcut-row">
                  <span class="hm-shortcut-desc">{{ it.desc }}</span>
                  <span class="hm-kbd-group">
                    <template v-for="(k, idx) in it.keys" :key="k">
                      <span v-if="idx > 0" class="hm-kbd-sep">/</span>
                      <kbd class="hm-kbd">{{ k }}</kbd>
                    </template>
                  </span>
                </div>
              </div>
            </div>
          </section>

          <!-- 底部「进阶玩法 / 拓展技巧」引导框 -->
          <section v-if="currentSection.callout" class="hm-callout">
            <div class="hm-callout-head">
              <span class="hm-callout-badge">{{ currentSection.callout.badge }}</span>
              <strong>{{ currentSection.callout.title }}</strong>
            </div>
            <ul class="hm-callout-list">
              <li v-for="line in currentSection.callout.items" :key="line">{{ line }}</li>
            </ul>
            <div v-if="currentSection.callout.keys?.length" class="hm-callout-keys">
              <kbd v-for="k in currentSection.callout.keys" :key="k" class="hm-kbd">{{ k }}</kbd>
            </div>
            <div v-if="currentSection.callout.jumpLinks?.length" class="hm-callout-jumps">
              <button
                v-for="jl in currentSection.callout.jumpLinks"
                :key="jl.target"
                type="button"
                class="hm-jump-btn"
                @click="selectSection(jl.target)"
              >{{ jl.label }}</button>
            </div>
          </section>

          <!-- 分组 4 · 默认折叠的「本地路径与开发者说明」 -->
          <section v-if="currentSection.devAccordion && !nsPlugin" class="hm-accordion" :class="{ open: devOpen }">
            <button
              type="button"
              class="hm-acc-trigger"
              :aria-expanded="devOpen"
              @click="devOpen = !devOpen"
            >
              <div class="hm-acc-title-wrap">
                <span class="hm-acc-title">{{ currentSection.devAccordion.title }}</span>
                <span class="hm-acc-hint">{{ currentSection.devAccordion.hint }}</span>
              </div>
              <svg class="hm-acc-chevron" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" v-html="ICONS.chevron" />
            </button>
            <div v-if="devOpen" class="hm-acc-body">
              <div class="hm-table-wrap">
                <table class="hm-table hm-table-compact">
                  <thead>
                    <tr>
                      <th>启动方式</th>
                      <th>命令 / 入口</th>
                      <th>用途</th>
                      <th>本地数据目录</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="r in currentSection.devAccordion.rows" :key="r.mode">
                      <td class="hm-td-strong">{{ r.mode }}</td>
                      <td><code class="hm-code">{{ r.entry }}</code></td>
                      <td class="hm-td-muted">{{ r.purpose }}</td>
                      <td><code class="hm-code">{{ r.path }}</code></td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div class="hm-dev-tips">
                <div v-for="tip in currentSection.devAccordion.tips" :key="tip.label" class="hm-dev-tip">
                  <div class="hm-dev-tip-head">
                    <strong>{{ tip.label }}</strong>
                    <code class="hm-code">{{ tip.code }}</code>
                  </div>
                  <p>{{ tip.desc }}</p>
                </div>
              </div>
            </div>
          </section>

          <!-- 章节底栏上一节 / 下一节 -->
          <footer class="hm-pager">
            <button
              v-if="prevSection"
              type="button"
              class="hm-pager-btn"
              @click="selectSection(prevSection.id)"
            >
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" v-html="ICONS.arrowLeft" />
              <span>上一节：{{ prevSection.title }}</span>
            </button>
            <span v-else />
            <button
              v-if="nextSection"
              type="button"
              class="hm-pager-btn is-next"
              @click="selectSection(nextSection.id)"
            >
              <span>下一节：{{ nextSection.title }}</span>
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" v-html="ICONS.arrowRight" />
            </button>
          </footer>
        </article>
      </main>
    </div>

    <template #footer>
      <div class="hm-foot">
        <span class="hm-colophon">{{ colophonText }}</span>
        <NButton size="small" class="hm-close-btn" @click="ui.helpOpen = false">关闭</NButton>
      </div>
    </template>
  </NModal>
</template>

<style scoped>
/* ==================== 顶部标题栏 ==================== */
.hm-head {
  display: flex;
  align-items: center;
  gap: 10px;
}
.hm-head-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  background: var(--hm-accent-soft);
  color: var(--hm-accent);
  flex: none;
}
.hm-head-cn {
  font-size: 16px;
  font-weight: 700;
  color: var(--hm-ink-1);
  letter-spacing: 0.02em;
}
.hm-head-en {
  font-size: 10px;
  letter-spacing: 0.22em;
  color: var(--hm-ink-3);
  text-transform: uppercase;
  font-weight: 600;
}

/* ==================== 底部栏 ==================== */
.hm-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  gap: 12px;
}
.hm-colophon {
  font-size: 12px;
  letter-spacing: 0.06em;
  color: var(--hm-ink-3);
}

/* ==================== 双栏主体外壳 ==================== */
.hm-shell {
  display: flex;
  height: min(72vh, 640px);
  min-height: 440px;
  overflow: hidden;
  border-top: 1px solid var(--hm-line);
  border-bottom: 1px solid var(--hm-line);
  color: var(--hm-ink-2);
  font-family: -apple-system, 'Segoe UI', 'Microsoft YaHei', system-ui, sans-serif;
}

/* ==================== 左侧固定导航栏（216px） ==================== */
.hm-sidebar {
  width: 216px;
  flex: none;
  display: flex;
  flex-direction: column;
  background: var(--hm-sidebar-bg);
  border-right: 1px solid var(--hm-line);
  min-height: 0;
}
.hm-search-wrap {
  position: relative;
  display: flex;
  align-items: center;
  margin: 12px 12px 8px;
  flex: none;
}
.hm-search-ico {
  position: absolute;
  left: 10px;
  color: var(--hm-ink-3);
  pointer-events: none;
}
.hm-search-input {
  width: 100%;
  height: 32px;
  padding: 0 26px 0 30px;
  border: 1px solid var(--hm-line-strong);
  border-radius: 8px;
  background: var(--hm-input-bg);
  color: var(--hm-ink-1);
  font: inherit;
  font-size: 12.5px;
  outline: none;
  transition: border-color 0.16s ease, background-color 0.16s ease;
}
.hm-search-input::placeholder {
  color: var(--hm-ink-3);
}
.hm-search-input:focus {
  border-color: var(--hm-accent);
  background: var(--hm-surface);
}
.hm-search-clear {
  position: absolute;
  right: 6px;
  width: 20px;
  height: 20px;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--hm-ink-3);
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.hm-search-clear:hover {
  background: var(--hm-hover);
  color: var(--hm-ink-1);
}
.hm-search-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 14px 6px;
  font-size: 11.5px;
  color: var(--hm-ink-3);
  flex: none;
}
.hm-nav-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 4px 10px 16px;
}
.hm-nav-group {
  margin-bottom: 12px;
}
.hm-nav-group:last-child {
  margin-bottom: 0;
}
.hm-nav-group-label {
  padding: 6px 8px 4px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  color: var(--hm-ink-3);
}
.hm-nav-item {
  position: relative;
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  margin: 2px 0;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--hm-ink-2);
  font: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
  transition: background-color 0.14s ease, color 0.14s ease;
}
.hm-nav-item:hover {
  background: var(--hm-hover);
  color: var(--hm-ink-1);
}
.hm-nav-item.active {
  background: var(--hm-accent-soft);
  color: var(--hm-ink-1);
  font-weight: 600;
}
.hm-nav-item.active::before {
  content: '';
  position: absolute;
  left: 0;
  top: 7px;
  bottom: 7px;
  width: 3px;
  border-radius: 2px;
  background: var(--hm-accent);
}
.hm-nav-ico {
  flex: none;
  color: var(--hm-ink-3);
  transition: color 0.14s ease;
}
.hm-nav-item:hover .hm-nav-ico {
  color: var(--hm-ink-2);
}
.hm-nav-item.active .hm-nav-ico {
  color: var(--hm-accent);
}
.hm-nav-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.hm-nav-empty {
  padding: 18px 10px;
  font-size: 12px;
  line-height: 1.65;
  color: var(--hm-ink-3);
}

/* ==================== 右侧独立滚动阅读区 ==================== */
.hm-main {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  background: var(--hm-surface);
}
.hm-article {
  padding: 24px 30px 30px;
  max-width: 760px;
}
.hm-back-search {
  margin-bottom: 12px;
}
.hm-link-btn {
  border: 0;
  background: transparent;
  padding: 0;
  color: var(--hm-accent);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.hm-link-btn:hover {
  text-decoration: underline;
}

/* 章节头部 */
.hm-sec-head {
  margin-bottom: 20px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--hm-line);
}
.hm-sec-kicker {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 9px;
  border-radius: 999px;
  background: var(--hm-accent-soft);
  color: var(--hm-accent);
  font-size: 11.5px;
  font-weight: 600;
  margin-bottom: 10px;
}
.hm-sec-ico {
  flex: none;
}
.hm-sec-title {
  margin: 0 0 6px;
  font-size: 21px;
  font-weight: 700;
  line-height: 1.3;
  color: var(--hm-ink-1);
  letter-spacing: 0.01em;
}
.hm-sec-sub {
  margin: 0;
  font-size: 13.5px;
  line-height: 1.65;
  color: var(--hm-ink-2);
}

/* 区块标题 */
.hm-block {
  margin-bottom: 20px;
}
.hm-block-label {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: var(--hm-ink-3);
  margin-bottom: 10px;
}

/* ==================== 6 格创作链路卡片 ==================== */
.hm-pipeline {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}
.hm-pipe-card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  padding: 12px 13px;
  border: 1px solid var(--hm-line);
  border-radius: 10px;
  background: var(--hm-card-bg);
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: border-color 0.16s ease, background-color 0.16s ease, transform 0.14s ease;
}
.hm-pipe-card:hover {
  border-color: var(--hm-accent-line);
  background: var(--hm-card-hover);
  transform: translateY(-1px);
}
.hm-pipe-top {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 2px;
}
.hm-pipe-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 7px;
  background: var(--hm-accent-soft);
  color: var(--hm-accent);
  font-size: 13px;
  font-weight: 700;
}
.hm-pipe-idx {
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  color: var(--hm-ink-3);
}
.hm-pipe-name {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--hm-ink-1);
}
.hm-pipe-role {
  font-size: 12px;
  color: var(--hm-ink-3);
}

/* ==================== 三步开写卡片 ==================== */
.hm-step-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.hm-step-card {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  padding: 15px 16px;
  border: 1px solid var(--hm-line);
  border-radius: 12px;
  background: var(--hm-card-bg);
}
.hm-step-num {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border-radius: 10px;
  background: var(--hm-accent-soft);
  color: var(--hm-accent);
  font-size: 13px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.hm-step-body {
  min-width: 0;
  flex: 1;
}
.hm-step-body h3 {
  margin: 0 0 4px;
  font-size: 14.5px;
  font-weight: 700;
  color: var(--hm-ink-1);
}
.hm-step-body p {
  margin: 0 0 8px;
  font-size: 13px;
  line-height: 1.6;
  color: var(--hm-ink-2);
}

/* ==================== 2 列功能卡片 ==================== */
.hm-card-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}
.hm-card {
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding: 15px 16px;
  border: 1px solid var(--hm-line);
  border-radius: 11px;
  background: var(--hm-card-bg);
  transition: border-color 0.16s ease;
}
.hm-card:hover {
  border-color: var(--hm-line-strong);
}
.hm-card-head h3 {
  margin: 0;
  font-size: 14px;
  font-weight: 700;
  color: var(--hm-ink-1);
  line-height: 1.35;
}
.hm-card p {
  margin: 0;
  font-size: 12.5px;
  line-height: 1.65;
  color: var(--hm-ink-2);
  flex: 1;
}

/* ==================== 世界观 3 列视图对比卡 ==================== */
.hm-compare-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 11px;
}
.hm-compare-card {
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding: 14px;
  border: 1px solid var(--hm-line);
  border-radius: 11px;
  background: var(--hm-card-bg);
}
.hm-compare-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}
.hm-compare-head h3 {
  margin: 0;
  font-size: 14px;
  font-weight: 700;
  color: var(--hm-ink-1);
}
.hm-compare-scene {
  font-size: 12px;
  font-weight: 600;
  color: var(--hm-accent);
  line-height: 1.45;
}
.hm-compare-card p {
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--hm-ink-2);
  flex: 1;
}

/* ==================== 胶囊标签 & 键帽 ==================== */
.hm-chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 2px;
}
.hm-pill {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid var(--hm-line);
  background: var(--hm-pill-bg);
  color: var(--hm-ink-2);
  font-size: 11px;
  line-height: 1.45;
  white-space: nowrap;
}
.hm-tag-accent {
  display: inline-flex;
  align-items: center;
  padding: 2px 7px;
  border-radius: 999px;
  background: var(--hm-accent-soft);
  color: var(--hm-accent);
  font-size: 10.5px;
  font-weight: 600;
  white-space: nowrap;
}
.hm-kbd-group {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
}
.hm-kbd-sep {
  font-size: 11px;
  color: var(--hm-ink-3);
}
.hm-kbd {
  display: inline-flex;
  align-items: center;
  padding: 2px 7px;
  border: 1px solid var(--hm-kbd-border);
  border-bottom-width: 2px;
  border-radius: 6px;
  background: var(--hm-kbd-bg);
  color: var(--hm-ink-1);
  font-family: ui-monospace, 'Cascadia Mono', Consolas, 'Microsoft YaHei', monospace;
  font-size: 11.5px;
  line-height: 1.4;
  white-space: nowrap;
}
.hm-code {
  display: inline-block;
  padding: 1px 6px;
  border-radius: 5px;
  background: var(--hm-kbd-bg);
  border: 1px solid var(--hm-line);
  color: var(--hm-ink-1);
  font-family: ui-monospace, Consolas, monospace;
  font-size: 11.5px;
  word-break: break-all;
}

/* ==================== 表格（关系星系交互 / 开发者路径） ==================== */
.hm-table-group {
  margin-bottom: 16px;
}
.hm-table-group:last-child {
  margin-bottom: 0;
}
.hm-table-wrap {
  border: 1px solid var(--hm-line);
  border-radius: 10px;
  overflow: hidden;
  background: var(--hm-card-bg);
}
.hm-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12.5px;
}
.hm-table th,
.hm-table td {
  padding: 9px 12px;
  text-align: left;
  border-bottom: 1px solid var(--hm-line);
  vertical-align: middle;
}
.hm-table tr:last-child td {
  border-bottom: 0;
}
.hm-table th {
  background: var(--hm-table-head);
  color: var(--hm-ink-1);
  font-weight: 600;
  font-size: 12px;
}
.hm-table-compact th,
.hm-table-compact td {
  padding: 7px 10px;
  font-size: 12px;
}
.hm-td-strong {
  color: var(--hm-ink-1);
  font-weight: 600;
}
.hm-td-muted {
  color: var(--hm-ink-2);
  line-height: 1.55;
}

/* ==================== 关系连线图例 ==================== */
.hm-legend-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}
.hm-legend-card {
  padding: 13px 14px;
  border: 1px solid var(--hm-line);
  border-radius: 10px;
  background: var(--hm-card-bg);
}
.hm-legend-card h3 {
  margin: 0 0 4px;
  font-size: 13px;
  font-weight: 700;
  color: var(--hm-ink-1);
}
.hm-legend-card p {
  margin: 0;
  font-size: 12px;
  line-height: 1.55;
  color: var(--hm-ink-2);
}
.hm-legend-line {
  display: flex;
  align-items: center;
  margin-bottom: 10px;
  height: 12px;
}
.hm-legend-line .hm-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex: none;
}
.hm-legend-line .hm-stroke {
  flex: 1;
  height: 0;
  border-top: 2px solid currentColor;
}
.hm-legend-line.is-dashed {
  color: #96b6ff;
}
.hm-legend-line.is-dashed .hm-dot {
  background: #96b6ff;
}
.hm-legend-line.is-dashed .hm-stroke {
  border-top-style: dashed;
}
.hm-legend-line.is-solid-intra {
  color: #47d7e8;
}
.hm-legend-line.is-solid-intra .hm-dot {
  background: #47d7e8;
}
.hm-legend-line.is-solid-cross {
  color: #b6a6ff;
}
.hm-legend-line.is-solid-cross .hm-dot {
  background: #b6a6ff;
}

/* ==================== 五级权重条 ==================== */
.hm-weight-strip {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 8px;
}
.hm-weight-item {
  padding: 10px;
  border: 1px solid var(--hm-line);
  border-radius: 10px;
  background: var(--hm-card-bg);
}
.hm-weight-top {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 5px;
}
.hm-weight-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex: none;
}
.hm-weight-top strong {
  font-size: 12.5px;
  color: var(--hm-ink-1);
}
.hm-weight-item p {
  margin: 0;
  font-size: 11.5px;
  line-height: 1.5;
  color: var(--hm-ink-2);
}

/* ==================== 本地优先三卡 ==================== */
.hm-pillar-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}
.hm-pillar-card {
  padding: 16px;
  border: 1px solid var(--hm-line);
  border-radius: 12px;
  background: var(--hm-card-bg);
}
.hm-pillar-ico {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border-radius: 10px;
  background: var(--hm-accent-soft);
  color: var(--hm-accent);
  margin-bottom: 10px;
}
.hm-pillar-card h3 {
  margin: 0 0 6px;
  font-size: 14px;
  font-weight: 700;
  color: var(--hm-ink-1);
}
.hm-pillar-card p {
  margin: 0;
  font-size: 12.5px;
  line-height: 1.6;
  color: var(--hm-ink-2);
}

/* ==================== 快捷键双列卡片 ==================== */
.hm-shortcut-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}
.hm-shortcut-card {
  padding: 14px 15px;
  border: 1px solid var(--hm-line);
  border-radius: 11px;
  background: var(--hm-card-bg);
}
.hm-shortcut-card h3 {
  margin: 0 0 10px;
  font-size: 13px;
  font-weight: 700;
  color: var(--hm-ink-1);
}
.hm-shortcut-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 6px 0;
  border-top: 1px solid var(--hm-line);
}
.hm-shortcut-row:first-of-type {
  border-top: 0;
  padding-top: 0;
}
.hm-shortcut-desc {
  font-size: 12.5px;
  color: var(--hm-ink-2);
}

/* ==================== 进阶玩法 / 拓展技巧引导框 ==================== */
.hm-callout {
  padding: 15px 17px;
  border: 1px solid var(--hm-accent-line);
  border-left: 3px solid var(--hm-accent);
  border-radius: 10px;
  background: var(--hm-callout-bg);
  margin-bottom: 20px;
}
.hm-callout-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.hm-callout-badge {
  display: inline-flex;
  align-items: center;
  padding: 1px 7px;
  border-radius: 999px;
  background: var(--hm-accent);
  color: var(--hm-accent-ink);
  font-size: 11px;
  font-weight: 700;
}
.hm-callout-head strong {
  font-size: 13.5px;
  color: var(--hm-ink-1);
}
.hm-callout-list {
  margin: 0;
  padding-left: 18px;
  font-size: 12.5px;
  line-height: 1.7;
  color: var(--hm-ink-2);
}
.hm-callout-list li + li {
  margin-top: 4px;
}
.hm-callout-keys {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 10px;
}
.hm-callout-jumps {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 10px;
}
.hm-jump-btn {
  padding: 4px 10px;
  border: 1px solid var(--hm-accent-line);
  border-radius: 7px;
  background: transparent;
  color: var(--hm-accent);
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: background-color 0.14s ease;
}
.hm-jump-btn:hover {
  background: var(--hm-accent-soft);
}

/* ==================== 默认折叠：本地路径与开发者说明 ==================== */
.hm-accordion {
  border: 1px solid var(--hm-line);
  border-radius: 11px;
  background: var(--hm-card-bg);
  margin-bottom: 20px;
  overflow: hidden;
}
.hm-acc-trigger {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 13px 16px;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: background-color 0.14s ease;
}
.hm-acc-trigger:hover {
  background: var(--hm-hover);
}
.hm-acc-title-wrap {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.hm-acc-title {
  font-size: 13.5px;
  font-weight: 700;
  color: var(--hm-ink-1);
}
.hm-acc-hint {
  font-size: 11.5px;
  color: var(--hm-ink-3);
}
.hm-acc-chevron {
  flex: none;
  color: var(--hm-ink-3);
  transition: transform 0.18s ease;
}
.hm-accordion.open .hm-acc-chevron {
  transform: rotate(180deg);
  color: var(--hm-accent);
}
.hm-acc-body {
  padding: 0 16px 16px;
  border-top: 1px solid var(--hm-line);
  padding-top: 14px;
}
.hm-dev-tips {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  margin-top: 12px;
}
.hm-dev-tip {
  padding: 10px 12px;
  border: 1px solid var(--hm-line);
  border-radius: 9px;
  background: var(--hm-surface);
}
.hm-dev-tip-head {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  margin-bottom: 5px;
}
.hm-dev-tip-head strong {
  font-size: 12px;
  color: var(--hm-ink-1);
}
.hm-dev-tip p {
  margin: 0;
  font-size: 11.5px;
  line-height: 1.55;
  color: var(--hm-ink-2);
}

/* ==================== 搜索结果列表 ==================== */
.hm-hit-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.hm-hit-card {
  width: 100%;
  padding: 13px 15px;
  border: 1px solid var(--hm-line);
  border-radius: 10px;
  background: var(--hm-card-bg);
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: border-color 0.15s ease, background-color 0.15s ease;
}
.hm-hit-card:hover {
  border-color: var(--hm-accent-line);
  background: var(--hm-card-hover);
}
.hm-hit-top {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 5px;
}
.hm-hit-badge {
  padding: 1px 7px;
  border-radius: 999px;
  background: var(--hm-accent-soft);
  color: var(--hm-accent);
  font-size: 11px;
  font-weight: 600;
}
.hm-hit-title {
  font-size: 14px;
  color: var(--hm-ink-1);
}
.hm-hit-go {
  margin-left: auto;
  font-size: 12px;
  color: var(--hm-accent);
}
.hm-hit-snippet {
  margin: 0;
  font-size: 12.5px;
  line-height: 1.6;
  color: var(--hm-ink-2);
}
.hm-empty-state {
  padding: 28px 16px;
  text-align: center;
  color: var(--hm-ink-2);
  font-size: 13px;
}
.hm-ghost-btn {
  margin-top: 10px;
  padding: 6px 14px;
  border: 1px solid var(--hm-line-strong);
  border-radius: 8px;
  background: transparent;
  color: var(--hm-ink-1);
  font: inherit;
  font-size: 12.5px;
  cursor: pointer;
}
.hm-ghost-btn:hover {
  background: var(--hm-hover);
}

/* ==================== 章节上下翻页 ==================== */
.hm-pager {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 24px;
  padding-top: 16px;
  border-top: 1px solid var(--hm-line);
}
.hm-pager-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border: 1px solid var(--hm-line);
  border-radius: 8px;
  background: var(--hm-card-bg);
  color: var(--hm-ink-2);
  font: inherit;
  font-size: 12.5px;
  cursor: pointer;
  transition: border-color 0.14s ease, color 0.14s ease, background-color 0.14s ease;
}
.hm-pager-btn:hover {
  border-color: var(--hm-accent-line);
  color: var(--hm-ink-1);
  background: var(--hm-card-hover);
}

/* ==================== 窄屏适配（如 DSH 窄侧栏） ==================== */
@media (max-width: 780px) {
  .hm-shell {
    flex-direction: column;
    height: 74vh;
  }
  .hm-sidebar {
    width: auto;
    border-right: 0;
    border-bottom: 1px solid var(--hm-line);
    max-height: 168px;
  }
  .hm-nav-scroll {
    display: flex;
    gap: 10px;
    overflow-x: auto;
    overflow-y: hidden;
    padding: 0 10px 10px;
  }
  .hm-nav-group {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-bottom: 0;
    flex: none;
  }
  .hm-nav-group-label {
    display: none;
  }
  .hm-nav-item {
    width: auto;
    padding: 5px 10px;
    white-space: nowrap;
  }
  .hm-nav-item.active::before {
    display: none;
  }
  .hm-article {
    padding: 18px 16px 24px;
  }
  .hm-pipeline,
  .hm-card-grid,
  .hm-compare-grid,
  .hm-legend-grid,
  .hm-pillar-grid,
  .hm-shortcut-grid,
  .hm-dev-tips {
    grid-template-columns: 1fr;
  }
  .hm-weight-strip {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>

<!-- NModal 挂载于 body：集中定义深色优先的高对比度令牌与浅色适配，彻底移除低对比度 --ikb 标题色 -->
<style>
.help-modal.n-card {
  --hm-surface: #1b1e25;
  --hm-sidebar-bg: #15181e;
  --hm-card-bg: rgba(255, 255, 255, 0.036);
  --hm-card-hover: rgba(255, 255, 255, 0.062);
  --hm-input-bg: rgba(255, 255, 255, 0.05);
  --hm-hover: rgba(255, 255, 255, 0.07);
  --hm-pill-bg: rgba(255, 255, 255, 0.055);
  --hm-table-head: rgba(255, 255, 255, 0.05);
  --hm-kbd-bg: #252a35;
  --hm-kbd-border: rgba(255, 255, 255, 0.2);
  --hm-line: rgba(255, 255, 255, 0.09);
  --hm-line-strong: rgba(255, 255, 255, 0.16);
  --hm-ink-1: #f5f7fb;
  --hm-ink-2: #cbd2df;
  --hm-ink-3: #8e98ab;
  --hm-accent: var(--ns-accent, #7aaaff);
  --hm-accent-soft: rgba(122, 170, 255, 0.15);
  --hm-accent-line: rgba(122, 170, 255, 0.34);
  --hm-accent-ink: #0f1420;
  --hm-callout-bg: rgba(122, 170, 255, 0.08);

  --n-color: var(--hm-surface);
  --n-color-modal: var(--hm-surface);
  --n-text-color: var(--hm-ink-1);
  --n-title-text-color: var(--hm-ink-1);
  --n-border-color: var(--hm-line-strong);
  --n-close-icon-color: var(--hm-ink-2);
  --n-close-icon-color-hover: var(--hm-ink-1);
  --n-close-icon-color-pressed: var(--hm-ink-1);
  --n-close-color-hover: var(--hm-hover);
  --n-close-color-pressed: var(--hm-hover);

  background: var(--hm-surface);
  border: 1px solid var(--hm-line-strong);
  border-top: 2px solid var(--hm-accent);
  border-radius: 14px;
  box-shadow: 0 22px 60px rgba(0, 0, 0, 0.56);
  color: var(--hm-ink-1);
}

/* 浅色面板适配（关闭深色面板或浅纸皮肤时仍保持锐利高对比度） */
.help-modal.n-card.hm-light {
  --hm-surface: #fbfaf7;
  --hm-sidebar-bg: #f3f1ec;
  --hm-card-bg: #ffffff;
  --hm-card-hover: #f7f9fd;
  --hm-input-bg: #ffffff;
  --hm-hover: rgba(20, 28, 44, 0.055);
  --hm-pill-bg: #f2f4f8;
  --hm-table-head: #f3f5f9;
  --hm-kbd-bg: #f5f7fb;
  --hm-kbd-border: #ccd3e0;
  --hm-line: rgba(20, 28, 44, 0.1);
  --hm-line-strong: rgba(20, 28, 44, 0.18);
  --hm-ink-1: #161a23;
  --hm-ink-2: #404859;
  --hm-ink-3: #6c7588;
  --hm-accent: #2c62d6;
  --hm-accent-soft: rgba(44, 98, 214, 0.11);
  --hm-accent-line: rgba(44, 98, 214, 0.28);
  --hm-accent-ink: #ffffff;
  --hm-callout-bg: rgba(44, 98, 214, 0.06);

  box-shadow: 0 20px 52px rgba(20, 28, 44, 0.2);
}

.help-modal.n-card .n-card-header {
  padding: 14px 20px;
  background: transparent;
}
.help-modal.n-card .n-card-header__close {
  color: var(--hm-ink-2);
}
.help-modal.n-card .n-card-header__close:hover {
  color: var(--hm-ink-1);
}
.help-modal.n-card .n-card__content {
  padding: 0;
  background: transparent;
  overflow: hidden;
}
.help-modal.n-card .n-card__footer {
  padding: 11px 20px;
  background: transparent;
}
.help-modal.n-card .hm-close-btn {
  --n-text-color: var(--hm-ink-1);
  --n-text-color-hover: var(--hm-ink-1);
  --n-border: 1px solid var(--hm-line-strong);
  --n-border-hover: 1px solid var(--hm-accent);
  --n-color: var(--hm-card-bg);
  --n-color-hover: var(--hm-card-hover);
}
</style>
