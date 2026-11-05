<!-- 设定工作区外壳（三视图）——结构与度量对照设计稿 docs/前端美化/设定-融合总稿-20261105/：
     A 条目编写（MubuView：整棵森林 / 玻璃直写）/ B 设定详情（LoreDetail：同级条目 + 阅读区）/
     C 视觉导图（层级导图 LoreTreeMap / 关系网络 LoreGraph + 右条目摘要）。
     三视图在同一个中央 pane 内切换；头部（crumbs / .lore-h1 / eyebrow / 新建条目 / 视图切换器）归外壳，
     A 的「折叠 / 展开」按设计稿进幕布工具条（见 MubuView 的 ob-toolbar 右端）。
     状态唯一真源在 ui store：loreView / loreActiveId / loreMapMode / loreReturn（见 stores/ui.js）。 -->
<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import OIcon from '../OIcon.vue'
import MubuView from '../MubuView.vue'
import LoreDetail from '../LoreDetail.vue'
import LoreRelRows from '../LoreRelRows.vue'
import LoreGraph from '../LoreGraph.vue'
import LoreTreeMap from './LoreTreeMap.vue'
import { useWorkStore } from '../../stores/work'
import { useUiStore } from '../../stores/ui'
import { jumpTo } from '../../services/doublelinks'
import { tagColor } from '../../services/tagcolors'

const work = useWorkStore()
const ui = useUiStore()

const mubu = ref(null) // A 视图实例：新建 / 定位 / 滚动
const treeMap = ref(null) // C 层级导图实例：缩放 / 适应 / 聚焦
const graphRef = ref(null) // C 关系网络实例：缩放 / 适应
const hoverLink = ref(null)
const VIEWS = [
  { id: 'write', label: '条目编写' },
  { id: 'detail', label: '设定详情' },
  { id: 'map', label: '视觉导图' }
]

/* ---------- 头部（设计稿 eyebrow：N 个设定集 · M 条目 · K 条关系） ---------- */
const setCount = computed(() => work.mubuRoots().length)
const entryTotal = computed(() => {
  let n = 0
  const walk = (pid) => {
    for (const c of work.mubuChildren(pid)) {
      n++
      walk(c.id)
    }
  }
  work.mubuRoots().forEach((r) => walk(r.id))
  return n
})
const relTotal = computed(() => work.liveLoreLinks.length)
const filterText = computed(() => String(ui.mubuQuery || '').trim())
const node = computed(() => (ui.loreActiveId ? work.mubu.find((n) => n.id === ui.loreActiveId && !n.deletedAt) || null : null))
const headTitle = computed(() => {
  if (ui.loreView === 'map') return '视觉导图'
  if (ui.loreView === 'detail') return (node.value?.text || '').trim() || '设定详情'
  return work.currentMubuRoot()?.text || '世界设定'
})
const entries = computed(() => (node.value ? work.loreLinksOf('mubu', node.value.id) : []))
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
/** 摘要区正文：直属叶子子条目的文字（与 B 同一口径） */
const proseList = computed(() => {
  if (!node.value) return []
  return work.mubuChildren(node.value.id)
    .filter((c) => !work.mubuChildren(c.id).length)
    .map((c) => String(c.text || '').trim())
    .filter(Boolean)
    .slice(0, 3)
})
const kids = computed(() => (node.value ? work.mubuChildren(node.value.id) : []))
function tagStyle(t) {
  const c = tagColor(t)
  return {
    color: c,
    borderColor: `color-mix(in srgb, ${c} 42%, transparent)`,
    background: `color-mix(in srgb, ${c} 9%, transparent)`
  }
}

/* ---------- 视图切换（保留当前条目；返回恢复视图与滚动位置） ---------- */
function fallbackId() {
  return ui.loreActiveId || ui.mubuSelectedId || work.mubuChildren(work.currentMubuRoot()?.id || null)[0]?.id || null
}
function captureScroll() {
  return ui.loreView === 'write' ? mubu.value?.getScroll() ?? 0 : 0
}
function switchView(next) {
  if (next === ui.loreView) return
  const id = next === 'detail' ? fallbackId() : undefined
  if (next === 'detail' && !id) return
  const scroll = captureScroll()
  ui.setLoreView(next, { id, scroll })
}
async function back() {
  const prev = ui.loreBack()
  await nextTick()
  if (ui.loreView === 'write' && prev && prev.scroll != null) mubu.value?.setScroll(prev.scroll)
}
function openDetail(id) {
  if (!id) return
  ui.setLoreView('detail', { id, scroll: captureScroll() })
}
/** B「查看导图」→ C 的层级导图（关系网络是 C 里的另一个模式，不能顺着上一个模式走） */
function openMap() {
  ui.setLoreMapMode('hierarchy')
  switchView('map')
}
/** B/C → A：切回编写并滚动定位（先切视图，再让 MubuView 闪烁，隐藏态测不到位置） */
async function locate(id) {
  const target = id || ui.loreActiveId
  if (!target) return
  ui.setLoreView('write', { id: target, scroll: 0 })
  await nextTick()
  mubu.value?.focusNode(target)
}
function newEntry() {
  mubu.value?.headAdd()
}
function clearFilter() {
  ui.mubuQuery = ''
}
function selectNode(id) {
  if (!id) return
  ui.loreActiveId = id
  const root = work.mubuRootOf(id)
  if (root) work.setMubuSet(root.id)
}
/** 关系行点击：目标为设定 → 切目标条目；人物 → 跳人物模块 */
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

