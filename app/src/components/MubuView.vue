<script setup>
import TaskLauncher from './ai/TaskLauncher.vue'
import { ref, reactive, computed, watch, nextTick, onMounted, onUpdated, onBeforeUnmount } from 'vue'
import { NPopover } from 'naive-ui'
import OIcon from './OIcon.vue'
import { useWorkStore } from '../stores/work'
import { useUiStore } from '../stores/ui'
import { useAiStore } from '../stores/ai'
import { pickFiles } from '../services/fileio'
import { decodeText, parseMubuMd } from '../services/importers'
import { tagColor } from '../services/tagcolors'
import { relIconFor, relColor } from '../services/relation-kinds'
import { jumpTo } from '../services/doublelinks'
import DLinkPicker from './DLinkPicker.vue'
import LoreRelRows from './LoreRelRows.vue'
import { popOut } from '../services/panelwindows'

const work = useWorkStore()
const ui = useUiStore()
const ai = useAiStore()
/* 详情页复用本组件：focusNodeId = 当前查看的节点（其子条目成为纸面内容）。 */
const props = defineProps({
  focusNodeId: { type: String, default: '' },
})
const rootEl = ref(null)
const ver = ref(0)
const rows = ref([])
const sections = ref([])
const renaming = ref(null)
/* 内容根：详情页 = 当前节点；列表页 = 当前设定集。标题单独显示，不再作为树行 */
const focusNode = computed(() => (props.focusNodeId ? work.mubu.find((n) => n.id === props.focusNodeId && !n.deletedAt) || null : null))
const contentRoot = computed(() => focusNode.value || work.currentMubuRoot())
const contentRootId = computed(() => contentRoot.value?.id || null)
const titleText = computed(() => contentRoot.value?.text || '未命名设定集')
/* 赤月戏：模块条上的「独立窗口」与「更多 → 拆窗」同一动作 */
function popLore() {
  popOut(work, 'lore', '', `${work.work?.title || ''} · 设定`)
}
const pending = reactive({ key: null, offset: 'end' })
const drag = reactive({ key: null, hintKey: null, zone: null })
const focusedId = ref(null)
const ctx = reactive({ open: false, x: 0, y: 0, rowId: null, folded: false, hasChildren: false, linkSearch: false, linkSpan: null })
const clip = ref(null)
const undoStack = ref([])
const redoStack = ref([])
let lastSnap = 0
let expandTimer = null
let expandTarget = null

const COLORS = ['#3c3427', '#8c6f4e', '#c0392b', '#d35400', '#27ae60', '#2980b9', '#8e44ad', '#7f8c8d']
const HIGHLIGHTS = ['#fff3a3', '#ffd6a5', '#ffa8a8', '#b8f2c9', '#a8d8ff', '#e0c3fc']

/* ---------- 组合树（由 store 节点组装） ---------- */
function build() {
  const live = work.liveMubu()
  const byParent = new Map()
  const byId = new Map()
  for (const n of live) {
    byId.set(n.id, n)
    const p = n.parentId || null
    if (!byParent.has(p)) byParent.set(p, [])
    byParent.get(p).push(n)
  }
  /* 筛选：命中项保留其祖先链，其余不渲染（ui.mubuQuery 由侧栏搜索与行尾标签共享） */
  const q = String(ui.mubuQuery || '').trim().toLowerCase()
  const keep = new Set()
  if (q) {
    for (const n of live) {
      const text = String(n.text || '').toLowerCase()
      const tags = (n.tags || []).map((t) => String(t).toLowerCase())
      if (!text.includes(q) && !tags.some((t) => t.includes(q))) continue
      keep.add(n.id)
      let cur = n
      let guard = 0
      while (cur?.parentId && guard++ < 200) {
        keep.add(cur.parentId)
        cur = byId.get(cur.parentId) || null
      }
    }
  }
  const ok = (n) => !q || keep.has(n.id)
  const make = (n) => ({
    key: 'm:' + n.id,
    id: n.id,
    text: n.text || '',
    html: n.html ?? null,
    tags: n.tags || [],
    fold: !!n.fold,
    hasChildren: (byParent.get(n.id) || []).length > 0,
    parentId: n.parentId || null,
    children: (byParent.get(n.id) || []).filter(ok).map(make)
  })
  const countIn = (id) => {
    let total = 0
    const walk = (pid) => {
      for (const c of byParent.get(pid) || []) {
        total++
        walk(c.id)
      }
    }
    walk(id)
    return total
  }
  /* 主区呈现整棵森林：每个顶层节点即一个设定集；详情复用分支只渲染该节点的子条目 */
  sections.value = focusNode.value
    ? []
    : work.mubuRoots().filter(ok).map((r) => ({
        id: r.id,
        text: r.text || '未命名设定集',
        fold: !!r.fold,
        count: countIn(r.id),
        rows: (byParent.get(r.id) || []).filter(ok).map(make)
      }))
  rows.value = focusNode.value
    ? (byParent.get(focusNode.value.id) || []).filter(ok).map(make)
    : sections.value.filter((s) => !s.fold).flatMap((s) => s.rows)
  nextTick(() => {
    syncAll()
    checkFocusFlash()
  })
}
watch(ver, build)
watch(() => work.mubuSetId, () => ver.value++)
watch(() => props.focusNodeId, () => ver.value++)
watch(
  () => work.mubu.length,
  () => ver.value++
)
/* 标签变化（含外部 mubuSetTags / 检索联动触发的改动）也要重建行：rows 快照不追踪行内 tags */
watch(
  () => work.liveMubu().map((n) => (n.tags || []).join('\u0001')).join('\u0002'),
  () => ver.value++
)
watch(
  () => ui.loreFocusId,
  (id) => {
    if (!id) return
    ver.value++
    nextTick(() => {
      const el = rootEl.value?.querySelector(`[data-node="m:${id}"]`)
      if (!el) {
        work.mubuFoldAll(false)
        ver.value++
        nextTick(() => flashNode(id))
      } else flashNode(id)
    })
    ui.loreFocusId = null
  }
)
function flashNode(id) {
  const el = rootEl.value?.querySelector(`[data-node="m:${id}"]`)
  if (!el) return
  el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  el.classList.add('ob-flash')
  setTimeout(() => el.classList.remove('ob-flash'), 1600)
}
function checkFocusFlash() {
  if (ui.loreFocusId) flashNode(ui.loreFocusId)
}
onMounted(build)

