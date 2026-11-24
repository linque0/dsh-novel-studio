<script setup>
/* 设定标签面板（全局单例，ui.mubuTagPanel = { nodeId, x, y } 驱动；主窗口与面板窗口各挂一份）：
 * - 条目权重：五档分段选择器（核心/关键/标准/点缀/末节），自动跟随已绑标签权重，也支持条目级快捷覆盖。
 * - 选择栏：标签池按创建时间升序 + 彩色卡片（非标准权重附带 12px 几何微图标）；支持点击应用与右键/微钮编辑标签权重。
 * - 创建栏：输入标签名并附带选择重要度（默认标准），回车或点「创建」→ 新建并立即应用到当前节点。
 * - 整条头部按住可拖动（位置 session 记忆，重开后沿用）；点面板外 / Esc 关闭。 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { NButton } from 'naive-ui'
import LoreWeightIcon from './LoreWeightIcon.vue'
import { useWorkStore } from '../stores/work'
import { useUiStore } from '../stores/ui'
import { tagColor } from '../services/tagcolors'
import {
  DEFAULT_ENTRY_WEIGHT,
  deriveWeightFromTags,
  ENTRY_WEIGHTS,
  entryWeightMeta,
  isValidEntryWeight,
  tagMetaCreatedAt,
  tagMetaWeight
} from '../services/lore-weights.js'

const work = useWorkStore()
const ui = useUiStore()

const MAX_VISIBLE = 9
const panel = computed(() => ui.mubuTagPanel)
const node = computed(() => (panel.value ? work.mubu.find((n) => n.id === panel.value.nodeId && !n.deletedAt) || null : null))
const nodeTags = computed(() => node.value?.tags || [])
const derivedWeight = computed(() => deriveWeightFromTags(nodeTags.value, work.mubuTagMeta))
const hasExplicitWeight = computed(() => isValidEntryWeight(node.value?.weight))
const effectiveWeight = computed(() => work.mubuEntryWeight(node.value))
const effectiveMeta = computed(() => entryWeightMeta(effectiveWeight.value))

/** 选择栏标签 = 节点派生池 ∪ 创建时间表（创建过的标签始终可选，即使当前无节点使用 count=0） */
const all = computed(() => {
  const derived = work.mubuTags
  const seen = new Set(derived.map((t) => t.name))
  const extra = Object.keys(work.mubuTagMeta)
    .filter((n) => !seen.has(n))
    .map((n) => ({
      name: n,
      color: tagColor(n),
      count: 0,
      createdAt: tagMetaCreatedAt(work.mubuTagMeta[n]),
      weight: tagMetaWeight(work.mubuTagMeta[n])
    }))
  return [...derived, ...extra].sort((a, b) => a.createdAt - b.createdAt || a.name.localeCompare(b.name))
})
const expanded = ref(false)
const shown = computed(() => (expanded.value ? all.value : all.value.slice(0, MAX_VISIBLE)))
const input = ref('')
const newTagWeight = ref(DEFAULT_ENTRY_WEIGHT)
const editingTag = ref('')
const editingTagWeight = computed(() => (editingTag.value ? work.mubuTagWeight(editingTag.value) : DEFAULT_ENTRY_WEIGHT))
const pos = ref({ x: 160, y: 160 })
let lastPos = null // session 级位置记忆（拖动一次后，重开面板沿用顺手位置）

const clampX = (x) => Math.min(Math.max(8, x), Math.max(8, window.innerWidth - 356))
const clampY = (y) => Math.min(Math.max(8, y), Math.max(8, window.innerHeight - 160))

watch(
  () => ui.mubuTagPanel,
  (p) => {
    if (!p) return
    const base = lastPos || { x: p.x, y: p.y }
    pos.value = { x: clampX(base.x), y: clampY(base.y) }
    expanded.value = false
    input.value = ''
    newTagWeight.value = DEFAULT_ENTRY_WEIGHT
    editingTag.value = ''
  }
)

