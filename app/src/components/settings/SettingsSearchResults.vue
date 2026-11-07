<script setup>
/* 检索结果页（总稿 app.mjs:51 searchPage()）：列表项点一下要「清空查询 + 跳到该分类 + 定位高亮」，
 * 这三步都要改外壳的状态，所以这里只 emit，定位与聚焦由外壳统一做（它才拿得到 .content-scroll）。 */
import { SETTINGS_PAGES } from './settings-catalog.js'

defineProps({ results: { type: Array, default: () => [] } })
const emit = defineEmits(['locate', 'clear'])

const pageTitle = (key) => SETTINGS_PAGES.find((item) => item.key === key)?.title || ''
</script>

<template>
  <div class="search-results">
    <button
      v-for="row in results"
      :key="row.id"
      type="button"
      class="search-result"
      data-act="locate"
      :data-id="row.id"
      :data-page="row.page"
      @click="emit('locate', row)"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 4h6a4 4 0 0 1 3 2 4 4 0 0 1 3-2h6v16h-6a4 4 0 0 0-3 2 4 4 0 0 0-3-2H3zM12 6v16" /></svg>
      <div>
        <strong>{{ row.title }}</strong>
        <p>{{ row.desc }}</p>
        <small>{{ pageTitle(row.page) }}</small>
      </div>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg>
    </button>

    <div v-if="!results.length" class="empty">
      <svg class="icon" width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4.5 4.5" /></svg>
      <h2>没有找到相关设置</h2>
      <p>试试「字体」「备份」或「快捷键」。</p>
      <button type="button" class="btn" data-act="clear-search" @click="emit('clear')">清除搜索</button>
    </div>
  </div>
</template>