/* 折叠状态展开成可见行（供 siblingsOf / 光标上下 / 拖拽复用） */
function flattenRows(list, depth = 0) {
  const out = []
  const walk = (ls, d) => {
    for (const n of ls) {
      out.push({ node: n, depth: d })
      if (!n.fold) walk(n.children, d + 1)
    }
  }
  walk(list, depth)
  return out
}
const visible = computed(() => flattenRows(rows.value))
/* 主区按设定集分块；详情复用分支退化为单块无集头 */
const blocks = computed(() =>
  props.focusNodeId
    ? [{ id: null, text: '', count: 0, fold: false, rows: visible.value }]
    : sections.value.map((s) => ({ ...s, rows: flattenRows(s.rows) }))
)
const setId = computed(() => work.mubuSetId || sections.value[0]?.id || work.mubuRoots()[0]?.id || null)
const entryTotal = computed(() => sections.value.reduce((n, s) => n + s.count, 0))
const filterText = computed(() => String(ui.mubuQuery || '').trim())
function clearFilter() {
  ui.mubuQuery = ''
  ver.value++
}
const nodeCount = computed(() => {
  let n = 0
  const walk = (list) => {
    for (const x of list) {
      n++
      walk(x.children)
    }
  }
  walk(rows.value)
  return n
})
/* 底部提示行左端 = 当前条目的层级路径（原型 #write-location；未选中时退回当前集） */
const locatePath = computed(() => {
  const id = ui.mubuSelectedId || ui.loreFocusId || contentRootId.value
  const byId = new Map(work.liveMubu().map((n) => [n.id, n]))
  const segs = []
  let cur = id ? byId.get(id) : null
  let guard = 0
  while (cur && guard++ < 20) {
    segs.unshift(String(cur.text || '').trim() || '（空）')
    cur = cur.parentId ? byId.get(cur.parentId) : null
  }
  return segs.join(' › ') || '未选择条目'
})
/* 当前内容根与右栏目录（目录含折叠中的条目，点击时由 loreFocusId 展开并定位） */
const tocItems = computed(() => {
  const out = []
  const walk = (list, depth) => {
    for (const n of list) {
      out.push({ id: n.id, text: n.text || '（空节点）', depth })
      walk(n.children, depth + 1)
    }
  }
  walk(rows.value, 0)
  return out
})
/* 纸面标题：设定集名 / 详情页当前节点名（可直接改名） */
function renameTitle(e) {
  const id = contentRootId.value
  if (!id) return
  const v = String(e.target.value || '').trim() || '未命名设定集'
  work.mubuSetText(id, v)
  e.target.value = v
}
function pickToc(id) {
  if (id) ui.loreFocusId = id
}
function createSet() {
  pushUndo()
  const r = work.createMubuSet()
  ver.value++
  nextTick(() => flashNode(r.id))
}
/* ---------- 设定集头（集根不再是行，操作挂到集头上） ---------- */
function setRow(blk) {
  return {
    node: {
      key: 'm:' + blk.id,
      id: blk.id,
      text: blk.text,
      parentId: null,
      hasChildren: blk.count > 0,
      fold: !!blk.fold,
      children: []
    },
    depth: -1
  }
}
function toggleSetFold(blk) {
  work.mubuToggleFold(blk.id)
  ver.value++
}
function headAdd() {
  if (!sections.value.length) return createSet()
  addChild({ node: { id: setId.value } })
}
/** 全部折叠 / 全部展开（按钮在外壳头部，外壳通过 defineExpose 调到） */
function foldAll(v) {
  work.mubuFoldAll(v)
  ver.value++
}
function renameSet(blk) {
  renaming.value = { id: blk.id, value: blk.text }
  nextTick(() => {
    const el = rootEl.value?.querySelector('.ls-input')
    el?.focus()
    el?.select()
  })
}
function commitRename() {
  const r = renaming.value
  if (!r) return
  const v = String(r.value || '').trim() || '未命名设定集'
  renaming.value = null
  work.mubuSetText(r.id, v)
  ver.value++
}
function selectSet(blk) {
  ui.mubuSelectedId = blk.id
}

/* ---------- 撤销 / 重做（快照 + 差异落库） ---------- */
function snapshotFlat() {
  return work.mubu.map((n) => ({
    id: n.id, parentId: n.parentId, sortOrder: n.sortOrder,
    text: n.text, html: n.html, fold: !!n.fold, deletedAt: n.deletedAt ?? null
  }))
}
function pushUndo() {
  undoStack.value.push(JSON.stringify(snapshotFlat()))
  if (undoStack.value.length > 60) undoStack.value.shift()
  redoStack.value = []
  lastSnap = Date.now()
}
async function undo() {
  if (!undoStack.value.length) return
  redoStack.value.push(JSON.stringify(snapshotFlat()))
  await work.mubuSyncTree(JSON.parse(undoStack.value.pop()))
  ver.value++
}
async function redo() {
  if (!redoStack.value.length) return
  undoStack.value.push(JSON.stringify(snapshotFlat()))
  await work.mubuSyncTree(JSON.parse(redoStack.value.pop()))
  ver.value++
}

/* ---------- 提交封装：FLIP 动画 + 重建 ---------- */
function captureRects() {
  const map = new Map()
  rootEl.value?.querySelectorAll('.ob-row').forEach((el) => map.set(el.dataset.node, el.getBoundingClientRect().top))
  return map
}
function playFlip(before) {
  rootEl.value?.querySelectorAll('.ob-row').forEach((el) => {
    const b = before.get(el.dataset.node)
    if (b == null) {
      el.classList.add('ob-appear')
      setTimeout(() => el.classList.remove('ob-appear'), 280)
      return
    }
    const d = b - el.getBoundingClientRect().top
    if (Math.abs(d) > 2) {
      el.style.transition = 'none'
      el.style.transform = `translateY(${d}px)`
      requestAnimationFrame(() => {
        el.style.transition = 'transform 0.22s cubic-bezier(0.2, 0.7, 0.3, 1)'
        el.style.transform = ''
        setTimeout(() => {
          el.style.transition = ''
        }, 240)
      })
    }
  })
}
function commit(mutate, focusKey = null, offset = 'end') {
  const before = captureRects()
  mutate()
  ver.value++
  nextTick(() => {
    playFlip(before)
    syncAll()
    if (focusKey) focusKeyFn(focusKey, offset)
  })
}

/* ---------- 焦点 ---------- */
function focusKeyFn(key, offset = 'end') {
  pending.key = key
  pending.offset = offset
  nextTick(applyFocus)
}
function applyFocus() {
  if (!pending.key || !rootEl.value) return
  const el = rootEl.value.querySelector(`[data-node="${pending.key}"] .ob-text`)
  if (!el) {
    pending.key = null
    return
  }
  el.focus()
  const range = document.createRange()
  const sel = window.getSelection()
  if (pending.offset === 'end' || pending.offset === 'start') {
    range.selectNodeContents(el)
    range.collapse(pending.offset === 'end' ? false : true)
  } else {
    const tn = el.firstChild
    if (tn && tn.nodeType === 3) {
      range.setStart(tn, Math.min(pending.offset, tn.textContent.length))
      range.collapse(true)
    } else {
      range.selectNodeContents(el)
      range.collapse(false)
    }
  }
  sel.removeAllRanges()
  sel.addRange(range)
  pending.key = null
}
function syncAll() {
  rootEl.value?.querySelectorAll('.ob-text').forEach((el) => {
    if (document.activeElement === el) return
    const key = el.closest('[data-node]')?.dataset.node
    const row = visible.value.find((r) => r.node.key === key)
    if (!row) return
    if (row.node.html != null) {
      if (el.innerHTML !== row.node.html) el.innerHTML = row.node.html
    } else if (el.textContent !== row.node.text) {
      el.textContent = row.node.text
    }
  })
}
onUpdated(syncAll)
function onTextFocus(e) {
  const row = e.currentTarget.closest('[data-node]')
  focusedId.value = row?.dataset.node || null
  ui.mubuSelectedId = row?.dataset.node?.slice(2) || null
}
/* 焦点行：focusedId 存的是 'm:id' 键，须按键匹配（此前拿它与裸 node.id 比较，永不命中） */
const focusedRow = computed(() => visible.value.find((r) => r.node.key === focusedId.value) || null)

