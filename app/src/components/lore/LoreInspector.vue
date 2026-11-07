<!-- 条目摘要列（原型 .inspector / .detail-pane）——从 LoreWorkspace 的 .lore-map-insp 原样拆出的独立 pane：
     面板标题 / 面包屑 / 标题 / 标签 / 直属叶子段落 / 关联关系 / 子条目 / 面板底。
     收起与细轨由外层 aside 负责；「查看完整详情」「在条目中定位」通过事件交回外壳（后者要滚动 MubuView）。 -->
<script setup>
import { computed, ref } from 'vue'
import OIcon from '../OIcon.vue'
import LoreRelRows from '../LoreRelRows.vue'
import { useWorkStore } from '../../stores/work'
import { useUiStore } from '../../stores/ui'
import { jumpTo } from '../../services/doublelinks'
import { tagColor } from '../../services/tagcolors'

const emit = defineEmits(['open', 'locate', 'back'])
const work = useWorkStore()
const ui = useUiStore()

const hoverLink = ref(null)
const node = computed(() => (ui.loreActiveId ? work.mubu.find((n) => n.id === ui.loreActiveId && !n.deletedAt) || null : null))
const entries = computed(() => (node.value ? work.loreLinksOf('mubu', node.value.id) : []))
/** 面包屑：根 → … → 当前（只读展示） */
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
/** 摘要正文：直属叶子子条目的文字（与 B 同一口径，最多 3 段） */
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
function collapse() {
  ui.setPref('loreDetailClosed', true)
}
</script>

<template>
  <div class="lore-map-insp">
    <header class="lore-map-insp-head">
      <button class="lore-mobile-back" type="button" title="回到视觉导图" @click="emit('back')">‹ 视觉导图</button>
      <OIcon name="map-pin" :size="12" />
      <span>条目摘要</span>
      <button class="lore-map-insp-close" type="button" title="收起摘要" aria-label="收起摘要" @click="collapse">×</button>
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
      <button class="lore-btn primary" type="button" :disabled="!node" @click="emit('open', node && node.id)">查看完整详情</button>
      <button class="lore-icon" type="button" :disabled="!node" title="在条目中定位" @click="emit('locate', node && node.id)"><OIcon name="map-pin" :size="13" /></button>
      <button class="lore-icon" type="button" :disabled="!node" title="添加关联关系" @click="openRelPanel"><OIcon name="link" :size="13" /></button>
    </footer>
  </div>
</template>
