<script setup>
/* 关联关系设置面板（全局单例，ui.loreRelationPanel = { kind, id, x, y } 驱动；主窗口与面板窗口各挂一份）：
 * - 已有关系：出向/入向统一列出（入向按反向名展示），行尾 × 即删
 * - 新建关系：搜索目标（设定 + 人物）→ 类型（预设 chips，可自定义 + 反向名）→ 描述 → 添加
 * - 整条头部按住可拖动（位置 session 记忆）；点面板外 / Esc 关闭（naive 下拉等 body 级浮层不算点外） */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { NButton, NInput, NSelect } from 'naive-ui'
import OIcon from './OIcon.vue'
import LoreRelRows from './LoreRelRows.vue'
import { useWorkStore } from '../stores/work'
import { useUiStore } from '../stores/ui'
import { REL_PRESETS, relKindLabel } from '../services/relation-kinds'

const work = useWorkStore()
const ui = useUiStore()

const panel = computed(() => ui.loreRelationPanel)
const kind = computed(() => panel.value?.kind || 'mubu')
const entity = computed(() => {
  const p = panel.value
  if (!p) return null
  if (p.kind === 'mubu') return work.mubu.find((n) => n.id === p.id && !n.deletedAt) || null
  return work.characters.find((c) => c.id === p.id && !c.deletedAt) || null
})
const title = computed(() => {
  if (!entity.value) return ''
  return kind.value === 'mubu' ? (entity.value.text || '（空节点）') : (entity.value.name || '未命名')
})
const entries = computed(() => (panel.value ? work.loreLinksOf(kind.value, panel.value.id) : []))

/* 目标候选：全库设定 + 人物（排除自身） */
const targetOptions = computed(() => {
  const p = panel.value
  const out = []
  for (const n of work.liveMubu()) {
    if (p?.kind === 'mubu' && n.id === p.id) continue
    out.push({ label: ((n.text || '（空节点）').slice(0, 24)) + '（设定）', value: 'mubu:' + n.id })
  }
  for (const c of work.liveCharacters) {
    if (p?.kind === 'character' && c.id === p.id) continue
    out.push({ label: (c.name || '未命名') + '（人物）', value: 'character:' + c.id })
  }
  return out
})

const target = ref(null)
const label = ref('')
const reverse = ref('')
const desc = ref('')

/** 预设 chips：点选即用（再点取消）；自定义类型直接改输入框 */
function pickPreset(p) {
  if (label.value === p.label) {
    label.value = ''
    reverse.value = ''
  } else {
    label.value = p.label
    reverse.value = p.reverse || ''
  }
}
function add() {
  const p = panel.value
  if (!p || !target.value || !label.value.trim()) return
  const [k, id] = String(target.value).split(':')
  work.addLoreLink({ fromKind: kind.value, fromId: p.id, toKind: k, toId: id, label: label.value, reverseLabel: reverse.value, description: desc.value })
  target.value = null
  desc.value = ''
}
function remove(linkId) {
  work.removeLoreLink(linkId)
}
function close() {
  ui.loreRelationPanel = null
}

/* 拖动（整条头部；位置限制在视口内） */
const pos = ref({ x: 220, y: 160 })
let lastPos = null // session 级位置记忆（拖动一次后，重开面板沿用顺手位置）
const drag = ref(null)
const clampX = (x) => Math.min(Math.max(8, x), Math.max(8, window.innerWidth - 380))
const clampY = (y) => Math.min(Math.max(8, y), Math.max(8, window.innerHeight - 160))

watch(
  () => ui.loreRelationPanel,
  (p) => {
    if (!p) return
    const base = lastPos || { x: p.x, y: p.y }
    pos.value = { x: clampX(base.x), y: clampY(base.y) }
    target.value = null
    label.value = ''
    reverse.value = ''
    desc.value = ''
  }
)
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

/* 点面板外 / Esc 关闭（面板内、拖拽与 naive 下拉浮层不误关） */
function onDocDown(e) {
  if (!ui.loreRelationPanel) return
  const el = document.getElementById('lore-rel-panel')
  if (!el || el.contains(e.target)) return
  if (e.target.closest?.('.n-base-select-menu, .n-popover, .v-binder-follower-container, .v-binder-follower-content')) return
  close()
}
function onKey(e) {
  if (e.key !== 'Escape' || !ui.loreRelationPanel) return
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
    v-if="panel && entity"
    id="lore-rel-panel"
    class="lrp-panel" :class="[{ dragging: !!drag }]"
    :style="{ left: pos.x + 'px', top: pos.y + 'px' }"
    @contextmenu.prevent
  >
    <div class="lrp-head" title="按住拖动面板" @mousedown="startDrag">
      <span class="lrp-grip" aria-hidden="true">⠿</span>
      <span class="lrp-title" :title="title">关联关系 · {{ title }}</span>
      <button class="lrp-close" type="button" title="关闭（Esc）" @mousedown.stop @click="close">×</button>
    </div>
    <div class="lrp-body">
      <div class="lrp-label">
        <span>已有关系</span>
        <span class="lrp-hint">{{ entries.length }} 条</span>
      </div>
      <div class="lrp-box">
        <LoreRelRows v-if="entries.length" :entries="entries" removable :clickable="false" @remove="remove" />
        <div v-else class="lrp-empty">暂无关联关系，用下方新建</div>
      </div>
      <div class="lrp-label">
        <span>新建关系</span>
        <span class="lrp-hint">当前：{{ relKindLabel(kind) }}</span>
      </div>
      <NSelect v-model:value="target" :options="targetOptions" filterable size="small" placeholder="搜索目标（设定 / 人物）" />
      <div class="lrp-chips">
        <span
          v-for="p in REL_PRESETS"
          :key="p.label"
          class="lrp-chip"
          :class="{ on: label === p.label }"
          @click="pickPreset(p)"
        ><OIcon :name="p.icon" :size="11" />{{ p.label }}</span>
      </div>
      <div class="lrp-row2">
        <NInput v-model:value="label" size="small" placeholder="关系类型（可自定义）" :maxlength="12" />
        <NInput v-model:value="reverse" size="small" placeholder="反向名（可选）" :maxlength="12" />
      </div>
      <NInput v-model:value="desc" size="small" placeholder="描述（可选，如：大陆东南沿海）" :maxlength="120" />
      <div class="lrp-actions">
        <NButton size="small" type="primary" :disabled="!target || !label.trim()" @click="add">添加</NButton>
      </div>
    </div>
  </div>
</template>
