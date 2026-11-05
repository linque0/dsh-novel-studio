<script setup>
/* 设定侧栏（原型 nav-pane）：nav-head / nav-search / nav-section-label / nav-tree / nav-foot。
   结构照 docs/前端美化/设定-融合总稿-20261105/app.mjs 的 nav()：
   设定集是 .category 行，只有当前集的直属条目以 .nav-entry 列在 .nav-children 里（深层条目走检索或主区）。 */
import { computed } from 'vue'
import { useWorkStore } from '../stores/work'
import { useUiStore } from '../stores/ui'
import OIcon from './OIcon.vue'

const work = useWorkStore()
const ui = useUiStore()

const sets = computed(() => work.mubuRoots())
const currentSetId = computed(() => work.currentMubuRoot()?.id || null)
const relCount = computed(() => work.liveLoreLinks.length)
const entryCount = computed(() => work.liveMubu().filter((n) => n.parentId).length)
const childrenOf = (id) => work.mubuChildren(id)
const countIn = (id) => work.mubuDescendants(id).length

/* ---------- 检索（按节点内容或标签命中；点击定位复用 loreFocusId 展开+闪烁） ---------- */
const q = computed(() => (ui.mubuQuery || '').trim())
const hits = computed(() => {
  const kw = q.value.toLowerCase()
  if (!kw) return null
  const live = work.liveMubu()
  const byId = new Map(live.map((n) => [n.id, n]))
  /* 祖先路径（最多向上 2 层），帮助区分同名节点 */
  const pathOf = (n) => {
    const segs = []
    let p = byId.get(n.parentId)
    while (p && segs.length < 2) {
      segs.unshift(p.text || '（空）')
      p = byId.get(p.parentId)
    }
    return segs.join(' › ')
  }
  return live
    .filter((n) => (n.text || '').toLowerCase().includes(kw) || (n.tags || []).some((t) => t.toLowerCase().includes(kw)))
    .map((n) => ({ node: n, path: pathOf(n) }))
})
function clearQuery() {
  ui.mubuQuery = ''
}

/* ---------- 导航行为 ---------- */
function short(text, max = 24) {
  const s = String(text || '（空）')
  return s.length > max ? s.slice(0, max) + '…' : s
}
function activateSet(n) {
  const root = work.mubuRootOf(n.id)
  if (root && root.id !== work.mubuSetId) work.setMubuSet(root.id)
}
function select(n) {
  activateSet(n)
  ui.loreFocusId = n.id
  ui.mubuSelectedId = n.id
}
/** 双击条目 → 切到设定详情视图（先选中该节点；视图状态在 ui store） */
function openDetail(n) {
  activateSet(n)
  ui.mubuSelectedId = n.id
  ui.openLoreDetail(n.id)
}
/** 右键条目 → 打开标签面板（先选中该节点，面板定位到右键坐标） */
function openTags(n, e) {
  e.preventDefault()
  select(n)
  ui.mubuTagPanel = { nodeId: n.id, x: e.clientX, y: e.clientY }
}
function isActive(n) {
  return ui.mubuSelectedId === n.id || ui.loreFocusId === n.id
}
/** 点设定集：切过去并定位该集第一条（原型 category()） */
function pickSet(root) {
  work.setMubuSet(root.id)
  const first = childrenOf(root.id)[0]
  if (first) select(first)
}
function newSet() {
  work.createMubuSet()
  ui.mubuSelectedId = null
}
/** 收起侧栏（原型 nav-head 的 chevron）：目录栏开合在 ui store，和顶部「收起目录栏」同一条 */
function collapseNav() {
  ui.setPref('sidePanelOpen', false)
}
</script>

<template>
  <div class="nav-pane" role="navigation" aria-label="设定目录">
    <div class="nav-head">
      <OIcon name="folder" :size="16" />
      <h2>世界设定</h2>
      <button class="nav-collapse" type="button" title="收起设定目录" aria-label="收起设定目录" @click="collapseNav">
        <OIcon name="caret-right" :size="14" />
      </button>
    </div>

    <label class="nav-search">
      <OIcon name="search" :size="14" />
      <input v-model="ui.mubuQuery" type="text" placeholder="搜索条目、标签…" spellcheck="false" aria-label="搜索条目或标签" />
      <button v-if="q" class="nav-search-clear" type="button" title="清除筛选" aria-label="清除筛选" @click.stop.prevent="clearQuery">
        <OIcon name="close" :size="12" />
      </button>
    </label>

    <div class="nav-section-label">
      设定集
      <span>
        {{ sets.length }}
        <button class="nav-add" type="button" title="新建设定集" aria-label="新建设定集" @click="newSet"><OIcon name="plus" :size="12" /></button>
      </span>
    </div>

    <div class="nav-tree">
      <!-- 检索态：命中列表（原型 search-label + nav-entry） -->
      <template v-if="hits">
        <div class="nav-section-label search-label">检索结果 <span>{{ hits.length }}</span></div>
        <button
          v-for="h in hits"
          :key="'h:' + h.node.id"
          class="nav-entry"
          :class="{ selected: isActive(h.node) }"
          type="button"
          :title="h.path || h.node.text"
          @click="select(h.node)"
          @dblclick="openDetail(h.node)"
          @contextmenu="openTags(h.node, $event)"
        >{{ short(h.node.text) }}</button>
        <p v-if="!hits.length" class="nav-empty">
          没有匹配条目
          <button class="nav-clear" type="button" @click="clearQuery">清除筛选</button>
        </p>
      </template>

      <!-- 常规树：设定集行 + 当前集的直属条目 -->
      <template v-else>
        <template v-for="s in sets" :key="s.id">
          <button
            class="category"
            :class="{ current: s.id === currentSetId }"
            type="button"
            :title="s.text || '未命名设定集'"
            @click="pickSet(s)"
            @contextmenu="openTags(s, $event)"
          >
            <OIcon name="container" :size="15" />
            <span>{{ s.text || '未命名设定集' }}</span>
            <small>{{ countIn(s.id) }}</small>
          </button>
          <div v-if="s.id === currentSetId && childrenOf(s.id).length" class="nav-children">
            <button
              v-for="n in childrenOf(s.id)"
              :key="n.id"
              class="nav-entry"
              :class="{ selected: isActive(n) }"
              type="button"
              :title="n.text"
              @click="select(n)"
              @dblclick="openDetail(n)"
              @contextmenu="openTags(n, $event)"
            >{{ short(n.text) }}</button>
          </div>
        </template>
        <p v-if="!sets.length" class="nav-empty">
          还没有设定集
          <button class="nav-clear" type="button" @click="newSet">新建设定集</button>
        </p>
      </template>
    </div>

    <footer class="nav-foot">
      <OIcon name="link" :size="12" />
      <span>{{ relCount }} 条世界关系</span>
      <span>{{ entryCount }} 条目</span>
    </footer>
  </div>
</template>
