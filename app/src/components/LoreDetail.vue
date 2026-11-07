<!-- Existing read view uses the same node HTML, including ID links. -->
<!-- 设定详情 · 阅读区（B 视图的 main 那一格）——结构与度量对照设计稿 b-detail-1440：
     return-tools → archive-reader → archive-article（条目菜单 / 大标题 / 标签 / 正文段落 / 关联关系 / 子条目）→ archive-footer。
     同级条目列已拆成独立 pane（LoreEntryList.vue），关系图谱的出入口在 C 视图（视觉导图），
     这里不再内联分栏、也不再内联图谱：它是 LoreWorkspace 主 pane 里的一段内容。
     当前条目来自 ui.loreActiveId（唯一真源），本组件只渲染与触发切换。 -->
<script setup>
import { cleanLoreHtml } from '../services/lore-editor-dom.js'
import { computed, ref } from 'vue'
import OIcon from './OIcon.vue'
import LoreRelRows from './LoreRelRows.vue'
import { kindOf } from './lore/lore-kinds.js'
import { useWorkStore } from '../stores/work'
import { useUiStore } from '../stores/ui'
import { jumpTo } from '../services/doublelinks'
import { tagColor } from '../services/tagcolors'

defineProps({
  canBack: { type: Boolean, default: false },
  listBack: { type: Boolean, default: false }
})
const emit = defineEmits(['back', 'list', 'locate', 'map'])
const work = useWorkStore()
const ui = useUiStore()

const hoverLink = ref(null)

const node = computed(() => (ui.loreActiveId ? work.mubu.find((n) => n.id === ui.loreActiveId && !n.deletedAt) || null : null))
const entries = computed(() => (node.value ? work.loreLinksOf('mubu', node.value.id) : []))
const parentName = computed(() => {
  const n = node.value
  if (!n || !n.parentId) return '设定集'
  const p = work.mubu.find((x) => x.id === n.parentId && !x.deletedAt)
  return (p && p.text) || '设定集'
})
/** 面包屑：根 → … → 当前（祖先可点，就地切换详情） */
const crumbs = computed(() => {
  const out = []
  let cur = node.value
  let guard = 0
  while (cur && guard++ < 30) {
    out.unshift({ id: cur.id, text: (cur.text || '（空节点）').slice(0, 24) })
    cur = cur.parentId ? work.mubu.find((n) => n.id === cur.parentId && !n.deletedAt) || null : null
  }
  return out
})
const parentPath = computed(() => crumbs.value.slice(0, -1).map((c) => c.text).join(' / ') || '世界设定')

