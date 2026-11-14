import { defineStore } from 'pinia'
import { db } from '../db/database'
import { broadcastAppEvent } from '../services/appbus'
import { normalizeSkin } from '../skins/registry'
import { normalizeOutlineWidth } from '../components/outline/outline-layout.js'
import { clampWidth as clampLoreWidth } from '../components/lore/lore-layout.js'
import {normalizeWritingPaper,saveWritingPaperPreference} from '../services/writing-paper.js'
import { normalizeWritingLayout } from '../components/writing-layout/layout.mjs'
import { useWorkStore } from './work'
import { resolveLoreFocus } from '../services/lore-core.js'
import { normalizeCharPrefs, normalizeCharState } from '../components/characters/char-layout.js'
import { createSnippetPersistence } from '../services/snippet-persistence.js'
import { registerFlushHook } from '../services/autosave'
import { normalizeDrafts, normalizeSnipState } from '../components/snippets/snippet-model.js'
import { CJK_FONTS, LATIN_FONTS, FONT_MAP, LATIN_MAP, SETTINGS_SAVE_ERROR } from '../components/settings/settings-prefs.js'
import { SETTINGS_PAGE_KEYS } from '../components/settings/settings-catalog.js'

/* 人物会话状态的写入防抖（250ms）：拖宽 / 筛选 / 滚动都会频繁调 saveCharState，
   合并成一次 appconfig 写入；写失败静默（下一次改动会再试）。 */
let charStateTimer = null
let charStatePending = null
/* 灵感状态 / 草稿的写入防抖：草稿按键频繁（250ms），状态改动稀少（立即落）。 */
/* 设计稿状态名 → store 字段名（saveSnipState 的唯一映射点） */
const SNIP_FIELD = {
  view: 'snipView', filter: 'snipFilter', tag: 'snipTag', sort: 'snipSort', group: 'snipGroup',
  query: 'snipQuery', selected: 'snipSelectedId', moreTags: 'snipMoreTags', tagOrder: 'snipTagOrder', order: 'snipOrder', inspector: 'snipInspector', scroll: 'snipScroll'
}

/* 引擎按 store.$id 缓存：dev/devtools 下 Pinia 每次 action 调用都传一个新的 store proxy，
   this 不恒等，用 store 对象做键会让每次调用都新建引擎（会话与 apply 回调各归各的）。
   $id 跨调用稳定；apply 固定写第一次拿到的那个 proxy（同一个 reactive store，赋值仍响应）。 */
const snippetPersistence = new Map()
function snippetsFor(store) {
  const storeId=store.$id
  if(!snippetPersistence.has(storeId)) {
    const engine=createSnippetPersistence({
      read:async key=>(await db.appconfig.get(key))?.value,
      write:async(key,value)=>db.appconfig.put({key,value:plainPref(value)}),
      apply:snapshot=>{
        store.snipStateWorkId=snapshot.id
        for(const [key,field] of Object.entries(SNIP_FIELD))store[field]=snapshot.state[key]
        store.snipDrafts=snapshot.drafts;store.snipPersistence=snapshot.status
      }
    })
    snippetPersistence.set(storeId,engine)
    registerFlushHook(()=>engine.flushAll())
  }
  return snippetPersistence.get(storeId)
}

/* appconfig 落库前的纯数据降级：Dexie 走结构化克隆，Vue reactive proxy 会抛 DataCloneError
   （典型：{ ...ui.charPrefs, [v]: { ...one } } 只把被覆写的那一档摊平成普通对象，另一档仍是 proxy），
   结果是内存改了、库没写、刷新即丢。所有 pref 一律先过这里；undefined / 非对象原样返回。 */
function plainPref(value) {
  if (value === null || typeof value !== 'object') return value
  try { return JSON.parse(JSON.stringify(value)) } catch { return value }
}

/* 正文字体：中西文分离。--editor-font = 西文栈 + 中文栈（拉丁字符落西文，汉字落中文）。
   字体表的唯一真源在 components/settings/settings-prefs.js（设置页的纯归一函数也要用它校验 key，
   而那个文件夹里的模块要能被 node 单测直接加载）；这里只 re-export，
   FONT_MAP / LATIN_MAP 的既有导入点（如 SettingsWindow.vue）保持不变。 */
