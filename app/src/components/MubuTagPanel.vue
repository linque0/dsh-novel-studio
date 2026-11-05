<script setup>
/* 设定标签面板（全局单例，ui.mubuTagPanel = { nodeId, x, y } 驱动；主窗口与面板窗口各挂一份）：
 * - 选择栏：标签池按创建时间升序 + 彩色卡片（与条目尾部同款）；3 列网格默认显示前 9 个，
 *   超过则「显示全部」就地展开；点击卡片即时切换该标签在当前节点上的应用（选中 = 实卡）。
 * - 创建栏：输入标签名后回车或点「创建」→ 新建（记录创建时间）并立即应用到当前节点。
 * - 整条头部按住可拖动（位置 session 记忆，重开后沿用）；点面板外 / Esc 关闭。 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { NButton } from 'naive-ui'
import { useWorkStore } from '../stores/work'
import { useUiStore } from '../stores/ui'
import { tagColor } from '../services/tagcolors'

const work = useWorkStore()
const ui = useUiStore()

const MAX_VISIBLE = 9
const panel = computed(() => ui.mubuTagPanel)
const node = computed(() => (panel.value ? work.mubu.find((n) => n.id === panel.value.nodeId && !n.deletedAt) || null : null))
const nodeTags = computed(() => node.value?.tags || [])
/** 选择栏标签 = 节点派生池 ∪ 创建时间表（创建过的标签始终可选，即使当前无节点使用 count=0） */
const all = computed(() => {
  const derived = work.mubuTags
  const seen = new Set(derived.map((t) => t.name))
  const extra = Object.keys(work.mubuTagMeta)
    .filter((n) => !seen.has(n))
    .map((n) => ({ name: n, color: tagColor(n), count: 0, createdAt: work.mubuTagMeta[n] || 0 }))
  return [...derived, ...extra].sort((a, b) => a.createdAt - b.createdAt || a.name.localeCompare(b.name))
})
const expanded = ref(false)
const shown = computed(() => (expanded.value ? all.value : all.value.slice(0, MAX_VISIBLE)))
const input = ref('')
const pos = ref({ x: 160, y: 160 })
let lastPos = null // session 级位置记忆（拖动一次后，重开面板沿用顺手位置）

const clampX = (x) => Math.min(Math.max(8, x), Math.max(8, window.innerWidth - 340))
const clampY = (y) => Math.min(Math.max(8, y), Math.max(8, window.innerHeight - 120))

watch(
  () => ui.mubuTagPanel,
  (p) => {
    if (!p) return
    const base = lastPos || { x: p.x, y: p.y }
    pos.value = { x: clampX(base.x), y: clampY(base.y) }
    expanded.value = false
    input.value = ''
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
/** 点卡片 = 切换应用（即时落库） */
function toggle(name) {
  if (!node.value) return
  const cur = nodeTags.value
  const next = cur.includes(name) ? cur.filter((x) => x !== name) : [...cur, name]
  work.mubuSetTags(node.value.id, next)
}
/** 创建栏：回车 / 点「创建」→ 新建并应用（重名则直接选中已有标签） */
async function create() {
  const t = await work.mubuCreateTag(input.value)
  if (!t || !node.value) return
  if (!nodeTags.value.includes(t)) work.mubuSetTags(node.value.id, [...nodeTags.value, t])
  input.value = ''
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
        <span>选择标签</span>
        <span class="mtp-hint">已选 {{ nodeTags.length }} / 共 {{ all.length }}</span>
      </div>
      <div class="mtp-box">
        <div v-if="all.length" class="mtp-grid">
          <button
            v-for="t in shown"
            :key="t.name"
            class="mtp-card"
            :class="{ on: isOn(t.name) }"
            type="button"
            :title="`${t.name} · ${t.count} 个节点${isOn(t.name) ? '（已选，点击取消）' : '（点击选用）'}`"
            :style="cardStyle(t.name)"
            @click="toggle(t.name)"
          >{{ t.name }}</button>
        </div>
        <div v-else class="mtp-empty">暂无标签，用下方创建栏新建</div>
        <button v-if="all.length > MAX_VISIBLE" class="mtp-more" type="button" @click="expanded = !expanded">
          {{ expanded ? '▴ 收起' : `▾ 显示全部（${all.length} 个）` }}
        </button>
      </div>
      <div class="mtp-label"><span>新建标签</span></div>
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