/* ---------- 编辑操作 ---------- */
function onInput(row, e) {
  const now = Date.now()
  if (now - lastSnap > 1200) pushUndo()
  const el = e.currentTarget
  work.mubuSetText(row.node.id, el.textContent || '', el.innerHTML)
}
function onPaste(e) {
  e.preventDefault()
  const t = e.clipboardData?.getData('text/plain') || ''
  if (t) document.execCommand('insertText', false, t)
}
function syncFocusedRow() {
  const el = document.activeElement
  if (!el || !el.classList?.contains('ob-text')) return
  const id = el.closest('[data-node]')?.dataset.node?.slice(2)
  if (id) work.mubuSetText(id, el.textContent || '', el.innerHTML)
}
function fmt(cmd, val = null) {
  pushUndo()
  document.execCommand(cmd, false, val)
  syncFocusedRow()
}

function addSibling(row) {
  pushUndo()
  const r = row
    ? work.mubuAdd(row.node.parentId, row.node.id, '')
    : (setId.value ? work.mubuAdd(setId.value, null, '') : work.createMubuSet())
  commit(() => {}, 'm:' + r.id, 'start')
}
function createFirst() {
  pushUndo()
  const r = setId.value ? work.mubuAdd(setId.value, null, '') : work.createMubuSet()
  commit(() => {}, 'm:' + r.id, 'start')
}
/* 纸面底部「＋ 添加节点」：优先在选中节点后加同级，否则在顶层第一节点后加 */
function addBottomNode() {
  if (!nodeCount.value) return createFirst()
  const row = focusedRow.value || visible.value.find((r) => r.depth === 0)
  if (row) addSibling(row)
  else createFirst()
}
function addChild(row) {
  pushUndo()
  const r = work.mubuAdd(row.node.id, null, '')
  commit(() => {}, 'm:' + r.id, 'start')
}
function deleteRow(row) {
  pushUndo()
  work.mubuRemove(row.node.id)
  commit(() => {})
}
function onEnter(row) {
  const n = row.node
  /* 幕布习惯：回车 = 新建同级条目；子级用 Tab 或行尾「＋」 */
  pushUndo()
  const parentId = n.parentId || work.mubuRootOf(n.id)?.id || setId.value
  const r = parentId ? work.mubuAdd(parentId, n.parentId ? n.id : null, '') : work.createMubuSet()
  commit(() => {}, 'm:' + r.id, 'start')
}
function indent(row) {
  const sib = siblingsOf(row)
  const i = sib.findIndex((r) => r.node.key === row.node.key)
  if (i <= 0) return
  pushUndo()
  work.mubuMove(row.node.id, sib[i - 1].node.id, 'inside')
  commit(() => {}, row.node.key, 'end')
}
function outdent(row) {
  const n = row.node
  const rootId = work.mubuRootOf(n.id)?.id || null
  if (!n.parentId || n.parentId === rootId) return
  pushUndo()
  work.mubuMove(n.id, n.parentId, 'after')
  commit(() => {}, row.node.key, 'end')
}
function moveRow(row, dir) {
  pushUndo()
  work.mubuMoveOrder(row.node.id, dir)
  commit(() => {}, row.node.key, 'end')
}
function siblingsOf(row) {
  return visible.value.filter((r) => (r.node.parentId || null) === (row.node.parentId || null))
}
function hasChildren(n) {
  return work.mubuChildren(n.id).length > 0
}
function toggleFold(row) {
  if (!row.node.hasChildren) return
  work.mubuToggleFold(row.node.id)
  ver.value++
}
/* ---------- 节点复制 / 剪切 / 粘贴（子树） ---------- */
function collectTree(n) {
  const item = { text: n.text || '', html: n.html ?? null, fold: !!n.fold, children: [] }
  for (const c of work.mubuChildren(n.id)) item.children.push(collectTree(c))
  return item
}
function regenIds(list) {
  for (const n of list) {
    n.id = uid()
    regenIds(n.children || [])
  }
  return list
}
function copyNode(row, cut = false) {
  if (!row) return
  clip.value = [collectTree(row.node)]
  window.native?.clipboardWriteText?.(row.node.text)
  if (cut) {
    pushUndo()
    work.mubuRemove(row.node.id)
    commit(() => {})
  }
}
function pasteClip(asChild) {
  if (!clip.value) return
  const anchor = visible.value.find((r) => r.node.id === ctx.rowId) || visible.value[0]
  if (!anchor) return
  pushUndo()
  const clone = regenIds(JSON.parse(JSON.stringify(clip.value)))
  if (asChild) work.mubuAddTree(anchor.node.id, null, clone)
  else work.mubuAddTree(anchor.node.parentId, anchor.node.id, clone)
  commit(() => {}, 'm:' + (clone[0]?.id || ''), 'start')
}

