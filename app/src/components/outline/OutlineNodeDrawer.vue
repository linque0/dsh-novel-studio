<!-- 分层大纲画布右侧设置抽屉：节点内容 / 事件状态与形状 / 容器颜色与层级动作。 -->
<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import OIcon from '../OIcon.vue'
import { CONTAINER_COLORS, EVENT_SHAPES, STATUS } from './outline-paper'

const props = defineProps({
  node: { type: Object, default: null },
  path: { type: Array, default: () => [] },
  stats: { type: Object, default: () => ({ total: 0, done: 0, blocks: 0, depth: 0, complete: false }) },
  connections: { type: Array, default: () => [] },
  parent: { type: Object, default: null },
  isMini: { type: Boolean, default: false }
})
const emit = defineEmits([
  'close', 'title', 'body', 'chapter', 'shape', 'status', 'color',
  'enter', 'toggle-inline', 'move-out', 'remove', 'reveal', 'inline-edit'
])

const armed = ref(false)
let timer = 0
watch(() => props.node?.id, () => {
  armed.value = false
  clearTimeout(timer)
})
onBeforeUnmount(() => clearTimeout(timer))

const isContainer = computed(() => props.node?.kind === 'container')
const isEvent = computed(() => props.node?.kind === 'event')
const pathText = computed(() => props.path.map((p) => p.title || '容器').join(' / '))
const kindLabel = computed(() => {
  if (!props.node) return ''
  if (isContainer.value) return '容器设置'
  return `${({ event: '事件', note: '便签', cite: '引用卡', textbox: '文本框', anchor: '章节锚点', volume: '卷' })[props.node.kind] || '模块'} · 内容`
})

function armDelete() {
  if (!armed.value) {
    armed.value = true
    clearTimeout(timer)
    timer = setTimeout(() => (armed.value = false), 3200)
    return
  }
  armed.value = false
  emit('remove')
}
</script>

<template>
  <aside v-if="node" class="oc-drawer" @mousedown.stop @contextmenu.prevent.stop>
    <header class="oc-drawer-head">
      <div class="oc-drawer-eyebrow">{{ kindLabel }}</div>
      <button class="oc-drawer-x" type="button" title="关闭设置" aria-label="关闭设置" @click="emit('close')">
        <OIcon name="close" :size="14" />
      </button>
      <h2>{{ node.title || '（未命名）' }}</h2>
      <p v-if="path.length > 1" class="oc-drawer-path">{{ pathText }}</p>
    </header>

    <label class="oc-field">
      <span>标题</span>
      <input :value="node.title || ''" maxlength="45" placeholder="模块标题" @input="emit('title', $event.target.value)" />
    </label>

    <template v-if="isContainer">
      <label class="oc-field">
        <span>章节标签</span>
        <input :value="node.chapter || ''" maxlength="24" placeholder="如：第 1—3 章" @input="emit('chapter', $event.target.value)" />
      </label>
      <div class="oc-field">
        <span>容器颜色</span>
        <div class="oc-color-row">
          <button
            v-for="[color, name] in CONTAINER_COLORS"
            :key="color"
            class="oc-color-dot"
            type="button"
            :class="{ on: (node.color || '') === color }"
            :style="{ '--swatch': color }"
            :title="name"
            :aria-label="name"
            :aria-pressed="(node.color || '') === color"
            @click="emit('color', color)"
          />
          <button class="oc-color-auto" type="button" title="恢复自动配色" @click="emit('color', '')">自动</button>
        </div>
      </div>
      <label class="oc-field">
        <span>收起时的摘要</span>
        <textarea :value="node.text || ''" rows="4" maxlength="400" placeholder="这一段情节的一句话摘要" @input="emit('body', $event.target.value)" />
      </label>
      <div class="oc-drawer-actions">
        <button type="button" class="oc-quiet primary" @click="emit('enter')"><OIcon name="arrow-right" :size="13" /> 进入容器</button>
        <button type="button" class="oc-quiet" @click="emit('toggle-inline')">{{ props.isMini ? '收起内容' : '就地展开' }}</button>
        <button v-if="parent" type="button" class="oc-quiet" @click="emit('move-out')">移出上一层</button>
      </div>
      <div class="oc-stats">
        <div><span>内部事件</span><b>{{ stats.total }} 个</b></div>
        <div><span>已完成</span><b>{{ stats.done }} / {{ stats.total }}</b></div>
        <div v-if="stats.blocks"><span>嵌套容器</span><b>{{ stats.blocks }} 个</b></div>
        <div v-if="stats.depth"><span>嵌套深度</span><b>{{ stats.depth }} 层</b></div>
      </div>
    </template>

    <template v-else>
      <div v-if="isEvent" class="oc-field-row">
        <label class="oc-field">
          <span>事件形状</span>
          <select :value="node.shape || 'process'" @change="emit('shape', $event.target.value)">
            <option v-for="(s, key) in EVENT_SHAPES" :key="key" :value="key">{{ s.label }}</option>
          </select>
        </label>
        <label class="oc-field">
          <span>写作状态</span>
          <select :value="node.status || ''" @change="emit('status', $event.target.value)">
            <option value="">未标记</option>
            <option v-for="(label, key) in STATUS" :key="key" :value="key">{{ label }}</option>
          </select>
        </label>
      </div>
      <label class="oc-field">
        <span>内容</span>
        <textarea :value="node.text || ''" rows="5" maxlength="800" placeholder="这一幕发生了什么…" @input="emit('body', $event.target.value)" />
      </label>
      <button type="button" class="oc-quiet wide" @click="emit('inline-edit')"><OIcon name="edit" :size="13" /> 在画布内编辑文字</button>
    </template>

    <h3 class="oc-drawer-sub">外部联系 · {{ connections.length }}</h3>
    <div v-if="connections.length" class="oc-connection-list">
      <div v-for="c in connections" :key="c.id + c.direction + c.otherId" class="oc-connection">
        <small>{{ c.kind }} · {{ c.direction === 'in' ? '前接' : '后续' }}<template v-if="c.label"> · {{ c.label }}</template></small>
        <button type="button" @click="emit('reveal', c.otherId)">{{ c.otherTitle || c.otherId }} ↗</button>
        <em v-if="c.otherPath">{{ c.otherPath }}</em>
      </div>
    </div>
    <p v-else class="oc-drawer-empty">{{ isContainer ? '暂无跨出这个容器的连线。' : '暂无外部联系。' }}</p>

    <footer class="oc-drawer-foot">
      <button type="button" class="oc-quiet danger" :class="{ confirming: armed }" @click="armDelete">
        <OIcon name="trash" :size="13" /> {{ armed ? '再点一次确认删除' : (isContainer ? '删除容器及内部' : '删除模块') }}
      </button>
    </footer>
  </aside>
</template>
