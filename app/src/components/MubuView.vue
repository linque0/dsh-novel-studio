<!-- 幻流设定幕布视图（MubuView）：无限嵌套大纲式设定编辑器，
     支持标题等级、标签/关联行内嵌入、图片插入与显隐、Markdown 导图导入、局部聚焦与撤销/重做历史。 -->
<script setup>
import { useLoreSort } from '../composables/useLoreSort.js'
import { useLoreRowWindow } from '../composables/useLoreRowWindow.js'
import { useLoreImages } from '../composables/useLoreImages.js'
import { cleanLoreHtml, clearLoreInlineColor, loreContentHtml, loreText, loreCaret, setLoreCaret, splitLoreSelection } from '../services/lore-editor-dom.js'
import LoreLinkComposer from './lore/LoreLinkComposer.vue'
import TaskLauncher from './ai/TaskLauncher.vue'
import { ref, reactive, computed, watch, nextTick, onMounted, onActivated, onDeactivated, onBeforeUnmount } from 'vue'
import { NPopover } from 'naive-ui'
import OIcon from './OIcon.vue'
import LoreWeightIcon from './LoreWeightIcon.vue'
import LoreImageHiddenNotice from './LoreImageHiddenNotice.vue'
import { entryWeightMeta } from '../services/lore-weights.js'
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
import { loreActiveFoldLevel, loreFoldedIdsForLevel, loreTreeMaxDepth } from '../services/lore-tree-layout.js'
import { parseLoreQuery, searchLoreNodes } from '../services/lore-search.js'

const work = useWorkStore()
const ui = useUiStore()
const ai = useAiStore()
/* 详情页复用本组件：focusNodeId = 当前查看的节点（其子条目成为纸面内容）。 */
const props = defineProps({
  focusNodeId: { type: String, default: '' },
})
const rootEl = ref(null)
const loreEditor = ref(null)
const rowSurface = ref(null)
const mobileToolsOpen = ref(false)
const ver = ref(0)
const rows = ref([])
const workspaceActive = ref(true)
const editorActive = computed(() => workspaceActive.value && ui.loreView === 'write')
let builtVersion = -1
const focusedRootId = computed(() => props.focusNodeId || (ui.loreScope === 'all' ? null : ui.loreRootId))
const focusNode = computed(() => work.mubuIndex.byId.get(focusedRootId.value) || null)
const contentRootId = computed(() => focusNode.value?.id || null)
const pending = reactive({ key: null, offset: 'end', reveal: true })
const focusedId = ref(null)
const editingKey = ref(null)
const composingKey = ref(null)
const ctx = reactive({ open: false, x: 0, y: 0, rowId: null, folded: false, hasChildren: false, linkSearch: false, linkSpan: null })
const clip = ref(null)
const cutId = ref(null)
const undoStack = computed(() => work.mubuHistory().past)
const redoStack = computed(() => work.mubuHistory().future)

const COLORS = ['#3c3427', '#8c6f4e', '#c0392b', '#d35400', '#27ae60', '#2980b9', '#8e44ad', '#7f8c8d']
const HIGHLIGHTS = ['#fff3a3', '#ffd6a5', '#ffa8a8', '#b8f2c9', '#a8d8ff', '#e0c3fc']

/* ---------- 组合树（由 store 节点组装） ---------- */
const searchHitCount = ref(0)
const searchTokens = computed(() => parseLoreQuery(ui.mubuQuery))
const isSearching = computed(() => searchTokens.value.length > 0)
function isTagSearchHit(tag) {
  if (!isSearching.value) return false
  const low = String(tag || '').toLowerCase()
  return searchTokens.value.some((tok) => low.includes(tok))
}
function build() {
  const { live, byId, children: byParent } = work.mubuIndex
  /* 筛选：命中项保留其祖先链，其余不渲染（ui.mubuQuery 由侧栏搜索与行尾标签共享）；搜索时自动在整库范围检索 */
  const { tokens, hitIds, keepIds } = searchLoreNodes(live, byId, ui.mubuQuery)
  const hasQuery = tokens.length > 0
  searchHitCount.value = hitIds.size
  const ok = (n) => !hasQuery || keepIds.has(n.id)
  const make = (n) => ({
    key: 'm:' + n.id,
    id: n.id,
    text: n.text || '',
    html: n.html ?? null,
    heading: n.heading || 0,
    tags: n.tags || [],
    weight: work.mubuEntryWeight(n),
    fold: !!n.fold,
    hasChildren: (byParent.get(n.id) || []).length > 0,
    parentId: n.parentId || null,
    searchHit: hasQuery && hitIds.has(n.id),
    searchContext: hasQuery && !hitIds.has(n.id),
    children: (byParent.get(n.id) || []).filter(ok).map(make)
  })
  const roots = hasQuery ? (byParent.get(null) || []) : (focusNode.value ? [focusNode.value] : byParent.get(null) || [])
  rows.value = roots.filter(ok).map(make)
  builtVersion = ver.value
}
let localTextMutating = false
watch([ver, editorActive], ([version, active]) => {
  if (active && version !== builtVersion) build()
})
watch(() => work.work?.id, () => ver.value++)
watch(() => work.mubuSetId, () => ver.value++)
watch(focusedRootId, () => ver.value++)
watch(() => work.mubuRevision, () => {
  if (localTextMutating) return
  ver.value++
})
watch(() => work.mubuTagMeta, () => ver.value++, { deep: true })
watch(() => ui.mubuQuery, () => ver.value++)
watch(
  () => ui.loreFocusId,
  (id) => {
    if (!id) return
    void locateRow(id, true)
    ui.loreFocusId = null
  }
)
async function locateRow(id, focus = false) {
  await nextTick()
  if (!editorActive.value) return
  const key = 'm:' + id
  if (!visible.value.some(row => row.node.key === key)) {
    for (const ancestor of work.mubuPath(id).slice(0, -1)) {
      if (ancestor.fold) work.mubuToggleFold(ancestor.id)
    }
    ver.value++
    await nextTick()
  }
  rowWindow.reveal(key, true)
  await nextTick()
  if (!editorActive.value) return
  const el = rootEl.value?.querySelector(`[data-node="m:${id}"]`)
  if (!el) return
  el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  el.classList.add('ob-flash')
  setTimeout(() => el.classList.remove('ob-flash'), 1600)
  if (focus) focusKeyFn(key, 'start', false)
}
onMounted(() => { if (editorActive.value && builtVersion < 0) build() })

