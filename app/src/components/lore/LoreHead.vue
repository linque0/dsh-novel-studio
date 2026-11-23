<!-- 设定工作区统一页头：展示历史前进/后退、常规面包屑或星系层级面包屑，
     提供视图切换（节点大纲/阅读视图/视觉导图）、引用链接面板开关及导图工具条插槽。 -->
<script setup>
import { computed } from 'vue'
import OIcon from '../OIcon.vue'
import { useWorkStore } from '../../stores/work'
import { useUiStore } from '../../stores/ui'
defineProps({ compact: Boolean, narrow: Boolean, navOpen: Boolean, galaxy: Object })
const emit = defineEmits(['view', 'scope', 'new', 'clear-filter', 'nav', 'focus-branch', 'galaxy-center'])
const work = useWorkStore(), ui = useUiStore()
const current = computed(() => work.mubu.find(n => n.id === (ui.loreView === 'write' ? ui.loreRootId : ui.loreActiveId) && !n.deletedAt))
const all = computed(() => ui.loreScope === 'all' && ui.loreView === 'write')
const title = computed(() => ui.loreView === 'map' ? '视觉导图' : all.value ? '全部条目' : current.value?.text || '世界设定')
const path = computed(() => all.value ? [] : work.mubuPath(current.value?.id).filter(n => !n.deletedAt))
function enter(id) { emit('focus-branch', id) }
</script>
<template>
  <header class="lore-head lore-free-head" :class="{ 'lore-head--compact': compact, 'lore-head--map': ui.loreView === 'map' }">
    <div class="lore-head-main">
      <div class="lore-crumbs lore-free-crumbs"><div class="lore-history"><button :disabled="!ui.loreReturn.length" aria-label="后退" title="后退 Alt+←" @click="ui.loreBack()"><OIcon name="arrow-left" :size="13" /></button><button :disabled="!ui.loreForward.length" aria-label="前进" title="前进 Alt+→" @click="ui.loreNext()"><OIcon name="arrow-right" :size="13" /></button></div><button class="lore-crumb-nav" :aria-expanded="narrow ? navOpen : !ui.loreNavClosed" @click="emit('nav')">世界设定</button><template v-for="n in galaxy ? [] : path" :key="n.id"><i>›</i><button :title="n.text" :aria-current="n.id === current?.id ? 'page' : undefined" @click="enter(n.id)">{{ (n.text || '空节点').slice(0, 14) }}</button></template>
        <nav v-if="galaxy" class="lore-galaxy-crumbs" aria-label="星系层级">
          <button v-if="galaxy.path.length" type="button" @click="emit('galaxy-center', null)">{{ work.work?.title || '条目总览' }}</button>
          <span v-else aria-current="location">{{ work.work?.title || '条目总览' }}</span>
          <template v-for="(item, index) in galaxy.path" :key="item.id">
            <i aria-hidden="true">›</i>
            <span v-if="index === galaxy.path.length - 1" aria-current="location">{{ item.title }}</span>
            <button v-else type="button" @click="emit('galaxy-center', item.id)">{{ item.title }}</button>
          </template>
        </nav>
      </div>
      <template v-if="galaxy">
        <h1 class="lore-h1">{{ galaxy.title }}</h1>
        <p v-if="galaxy.stats" class="lore-meta">{{ galaxy.stats }}</p>
      </template>
      <h1 v-else class="lore-h1">{{ title }}</h1>
      <div v-if="!galaxy" class="lore-meta"><template v-if="all">{{ work.liveMubu().length }} 个节点</template><template v-else-if="current">{{ work.mubuChildren(current.id).length }} 个子节点 <i>·</i> {{ work.mubuDescendants(current.id).length }} 个后代节点 <span v-if="current.tags?.length"><i>·</i> {{ current.tags.join(' / ') }}</span></template><template v-else>自由记录与整理你的世界</template><span v-if="ui.mubuQuery">筛选「{{ ui.mubuQuery }}」 <button @click="emit('clear-filter')">清除</button></span></div>
    </div>
    <div class="lore-head-actions"><nav class="lore-switch" role="tablist" aria-label="设定视图"><button v-for="v in [{ id: 'write', label: '节点大纲' }, { id: 'detail', label: '阅读视图' }, { id: 'map', label: '视觉导图' }]" :key="v.id" role="tab" :aria-selected="ui.loreView === v.id" :class="{ on: ui.loreView === v.id }" :data-lore-view="v.id" @click="emit('view', v.id)">{{ v.label }}</button></nav><button class="lore-icon lore-links-toggle" :class="{ active: ui.loreLinksOpen }" :aria-pressed="ui.loreLinksOpen" aria-label="链接与引用" title="链接与引用" @click="ui.loreLinksOpen = !ui.loreLinksOpen"><OIcon name="link" :size="15" /></button><button v-if="ui.loreView === 'write'" class="lore-btn primary" aria-label="新建节点" @click="emit('new')"><OIcon name="plus" :size="12" /><span class="lore-new-long">新建节点</span><span class="lore-new-short" aria-hidden="true">新建</span></button>
      <slot name="map-tools" />
    </div>
  </header>