function isOn(name) {
  return nodeTags.value.includes(name)
}
function cardStyle(name) {
  const on = isOn(name)
  const c = tagColor(name)
  return {
    color: c,
    borderColor: `color-mix(in srgb, ${c} ${on ? 55 : 30}%, transparent)`,
    background: `color-mix(in srgb, ${c} ${on ? 15 : 6}%, transparent)`
  }
}
function pickEntryWeight(w) {
  if (!node.value) return
  if (w === derivedWeight.value) work.mubuSetWeight(node.value.id, null)
  else work.mubuSetWeight(node.value.id, w)
}
function resetEntryWeight() {
  if (!node.value) return
  work.mubuSetWeight(node.value.id, null)
}
/** 点卡片 = 切换应用（即时落库） */
function toggle(name) {
  if (!node.value) return
  const cur = nodeTags.value
  const next = cur.includes(name) ? cur.filter((x) => x !== name) : [...cur, name]
  work.mubuSetTags(node.value.id, next)
}
function toggleEditTag(name) {
  editingTag.value = editingTag.value === name ? '' : name
}
async function setTagWeight(weight) {
  if (!editingTag.value) return
  await work.mubuSetTagWeight(editingTag.value, weight)
}
/** 创建栏：回车 / 点「创建」→ 新建（附带权重）并应用（重名则同步权重并选中已有标签） */
async function create() {
  const t = await work.mubuCreateTag(input.value, newTagWeight.value)
  if (!t || !node.value) return
  if (!nodeTags.value.includes(t)) work.mubuSetTags(node.value.id, [...nodeTags.value, t])
  input.value = ''
  newTagWeight.value = DEFAULT_ENTRY_WEIGHT
}
function close() {
  ui.mubuTagPanel = null
}

/* 拖动（整条头部；位置限制在视口内） */
const drag = ref(null)
function startDrag(e) {
  if (e.button !== 0) return
  drag.value = { dx: e.clientX - pos.value.x, dy: e.clientY - pos.value.y }
  window.addEventListener('mousemove', onDrag)
  window.addEventListener('mouseup', stopDrag)
}
function onDrag(e) {
  if (!drag.value) return
  pos.value = { x: clampX(e.clientX - drag.value.dx), y: clampY(e.clientY - drag.value.dy) }
}
function stopDrag() {
  if (drag.value) lastPos = { ...pos.value }
  drag.value = null
  window.removeEventListener('mousemove', onDrag)
  window.removeEventListener('mouseup', stopDrag)
}

/* 点面板外 / Esc 关闭（面板内与拖拽不误关） */
function onDocDown(e) {
  if (!ui.mubuTagPanel) return
  const el = document.getElementById('mubu-tag-panel')
  if (el && !el.contains(e.target)) close()
}
function onKey(e) {
  if (e.key !== 'Escape' || !ui.mubuTagPanel) return
  if (document.querySelector('.n-modal')) return // 其他弹窗（改名等）自行处理
  close()
}
onMounted(() => {
  document.addEventListener('mousedown', onDocDown, true)
  window.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocDown, true)
  window.removeEventListener('keydown', onKey)
  stopDrag()
})
</script>