/* 折叠状态展开成可见行（供 siblingsOf / 光标上下 / 拖拽复用；搜索期间视觉自动展开不改写持久化 fold） */
function flattenRows(list, depth = 0, forceExpand = false) {
  const out = []
  const walk = (ls, d) => {
    for (const n of ls) {
      out.push({ node: n, depth: d })
      if (!n.fold || forceExpand) walk(n.children, d + 1)
    }
  }
  walk(list, depth)
  return out
}
const visible = computed(() => flattenRows(rows.value, 0, isSearching.value))
// The toolbar can insert into the selected row or restore its last selection.
const pinnedRows = computed(() => [
  visible.value[0]?.node.key,
  ui.mubuSelectedId && 'm:' + ui.mubuSelectedId,
  focusedId.value,
  editingKey.value,
  composingKey.value,
  pending.key
])
const rowWindow = useLoreRowWindow(loreEditor, rowSurface, visible, pinnedRows)
const { entries: renderRows, windowed: windowedRows } = rowWindow
const entryTotal = computed(() => (isSearching.value || !focusNode.value) ? work.mubuIndex.live.length : work.mubuDescendants(focusNode.value.id).length + 1)
const filterText = computed(() => String(ui.mubuQuery || '').trim())
function clearSearchHighlight() {
  if (typeof CSS !== 'undefined' && CSS.highlights) CSS.highlights.delete('lore-search')
}
function syncSearchHighlight() {
  if (typeof CSS === 'undefined' || !CSS.highlights || typeof Highlight === 'undefined' || typeof document === 'undefined') return
  const tokens = searchTokens.value
  if (!editorActive.value || !tokens.length || !rootEl.value) {
    CSS.highlights.delete('lore-search')
    return
  }
  const ranges = []
  const textEls = rootEl.value.querySelectorAll('.ob-row.ob-search-hit .ob-text')
  for (const el of textEls) {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    let node
    while ((node = walker.nextNode())) {
      const low = (node.nodeValue || '').toLowerCase()
      if (!low) continue
      for (const tok of tokens) {
        let from = 0
        while (from < low.length) {
          const idx = low.indexOf(tok, from)
          if (idx === -1) break
          const range = document.createRange()
          range.setStart(node, idx)
          range.setEnd(node, idx + tok.length)
          ranges.push(range)
          from = idx + tok.length
        }
      }
    }
  }
  if (ranges.length) CSS.highlights.set('lore-search', new Highlight(...ranges))
  else CSS.highlights.delete('lore-search')
}
watch([renderRows, searchTokens, editorActive], () => {
  nextTick(syncSearchHighlight)
})
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
  const byId = work.mubuIndex.byId
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
function headAdd() {
  pushUndo()
  const parent = contentRootId.value
  if (focusNode.value?.fold) work.mubuToggleFold(parent)
  const node = work.mubuAdd(parent, null, '')
  commit(() => {}, 'm:' + node.id, 'start')
}

const foldMenuOpen = ref(false)
const foldTreeGraph = computed(() => {
  const map = new Map()
  const scopeIds = new Set()
  const foldedSet = new Set()
  const walk = (list) => {
    for (const r of list) {
      scopeIds.add(r.id)
      if (r.fold) foldedSet.add(r.id)
      map.set(r.id, r.children.map((c) => c.id))
      walk(r.children)
    }
  }
  walk(rows.value)
  return { rootIds: rows.value.map((r) => r.id), childrenOf: (id) => map.get(id) || [], scopeIds, foldedSet }
})
const maxTreeDepth = computed(() => Math.max(1, loreTreeMaxDepth(foldTreeGraph.value.rootIds, foldTreeGraph.value.childrenOf)))
const activeFoldLevel = computed(() => loreActiveFoldLevel(foldTreeGraph.value.rootIds, foldTreeGraph.value.childrenOf, foldTreeGraph.value.foldedSet))
const foldLevelLabel = computed(() => {
  if (activeFoldLevel.value === Infinity) return '全部'
  if (Number.isInteger(activeFoldLevel.value)) return `${activeFoldLevel.value}级`
  return '级别'
})

