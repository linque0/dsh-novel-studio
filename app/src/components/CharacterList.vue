<script setup>
import { computed } from 'vue'
import { NButton, NTag } from 'naive-ui'
import { useWorkStore } from '../stores/work'
import { useUiStore } from '../stores/ui'
import { primaryRole } from '../services/character-tags'

const work = useWorkStore()
const ui = useUiStore()
const ROLE_COLOR = { 主角: 'error', 反派: 'warning', 配角: 'info', 龙套: 'default' }
const list = computed(() => {
  const q = work.charView === 'list' ? String(ui.charQuery || '').trim().toLowerCase() : ''
  return work.liveCharacters
    .filter((c) => !q || [c.name, c.role, c.aliases, ...(c.tags || [])].filter(Boolean).join(' ').toLowerCase().includes(q))
    .map((c) => ({ id: c.id, name: c.name || '未命名', role: primaryRole(c) || '未定', avatar: (work.urlTick, c.avatarAssetId ? work.assetUrl(c.avatarAssetId) : '') }))
})
function pick(c) {
  work.selCharacterId = c.id
  if (work.charView === 'graph') {
    work.charFocusId = c.id
    work.charFocusTick++
  }
}
</script>

<template>
  <div style="display: flex; flex-direction: column; height: 100%">
    <div class="side-head character-list-head">
      <NButton size="tiny" type="primary" @click="work.addCharacter()">＋人物</NButton>
      <span style="font-size: 12px; color: var(--text-dim)">{{ list.length }} 人</span>
      <span style="flex: 1"></span>
      <span class="ol-viewtoggle char-viewtoggle">
        <button :class="{ on: work.charView === 'list' }" title="列表视图" @click="work.charView = 'list'">列表</button>
        <button :class="{ on: work.charView === 'graph' }" title="人物关系图" @click="work.charView = 'graph'">关系图</button>
      </span>
    </div>
    <div class="side-list">
      <div
        v-for="c in list"
        :key="c.id"
        class="side-item"
        :class="{ active: work.selCharacterId === c.id }"
        role="button"
        tabindex="0"
        @click="pick(c)"
        @keydown.enter="pick(c)"
      >
        <NTag size="tiny" :type="ROLE_COLOR[c.role] || 'default'" :bordered="false">{{ c.role }}</NTag><span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap">{{ c.name }}</span>
      </div>
      <p v-if="!list.length" style="font-size: 12px; color: var(--text-dim); padding: 10px">
        还没有人物。点击「＋人物」创建角色卡：外貌、性格、背景、动机与自定义字段。
      </p>
    </div>
  </div>
</template>
