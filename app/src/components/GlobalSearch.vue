<script setup>
import { ref, reactive } from 'vue'
import { NModal, NInput, NCheckbox, NButton, NEmpty } from 'naive-ui'
import { useWorkStore } from '../stores/work'
import { useUiStore } from '../stores/ui'

const work = useWorkStore()
const ui = useUiStore()

const q = ref('')
const results = ref([])
const ran = ref(false)
const scopes = reactive({ chapters: true, outlines: true, characters: true, lore: true, snippets: true })

const TYPE_LABEL = {
  chapters: '正文',
  outlines: '大纲',
  characters: '人物',
  lore: '设定',
  snippets: '灵感'
}

function run() {
  ran.value = true
  results.value = work.search(q.value, scopes)
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}
function hl(text) {
  const t = text || ''
  if (!q.value) return esc(t)
  const i = t.toLowerCase().indexOf(q.value.toLowerCase())
  if (i < 0) return esc(t)
  return (
    esc(t.slice(0, i)) +
    '<span class="hl">' +
    esc(t.slice(i, i + q.value.length)) +
    '</span>' +
    esc(t.slice(i + q.value.length))
  )
}

function go(r) {
  work.navTo(r.type, r.id)
}
</script>

<template>
  <NModal :show="ui.searchOpen" preset="card" title="全局搜索" style="width: 640px" @update:show="(v) => (ui.searchOpen = v)">
    <div style="display: flex; gap: 8px; margin-bottom: 10px">
      <NInput v-model:value="q" placeholder="搜索关键词…" autofocus @keyup.enter="run" @input="ran = false" />
      <NButton type="primary" @click="run">搜索</NButton>
    </div>
    <div style="display: flex; gap: 14px; margin-bottom: 12px; font-size: 12px">
      <NCheckbox v-model:checked="scopes.chapters" size="small">正文</NCheckbox>
      <NCheckbox v-model:checked="scopes.outlines" size="small">大纲</NCheckbox>
      <NCheckbox v-model:checked="scopes.characters" size="small">人物</NCheckbox>
      <NCheckbox v-model:checked="scopes.lore" size="small">设定</NCheckbox>
      <NCheckbox v-model:checked="scopes.snippets" size="small">灵感</NCheckbox>
    </div>
    <div style="max-height: 420px; overflow: auto">
      <div v-for="r in results" :key="r.type + r.id" class="search-hit" @click="go(r)">
        <div style="font-weight: 600; margin-bottom: 2px">【{{ TYPE_LABEL[r.type] }}】{{ r.title }}</div>
        <div v-for="(h, i) in r.hits" :key="i" class="search-hit-line" v-html="hl(h)"></div>
      </div>
      <NEmpty v-if="ran && !results.length" description="没有找到匹配内容" style="margin: 30px 0" />
    </div>
  </NModal>
</template>

<style scoped>
.search-hit-line {
  font-size: 12px;
  color: var(--text-dim);
  line-height: 1.7;
}
</style>
