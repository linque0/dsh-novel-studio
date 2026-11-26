<script setup>
import { computed, h, ref, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { NTree, NButton, NModal, NInput, NDropdown, NPopover } from 'naive-ui'
import OIcon from './OIcon.vue'
import { useWorkStore } from '../stores/work'
import { useUiStore } from '../stores/ui'
import { autosave } from '../services/autosave'
import { useChapterSort } from '../composables/useChapterSort'
import { findCharacterAliasSuggestion, highlightChapterSegments, searchChapters } from '../services/chapter-search.js'

const work = useWorkStore()
const ui = useUiStore()
const props=defineProps({inPanel:Boolean,navigationOnly:Boolean,collapsiblePanel:Boolean})
const emit=defineEmits(['read','window','collapse'])
const canCollapse=computed(()=>(!props.inPanel||props.collapsiblePanel)&&!props.navigationOnly)
const deleteConfirm=ref(false)
const deleteTarget=ref(null)
/* 查找：标题 + 正文联合全文检索（按全书章序，支持多词组合与人物别名可选扩展） */
const q = ref('')
const includeAliases = ref(false)
const searchCursor = ref(0)
const searchLimit = ref(80)
const searchInputEl = ref(null)

/* 树数据：书签章节加 ★ 前缀 */
const treeData = computed(() => {
  const marked = (key) => {
    if (!key || key.slice(0, 2) !== 'c:') return false
    return work.isChapterBookmarked(key.slice(2))
  }
  return work.treeData.map((v) => ({
    ...v,
    id:v.key==='v:orphans'?null:v.key.slice(2),
    children: (v.children || []).map((c) => ({
      ...c,
      id:c.key.slice(2),
      label: (marked(c.key) ? '★ ' : '') + c.label
    }))
  }))
})
const bookmarkedSet = computed(() => new Set((work.liveBookmarks || []).map((b) => b.targetId)))
const aliasSuggestion = computed(() => findCharacterAliasSuggestion(q.value, work.liveCharacters))
const chapterSearchState = computed(() =>
  searchChapters({
    volumes: work.liveVolumes,
    chapters: work.liveChapters,
    query: q.value,
    aliasSuggestion: aliasSuggestion.value,
    includeAliases: includeAliases.value,
    bookmarkedIds: bookmarkedSet.value
  })
)
const isSearching = computed(() => chapterSearchState.value.tokens.length > 0)
const searchResults = computed(() => chapterSearchState.value.results)
const visibleSearchResults = computed(() => searchResults.value.slice(0, searchLimit.value))
const hasMoreSearchResults = computed(() => searchResults.value.length > visibleSearchResults.value.length)
const aliasExtraPreview = computed(() => {
  const list = aliasSuggestion.value?.extraTerms || []
  return list.length > 3 ? `${list.slice(0, 3).join('、')} 等 ${list.length} 个` : list.join('、')
})

function clearChapterSearchQuery(focusInput = false) {
  q.value = ''
  includeAliases.value = false
  ui.clearChapterSearch()
  if (focusInput) nextTick(() => searchInputEl.value?.focus())
}
function toggleAliasSearch() {
  if (!aliasSuggestion.value) return
  includeAliases.value = !includeAliases.value
  searchCursor.value = 0
  if (ui.chapterSearch.active && work.selChapterId) {
    ui.openChapterSearchHit({
      query: chapterSearchState.value.query,
      terms: chapterSearchState.value.highlightTerms,
      includeAliases: includeAliases.value,
      chapterId: work.selChapterId,
      matchIndex: 0
    })
  }
}
function jumpToSearchResult(item, occurrenceIndex = 0, idx = null) {
  if (!item) return
  if (idx != null) searchCursor.value = idx
  work.selChapterId = item.chapterId
  if (item.chapter) work.selVolumeId = item.chapter.volumeId
  selNode.value = { type: 'chapter', id: item.chapterId, key: 'c:' + item.chapterId }
  ui.openChapterSearchHit({
    query: chapterSearchState.value.query,
    terms: chapterSearchState.value.highlightTerms,
    includeAliases: includeAliases.value && Boolean(aliasSuggestion.value),
    chapterId: item.chapterId,
    matchIndex: occurrenceIndex
  })
}
function scrollSearchCursor() {
  nextTick(() => {
    const el = sideListRef.value?.querySelector(`[data-chapter-hit-index="${searchCursor.value}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  })
}
function onSearchKeydown(e) {
  if (e.isComposing) return
  if (e.key === 'Escape' && q.value) {
    e.preventDefault()
    e.stopPropagation()
    clearChapterSearchQuery(true)
    return
  }
  if (!isSearching.value || !searchResults.value.length) return
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    const next = Math.min(searchResults.value.length - 1, searchCursor.value + 1)
    if (next >= searchLimit.value) searchLimit.value = next + 40
    searchCursor.value = next
    scrollSearchCursor()
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    searchCursor.value = Math.max(0, searchCursor.value - 1)
    scrollSearchCursor()
  } else if (e.key === 'Enter') {
    e.preventDefault()
    const hit = searchResults.value[searchCursor.value] || searchResults.value[0]
    if (hit) jumpToSearchResult(hit, 0, searchCursor.value)
  }
}
function searchSegs(text) {
  return highlightChapterSegments(text, chapterSearchState.value.highlightTerms)
}

// NTree 的 default-expand-all 会随 data 重算，显式保留用户折叠的卷。
const collapsedVolumes = ref(new Set())
const searchExpandedKeys = ref(null)
const expandedKeys = computed(() => {
  const keys = treeData.value.map((volume) => volume.key)
  if (q.value.trim()) return searchExpandedKeys.value ?? keys
  return keys.filter((key) => !collapsedVolumes.value.has(key))
})
watch(q, (val) => {
  searchExpandedKeys.value = null
  includeAliases.value = false
  searchCursor.value = 0
  searchLimit.value = 80
  if (sideListRef.value) sideListRef.value.scrollTop = 0
  if (!String(val || '').trim()) ui.clearChapterSearch()
}, { flush: 'sync' })
watch(() => work.work?.id, () => {
  collapsedVolumes.value = new Set()
  q.value = ''
  includeAliases.value = false
  ui.clearChapterSearch()
})
function onExpanded(keys, _options, { node, action }) {
  if (q.value.trim()) {
    searchExpandedKeys.value = keys
  } else if (action === 'collapse') {
    collapsedVolumes.value.add(node.key)
  } else if (action === 'expand') {
    collapsedVolumes.value.delete(node.key)
  }
}

const selectedKeys = computed(() => {
  const keys = []
  if (work.selChapterId) keys.push('c:' + work.selChapterId)
  return keys
})
const selNode = ref(null)

function onSelect(keys, _options, meta) {
  // A click on the active chapter emits an empty key list, but still identifies
  // its node. Keep that chapter as the management target after a volume click.
  const key = keys[keys.length - 1]
  if (!key) return
  const [kind, id] = [key.slice(0, 1), key.slice(2)]
  if (kind === 'c') {
    work.selChapterId = id
    const c = work.chapters.find((x) => x.id === id)
    if (c) work.selVolumeId = c.volumeId
    selNode.value = { type: 'chapter', id, key }
  } else {
    work.selVolumeId = id === 'orphans' ? null : id
    selNode.value = { type: 'volume', id, key }
  }
}

const dragging=ref(null)
const allowDrop = ({ dragNode, node, dropPosition }) => {
  // Naive UI's allowDrop callback supplies the target, not the drag source.
  const source=dragNode||dragging.value
  if(!source)return false
  return source.type === 'volume' && node.type === 'volume' && dropPosition !== 'inside' && !!node.id
}

function onDrop({ node, dragNode, dropPosition }) {
  if (dragNode?.type !== 'volume' || node.type !== 'volume' || dropPosition === 'inside' || !node.id) return
  const ids = work.liveVolumes.map((v) => v.id)
  const from = ids.indexOf(dragNode.id)
  if (from < 0) return
  ids.splice(from, 1)
  let to = ids.indexOf(node.id)
  if (dropPosition === 'after') to += 1
  ids.splice(to, 0, dragNode.id)
  ids.forEach((id, i) => {
    const v = work.volumes.find((x) => x.id === id)
    if (v && v.sortOrder !== i * 1000) {
      v.sortOrder = i * 1000
      autosave.mark('volumes', v)
    }
  })
}

const renderSuffix = ({ option }) =>
  h('span', { class: 'chapter-count', 'data-suffix': option.type === 'volume' ? 'volume' : 'chapter' }, option.suffix || '')
/* 卷 / 章同层渲染：data-kind 落在文本 span 上（皮肤选择器与 marquee 检测都靠它）。
   章名里本来就带「第三章」，再单开一列序号是重复占宽，故只留标题。 */
function renderLabel({ option }) {
  if (option.type === 'volume') return h('span', { class: 'ct-vol', 'data-kind': 'volume', title: option.label }, option.label)
  return h('span', { class: 'ct-label', 'data-kind': 'chapter', title: option.label }, option.label)
}

/* ---------- 溢出检测：章节名超出裁剪盒时加 is-marquee，交给 CSS 自动滚动 ---------- */
const sideListRef = ref(null)
const chapterSort = useChapterSort(sideListRef, work, q)
let marqueeObserver = null
let marqueeFrame = 0

function detectMarquee() {
  /* 推到布局稳定之后量，避免读到 0 宽或旧宽度 */
  if (marqueeFrame) cancelAnimationFrame(marqueeFrame)
  marqueeFrame = requestAnimationFrame(() => {
    marqueeFrame = 0
    try {
      const root = sideListRef.value
      if (!root || !root.querySelectorAll) return
      /* 量标题自己（它才是被裁剪的 flex 子项）：序号列是 flex 兄弟，不参与溢出判断 */
      root.querySelectorAll("[data-kind='chapter']").forEach((node) => {
        if (!node) return
        node.classList.toggle('is-marquee', node.scrollWidth > node.clientWidth + 1)
      })
    } catch (e) {
      /* 静默：量取失败保持原样，不影响树的其它功能 */
    }
  })
}

function watchMarquee() {
  try {
    const el = sideListRef.value
    if (!el || typeof ResizeObserver !== 'function') return
    if (marqueeObserver) marqueeObserver.disconnect()
    marqueeObserver = new ResizeObserver(() => detectMarquee())
    marqueeObserver.observe(el)
  } catch (e) {
    /* 静默：观察器不可用就不观察 */
  }
}

onMounted(() => {
  detectMarquee()
  nextTick(detectMarquee)
  watchMarquee()
})
watch(treeData, () => nextTick(detectMarquee))
onBeforeUnmount(() => {
  if (marqueeObserver) { marqueeObserver.disconnect(); marqueeObserver = null }
  if (marqueeFrame) { cancelAnimationFrame(marqueeFrame); marqueeFrame = 0 }
})

async function addVol() {
  const v=await work.addVolume(`第${work.liveVolumes.length + 1}卷`)

}
function openNewVolume(){
  if(!work.work||renameSaving.value)return
  renameComposing.value=false
  rename.value={show:true,kind:'volume',id:null,workId:work.work.id,create:true,value:`第${work.liveVolumes.length+1}卷`}
}
async function addCh() {
  const c=await work.addChapter()
}
function openRenameById(s) {
  if (!s) return
  renameComposing.value=false
  if (s.type === 'volume') {
    const v = work.volumes.find((x) => x.id === s.id)
    if(!v)return
    rename.value = { show: true, kind: 'volume', id: s.id, workId:work.work?.id, value: v.title }
  } else {
    const c = work.chapters.find((x) => x.id === s.id)
    if(!c)return
    rename.value = { show: true, kind: 'chapter', id: s.id, workId:work.work?.id, value: c.title }
  }
}
/* 章节栏头部的 ⋯ 菜单已整块换成「书签章节」下拉：上移/下移/重命名/删除与章节右键菜单重复，
 * 排序另有拖拽这条正式路径，因此不再保留第二份入口（功能去重）。
 * 书签下拉直接从 work.liveBookmarks 取，与齿轮菜单「章节书签」同源，不另建一份状态。 */
const bookmarkOptions = computed(() => {
  const list = work.liveBookmarks
  if (!list.length) return [{ label: '暂无书签：右键章节或工具栏 ☆ 可添加', key: 'none', disabled: true }]
  return list.map((b) => ({ label: b.title || '（未命名章节）', key: 'bm:' + b.targetId }))
})
function openBookmark(key) {
  if (key === 'none') return
  const id = key.slice(3)
  const c = work.chapters.find((x) => x.id === id)
  if (!c || c.deletedAt) return
  work.selChapterId = id
  if (c.volumeId) work.selVolumeId = c.volumeId
}
async function confirmDelete(){
  const target=deleteTarget.value
  if(target&&target.workId===work.work?.id)await delById(target)
  deleteConfirm.value=false
}
function bookmark(){
  if(!work.activeChapter)return
  const added=work.toggleChapterBookmark(work.activeChapter.id)
  window.$msg?.success(added?'已加入书签':'已移除书签')
}
async function confirmRename() {
  const r = rename.value
  const title=r.value.trim()
  if (!title||renameSaving.value||renameComposing.value) return
  if(r.workId!==work.work?.id){r.show=false;return}
  renameSaving.value=true
  try{
    if(r.create){
      const v=await work.addVolume(title)
    
    }else if (r.kind === 'volume') work.renameVolume(r.id, title)
    else work.renameChapter(r.id, title)
    if(rename.value===r)r.show=false
  }catch(error){window.$msg?.error('名称未能保存：'+(error?.message||'请重试'))}
  finally{renameSaving.value=false}
}
function submitRename(event){
  if(event.isComposing||event.keyCode===229||renameComposing.value)return
  event.preventDefault();confirmRename()
}
async function delById(s) {
  if (!s) return
  if (s.type === 'volume') await work.deleteVolume(s.id)
  else await work.deleteChapter(s.id)
  if (selNode.value?.id === s.id) selNode.value = null
}

/* ---------- 右键快捷栏 ---------- */
const ctx = ref({ show: false, x: 0, y: 0, kind: null, id: null, bookmarked: false })

function nodeProps({ option }) {
  return {
    'data-chapter-sort-chapter': option.type === 'chapter' ? option.id : undefined,
    'data-chapter-sort-volume': option.type === 'volume' ? option.id ?? 'orphans' : undefined,

    /* 双击行改名：只给章节（卷行双击仍归 naive 的展开/收起） */
    onDblclick: (e) => {
      if (option.type !== 'chapter') return
      e.preventDefault()
      openRenameById({ type: 'chapter', id: option.key.slice(2) })
    },
    onContextmenu: (e) => {
      e.preventDefault()
      const id = option.key.slice(2)
      onSelect([option.key], option)
      ctx.value = {
        show: true,
        x: e.clientX,
        y: e.clientY,
        kind: option.type,
        id,
        bookmarked: option.type === 'chapter' ? work.isChapterBookmarked(id) : false
      }
    }
  }
}
function closeCtx() {
  ctx.value.show = false
}
const ctxOptions = computed(() => {
  if (ctx.value.kind === 'chapter') {
    return [
      { label: ctx.value.bookmarked ? '移除书签' : '收藏书签', key: 'bm' },
      { label: '重命名', key: 'rename' },
      { label: '删除（进回收站）', key: 'del' }
    ]
  }
  return [
    { label: '重命名卷', key: 'rename' },
    { label: '删除卷（章目上提）', key: 'del' }
  ]
})
function onCtxSelect(key) {
  const c = ctx.value
  closeCtx()
  if (key === 'bm') {
    const added = work.toggleChapterBookmark(c.id)
    window.$msg?.success(added ? '已加入书签' : '已移除书签')
    return
  }
  if (key === 'rename') return openRenameById({ type: c.kind, id: c.id })
  if (key === 'del') return delById({ type: c.kind, id: c.id })
}

const rename = ref({ show: false, kind: 'chapter', id: null, value: '' })
const renameSaving=ref(false),renameComposing=ref(false)
</script>

<template>
  <div class="ct-root" :class="[canCollapse?'collapsible':null]" style="display: flex; flex-direction: column; height: 100%; position: relative">
    <div class="side-head">
      <span class="ct-search" :class="{ active: isSearching }">
        <OIcon name="search" :size="12" aria-hidden="true" />
        <input ref="searchInputEl" v-model="q" type="search" placeholder="搜索章节或正文…" aria-label="搜索章节或正文" @keydown="onSearchKeydown" />
        <button v-if="q" type="button" title="清除查找 (Esc)" aria-label="清除查找" @click.stop.prevent="clearChapterSearchQuery(true)">×</button>
      </span>
      <span class="ct-tools">
        <NDropdown trigger="click" :options="bookmarkOptions" @select="openBookmark">
          <button type="button" class="side-more side-bookmarks" :title="'书签章节：' + work.liveBookmarks.length + ' 个，点击跳转'" aria-label="书签章节">
            <OIcon name="star" :size="13" />
          </button>
        </NDropdown>
        <button v-if="canCollapse" type="button" class="side-fold" title="收起章节栏" aria-label="收起章节栏" aria-controls="writing-directory" aria-expanded="true" @click="emit('collapse')"><OIcon name="caret-right" :size="13" style="transform:rotate(180deg)" /></button>
      </span>
    </div>
    <div v-if="isSearching" class="ct-search-meta">
      <div class="ct-search-head">
        <span class="ct-search-summary">找到 <b>{{ searchResults.length }}</b> 章<template v-if="chapterSearchState.totalHits > 0"> · {{ chapterSearchState.totalHits }} 处</template></span>
        <button type="button" class="ct-search-reset" @click="clearChapterSearchQuery(false)">清除</button>
      </div>
      <button
        v-if="aliasSuggestion"
        type="button"
        class="ct-alias-toggle"
        :class="{ on: includeAliases }"
        :aria-pressed="includeAliases"
        :title="`点击${includeAliases ? '取消' : ''}并入「${aliasSuggestion.name}」的别名检索`"
        @click="toggleAliasSearch"
      >
        <span class="ct-alias-dot" aria-hidden="true" />
        <span class="ct-alias-text">含「{{ aliasSuggestion.name }}」别名：{{ aliasExtraPreview }}</span>
      </button>
    </div>
    <div ref="sideListRef" class="side-list" @pointerdown="chapterSort.pointerDown" @dragstart.capture="chapterSort.nativeDrag" @click.capture="chapterSort.click">
      <template v-if="isSearching">
        <div v-if="searchResults.length" class="ct-search-list" role="listbox" aria-label="正文检索结果">
          <div
            v-for="(item, idx) in visibleSearchResults"
            :key="item.chapterId"
            role="option"
            tabindex="0"
            :aria-selected="work.selChapterId === item.chapterId"
            :data-chapter-hit-index="idx"
            :data-chapter-hit-id="item.chapterId"
            class="ct-search-item"
            :class="{ current: work.selChapterId === item.chapterId, 'kb-active': searchCursor === idx }"
            @click="jumpToSearchResult(item, 0, idx)"
            @keydown.enter.prevent="jumpToSearchResult(item, 0, idx)"
          >
            <div class="ct-search-item-head">
              <span class="ct-search-title" :title="item.title"><template v-if="item.bookmarked">★ </template><template v-for="(seg, sIdx) in searchSegs(item.title)" :key="sIdx"><mark v-if="seg.mark" class="ct-search-mark">{{ seg.text }}</mark><template v-else>{{ seg.text }}</template></template></span>
              <span class="ct-hit-badge" :class="{ 'is-title': !item.bodyHitCount }">{{ item.bodyHitCount > 0 ? `${item.bodyHitCount} 处` : '标题' }}</span>
            </div>
            <div v-if="item.volumeTitle" class="ct-search-vol">
              <template v-for="(seg, vIdx) in searchSegs(item.volumeTitle)" :key="vIdx"><mark v-if="seg.mark" class="ct-search-mark">{{ seg.text }}</mark><template v-else>{{ seg.text }}</template></template>
            </div>
            <div v-if="item.excerpts.length" class="ct-search-excerpts">
              <button
                v-for="(ex, eIdx) in item.excerpts"
                :key="eIdx"
                type="button"
                class="ct-search-excerpt"
                @click.stop="jumpToSearchResult(item, ex.occurrenceIndex, idx)"
              ><template v-for="(seg, tIdx) in searchSegs(ex.text)" :key="tIdx"><mark v-if="seg.mark" class="ct-search-mark">{{ seg.text }}</mark><template v-else>{{ seg.text }}</template></template></button>
            </div>
          </div>
          <button v-if="hasMoreSearchResults" type="button" class="ct-search-more" @click="searchLimit = searchResults.length">显示全部 {{ searchResults.length }} 章</button>
        </div>
        <div v-else class="ct-empty ct-search-empty">
          <p>没有包含「{{ chapterSearchState.query }}」的章节</p>
          <button type="button" class="ct-search-reset" @click="clearChapterSearchQuery(true)">清除搜索</button>
        </div>
      </template>
      <NTree
        v-else
        :data="treeData"
        block-line
        draggable
        :expanded-keys="expandedKeys"
        :selected-keys="selectedKeys"
        :allow-drop="allowDrop"
        :render-suffix="renderSuffix"
        :render-label="renderLabel"
        :node-props="nodeProps"
        @update:selected-keys="onSelect"
        @update:expanded-keys="onExpanded"
        @dragstart="({node})=>dragging=node"
        @dragend="dragging=null"
        @drop="onDrop"
      />
    </div>
    <div class="side-foot">
      <NButton class="sp-new" size="small" @click="addCh">＋ 新建章</NButton>
      <button class="sp-ghost" type="button" @click="addVol">新建卷</button>
    </div>

    <NDropdown
      trigger="manual"
      :show="ctx.show"
      :x="ctx.x"
      :y="ctx.y"
      :options="ctxOptions"
      placement="bottom-start"
      @select="onCtxSelect"
      @clickoutside="closeCtx"
    />

    <NModal v-model:show="deleteConfirm" preset="dialog" title="确认删除" positive-text="删除" negative-text="取消" @positive-click="confirmDelete">
      {{deleteTarget?.type==='volume'?'将删除本卷及其中章节，删除后可在回收站恢复。':'删除后可在回收站恢复。'}}
    </NModal>
    <NModal v-model:show="rename.show" preset="dialog" :title="rename.create ? '新建卷' : rename.kind === 'volume' ? '重命名卷' : '重命名章节'">
      <NInput v-model:value="rename.value" :aria-label="rename.kind === 'volume' ? '卷名' : '名称'" :placeholder="rename.kind === 'volume' ? '请输入卷名' : '名称'" :disabled="renameSaving" @keydown.enter="submitRename" @compositionstart="renameComposing=true" @compositionend="renameComposing=false" />
      <template #action>
        <NButton :disabled="renameSaving" @click="rename.show = false">取消</NButton>
        <NButton type="primary" :loading="renameSaving" :disabled="!rename.value.trim()||renameSaving" @click="confirmRename">确定</NButton>
      </template>
    </NModal>
  </div>
</template>

<style scoped>
/* 底部工具条：只留 display:flex 骨架，药丸外观交给皮肤 CSS */
.side-foot{display:flex;align-items:center;gap:6px}
/* 收起章节栏：与批注栏 .rp-fold 同规格 22×22，排在顶条末位贴右 */
.side-fold{flex:none;display:flex;align-items:center;justify-content:center;width:22px;height:22px;margin-left:auto;padding:0;border:none;border-radius:6px;background:transparent;color:var(--text-dim);cursor:pointer;transition:background .15s,color .15s}
.side-fold:hover,.side-fold:focus-visible{background:color-mix(in srgb,var(--accent,#8c6f4e) 14%,transparent);color:var(--text)}
/* ⋯ 章节操作菜单触发器：只给 22×22 骨架，颜色/底色交给皮肤 */
.side-more{flex:none;width:22px;height:22px;padding:0;border:none;background:transparent;border-radius:6px;display:inline-flex;align-items:center;justify-content:center;line-height:1;cursor:pointer}
</style>
