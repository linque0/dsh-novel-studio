<script setup>
/* 设置分类栏（总稿 app.mjs:22 sidebar()）：分类三项固定，搜索只影响「查看 N 项结果」的数字。
 * 抽屉态由外壳的 .settings-shell[data-drawer] 驱动，这里不自己管显示与否，
 * 只把「关闭抽屉」这一动作 emit 出去——焦点归还也在外壳里做（它才知道打开按钮在哪）。 */
import { computed } from 'vue'
import { SETTINGS_PAGES } from './settings-catalog.js'
import { APP_VERSION } from './settings-version.js'

const props = defineProps({
  page: { type: String, default: 'appearance' },
  query: { type: String, default: '' },
  resultCount: { type: Number, default: 0 }
})
const emit = defineEmits(['update:query', 'change-page', 'close', 'results'])

/* 搜索态下三项都不算当前页（总稿 sidebar() 的 active 条件带 && !runtime.query） */
const activeKey = computed(() => (props.query ? '' : props.page))

function onInput(event) {
  emit('update:query', event.target.value)
}
</script>

<template>
  <aside class="pane side-pane" aria-label="设置分类">
    <header class="nav-head">
      <div>
        <h2>设置</h2>
        <p>工作区偏好与数据</p>
      </div>
      <button type="button" class="icon-btn" data-act="close-drawer" title="关闭设置分类" aria-label="关闭设置分类" @click="emit('close')">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6" /></svg>
      </button>
    </header>

    <label class="search-box side-search">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4.5 4.5" /></svg>
      <input id="settings-query" aria-label="搜索设置" placeholder="搜索设置…" autocomplete="off" :value="query" @input="onInput" />
      <button v-if="query" type="button" class="icon-btn" data-act="clear-search" title="清除搜索" aria-label="清除搜索" @click="emit('update:query', '')">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6" /></svg>
      </button>
    </label>

    <!-- 容器只给内联留白：settings-fusion.css 没有这个包裹层的类（见报告缺失清单） -->
    <div v-if="query" style="padding:0 18px 16px">
      <button type="button" class="btn small" data-act="show-results" @click="emit('results')">查看 {{ resultCount }} 项结果</button>
    </div>

    <p class="nav-caption">工坊偏好</p>

    <nav class="category-nav" aria-label="设置页面">
      <button
        v-for="item in SETTINGS_PAGES"
        :key="item.key"
        type="button"
        class="category"
        :class="{ active: activeKey === item.key }"
        data-act="page"
        :data-page="item.key"
        :aria-current="activeKey === item.key ? 'page' : undefined"
        :title="item.title"
        @click="emit('change-page', item.key)"
      >
        <svg v-if="item.icon === 'type'" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5h16M12 5v16M8 21h8" /></svg>
        <svg v-else-if="item.icon === 'storage'" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v14c0 4 16 4 16 0V5M4 12c0 4 16 4 16 0" /></svg>
        <svg v-else width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 4h6a4 4 0 0 1 3 2 4 4 0 0 1 3-2h6v16h-6a4 4 0 0 0-3 2 4 4 0 0 0-3-2H3zM12 6v16" /></svg>
        <span>
          <strong>{{ item.title }}</strong>
          <small>{{ item.desc }}</small>
        </span>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg>
      </button>
    </nav>

    <footer class="nav-foot">
      <strong>小说工坊 · {{ APP_VERSION }}</strong>
      <p>本地优先 · 自动保存</p>
    </footer>
  </aside>
</template>
