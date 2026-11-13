<!-- 卷宗视图·右列「关系与设定」：小型关系网 / 人物关系 CRUD / 关联设定跳转。
     设计真值 docs/前端美化/人物-融合总稿-20261105/app.mjs:38 的非 graph 分支；
     外观度量见 chars-context.css。
     外壳只读：select 切人物、setView 进关系剧场、backToMain 回卷宗；
     窄档三段工具条走可选的 shell.setBar（D1 补齐前由页头返回键兜底）。 -->
<script setup>
import { computed, inject, onBeforeUnmount, onMounted, ref, watch, watchEffect } from 'vue'
import OIcon from '../OIcon.vue'
import { useWorkStore } from '../../stores/work'
import { EDGE_STYLES } from '../outline/canvas-model'
import { jumpTo } from '../../services/doublelinks'

const shell = inject('charShell', null)
const work = useWorkStore()
const current = computed(() => work.activeCharacter)
const isNarrow = computed(() => !!shell?.narrow?.value)
const subtitle = computed(() => (current.value ? (current.value.name || '未命名') + '的故事坐标' : '未选择人物'))

/* 一度邻居：人物关系两向取对端，已删除的人物不入列表 */
const rels = computed(() => {
  const me = current.value
  if (!me) return []
  return work.relations
    .filter((r) => r.fromId === me.id || r.toId === me.id)
    .map((r) => ({ ...r, other: work.characters.find((x) => x.id === (r.fromId === me.id ? r.toId : r.fromId) && !x.deletedAt) || null }))
    .filter((r) => !!r.other)
})
const lore = computed(() => (current.value ? work.loreLinksOf('character', current.value.id) : []))
const candidates = computed(() => work.liveCharacters.filter((c) => c.id !== current.value?.id))

const networkCenter = { x: 130, y: 60 }
/* 左右分布两点，三个及以上时沿椭圆布点，给中心卡片留出空间。 */
const net = computed(() => {
  const list = rels.value.slice(0, 6)
  const step = 360 / Math.max(list.length, 1)
  return list.map((r, i) => {
    const a = (((list.length > 2 ? -90 : 0) + step * i) * Math.PI) / 180
    return {
      key: r.id, id: r.other.id, name: r.other.name || '未命名',
      x: networkCenter.x + 103 * Math.cos(a), y: networkCenter.y + 38 * Math.sin(a)
    }
  })
})
const centerInitial = computed(() => (current.value?.name || '人').slice(0, 1))

/* 线色沿用原关系图的 REL_COLORS 同一套色板：空串 = 跟随主题 */
const REL_COLORS = ['', '#2980b9', '#c0392b', '#8e44ad', '#d35400', '#27ae60', '#7f8c8d']
const edgeStyles = EDGE_STYLES

const menuId = ref(null)
const delAsk = ref(null)
const adding = ref(false)
const addOther = ref('')
const addLabel = ref('')

function pick(id) {
  shell?.select?.(id)
}
function toggleMenu(id) {
  menuId.value = menuId.value === id ? null : id
  delAsk.value = null
}
function setLabel(id, event) {
  const v = String(event.target.value || '').trim().slice(0, 12)
  work.updateRelation(id, { label: v || '关联' })
}
function setStyle(id, key) {
  work.updateRelation(id, { style: key })
}
function setColor(id, color) {
  work.updateRelation(id, { color })
}
function askDelete(id) {
  if (delAsk.value !== id) {
    delAsk.value = id
    return
  }
  work.removeRelation(id)
  menuId.value = null
  delAsk.value = null
}
function openAdd() {
  adding.value = true
  addOther.value = candidates.value[0]?.id || ''
  addLabel.value = ''
}
function commitAdd() {
  if (!current.value || !addOther.value) return
  work.addRelation(current.value.id, addOther.value, (addLabel.value || '').trim() || '关联')
  adding.value = false
}
function openLore(row) {
  jumpTo({ kind: row.otherKind, id: row.otherId })
}
function kindText(kind) {
  return kind === 'mubu' ? '设定' : '人物'
}
function avatarOf(c) {
  void work.urlTick
  return c?.avatarAssetId ? work.assetUrl(c.avatarAssetId) : ''
}
function toGraph() {
  const c = current.value
  if (c) {
    work.charFocusId = c.id
    work.charFocusTick++
  }
  shell?.setView?.('graph')
}
function backToDossier() {
  shell?.backToMain?.()
}

/* 关系 ⋯ 菜单：点空白处收起 */
function onDocPointer(e) {
  if (!menuId.value) return
  if (e.target instanceof Element && e.target.closest('.rel-menu, .rel-more')) return
  menuId.value = null
  delAsk.value = null
}
onMounted(() => document.addEventListener('pointerdown', onDocPointer))
onBeforeUnmount(() => document.removeEventListener('pointerdown', onDocPointer))

/* 头像走 indexDB 资产：先预热再渲染（assetUrl 依赖 urlTick 触发刷新） */
watch(
  rels,
  (list) => {
    const ids = [current.value?.avatarAssetId, ...list.map((r) => r.other.avatarAssetId)].filter(Boolean)
    if (ids.length) work.warmUrls(ids)
  },
  { immediate: true }
)

/* 窄档第二屏的三段工具条（可选能力，D1 未挂 setBar 时静默跳过） */
watchEffect(() => {
  if (!isNarrow.value) return
  const title = current.value?.name || '关系与设定'
  shell?.setBar?.({
    left: { label: '‹ 人物卷宗', act: () => shell?.backToMain?.() },
    title,
    right: { label: '关系剧场', act: () => shell?.setView?.('graph') }
  })
})
</script>