/* ---------- C 视觉导图 ---------- */
const mapMode = computed(() => ui.loreMapMode)
const mapSetId = computed(() => work.currentMubuRoot()?.id || null)
const graphCenterId = computed(() => ui.loreActiveId || work.mubuChildren(mapSetId.value)[0]?.id || mapSetId.value || '')
const graphEntries = computed(() => (graphCenterId.value && work.mubu.find((n) => n.id === graphCenterId.value) ? work.loreLinksOf('mubu', graphCenterId.value) : []))
const mapContext = computed(() => {
  if (mapMode.value === 'hierarchy') return '条目层级'
  const t = graphCenterId.value ? (work.mubu.find((n) => n.id === graphCenterId.value) || {}).text || '' : ''
  return `${(t || '未命名').slice(0, 18)} · 一跳关系`
})
const zoomPercent = computed(() => {
  const z = mapMode.value === 'hierarchy' ? treeMap.value?.zoom : graphRef.value?.zoom
  return Math.round((Number(z) || 1) * 100)
})
function zoomIn() {
  if (mapMode.value === 'hierarchy') treeMap.value?.zoomIn()
  else graphRef.value?.zoomIn()
}
function zoomOut() {
  if (mapMode.value === 'hierarchy') treeMap.value?.zoomOut()
  else graphRef.value?.zoomOut()
}
function zoomReset() {
  if (mapMode.value === 'hierarchy') treeMap.value?.zoomReset()
  else graphRef.value?.zoomReset()
}
function zoomFit() {
  if (mapMode.value === 'hierarchy') treeMap.value?.fitAll()
  else graphRef.value?.fitView()
}
function zoomFocus() {
  if (mapMode.value === 'hierarchy') treeMap.value?.focusActive()
  else graphRef.value?.fitView()
}
function setMapMode(mode) {
  ui.setLoreMapMode(mode)
}
function onGraphPick(e) {
  if (!e) return
  if (e.otherKind === 'mubu') return selectNode(e.otherId)
  jumpTo({ kind: 'character', id: e.otherId })
}

/* ---------- 会话恢复：按作品记视图/条目/模式（刷新后回来还是走到的位置） ---------- */
let saveTimer = null
function schedulePersist() {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => ui.persistLoreState(work.work?.id), 300)
}
watch(() => [ui.loreView, ui.loreActiveId, ui.loreMapMode], schedulePersist)
onMounted(async () => {
  await ui.restoreLoreState(work.work?.id)
  /* 恢复的条目可能属于别的作品或被删：无效就退回条目编写 */
  const id = ui.loreActiveId
  if (id && !work.mubu.some((n) => n.id === id && !n.deletedAt)) {
    ui.loreActiveId = null
    if (ui.loreView !== 'write') ui.loreView = 'write'
  }
  if (ui.loreView === 'detail' && !node.value) {
    ui.loreActiveId = fallbackId()
    if (!ui.loreActiveId) ui.loreView = 'write'
  }
})
onBeforeUnmount(() => clearTimeout(saveTimer))
</script>