export { FONT_MAP, LATIN_MAP }

export const useUiStore = defineStore('ui', {
  state: () => ({
    view: 'shelf', // shelf | work
    workbenchMode: 'writing', // A view of the same work; never a separate manuscript.
    dreamLauncherOpen: false,
    agentPage: 'create',
    agentCandidateId: null,
    theme: 'xuan', // xuan 宣纸 | parchment 羊皮纸 | night 暗夜书房
    skin: 'original',
    editorFont: 'song', // 中文正文（CJK_FONTS key）
    editorLatin: 'none', // 西文正文（LATIN_FONTS key）
    fontSize: 17,
    writingPaperStyle: 'booklet',
    latentWritingLayout: {},
    writingPaperSaving: false,
    sideWidth: 252, // 侧栏宽度（180–480，右缘拖拽调节，appconfig 记忆）
    topbarAutoHide: false, // 顶栏默认隐藏（跨窗口持久化，悬停临时展开）
    outlineLeftWidth: 220,
    outlineRightWidth: 318,
    outlineDetailOpen: true,
    outlineSideOpen: true, // 大纲侧栏开合（收起后左缘标签恢复，appconfig 记忆）
    focusMode: false,
    readMode: false, // 正文阅读模式（巨排章号 + 限宽只读列；session 级，开书复位）
    dbError: false,
    loreFocusId: null,
    mubuSelectedId: null,
    mubuSyncTick: 0,
    mubuQuery: '', // 设定检索词（侧栏搜索框 ↔ 标签卡片点击联动；session 级）
    charQuery: '', // 人物检索词（赤月戏模块条；session 级）
    snippetQuery: '', // 灵感检索词（赤月戏模块条；session 级）
    mubuTagPanel: null, // 设定标签面板 { nodeId, x, y } | null（全局单例；App 主窗口与 PanelHost 各挂一份）
    loreRelationPanel: null, // 关联关系设置面板 { kind:'mubu'|'character', id, x, y } | null（全局单例，同上）
    /* 设定工作区三视图（2026-11-05 结构改造）：write 条目编写 / detail 设定详情 / map 视觉导图。
       三视图共用 loreActiveId（当前条目），外壳按它渲染 h1 与联动；loreReturn 是返回栈，
       元素 { view, id, scroll }（scroll = 离开 write 时 .ob-editor 的滚动位置）。 */
    loreRootId: null,
    loreRootPath: [],
    loreForward: [],
    loreNavSeeded: false,
    loreNavFold: [],
    loreLinksOpen: false,
    loreReferenceTab: 'backlinks',
    lorePeek: null,
    lorePositions: {},
    loreRestoreTick: 0,
    loreWorkId: null,
    loreView: 'write',
    loreActiveId: null,
    loreMapMode: 'hierarchy', // map 视图的两种模式：hierarchy 层级导图 / relations 关系网络
    loreReturn: [],
    /* 设定面板矩阵（设计稿 prefs 的对应物）：三列宽度 / 三列收起 / A 视图范围 writeScope。
       宽度按列分别记（nav 220 / list 300 / detail 348），收起态写 40px 细轨，
       范围 'set' 当前设定集 | 'all' 全部设定集。全部走 setPref 落 appconfig。 */
    loreNavWidth: 246,
    loreListWidth: 300,
    loreDetailWidth: 348,
    loreNavClosed: false,
    loreListClosed: false,
    loreDetailClosed: false,
    loreScope: 'set',
    /* 人物面板矩阵（原型 app.mjs:17 的 defaults / fusion.css:2-3）：两种视图各记左右栏宽与收起态，
       落 appconfig['charPrefs']（读回时用 char-layout.js 的 clampWidth 夹紧）。
       筛选词 / 关系范围 / 三处滚动位置按作品落 appconfig['charstate:<workId>']。 */
    charPrefs: normalizeCharPrefs(null),
    charRole: '',
    charTag: '',
    charScope: 'local',
    charScroll: { roster: 0, dossier: 0, context: 0 },
    charStateWorkId: null,
    /* 灵感模块的按作品状态：视图 / 筛选 / 标签 / 排序 / 手动顺序 / 详情开合 / 两视图滚动，
       与草稿（随手记 + 逐条未提交修改）分开存——草稿每次按键都变，状态很少变。
       落 appconfig['snipstate:<workId>'] 与 ['snipdraft:<workId>']。 */
    snipStateWorkId: null,
    snipView: 'journal',
    snipFilter: 'all',
    snipTag: '',
    snipSort: 'new',
    snipGroup: '',
    snipQuery: '',
    snipSelectedId: '',
    snipMoreTags: false,
    snipOrder: [],
    snipTagOrder: [],
    snipPersistence: {reading:false,pending:false,readError:false,writeError:false},
    snipInspector: { journal: true, board: false },
    snipScroll: { journal: {top:0,left:0}, board: {top:0,left:0} },
    snipDrafts: { quick: '', edit: {} },
    autosave: { pending: 0, saving: false, lastSavedAt: 0, error: false },
    searchOpen: false,
    statsOpen: false,
    statsWorkId: null,
    trashOpen: false,
    importOpen: false,
    exportOpen: false,
    helpOpen: false,
    aiDrawerOpen: false, // 恍然梦右侧停靠列开合（点击左栏「恍然梦」）
    aiDrawerWidth: 400, // 恍然梦停靠列宽度（300–640，左缘拖拽调节，appconfig 记忆）
    rightPanelOpen: true, // 正文右侧批注栏开合（面板内收起 / 右缘展开轨恢复，appconfig 记忆）
    sidePanelOpen: true, // 目录栏（章节栏）开合：收起后从左缘细轨恢复，正文获得整幅宽度（appconfig 记忆）
    revisionsCtx: null,
    /* ---------- 设置页（就地视图；面板窗口 SettingsWindow.vue 仍可用，两处共用这些偏好） ---------- */
    settingsPage: 'appearance', // 当前分类，值域见 SETTINGS_PAGE_KEYS
    settingsScroll: {}, // 分类键 → 内容区滚动位置（切走再回来不丢视角）
    settingsPreviewOpen: false, // 小窗口下把预览独立成一屏
    /* 偏好落库状态。pending/error 只描述「最近一次写」的结果；
       prefsDirty 是键 → 待写值，写失败后留在这里，retryPrefs 据此重写（内存值始终是用户当前选择）。 */
    prefsSave: { pending: false, error: '', at: 0 },
    prefsDirty: {},
    lastBackupAt: 0 // 最近一次备份真正写盘成功的时间戳（来自 appconfig['settings:lastBackupAt']）
  }),
  getters: {
    /* 兼容别名：原「全屏详情页」由 ui.loreDetailId 驱动，写点是 MubuTree 双击 / MubuView 双击 /
       Workbench.selectTab。现在真源是 loreView + loreActiveId，这里派生同义只读值，
       写入口见 actions.openLoreDetail / closeLoreDetail（Pinia getter 本身不可写）。 */
    loreDetailId: (state) => (state.loreView === 'detail' && state.loreActiveId ? state.loreActiveId : null),
    rootStyle(state) {
      const latin = (LATIN_FONTS[state.editorLatin] || LATIN_FONTS.none).stack
      const cjk = (CJK_FONTS[state.editorFont] || CJK_FONTS.song).stack
      return {
        '--editor-font': [latin, cjk].filter(Boolean).join(', '),
        '--editor-fs': state.fontSize + 'px'
      }
    }
  },
  actions: {
    async loadPrefs() {
      try {
        const rows = await db.appconfig.toArray()
        const map = Object.fromEntries(rows.map((r) => [r.key, r.value]))
        this.skin = normalizeSkin(map.skin)
        if (map.theme) this.theme = map.theme
        if (map.editorFont) this.editorFont = map.editorFont
        if (map.editorLatin) this.editorLatin = map.editorLatin
        if (map.fontSize) this.fontSize = Number(map.fontSize) || 17
        this.writingPaperStyle = normalizeWritingPaper(map.writingPaperStyle)
        this.latentWritingLayout = normalizeWritingLayout(map.latentWritingLayout)
        if (map.sideWidth) this.sideWidth = Math.min(480, Math.max(180, Number(map.sideWidth) || 252))
        if (map.topbarAutoHide !== undefined) this.topbarAutoHide = map.topbarAutoHide === true
        this.outlineLeftWidth = normalizeOutlineWidth('left', map.outlineLeftWidth)
        this.outlineRightWidth = normalizeOutlineWidth('right', map.outlineRightWidth)
        if (map.outlineDetailOpen !== undefined) this.outlineDetailOpen = !!map.outlineDetailOpen
        if (map.outlineSideOpen !== undefined) this.outlineSideOpen = !!map.outlineSideOpen
        if (map.aiDrawerWidth) this.aiDrawerWidth = Math.min(640, Math.max(300, Number(map.aiDrawerWidth) || 400))
        if (map.rightPanelOpen !== undefined) this.rightPanelOpen = !!map.rightPanelOpen
        if (map.sidePanelOpen !== undefined) this.sidePanelOpen = !!map.sidePanelOpen
        /* 设定面板矩阵的读回（设计稿 prefs 的对应物：navWidth/listWidth/detailWidth 与三个 closed、
           writeScope）：数值 clamp 到各列 min/max，closed 用 !! 归一，范围只认 'all'/'set'。 */
        if (map.loreNavWidth !== undefined) this.loreNavWidth = clampLoreWidth('nav', map.loreNavWidth)
        if (map.loreListWidth !== undefined) this.loreListWidth = clampLoreWidth('list', map.loreListWidth)
        if (map.loreDetailWidth !== undefined) this.loreDetailWidth = clampLoreWidth('detail', map.loreDetailWidth)
        if (map.loreNavClosed !== undefined) this.loreNavClosed = !!map.loreNavClosed
        if (map.loreListClosed !== undefined) this.loreListClosed = !!map.loreListClosed
        if (map.loreDetailClosed !== undefined) this.loreDetailClosed = !!map.loreDetailClosed
        if (!this.loreWorkId) this.loreScope = map.loreScope === 'all' ? 'all' : 'set'
        /* 人物面板矩阵的读回：两套视图的左右栏宽各自 clamp 到 min/max，收起态用 === true 归一。 */
        if (map.charPrefs) this.charPrefs = normalizeCharPrefs(map.charPrefs)
        /* 设置页自身的界面状态：分类只认三个合法键，其余按类型归一；
           读不到或值坏了就保持 state 里的默认值，不让旧配置把界面锁死。 */
        if (SETTINGS_PAGE_KEYS.includes(map['settings:page'])) this.settingsPage = map['settings:page']
        if (map['settings:scroll'] && typeof map['settings:scroll'] === 'object') this.settingsScroll = { ...map['settings:scroll'] }
        if (map['settings:preview'] !== undefined) this.settingsPreviewOpen = map['settings:preview'] === true
        if (map['settings:lastBackupAt'] !== undefined) this.lastBackupAt = Number(map['settings:lastBackupAt']) || 0
      } catch {
        /* 首次启动无配置 */
      }
    },
    /* ---------- 设定三视图（write / detail / map） ----------
       所有切换走这里：统一维护返回栈，并把「视图 + 当前条目 + 导图模式」按作品落 appconfig，
       刷新后恢复（验收：三个视图往返不丢当前条目，刷新恢复视图与选中项）。 */
    lorePositionKey() {
      return `${this.loreView}:${this.loreScope}:${this.loreView === 'write' ? this.loreRootId || 'root' : this.loreActiveId || ''}`
    },
    captureLoreLocation() {
      return JSON.parse(JSON.stringify({
        view: this.loreView, rootId: this.loreRootId, rootPath: this.loreRootPath,
        activeId: this.loreActiveId, selectedId: this.mubuSelectedId, scope: this.loreScope,
        mapMode: this.loreMapMode, query: this.mubuQuery,
        position: this.lorePositions[this.lorePositionKey()] || {}
      }))
    },
    applyLoreLocation(v) {
      const work = useWorkStore()
      if (work.work?.id) {
        const rootId = resolveLoreFocus(work.mubu, v.rootId, v.rootPath || [], work.work.id)
        const live = id => work.mubu.some(n => n.id === id && !n.deletedAt && n.workId === work.work.id)
        v = { ...v, rootId, rootPath: work.mubuPath(rootId).map(n => n.id), activeId: live(v.activeId) ? v.activeId : rootId, selectedId: live(v.selectedId) ? v.selectedId : rootId, ...(v.rootId && !rootId ? { scope: 'all' } : {}) }
      }
      this.loreView = ['write', 'detail', 'map'].includes(v.view) ? v.view : 'write'
      this.loreRootId = v.rootId || null; this.loreRootPath = v.rootPath || []
      this.loreActiveId = v.activeId || null; this.mubuSelectedId = v.selectedId || v.activeId || null
      this.loreScope = v.scope === 'all' ? 'all' : 'set'
      this.loreMapMode = v.mapMode === 'relations' ? 'relations' : 'hierarchy'
      this.mubuQuery = v.query || ''; this.lorePeek = null
      if (v.position) this.lorePositions[this.lorePositionKey()] = v.position
      this.loreRestoreTick++
    },
    navigateLore(patch, { replace = false } = {}) {
      const before = this.captureLoreLocation(), next = { ...before, ...patch }
      const identity = v => JSON.stringify([v.view, v.rootId, v.activeId, v.scope, v.mapMode, v.query])
      if (identity(before) === identity(next)) return
      if (!replace) { this.loreReturn = [...this.loreReturn, before].slice(-60); this.loreForward = [] }
      // A new location owns its own caret and scroll, rather than inheriting the source's.
      delete next.position
      this.applyLoreLocation(next)
    },
    focusLoreNode(id, path = []) {
      this.navigateLore({ view: 'write', rootId: id, rootPath: path.map(n => typeof n === 'string' ? n : n.id), activeId: id, selectedId: id, scope: 'set', query: '' })
      this.lorePeek = null
      this.loreNavFold = this.loreNavFold.filter(x => !this.loreRootPath.includes(x))
    },
    setLoreView(view, { id, scroll } = {}) {
      if (scroll != null) this.lorePositions[this.lorePositionKey()] = { ...this.lorePositions[this.lorePositionKey()], scroll }
      this.navigateLore({ view, ...(id !== undefined ? { activeId: id } : {}) })
    },
    setLoreMapMode(mode) { this.navigateLore({ mapMode: mode === 'relations' ? 'relations' : 'hierarchy' }) },
    openLoreDetail(id, options = {}) { if (id) this.setLoreView('detail', { ...options, id }) },
    closeLoreDetail() { this.setLoreView('write') },
    loreBack() {
      const previous = this.loreReturn.pop()
      if (!previous) return null
      this.loreForward.push(this.captureLoreLocation()); this.applyLoreLocation(previous); return previous
    },
    loreNext() {
      const next = this.loreForward.pop()
      if (!next) return null
      this.loreReturn.push(this.captureLoreLocation()); this.applyLoreLocation(next); return next
    },
    async persistLoreState(workId) {
      if (!workId || workId !== this.loreWorkId) return
      const value = { ...this.captureLoreLocation(), navFold: this.loreNavFold, linksOpen: this.loreLinksOpen, referenceTab: this.loreReferenceTab, positions: this.lorePositions }
      try { await db.appconfig.put({ key: 'lorestate:' + workId, value: JSON.parse(JSON.stringify(value)) }) } catch { /* keep the current position in memory */ }
    },
    async restoreLoreState(workId) {
      if (this.loreWorkId === workId) return
      this.loreWorkId = workId; this.loreReturn = []; this.loreForward = []
      this.lorePositions = {}; this.loreNavFold = []; this.loreNavSeeded = false; this.loreLinksOpen = false; this.loreReferenceTab = 'backlinks'
      this.applyLoreLocation({ view: 'write', scope: 'set' })
      try {
        const row = await db.appconfig.get('lorestate:' + workId)
        if (this.loreWorkId !== workId || !row?.value) return
        const v = row.value; this.lorePositions = v.positions || {}
        this.loreNavFold = v.navFold || []; this.loreNavSeeded = Array.isArray(v.navFold); this.loreLinksOpen = !!v.linksOpen
        this.loreReferenceTab = ['backlinks', 'outline', 'relations'].includes(v.referenceTab) ? v.referenceTab : 'backlinks'
        this.applyLoreLocation({ ...v, scope: v.scope || this.loreScope })
      } catch { /* an unreadable preference does not affect source content */ }
    },

    /* ---------- 人物工作区的按作品状态（视图 / 检索 / 角色 / 标签 / 关系范围 / 三处滚动） ----------
       视图在 charstate 里存 'profile' | 'graph'，读回时映射到 work.charView 的 'list' | 'graph' 值域
       （services/doublelinks.js:255 依赖后者）。写入一律 250ms 防抖、失败静默。 */
    captureCharState() {
      const work = useWorkStore()
      return {
        view: work.charView === 'graph' ? 'graph' : 'profile',
        query: this.charQuery,
        role: this.charRole,
        tag: this.charTag,
        scope: this.charScope,
        scroll: { ...this.charScroll }
      }
    },
    async loadCharState(workId) {
      if (!workId || this.charStateWorkId === workId) return
      this.charStateWorkId = workId
      const work = useWorkStore()
      this.charQuery = ''
      this.charRole = ''
      this.charTag = ''
      this.charScope = 'local'
      this.charScroll = { roster: 0, dossier: 0, context: 0 }
      work.setCharView('list')
      try {
        const row = await db.appconfig.get('charstate:' + workId)
        if (this.charStateWorkId !== workId || !row?.value) return
        const v = normalizeCharState(row.value)
        this.charQuery = v.query
        this.charRole = v.role
        this.charTag = v.tag
        this.charScope = v.scope
        this.charScroll = { ...v.scroll }
        if (work.work?.id === workId) work.setCharView(v.view === 'graph' ? 'graph' : 'list')
      } catch { /* 首次进入该作品或配置损坏：保持默认 */ }
    },
    saveCharState(workId, patch = {}) {
      if (!workId) return
      const base = charStatePending && charStatePending.workId === workId ? charStatePending.value : this.captureCharState()
      charStatePending = { workId, value: { ...base, ...patch } }
      clearTimeout(charStateTimer)
      charStateTimer = setTimeout(() => {
        const job = charStatePending
        charStatePending = null
        if (!job) return
        db.appconfig.put({ key: 'charstate:' + job.workId, value: JSON.parse(JSON.stringify(job.value)) })
          .catch(() => { /* 落库失败不影响当前编辑，下一次改动会重试 */ })
      }, 250)
    },

    /* ---------- 灵感模块的按作品状态与草稿 ---------- */
    captureSnipState() {
      return Object.fromEntries(Object.entries(SNIP_FIELD).map(([key,field])=>[key,plainPref(this[field])]))
    },
    async loadSnipState(workId) {if(workId)await snippetsFor(this).activate(workId)},
    async loadSnipDrafts(workId) {if(workId)await snippetsFor(this).activate(workId)},
    saveSnipState(patch={}, workId=this.snipStateWorkId) {
      if(!workId)return
      snippetsFor(this).patchState(workId,plainPref(patch))
    },
    saveSnipDrafts(patch={}, workId=this.snipStateWorkId) {
      if(!workId)return
      snippetsFor(this).patchDrafts(workId,plainPref(patch))
    },
    setSnipDraft(id,draft,workId=this.snipStateWorkId) {this.saveSnipDrafts({edit:{[id]:draft?{title:draft.title,body:draft.body,...(draft.base?{base:draft.base}:{}),...(draft.editing?{editing:true}:{})}:null}},workId)},
    getSnipSession(workId=this.snipStateWorkId){return snippetsFor(this).get(workId)},
    async retrySnipPersistence(){return snippetsFor(this).retry(this.snipStateWorkId)},
    async flushSnipPersistence(){return snippetsFor(this).flushAll()},

    async setSkin(value) {
      const skin = normalizeSkin(value)
      // Commit before displaying: a failed write leaves the current skin and theme intact.
      await db.appconfig.put({ key: 'skin', value: skin })
      this.skin = skin
      broadcastAppEvent('prefs-changed')
    },
    async setPref(key, value) {
      if (key === 'skin') return this.setSkin(value)
      if (key === 'writingPaperStyle') return this.setWritingPaperStyle(value)
      this[key] = value
      /* 落库必须是纯数据：reactive proxy 进不了结构化克隆（见文件头的 plainPref 说明） */
      await db.appconfig.put({ key, value: plainPref(value) })
      /* 跨窗口同步：其余窗口重载偏好（主题/字体等即时生效；处理端幂等，自身收到无副作用） */
      broadcastAppEvent('prefs-changed')
    },
    async saveLatentWritingLayout(area, patch) {
      // Merge inside one transaction so two windows can save different areas safely.
      try {
        const layout = await db.transaction('rw', db.appconfig, async () => {
          const key = 'latentWritingLayout'
          const saved = (await db.appconfig.get(key))?.value || {}
          const value = normalizeWritingLayout(area ? { ...saved, [area]: { ...saved[area], ...patch } } : {})
          await db.appconfig.put({ key, value })
          return value
        })
        this.latentWritingLayout = layout
        broadcastAppEvent('prefs-changed')
      } catch (error) {
        console.warn('Cannot save writing layout', error)
        return false
      }
      return true
    },
    async setWritingPaperStyle(value) {
      return saveWritingPaperPreference(this,value,{
        write:row=>db.appconfig.put(row),
        notify:()=>broadcastAppEvent('prefs-changed')
      })
    },

    /* ---------- 设置页的偏好写入（与 setPref 并存，setPref 的既有语义不动） ----------
       setPref 写库失败就 reject，那不是设置页要的：用户在设置页调完字体，选择必须立刻生效，
       写不进库也要保住当前选择并给出一条能重试的说明。所以这里先写内存再落库，
       失败不抛出、也不广播——广播会让其他窗口采纳一个根本没进库的值。 */
    async applyPref(key, value) {
      this[key] = value
      try {
        await db.appconfig.put({ key, value: plainPref(value) })
      } catch {
        this.prefsSave.pending = true
        this.prefsSave.error = SETTINGS_SAVE_ERROR
        this.prefsDirty[key] = value
        return false
      }
      this.prefsSave.pending = false
      this.prefsSave.error = ''
      this.prefsSave.at = Date.now()
      delete this.prefsDirty[key]
      broadcastAppEvent('prefs-changed')
      return true
    },
    /* 重试全部脏键：逐个写、成功即从 dirty 移除；只有全部成功才算恢复，部分成功保留剩余项。 */
    async retryPrefs() {
      const keys = Object.keys(this.prefsDirty)
      if (!keys.length) return !this.prefsSave.pending
      let recovered = true
      for (const key of keys) {
        try {
          await db.appconfig.put({ key, value: plainPref(this.prefsDirty[key]) })
          delete this.prefsDirty[key]
        } catch {
          recovered = false
        }
      }
      if (recovered) {
        this.prefsSave.pending = false
        this.prefsSave.error = ''
        this.prefsSave.at = Date.now()
        broadcastAppEvent('prefs-changed')
      } else {
        this.prefsSave.pending = true
        this.prefsSave.error = SETTINGS_SAVE_ERROR
      }
      return recovered
    },
    /* 分类 / 滚动 / 预览是纯界面状态：写失败静默，下一次切换再试，不值得打断写作。 */
    async saveSettingsUi() {
      try {
        await db.appconfig.put({ key: 'settings:page', value: plainPref(this.settingsPage) })
        await db.appconfig.put({ key: 'settings:scroll', value: plainPref(this.settingsScroll) })
        await db.appconfig.put({ key: 'settings:preview', value: this.settingsPreviewOpen === true })
      } catch { /* 静默：界面状态下次改动会再写 */ }
    }
  }
})
