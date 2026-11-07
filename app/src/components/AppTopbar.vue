<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useSlots, watch } from 'vue'
import { NDropdown } from 'naive-ui'
import AutoHideTopbar from './AutoHideTopbar.vue'
import { useUiStore } from '../stores/ui'
import { APP_NAVIGATION } from './app-navigation'
import DreamModeEntries from './agent/DreamModeEntries.vue'
import WritingStatsEntry from './stats/WritingStatsEntry.vue'

const props = defineProps({
  active: { type: String, default: 'shelf' },
  busy: Boolean,
  hasWork: Boolean,
  targetTitle: { type: String, default: '' },
  actions: { type: Array, default: () => [] },
  /* 窄栏保存态（<560）：顶栏动作整条隐藏后，只剩这个非交互状态点告诉作者存没存 */
  saveState: { type: String, default: 'saved' }
})
const emit = defineEmits(['navigate', 'create', 'action'])
const ui = useUiStore()
const nsPlugin = __NS_PLUGIN__
/* 导航胶囊只放六个模块：「设置」改由右簇的齿轮圆钮承担（emit navigate:settings），
   导航里不再重复第七项。 */
const navItems = computed(() => APP_NAVIGATION.filter(item => item.key !== 'settings'))
/* 窄栏（<560，由 dsh 皮肤 CSS 打开）只留 作品名 + 当前模块名 + ⋯；导航与锁定键收进下拉。 */
const currentLabel = computed(() => APP_NAVIGATION.find(item => item.key === props.active)?.label || '')
const narrowTitle = computed(() => (props.hasWork && props.targetTitle) ? props.targetTitle : '小说工坊')
const SAVE_LABEL = { saved: '已保存', saving: '保存中', dirty: '未保存', error: '保存失败' }
const saveLabel = computed(() => SAVE_LABEL[props.saveState] || SAVE_LABEL.saved)
/* ⋯ 菜单分两区：「动作」由工作台注入（窄栏把顶栏按钮收进来），「模块」才是 APP_NAVIGATION。
 * 两区都带前缀键，select 时按前缀分发，路由与动作互不污染。 */
/* 顶栏锁定键：插件版统一用这一枚圆形键（桌面皮肤保留 AutoHideTopbar 自带的吊舌）。
   锁定＝顶栏常驻；解锁＝自动隐藏，鼠标移到顶部再展开。 */
const pinLabel = computed(() => (ui.topbarAutoHide ? '锁定顶栏（始终显示）' : '解除顶栏锁定（自动隐藏）'))
function togglePin() { ui.setPref('topbarAutoHide', !ui.topbarAutoHide) }
const moreOptions = computed(() => [
  ...(props.actions.length ? [{ type: 'group', label: '动作', key: 'group-actions', children: props.actions }] : []),
  {
    type: 'group',
    label: '模块',
    key: 'group-nav',
    children: APP_NAVIGATION
      .filter(item => item.key !== props.active)
      .map(item => ({ label: item.label, key: 'nav:' + item.key, disabled: disabled(item.key) }))
  },
  /* 窄档（≤559）顶栏只留「作品名 + 当前模块名 + ⋯」，锁定键收进这里，保证窄栏也能锁/解锁。 */
  { type: 'group', label: '顶栏', key: 'group-topbar', children: [{ label: pinLabel.value, key: 'pin:toggle' }] }
])
function onSelect(key) {
  if (key === 'pin:toggle') return togglePin()
  if (typeof key === 'string' && key.startsWith('nav:')) return navigate(key.slice(4))
  emit('action', key)
}
/* 搜索圆钮在每个界面都在：带搜索槽位（书架）时展开槽位里的输入框，槽位内容常驻 DOM、
   默认收起，点圆钮或槽内控件拿到焦点（书架 '/' 快捷键）时展开；没有槽位（工作台）时
   直接打开全局搜索浮层，与工作台自己的「搜索」按钮同一个入口。 */
const slots = useSlots()
const searchOpen = ref(false)
function toggleSearch() {
  if (!slots.search) { ui.searchOpen = true; return }
  searchOpen.value = !searchOpen.value
}
const nav = ref(null)
const disabled = key => props.busy || (!props.hasWork && !['shelf', 'settings'].includes(key))
function navigate(key) {
  if (!disabled(key)) emit('navigate', key)
}
function title(item) {
  if (props.active !== 'shelf' || ['shelf', 'settings'].includes(item.key)) return item.label
  return props.hasWork ? `打开《${props.targetTitle}》的${item.label}` : '请先创建或选择作品'
}
/* 顶栏放不下时不折叠、不改序：导航保持横向滚动，滚轮就能翻出其余入口。
 * 这里只量"哪一侧还有内容"，交给 CSS 做单边渐隐提示。 */