/* ---------- 键盘 ---------- */
function caretOffsetFromStart(el) {
  const sel = window.getSelection()
  if (!sel.rangeCount) return -1
  const r = sel.getRangeAt(0).cloneRange()
  const probe = document.createRange()
  probe.selectNodeContents(el)
  probe.setEnd(r.startContainer, r.startOffset)
  return probe.toString().length
}
function onKey(row, e) {
  if (e.isComposing) return
  const el = e.currentTarget
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault()
    e.shiftKey ? redo() : undo()
    return
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
    e.preventDefault()
    redo()
    return
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
    e.preventDefault()
    fmt('bold')
    return
  }
  if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
    e.preventDefault()
    moveRow(row, e.key === 'ArrowUp' ? -1 : 1)
    return
  }
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    onEnter(row)
    return
  }
  if (e.key === 'Tab') {
    e.preventDefault()
    e.shiftKey ? outdent(row) : indent(row)
    return
  }
  if (e.key === 'Backspace' && caretOffsetFromStart(el) === 0) {
    e.preventDefault()
    onBackspace(row)
    return
  }
  const off = caretOffsetFromStart(el)
  const len = el.textContent.length
  if (e.key === 'ArrowUp' && (off === 0 || off === -1)) {
    const list = visible.value
    const i = list.findIndex((r) => r.node.key === row.node.key)
    if (i > 0) {
      e.preventDefault()
      focusKeyFn(list[i - 1].node.key, 'end')
    }
    return
  }
  if (e.key === 'ArrowDown' && (off === len || off === -1)) {
    const list = visible.value
    const i = list.findIndex((r) => r.node.key === row.node.key)
    if (i >= 0 && i < list.length - 1) {
      e.preventDefault()
      focusKeyFn(list[i + 1].node.key, 'start')
    }
  }
}
function onBackspace(row) {
  const sib = siblingsOf(row)
  const i = sib.findIndex((r) => r.node.key === row.node.key)
  const prev = i > 0 ? sib[i - 1] : null
  pushUndo()
  if (prev) {
    // 合并到上一节点（v1.0.22：文本/HTML 一次性合并写入——此前第二次调用回传拷贝里的旧
    // prev.node.text，把刚拼接的文本又覆盖掉，行首 Backspace 会丢掉被并入行的文字）
    const prevEl = document.querySelector(`[data-node="${prev.node.key}"] .ob-text`)
    const rowEl = document.querySelector(`[data-node="${row.node.key}"] .ob-text`)
    const mergedText = (prevEl ? prevEl.textContent : prev.node.text || '') + (rowEl ? rowEl.textContent : row.node.text || '')
    if (prev.node.html != null || row.node.html != null) {
      const mergedHtml = (prevEl ? prevEl.innerHTML : '') + (rowEl ? rowEl.innerHTML : (row.node.html || ''))
      work.mubuSetText(prev.node.id, mergedText, mergedHtml)
    } else {
      work.mubuSetText(prev.node.id, mergedText)
    }
    if (row.node.children.length) {
      // 子节点上提到本层
      for (const c of [...row.node.children].reverse()) work.mubuMove(c.id, row.node.id, 'after')
    }
    work.mubuRemove(row.node.id)
    commit(() => {}, prev.node.key, 'end')
  } else if (row.node.parentId) {
    work.mubuMove(row.node.id, row.node.parentId, 'after')
    commit(() => {}, row.node.key, 'start')
  }
}

/* ---------- 拖拽（三区指示 + 悬停自动展开 + FLIP） ---------- */
function onDragStart(row, e) {
  drag.key = row.node.key
  e.dataTransfer.effectAllowed = 'move'
  e.dataTransfer.setData('text/plain', row.node.id)
}
function containsKey(node, key) {
  if (node.key === key) return true
  return node.children.some((c) => containsKey(c, key))
}
function onDragOver(row, e) {
  if (!drag.key || drag.key === row.node.key) return
  const src = visible.value.find((r) => r.node.key === drag.key)
  if (!src || containsKey(src.node, row.node.key)) return
  const r = e.currentTarget.getBoundingClientRect()
  const y = (e.clientY - r.top) / Math.max(1, r.height)
  drag.hintKey = row.node.key
  drag.zone = y < 0.28 ? 'before' : y > 0.72 ? 'after' : 'inside'
  if (row.node.fold && row.node.hasChildren) {
    if (expandTarget !== row.node.key) {
      clearTimeout(expandTimer)
      expandTarget = row.node.key
      expandTimer = setTimeout(() => {
        if (drag.key && drag.hintKey === row.node.key) {
          work.mubuToggleFold(row.node.id)
          ver.value++
        }
      }, 600)
    }
  } else if (expandTarget) {
    clearTimeout(expandTimer)
    expandTarget = null
  }
}
function onDrop(row) {
  clearTimeout(expandTimer)
  if (!drag.key || !drag.hintKey) return clearDrag()
  const src = visible.value.find((r) => r.node.key === drag.key)
  if (!src) return clearDrag()
  pushUndo()
  commit(() => work.mubuMove(src.node.id, row.node.id, drag.zone), src.node.key, 'end')
  clearDrag()
}
function onDropRoot() {
  clearTimeout(expandTimer)
  if (!drag.key) return clearDrag()
  const n = work.mubu.find((x) => x.id === drag.key.slice(2))
  const rootId = setId.value
  if (!n || !rootId || n.id === rootId) return clearDrag()
  pushUndo()
  /* 拖到空白处 = 移到当前内容根的一级条目 */
  work.mubuMove(n.id, rootId, 'inside')
  ver.value++
  nextTick(() => flashNode(n.id))
  clearDrag()
}
function clearDrag() {
  drag.key = null
  drag.hintKey = null
  drag.zone = null
}

/* ---------- 导入 MD / TXT ---------- */
async function importMd() {
  const files = await pickFiles(['md', 'markdown', 'txt'])
  if (!files.length) return
  pushUndo()
  let nodesAdded = 0
  const anchorId = focusedId.value?.startsWith('m:') ? focusedId.value.slice(2) : null
  /* 导入落在当前内容根：有焦点则挂在焦点节点下，否则作为一级条目 */
  const anchorInRoot = anchorId && (anchorId === contentRootId.value || work.mubuRootOf(anchorId)?.id === work.mubuSetId) ? anchorId : null
  const parentId = anchorInRoot || setId.value || work.createMubuSet().id
  for (const f of files) {
    const { text } = decodeText(f.data)
    const tree = parseMubuMd(text)
    if (!tree.length) continue
    work.mubuAddTree(parentId, null, tree)
    nodesAdded += countTree(tree)
  }
  ver.value++
  nextTick(() => anchorId && flashNode(anchorId))
  window.$msg?.success(`导入完成：新增 ${nodesAdded} 个节点`)
}
function countTree(list) {
  let c = 0
  const walk = (l) => l.forEach((n) => (c++, walk(n.children || [])))
  walk(list)
  return c
}