<template>
  <div
    v-if="panel && node"
    id="mubu-tag-panel"
    class="mtp-panel" :class="[{ dragging: !!drag }]"
    :style="{ left: pos.x + 'px', top: pos.y + 'px' }"
    @contextmenu.prevent
  >
    <div class="mtp-head" title="按住拖动面板" @mousedown="startDrag">
      <span class="mtp-grip" aria-hidden="true">⠿</span>
      <span class="mtp-title" :title="node.text || ''">标签 · {{ node.text || '（空节点）' }}</span>
      <button class="mtp-close" type="button" title="关闭（Esc）" @mousedown.stop @click="close">×</button>
    </div>
    <div class="mtp-body">
      <div class="mtp-label">
        <span>条目权重</span>
        <span class="mtp-hint">
          <template v-if="hasExplicitWeight">
            单独指定 · <button type="button" class="mtp-inline-link" @click="resetEntryWeight">跟随标签</button>
          </template>
          <template v-else-if="derivedWeight !== 'standard'">
            由标签推导（{{ effectiveMeta.label }}）
          </template>
          <template v-else>默认标准</template>
        </span>
      </div>
      <div class="mtp-weight-seg" role="radiogroup" aria-label="条目权重">
        <button
          v-for="w in ENTRY_WEIGHTS"
          :key="w.id"
          type="button"
          role="radio"
          class="mtp-weight-btn"
          :class="[`is-${w.id}`, { active: effectiveWeight === w.id }]"
          :aria-checked="effectiveWeight === w.id"
          :title="`${w.label}（${w.concept}）`"
          @click="pickEntryWeight(w.id)"
        >
          <LoreWeightIcon :weight="w.id" :size="12" />
          <span>{{ w.label }}</span>
        </button>
      </div>

      <div class="mtp-label">
        <span>选择标签</span>
        <span class="mtp-hint">已选 {{ nodeTags.length }} / 共 {{ all.length }} · 右键改权重</span>
      </div>
      <div class="mtp-box">
        <div v-if="all.length" class="mtp-grid">
          <div
            v-for="t in shown"
            :key="t.name"
            class="mtp-card-wrap"
            :class="{ editing: editingTag === t.name }"
          >
            <button
              class="mtp-card"
              :class="{ on: isOn(t.name) }"
              type="button"
              :title="`${t.name}${t.weight !== 'standard' ? ` · ${entryWeightMeta(t.weight).label}` : ''} · ${t.count} 个节点${isOn(t.name) ? '（已选，点击取消；右键编辑权重）' : '（点击选用；右键编辑权重）'}`"
              :style="cardStyle(t.name)"
              @click="toggle(t.name)"
              @contextmenu.prevent.stop="toggleEditTag(t.name)"
            >
              <LoreWeightIcon v-if="t.weight !== 'standard'" :weight="t.weight" :size="11" class="mtp-card-wi" />
              <span class="mtp-card-name">{{ t.name }}</span>
            </button>
            <button
              type="button"
              class="mtp-card-edit"
              :class="{ active: editingTag === t.name }"
              :title="`编辑「${t.name}」的权重`"
              :aria-label="`编辑「${t.name}」的权重`"
              @click.stop="toggleEditTag(t.name)"
            >···</button>
          </div>
        </div>
        <div v-else class="mtp-empty">暂无标签，用下方创建栏新建</div>
        <div v-if="editingTag" class="mtp-tag-editor">
          <div class="mtp-tag-editor-head">
            <span>「{{ editingTag }}」权重</span>
            <button type="button" class="mtp-inline-link" @click="editingTag = ''">完成</button>
          </div>
          <div class="mtp-weight-seg compact" role="radiogroup" :aria-label="`编辑标签「${editingTag}」权重`">
            <button
              v-for="w in ENTRY_WEIGHTS"
              :key="w.id"
              type="button"
              role="radio"
              class="mtp-weight-btn"
              :class="[`is-${w.id}`, { active: editingTagWeight === w.id }]"
              :aria-checked="editingTagWeight === w.id"
              @click="setTagWeight(w.id)"
            >
              <LoreWeightIcon :weight="w.id" :size="11" />
              <span>{{ w.label }}</span>
            </button>
          </div>
        </div>
        <button v-if="all.length > MAX_VISIBLE" class="mtp-more" type="button" @click="expanded = !expanded">
          {{ expanded ? '▴ 收起' : `▾ 显示全部（${all.length} 个）` }}
        </button>
      </div>
      <div class="mtp-label">
        <span>新建标签</span>
        <span class="mtp-hint">附带重要度：{{ entryWeightMeta(newTagWeight).label }}</span>
      </div>
      <div class="mtp-weight-seg compact" role="radiogroup" aria-label="新建标签重要度">
        <button
          v-for="w in ENTRY_WEIGHTS"
          :key="w.id"
          type="button"
          role="radio"
          class="mtp-weight-btn"
          :class="[`is-${w.id}`, { active: newTagWeight === w.id }]"
          :aria-checked="newTagWeight === w.id"
          :title="`新建标签重要度：${w.label}`"
          @click="newTagWeight = w.id"
        >
          <LoreWeightIcon :weight="w.id" :size="11" />
          <span>{{ w.label }}</span>
        </button>
      </div>
      <div class="mtp-create">
        <input
          v-model="input"
          class="rp-input"
          type="text"
          maxlength="20"
          placeholder="输入标签名，回车或点「创建」"
          spellcheck="false"
          @keydown.enter="create"
        />
        <NButton size="small" type="primary" :disabled="!input.trim()" @click="create">创建</NButton>
      </div>
    </div>
  </div>
</template>