/** 正文段落：直属叶子子条目的文字（设计稿的 detail-child-prose） */
const proseList = computed(() => {
  if (!node.value) return []
  return work.mubuChildren(node.value.id)
    .filter((c) => !work.mubuChildren(c.id).length)
    .filter(c => (c.text || '').trim() || c.html)
    .map(c => ({ id: c.id, html: cleanLoreHtml(c.html || String(c.text || '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('\n', '<br>')) }))
})
/** 子条目：直属子节点（设计稿 01/02 编号行 + 一行摘要） */
const kids = computed(() => {
  if (!node.value) return []
  return work.mubuChildren(node.value.id).map((k, i) => ({
    id: k.id,
    no: String(i + 1).padStart(2, '0'),
    text: (k.text || '').trim() || '（空节点）',
    desc: work.mubuChildren(k.id).map((c) => String(c.text || '').trim()).filter(Boolean).join(' ').slice(0, 80)
  }))
})
function tagStyle(t) {
  const c = tagColor(t)
  return {
    color: c,
    borderColor: `color-mix(in srgb, ${c} 42%, transparent)`,
    background: `color-mix(in srgb, ${c} 9%, transparent)`
  }
}
function goTo(id) {
  if (id) ui.navigateLore({ activeId: id, selectedId: id })
}
/** 关系行点击：目标为设定 → 切换当前条目；人物 → 跳人物模块 */
function pickRel(e) {
  if (!e) return
  if (e.otherKind === 'mubu') {
    const root = work.mubuRootOf(e.otherId)
    if (root) work.setMubuSet(root.id)
    ui.navigateLore({ activeId: e.otherId, selectedId: e.otherId })
    return
  }
  jumpTo({ kind: 'character', id: e.otherId })
}
function onHoverRel(e) {
  hoverLink.value = e ? e.linkId : null
}
function openRelPanel() {
  if (!node.value) return
  ui.loreRelationPanel = { kind: 'mubu', id: node.value.id, x: Math.max(8, window.innerWidth / 2 - 170), y: 110 }
}
function filterTag(t) {
  ui.mubuQuery = t
  emit('back')
}
function addChild() {
  const n = node.value
  if (!n) return
  work.mubuCheckpoint()
  const row = work.mubuAdd(n.id, null, '新节点')
  if (row) ui.loreActiveId = row.id
}
</script>

<template>
  <div v-if="node" class="lore-detail">
    <div class="lore-detail-main">
      <div class="lore-detail-return">
        <!-- 窄档（≤1099）回列表屏的唯一入口：宽档 listBack=false，不渲染 -->
        <button v-if="listBack" class="lore-mobile-back" type="button" @click="emit('list')"><OIcon name="back" :size="12" /> 条目列表</button>
        <button v-if="canBack" class="lore-btn quiet" type="button" title="返回条目编写" @click="emit('back')"><OIcon name="back" :size="12" /> 返回</button>
        <span class="lore-detail-context">{{ parentPath }}</span>
        <button class="lore-btn quiet" type="button" @click="emit('locate', node.id)"><OIcon name="map-pin" :size="12" /> 条目中定位</button>
        <button class="lore-btn quiet" type="button" @click="emit('map')"><OIcon name="container" :size="12" /> 查看导图</button>
      </div>

      <div class="lore-detail-reader">
        <article class="lore-detail-article">
          <div class="lore-detail-menu">
            <div class="lore-detail-context">
              <OIcon :name="kindOf(node).icon" :size="13" />
              {{ kindOf(node).label }}
            </div>
            <div class="lore-detail-menu-actions">
              <button class="lore-icon" type="button" title="在条目编写中编辑" @click="emit('locate', node.id)"><OIcon name="edit" :size="13" /></button>
              <button class="lore-icon" type="button" title="添加关联关系" @click="openRelPanel"><OIcon name="link" :size="13" /></button>
            </div>
          </div>
          <h2 class="lore-detail-title">{{ (node.text || '').trim() || '（空节点）' }}</h2>
          <div v-if="(node.tags || []).length" class="lore-detail-tags">
            <button v-for="t in node.tags" :key="t" class="lore-detail-tag" type="button" :style="tagStyle(t)" :title="`筛选标签「${t}」`" @click="filterTag(t)">{{ t }}</button>
          </div>
          <div v-for="(p, i) in proseList" :key="'p' + i" class="lore-detail-childprose">
            <div class="lore-detail-body" v-html="p.html" />
          </div>

          <section class="lore-detail-section">
            <h3 class="lore-detail-section-head">
              关联关系 <small>{{ entries.length }}</small>
              <button class="lore-icon" type="button" title="添加关联关系" @click="openRelPanel"><OIcon name="plus" :size="12" /></button>
            </h3>
            <div class="lore-detail-relgrid">
              <LoreRelRows
                v-if="entries.length"
                :entries="entries"
                :hover-link="hoverLink"
                @pick="pickRel"
                @hover="onHoverRel"
              />
              <p v-else class="lore-detail-tiny" title="点右上「＋」，或在条目编写里右键「设置关系…」">尚未建立关联关系</p>
            </div>
          </section>

          <section class="lore-detail-section">
            <h3 class="lore-detail-section-head">
              子条目 <small>{{ kids.length }}</small>
              <button class="lore-icon" type="button" title="添加子条目" @click="addChild"><OIcon name="plus" :size="12" /></button>
            </h3>
            <p v-if="!kids.length" class="lore-detail-tiny">没有更深的条目层级</p>
            <div v-for="k in kids" :key="k.id" class="lore-detail-child">
              <span class="lore-detail-child-no">{{ k.no }}</span>
              <button type="button" :title="k.text" @click="goTo(k.id)">
                <strong>{{ k.text }}</strong>
                <p>{{ k.desc || parentName }}</p>
              </button>
              <OIcon name="caret-right" :size="12" />
            </div>
          </section>
        </article>
      </div>

      <footer class="lore-detail-footer">
        <span class="lore-detail-context">{{ parentPath }} / {{ (node.text || '').trim() || '（空节点）' }}</span>
        <button class="lore-btn" type="button" title="回到条目编写继续编辑" @click="emit('locate', node.id)"><OIcon name="edit" :size="12" /> 编辑条目</button>
      </footer>
    </div>
  </div>
</template>