/* ---------- 右键菜单 ---------- */
const ctxEl = ref(null)
function onRowCtx(row, e) {
  e.preventDefault()
  try {
    const range = document.caretRangeFromPoint(e.clientX, e.clientY)
    if (range && rootEl.value?.contains(range.startContainer)) {
      const sel = window.getSelection()
      // 与正文一致：右键点落在非空选区内 → 保持选区（格式作用于选中文字）；否则光标移到右键处
      const keep = sel.rangeCount > 0 && !sel.isCollapsed && sel.getRangeAt(0).intersectsNode(range.startContainer)
      if (!keep) {
        sel.removeAllRanges()
        const r = document.createRange()
        r.setStart(range.startContainer, range.startOffset)
        r.collapse(true)
        sel.addRange(r)
      }
    }
  } catch {
    /* ignore */
  }
  ctx.open = true
  ctx.x = e.clientX
  ctx.y = e.clientY
  ctx.rowId = row.node.id
  ctx.folded = !!row.node.fold
  ctx.hasChildren = hasChildren(row.node)
  ctx.linkSearch = false
  ctx.linkSpan = e.target?.closest?.('.dl-link') || null
  clampCtx()
}
/* 菜单定位后自动避让窗口边缘 */
function clampCtx() {
  nextTick(() => {
    const el = ctxEl.value
    if (!el) return
    const r = el.getBoundingClientRect()
    ctx.x = Math.max(8, Math.min(ctx.x, window.innerWidth - r.width - 8))
    ctx.y = Math.max(8, Math.min(ctx.y, window.innerHeight - r.height - 8))
  })
}
/* 行尾「···」节点操作栏：先聚焦该行，再在按钮下方打开同一套节点菜单 */
function openRowMenu(row, e) {
  const rowEl = e.currentTarget?.closest?.('.ob-row')
  const textEl = rowEl?.querySelector?.('.ob-text')
  if (textEl) {
    textEl.focus()
    try {
      const sel = window.getSelection()
      const range = document.createRange()
      /* 节点菜单的格式操作作用于整条节点（幕布式节点级格式） */
      range.selectNodeContents(textEl)
      sel.removeAllRanges()
      sel.addRange(range)
    } catch {
      /* ignore */
    }
  }
  const rect = e.currentTarget.getBoundingClientRect()
  ctx.open = true
  ctx.x = rect.left
  ctx.y = rect.bottom + 4
  ctx.rowId = row.node.id
  ctx.folded = !!row.node.fold
  ctx.hasChildren = hasChildren(row.node)
  ctx.linkSearch = false
  ctx.linkSpan = null
  clampCtx()
}
function selectionText() {
  const sel = window.getSelection()
  return sel && !sel.isCollapsed ? sel.toString() : ''
}
function doCutText() {
  const t = selectionText()
  if (!t) return closeCtx()
  window.native?.clipboardWriteText?.(t)
  document.execCommand('delete')
  syncFocusedRow()
  closeCtx()
  ver.value++
}
function doCopyText() {
  const t = selectionText()
  if (!t) return closeCtx()
  window.native?.clipboardWriteText?.(t)
  closeCtx()
}
async function doPastePlain() {
  let t = ''
  try {
    t = (await window.native?.clipboardReadText?.()) || ''
  } catch {
    t = ''
  }
  if (t) {
    pushUndo()
    document.execCommand('insertText', false, t)
    syncFocusedRow()
  }
  closeCtx()
  ver.value++
}
function closeCtx() {
  ctx.open = false
}

/* ---------- 节点标签（标签卡片；右键「设置标签…」打开全局标签面板；点击卡片按标签筛选） ---------- */
/** 打开标签面板（可拖动的全局单例，ui.mubuTagPanel）：定位到右键坐标，选择/创建由面板负责 */
function openTagPanel() {
  const id = ctx.rowId
  const x = ctx.x
  const y = ctx.y
  closeCtx()
  if (id) ui.mubuTagPanel = { nodeId: id, x, y }
}
function filterByTag(t) {
  ui.mubuQuery = t
}
function runCtx(fn) {
  fn()
  closeCtx()
  ver.value++
}
/* 发送给恍然梦（方案 §五.3）：对选中幕布节点生成新增条目草案或扩写草案（diff 确认后写入） */
const AI_UNSET_HINT = '恍然梦未配置：请先在设置中完成恍然梦配置'
function aiLoreExpand() {
  if (!ai.ready) return window.$msg?.warning(AI_UNSET_HINT)
  if (!ctx.rowId) return closeCtx()
  ai.prepare('请讨论这条设定。', {loreId:ctx.rowId})
  closeCtx()
}
function toggleCtxFold() {
  if (ctx.hasChildren) work.mubuToggleFold(ctx.rowId)
}

/* ---------- 关系链接（多模块内容互联）：节点内选中文字标记为指向全书任意内容的行内链接 ---------- */
let savedRange = null
const dlKeyword = ref('')
function rowTextEl(id = ctx.rowId) {
  return rootEl.value?.querySelector(`[data-node="m:${id}"] .ob-text`)
}
function openLinkSearch() {
  const sel = window.getSelection()
  savedRange = sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null
  const el = rowTextEl()
  // 光标不在本节点文本内（如右键圆点）时，置于节点文本末尾
  if (savedRange && el && !el.contains(savedRange.startContainer)) savedRange = null
  if (!savedRange && el) {
    el.focus()
    const r = document.createRange()
    r.selectNodeContents(el)
    r.collapse(false)
    savedRange = r
  }
  // 光标折叠落在已有关系链接内：移到链接之后，避免产生嵌套链接
  const span = savedRange?.startContainer?.parentElement?.closest?.('.dl-link')
  if (span && savedRange.collapsed) savedRange.setStartAfter(span)
  // 选中内容作为全局搜索关键词
  dlKeyword.value = savedRange && !savedRange.collapsed ? String(savedRange.toString() || '').replace(/\s+/g, ' ').trim().slice(0, 20) : ''
  ctx.linkSearch = true
}
function insertCtxLink(t) {
  const el = rowTextEl()
  if (!el) return closeCtx()
  pushUndo()
  const span = document.createElement('span')
  span.className = 'dl-link'
  span.setAttribute('data-dl-target', t.kind + ':' + t.id)
  span.setAttribute('data-dl-title', t.title)
  let ok = false
  try {
    if (savedRange) {
      span.textContent = savedRange.collapsed ? t.title : savedRange.toString() || t.title
      if (!savedRange.collapsed) savedRange.deleteContents()
      savedRange.insertNode(span)
      ok = true
    }
  } catch {
    ok = false
  }
  if (!ok) el.appendChild(span) // 兜底：追加到节点末尾
  work.mubuSetText(ctx.rowId, el.textContent || '', el.innerHTML)
  ctx.linkSearch = false
  closeCtx()
  ver.value++
}
function removeCtxLink() {
  const span = ctx.linkSpan
  const el = span?.closest?.('.ob-text')
  if (!span || !el) return closeCtx()
  pushUndo()
  span.replaceWith(...span.childNodes)
  const id = el.closest('[data-node]')?.dataset.node?.slice(2)
  if (id) work.mubuSetText(id, el.textContent || '', el.innerHTML)
  closeCtx()
  ver.value++
}

