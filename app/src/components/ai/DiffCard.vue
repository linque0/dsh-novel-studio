<script setup>
/* diff 预览卡（方案 §五.3/§五.4）：两种形态——
 * - 设定扩展（subject:'lore'）：mode='add' 新增条目草案（子节点树）；mode='expand' 现有节点扩写
 *   （原文 ↔ 扩写稿逐行对照）。
 * - 人物丰富（subject:'character'）：字段补全（字段级对照）、小传扩写、别名建议、关系建议。
 * 操作「确认应用 / 放弃」都走 store 现有动作（写入红线 §六.1，agent 只产提案不落库）：
 * mubuAddTree / mubuSetText / updateCharacter / addCharacter / addRelation；
 * 「放弃」只从 对话提案 移除提案，不触碰任何库数据。
 */
import { computed, ref } from 'vue'
import { NButton, NTag } from 'naive-ui'
import OIcon from '../OIcon.vue'
import ProposalExtras from './ProposalExtras.vue'
import { useWorkStore } from '../../stores/work'

const props = defineProps({
  card: { type: Object, required: true } // 对话 diff 卡：lore { mode, tree, revised, note } / character { fields, bio, aliases, relations }
})
const emit = defineEmits(['dismiss'])

const work = useWorkStore()
const applied = computed(() => props.card.appliedActions?.includes('apply'))
const selectedFields = ref(Object.keys(props.card.fields || {}))
const selectedBio = ref(!!props.card.bio)
const selectedAliases = ref((props.card.aliases || []).map((_,i) => i))
const selectedRelations = ref((props.card.relations || []).map((_,i) => i))

const isLore = computed(() => props.card.subject === 'lore')
const isChar = computed(() => props.card.subject === 'character')
const isAdd = computed(() => isLore.value && props.card.mode === 'add')

const loreNode = computed(() => work.mubu.find((n) => n.id === props.card.anchorId && !n.deletedAt) || null)
const charRow = computed(() => work.characters.find((c) => c.id === props.card.anchorId && !c.deletedAt) || null)
const canApply = computed(() => (isLore.value ? !!loreNode.value : isChar.value ? !!charRow.value : false))

/* ---------- 逐行对照（LCS；超长退化） ---------- */

/** 折叠纯相同行区段：变化点上下各保留 2 行，中间以 gap 标记 */
function foldSame(rows) {
  const keep = new Array(rows.length).fill(false)
  rows.forEach((r, i) => {
    if (r.t !== 'same') {
      for (let k = Math.max(0, i - 2); k <= Math.min(rows.length - 1, i + 2); k++) keep[k] = true
    }
  })
  const out = []
  let gap = 0
  rows.forEach((r, i) => {
    if (keep[i]) {
      if (gap) {
        out.push({ t: 'gap', text: `……（相同内容省略 ${gap} 行）` })
        gap = 0
      }
      out.push(r)
    } else {
      gap++
    }
  })
  if (gap) out.push({ t: 'gap', text: `……（相同内容省略 ${gap} 行）` })
  return out
}