const navOvf = ref('')
const navBudget = ref(0)
let measuring = false

function measureNav() {
  const el = nav.value
  if (!el || measuring || !el.clientWidth) return
  measuring = true
  try {
    if (nsPlugin) {
      const header = el.parentElement.getBoundingClientRect()
      const brand = el.parentElement.querySelector('.app-topbar-brand')?.getBoundingClientRect()
      const cluster = el.parentElement.querySelector('.app-topbar-cluster')?.getBoundingClientRect()
      const reserve = Math.max(brand ? brand.right - header.left : 0, cluster ? header.right - cluster.left : 0)
      const budget = Math.max(80, Math.floor(header.width - 2 * (reserve + 12)))
      if (navBudget.value !== budget) { navBudget.value = budget; nextTick(measureNav) }
    }
    const max = el.scrollWidth - el.clientWidth
    if (max <= 1) { navOvf.value = ''; return }
    const hasLeft = el.scrollLeft > 1
    const hasRight = el.scrollLeft < max - 1
    navOvf.value = hasLeft && hasRight ? 'both' : hasLeft ? 'start' : 'end'
  } finally {
    measuring = false
  }
}

/* 垂直滚轮转横向：顶栏一行没有纵向内容，吃掉它不影响页面。 */
function onNavWheel(event) {
  const el = nav.value
  if (!el || el.scrollWidth <= el.clientWidth + 1) return
  const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
  if (!delta) return
  event.preventDefault()
  el.scrollLeft += delta
  measureNav()
}

let navObserver = null
onMounted(async () => {
  await nextTick()
  await measureNav()
  if (typeof ResizeObserver === 'function') {
    navObserver = new ResizeObserver(() => { measureNav() })
    if (nav.value?.parentElement) navObserver.observe(nav.value.parentElement)
  }
  window.addEventListener('resize', measureNav)
})
onBeforeUnmount(() => {
  navObserver?.disconnect()
  navObserver = null
  window.removeEventListener('resize', measureNav)
})

watch(() => [props.active, ui.skin], async () => {
  await nextTick()
  await measureNav()
  nav.value?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
})
</script>

<template>
  <AutoHideTopbar class="app-topbar-shell" :auto-hide="ui.topbarAutoHide" @update:auto-hide="value => ui.setPref('topbarAutoHide', value)">
    <header class="app-topbar">
      <button type="button" class="app-topbar-brand" title="返回书架" aria-label="小说工坊，返回书架" :disabled="busy" @click="navigate('shelf')">
        <span class="app-topbar-brand-text">小说工坊<small>LATENT</small></span>
        <span class="app-topbar-narrow-title" :title="narrowTitle">{{ narrowTitle }}</span>
      </button>
      <nav ref="nav" class="app-topnav" aria-label="功能模块" :data-ovf="navOvf || null" :style="navBudget ? {maxWidth:navBudget+'px'} : undefined" @wheel="onNavWheel" @scroll="measureNav">
        <button v-for="item in navItems" :key="item.key" type="button" class="app-topnav-item" :data-nav="item.key" :class="{ active: active === item.key }" :aria-current="active === item.key ? 'page' : undefined" :disabled="disabled(item.key)" :title="title(item)" @click="navigate(item.key)">{{ item.label }}</button>
      </nav>
      <span class="app-topbar-current" aria-hidden="true">{{ currentLabel }}</span>
      <button v-if="nsPlugin && active === 'shelf'" type="button" class="app-topbar-create" aria-label="新书上架" @click="emit('create')">＋新书上架</button>
      <div class="app-topbar-cluster">
        <span class="app-topbar-save" :data-save-state="saveState" role="img" :aria-label="saveLabel" :title="saveLabel">
          <svg class="app-topbar-save-icon" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 4 4L19 6" /></svg>
          <span class="app-topbar-save-text">{{ saveLabel }}</span>
        </span>
        <div class="app-topbar-search-wrap" :class="{ 'is-open': searchOpen }">
          <button type="button" class="app-topbar-round app-topbar-search-toggle" aria-label="搜索" title="搜索" :aria-expanded="$slots.search ? (searchOpen ? 'true' : 'false') : undefined" @click="toggleSearch">
            <svg class="app-topbar-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4.5 4.5" /></svg>
          </button>
          <div v-if="$slots.search" class="app-topbar-search" data-topbar-search><slot name="search" /></div>
        </div>
        <WritingStatsEntry v-if="nsPlugin" class="app-topbar-round" :library="active==='shelf'" :disabled="busy" />
        <button v-if="nsPlugin" type="button" class="app-topbar-round app-topbar-settings" aria-label="设置" title="设置" @click="navigate('settings')">
          <svg class="app-topbar-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="3" /><path d="m10 3 4 0 .6 3 2 .9 2.8-1 2 3.4-2.2 2v2.4l2.2 2-2 3.4-2.8-1-2 .9-.6 3h-4l-.6-3-2-.9-2.8 1-2-3.4 2.2-2v-2.4L2.6 9.3l2-3.4 2.8 1 2-.9z" /></svg>
        </button>
        <button v-if="nsPlugin" type="button" class="app-topbar-round app-topbar-pin" :aria-pressed="!ui.topbarAutoHide" :aria-label="pinLabel" :title="pinLabel" @click="togglePin">
          <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
            <rect x="3.6" y="7.4" width="8.8" height="6.2" rx="1.7" />
            <path v-if="!ui.topbarAutoHide" d="M5.8 7.4V5.6a2.2 2.2 0 0 1 4.4 0v1.8" />
            <path v-else d="M5.8 7.4V5.6a2.2 2.2 0 0 1 4.4 0" />
          </svg>
        </button>
      </div>
      <span v-if="nsPlugin" class="writing-stats-mobile-wrap"><WritingStatsEntry :library="active==='shelf'" :disabled="busy" /></span>
      <span class="app-topbar-more-wrap"><NDropdown trigger="click" placement="bottom-end" :options="moreOptions" @select="onSelect"><button type="button" class="app-topbar-more" aria-label="更多模块" :title="'更多模块（当前：' + currentLabel + '）'">⋯</button></NDropdown></span>
      <div class="app-topbar-actions"><DreamModeEntries v-if="!nsPlugin && active==='shelf'" shelf :disabled="busy" @dream="ui.dreamLauncherOpen=true" /><slot name="actions" /></div>
    </header>
  </AutoHideTopbar>