/* ---------- 关联关系（条目级关系链接）：行尾彩色卡片 + 悬停浮层 + 详情页入口 ---------- */
/** 行尾卡片摘要（store 单次派生：'kind:id' → { count, label, color }） */
const relSummary = computed(() => work.loreLinkSummary)
/** 关系摘要键 = '<kind>:<id>'（store 口径），行键 'm:<id>' 只用于 DOM */
const relKeyOf = (id) => 'mubu:' + id
function relChipStyle(id) {
  const s = relSummary.value.get(relKeyOf(id))
  const c = (s && (s.color || relColor(s.label))) || 'var(--accent)'
  return {
    color: c,
    borderColor: `color-mix(in srgb, ${c} 42%, transparent)`,
    background: `color-mix(in srgb, ${c} 9%, transparent)`
  }
}
function relChipText(id) {
  const s = relSummary.value.get(relKeyOf(id))
  if (!s) return ''
  return s.count > 1 ? `${s.label} +${s.count - 1}` : s.label
}
const relPop = ref(null) // { nodeId, x, y, flip }
const relPopEntries = computed(() => (relPop.value ? work.loreLinksOf('mubu', relPop.value.nodeId) : []))
let relPopTimer = null
function showRelPop(id, e) {
  clearTimeout(relPopTimer)
  const r = e.currentTarget.getBoundingClientRect()
  const flip = r.bottom > window.innerHeight - 220 && r.top > 220
  relPop.value = { nodeId: id, x: Math.max(8, Math.min(r.left, window.innerWidth - 380)), y: flip ? r.top - 6 : r.bottom + 6, flip }
}
function hideRelPopSoon() {
  clearTimeout(relPopTimer)
  relPopTimer = setTimeout(() => { relPop.value = null }, 220)
}
function keepRelPop() {
  clearTimeout(relPopTimer)
}
function jumpRel(e) {
  relPop.value = null
  jumpTo({ kind: e.otherKind, id: e.otherId })
}
/** 打开关联关系设置面板（定位到触发坐标，视口内钳制） */
function openRelPanel(id, x, y) {
  if (!id) return
  ui.loreRelationPanel = {
    kind: 'mubu',
    id,
    x: Math.max(8, Math.min(x, window.innerWidth - 380)),
    y: Math.max(8, Math.min(y, window.innerHeight - 340))
  }
}
function openRelPanelFromCtx() {
  const id = ctx.rowId
  const x = ctx.x
  const y = ctx.y
  closeCtx()
  openRelPanel(id, x, y)
}
function openDetailRow(id) {
  if (id) ui.openLoreDetail(id)
}
/** 双击行 = 打开设定详情页（按钮/标签卡/关系卡/行尾操作/行内链接上让位，不抢交互） */
function onRowDblClick(row, e) {
  const t = e.target
  if (t?.closest?.('button, .ob-tag, .ob-relchip, .ob-ops, .dl-link, a')) return
  openDetailRow(row.node.id)
}

/* ---------- 全局事件 ---------- */
function onWinMouseDown(e) {
  // 点击菜单本身不关闭；点击其他任何区域（含编辑器内）都关闭
  if (ctx.open && ctxEl.value && !ctxEl.value.contains(e.target)) closeCtx()
}
function onWinKeyDown(e) {
  if (e.key === 'Escape' && ctx.open) closeCtx()
}
function onWinWheel(e) {
  // 菜单内部滚动（关系链接选择列表等）不关闭；编辑区滚动时关闭
  if (ctx.open && ctxEl.value && !ctxEl.value.contains(e.target)) closeCtx()
  if (relPop.value && !e.target?.closest?.('.ob-relpop')) relPop.value = null
}

/* 侧栏折叠/展开与编辑器双向同步 */
watch(
  () => ui.mubuSyncTick,
  () => ver.value++
)

onMounted(() => {
  if (!ai.loaded) ai.loadSettings() // 保障入口置灰判定基于已装载的配置（幂等）
  window.addEventListener('mousedown', onWinMouseDown, true)
  window.addEventListener('keydown', onWinKeyDown)
  window.addEventListener('wheel', onWinWheel, { passive: true })
  window.addEventListener('resize', closeCtx)
})
onBeforeUnmount(() => {
  window.removeEventListener('mousedown', onWinMouseDown, true)
  window.removeEventListener('keydown', onWinKeyDown)
  window.removeEventListener('wheel', onWinWheel)
  window.removeEventListener('resize', closeCtx)
  clearTimeout(expandTimer)
  clearTimeout(relPopTimer)
})

/* ---------- 外壳（LoreWorkspace）驱动的入口 ----------
   A 视图交出头部后，「全部折叠 / 全部展开 / 新建条目」在头部、按钮要打到这套编辑逻辑；
   B/C → A 的「在条目中定位」要展开祖先、滚动并闪烁；返回 A 要复原滚动位置。 */
defineExpose({
  foldAll,
  headAdd,
  getScroll() {
    return rootEl.value?.querySelector('.ob-editor')?.scrollTop || 0
  },
  setScroll(top) {
    const el = rootEl.value?.querySelector('.ob-editor')
    if (el) el.scrollTop = Number(top) || 0
  },
  /** 定位到某条目：展开整棵森林（祖先一定在）→ 滚动到可见 → 闪烁 */
  focusNode(id) {
    if (!id) return
    ver.value++
    nextTick(() => {
      if (!rootEl.value?.querySelector(`[data-node="m:${id}"]`)) {
        work.mubuFoldAll(false)
        ver.value++
        nextTick(() => flashNode(id))
      } else flashNode(id)
    })
  }
})
</script>