</template>

<style scoped>
/* The extra map controls are part of the header, so the header owns their height. */
.lore-head.lore-free-head.lore-head--map {
  height: auto;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 10px 16px;
  min-height: 103px;
  padding: 22px clamp(12px, 2.2vw, 25px) 12px;
  background: none;
  border: 0;
}

.lore-head.lore-free-head.lore-head--map > .lore-head-main {
  flex: 1 0 180px;
  max-width: 100%;
  min-width: 0;
}

.lore-head.lore-head--map .lore-free-crumbs {
  max-height: none;
  color: var(--canvas-muted);
}

.lore-head--map .lore-free-crumbs :is(button, .lore-galaxy-crumbs) {
  color: inherit;
}

.lore-head.lore-head--map .lore-crumb-nav {
  padding: 4px 9px;
  border: 1px solid rgb(255 255 255 / .14);
  border-radius: 999px;
}

.lore-head--map .lore-galaxy-crumbs {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  flex: 1 1 10rem;
  min-width: 0;
  max-height: 4.5em;
  overflow: auto;
  gap: 4px 6px;
}

.lore-galaxy-crumbs :is(button, [aria-current]) {
  min-width: 0;
  max-width: min(100%, 18em);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.lore-head--map .lore-galaxy-crumbs [aria-current] {
  color: var(--canvas-title);
}

.lore-head.lore-head--map .lore-h1 {
  min-height: 0;
  max-height: none;
  margin: 8px 0 0;
  color: var(--canvas-title);
  font-size: clamp(21px, 2.1vw, 24px);
  line-height: 1.25;
}

.lore-head.lore-head--map .lore-meta {
  margin: 5px 0 0;
  color: var(--canvas-muted);
  font-size: 11px;
  letter-spacing: .025em;
}

.lore-head.lore-head--map > .lore-head-actions {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  width: fit-content;
  max-width: 100%;
  min-width: 0;
  margin-left: auto;
  padding: 0;
  gap: 6px 8px;
}

.lore-head.lore-head--map .lore-switch {
  grid-area: 1 / 1;
  justify-self: end;
}

.lore-head--map .lore-links-toggle {
  grid-area: 1 / 2;
}

.lore-head--map :deep(.lore-map-subbar) {
  grid-area: 2 / 1 / 3 / -1;
  justify-content: flex-end;
  flex-wrap: wrap;
  min-width: 0;
  max-width: 100%;
  min-height: 0;
  padding: 0;
  gap: 6px 8px;
  border: 0;
}

.lore-head--map :deep(.lore-map-context) {
  flex: 0 1 auto;
  color: var(--canvas-muted);
}

.lore-head.lore-head--map :is(.lore-switch, :deep(.lore-map-modes)) {
  width: fit-content;
  max-width: 100%;
  min-width: 0;
  padding: 3px;
  border-color: rgb(255 255 255 / .14);
  border-radius: 999px;
  background: var(--canvas-control);
}

.lore-head.lore-head--map :is(.lore-switch, :deep(.lore-map-modes)) button {
  padding: 5px clamp(5px, 1.15vw, 11px);
  border-radius: 999px;
  color: var(--canvas-muted);
  white-space: nowrap;
}

.lore-head.lore-head--map :is(.lore-switch, :deep(.lore-map-modes)) button:hover:not(:disabled) {
  color: var(--canvas-title);
}

.lore-head.lore-head--map :is(.lore-switch, :deep(.lore-map-modes)) button:disabled {
  opacity: .42;
  cursor: default;
}

.lore-head.lore-head--map :is(.lore-switch, :deep(.lore-map-modes)) button.on {
  color: var(--canvas-selection-ink);
  background: var(--canvas-selection);
}

.lore-head--map .lore-links-toggle {
  color: var(--canvas-title);
  border-color: rgb(255 255 255 / .14);
}

.lore-head--map .lore-links-toggle.active {
  background: var(--canvas-control-hover);
}

@media (max-width: 559px) {
  .lore-head.lore-head--map > .lore-head-actions {
    flex-basis: 100%;
    width: 100%;
  }

  .lore-head.lore-head--map .lore-switch {
    justify-self: stretch;
    width: 100%;
  }

  .lore-head--map :deep(.lore-map-subbar) {
    justify-content: flex-start;
  }
}
</style>
