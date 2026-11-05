<script setup>
/* 通用大纲提案：固定生成锚点、空 edge 不连线，整套应用与撤销走作品 store。 */
import { computed } from 'vue'
import { NButton, NTag } from 'naive-ui'
import OIcon from '../OIcon.vue'
import ProposalExtras from './ProposalExtras.vue'
import { useWorkStore } from '../../stores/work'

const props = defineProps({
  card: { type: Object, required: true } // agent.js plan 卡：{ name, idea, nodes: [{ title, points, edge }] }
})

const work = useWorkStore()
const applied = computed(() => props.card.appliedActions?.includes('apply'))

/** agent.js schema 的英文 edge → 画布连线 kind（canvas-model.js REL_KINDS） */
const EDGE_LABEL = { cause: '因果', foreshadow: '伏笔', conflict: '冲突' }
const edgeLabel = (e) => EDGE_LABEL[e] || '关联'

const selNode = computed(() => work.olnodes.find((n) => n.id === props.card.anchorId && !n.deletedAt) || null)
const selTitle = computed(() => (selNode.value ? selNode.value.title || '未命名节点' : ''))

async function applyToSelected() {
  try { await work.applyAiProposal(props.card); window.$msg?.success('方案已应用到生成时的锚点') }
  catch (e) { window.$msg?.warning(e.message) }
}
</script>

<template>
  <div class="ai-card">
    <div class="ai-card-head">
      <span class="ai-card-kicker">方案</span>
      <span class="ai-card-title">{{ card.name || '未命名方案' }}</span>
    </div>

    <p v-if="card.positioning" class="ai-card-idea">{{ card.positioning }}</p>
    <p v-if="card.idea" class="ai-card-idea">{{ card.idea }}</p>

    <ol v-if="card.nodes?.length" class="ai-plan-nodes">
      <li v-for="(n, i) in card.nodes" :key="i" class="ai-plan-node">
        <div class="ai-plan-node-head">
          <span class="ai-plan-node-title">{{ n.title || '未命名子节点' }}</span>
          <NTag v-if="n.purpose" size="tiny" :bordered="false">{{ n.purpose }}</NTag>
          <NTag v-if="i > 0 && n.edge" size="tiny" :bordered="false" class="ai-plan-edge">{{ edgeLabel(n.edge) }}</NTag>
        </div>
        <div v-if="n.points" class="ai-plan-points">{{ n.points }}</div>
      </li>
    </ol>

    <ProposalExtras :card="card" />
    <div class="ai-card-actions">
      <NButton size="tiny" type="primary" :disabled="applied" @click="applyToSelected">
        {{ applied ? '已应用到「' + selTitle + '」' : '应用到生成锚点' }}
      </NButton>
      <span class="ai-plan-target" :class="{ none: !selNode }">
        <OIcon name="diamond" :size="10" />
        {{ selNode ? '生成锚点：' + selTitle : '未选中大纲节点' }}
      </span>
    </div>
  </div>
</template>

<style scoped>
.ai-card {
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--bg-editor);
  padding: 9px 10px;
  margin-bottom: 8px;
  font-size: 12px;
  line-height: 1.7;
}
.ai-card-head {
  display: flex;
  align-items: baseline;
  gap: 6px;
  margin-bottom: 3px;
}
.ai-card-kicker {
  flex: none;
  font-size: 10px;
  letter-spacing: 0.12em;
  color: var(--accent);
  border: 1px solid color-mix(in srgb, var(--accent) 40%, transparent);
  border-radius: 3px;
  padding: 0 4px;
}
.ai-card-title {
  font-weight: 700;
  color: var(--text);
  font-size: 12.5px;
}
.ai-card-idea {
  margin: 2px 0 5px;
  color: var(--text);
}
.ai-plan-nodes {
  margin: 0;
  padding-left: 18px;
}
.ai-plan-node {
  margin-bottom: 5px;
}
.ai-plan-node-head {
  display: flex;
  align-items: center;
  gap: 6px;
}
.ai-plan-node-title {
  color: var(--text);
  font-weight: 600;
}
.ai-plan-edge {
  color: var(--accent);
}
.ai-plan-points {
  color: var(--text-dim);
  font-size: 11.5px;
  white-space: pre-wrap;
  word-break: break-word;
}
.ai-card-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
  flex-wrap: wrap;
}
.ai-plan-target {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--text-dim);
  min-width: 0;
}
.ai-plan-target.none {
  color: var(--text-faint, var(--text-dim));
}
</style>