<template>
  <TaskLauncher module="lore" />
  <div ref="rootEl" class="lore-surface">
    <!-- 设计稿头部（.lore-head：crumbs / .lore-h1 / .lore-meta / 视图切换器 / 折叠与新建）归外壳
         LoreWorkspace 所有；这里只留编写区：工具条 → 整棵森林 → 集头与行。 -->
    <section class="lore-paper-col">
      <div class="ob-toolbar">
      <button class="tb" title="撤销 (Ctrl+Z)" :disabled="!undoStack.length" @click="undo()">↶</button>
      <button class="tb" title="重做 (Ctrl+Y)" :disabled="!redoStack.length" @click="redo()">↷</button>
      <span class="tb-sep" />
      <button class="tb" title="加粗" @mousedown.prevent @click="fmt('bold')"><b>B</b></button>
      <button class="tb" title="斜体" @mousedown.prevent @click="fmt('italic')"><i>I</i></button>
      <button class="tb" title="下划线" @mousedown.prevent @click="fmt('underline')"><u>U</u></button>
      <button class="tb" title="删除线" @mousedown.prevent @click="fmt('strikeThrough')"><s>S</s></button>
      <NPopover trigger="click" :show-arrow="false">
        <template #trigger>
          <button class="tb" title="字体颜色" @mousedown.prevent><span style="border-bottom: 3px solid var(--accent)">A</span></button>
        </template>
        <div class="ob-swatches">
          <button v-for="c in COLORS" :key="c" class="swatch" :style="{ background: c }" :title="c" @mousedown.prevent @click="fmt('foreColor', c)" />
        </div>
      </NPopover>
      <NPopover trigger="click" :show-arrow="false">
        <template #trigger>
          <button class="tb" title="底色" @mousedown.prevent>底</button>
        </template>
        <div class="ob-swatches">
          <button v-for="c in HIGHLIGHTS" :key="c" class="swatch" :style="{ background: c }" :title="c" @mousedown.prevent @click="fmt('hiliteColor', c)" />
        </div>
      </NPopover>
      <button class="tb" title="清除格式" @mousedown.prevent @click="fmt('removeFormat')">清除</button>
      <span class="tb-sep" />
      <button class="tb" title="导入 MD / TXT（标题层级自动转为节点层级）" @click="importMd"><OIcon name="upload" :size="12" /> 导入</button>
      <span class="tb-sep" />
      <button class="tb" title="新建同级节点" :disabled="!focusedRow" @click="addSibling(focusedRow)"><OIcon name="plus" :size="11" /> 同级</button>
      <button class="tb" title="新建子节点（先点击选中一个节点）" :disabled="!focusedRow" @click="addChild(focusedRow)"><OIcon name="plus" :size="11" /> 子级</button>
      <span class="tb-sep" />
      <button class="tb" title="全部折叠" @click="foldAll(true)">折叠</button>
      <button class="tb" title="全部展开" @click="foldAll(false)">展开</button>
      <span class="ob-count">{{ nodeCount }} / {{ entryTotal }} 条目</span>
    </div>

    <div class="ob-editor" @dragover.prevent @drop.prevent="onDropRoot">
      <section class="write-surface">
      <template v-for="blk in blocks" :key="blk.id || 'flat'">
        <div
          v-if="blk.id"
          class="lore-set-head"
          :data-set="blk.id"
          :data-node="'m:' + blk.id"
          @contextmenu.prevent="onRowCtx(setRow(blk), $event)"
        >
          <button class="ls-fold" :class="{ folded: blk.fold }" :title="blk.fold ? '展开该设定集' : '折叠该设定集'" @click.stop="toggleSetFold(blk)"><span /></button>
          <input
            v-if="renaming && renaming.id === blk.id"
            v-model="renaming.value"
            class="ls-input"
            @keydown.enter.prevent="commitRename"
            @keydown.esc.prevent="renaming = null"
            @blur="commitRename"
          />
          <span v-else class="ls-name" @click="selectSet(blk)" @dblclick="renameSet(blk)">{{ blk.text }}</span>
          <span class="ls-count">{{ blk.count }} 条目</span>
          <span class="ls-ops">
            <button class="tb" title="在此设定集新建条目" @click.stop="addChild({ node: { id: blk.id } })"><OIcon name="plus" :size="11" /></button>
            <button class="tb" title="重命名设定集" @click.stop="renameSet(blk)">改名</button>
          </span>
        </div>
        <div
        v-for="row in blk.rows"
        :key="row.node.key"
        class="ob-row"
        :data-depth="row.depth"
        :data-node="row.node.key"
        :style="{ '--depth': row.depth }"
        :class="{
          'ns-row-on': ui.mubuSelectedId === row.node.id,
          'drop-before': drag.hintKey === row.node.key && drag.zone === 'before',
          'drop-after': drag.hintKey === row.node.key && drag.zone === 'after',
          'drop-inside': drag.hintKey === row.node.key && drag.zone === 'inside'
        }"
        @dragover.prevent="onDragOver(row, $event)"
        @drop.prevent.stop="onDrop(row)"
        @dragend="clearDrag"
        @dblclick="onRowDblClick(row, $event)"
        @contextmenu="onRowCtx(row, $event)"
      >
        <span v-for="d in row.depth" :key="d" class="ob-guide" :style="{ left: (d - 1) * 22 + 12 + 'px' }" />
        <button
          class="ob-bullet"
          :class="{ 'has-children': row.node.hasChildren, folded: row.node.fold }"
          :draggable="true"
          :title="row.node.hasChildren ? (row.node.fold ? '展开子节点' : '折叠子节点') : '拖拽移动节点'"
          @click="toggleFold(row)"
          @dragstart="onDragStart(row, $event)"
        />
        <div class="row-content">
        <div
          class="ob-text"
          contenteditable="true"
          spellcheck="false"
          :data-ph="row.node.text ? '' : '输入内容，回车新建节点…'"
          @input="onInput(row, $event)"
          @keydown="onKey(row, $event)"
          @paste="onPaste"
          @focus="onTextFocus"
        />
        <span v-if="row.node.tags.length" class="ob-tags">
          <button
            v-for="t in row.node.tags"
            :key="t"
            class="ob-tag"
            type="button"
            :title="`筛选标签「${t}」`"
            @mousedown.prevent
            @click.stop="filterByTag(t)"
          >{{ t }}</button>
        </span>
        </div>
        <span v-if="relSummary.get(relKeyOf(row.node.id))" class="ob-links">
          <button
            class="ob-relchip"
            type="button"
            :style="relChipStyle(row.node.id)"
            :title="`关联关系 ${relSummary.get(relKeyOf(row.node.id)).count} 条 · 悬停查看 · 点击设置`"
            @mousedown.prevent
            @click.stop="openRelPanel(row.node.id, $event.clientX, $event.clientY)"
            @mouseenter="showRelPop(row.node.id, $event)"
            @mouseleave="hideRelPopSoon"
          ><OIcon :name="relIconFor(relSummary.get(relKeyOf(row.node.id)).label)" :size="11" />{{ relChipText(row.node.id) }}</button>
        </span>
        <span class="ob-ops">
          <button class="ob-op" title="添加子节点" @click.stop="addChild(row)"><OIcon name="plus" :size="11" /></button>
          <button class="ob-op" title="节点操作（格式 / 标签 / 关系 / 复制 / 删除）" @click.stop="openRowMenu(row, $event)">···</button>
          <button class="ob-op" title="删除节点" @click.stop="deleteRow(row)"><OIcon name="close" :size="11" /></button>
        </span>
        </div>
      </template>
      <div v-if="!nodeCount" class="empty-shelf" style="padding-top: 50px">
        <template v-if="filterText">
          <div class="big">没有匹配条目</div>
          <p>当前筛选「{{ filterText }}」在整库中没有命中。</p>
          <button class="btn-primary" @click="clearFilter">清除筛选</button>
        </template>
        <template v-else-if="!sections.length">
          <div class="big">尚无设定集</div>
          <p>先创建一个设定集，再进入其中编写具体设定条目。</p>
          <button class="btn-primary" @click="createSet">新建设定集</button>
        </template>
        <template v-else>
          <div class="big">{{ focusNodeId ? '这个节点还没有子条目' : '这个设定集还是空的' }}</div>
          <p>{{ focusNodeId ? '写第一条子条目；按回车继续添加同级，Tab 添加子级。' : '写第一条设定；按回车继续添加同级条目，Tab 添加子级。' }}</p>
          <button class="btn-primary" @click="createFirst">{{ focusNodeId ? '添加子条目' : '添加第一条设定' }}</button>
        </template>
      </div>
      </section>

      <!-- 关联关系悬停浮层（行尾卡片 hover；移入浮层保持，点击行跳转） -->
      <div
        v-if="relPop && relPopEntries.length"
        class="ob-relpop"
        :class="{ flip: relPop.flip }"
        :style="{ left: relPop.x + 'px', top: relPop.y + 'px' }"
        @mouseenter="keepRelPop"
        @mouseleave="hideRelPopSoon"
        @contextmenu.prevent
      >
        <div class="ob-relpop-head">关联关系</div>
        <LoreRelRows :entries="relPopEntries" compact @pick="jumpRel" />
      </div>

      <div v-if="ctx.open" ref="ctxEl" class="ob-ctx" :style="{ left: ctx.x + 'px', top: ctx.y + 'px' }" @contextmenu.prevent>
        <template v-if="!ctx.linkSearch">
        <div class="ctx-item" :class="{ disabled: !selectionText() }" @mousedown.prevent @click="doCutText()"><span>剪切</span><span class="hint">Ctrl+X</span></div>
        <div class="ctx-item" :class="{ disabled: !selectionText() }" @mousedown.prevent @click="doCopyText()"><span>复制</span><span class="hint">Ctrl+C</span></div>
        <div class="ctx-item" @mousedown.prevent @click="doPastePlain()"><span>粘贴为纯文本</span><span class="hint">Ctrl+V</span></div>
        <div class="ctx-sep" />
        <div class="ctx-item" @mousedown.prevent @click="runCtx(() => fmt('bold'))"><span>加粗</span><span class="hint">Ctrl+B</span></div>
        <div class="ctx-item" @mousedown.prevent @click="runCtx(() => fmt('italic'))"><span>斜体</span><span class="hint">Ctrl+I</span></div>
        <div class="ctx-item" @mousedown.prevent @click="runCtx(() => fmt('underline'))"><span>下划线</span><span class="hint">Ctrl+U</span></div>
        <div class="ctx-item" @mousedown.prevent @click="runCtx(() => fmt('strikeThrough'))"><span>删除线</span></div>
        <div class="ob-ctx-colors" @mousedown.prevent>
          <span style="font-size: 11px; color: var(--text-dim)">颜色</span>
          <button v-for="c in COLORS" :key="c" class="swatch" :style="{ background: c }" :title="c" @mousedown.prevent @click="runCtx(() => fmt('foreColor', c))" />
        </div>
        <div class="ob-ctx-colors" @mousedown.prevent>
          <span style="font-size: 11px; color: var(--text-dim)">底色</span>
          <button v-for="c in HIGHLIGHTS" :key="c" class="swatch" :style="{ background: c }" :title="c" @mousedown.prevent @click="runCtx(() => fmt('hiliteColor', c))" />
        </div>
        <div class="ctx-item" @mousedown.prevent @click="runCtx(() => fmt('removeFormat'))"><span>清除格式</span></div>
        <div class="ctx-sep" />
        <div class="ctx-item" @mousedown.prevent @click="runCtx(() => indent(visible.find((r) => r.node.id === ctx.rowId)))"><span>降级</span><span class="hint">Tab</span></div>
        <div class="ctx-item" @mousedown.prevent @click="runCtx(() => outdent(visible.find((r) => r.node.id === ctx.rowId)))"><span>升级</span><span class="hint">Shift+Tab</span></div>
        <div class="ctx-item" @mousedown.prevent @click="runCtx(() => moveRow(visible.find((r) => r.node.id === ctx.rowId), -1))"><span>上移</span><span class="hint">Alt+↑</span></div>
        <div class="ctx-item" @mousedown.prevent @click="runCtx(() => moveRow(visible.find((r) => r.node.id === ctx.rowId), 1))"><span>下移</span><span class="hint">Alt+↓</span></div>
        <div class="ctx-sep" />
        <div class="ctx-item" @mousedown.prevent @click="runCtx(() => copyNode(visible.find((r) => r.node.id === ctx.rowId)))"><span>复制节点</span></div>
        <div class="ctx-item" @mousedown.prevent @click="runCtx(() => copyNode(visible.find((r) => r.node.id === ctx.rowId), true))"><span>剪切节点</span></div>
        <div class="ctx-item" :class="{ disabled: !clip }" @mousedown.prevent @click="!clip && runCtx(() => pasteClip(false))"><span>粘贴为同级</span></div>
        <div class="ctx-item" :class="{ disabled: !clip }" @mousedown.prevent @click="!clip && runCtx(() => pasteClip(true))"><span>粘贴为子节点</span></div>
        <div class="ctx-sep" />
        <div class="ctx-item" @mousedown.prevent @click="openLinkSearch()"><span>插入关系链接…</span><span class="hint">互联</span></div>
        <div v-if="ctx.linkSpan" class="ctx-item" @mousedown.prevent @click="removeCtxLink()"><span>移除该关系链接</span></div>
        <div class="ctx-item" @mousedown.prevent @click="openTagPanel()"><span>设置标签…</span><span class="hint">标签</span></div>
        <div class="ctx-item" @mousedown.prevent @click="openRelPanelFromCtx()"><span>设置关系…</span><span class="hint">关联</span></div>
        <div class="ctx-item" @mousedown.prevent @click="runCtx(() => openDetailRow(ctx.rowId))"><span>打开详情页</span><span class="hint">双击</span></div>
        <div class="ctx-sep" />
        <div class="ctx-item" @mousedown.prevent @click="runCtx(() => addSibling(visible.find((r) => r.node.id === ctx.rowId)))"><span>新建同级节点</span></div>
        <div class="ctx-item" @mousedown.prevent @click="runCtx(() => addChild(visible.find((r) => r.node.id === ctx.rowId)))"><span>新建子节点</span></div>
        <div v-if="ctx.hasChildren" class="ctx-item" @mousedown.prevent @click="runCtx(toggleCtxFold)"><span>{{ ctx.folded ? '展开子节点' : '折叠子节点' }}</span></div>
        <div class="ctx-item" @mousedown.prevent @click="runCtx(() => deleteRow(visible.find((r) => r.node.id === ctx.rowId)))"><span>删除节点</span></div>
        <div class="ctx-sep" />
        <div class="ctx-item" :class="{ disabled: !ai.ready }" :title="ai.ready ? '发送给恍然梦（附带此设定进入对话）' : AI_UNSET_HINT" @mousedown.prevent @click="ai.ready && aiLoreExpand()">
          <span>发送给恍然梦</span><span class="hint">梦</span>
        </div>
        <div class="ctx-sep" />
        <div class="ctx-item" @mousedown.prevent @click="runCtx(undo)"><span>撤销</span><span class="hint">Ctrl+Z</span></div>
        <div class="ctx-item" @mousedown.prevent @click="runCtx(redo)"><span>重做</span><span class="hint">Ctrl+Y</span></div>
        </template>
        <div v-else class="ctx-dlwrap">
          <DLinkPicker :initial-query="dlKeyword" @pick="insertCtxLink" />
          <button class="ctx-btn" style="width: 100%; margin-top: 8px" type="button" @mousedown.prevent @click="ctx.linkSearch = false">返回</button>
        </div>
      </div>
    </div>
      <footer class="fusion-write-footer">
        <span class="wf-path">{{ locatePath }}</span>
        <span class="wf-keys">Enter 同级 · Tab 层级 · 双击详情</span>
      </footer>
      <slot name="paper-footer" />
    </section>
  </div>
</template>