<script setup>
import TaskLauncher from './ai/TaskLauncher.vue'
import { computed, ref } from 'vue'
import { NButton, NInput, NPopconfirm, NPopover, NDropdown, useMessage } from 'naive-ui'
import { useWorkStore } from '../stores/work'
import { useUiStore } from '../stores/ui'
import { popOut } from '../services/panelwindows'
import DLinkTextMenu from './DLinkTextMenu.vue'
import SnippetList from './SnippetList.vue'

const work = useWorkStore()
const ui = useUiStore()
const msg = useMessage()
const s = computed(() => work.activeSnippet)
const dlMenu = ref(null)
const isNativePanel = new URLSearchParams(location.search).has('panel')
const quickOpen = ref(false)
const quickText = ref('')

/* 赤月戏：标题=正文首行，正文=余下各行；写回时按同一结构拼回，不迁移数据 */
const contentLines = computed(() => String(s.value?.content || '').split('\n'))
const ideaTitle = computed(() => (contentLines.value[0] || '').trim() || '未命名灵感')
const ideaBody = computed(() => contentLines.value.slice(1).join('\n').replace(/^\n+/, ''))
const ideaDate = computed(() => {
  const t = s.value?.createdAt
  if (!t) return ''
  return new Date(t).toLocaleString('zh-CN', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })
})
function setIdeaTitle(v) {
  if (!s.value) return
  const rest = ideaBody.value
  work.updateSnippet(s.value.id, { content: String(v || '').trim() + (rest ? '\n\n' + rest : '') })
}
function setIdeaBody(v) {
  if (!s.value) return
  work.updateSnippet(s.value.id, { content: ideaTitle.value + (v ? '\n\n' + v : '') })
}
function addQuickSnippet() {
  const v = quickText.value.trim()
  if (!v) return
  const row = work.addSnippet(v)
  if (row?.id) work.selSnippetId = row.id
  quickText.value = ''
  quickOpen.value = false
}
async function popSnippet() {
  if (!s.value) return
  await popOut(work, 'snippet', s.value.id, `${work.work?.title || ''} · 灵感`)
}
const ideaMenu = [
  { label: '转为设定', key: 'lore' },
  { label: '转为章节', key: 'chapter' },
  { type: 'divider', key: 'd1' },
  { label: '删除这条灵感', key: 'delete' }
]
function onIdeaMenu(key) {
  if (key === 'lore') toLore()
  else if (key === 'chapter') toChapter()
  else if (key === 'delete' && s.value) work.deleteSnippet(s.value.id)
}

/* 灵感内容右键快捷栏：剪切/复制/粘贴 + 添加关系链接 */
function onCtx(e) {
  if (!s.value) return
  const sn = s.value
  dlMenu.value?.open(e, { get: () => sn.content || '', set: (v) => work.updateSnippet(sn.id, { content: v }) })
}

function toChapter() {
  if (!s.value) return
  const lines = (s.value.content || '').split('\n').filter((x) => x.trim())
  const title = (lines[0] || '灵感章节').slice(0, 30)
  work.addChapter(null, title).then((ch) => {
    work.setChapterContent(ch.id, s.value.content || '')
    msg.success('已转为新章节')
  })
}
function toLore() {
  if (!s.value) return
  // 设定库已幕布化（v0.3.0）：旧 lore 表为死表，改写幕布节点——首行作标题、余行作子节点内容
  const lines = (s.value.content || '').split('\n').filter((x) => x.trim())
  const node = work.mubuAddInCurrentSet((lines[0] || '新设定').slice(0, 30))
  const body = lines.slice(1).join('\n').trim()
  if (body) work.mubuAdd(node.id, null, body)
  work.tab = 'lore'
  ui.focusLoreNode(node.id, work.mubuPath(node.id))
  msg.success('已转为设定节点')
}
</script>

<template>
  <TaskLauncher module="snippets" />
  <div v-if="s" class="snippet-surface" style="flex: 1; display: flex; flex-direction: column; padding: 22px 34px; min-height: 0">
    <div class="snippet-actions" style="display: flex; gap: 8px; margin-bottom: 12px; align-items: center">
      <span style="font-size: 12px; color: var(--text-dim)">灵感记录 · 自动保存</span>
      <div style="flex: 1"></div>
      <NButton size="small" @click="toChapter">转为章节</NButton>
      <NButton size="small" @click="toLore">转为设定</NButton>
      <NPopconfirm @positive-click="work.deleteSnippet(s.id)">
        <template #trigger>
          <NButton size="small" quaternary type="error">删除</NButton>
        </template>
        删除后可在回收站恢复
      </NPopconfirm>
    </div>
    <NInput
      :value="s.content"
      type="textarea"
      style="flex: 1"
      :autosize="{ minRows: 18, maxRows: 40 }"
      placeholder="记录灵感、桥段、对话片段……"
      data-dl-token
      @update:value="(v) => work.updateSnippet(s.id, { content: v })"
      @contextmenu="onCtx"
    />
  </div>
  <div v-else class="empty-shelf" style="padding-top: 140px">
    <div class="big">灵光一现</div>
    <p>从左侧选择一条灵感，或直接在左侧输入框随手记。</p>
  </div>
  <DLinkTextMenu ref="dlMenu" />
</template>