<template>
  <div class="lore-workspace">
    <header class="lore-head">
      <div class="lore-head-main">
        <div class="lore-crumbs">
          <span>{{ work.work?.title || '未命名作品' }}</span>
          <i>›</i>
          <span>世界设定</span>
        </div>
        <h1 class="lore-h1">{{ headTitle }}</h1>
        <div class="lore-meta">
          <span>{{ setCount }} 个设定集</span>
          <i>·</i>
          <span>{{ entryTotal }} 条目</span>
          <i>·</i>
          <span>{{ relTotal }} 条关系</span>
          <template v-if="filterText">
            <i>·</i>
            <span class="lore-filter">正在筛选「{{ filterText }}」<button @click="clearFilter">清除</button></span>
          </template>
        </div>
      </div>
      <div class="lore-head-actions">
        <button v-if="ui.loreView === 'write'" class="lore-btn primary" type="button" @click="newEntry">
          <OIcon name="plus" :size="12" /> {{ setCount ? '新建条目' : '新建设定集' }}
        </button>
        <nav class="lore-switch" role="tablist" aria-label="设定视图">
          <button
            v-for="v in VIEWS"
            :key="v.id"
            type="button"
            role="tab"
            :class="{ on: ui.loreView === v.id }"
            :aria-selected="ui.loreView === v.id"
            :data-lore-view="v.id"
            @click="switchView(v.id)"
          >{{ v.label }}</button>
        </nav>
      </div>
    </header>

    <!-- A 条目编写：整棵森林（保留挂载，返回时滚动位置与选中态原样还在） -->
    <div v-show="ui.loreView === 'write'" class="lore-views">
      <MubuView ref="mubu" />
    </div>

    <!-- B 设定详情 -->
    <div v-if="ui.loreView === 'detail'" class="lore-views">
      <LoreDetail @back="back" @locate="locate" @map="openMap" />
    </div>

    <!-- C 视觉导图：左图区 + 右条目摘要 -->
    <div v-if="ui.loreView === 'map'" class="lore-views">
      <div class="lore-map">
        <div class="lore-map-main">
          <div class="lore-map-subbar">
            <div class="lore-map-modes" role="tablist" aria-label="导图模式">
              <button type="button" role="tab" :class="{ on: mapMode === 'hierarchy' }" :aria-selected="mapMode === 'hierarchy'" @click="setMapMode('hierarchy')">层级导图</button>
              <button type="button" role="tab" :class="{ on: mapMode === 'relations' }" :aria-selected="mapMode === 'relations'" @click="setMapMode('relations')">关系网络</button>
            </div>
            <span class="lore-map-context">{{ mapContext }}</span>
          </div>
          <div class="lore-map-stage">
            <LoreTreeMap
              v-if="mapMode === 'hierarchy'"
              ref="treeMap"
              :set-id="mapSetId"
              :active-id="ui.loreActiveId"
              @select="selectNode"
              @open="openDetail"
            />
            <div v-else class="lore-map-graph">
              <LoreGraph
                v-if="graphCenterId"
                ref="graphRef"
                :node-id="graphCenterId"
                :entries="graphEntries"
                height="100%"
                :node-w="156"
                :node-h="88"
                :center-w="198"
                :center-h="116"
                @pick="onGraphPick"
                @hover="onHoverRel"
              />
            </div>
          </div>
          <div class="lore-map-foot">
            <span class="lore-map-legend">
              <i />
              {{ mapMode === 'hierarchy' ? '父子层级' : '设定与人物关系' }}
              <span>{{ mapMode === 'hierarchy' ? '点击圆点展开' : '拖动节点编排' }}</span>
            </span>
            <div class="lore-zoom">
              <button type="button" title="缩小" @click="zoomOut">−</button>
              <button type="button" title="恢复 100%" @click="zoomReset">{{ zoomPercent }}%</button>
              <button type="button" title="放大" @click="zoomIn">+</button>
              <i />
              <button type="button" title="适应当前内容" @click="zoomFit">适应</button>
              <button type="button" title="聚焦当前条目" @click="zoomFocus">聚焦</button>
            </div>
          </div>
        </div>

        <aside class="lore-map-insp" aria-label="条目摘要">
          <header class="lore-map-insp-head">
            <OIcon name="map-pin" :size="12" />
            <span>条目摘要</span>
            <button class="lore-map-insp-close" type="button" title="收起摘要（回条目编写）" @click="switchView('write')">×</button>
          </header>
          <div v-if="node" class="lore-map-insp-scroll">
            <div class="lore-map-insp-crumbs">{{ crumbs.map((c) => c.text).join(' / ') }}</div>
            <h2 class="lore-map-insp-title">{{ (node.text || '').trim() || '（空节点）' }}</h2>
            <div v-if="(node.tags || []).length" class="lore-map-insp-tags">
              <button v-for="t in node.tags" :key="t" class="lore-detail-tag" type="button" :style="tagStyle(t)" @click="ui.mubuQuery = t">{{ t }}</button>
            </div>
            <p v-for="(p, i) in proseList" :key="'p' + i" class="lore-map-insp-p">{{ p }}</p>
            <section class="lore-map-insp-sec">
              <h3>关联关系 <small>{{ entries.length }}</small></h3>
              <LoreRelRows v-if="entries.length" :entries="entries" :hover-link="hoverLink" compact @pick="pickRel" @hover="onHoverRel" />
              <p v-else class="lore-map-insp-empty" style="padding: 0">暂无关联关系</p>
            </section>
            <section v-if="kids.length" class="lore-map-insp-sec">
              <h3>子条目 <small>{{ kids.length }}</small></h3>
              <button v-for="k in kids" :key="k.id" class="lore-map-insp-child" type="button" :title="k.text" @click="selectNode(k.id)">
                <span>{{ k.text }}</span>
                <OIcon name="caret-right" :size="11" />
              </button>
            </section>
          </div>
          <div v-else class="lore-map-insp-empty">选择导图节点查看内容</div>
          <footer class="lore-map-insp-foot">
            <button class="lore-btn primary" type="button" :disabled="!node" @click="openDetail(node && node.id)">查看完整详情</button>
            <button class="lore-icon" type="button" :disabled="!node" title="在条目中定位" @click="locate(node && node.id)"><OIcon name="map-pin" :size="13" /></button>
            <button class="lore-icon" type="button" :disabled="!node" title="添加关联关系" @click="openRelPanel"><OIcon name="link" :size="13" /></button>
          </footer>
        </aside>
      </div>
    </div>
  </div>
</template>