function lineDiff(oldText, newText) {
  const A = String(oldText || '').split('\n')
  const B = String(newText || '').split('\n')
  if (A.length * B.length > 400000) return null // 超长文本不做逐行 LCS，直接左右并排
  const dp = Array.from({ length: A.length + 1 }, () => new Uint32Array(B.length + 1))
  for (let i = A.length - 1; i >= 0; i--) {
    for (let j = B.length - 1; j >= 0; j--) {
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const rows = []
  let i = 0
  let j = 0
  while (i < A.length && j < B.length) {
    if (A[i] === B[j]) {
      rows.push({ t: 'same', text: A[i] })
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      rows.push({ t: 'del', text: A[i] })
      i++
    } else {
      rows.push({ t: 'add', text: B[j] })
      j++
    }
  }
  while (i < A.length) rows.push({ t: 'del', text: A[i++] })
  while (j < B.length) rows.push({ t: 'add', text: B[j++] })
  return foldSame(rows)
}

/* ---------- 设定：新增子树草案展平展示 ---------- */

const treeRows = computed(() => {
  const rows = []
  const walk = (n, depth) => {
    if (!n || rows.length >= 80) return
    rows.push({ depth, text: n.text || '（空）' })
    for (const c of n.children || []) walk(c, depth + 1)
  }
  walk(props.card.tree, 0)
  return rows
})

const expandDiff = computed(() =>
  isLore.value && props.card.mode === 'expand' ? lineDiff(loreNode.value?.text || '', props.card.revised || '') : null
)

/* ---------- 人物：字段级对照 / 别名新增 / 关系解析 ---------- */

const fieldRows = computed(() => {
  if (!isChar.value) return []
  const fields = props.card.fields || {}
  return Object.entries(fields).map(([k, v]) => ({
    key: k,
    old: String(charRow.value?.fields?.[k] ?? '').trim() || '（空缺）',
    next: String(v)
  }))
})

const bioDiff = computed(() => (isChar.value && props.card.bio ? lineDiff(charRow.value?.content || '', props.card.bio) : null))

const aliasAdds = computed(() => {
  if (!isChar.value || !props.card.aliases?.length) return []
  const exist = (charRow.value?.aliases || '').split(/[,，、/\s]+/).filter(Boolean)
  return props.card.aliases.filter((a) => !exist.includes(a))
})

/** 关系建议对端解析：姓名/别名精确匹配；不存在 → 应用时新建；两端已有任意关系 → 跳过 */
function findCharByName(name) {
  const q = String(name || '').trim().toLowerCase()
  if (!q) return null
  return (
    work.liveCharacters.find((c) => (c.name || '').toLowerCase() === q) ||
    work.liveCharacters.find((c) =>
      [c.name, ...(c.aliases || '').split(/[,，、/\s]+/)].filter(Boolean).some((n) => n.toLowerCase() === q)
    ) ||
    null
  )
}

const relationRows = computed(() => {
  if (!isChar.value) return []
  return (props.card.relations || []).map((r) => {
    const target = findCharByName(r.name)
    const dup =
      target &&
      work.relations.some(
        (x) =>
          (x.fromId === props.card.anchorId && x.toId === target.id) ||
          (x.fromId === target.id && x.toId === props.card.anchorId)
      )
    return { ...r, status: dup ? 'dup' : target ? 'existing' : 'create' }
  })
})

const STATUS_META = {
  existing: { text: '已有人物', type: 'default' },
  create: { text: '需单独确认实体', type: 'warning' },
  dup: { text: '已有关系', type: 'info' }
}

/* ---------- 应用 / 放弃 ---------- */

async function apply() {
  try {
    await work.applyAiProposal(props.card, { selected: { fields: selectedFields.value, bio: selectedBio.value, aliases: selectedAliases.value, relations: selectedRelations.value } })
    window.$msg?.success('勾选提案已应用')
  } catch (e) { window.$msg?.warning(e.message) }
}

function dismiss() {
  emit('dismiss', props.card.id) // 仅移除提案，不写库
}
</script>

<template>
  <div class="ai-card">
    <div class="ai-card-head">
      <span class="ai-card-kicker">{{ isLore ? '设定' : '人物' }}</span>
      <span class="ai-card-title">
        {{ isLore ? (isAdd ? '新增条目草案' : '节点扩写草案') : '人物丰富建议' }}
      </span>
      <button v-if="!applied" class="ai-diff-x" title="放弃（不写入）" @click="dismiss"><OIcon name="close" :size="11" /></button>
    </div>

    <div v-if="card.conflict_note" class="ai-diff-note">潜在冲突：{{ card.conflict_note }}</div>
    <div v-for="(b, i) in card.basis || []" :key="i">{{ b.claim }} · {{ b.source }}</div>
    <ProposalExtras :card="card" />
    <div v-if="card.note" class="ai-diff-note">{{ card.note }}</div>

    <!-- 设定：新增子树 -->
    <template v-if="isLore && isAdd">
      <ul class="ai-tree">
        <li v-for="(r, i) in treeRows" :key="i" :style="{ paddingLeft: r.depth * 14 + 'px' }" class="ai-tree-row">
          <OIcon name="note" :size="10" /> {{ r.text }}
        </li>
      </ul>
    </template>

    <!-- 设定：扩写逐行对照 -->
    <template v-else-if="isLore">
      <div v-if="expandDiff" class="ai-diff">
        <div v-for="(r, i) in expandDiff" :key="i" class="ai-diff-row" :class="r.t">
          <template v-if="r.t === 'gap'">{{ r.text }}</template>
          <template v-else><span class="ai-diff-sign">{{ r.t === 'add' ? '+' : '−' }}</span>{{ r.text }}</template>
        </div>
      </div>
      <div v-else class="ai-diff-fallback">
        <div class="ai-diff-col-title">原文</div>
        <pre class="ai-diff-col old">{{ loreNode?.text }}</pre>
        <div class="ai-diff-col-title">扩写稿</div>
        <pre class="ai-diff-col next">{{ card.revised }}</pre>
      </div>
    </template>

    <!-- 人物：字段级对照 -->
    <template v-if="isChar">
      <div v-if="fieldRows.length" class="ai-field-rows">
        <div v-for="f in fieldRows" :key="f.key" class="ai-field-row">
          <label class="ai-field-key"><input v-model="selectedFields" type="checkbox" :value="f.key" />{{ f.key }}</label>
          <span class="ai-field-old">{{ f.old }}</span>
          <span class="ai-field-arrow">→</span>
          <span class="ai-field-next">{{ f.next }}</span>
        </div>
      </div>
      <template v-if="bioDiff">
        <label class="ai-diff-sec-title"><input v-model="selectedBio" type="checkbox" />小传扩写</label>
        <div class="ai-diff">
          <div v-for="(r, i) in bioDiff" :key="i" class="ai-diff-row" :class="r.t">
            <template v-if="r.t === 'gap'">{{ r.text }}</template>
            <template v-else><span class="ai-diff-sign">{{ r.t === 'add' ? '+' : '−' }}</span>{{ r.text }}</template>
          </div>
        </div>
      </template>
      <div v-if="aliasAdds.length" class="ai-alias-row">
        <span class="ai-diff-sec-title inline">别名建议</span>
        <label v-for="(a, i) in card.aliases" :key="a"><input v-model="selectedAliases" type="checkbox" :value="i" />{{ a }}</label>
      </div>
      <div v-if="relationRows.length" class="ai-rel-rows">
        <div class="ai-diff-sec-title">关系建议</div>
        <div v-for="(r, i) in relationRows" :key="i" class="ai-rel-row">
          <NTag size="tiny" :bordered="false" :type="STATUS_META[r.status].type">{{ STATUS_META[r.status].text }}</NTag>
          <input v-model="selectedRelations" type="checkbox" :value="i" />
          <span class="ai-rel-name">{{ r.name }}</span>
          <span class="ai-rel-label">{{ r.label }}</span>
        </div>
      </div>
    </template>

    <div class="ai-card-actions">
      <template v-if="!applied">
        <NButton size="tiny" type="primary" :disabled="!canApply" @click="apply">确认应用</NButton>
        <NButton size="tiny" quaternary @click="dismiss">放弃</NButton>
        <span v-if="!canApply" class="ai-diff-missing">原{{ isLore ? '设定节点' : '人物' }}已不存在</span>
      </template>
      <NTag v-else size="tiny" type="success" :bordered="false">已应用</NTag>
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
  flex: 1;
  font-weight: 700;
  color: var(--text);
  font-size: 12.5px;
}
.ai-diff-x {
  flex: none;
  border: none;
  background: none;
  color: var(--text-dim);
  cursor: pointer;
  padding: 1px;
}
.ai-diff-x:hover {
  color: #c0392b;
}
.ai-diff-note {
  color: var(--text-dim);
  font-size: 11.5px;
  margin-bottom: 4px;
}

/* 新增子树 */
.ai-tree {
  margin: 4px 0 0;
  padding: 6px 8px;
  list-style: none;
  border: 1px dashed var(--border);
  border-radius: 6px;
  background: color-mix(in srgb, var(--accent) 4%, transparent);
  max-height: 240px;
  overflow: auto;
}
.ai-tree-row {
  color: var(--text);
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.8;
}

/* 逐行对照 */
.ai-diff {
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-panel);
  padding: 5px 0;
  max-height: 260px;
  overflow: auto;
}
.ai-diff-row {
  padding: 0 8px;
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.7;
}
.ai-diff-row.add {
  background: color-mix(in srgb, #27ae60 12%, transparent);
  color: var(--text);
}
.ai-diff-row.del {
  background: color-mix(in srgb, #c0392b 10%, transparent);
  color: var(--text-dim);
  text-decoration: line-through;
}
.ai-diff-row.gap {
  color: var(--text-faint, var(--text-dim));
  font-size: 11px;
}
.ai-diff-sign {
  display: inline-block;
  width: 12px;
  color: var(--text-dim);
  user-select: none;
}
.ai-diff-fallback .ai-diff-col-title {
  color: var(--text-dim);
  font-size: 11px;
  margin-top: 5px;
}
.ai-diff-col {
  margin: 3px 0 0;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 6px 8px;
  max-height: 140px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: var(--editor-font);
  font-size: 11.5px;
  line-height: 1.7;
}
.ai-diff-col.old {
  color: var(--text-dim);
}
.ai-diff-col.next {
  color: var(--text);
}

/* 人物字段级对照 */
.ai-field-rows {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 4px 0 0;
}
.ai-field-row {
  display: flex;
  align-items: baseline;
  gap: 6px;
  flex-wrap: wrap;
}
.ai-field-key {
  flex: none;
  min-width: 48px;
  color: var(--accent);
  font-weight: 600;
}
.ai-field-old {
  color: var(--text-faint, var(--text-dim));
  text-decoration: line-through;
  word-break: break-all;
}
.ai-field-arrow {
  color: var(--text-dim);
}
.ai-field-next {
  color: var(--text);
  word-break: break-all;
}
.ai-diff-sec-title {
  margin: 8px 0 4px;
  color: var(--text-dim);
  font-size: 11.5px;
}
.ai-diff-sec-title.inline {
  display: inline;
  margin: 0 6px 0 0;
}
.ai-alias-row {
  margin-top: 6px;
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
}
.ai-rel-rows {
  margin-top: 2px;
}
.ai-rel-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 3px;
}
.ai-rel-name {
  color: var(--text);
  font-weight: 600;
}
.ai-rel-label {
  color: var(--text-dim);
}

/* 操作区 */
.ai-card-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
  flex-wrap: wrap;
}
.ai-diff-missing {
  color: var(--text-faint, var(--text-dim));
  font-size: 11px;
}
</style>