</template>

<style>
.app-topbar-shell {
  --topbar-bg: var(--bg-panel);
  --topbar-text: var(--text);
  --topbar-muted: var(--text-dim);
  --topbar-accent: var(--accent);
  --topbar-line: var(--border);
  --topbar-font: var(--editor-font, 'Microsoft YaHei', sans-serif);
  min-width: 0;
  grid-column: 1 / -1;
}
.app-topbar {
  box-sizing: border-box; display: flex; align-items: center; gap: 16px;
  height: 84px; padding: 0 40px; min-width: 0; position: relative;
  background: var(--topbar-bg); color: var(--topbar-text); border-bottom: 1px solid var(--topbar-line);
}
/* 插件版顶栏的完整设计（四档高度、居中胶囊、右簇圆钮）在 dsh.css 的顶栏段落里；
   这里只留非插件皮肤的可用形态。 */
body[data-skin] .app-topbar .app-topbar-brand {
  display:flex; align-items:center; gap:10px; flex:none; padding:0; border:0; background:none;
  color:var(--topbar-text); cursor:pointer; font:20px/1.1 var(--topbar-font); white-space:nowrap;
}
.app-topbar-mark { display:none; }
.app-topbar-brand-text { letter-spacing:2px; }
body[data-skin] .app-topbar-brand-text small { display:inline-block; margin-left:8px; color:var(--topbar-muted); font:11px/1 var(--topbar-font); letter-spacing:.18em; opacity:.7; }
.app-topnav { display:flex; align-items:stretch; flex:1 1 auto; gap:24px; min-width:0; height:100%; overflow-x:auto; scrollbar-width:thin; scrollbar-color:var(--topbar-line) transparent; }
body[data-skin] .app-topbar .app-topnav-item {
  position:relative; display:flex; align-items:center; justify-content:center; flex:none; min-width:36px;
  padding:0 3px; border:0; border-radius:0; background:none; color:var(--topbar-muted);
  font:15px/1.5 var(--topbar-font); letter-spacing:1px; white-space:nowrap; cursor:pointer; transition:color .18s;
}
body[data-skin] .app-topbar .app-topnav-item:is(:hover,.active) { color:var(--topbar-accent); }
body[data-skin] .app-topbar button:disabled { opacity:.4; cursor:default; }
.app-topbar :is(button,[role='combobox']):focus-visible { outline:2px solid var(--topbar-accent); outline-offset:-3px; }
/* 右簇：已保存 + 搜索/设置/锁定三枚圆钮。非插件皮肤保持同一套骨架，配色由各皮肤接管。 */
.app-topbar-cluster { display:flex; align-items:center; gap:10px; flex:none; margin-left:auto; min-width:0; }
.app-topbar-save { display:inline-flex; align-items:center; gap:6px; flex:none; font:500 12px/1 var(--topbar-font); color:var(--topbar-muted); white-space:nowrap; pointer-events:none; }
.app-topbar-save-icon { display:block; width:13px; height:13px; flex:none; }
.app-topbar-round {
  display:inline-flex; align-items:center; justify-content:center; box-sizing:border-box; flex:none;
  width:40px; height:40px; padding:0; border:1px solid rgba(255,255,255,.16); border-radius:50%;
  background:rgba(255,255,255,.08); color:inherit; cursor:pointer;
  transition:background-color .16s ease, border-color .16s ease, color .16s ease;
}
.app-topbar-round:is(:hover,:focus-visible) { background:rgba(255,255,255,.16); border-color:rgba(255,255,255,.3); }
.app-topbar-round .app-topbar-ico { display:block; width:18px; height:18px; fill:none; stroke:currentColor; stroke-linecap:round; stroke-linejoin:round; }
.app-topbar-pin svg { display:block; width:18px; height:18px; fill:none; stroke:currentColor; stroke-width:1.4; stroke-linecap:round; stroke-linejoin:round; }
/* 搜索槽位：默认收起在圆钮下方，圆钮或槽内控件拿到焦点时展开（书架 '/' 快捷键照样能拉开）。 */
.app-topbar-search-wrap { position:relative; display:flex; align-items:center; flex:none; }
.app-topbar-search {
  position:absolute; top:calc(100% + 10px); right:0; z-index:8;
  display:flex; align-items:center; box-sizing:border-box; width:268px; height:38px; padding:0 14px;
  border:1px solid rgba(255,255,255,.16); border-radius:999px; background:rgba(16,18,24,.92);
  opacity:0; pointer-events:none; transform:translateY(-4px); transition:opacity .16s ease, transform .16s ease;
}
.app-topbar-search-wrap.is-open .app-topbar-search,
.app-topbar-search-wrap:focus-within .app-topbar-search { opacity:1; pointer-events:auto; transform:none; }
.app-topbar-search :is(input,.n-input) { width:100%; min-width:0; border:0; background:transparent; color:inherit; font:inherit; font-size:13px; outline:none; }
.app-topbar-actions { display:flex; align-items:center; gap:6px; flex:none; min-width:0; white-space:nowrap; }
/* 窄栏三件套默认不出现，只由 dsh 皮肤在 <560 打开（桌面版皮肤维持原有多行顶栏）。 */
.app-topbar-narrow-title, .app-topbar-current, .app-topbar-more-wrap { display:none; }
.app-topbar-actions .save-badge { margin:0; color:var(--topbar-muted); }
.app-topbar-actions .skin-picker { width:138px; }
.app-topbar #studio-task-actions .module-agent { border:0; padding:0; }
.app-topbar-shell .wb-topbar-content { background:var(--topbar-bg); }
.app-root[data-skin] .app-topbar-shell .wb-topbar-pin { background:var(--topbar-bg); color:var(--topbar-muted); border-color:var(--topbar-line); }
.app-topbar-shell .wb-topbar-edge::after { background:var(--topbar-accent); }
.workbench-shell > .app-topbar-shell { margin-inline:calc(-1 * var(--workbench-inset, 0px)); }
/* More specific than the historical skin grid: collapsed headers must reclaim their row. */
@media(max-width:1200px) {
  .app-topbar { height:72px; padding-inline:24px; gap:16px; }
  .app-topnav { gap:18px; }
  .app-topbar-actions .save-badge, body[data-skin] .app-topbar #studio-task-actions { display:none; }
}
@media(max-width:850px) {
  .app-topbar { height:64px; padding-inline:16px; gap:12px; }
  .app-topnav { gap:16px; }
}
@media(max-width:600px) {
  .app-topbar { display:grid; grid-template-columns:auto minmax(0,1fr); grid-template-rows:52px 48px; height:100px; gap:0 12px; padding-inline:12px; }
  .app-topnav { grid-column:1/-1; grid-row:2; width:100%; }
  .app-topbar-actions { grid-column:2; grid-row:1; justify-self:end; }
  .app-topnav-item.active::after { bottom:3px; }
}
@media(prefers-reduced-motion:reduce) {
  .app-topbar .app-topnav-item, .app-topbar-round, .app-topbar-search { transition:none; }
}
</style>
