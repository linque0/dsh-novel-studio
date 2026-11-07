<!-- 同级条目列（原型 .list-pane）——从 LoreDetail 的 list 列原样拆出的独立 pane：
     同级条目·N 项 / 集名 / 全部标签 / 条目卡 / 新建条目。
     收起（data-closed）与细轨由外层 LoreWorkspace 的 aside 负责，本组件只管列内容。 -->
<script setup>
import { computed, ref } from 'vue'
import OIcon from './OIcon.vue'
import { useWorkStore } from '../stores/work'
import { useUiStore } from '../stores/ui'
import { tagColor } from '../services/tagcolors'

const emit = defineEmits(['pick'])
const work = useWorkStore()
const ui = useUiStore()

const tagFilter = ref('')
const node = computed(() => (ui.loreActiveId ? work.mubu.find((n) => n.id === ui.loreActiveId && !n.deletedAt) || null : null))
/** 同级：有当前条目取它的父层，没有就取设定集列表（换作 B 视图时不至于空列） */
const allSiblings = computed(() => {
  const n = node.value
  if (!n) return work.mubuRoots()
  return n.parentId ? work.mubuChildren(n.parentId) : work.mubuRoots()
})
const tagsOfSet = computed(() => {
  const seen = new Set()
  for (const s of allSiblings.value) for (const t of s.tags || []) seen.add(t)
  return [...seen].sort((a, b) => a.localeCompare(b))
})
const siblings = computed(() => (tagFilter.value ? allSiblings.value.filter((s) => (s.tags || []).includes(tagFilter.value)) : allSiblings.value))
const parentName = computed(() => {
  const n = node.value
  if (!n || !n.parentId) return '设定集'
  const p = work.mubu.find((x) => x.id === n.parentId && !x.deletedAt)
  return (p && p.text) || '设定集'
})
function relCountOf(id) {
  return work.loreLinksOf('mubu', id).length
}
/** 摘要：叶子正文优先——向下最多两层收集「没有子节点」的条目文字；没有叶子才退回子条目标题，再退回父级名 */
function descOf(n) {
  const leaves = []
  const titles = []
  const collect = (parentId, level) => {
    for (const c of work.mubuChildren(parentId)) {
      const text = String(c.text || '').trim()
      if (!text) continue
      if (!work.mubuChildren(c.id).length) {
        leaves.push(text)
        continue
      }
      if (level === 0) titles.push(text)
      if (level < 1) collect(c.id, level + 1)
    }
  }
  collect(n.id, 0)
  return (leaves.join(' ') || titles.join(' ')).slice(0, 90) || (n.parentId ? parentName.value : '设定集')
}
function tagStyle(t) {
  const c = tagColor(t)
  return {
    color: c,
    borderColor: `color-mix(in srgb, ${c} 42%, transparent)`,
    background: `color-mix(in srgb, ${c} 9%, transparent)`
  }
}
function goTo(id) {
  if (!id) return
  ui.navigateLore({ activeId: id, selectedId: id })
  emit('pick', id)
}
function build() {
  const n = node.value
  if (!n) return
  work.mubuCheckpoint()
  const row = work.mubuAdd(n.parentId || null, n.id, '新节点')
  if (row) ui.loreActiveId = row.id
}
/** 收起整列（宽度交给 lore-layout.js 压到 40px 细轨） */
function collapse() {
  ui.setPref('loreListClosed', true)
}
</script>

<template>
  <div class="lore-detail-list">
    <header class="lore-detail-list-head">
      <div class="lore-detail-context">同级条目<span class="lore-detail-dot" />{{ siblings.length }} 项</div>
      <div class="lore-detail-list-title">
        <h2 :title="parentName">{{ parentName }}</h2>
        <button class="lore-icon" type="button" title="收起条目列表" aria-label="收起条目列表" @click="collapse"><OIcon name="caret-right" :size="14" /></button>
      </div>
      <div class="lore-detail-filter">
        <OIcon name="rows" :size="12" />
        <select v-model="tagFilter" aria-label="筛选标签">
          <option value="">全部标签</option>
          <option v-for="t in tagsOfSet" :key="t" :value="t">{{ t }}</option>
        </select>
      </div>
    </header>
    <div class="lore-detail-entries">
      <button
        v-for="s in siblings"
        :key="s.id"
        type="button"
        class="lore-detail-entry"
        :class="{ selected: node && s.id === node.id }"
        :title="s.text"
        @click="goTo(s.id)"
      >
        <div class="lore-detail-entry-head">
          <h3>{{ (s.text || '').trim() || '（空节点）' }}</h3>
          <OIcon v-if="node && s.id === node.id" name="caret-right" :size="12" />
        </div>
        <p class="lore-detail-desc">{{ descOf(s) }}</p>
        <div class="lore-detail-entry-meta">
          <span v-for="t in (s.tags || []).slice(0, 2)" :key="t" class="lore-detail-tagchip" :style="tagStyle(t)">{{ t }}</span>
          <span>{{ relCountOf(s.id) }} 关联</span>
        </div>
      </button>
      <p v-if="!siblings.length" class="lore-detail-tiny" style="padding: 16px 20px">这一层没有匹配的条目</p>
    </div>
    <footer class="lore-detail-list-bottom">
      <button class="lore-btn block" type="button" @click="build">＋ 新建条目</button>
    </footer>
  </div>
</template>
