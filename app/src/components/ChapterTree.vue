<script setup>
import { computed, h, ref, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { NTree, NButton, NModal, NInput, NDropdown, NPopover } from 'naive-ui'
import OIcon from './OIcon.vue'
import { useWorkStore } from '../stores/work'
import { useUiStore } from '../stores/ui'
import { autosave } from '../services/autosave'

const work = useWorkStore()
const ui = useUiStore()
const props=defineProps({inPanel:Boolean,navigationOnly:Boolean})
const emit=defineEmits(['read','window','collapse'])
const canCollapse=computed(()=>!props.inPanel&&!props.navigationOnly)
const deleteConfirm=ref(false)
const deleteTarget=ref(null)
/* 查找：只过滤喂给 NTree 的数据，key 不变，拖拽 / 右键 / 定位语义照旧。 */
const q = ref('')
const hitKw = (text) => String(text || '').toLowerCase().includes(q.value.trim().toLowerCase())

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
/* 过滤后的树：卷名命中就整卷保留，否则只留命中的章；两样都不中的卷整卷收起。 */
const filteredTree = computed(() => {
  if (!q.value.trim()) return treeData.value
  const out = []
  for (const v of treeData.value) {
    const volumeHit = hitKw(v.label)
    const children = volumeHit ? (v.children || []) : (v.children || []).filter((c) => hitKw(c.label))
    if (!volumeHit && !children.length) continue
    out.push({ ...v, children })
  }
  return out
})

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
  if (source.type === 'volume') return node.type === 'volume' && dropPosition !== 'inside' && !!node.id /* 「未分卷」伪节点无 id，不参与卷排序 */
  return dropPosition === 'inside' ? node.type === 'volume' : true
}

function onDrop({ node, dragNode, dropPosition }) {
  if (!dragNode) return
  if (dragNode.type === 'volume') {
    if (node.type !== 'volume' || dropPosition === 'inside' || !node.id) return
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
    return
  }
  const cid = dragNode.id
  if (dropPosition === 'inside') {
    /* 「未分卷」伪节点无 id → 按 orphans 语义移入未分卷 */
    work.moveChapterTo(cid, node.id ?? 'orphans', 'inside')
  } else if (node.type === 'chapter') {
    const target = work.chapters.find((c) => c.id === node.id)
    work.moveChapterTo(cid, target?.volumeId ?? null, dropPosition, node.id)
  } else {
    work.moveChapterTo(cid, node.id, 'inside')
  }
}

/* 字数列：卷用「N 章」，章用「N 字」，靠 data-suffix 分款式（class 名沿用 .chapter-count，验收靠它） */
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
function moveSel(dir) {
  if (selNode.value?.type === 'chapter') work.moveChapter(selNode.value.id, dir)
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
function openRename() {
  openRenameById(selNode.value)
}
const manageOptions=computed(()=>[
  {label:'上移',key:'up',disabled:selNode.value?.type!=='chapter'},
  {label:'下移',key:'down',disabled:selNode.value?.type!=='chapter'},
  {label:'重命名',key:'rename',disabled:!selNode.value},
  {type:'divider',key:'divider'},
  {label:'删除',key:'delete',disabled:!selNode.value}
])
function manage(key){
  if(key==='up')moveSel(-1)
  if(key==='down')moveSel(1)
  if(key==='rename')openRename()
  if(key==='delete'&&selNode.value){deleteTarget.value={...selNode.value,workId:work.work?.id};deleteConfirm.value=true}
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
      <span class="ct-search">
        <OIcon name="search" :size="12" aria-hidden="true" />
        <input v-model="q" type="search" placeholder="查找章节…" aria-label="查找章节" />
        <button v-if="q" type="button" title="清除查找" aria-label="清除查找" @click="q = ''">×</button>
      </span>
      <span class="ct-tools">
        <NDropdown trigger="click" :options="manageOptions" @select="manage">
          <button type="button" class="side-more" title="章节操作：上移 / 下移 / 重命名 / 删除" aria-label="章节操作">⋯</button>
        </NDropdown>
        <button v-if="canCollapse" type="button" class="side-fold" title="收起章节栏" aria-label="收起章节栏" aria-controls="writing-directory" aria-expanded="true" @click="emit('collapse')"><OIcon name="caret-right" :size="13" style="transform:rotate(180deg)" /></button>
      </span>
    </div>
    <div ref="sideListRef" class="side-list">
      <NTree
        :data="filteredTree"
        block-line
        draggable
        default-expand-all
        :selected-keys="selectedKeys"
        :allow-drop="allowDrop"
        :render-suffix="renderSuffix"
        :render-label="renderLabel"
        :node-props="nodeProps"
        @update:selected-keys="onSelect"
        @dragstart="({node})=>dragging=node"
        @dragend="dragging=null"
        @drop="onDrop"
      />
    </div>
    <p v-if="q && !filteredTree.length" class="ct-empty">没有匹配的章节。</p>
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