function foldAll(value) {
  work.mubuFoldAll(value)
  ver.value++
}

function foldToLevel(level) {
  const { rootIds, childrenOf, scopeIds } = foldTreeGraph.value
  if (level === Infinity) {
    foldAll(false)
    return
  }
  work.mubuSetFoldMap(loreFoldedIdsForLevel(rootIds, childrenOf, level), focusedRootId.value ? scopeIds : null)
  ver.value++
}

/* ---------- 撤销 / 重做（快照 + 差异落库） ---------- */
function pushUndo() { work.mubuCheckpoint() }
async function undo() { document.activeElement?.blur(); await work.mubuUndo(); ver.value++; nextTick(restorePosition) }
async function redo() { document.activeElement?.blur(); await work.mubuUndo('redo'); ver.value++; nextTick(restorePosition) }
function rememberPosition(event) {
  if (!editorActive.value) return
  const previous = ui.lorePositions[ui.lorePositionKey()] || {}
  const el = event?.type === 'blur' ? event.currentTarget : document.activeElement
  const titleId = el?.matches('.lore-h1[data-lore-id]') && rootEl.value?.closest('.lore-shell-wrap')?.contains(el) ? el.dataset.loreId : null
  ui.lorePositions[ui.lorePositionKey()] = { ...previous, scroll: rootEl.value?.querySelector('.ob-editor')?.scrollTop || 0, ...(titleId ? { caretId: titleId, offset: loreCaret(el) } : el?.matches('.ob-text') && rootEl.value?.contains(el) ? { caretId: el.closest('[data-node]').dataset.node.slice(2), offset: loreCaret(el) } : {}) }
}
function restorePosition() {
  const key = ui.lorePositionKey()
  nextTick(() => {
    if (!editorActive.value || key !== ui.lorePositionKey()) return
    const saved = ui.lorePositions[key] || {}
    if (loreEditor.value) loreEditor.value.scrollTop = saved.scroll || 0
    rowWindow.updateViewport()
    if (saved.caretId) focusKeyFn('m:' + saved.caretId, saved.offset, false)
  })
}
watch(() => ui.loreRestoreTick, restorePosition)
function enterNode(id) { rememberPosition(); ui.focusLoreNode(id, work.mubuPath(id)); work.setMubuSet(work.mubuRootOf(id)?.id) }
function setHeading(level) { const title = document.activeElement?.closest('.lore-h1[data-lore-id]'); const id = title?.dataset.loreId || focusedRow.value?.node.id; if (id) { work.mubuSetHeading(id, level); ver.value++ } }
function requestLink() { rootEl.value?.dispatchEvent(new CustomEvent('lore-insert-link', { bubbles: true })) }

/* ---------- 提交封装：FLIP 动画 + 重建 ---------- */
function captureRects() {
  const map = new Map()
  rootEl.value?.querySelectorAll('.ob-row').forEach((el) => map.set(el.dataset.node, el.getBoundingClientRect().top))
  return map
}
function playFlip(before) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
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
    if (focusKey) focusKeyFn(focusKey, offset)
  })
}

/* ---------- 焦点 ---------- */
function focusKeyFn(key, offset = 'end', reveal = true) {
  pending.key = key
  pending.offset = offset
  pending.reveal = reveal
  if (reveal) rowWindow.reveal(key)
  nextTick(applyFocus)
}
function applyFocus() {
  if (!pending.key || !rootEl.value || !editorActive.value) return
  const el = rootEl.value.querySelector(`[data-node="${pending.key}"] .ob-text`) || (pending.key === 'm:' + ui.loreRootId ? document.querySelector('.lore-main .lore-h1[contenteditable=true]') : null)
  if (!el) {
    pending.key = null
    return
  }
  if (pending.reveal) el.focus()
  setLoreCaret(el, pending.offset === 'start' ? 0 : pending.offset === 'end' ? Infinity : pending.offset)
  pending.key = null
}
const syncedText = new WeakMap()
function syncText(el, { value: node }) {
  if (document.activeElement === el || composingKey.value === node.key) return
  if (node.html != null) {
    const previous = syncedText.get(el)
    const html = previous?.source === node.html ? previous.html : cleanLoreHtml(node.html)
    if (el.innerHTML !== html) el.innerHTML = html
    syncedText.set(el, { source: node.html, html })
  } else if (el.textContent !== node.text || el.childNodes.length > 1 || (el.firstChild && el.firstChild.nodeType !== Node.TEXT_NODE)) {
    el.textContent = node.text
  }
}
const vLoreText = { mounted: syncText, updated: syncText }
function onTextFocus(e) {
  const row = e.currentTarget.closest('[data-node]')
  focusedId.value = row?.dataset.node || null
  editingKey.value = focusedId.value
  ui.mubuSelectedId = row?.dataset.node?.slice(2) || null
}
function onTextBlur(event) {
  rememberPosition(event)
  editingKey.value = null
}
function onEditorScroll() {
  rowWindow.updateScroll()
  rememberPosition()
}
/* 焦点行：focusedId 存的是 'm:id' 键，须按键匹配（此前拿它与裸 node.id 比较，永不命中） */
const focusedRow = computed(() => visible.value.find((r) => r.node.key === focusedId.value) || null)

