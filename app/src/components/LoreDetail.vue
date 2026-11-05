<!-- 设定详情（B 视图）——结构与度量严格对照设计稿 b-detail-1440：
     中列 = 同级条目（list-pane：同级条目·N 项 / 集名 / 全部标签 / 条目卡 / 新建条目）；
     右列 = 阅读区（return-tools → archive-reader → archive-article → archive-footer）：
     条目菜单（类型 · N 项子条目）/ 大标题 / 标签 / 正文段落 / 关联关系（两列关系行）/ 子条目（01 编号行）。
     它是 LoreWorkspace 中央 pane 里的一格：没有 fixed 定位、没有 Esc 关闭，返回 = 切回条目编写。
     当前条目来自 ui.loreActiveId（唯一真源），本组件只渲染与触发切换。 -->
<script setup>
import { computed, ref } from 'vue'
import OIcon from './OIcon.vue'
import LoreRelRows from './LoreRelRows.vue'
import LoreGraph from './LoreGraph.vue'
import { useWorkStore } from '../stores/work'
import { useUiStore } from '../stores/ui'
import { jumpTo } from '../services/doublelinks'
import { tagColor } from '../services/tagcolors'

const emit = defineEmits(['back', 'locate', 'map'])
const work = useWorkStore()
const ui = useUiStore()

const listClosed = ref(false)
const tagFilter = ref('')
const hoverLink = ref(null)

const node = computed(() => (ui.loreActiveId ? work.mubu.find((n) => n.id === ui.loreActiveId && !n.deletedAt) || null : null))
const entries = computed(() => (node.value ? work.loreLinksOf('mubu', node.value.id) : []))
const allSiblings = computed(() => {
  const n = node.value
  if (!n) return []
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
const childCount = computed(() => {
  if (!node.value) return 0
  let n = 0
  const walk = (pid) => {
    for (const c of work.mubuChildren(pid)) {
      n++
      walk(c.id)
    }
  }
  walk(node.value.id)
  return n
})
const kindName = computed(() => (node.value && (node.value.tags || [])[0]) || '设定条目')
/** 正文段落：直属叶子子条目的文字（设计稿的 detail-child-prose） */
const proseList = computed(() => {
  if (!node.value) return []
  return work.mubuChildren(node.value.id)
    .filter((c) => !work.mubuChildren(c.id).length)
    .map((c) => String(c.text || '').trim())
    .filter(Boolean)
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
function relCountOf(id) {
  return work.loreLinksOf('mubu', id).length
}
function descOf(n) {
  const t = work.mubuChildren(n.id).map((c) => String(c.text || '').trim()).filter(Boolean).join(' ')
  return t.slice(0, 90) || (n.parentId ? parentName.value : '设定集')
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
  if (id) ui.loreActiveId = id
}
/** 关系行点击：目标为设定 → 切换当前条目；人物 → 跳人物模块 */
function pickRel(e) {
  if (!e) return
  if (e.otherKind === 'mubu') {
    const root = work.mubuRootOf(e.otherId)
    if (root) work.setMubuSet(root.id)
    ui.loreActiveId = e.otherId
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
function addSibling() {
  const n = node.value
  if (!n) return
  const row = work.mubuAdd(n.parentId || null, n.id, '新条目')
  if (row) ui.loreActiveId = row.id
}
</script>

<template>
  <div v-if="node" class="lore-detail">
    <aside v-if="!listClosed" class="lore-detail-list">
      <header class="lore-detail-list-head">
        <div class="lore-detail-context">同级条目<span class="lore-detail-dot" />{{ siblings.length }} 项</div>
        <div class="lore-detail-list-title">
          <h2 :title="parentName">{{ parentName }}</h2>
          <button class="lore-icon" type="button" title="收起条目列表" @click="listClosed = true">‹</button>
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
          :class="{ selected: s.id === node.id }"
          :title="s.text"
          @click="goTo(s.id)"
        >
          <div class="lore-detail-entry-head">
            <h3>{{ (s.text || '').trim() || '（空节点）' }}</h3>
            <OIcon v-if="s.id === node.id" name="caret-right" :size="12" />
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
        <button class="lore-btn block" type="button" @click="addSibling">＋ 新建条目</button>
      </footer>
    </aside>
    <button v-else class="lore-detail-rail" type="button" title="展开条目列表" @click="listClosed = false">同级条目</button>

    <div class="lore-detail-main">
      <div class="lore-detail-return">
        <button class="lore-btn quiet" type="button" title="返回条目编写" @click="emit('back')"><OIcon name="back" :size="12" /> 返回</button>
        <span class="lore-detail-context">{{ parentPath }}</span>
        <button class="lore-btn quiet" type="button" @click="emit('locate', node.id)"><OIcon name="map-pin" :size="12" /> 条目中定位</button>
        <button class="lore-btn quiet" type="button" @click="emit('map')"><OIcon name="container" :size="12" /> 查看导图</button>
      </div>

      <div class="lore-detail-reader">
        <article class="lore-detail-article">
          <div class="lore-detail-menu">
            <div class="lore-detail-context">
              <OIcon name="tag" :size="13" />
              {{ kindName }}
              <span class="lore-detail-dot" />
              {{ childCount }} 项子条目
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
            <p class="lore-detail-body">{{ p }}</p>
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
              <p v-else class="lore-detail-tiny">尚未建立关联关系——点右上「＋」，或在条目编写里右键「设置关系…」</p>
            </div>
          </section>

          <section class="lore-detail-section">
            <h3 class="lore-detail-section-head">
              关系图谱 <small>拖动邻居调整布局（自动记忆）</small>
            </h3>
            <div class="lore-detail-graph">
              <LoreGraph :node-id="node.id" :entries="entries" @pick="pickRel" @hover="onHoverRel" />
            </div>
          </section>

          <section class="lore-detail-section">
            <h3 class="lore-detail-section-head">
              子条目 <small>{{ kids.length }}</small>
              <button class="lore-icon" type="button" title="添加子条目" @click="addSibling"><OIcon name="plus" :size="12" /></button>
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