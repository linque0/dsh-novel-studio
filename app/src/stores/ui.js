import { defineStore } from 'pinia'
import { db } from '../db/database'
import { broadcastAppEvent } from '../services/appbus'
import { normalizeSkin } from '../skins/registry'
import { normalizeOutlineWidth } from '../components/outline/outline-layout.js'
import {normalizeWritingPaper,saveWritingPaperPreference} from '../services/writing-paper.js'

/* 正文字体：中西文分离。--editor-font = 西文栈 + 中文栈（拉丁字符落西文，汉字落中文）。
   素材：思源宋体/霞鹜文楷/京华老宋体/朝华标题/云游手书/Gothic One 均已本地化（src/assets/fonts） */
const CJK_FONTS = {
  song: { label: '思源宋体', stack: '"Noto Serif SC", "SimSun", serif' },
  kai: { label: '霞鹜文楷', stack: '"LXGW WenKai", "KaiTi", serif' },
  jinghua: { label: '京华老宋体', stack: '"KingHwa OldSong", "SimSun", serif' },
  zhaohua: { label: '朝华标题', stack: '"Zhaohua Title", "SimSun", serif' },
  yunyou: { label: '云游手书', stack: '"Ziyu Yunyou", "KaiTi", serif' },
  hei: { label: '系统黑体', stack: '"Microsoft YaHei", "PingFang SC", sans-serif' }
}
const LATIN_FONTS = {
  none: { label: '跟随中文', stack: '' },
  playfair: { label: 'Playfair Display', stack: '"Playfair Display"' },
  gothic: { label: 'Montenegrin Gothic One', stack: '"Montenegrin Gothic One"' }
}
export const FONT_MAP = CJK_FONTS
export const LATIN_MAP = LATIN_FONTS

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
    loreView: 'write',
    loreActiveId: null,
    loreMapMode: 'hierarchy', // map 视图的两种模式：hierarchy 层级导图 / relations 关系网络
    loreReturn: [],
    autosave: { pending: 0, saving: false, lastSavedAt: 0 },
    searchOpen: false,
    statsOpen: false,
    trashOpen: false,
    importOpen: false,
    exportOpen: false,
    helpOpen: false,
    aiDrawerOpen: false, // 恍然梦右侧停靠列开合（点击左栏「恍然梦」）
    aiDrawerWidth: 400, // 恍然梦停靠列宽度（300–640，左缘拖拽调节，appconfig 记忆）
    rightPanelOpen: true, // 正文右侧批注栏开合（面板内收起 / 右缘展开轨恢复，appconfig 记忆）
    sidePanelOpen: true, // 目录栏（章节栏）开合：收起后从左缘细轨恢复，正文获得整幅宽度（appconfig 记忆）
    revisionsCtx: null
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
        if (map.sideWidth) this.sideWidth = Math.min(480, Math.max(180, Number(map.sideWidth) || 252))
        if (map.topbarAutoHide !== undefined) this.topbarAutoHide = map.topbarAutoHide === true
        this.outlineLeftWidth = normalizeOutlineWidth('left', map.outlineLeftWidth)
        this.outlineRightWidth = normalizeOutlineWidth('right', map.outlineRightWidth)
        if (map.outlineDetailOpen !== undefined) this.outlineDetailOpen = !!map.outlineDetailOpen
        if (map.outlineSideOpen !== undefined) this.outlineSideOpen = !!map.outlineSideOpen
        if (map.aiDrawerWidth) this.aiDrawerWidth = Math.min(640, Math.max(300, Number(map.aiDrawerWidth) || 400))
        if (map.rightPanelOpen !== undefined) this.rightPanelOpen = !!map.rightPanelOpen
        if (map.sidePanelOpen !== undefined) this.sidePanelOpen = !!map.sidePanelOpen
      } catch {
        /* 首次启动无配置 */
      }
    },
    /* ---------- 设定三视图（write / detail / map） ----------
       所有切换走这里：统一维护返回栈，并把「视图 + 当前条目 + 导图模式」按作品落 appconfig，
       刷新后恢复（验收：三个视图往返不丢当前条目，刷新恢复视图与选中项）。 */
    setLoreView(view, { id, scroll } = {}) {
      const next = view === 'detail' || view === 'map' ? view : 'write'
      if (next === this.loreView && (id === undefined || id === this.loreActiveId)) return
      if (next !== this.loreView) {
        this.loreReturn = [...this.loreReturn, { view: this.loreView, id: this.loreActiveId, scroll: scroll ?? null }].slice(-20)
      }
      this.loreView = next
      if (id !== undefined) this.loreActiveId = id || null
    },
    setLoreMapMode(mode) {
      this.loreMapMode = mode === 'relations' ? 'relations' : 'hierarchy'
    },
    /** 打开某条目的详情视图（旧 loreDetailId 写点的等价入口） */
    openLoreDetail(id, { scroll } = {}) {
      if (!id) return
      this.setLoreView('detail', { id, scroll })
    },
    /** 关闭详情：回条目编写（旧 loreDetailId = null 的等价入口） */
    closeLoreDetail() {
      if (this.loreView !== 'write') this.setLoreView('write')
    },
    /** 返回上一视图；栈空时回条目编写。返回被弹出的 { view, id, scroll }（外壳据此恢复滚动）。 */
    loreBack() {
      const stack = [...this.loreReturn]
      const prev = stack.pop() || null
      this.loreReturn = stack
      this.loreView = prev && (prev.view === 'detail' || prev.view === 'map') ? prev.view : 'write'
      if (prev && prev.id) this.loreActiveId = prev.id
      return prev
    },
    /** 落记忆（按作品）。由 LoreWorkspace 在视图/条目/模式变化后防抖调用。 */
    async persistLoreState(workId) {
      const id = workId || null
      if (!id) return
      try {
        await db.appconfig.put({
          key: 'lorestate:' + id,
          value: { view: this.loreView, activeId: this.loreActiveId, mapMode: this.loreMapMode }
        })
      } catch { /* 记忆失败不影响当前交互 */ }
    },
    /** 按作品恢复三视图状态（LoreWorkspace 挂载时调；没有记录就是默认 write） */
    async restoreLoreState(workId) {
      const id = workId || null
      if (!id) return
      try {
        const row = await db.appconfig.get('lorestate:' + id)
        const v = row && row.value
        if (!v) return
        if (v.view === 'detail' || v.view === 'map' || v.view === 'write') this.loreView = v.view
        if (v.mapMode === 'relations' || v.mapMode === 'hierarchy') this.loreMapMode = v.mapMode
        this.loreActiveId = v.activeId || null
        this.loreReturn = []
      } catch { /* 恢复失败按默认视图 */ }
    },
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
      await db.appconfig.put({ key, value })
      /* 跨窗口同步：其余窗口重载偏好（主题/字体等即时生效；处理端幂等，自身收到无副作用） */
      broadcastAppEvent('prefs-changed')
    },
    async setWritingPaperStyle(value) {
      return saveWritingPaperPreference(this,value,{
        write:row=>db.appconfig.put(row),
        notify:()=>broadcastAppEvent('prefs-changed')
      })
    }
  }
})