/* ---------- 编辑操作 ---------- */
function onInput(row, e) {
  work.mubuCheckpoint('text:' + row.node.id)
  const el = e.currentTarget
  const text = loreText(el)
  const html = cleanLoreHtml(el.innerHTML)
  localTextMutating = true
  try {
    work.mubuSetText(row.node.id, text, html)
  } finally {
    localTextMutating = false
  }
  row.node.text = text
  row.node.html = html
  rememberPosition()
}

const { imageInput, imageAccept, chooseImages, onImageFiles, onLorePaste, onLoreDragOver, onLoreDrop } = useLoreImages(loreEditor, {
  work,
  selectedId: () => ui.mubuSelectedId,
  parentId: () => contentRootId.value,
  allowRoot: true,
  checkpoint: pushUndo,
  focusNew: id => nextTick(() => focusKeyFn('m:' + id))
})
function syncFocusedRow() {
  const el = document.activeElement
  if (!el || !el.classList?.contains('ob-text')) return
  const id = el.closest('[data-node]')?.dataset.node?.slice(2)
  if (id) work.mubuSetText(id, loreText(el), cleanLoreHtml(el.innerHTML))
}
function fmt(cmd, val = null) {
  pushUndo()
  document.execCommand(cmd, false, val)
  syncFocusedRow()
}
function resetColor(kind) {
  const active = document.activeElement?.classList?.contains('ob-text')
    ? document.activeElement
    : (ctx.rowId ? rowTextEl(ctx.rowId) : null)
  if (!active) return
  pushUndo()
  if (clearLoreInlineColor(active, kind)) {
    const id = active.closest('[data-node]')?.dataset.node?.slice(2)
    if (id) work.mubuSetText(id, loreText(active), cleanLoreHtml(active.innerHTML))
  }
}

function addSibling(row) {
  pushUndo()
  const r = row
    ? work.mubuAdd(row.node.parentId, row.node.id, '')
    : work.mubuAdd(contentRootId.value)
  commit(() => {}, 'm:' + r.id, 'start')
}
function createFirst() { headAdd() }
/* 纸面底部「＋ 添加节点」：优先在选中节点后加同级，否则在顶层第一节点后加 */
function addBottomNode() {
  if (!nodeCount.value) return headAdd()
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
  const el = document.activeElement
  pushUndo()
  const split = splitLoreSelection(el)
  el.innerHTML = split.beforeHtml
  work.mubuSetText(row.node.id, split.beforeText, split.beforeHtml)
  const next = work.mubuAdd(row.node.parentId || null, row.node.id, split.afterText, split.afterHtml)
  commit(() => {}, 'm:' + next.id, 'start')
}