<template>
  <div class="char-context char-side">
    <header class="inspector-label">
      <div class="inspector-identity">
        <span class="inspector-heading"><OIcon name="network" :size="14" /><span>关系与设定</span></span>
        <small class="context-sub">{{ subtitle }}</small>
      </div>
      <button v-if="isNarrow" type="button" class="ctx-back" title="返回人物卷宗" @click="backToDossier">
        <OIcon name="back" :size="14" /><span>卷宗</span>
      </button>
    </header>

    <div class="context-scroll" data-char-scroll="context">
      <template v-if="current">
        <svg class="mini-network" viewBox="0 0 260 120" role="group" :aria-label="current.name + '的一度关系'">
          <line v-for="p in net" :key="'l' + p.key" :x1="networkCenter.x" :y1="networkCenter.y" :x2="p.x" :y2="p.y" />
          <rect class="net-center" :x="networkCenter.x - 17" :y="networkCenter.y - 17" width="34" height="34" rx="7" />
          <text class="net-initial" :x="networkCenter.x" :y="networkCenter.y">{{ centerInitial }}</text>
          <g v-for="p in net" :key="p.key" class="net-node" role="button" tabindex="0" :aria-label="p.name" @click="pick(p.id)" @keydown.enter.prevent="pick(p.id)" @keydown.space.prevent="pick(p.id)">
            <circle class="net-hit" :cx="p.x" :cy="p.y" r="10" />
            <circle :cx="p.x" :cy="p.y" r="4.5" />
            <title>{{ p.name }}</title>
          </g>
        </svg>

        <section class="context-section">
          <div class="section-head">
            <h3>人物关系</h3>
            <small>{{ rels.length }}</small>
            <button type="button" class="section-add" title="添加人物关系" @click="openAdd"><OIcon name="plus" :size="13" /></button>
          </div>
          <div v-if="adding" class="rel-add">
            <select v-model="addOther" aria-label="选择人物">
              <option v-for="c in candidates" :key="c.id" :value="c.id">{{ c.name || '未命名' }}</option>
            </select>
            <input v-model="addLabel" maxlength="12" placeholder="师徒 / 宿敌" aria-label="关系标签" @keyup.enter="commitAdd" />
            <button type="button" class="btn tiny" :disabled="!candidates.length" @click="commitAdd">添加</button>
            <button type="button" class="btn tiny soft" @click="adding = false">取消</button>
          </div>
          <div class="relation-list">
            <div v-for="r in rels" :key="r.id" class="relation-row">
              <button type="button" class="relation-pick" :title="'查看 ' + (r.other.name || '未命名')" @click="pick(r.other.id)">
                <span class="ctx-portrait">
                  <img v-if="avatarOf(r.other)" :src="avatarOf(r.other)" :alt="r.other.name || '人物头像'" />
                  <span v-else>{{ (r.other.name || '人').slice(0, 1) }}</span>
                </span>
                <span class="relation-copy">
                  <strong>{{ r.other.name || '未命名' }}</strong>
                  <small>{{ r.label || '关联' }}</small>
                </span>
                <i class="rel-dot" :style="r.color ? { background: r.color } : null" aria-hidden="true"></i>
              </button>
              <button type="button" class="icon-btn rel-more" title="编辑或移除关系" @click="toggleMenu(r.id)"><OIcon name="dots" :size="14" /></button>
              <div v-if="menuId === r.id" class="rel-menu">
                <label class="rel-field">
                  <span>关系标签</span>
                  <input :value="r.label" maxlength="12" placeholder="师徒 / 宿敌" @change="setLabel(r.id, $event)" />
                </label>
                <div class="rel-field">
                  <span>线型</span>
                  <div class="rel-chips">
                    <button v-for="s in edgeStyles" :key="s.key" type="button" class="chip" :class="{ on: (r.style || 'solid') === s.key }" @click="setStyle(r.id, s.key)">{{ s.label }}</button>
                  </div>
                </div>
                <div class="rel-field">
                  <span>线色</span>
                  <div class="rel-colors">
                    <button
                      v-for="col in REL_COLORS"
                      :key="col || 'theme'"
                      type="button"
                      class="swatch"
                      :class="{ on: (r.color || '') === col, theme: !col }"
                      :style="col ? { background: col } : null"
                      :title="col || '跟随主题'"
                      @click="setColor(r.id, col)"
                    ></button>
                  </div>
                </div>
                <button type="button" class="rel-del" :class="{ asking: delAsk === r.id }" @click="askDelete(r.id)">
                  {{ delAsk === r.id ? '确认删除' : '删除关系' }}
                </button>
              </div>
            </div>
            <p v-if="!rels.length" class="tiny-empty">还没有人物关系</p>
          </div>
        </section>

        <section class="context-section">
          <div class="section-head">
            <h3>关联设定</h3>
            <small>{{ lore.length }}</small>
          </div>
          <div class="lore-list">
            <button v-for="row in lore" :key="row.linkId" type="button" class="lore-row" :title="row.description || row.otherTitle" @click="openLore(row)">
              <OIcon :name="row.otherKind === 'mubu' ? 'layers' : 'user'" :size="14" />
              <span class="lore-copy">
                <strong>{{ row.otherTitle }}</strong>
                <small>{{ row.label || '关联' }} · {{ kindText(row.otherKind) }}</small>
              </span>
              <OIcon name="caret-right" :size="12" />
            </button>
            <p v-if="!lore.length" class="tiny-empty">还没有关联设定</p>
          </div>
        </section>
      </template>

      <p v-else class="ctx-empty">选择人物后，在这里查看关系与设定。</p>
    </div>

    <footer class="pane-foot">
      <span>{{ rels.length }} 条关系 · {{ lore.length }} 条设定</span>
      <button type="button" class="btn" :disabled="!current" @click="toGraph">在关系图中查看</button>
    </footer>
  </div>
</template>