function indent(row) {
  const sib = siblingsOf(row)
  const i = sib.findIndex((r) => r.node.key === row.node.key)
  if (i <= 0) return
  if (!work.mubuPlace(row.node.id, sib[i - 1].node.id, 'inside')) return
  commit(() => {}, row.node.key, 'end')
}
function outdent(row) {
  const n = row.node
  if (!n.parentId || !work.mubuPlace(n.id, n.parentId, 'outdent')) return
  if (focusNode.value && !work.mubuPath(n.id).some(x => x.id === focusNode.value.id)) ui.focusLoreNode(n.id, work.mubuPath(n.id))
  commit(() => {}, row.node.key, 'end')
}
function moveRow(row, dir) {
  const adjacent = siblingsOf(row)[siblingsOf(row).findIndex(item => item.node.id === row.node.id) + dir]
  if (!adjacent || !work.mubuPlace(row.node.id, adjacent.node.id, dir < 0 ? 'before' : 'after')) return
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
  const item = { ...JSON.parse(JSON.stringify(work.mubu.find(x => x.id === n.id) || n)), children: [] }
  for (const c of work.mubuChildren(n.id)) item.children.push(collectTree(c))
  return item
}
function copyNode(row, cut = false) {
  if (!row) return
  clip.value = [collectTree(row.node)]
  cutId.value = cut ? row.node.id : null
  window.native?.clipboardWriteText?.(row.node.text)
}
function pasteClip(asChild) {
  if (!clip.value) return
  const anchor = visible.value.find((r) => r.node.id === ctx.rowId) || visible.value[0]
  if (!anchor) return
  if (cutId.value) {
    const id = cutId.value
    if (id === anchor.node.id || work.mubuDescendants(id).some(n => n.id === anchor.node.id)) return
    if (!work.mubuPlace(id, anchor.node.id, asChild ? 'inside' : 'after')) return
    cutId.value = null
    commit(() => {}, 'm:' + id, 'start'); return
  }
  pushUndo()
  const first = work.mubuAddTree(asChild ? anchor.node.id : anchor.node.parentId, asChild ? null : anchor.node.id, clip.value)
  commit(() => {}, first ? 'm:' + first.id : null, 'start')
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
  if (e.isComposing || e.keyCode === 229) return
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
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); enterNode(row.node.id); return }
  if (e.key === 'Enter' && e.shiftKey) { e.preventDefault(); document.execCommand('insertLineBreak'); onInput(row, e); return }
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
  if (e.key === 'Backspace' && getSelection()?.isCollapsed && caretOffsetFromStart(el) === 0 && loreCaret(el) === 0) {
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
    const prevEl = rootEl.value?.querySelector(`[data-node="${prev.node.key}"] .ob-text`)
    const rowEl = rootEl.value?.querySelector(`[data-node="${row.node.key}"] .ob-text`)
    const mergedText = (prevEl ? prevEl.textContent : prev.node.text || '') + (rowEl ? rowEl.textContent : row.node.text || '')
    if (prev.node.html != null || row.node.html != null) {
      const mergedHtml = (prevEl?.innerHTML ?? loreContentHtml(prev.node)) + (rowEl?.innerHTML ?? loreContentHtml(row.node))
      work.mubuSetText(prev.node.id, mergedText, mergedHtml)
    } else {
      work.mubuSetText(prev.node.id, mergedText)
    }
    if (row.node.children.length) {
      // 子节点上提到本层
      for (const c of [...row.node.children].reverse()) work.mubuPlace(c.id, row.node.id, 'after', undefined, () => {})
    }
    work.mubuRemove(row.node.id)
    commit(() => {}, prev.node.key, 'end')
  } else if (row.node.parentId) {
    work.mubuPlace(row.node.id, row.node.parentId, 'outdent', undefined, () => {})
    commit(() => {}, row.node.key, 'start')
  }
}

/* ---------- 拖拽（虚拟滚动 + 推动让位 + FLIP 落位） ---------- */
const loreSort = useLoreSort(loreEditor, work, () => [
  contentRootId.value, ui.mubuQuery, ui.loreScope, ui.loreRootId
], () => ver.value++, undefined, { freeEntries: true, rowWindow })
watch(editorActive, (active) => {
  if (active) {
    nextTick(rowWindow.updateViewport)
  } else {
    loreSort.cancel()
    pending.key = null
    editingKey.value = null
    composingKey.value = null
  }
})

/* ---------- 导入 MD / TXT ---------- */
async function importMd() {
  const files = await pickFiles(['md', 'markdown', 'txt'])
  if (!files.length) return
  pushUndo()
  let nodesAdded = 0
  const anchorId = focusedId.value?.startsWith('m:') ? focusedId.value.slice(2) : null
  const parentId = anchorId && visible.value.some(row => row.node.id === anchorId) ? anchorId : contentRootId.value
  for (const f of files) {
    const { text } = decodeText(f.data)
    const tree = parseMubuMd(text)
    if (!tree.length) continue
    work.mubuAddTree(parentId, null, tree)
    nodesAdded += countTree(tree)
  }
  ver.value++
  if (anchorId) void locateRow(anchorId)
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
  if (id) work.mubuSetText(id, loreText(el), cleanLoreHtml(el.innerHTML))
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
const relPopEl = ref(null)
const relPopEntries = computed(() => (relPop.value ? work.loreLinksOf('mubu', relPop.value.nodeId) : []))
let relPopTimer = null
function showRelPop(id, e) {
  clearTimeout(relPopTimer)
  const r = e.currentTarget.getBoundingClientRect()
  const flip = r.bottom > window.innerHeight - 220 && r.top > 220
  relPop.value = { nodeId: id, x: Math.max(8, Math.min(r.left, window.innerWidth - 300)), y: flip ? r.top - 6 : r.bottom + 6, flip }
  nextTick(() => {
    const el = relPopEl.value
    if (!el || !relPop.value || relPop.value.nodeId !== id) return
    const box = el.getBoundingClientRect()
    const pad = 8
    const gap = 6
    const w = box.width || 280
    const h = box.height || 140
    let x = r.left + w <= window.innerWidth - pad ? r.left : r.right - w
    x = Math.max(pad, Math.min(x, window.innerWidth - w - pad))
    let nextFlip = false
    let y = r.bottom + gap
    if (y + h > window.innerHeight - pad) {
      if (r.top - gap - h >= pad) {
        nextFlip = true
        y = r.top - gap
      } else {
        nextFlip = false
        y = Math.max(pad, window.innerHeight - h - pad)
      }
    }
    relPop.value = { nodeId: id, x, y, flip: nextFlip }
  })
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
watch(
  () => ui.loreView,
  () => {
    foldMenuOpen.value = false
  }
)

let mubuListenersBound = false
function bindMubuListeners() {
  if (mubuListenersBound) return
  mubuListenersBound = true
  window.addEventListener('mousedown', onWinMouseDown, true)
  window.addEventListener('keydown', onWinKeyDown)
  window.addEventListener('wheel', onWinWheel, { passive: true })
  window.addEventListener('resize', closeCtx)
}
function unbindMubuListeners() {
  if (!mubuListenersBound) return
  mubuListenersBound = false
  window.removeEventListener('mousedown', onWinMouseDown, true)
  window.removeEventListener('keydown', onWinKeyDown)
  window.removeEventListener('wheel', onWinWheel)
  window.removeEventListener('resize', closeCtx)
}
onMounted(() => {
  if (!ai.loaded) ai.loadSettings() // 保障入口置灰判定基于已装载的配置（幂等）
  bindMubuListeners()
})
onActivated(() => {
  workspaceActive.value = true
  bindMubuListeners()
})
onDeactivated(() => {
  workspaceActive.value = false
  foldMenuOpen.value = false
  unbindMubuListeners()
  clearTimeout(relPopTimer)
  clearSearchHighlight()
})
onBeforeUnmount(() => {
  unbindMubuListeners()
  clearTimeout(relPopTimer)
  clearSearchHighlight()
})

/* ---------- 外壳（LoreWorkspace）驱动的入口 ----------
   A 视图交出头部后，「全部折叠 / 全部展开 / 新建条目」在头部、按钮要打到这套编辑逻辑；
   B/C → A 的「在条目中定位」要展开祖先、滚动并闪烁；返回 A 要复原滚动位置。 */
defineExpose({
  foldAll,
  headAdd,
  restorePosition,
  rememberPosition,
  getScroll() {
    return rootEl.value?.querySelector('.ob-editor')?.scrollTop || 0
  },
  setScroll(top) {
    if (loreEditor.value) loreEditor.value.scrollTop = Number(top) || 0
    rowWindow.updateScroll()
  },
  /** 展开目标路径，滚动到条目并高亮。 */
  focusNode(id) {
    if (id) return locateRow(id)
  }
})
</script>

<template>
  <TaskLauncher module="lore" />
  <LoreLinkComposer :editor-root="rootEl" :scope-root="focusedRootId" />
  <div ref="rootEl" class="lore-surface">
    <!-- 设计稿头部（.lore-head：crumbs / .lore-h1 / .lore-meta / 视图切换器 / 折叠与新建）归外壳
         LoreWorkspace 所有；这里只留编写区：工具条 → 整棵森林 → 集头与行。 -->
    <section class="lore-paper-col">
      <!-- 工具条（设计稿 .mubu-toolbar 分组）：撤销/重做 ｜ 格式(B I U S A 底 清除 导入) ｜ 同级/子级 ｜ 折叠/展开 ｜ 右端计数 -->
      <div class="ob-toolbar" :class="{ 'mobile-tools-open': mobileToolsOpen }">
      <button class="tb" title="撤销 (Ctrl+Z)" :disabled="!undoStack.length" @click="undo()">↶</button>
      <button class="tb" title="重做 (Ctrl+Y)" :disabled="!redoStack.length" @click="redo()">↷</button>
      <i class="tb-sep" />
      <button class="tb" title="加粗" @mousedown.prevent @click="fmt('bold')"><b>B</b></button>
      <button class="tb" title="斜体" @mousedown.prevent @click="fmt('italic')"><i>I</i></button>
      <button class="tb" title="下划线" @mousedown.prevent @click="fmt('underline')"><u>U</u></button>
      <button class="tb" title="删除线" @mousedown.prevent @click="fmt('strikeThrough')"><s>S</s></button>
      <NPopover trigger="click" :show-arrow="false">
        <template #trigger>
          <button class="tb" title="字体颜色" @mousedown.prevent><span style="border-bottom: 3px solid var(--accent)">A</span></button>
        </template>
        <div class="ob-swatch-pop">
          <div class="ob-swatches">
            <button v-for="c in COLORS" :key="c" class="swatch" :style="{ background: c }" :title="c" @mousedown.prevent @click="fmt('foreColor', c)" />
          </div>
          <button type="button" class="ob-swatch-reset" title="仅恢复默认字体颜色，保留加粗等其他格式" @mousedown.prevent @click="resetColor('color')">恢复默认颜色</button>
        </div>
      </NPopover>
      <NPopover trigger="click" :show-arrow="false">
        <template #trigger>
          <button class="tb" title="底色" @mousedown.prevent>底</button>
        </template>
        <div class="ob-swatch-pop">
          <div class="ob-swatches">
            <button v-for="c in HIGHLIGHTS" :key="c" class="swatch" :style="{ background: c }" :title="c" @mousedown.prevent @click="fmt('hiliteColor', c)" />
          </div>
          <button type="button" class="ob-swatch-reset" title="仅清除文字底色，保留加粗与字体颜色等其他格式" @mousedown.prevent @click="resetColor('background')">恢复无底色</button>
        </div>
      </NPopover>
      <button class="tb" title="清除格式" @mousedown.prevent @click="fmt('removeFormat')">清除</button>
      <button class="tb" title="导入 MD / TXT（标题层级自动转为节点层级）" @click="importMd"><OIcon name="upload" :size="12" /> 导入</button>
      <button class="tb" type="button" title="插入图片" @mousedown.prevent @click="chooseImages"><OIcon name="image" :size="12" /> 图片</button>
      <i class="tb-sep" />
      <button class="tb" title="新建同级节点" :disabled="!focusedRow" @click="addSibling(focusedRow)"><OIcon name="plus" :size="11" /> 同级</button>
      <button class="tb" title="新建子节点（先点击选中一个节点）" :disabled="!focusedRow" @click="addChild(focusedRow)"><OIcon name="plus" :size="11" /> 子级</button>
      <i class="tb-sep" />
      <button class="tb" title="全部折叠" @click="foldAll(true)">折叠</button>
      <button class="tb" title="全部展开" @click="foldAll(false)">展开</button>
      <NPopover v-model:show="foldMenuOpen" trigger="click" placement="bottom" :show-arrow="false">
        <template #trigger>
          <button class="tb" type="button" title="按层级折叠展开" @mousedown.prevent>{{ foldLevelLabel }}⌄</button>
        </template>
        <div class="lore-heading-menu lore-fold-menu" role="menu" aria-label="按层级折叠展开">
          <button type="button" role="menuitem" :class="{ on: activeFoldLevel === 0 }" @mousedown.prevent @click="foldToLevel(0); foldMenuOpen = false">全部折叠</button>
          <button v-for="lvl in maxTreeDepth" :key="lvl" type="button" role="menuitem" :class="{ on: activeFoldLevel === lvl }" @mousedown.prevent @click="foldToLevel(lvl); foldMenuOpen = false">展开至 {{ lvl }} 级</button>
          <button type="button" role="menuitem" :class="{ on: activeFoldLevel === Infinity }" @mousedown.prevent @click="foldToLevel(Infinity); foldMenuOpen = false">全部展开</button>
        </div>
      </NPopover>
      <span class="tb-gap" />
      <NPopover trigger="click" :show-arrow="false"><template #trigger><button class="tb" title="节点标题级别" @mousedown.prevent>H⌄</button></template><div class="lore-heading-menu"><button v-for="level in [0, 1, 2, 3]" :key="level" @mousedown.prevent @click="setHeading(level)">{{ level ? ['','一级标题','二级标题','三级标题'][level] : '普通节点' }}</button></div></NPopover>
      <button class="tb" title="插入双链" @mousedown.prevent @click="requestLink"><OIcon name="link" :size="12" /> 链接</button>
      <button class="tb lore-toolbar-overflow" :aria-expanded="mobileToolsOpen" @mousedown.prevent @click="mobileToolsOpen = !mobileToolsOpen">{{ mobileToolsOpen ? '收起工具' : '更多' }}</button>
      <small class="ob-count">{{ isSearching ? `命中 ${searchHitCount} / ${entryTotal} 条目` : `${nodeCount} / ${entryTotal} 条目` }}</small>
    </div>

    <input ref="imageInput" type="file" :accept="imageAccept" multiple hidden @change="onImageFiles" />
    <div ref="loreEditor" class="ob-editor" :class="{ 'lore-windowed': windowedRows }" @scroll="onEditorScroll" @pointerdown="loreSort.pointerDown" @dragstart.capture="loreSort.nativeDrag" @click.capture="loreSort.click" @dragover="onLoreDragOver" @drop="onLoreDrop">
      <section class="write-surface">
      <div ref="rowSurface">
      <template v-for="row in renderRows" :key="row.node?.key || row.gapKey">
      <div v-if="row.node" :ref="el => rowWindow.bind(row.node.key, el)" :data-lore-window-key="row.node.key" class="lore-write-row-slot">
      <div
        class="ob-row"
        :data-depth="row.depth"
        :data-node="row.node.key"
        :data-lore-sort-row="row.node.id"
        :style="{ '--depth': row.depth }"
        :class="{
          ['heading-' + row.node.heading]: !!row.node.heading,
          'has-children': row.node.hasChildren,
          'ns-row-on': ui.mubuSelectedId === row.node.id,
          'ob-search-hit': row.node.searchHit,
          'ob-search-ctx': row.node.searchContext,
        }"

        @contextmenu="onRowCtx(row, $event)"
      >
        <span v-for="d in row.depth" :key="d" class="ob-guide" :style="{ left: (d - 1) * 22 + 12 + 'px' }" />
        <button class="ob-fold-toggle" :class="{ folded: row.node.fold && !isSearching, empty: !row.node.hasChildren }" :disabled="!row.node.hasChildren" :aria-expanded="isSearching || !row.node.fold" :aria-label="row.node.fold ? '展开子节点' : '折叠子节点'" @click="toggleFold(row)"><OIcon name="caret-right" :size="12" /></button>
        <button
          class="ob-bullet"
          :class="{ 'has-children': row.node.hasChildren, folded: row.node.fold }"
          :title="'单击进入，按住拖动：' + row.node.text"
          :aria-label="'进入' + row.node.text"
          @click="enterNode(row.node.id)"
        />
        <div class="row-content">
        <div
          class="ob-text"
          v-lore-text="row.node"
          contenteditable="true"
          spellcheck="false"
          :data-ph="row.node.text ? '' : '输入内容，回车新建节点…'"
          @input="onInput(row, $event)"
          @keydown="onKey(row, $event)"
          @paste="onLorePaste"
          @focus="onTextFocus"
          @compositionstart="composingKey = row.node.key"
          @compositionend="composingKey = null"
          @keyup="rememberPosition"
          @mouseup="rememberPosition"
          @blur="onTextBlur"
        />
        <LoreImageHiddenNotice :node-id="row.node.id" :html="row.node.html" />
        <span v-if="row.node.tags.length || row.node.weight !== 'standard'" class="ob-tags">
          <button
            v-if="row.node.weight !== 'standard'"
            class="ob-tag ob-weight-chip"
            :class="`is-${row.node.weight}`"
            type="button"
            :title="`条目权重：${entryWeightMeta(row.node.weight).label}（点击编辑标签与权重）`"
            @mousedown.prevent
            @click.stop="openTagPanel(row.node.id, $event.clientX, $event.clientY)"
          ><LoreWeightIcon :weight="row.node.weight" :size="11" />{{ entryWeightMeta(row.node.weight).label }}</button>
          <button
            v-for="t in row.node.tags"
            :key="t"
            class="ob-tag"
            :class="{ 'is-search-hit': isTagSearchHit(t) }"
            type="button"
            :title="`筛选标签「${t}」`"
            @mousedown.prevent
            @click.stop="filterByTag(t)"
          ><LoreWeightIcon v-if="work.mubuTagWeight(t) !== 'standard'" :weight="work.mubuTagWeight(t)" :size="11" />{{ t }}</button>
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
      </div>
      <div v-else aria-hidden="true" :style="{ height: row.height + 'px' }" />
      </template>
      </div>
      <div v-if="!nodeCount" class="empty-shelf" style="padding-top: 50px">
        <template v-if="filterText">
          <div class="big">没有匹配条目</div>
          <p>当前筛选「{{ filterText }}」在整库中没有命中。</p>
          <button class="btn-primary" @click="clearFilter">清除筛选</button>
        </template>
        <template v-else>
          <div class="big">暂无设定节点</div>
          <button class="btn-primary" @click="createFirst">新建节点</button>
        </template>
      </div>
      </section>

      <!-- 关联关系悬停浮层（传送到 body，避免被 .lore-pane 的 backdrop-filter / overflow 偏移与裁切） -->
      <Teleport to="body">
      <div
        v-if="relPop && relPopEntries.length"
        ref="relPopEl"
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
      </Teleport>

      <Teleport to="body">
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
          <button type="button" class="swatch swatch-reset" title="恢复默认字体颜色（保留其他格式）" aria-label="恢复默认字体颜色" @mousedown.prevent @click="runCtx(() => resetColor('color'))" />
        </div>
        <div class="ob-ctx-colors" @mousedown.prevent>
          <span style="font-size: 11px; color: var(--text-dim)">底色</span>
          <button v-for="c in HIGHLIGHTS" :key="c" class="swatch" :style="{ background: c }" :title="c" @mousedown.prevent @click="runCtx(() => fmt('hiliteColor', c))" />
          <button type="button" class="swatch swatch-reset" title="恢复无底色（保留其他格式）" aria-label="恢复无底色" @mousedown.prevent @click="runCtx(() => resetColor('background'))" />
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
        <div class="ctx-item" :class="{ disabled: !clip }" @mousedown.prevent @click="clip && runCtx(() => pasteClip(false))"><span>粘贴为同级</span></div>
        <div class="ctx-item" :class="{ disabled: !clip }" @mousedown.prevent @click="clip && runCtx(() => pasteClip(true))"><span>粘贴为子节点</span></div>
        <div class="ctx-sep" />
        <div class="ctx-item" @mousedown.prevent @click="openLinkSearch()"><span>插入关系链接…</span><span class="hint">互联</span></div>
        <div v-if="ctx.linkSpan" class="ctx-item" @mousedown.prevent @click="removeCtxLink()"><span>移除该关系链接</span></div>
        <div class="ctx-item" @mousedown.prevent @click="openTagPanel()"><span>设置标签…</span><span class="hint">标签</span></div>
        <div class="ctx-item" @mousedown.prevent @click="openRelPanelFromCtx()"><span>设置关系…</span><span class="hint">关联</span></div>
        <div class="ctx-item" @mousedown.prevent @click="runCtx(() => openDetailRow(ctx.rowId))"><span>打开阅读视图</span></div>
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
      </Teleport>
    </div>
      <footer class="fusion-write-footer">
        <span class="wf-path">{{ locatePath }}</span>
        <span class="wf-keys">Enter 同级 · Tab 层级 · 圆点进入 · [[ 链接</span>
      </footer>
      <slot name="paper-footer" />
    </section>
  </div>
</template>
