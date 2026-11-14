import { planLoreMove } from '../services/lore-move.js'
import { lorePath, validLoreMove, createLoreHistory, checkpointLore, stepLoreHistory } from '../services/lore-core.js'
import { initialExpandedContainers } from '../components/outline/outline-layout.js'
import { normalizeCanvasOpacity } from '../services/canvas-appearance.js'
import { relationTransaction, flattenRelations } from '../components/outline/canvas-relations.js'
import { defineStore } from 'pinia'
import { db, uid, now } from '../db/database'
import * as repo from '../db/repo'
import { autosave } from '../services/autosave'
import { countWords, stripTags } from '../services/wordcount'
import { tagColor } from '../services/tagcolors'
import { scanNoteMarks, removeNoteMark, normalizeNoteColor, noteKindOf, DEFAULT_NOTE_COLOR } from '../services/annotations'
import { useUiStore } from './ui'
import { queueProjection } from '../services/project/pipeline.js'
import { useShelfStore } from './shelf'
import { applyProposal, undoApplication } from '../services/ai/application'
import { useAiStore } from './ai'
import { chapterHash, plainChapter } from '../services/ai/contracts'
import { primaryRole } from '../services/character-tags'
import { readWritingPosition } from '../services/writing-position.js'
import { resolveWritingChapter } from '../services/writing-position-core.js'
import { DEFAULT_MUBU_SETS, kindOf } from '../components/lore/lore-kinds.js'
import { joinContent, normalizeLinks, normalizeTags, normalizeTag, splitNote } from '../components/snippets/snippet-model.js'

const urlCache = new Map()

/* 人物关系图相机的最小归一：x/y 取有限数（缺省 0），z 必须为正（缺省 1）；非法输入返回 null。 */
function normalizeCamera(cam) {
  if (!cam || typeof cam !== 'object') return null
  const x = Number(cam.x)
  const y = Number(cam.y)
  const z = Number(cam.z)
  return {
    x: Number.isFinite(x) ? x : 0,
    y: Number.isFinite(y) ? y : 0,
    z: Number.isFinite(z) && z > 0 ? z : 1
  }
}

export const useWorkStore = defineStore('work', {
  state: () => ({
    loaded: false,
    aiApplying: false,
    work: null,
    volumes: [],
    chapters: [],
    outlines: [],
    characters: [],
    relations: [],
    lorecats: [],
    lore: [],
    snippets: [],
    assets: [],
    links: [],
    mubu: [],
    mubuRevision: 0,
    loreHistories: {},
    mubuSetId: null, // 当前设定集（顶层 mubu 节点）id；appconfig mubucoll:<workId> 按作品记忆
    bookmarks: [],
    olnodes: [],
    annotations: [],
    outlineView: __NS_PLUGIN__ ? 'canvas' : 'text', // 插件以编排画布进入，仍可切换文本
    selOlnodeId: null,
    canvasFocusTick: 0, // 侧边栏请求画布居中定位的信号
    canvasPrefs: { snap: true, density: 'detail', edgeStyle: 'bezier', edgeWidth: 1.8, arrowSize: 1, showDots: true }, // 画布偏好（appconfig 按作品隔离）
    wordGoal: 0, // 每章字数目标（0 = 未设；appconfig wordgoal:<workId> 按作品隔离）
    mubuTagMeta: {}, // 设定标签创建时间 { [name]: createdAt }（appconfig mubutagmeta:<workId>；标签面板选择栏排序依据）
    lorelinks: [], // 条目级关联关系（关系链接）：设定↔设定 / 设定↔人物（Dexie v12 lorelinks 表，随作品全量载入）
    loreGraph: {}, // 关联关系图谱布局 { '<kind:id>'(中心): { '<kind:id>'(邻居): { x, y } } }（appconfig loreGraph:<workId>）
    olTypes: [], // 自定义模块类型（8.8.2-G2）：[{ name, color }]，节点以 mtype 引用
    olUndo: [],
    olRedo: [],
    olUndoAt: 0,
    charView: 'list', // 人物视图：list 列表 | graph 关系图
    charFocusId: null, // 关系图定位的人物 id
    charFocusTick: 0,
    charFocusHandled: 0, // 关系图已处理的定位信号（组件未挂载时请求不丢）
    tab: 'chapters', // chapters | outline | characters | lore | snippets
    selChapterId: null,
    writingRestore: null,
    selCharacterId: null,
    selSnippetId: null,
    selOutlineId: null,
    selVolumeId: null,
    urlTick: 0
  }),

  getters: {
    liveVolumes: (s) => s.volumes.filter((v) => !v.deletedAt).sort((a, b) => a.sortOrder - b.sortOrder),
    liveChapters: (s) => s.chapters.filter((c) => !c.deletedAt).sort((a, b) => a.sortOrder - b.sortOrder),
    liveBookmarks: (s) =>
      s.bookmarks
        .filter((b) => !b.deletedAt)
        .map((b) => ({ ...b, title: s.chapters.find((c) => c.id === b.targetId && !c.deletedAt)?.title || '' }))
        .filter((b) => b.title),
    liveCharacters: (s) => s.characters.filter((c) => !c.deletedAt).sort((a, b) => (a.name || '').localeCompare(b.name || '')),
    liveSnippets: (s) => s.snippets.filter((x) => !x.deletedAt).sort((a, b) => b.createdAt - a.createdAt),
    liveAnnotations: (s) => s.annotations.filter((a) => !a.deletedAt).sort((a, b) => a.createdAt - b.createdAt),
    activeChapter() {
      return this.liveChapters.find((c) => c.id === this.selChapterId) || null
    },
    activeCharacter: (s) => s.characters.find((c) => c.id === s.selCharacterId && !c.deletedAt) || null,
    activeSnippet: (s) => s.snippets.find((x) => x.id === s.selSnippetId && !x.deletedAt) || null,
    chapterCount() {
      return this.liveChapters.length
    },
    /** 断线检测（8.8.2-G3）：仅统计事件节点间连线——无出边=烂尾情节，无入边=缺铺垫 */
    olBroken() {
      const evs = this.liveOlnodes().filter((n) => n.kind === 'event')
      if (evs.length < 2) return { tails: [], missing: [] }
      const hasIn = new Set()
      const hasOut = new Set()
      for (const n of evs) {
        for (const rel of this.olnodeRelsOf(n.id)) {
          if (evs.some((e) => e.id === rel.toId)) {
            hasOut.add(n.id)
            hasIn.add(rel.toId)
          }
        }
      }
      return {
        tails: evs.filter((n) => !hasOut.has(n.id)),
        missing: evs.filter((n) => !hasIn.has(n.id))
      }
    },
    totalWords() {
      return this.liveChapters.reduce((sum, c) => sum + (c.wordCount || 0), 0)
    },
    /** 当前章字数目标进度（正文字数目标底栏）：goal=0 未设目标；percent 不钳制，done 用于达标样式 */
    goalProgress() {
      const goal = this.wordGoal || 0
      const current = this.activeChapter?.wordCount || 0
      return {
        current,
        goal,
        percent: goal > 0 ? (current / goal) * 100 : 0,
        done: goal > 0 && current >= goal
      }
    },
    /** 设定标签池（由节点派生）：[{ name, color, count, createdAt }]，同名恒同色；
     *  按创建时间升序（历史标签无记录视为最早），某标签从所有节点移除后自动消失 */
    mubuTags() {
      const map = new Map()
      for (const n of this.liveMubu()) {
        for (const t of n.tags || []) {
          if (!t) continue
          const hit = map.get(t)
          if (hit) hit.count++
          else map.set(t, { name: t, color: tagColor(t), count: 1, createdAt: this.mubuTagMeta[t] || 0 })
        }
      }
      return [...map.values()].sort((a, b) => a.createdAt - b.createdAt || a.name.localeCompare(b.name))
    },
    /** 关联关系（关系链接）可见边：两端条目仍存活（软删端点随回收站隐藏，还原即恢复） */
    liveLoreLinks: (s) => {
      const mb = new Set(s.mubu.filter((n) => !n.deletedAt).map((n) => n.id))
      const ch = new Set(s.characters.filter((c) => !c.deletedAt).map((c) => c.id))
      const alive = (kind, id) => (kind === 'mubu' ? mb.has(id) : kind === 'character' ? ch.has(id) : false)
      return s.lorelinks
        .filter((l) => alive(l.fromKind, l.fromId) && alive(l.toKind, l.toId))
        .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
    },
    /** 行尾关系卡片摘要：'kind:id' → { count, label, color }（label 取该侧首个关系的展示口径：
     *  出向用本体类型名，入向用反向名；color 空 = 调用侧按类型 hash 取色） */
    loreLinkSummary() {
      const m = new Map()
      const bump = (key, label, color) => {
        const hit = m.get(key)
        if (hit) hit.count++
        else m.set(key, { count: 1, label, color })
      }
      for (const l of this.liveLoreLinks) {
        bump(l.fromKind + ':' + l.fromId, l.label || '关联', l.color || '')
        bump(l.toKind + ':' + l.toId, l.reverseLabel || l.label || '关联', l.color || '')
      }
      return m
    },
    treeData() {
      const chapterNode = (c) => ({
        key: 'c:' + c.id,
        label: c.title,
        suffix: (c.wordCount || 0) > 0 ? `${c.wordCount}字` : '',
        type: 'chapter',
        isLeaf: true
      })
      const nodes = this.liveVolumes.map((v) => ({
        key: 'v:' + v.id,
        label: v.title,
        type: 'volume',
        isLeaf: false,
        children: this.liveChapters.filter((c) => c.volumeId === v.id).map(chapterNode)
      }))
      const attached = new Set(this.liveVolumes.map((v) => v.id))
      const orphans = this.liveChapters.filter((c) => !attached.has(c.volumeId))
      if (orphans.length) {
        nodes.push({ key: 'v:orphans', label: '未分卷', type: 'volume', isLeaf: false, children: orphans.map(chapterNode) })
      }
      return nodes
    },
    /** 某章在全书的序号（依 treeData 平坦序：卷序 + 卷内序 + 未分卷；找不到返回 null 供阅读模式巨排章号用） */
    chapterOrdinal() {
      return (id) => {
        let n = 0
        for (const v of this.treeData) for (const c of v.children || []) { n++; if (c.key === 'c:' + id) return n }
        return null
      }
    }
  },

  actions: {
    /* ---------- 打开 / 关闭 ---------- */
    async open(workId, { chapterId = null, restorePosition = true } = {}) {
      await autosave.flushAll()
      useAiStore().switchWork(workId)
      const b = await repo.loadWorkBundle(workId)
      this.work = b.work
      this.volumes = b.volumes
      this.chapters = b.chapters
      this.outlines = b.outlines
      this.characters = b.characters
      this.relations = b.relations
      this.lorelinks = b.lorelinks
      this.lorecats = b.lorecats
      this.lore = b.lore
      this.snippets = b.snippets
      this.assets = b.assets
      this.links = b.links
      await this.migrateMubu(workId)
      this.mubu = await db.mubu.where('workId').equals(workId).toArray()
      this.bookmarks = await db.bookmarks.where('workId').equals(workId).toArray()
      this.annotations = await db.annotations.where('workId').equals(workId).toArray()
      await this.migrateOlnodes(workId)
      this.olnodes = await db.olnodes.where('workId').equals(workId).toArray()
      this.olUndo = []; this.olRedo = []; this.olUndoAt = 0
      await this.loadCanvasPrefs()
      await this.loadOlTypes()
      await this.loadWordGoal()
      await this.loadMubuTagMeta()
      await this.loadMubuSet()
      this.ensureMubuSet()
      this.tab = 'chapters'
      const position = restorePosition && !chapterId ? await readWritingPosition(workId) : null
      const selected = resolveWritingChapter(this, position, chapterId)
      this.selChapterId = selected?.id || null
      this.selVolumeId = selected?.volumeId || this.liveVolumes[0]?.id || null
      this.writingRestore = selected?.id === position?.chapterId ? position : null
      this.loaded = true
      await useShelfStore().recordOpen(workId)
      queueProjection(workId).catch(console.error)
      const ui = useUiStore()
      ui.view = 'work'
      ui.focusMode = false
      ui.readMode = false
    },

    async closeWork() {
      useAiStore().switchWork(null)
      await autosave.flushAll()
      const histories = this.loreHistories
      this.$reset()
      this.loreHistories = histories
      useUiStore().view = 'shelf'
      await useShelfStore().refresh()
    },

    /* ---------- 章节 / 卷 ---------- */
    async addVolume(title = '新卷') {
      const maxSort = this.liveVolumes.reduce((m, v) => Math.max(m, v.sortOrder), -1000)
      const vol = { id: uid(), workId: this.work.id, title, sortOrder: maxSort + 1000, createdAt: now(), updatedAt: now(), deletedAt: null }
      this.volumes.push(vol)
      autosave.mark('volumes', vol)
      const o = { id: uid(), workId: this.work.id, level: 'volume', refId: vol.id, content: '', createdAt: now(), updatedAt: now(), deletedAt: null }
      this.outlines.push(o)
      autosave.mark('outlines', o)
      this.selVolumeId = vol.id
      return vol
    },

    renameVolume(id, title) {
      const v = this.volumes.find((x) => x.id === id)
      if (!v) return
      v.title = title
      autosave.mark('volumes', v)
    },

    async deleteVolume(id) {
      const v = this.volumes.find((x) => x.id === id)
      if (!v) return
      for (const c of this.liveChapters.filter((c) => c.volumeId === id)) {
        await this.deleteChapter(c.id)
      }
      await repo.softDeleteRow('volumes', v)
      // 大纲节点树：同步移除对应卷节点（8.8）
      const vnode = this.olnodeByRef(id)
      if (vnode) this.olnodeRemove(vnode.id)
      if (this.selVolumeId === id) this.selVolumeId = null
    },

    async addChapter(volumeId, title = '新章节', { keepTab = false } = {}) {
      let vid = volumeId
      if (!vid) vid = this.selVolumeId || this.liveVolumes[0]?.id
      if (!vid) vid = (await this.addVolume('第一卷')).id
      if (vid === 'orphans') vid = null
      const siblings = this.liveChapters.filter((c) => c.volumeId === vid)
      const maxSort = siblings.reduce((m, c) => Math.max(m, c.sortOrder), -1000)
      const ch = {
        id: uid(),
        workId: this.work.id,
        volumeId: vid,
        title,
        content: '',
        wordCount: 0,
        status: 'draft',
        sortOrder: maxSort + 1000,
        createdAt: now(),
        updatedAt: now(),
        deletedAt: null
      }
      this.chapters.push(ch)
      autosave.mark('chapters', ch)
      const o = { id: uid(), workId: this.work.id, level: 'chapter', refId: ch.id, content: '', createdAt: now(), updatedAt: now(), deletedAt: null }
      this.outlines.push(o)
      autosave.mark('outlines', o)
      if (!keepTab) this.tab = 'chapters'
      this.selChapterId = ch.id
      this.selVolumeId = vid
      return ch
    },

    renameChapter(id, title) {
      const c = this.chapters.find((x) => x.id === id)
      if (!c) return
      c.title = title
      autosave.mark('chapters', c)
    },

    setChapterStatus(id, status) {
      const c = this.chapters.find((x) => x.id === id)
      if (!c) return
      c.status = status
      autosave.mark('chapters', c)
    },

    setChapterContent(id, content, fmt) {
      const c = this.chapters.find((x) => x.id === id)
      if (!c) return
      c.content = content
      if (fmt) c.fmt = fmt
      c.wordCount = countWords(c.fmt === 'html' ? stripTags(content) : content)
      autosave.mark('chapters', c)
    },

    moveChapter(id, dir) {
      const c = this.chapters.find((x) => x.id === id)
      if (!c) return
      const sibs = this.liveChapters.filter((x) => x.volumeId === c.volumeId)
      const idx = sibs.findIndex((x) => x.id === id)
      const swapIdx = idx + dir
      if (swapIdx < 0 || swapIdx >= sibs.length) return
      const other = sibs[swapIdx]
      const tmp = c.sortOrder
      c.sortOrder = other.sortOrder
      other.sortOrder = tmp
      autosave.mark('chapters', c)
      autosave.mark('chapters', other)
    },

    async moveChapterTo(id, targetVolumeId, mode, refChapterId = null) {
      const live = this.liveChapters
      const chapter = live.find((row) => row.id === id)
      if (!chapter || !['inside', 'before', 'after'].includes(mode)) return false
      const volumes = new Set(this.liveVolumes.map((volume) => volume.id))
      const groupOf = (volumeId) => volumes.has(volumeId) ? volumeId : null
      const source = groupOf(chapter.volumeId)
      const destination = groupOf(targetVolumeId)
      const original = live.filter((row) => groupOf(row.volumeId) === destination)
      const ordered = original.filter((row) => row.id !== id)
      let index = ordered.length
      if (mode === 'inside') {
        if (targetVolumeId != null && targetVolumeId !== 'orphans' && !volumes.has(targetVolumeId)) return false
      } else {
        const anchor = ordered.findIndex((row) => row.id === refChapterId)
        if (anchor < 0) return false
        index = anchor + Number(mode === 'after')
      }
      ordered.splice(index, 0, chapter)
      if (source === destination && ordered.every((row, i) => row === original[i])) return false

      if (source !== destination) {
        chapter.volumeId = destination
        if (this.selChapterId === id) this.selVolumeId = destination
      }
      const saveOrder = (rows) => rows.forEach((row, i) => {
        const sortOrder = i * 1000
        const movedVolume = row === chapter && source !== destination
        if (row.sortOrder === sortOrder && !movedVolume) return
        row.sortOrder = sortOrder
        autosave.mark('chapters', row)
      })
      saveOrder(ordered)
      if (source !== destination) {
        saveOrder(live.filter((row) => row.id !== id && groupOf(row.volumeId) === source))
      }
      return true
    },

    async deleteChapter(id) {
      const c = this.chapters.find((x) => x.id === id)
      if (!c) return
      await repo.softDeleteRow('chapters', c)
      // 大纲节点树：同步移除对应章节点（8.8）
      const node = this.olnodeByRef(id)
      if (node) this.olnodeRemove(node.id)
      if (this.selChapterId === id) {
        const rest = this.liveChapters
        const idx = rest.findIndex((x) => x.id === id)
        const next = rest[Math.max(0, idx - 1)] || rest[0] || null
        this.selChapterId = next ? next.id : null
      }
    },

    /* ---------- 人物 ---------- */
    /** 新建人物：内容全部留空待用户填写（name 空时列表/画布显示「未命名」兜底） */
    addCharacter(name = '') {
      const row = {
        id: uid(),
        workId: this.work.id,
        name,
        aliases: '',
        role: '配角',
        tags: [],
        fields: {},
        avatarAssetId: null,
        content: '',
        createdAt: now(),
        updatedAt: now(),
        deletedAt: null
      }
      this.characters.push(row)
      autosave.mark('characters', row)
      this.tab = 'characters'
      this.selCharacterId = row.id
      return row
    },

    /* 人物视图切换：值域固定 'list' | 'graph'（services/doublelinks.js:255 依赖它）。
       人物外壳与 D2/D3/D4 一律走这里，避免写入非法值把关系剧场视图锁死。 */
    setCharView(next) {
      this.charView = next === 'graph' ? 'graph' : 'list'
    },

    updateCharacter(id, patch) {
      const c = this.characters.find((x) => x.id === id)
      if (!c) return
      Object.assign(c, patch)
      autosave.mark('characters', c)
    },

    async deleteCharacter(id) {
      const c = this.characters.find((x) => x.id === id)
      if (!c) return
      await repo.softDeleteRow('characters', c)
      const rels = this.relations.filter((r) => r.fromId === id || r.toId === id)
      for (const r of rels) {
        await db.relations.delete(r.id)
        this.relations = this.relations.filter((x) => x.id !== r.id)
      }
      // 关系图布局清理（8.8.3）
      const layout = await this.loadCharGraph()
      if (layout && layout[id] !== undefined) {
        delete layout[id]
        await this.saveCharGraph(layout)
      }
      if (this.selCharacterId === id) this.selCharacterId = null
    },

    /** 新建人物关系：label 关系名；color 线色（空=主题色）；style 线型 dashed/dotted/'' 实线 */
    addRelation(fromId, toId, label, extra = {}) {
      const row = { id: uid(), workId: this.work.id, fromId, toId, label, color: '', style: '', ...extra }
      this.relations.push(row)
      autosave.mark('relations', row)
    },

    updateRelation(id, patch) {
      const r = this.relations.find((x) => x.id === id)
      if (!r) return
      Object.assign(r, patch)
      autosave.mark('relations', r)
    },

    async removeRelation(id) {
      await db.relations.delete(id)
      this.relations = this.relations.filter((r) => r.id !== id)
    },

    /* ---------- 灵感（设计稿：docs/前端美化/灵感-融合总稿-20261107/） ---------- */
    /** 新增一条；content 首行为标题。tags / links 由调用方归一后传入（snippet-model.js）。 */
    addSnippet(content = '', opts = {}) {
      const row = {
        id: uid(),
        workId: this.work.id,
        content,
        tags: normalizeTags(opts.tags),
        links: normalizeLinks(opts.links),
        createdAt: now(),
        updatedAt: now(),
        deletedAt: null
      }
      this.snippets.push(row)
      autosave.mark('snippets', row)
      this.tab = 'snippets'
      this.selSnippetId = row.id
      return row
    },

    updateSnippet(id, patch) {
      const s = this.snippets.find((x) => x.id === id)
      if (!s) return
      Object.assign(s, patch)
      autosave.mark('snippets', s)
    },

    /** 加标签：去重、归一；返回归一后的标签（空串表示不合法，调用方给提示）。 */
    tagSnippet(id, value) {
      const s = this.snippets.find((x) => x.id === id)
      if (!s) return ''
      const tag = normalizeTag(value)
      if (!tag) return ''
      const tags = normalizeTags([...(s.tags || []), tag])
      if (tags.length === (s.tags || []).length) return tag
      s.tags = tags
      autosave.mark('snippets', s)
      return tag
    },

    untagSnippet(id, tag) {
      const s = this.snippets.find((x) => x.id === id)
      if (!s) return
      s.tags = (s.tags || []).filter((t) => t !== tag)
      autosave.mark('snippets', s)
    },

    /** 关联目标：只存 kind:id（目标改名后关联仍在，渲染时实时解析标题）。 */
    linkSnippet(id, kind, targetId) {
      const s = this.snippets.find((x) => x.id === id)
      if (!s || !targetId) return false
      const links = normalizeLinks([...(s.links || []), { kind, id: targetId }])
      if (links.length === (s.links || []).length) return false
      s.links = links
      autosave.mark('snippets', s)
      return true
    },

    unlinkSnippet(id, key) {
      const s = this.snippets.find((x) => x.id === id)
      if (!s) return
      s.links = (s.links || []).filter((l) => l.kind + ':' + l.id !== key)
      autosave.mark('snippets', s)
    },

    async deleteSnippet(id) {
      const s = this.snippets.find((x) => x.id === id)
      if (!s) return
      await repo.softDeleteRow('snippets', s)
      if (this.selSnippetId === id) this.selSnippetId = null
    },

    /** 回收站还原：沿用 restoreItem 的软删语义（同 id 回来，关联与标签不变）。 */
    async restoreSnippet(id) {
      const s = this.snippets.find((x) => x.id === id)
      if (!s) return
      await repo.restoreRow('snippets', s)
    },

    /**
     * 转为章节：保留原灵感（设计稿「转换后保留原灵感」），新建章节并把新章节 id 记进灵感关联。
     * keepTab 让调用方停在灵感页——设计稿是在灵感页开结果预览，不是跳去正文。
     */
    async snippetToChapter(id, volumeId = null) {
      const s = this.snippets.find((x) => x.id === id)
      if (!s) return null
      const { title, body } = splitNote(s)
      /* keepTab：转换是在灵感页开结果预览，不能把用户甩到正文去（设计稿口径） */
      const ch = await this.addChapter(volumeId === 'orphans' ? 'orphans' : volumeId, (title || '灵感章节').slice(0, 30), { keepTab: true })
      this.setChapterContent(ch.id, joinContent(title, body), 'text')
      this.linkSnippet(id, 'chapter', ch.id)
      return ch
    },

    /** 转为设定：在选定设定集（parentId 为空则当前集/新集）里建同名节点，正文写进子节点。 */
    snippetToMubu(id, parentId = null) {
      const s = this.snippets.find((x) => x.id === id)
      if (!s) return null
      const { title, body } = splitNote(s)
      const root = parentId ? null : this.currentMubuRoot() || this.createMubuSet()
      const node = this.mubuAdd(parentId || root.id, null, (title || '新设定').slice(0, 30), null)
      if (!node) return null
      if (body.trim()) this.mubuAdd(node.id, null, body.trim(), null)
      this.linkSnippet(id, 'mubu', node.id)
      return node
    },

    /* ---------- 资产（图片等） ---------- */
    async addAssetBlob(blob, name = 'image') {
      const meta = await repo.addAssetRow(this.work.id, name, blob.type || 'application/octet-stream', blob)
      this.assets.push(meta)
      return meta
    },

    assetUrl(id) {
      return urlCache.get(id) || ''
    },

    async warmUrls(ids) {
      let changed = false
      for (const id of ids) {
        if (!id || urlCache.has(id)) continue
        const blob = await repo.getAssetBlob(id)
        if (blob) {
          urlCache.set(id, URL.createObjectURL(blob))
          changed = true
        }
      }
      if (changed) this.urlTick++
    },

    async linkAsset(entityType, entityId, assetId) {
      const row = await repo.addLink(entityType, entityId, assetId)
      this.links.push(row)
      return row
    },

    async unlinkAsset(linkId) {
      await repo.removeLink(linkId)
      this.links = this.links.filter((l) => l.id !== linkId)
    },

    linksFor(entityType, entityId) {
      return this.links.filter((l) => l.entityType === entityType && l.entityId === entityId)
    },

    /* ---------- 回收站 ---------- */
    recycleItems() {
      return {
        chapters: this.chapters.filter((c) => c.deletedAt),
        characters: this.characters.filter((c) => c.deletedAt),
        lore: [],
        mubu: this.mubu.filter((n) => n.deletedAt),
        snippets: this.snippets.filter((s) => s.deletedAt)
      }
    },

    async restoreItem(table, row) {
      await repo.restoreRow(table, row)
    },

    async purgeItem(table, row) {
      await repo.purgeRow(table, row)
      this[table] = this[table].filter((x) => x.id !== row.id)
      if (table === 'chapters') await this.purgeAnnotationsForChapter(row.id)
      /* 条目彻底删除 → 连带清理其关联关系（软删走回收站语义，关系保留待还原） */
      if (table === 'mubu' || table === 'characters') await this.purgeLoreLinksFor(table, [row.id])
    },

    /* ---------- 幕布节点体系（设定库） ---------- */

    /**
     * 旧「分类/条目」数据一次性迁移为幕布节点：分类→节点（保留嵌套），
     * 条目标题→节点，其大纲/正文→子节点。迁移后删除旧行。
     */
    async migrateMubu(workId) {
      const flagKey = 'mubu-mig:' + workId
      const flag = await db.appconfig.get(flagKey)
      if (flag) return
      const cats = (await db.lorecats.where('workId').equals(workId).toArray())
        .filter((c) => !c.deletedAt)
        .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))
      const lores = (await db.lore.where('workId').equals(workId).toArray()).filter((l) => !l.deletedAt)
      if (cats.length || lores.length) {
        const catMap = new Map()
        let order = 0
        for (const c of cats) {
          const id = uid()
          catMap.set(c.id, id)
          await db.mubu.add({
            id, workId, parentId: c.parentId ? catMap.get(c.parentId) || null : null,
            sortOrder: order++ * 1000, text: c.name || '未命名分类', html: null, fold: false,
            deletedAt: null, createdAt: now(), updatedAt: now()
          })
        }
        const fromTextLines = (text) =>
          String(text || '').split('\n').filter((x) => x.trim()).map((x) => ({ text: x.trim() }))
        for (const l of lores) {
          const id = uid()
          const pid = l.categoryId ? catMap.get(l.categoryId) || null : null
          await db.mubu.add({
            id, workId, parentId: pid, sortOrder: order++ * 1000,
            text: l.title || '未命名条目', html: null, fold: false,
            deletedAt: null, createdAt: now(), updatedAt: now()
          })
          let outline = []
          if (l.fmt === 'outline') {
            try { outline = JSON.parse(l.content || '[]') } catch { outline = [] }
          } else if ((l.content || '').trim()) {
            outline = fromTextLines(l.content).map((x) => ({ ...x, children: [] }))
          }
          let childOrder = 0
          const walkAdd = async (list, parent) => {
            for (const n of list) {
              const cid = uid()
              await db.mubu.add({
                id: cid, workId, parentId: parent, sortOrder: childOrder++ * 1000,
                text: n.text || '', html: n.html || null, fold: !!n.fold,
                deletedAt: null, createdAt: now(), updatedAt: now()
              })
              await walkAdd(n.children || [], cid)
            }
          }
          await walkAdd(outline, id)
        }
        await db.lore.where('workId').equals(workId).delete()
        await db.lorecats.where('workId').equals(workId).delete()
      }
      await db.appconfig.put({ key: flagKey, value: 1 })
    },

    mubuPath(id) { return lorePath(this.mubu, id) },
    mubuHistory() {
      const id = this.work?.id || ''
      return this.loreHistories[id] || (this.loreHistories[id] = createLoreHistory())
    },
    mubuCheckpoint(group = null) {
      const ui = useUiStore()
      checkpointLore(this.mubuHistory(), this.mubu, { group, selection: { selectedId: ui.mubuSelectedId, location: ui.loreWorkId === this.work?.id ? ui.captureLoreLocation() : null } })
    },
    async mubuUndo(direction = 'undo') {
      const ui = useUiStore(), state = stepLoreHistory(this.mubuHistory(), this.mubu, direction, { selectedId: ui.mubuSelectedId, location: ui.captureLoreLocation() })
      if (!state) return false
      await this.mubuSyncTree(state.nodes)
      if (state.selection?.location) ui.applyLoreLocation(state.selection.location)
      const selectedId = typeof state.selection === 'string' ? state.selection : state.selection?.selectedId
      if (selectedId && this.mubu.some(n => n.id === selectedId && !n.deletedAt)) ui.mubuSelectedId = selectedId
      return true
    },
    mubuSetHeading(id, level) {
      const n = this.mubu.find(n => n.id === id && !n.deletedAt && n.workId === this.work?.id)
      if (!n) return
      this.mubuCheckpoint(); n.heading = Math.max(0, Math.min(3, Number(level) || 0))
      autosave.mark('mubu', n); this.mubuRevision++
    },
    liveMubu() {
      return this.mubu
        .filter((n) => !n.deletedAt)
        .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))
    },

    mubuChildren(parentId) {
      return this.liveMubu().filter((n) => (n.parentId || null) === (parentId || null))
    },

    /* ---------- 设定集：每个顶层节点即一个设定集，条目都在集内 ---------- */
    mubuRoots() {
      return this.mubuChildren(null)
    },
    /** 节点所属设定集根（沿 parentId 上溯；节点不存在返回 null） */
    mubuRootOf(id) {
      let cur = this.mubu.find((n) => n.id === id && !n.deletedAt) || null
      let guard = 0
      while (cur?.parentId && guard++ < 100) {
        cur = this.mubu.find((n) => n.id === cur.parentId && !n.deletedAt) || null
      }
      return cur && !cur.parentId ? cur : null
    },
    currentMubuRoot() {
      const live = this.liveMubu()
      return live.find((n) => n.id === this.mubuSetId && !n.parentId) || live.find((n) => !n.parentId) || null
    },
    async loadMubuSet() {
      try {
        const row = await db.appconfig.get('mubucoll:' + this.work?.id)
        this.mubuSetId = row?.value || null
      } catch {
        this.mubuSetId = null
      }
    },
    async saveMubuSet() {
      if (!this.work) return
      await db.appconfig.put({ key: 'mubucoll:' + this.work.id, value: this.mubuSetId || null })
    },
    setMubuSet(id) {
      const next = id || null
      if (next === this.mubuSetId) return
      this.mubuSetId = next
      void this.saveMubuSet()
    },
    /** 当前集失效（被删 / 换作品）时切到第一个设定集 */
    ensureMubuSet() {
      const live = this.liveMubu()
      if (this.mubuSetId && live.some((n) => n.id === this.mubuSetId && !n.parentId)) return
      const next = live.find((n) => !n.parentId)?.id || null
      if (next !== this.mubuSetId) {
        this.mubuSetId = next
        void this.saveMubuSet()
      }
    },
    /** 新建设定集并切换过去 */
    createMubuSet(text = '新节点') {
      const row = this.mubuAdd(null, null, text)
      this.setMubuSet(row.id)
      return row
    },
    /**
     * 补齐默认设定集（地理/组织/规则/历史/物件/民俗）。
     * onlyMissing=false：仅当顶层设定集为 0 时建齐六个并选中第一个；
     * onlyMissing=true：只补缺项，追加在已有集之后，不改动/重排/删除已有集。
     * 「已存在」判定按顶层集的名字或 kind：老作品的旧分类（地点/势力/物品/体系/大事记）
     * 没有 kind，靠 kindOf 的名称启发式判出同一类型，因此不会再补一个同义的新集。
     * 返回 { created: [id], skipped: [text] }
     */
    async ensureDefaultMubuSets({ onlyMissing = false } = {}) {
      const created = []
      const skipped = []
      if (!this.work) return { created, skipped }
      const roots = this.mubuRoots()
      if (!onlyMissing && roots.length > 0) return { created, skipped }
      const names = new Set(roots.map((n) => (n.text || '').trim()))
      const kinds = new Set(roots.map((n) => kindOf(n).kind))
      let firstId = null
      for (const set of DEFAULT_MUBU_SETS) {
        const text = set.text || ''
        if (names.has(text.trim()) || kinds.has(set.kind)) {
          skipped.push(text)
          continue
        }
        const row = this.mubuAdd(null, null, text, null, set.kind || null)
        names.add(text.trim())
        if (set.kind) kinds.add(set.kind)
        created.push(row.id)
        if (!firstId) firstId = row.id
      }
      if (!onlyMissing && firstId) this.setMubuSet(firstId)
      return { created, skipped }
    },

    /** 在当前设定集内新建一条设定（无设定集时自动先建一个） */
    mubuAddInCurrentSet(text = '', html = null) {
      const root = this.currentMubuRoot() || this.createMubuSet()
      return this.mubuAdd(root.id, null, text, html)
    },

    mubuAdd(parentId, afterId = null, text = '', html = null, kind = null) {
      if (!this.work || (parentId && !this.mubu.some(n => n.id === parentId && !n.deletedAt && n.workId === this.work.id))) return null
      const siblings = this.mubuChildren(parentId)
      const row = {
        id: uid(), workId: this.work.id, parentId: parentId || null,
        sortOrder: 0, text, html, fold: false, deletedAt: null,
        createdAt: now(), updatedAt: now(), heading: 0
      }
      if (kind) row.kind = kind
      if (afterId) {
        const i = siblings.findIndex((s) => s.id === afterId)
        row.sortOrder = i >= 0 ? siblings[i].sortOrder + 500 : siblings.length * 1000
        this.mubu.push(row)
        this.mubuNormalize(parentId)
      } else {
        row.sortOrder = siblings.reduce((m, s) => Math.max(m, s.sortOrder || 0), -1000) + 1000
        this.mubu.push(row)
      }
      autosave.mark('mubu', row)
      return row
    },

    mubuAddTree(parentId, afterId, treeNodes) {
      // 幕布顺序（DFS）扁平插入：lastAt[d] 记录最近创建的深度 d 节点，作为下一层（d+1）的挂载父
      const flat = []
      const walk = (list, depth) => {
        for (const n of list) {
          flat.push({ depth, node: n })
          walk(n.children || [], depth + 1)
        }
      }
      walk(treeNodes || [], 0)
      const lastAt = []
      let prevId = afterId
      let prevDepth = 0
      const created = []
      for (const item of flat) {
        lastAt.length = item.depth // 回到浅层时丢弃更深层记录，防旧层级残留误挂
        const parent = item.depth === 0 ? parentId || null : lastAt[item.depth - 1]
        const sameParent = prevDepth === item.depth
        const data = JSON.parse(JSON.stringify(item.node))
        const r = this.mubuAdd(parent, sameParent ? prevId : null, data.text || '', data.html || null)
        if (!r) continue
        for (const key of ['id', 'workId', 'parentId', 'sortOrder', 'children', 'createdAt', 'updatedAt', 'deletedAt']) delete data[key]
        Object.assign(r, data)
        autosave.mark('mubu', r)
        lastAt[item.depth] = r.id
        created.push(r)
        prevId = r.id
        prevDepth = item.depth
      }
      return created[0]
    },

    mubuNormalize(parentId) {
      const siblings = this.mubuChildren(parentId)
      siblings.forEach((s, i) => {
        if (s.sortOrder !== i * 1000) {
          s.sortOrder = i * 1000
          autosave.mark('mubu', s)
        }
      })
    },

    mubuSetText(id, text, html = undefined) {
      const n = this.mubu.find((x) => x.id === id)
      if (!n) return
      n.text = text
      if (html !== undefined) n.html = html
      this.mubuRevision++
      autosave.mark('mubu', n)
    },

    /** 设置节点标签（即时落库）：清洗 trim / 去空 / 去重 / 单个 ≤20 字 / 每节点 ≤12 个 */
    mubuSetTags(id, tags) {
      const n = this.mubu.find((x) => x.id === id)
      if (!n) return
      this.mubuCheckpoint()
      n.tags = [...new Set(
        (Array.isArray(tags) ? tags : [])
          .map((t) => String(t ?? '').trim().slice(0, 20))
          .filter(Boolean)
      )].slice(0, 12)
      autosave.mark('mubu', n)
    },

    mubuToggleFold(id) {
      const n = this.mubu.find((x) => x.id === id)
      if (!n) return
      n.fold = !n.fold
      autosave.mark('mubu', n)
    },

    mubuFoldAll(v) {
      for (const n of this.liveMubu()) {
        if (!this.mubuChildren(n.id).length) continue
        if (n.fold !== v) {
          n.fold = v
          autosave.mark('mubu', n)
        }
      }
    },

    mubuDescendants(id) {
      const out = []
      const walk = (pid) => this.mubuChildren(pid).forEach((n) => (out.push(n), walk(n.id)))
      walk(id)
      return out
    },

    mubuDrop(id, targetId, mode, checkpoint = () => this.mubuCheckpoint(), placement) {
      const nodes = this.liveMubu()
      const changes = planLoreMove(nodes, id, targetId, mode, placement)
      if (!changes.length) return false
      const byId = new Map(nodes.map(node => [node.id, node]))
      checkpoint()
      for (const { id, parentId, sortOrder } of changes) {
        const node = byId.get(id)
        Object.assign(node, { parentId, sortOrder })
        autosave.mark('mubu', node)
      }
      this.mubuRevision++
      return true
    },

    mubuMove(id, targetId, zone) {
      if (!validLoreMove(this.mubu, id, targetId, this.work?.id)) return
      const n = this.mubu.find((x) => x.id === id)
      const t = this.mubu.find((x) => x.id === targetId)
      if (!n || !t) return
      if (zone === 'inside') {
        const oldParent = n.parentId
        n.parentId = t.id
        autosave.mark('mubu', n)
        this.mubuNormalize(t.id)
        if (oldParent !== (t.id)) this.mubuNormalize(oldParent)
      } else {
        const targetParent = t.parentId || null
        const wasParent = n.parentId
        n.parentId = targetParent
        if (wasParent !== targetParent) autosave.mark('mubu', n)
        /* 同层排序也须先把被移动节点剔除再插回——否则数组出现重复项，末次赋值让排序错乱
         * （v1.0.22 修复；对照 olnodeMoveTo 的同名处理） */
        const siblings = this.mubuChildren(targetParent).filter((s) => s.id !== id)
        const ti = siblings.findIndex((s) => s.id === targetId)
        siblings.splice(ti + (zone === 'after' ? 1 : 0), 0, n)
        siblings.forEach((s, i) => {
          if (s.sortOrder !== i * 1000) {
            s.sortOrder = i * 1000
            autosave.mark('mubu', s)
          }
        })
        if (wasParent !== targetParent) this.mubuNormalize(wasParent)
      }
    },

    mubuMoveOrder(id, dir) {
      const n = this.mubu.find((x) => x.id === id)
      if (!n) return
      const siblings = this.mubuChildren(n.parentId)
      const i = siblings.findIndex((s) => s.id === id)
      const j = i + dir
      if (j < 0 || j >= siblings.length) return
      const tmp = siblings[i].sortOrder
      siblings[i].sortOrder = siblings[j].sortOrder
      siblings[j].sortOrder = tmp
      autosave.mark('mubu', siblings[i])
      autosave.mark('mubu', siblings[j])
    },

    mubuRemove(id) {
      const all = [this.mubu.find((x) => x.id === id), ...this.mubuDescendants(id)].filter(Boolean)
      const t = now()
      for (const n of all) {
        n.deletedAt = t
        autosave.mark('mubu', n)
      }
      this.ensureMubuSet()
    },

    mubuRestore(id) {
      const root = this.mubu.find(x => x.id === id && x.workId === this.work?.id)
      if (!root?.deletedAt) return
      const byParent = new Map(), seen = new Set(), queue = [root]
      for (const n of this.mubu) if (n.workId === root.workId && n.deletedAt === root.deletedAt) {
        if (!byParent.has(n.parentId)) byParent.set(n.parentId, [])
        byParent.get(n.parentId).push(n)
      }
      for (const n of queue) {
        if (seen.has(n.id)) continue
        seen.add(n.id); queue.push(...(byParent.get(n.id) || []))
        n.deletedAt = null
        autosave.mark('mubu', n)
      }
    },

    async mubuPurge(id) {
      const all = [id, ...this.mubuDescendants(id).map((n) => n.id)]
      await db.mubu.bulkDelete(all)
      this.mubu = this.mubu.filter((n) => !all.includes(n.id))
      await this.purgeLoreLinksFor('mubu', all)
      this.ensureMubuSet()
    },

    /** 撤销/重做：用快照同步整棵树（增/删/改差异落库） */
    async mubuSyncTree(flatNodes) {
      const want = new Map(flatNodes.filter(n => n.workId === this.work?.id).map(n => [n.id, n]))
      const current = new Map(this.mubu.map(n => [n.id, n]))
      for (const [id, saved] of want) {
        const row = current.get(id)
        if (row) {
          const keys = new Set([...Object.keys(row), ...Object.keys(saved)])
          if ([...keys].every(k => k === 'updatedAt' || JSON.stringify(row[k]) === JSON.stringify(saved[k]))) continue
          // Remove fields absent from the snapshot too (e.g. heading after undo).
          for (const k of Object.keys(row)) if (!(k in saved)) delete row[k]
          Object.assign(row, JSON.parse(JSON.stringify(saved)), { updatedAt: now() })
          autosave.mark('mubu', row)
        } else {
          const restored = { ...JSON.parse(JSON.stringify(saved)), updatedAt: now() }
          this.mubu.push(restored); autosave.mark('mubu', restored)
        }
      }
      for (const row of this.mubu) if (!want.has(row.id) && !row.deletedAt) {
        row.deletedAt = now(); autosave.mark('mubu', row)
      }
      this.mubuRevision++; this.ensureMubuSet()
    },

    /* ---------- 大纲节点树（8.8 思维导图方向） ---------- */

    /* ---------- 大纲自由模块画布（8.8.2） ---------- */

    /**
     * 大纲节点迁移（两段式）：
     * - v1（≤v0.4.0 老数据）：仅当存在非空旧大纲内容时，导入为容器 + 条目节点（保留用户文本）；
     * - v2（本次，v0.4.1）：固定组语义降级为普通容器（可编辑可删除），卷节点保留 refId 联动，
     *   章节点转为章节锚点（anchor）；注意此阶段 this.olnodes 尚未装载，需直接读库。
     * - 全新作品：空画布，不预置任何结构（骨架模板见 OutlineCanvas 的「快速开始」）。
     * outlines 旧表保留不删（回滚安全）。
     */
    async migrateOlnodes(workId) {
      const hasLegacy = this.outlines.some((o) => !o.deletedAt && (o.content || '').trim())
      const v1Flag = await db.appconfig.get('olnodes-mig:' + workId)
      const v2Flag = await db.appconfig.get('olnodes-mig2:' + workId)
      if (v2Flag) return
      const rows = await db.olnodes.where('workId').equals(workId).toArray()
      const put = (row) => db.olnodes.put(JSON.parse(JSON.stringify(row)))

      if (!v1Flag && hasLegacy) {
        const mk = async (fields) => {
          const row = {
            id: uid(), workId, parentId: null, refId: null, kind: 'event', title: '',
            text: '', html: null, fold: false, sortOrder: 0, deletedAt: null,
            canvasX: null, canvasY: null, shape: 'process', rels: [],
            createdAt: now(), updatedAt: now(), ...fields
          }
          await db.olnodes.add(JSON.parse(JSON.stringify(row)))
          return row
        }
        const contentOf = (refId) => this.outlines.find((o) => o.refId === refId && !o.deletedAt)?.content || ''
        let order = 0
        await mk({ kind: 'container', title: '总纲', text: contentOf(this.work?.id), sortOrder: order++ * 1000 })
        const vg = await mk({ kind: 'container', title: '卷纲', sortOrder: order++ * 1000 })
        for (const v of this.liveVolumes) {
          await mk({ kind: 'volume', refId: v.id, parentId: vg.id, title: v.title, text: contentOf(v.id), sortOrder: order++ * 1000 })
        }
        const cg = await mk({ kind: 'container', title: '章纲', sortOrder: order++ * 1000 })
        for (const c of this.liveChapters) {
          await mk({ kind: 'anchor', refId: c.id, parentId: cg.id, title: c.title, text: contentOf(c.id), sortOrder: order++ * 1000 })
        }
        await mk({ kind: 'container', title: '故事线', sortOrder: order++ * 1000 })
      } else if (v1Flag || rows.length) {
        // v1 已迁移（或存在任意旧节点数据）：固定组降级、章节点转为锚点
        for (const n of rows) {
          if (['master', 'volumes', 'chapters', 'lines'].includes(n.kind)) {
            n.kind = 'container'
            await put(n)
          } else if (n.kind === 'line' || n.kind === 'note') {
            n.kind = 'event'
            await put(n)
          } else if (n.kind === 'chapter') {
            n.kind = 'anchor'
            await put(n)
          }
          if (n.canvasX == null && n.rels === undefined) {
            n.rels = []
            await put(n)
          }
        }
      }
      await db.appconfig.put({ key: 'olnodes-mig2:' + workId, value: 1 })
    },

    liveOlnodes() {
      /* v1.0.13 起连接点不再作为画布模块（改为钉在宿主连线 rel.junctions 上）；
       * 旧版本创建的 kind:'arrow' 模块一律按已删除处理，不进渲染与统计 */
      return this.olnodes
        .filter((n) => !n.deletedAt && n.kind !== 'arrow')
        .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))
    },

    olnodeChildren(parentId) {
      return this.liveOlnodes().filter((n) => (n.parentId || null) === (parentId || null))
    },

    olnodeByRef(refId) {
      return this.olnodes.find((n) => n.refId === refId && !n.deletedAt) || null
    },

    olnodeAdd(parentId, fields = {}, afterId = null) {
      this.olnodePushUndo(true)
      const siblings = this.olnodeChildren(parentId)
      const row = {
        id: uid(), workId: this.work.id, parentId: parentId || null, refId: null,
        kind: 'event', title: '', text: '', html: null, fold: false, sortOrder: 0,
        canvasX: null, canvasY: null, w: null, h: null, shape: 'process', status: '', pin: false, rels: [],
        deletedAt: null, createdAt: now(), updatedAt: now(), ...fields,
        ...(fields.kind === 'event' && !fields.status ? { status: 'planned' } : {})
      }
      if (afterId) {
        const i = siblings.findIndex((s) => s.id === afterId)
        row.sortOrder = i >= 0 ? siblings[i].sortOrder + 500 : siblings.length * 1000
        this.olnodes.push(row)
        this.olnodeNormalize(parentId)
      } else {
        row.sortOrder = siblings.reduce((m, s) => Math.max(m, s.sortOrder || 0), -1000) + 1000
        this.olnodes.push(row)
      }
      autosave.mark('olnodes', row)
      return row
    },

    olnodeNormalize(parentId) {
      this.olnodeChildren(parentId).forEach((s, i) => {
        if (s.sortOrder !== i * 1000) {
          s.sortOrder = i * 1000
          autosave.mark('olnodes', s)
        }
      })
    },

    olnodeSetTitle(id, title) {
      const n = this.olnodes.find((x) => x.id === id)
      if (!n) return
      n.title = title
      autosave.mark('olnodes', n)
    },

    olnodeSetRich(id, text, html = undefined) {
      const n = this.olnodes.find((x) => x.id === id)
      if (!n) return
      n.text = text
      if (html !== undefined) n.html = html
      this.mubuRevision++
      autosave.mark('olnodes', n)
    },

    olnodeRemove(id) {
      this.olnodePushUndo(true)
      const all = [this.olnodes.find((x) => x.id === id), ...this.olnodeDescendants(id)].filter(Boolean)
      const t = now()
      for (const n of all) {
        n.deletedAt = t
        autosave.mark('olnodes', n)
      }
      // A removed target can destroy a host owned by another node. Prune the
      // full dependency graph, including nested branches, within this undo.
      const cleaned = relationTransaction(this.olnodes, { type: 'prune' })
      for (const row of cleaned.nodes) {
        const n = this.olnodes.find(x => x.id === row.id)
        if (!n.deletedAt && JSON.stringify(n.rels) !== JSON.stringify(row.rels)) {
          n.rels = row.rels
          autosave.mark('olnodes', n)
        }
      }
    },

    olnodeDescendants(id) {
      const out = []
      const walk = (pid) => this.olnodeChildren(pid).forEach((n) => (out.push(n), walk(n.id)))
      walk(id)
      return out
    },

    olnodeToggleFold(id) {
      const n = this.olnodes.find((x) => x.id === id)
      if (!n) return
      n.fold = !n.fold
      autosave.mark('olnodes', n)
    },

    olnodeSetCanvas(id, x, y) {
      const n = this.olnodes.find((x2) => x2.id === id)
      if (!n) return
      n.canvasX = Math.round(x)
      n.canvasY = Math.round(y)
      autosave.mark('olnodes', n)
    },

    /** 骨架模板批量创建：调用方先 olnodePushUndo(true)，本动作不再逐条压栈；_parent 为 rows 序号（创建后回填父级） */
    olnodeBulkAdd(rows) {
      const t = now()
      const created = []
      for (const r of rows) {
        const row = {
          id: uid(), workId: this.work.id, parentId: r.parentId || null, refId: r.refId || null,
          kind: r.kind || 'event', title: r.title || '', text: r.text || '', html: null,
          fold: false, sortOrder: r.sortOrder || 0, canvasX: r.canvasX ?? null, canvasY: r.canvasY ?? null,
          shape: r.shape || 'process', w: r.w ?? null, h: r.h ?? null, rels: [], deletedAt: null, createdAt: t, updatedAt: t
        }
        this.olnodes.push(row)
        created.push(row)
        autosave.mark('olnodes', row)
      }
      for (let i = 0; i < rows.length; i++) {
        const pi = rows[i]?._parent
        if (pi != null && created[pi]) {
          created[i].parentId = created[pi].id
          autosave.mark('olnodes', created[i])
        }
      }
      return created
    },

    olnodeSetShape(id, shape) {
      const n = this.olnodes.find((x) => x.id === id)
      if (!n) return
      n.shape = shape
      /* 换形状就换几何：没手动定过的边交回 effSize 按形状设计尺寸出盒（矩形以外的形状有各自的
       * 设计比例，钉死旧宽高会把纸面拉扁、正文内距也错位）；manualW/manualH 的边保留，不能静默丢掉作者拖过的尺寸。 */
      if (n.kind === 'event') {
        if (!n.manualW) n.w = null
        if (!n.manualH) n.h = null
      }
      autosave.mark('olnodes', n)
    },

    /** 自定义尺寸（v0.4.1 界面优化）：只写入被拖拽的轴；manualW/manualH 让分层布局尊重手动尺寸 */
    olnodeSetSize(id, w, h) {
      const n = this.olnodes.find((x) => x.id === id)
      if (!n) return
      if (w != null) {
        n.w = Math.round(w)
        n.manualW = true
      }
      if (h != null) {
        n.h = Math.round(h)
        n.manualH = true
      }
      autosave.mark('olnodes', n)
    },

    /** 容器内 PPT 式文本框（v0.4.2）：textboxes = [{ id, x, y, w, h, text, opacity }]，坐标相对容器正文区 */
    olnodeTextboxesSet(id, list) {
      const n = this.olnodes.find((x) => x.id === id)
      if (!n) return
      n.textboxes = JSON.parse(JSON.stringify(list))
      autosave.mark('olnodes', n)
    },

    /** 容器颜色（v0.4.2 右键快捷栏）：color 为调色板色值，null 恢复按序自动配色 */
    olnodeSetColor(id, color) {
      const n = this.olnodes.find((x) => x.id === id)
      if (!n) return
      n.color = color || ''
      autosave.mark('olnodes', n)
    },

    /** 事件写作状态（设计稿分层画布）：done / writing / revise / planned；空值=未标记。 */
    olnodeSetStatus(id, status) {
      const n = this.olnodes.find((x) => x.id === id)
      if (!n) return
      n.status = ['done', 'writing', 'revise', 'planned'].includes(status) ? status : ''
      autosave.mark('olnodes', n)
    },

    /** 容器章节标签（如「第 1—3 章」），只用于层级卡显示。 */
    olnodeSetChapter(id, chapter) {
      const n = this.olnodes.find((x) => x.id === id)
      if (!n) return
      n.chapter = String(chapter || '').trim()
      autosave.mark('olnodes', n)
    },

    olnodeSetRels(id, rels) {
      const n = this.olnodes.find((x) => x.id === id)
      if (!n) return
      n.rels = rels
      autosave.mark('olnodes', n)
    },

    olnodeSetPin(id, pin) {
      const n = this.olnodes.find((x) => x.id === id)
      if (!n) return
      n.pin = !!pin
      autosave.mark('olnodes', n)
    },

    /** 引用卡设目标（8.8.2-G2）：refId 存 "kind:id"，标题随目标预填 */
    olnodeSetCite(id, target) {
      const n = this.olnodes.find((x) => x.id === id)
      if (!n || !target) return
      n.refId = target.kind + ':' + target.id
      n.title = target.title || ''
      autosave.mark('olnodes', n)
    },

    /** 画布偏好读写（appconfig 按作品隔离） */
    async loadCanvasPrefs() {
      const workId = this.work?.id
      this.canvasPrefs = {
        snap: true,
        density: 'detail',
        edgeStyle: 'bezier',
        edgeWidth: 1.6,
        arrowSize: 1,
        textures: true,
        canvasOpacity: 100,
        showDots: true,
        scopeId: null,
        expanded: [],
        cameras: {}
      }
      let savedExpanded
      try {
        const row = await db.appconfig.get('olcanvas:' + workId)
        savedExpanded = row?.value?.expanded
        if (this.work?.id === workId && row?.value) this.canvasPrefs = { ...this.canvasPrefs, ...row.value }
      } catch { /* 已重置为旧作品的兼容默认值 */ }
      /* 分层状态自检：作品切换/容器删除后不能停留在失效层级。 */
      const nodes = this.liveOlnodes()
      const byId = new Map(nodes.map((n) => [n.id, n]))
      const scope = this.canvasPrefs.scopeId
      if (scope && byId.get(scope)?.kind !== 'container') this.canvasPrefs.scopeId = null
      this.canvasPrefs.expanded = initialExpandedContainers(nodes, savedExpanded)
      if (!this.canvasPrefs.cameras || typeof this.canvasPrefs.cameras !== 'object') this.canvasPrefs.cameras = {}
      /* 材质入口已移除：旧作品里关闭过纹理也统一回到默认材质。 */
      this.canvasPrefs.textures = true
      this.canvasPrefs.canvasOpacity = normalizeCanvasOpacity(this.canvasPrefs.canvasOpacity)
    },
    async saveCanvasPrefs() {
      if (!this.work) return
      await db.appconfig.put({ key: 'olcanvas:' + this.work.id, value: JSON.parse(JSON.stringify(this.canvasPrefs)) })
    },

    /** 每章字数目标读写（appconfig 按作品隔离；0 = 未设目标） */
    async loadWordGoal() {
      try {
        const row = await db.appconfig.get('wordgoal:' + this.work?.id)
        this.wordGoal = Math.max(0, Math.round(Number(row?.value) || 0))
      } catch {
        this.wordGoal = 0
      }
    },
    async setWordGoal(n) {
      this.wordGoal = Math.max(0, Math.round(Number(n) || 0))
      if (!this.work) return
      await db.appconfig.put({ key: 'wordgoal:' + this.work.id, value: this.wordGoal })
    },

    /** 设定标签创建时间表读写（appconfig 按作品隔离；创建栏新建标签时记时，标签面板选择栏按其排序） */
    async loadMubuTagMeta() {
      try {
        const row = await db.appconfig.get('mubutagmeta:' + this.work?.id)
        this.mubuTagMeta = row?.value && typeof row.value === 'object' ? row.value : {}
      } catch {
        this.mubuTagMeta = {}
      }
    },
    async saveMubuTagMeta() {
      if (!this.work) return
      await db.appconfig.put({ key: 'mubutagmeta:' + this.work.id, value: JSON.parse(JSON.stringify(this.mubuTagMeta)) })
    },
    /** 新建标签（标签面板创建栏入口）：同名不重复计时；返回清洗后的标签名（空串 = 无效输入） */
    async mubuCreateTag(name) {
      const t = String(name ?? '').trim().slice(0, 20)
      if (!t) return ''
      if (!this.mubuTagMeta[t]) {
        this.mubuTagMeta = { ...this.mubuTagMeta, [t]: now() }
        await this.saveMubuTagMeta()
      }
      return t
    },

    /* ---------- 关联关系（关系链接）：条目级「设定↔设定 / 设定↔人物」关系 ---------- */

    /** 某条目的全部关系（出向在前）：dir / 本侧展示标签（入向取反向名）/ 对端 / 描述 / 颜色 */
    loreLinksOf(kind, id) {
      const titleOf = (k, oid) => {
        if (k === 'mubu') return ((this.mubu.find((n) => n.id === oid && !n.deletedAt) || {}).text || '（空节点）').slice(0, 40)
        return (this.characters.find((c) => c.id === oid && !c.deletedAt) || {}).name || '未命名'
      }
      const out = []
      for (const l of this.liveLoreLinks) {
        if (l.fromKind === kind && l.fromId === id) {
          out.push({ linkId: l.id, dir: 'out', label: l.label || '关联', reverseLabel: l.reverseLabel || '', otherKind: l.toKind, otherId: l.toId, otherTitle: titleOf(l.toKind, l.toId), description: l.description || '', color: l.color || '' })
        } else if (l.toKind === kind && l.toId === id) {
          out.push({ linkId: l.id, dir: 'in', label: l.reverseLabel || l.label || '关联', reverseLabel: l.label || '', otherKind: l.fromKind, otherId: l.fromId, otherTitle: titleOf(l.fromKind, l.fromId), description: l.description || '', color: l.color || '' })
        }
      }
      out.sort((a, b) => (a.dir === b.dir ? 0 : a.dir === 'out' ? -1 : 1))
      return out
    },

    /** 新建关联关系（清洗 + 去重 + 禁止自连）；无效输入返回 null，重复（同向同类型）返回既有行并顺带更新描述 */
    addLoreLink({ fromKind, fromId, toKind, toId, label, reverseLabel = '', description = '', color = '' }) {
      if (!this.work) return null
      const okKind = (k) => k === 'mubu' || k === 'character'
      if (!okKind(fromKind) || !okKind(toKind) || !fromId || !toId) return null
      if (fromKind === toKind && fromId === toId) return null
      const cleanLabel = String(label ?? '').trim().slice(0, 12)
      if (!cleanLabel) return null
      const cleanReverse = String(reverseLabel ?? '').trim().slice(0, 12)
      const cleanDesc = String(description ?? '').trim().slice(0, 120)
      const dup = this.lorelinks.find((l) => l.fromKind === fromKind && l.fromId === fromId && l.toKind === toKind && l.toId === toId && (l.label || '') === cleanLabel)
      if (dup) {
        if (dup.description !== cleanDesc || dup.reverseLabel !== cleanReverse) this.updateLoreLink(dup.id, { description: cleanDesc, reverseLabel: cleanReverse })
        return dup
      }
      const row = { id: uid(), workId: this.work.id, fromKind, fromId, toKind, toId, label: cleanLabel, reverseLabel: cleanReverse, description: cleanDesc, color: String(color || ''), createdAt: now(), updatedAt: now() }
      this.lorelinks.push(row)
      autosave.mark('lorelinks', row)
      return row
    },

    updateLoreLink(id, patch) {
      const l = this.lorelinks.find((x) => x.id === id)
      if (!l) return
      if (patch.label !== undefined) {
        const v = String(patch.label).trim().slice(0, 12)
        if (v) l.label = v
      }
      if (patch.reverseLabel !== undefined) l.reverseLabel = String(patch.reverseLabel).trim().slice(0, 12)
      if (patch.description !== undefined) l.description = String(patch.description).trim().slice(0, 120)
      if (patch.color !== undefined) l.color = String(patch.color || '')
      autosave.mark('lorelinks', l)
    },

    async removeLoreLink(id) {
      await db.lorelinks.delete(id)
      this.lorelinks = this.lorelinks.filter((x) => x.id !== id)
    },

    /** 端点条目被彻底删除时清理其关系（软删不清理：回收站还原后关系保留） */
    async purgeLoreLinksFor(kind, ids) {
      const set = new Set(ids)
      const dead = this.lorelinks.filter((l) => (l.fromKind === kind && set.has(l.fromId)) || (l.toKind === kind && set.has(l.toId)))
      if (!dead.length) return
      await db.lorelinks.bulkDelete(dead.map((l) => l.id))
      const deadIds = new Set(dead.map((l) => l.id))
      this.lorelinks = this.lorelinks.filter((l) => !deadIds.has(l.id))
    },

    /** 关联关系图谱布局读写（appconfig 按作品隔离；结构 { '<kind:id>'(中心): { '<kind:id>': { x, y } } }） */
    async loadLoreGraph() {
      const row = await db.appconfig.get('loreGraph:' + this.work?.id)
      this.loreGraph = row?.value && typeof row.value === 'object' ? row.value : {}
      return this.loreGraph
    },
    async saveLoreGraph(map) {
      if (!this.work) return
      /* 落库必须用纯快照：IndexedDB 无法克隆 Vue 响应式代理（直接传 store 态会抛 DataCloneError，
         布局静默丢失）——与 saveMubuTagMeta / saveOlTypes 同口径 */
      const plain = JSON.parse(JSON.stringify(map || {}))
      this.loreGraph = plain
      await db.appconfig.put({ key: 'loreGraph:' + this.work.id, value: plain })
    },

    /** 自定义模块类型注册表（8.8.2-G2）：appconfig 按作品隔离，节点以 mtype 名称引用 */
    async loadOlTypes() {
      try {
        const row = await db.appconfig.get('olTypes:' + this.work?.id)
        this.olTypes = Array.isArray(row?.value) ? row.value : []
      } catch {
        this.olTypes = []
      }
    },
    async saveOlTypes() {
      if (!this.work) return
      await db.appconfig.put({ key: 'olTypes:' + this.work.id, value: JSON.parse(JSON.stringify(this.olTypes)) })
    },
    olTypeAdd(name) {
      const nameTrim = String(name || '').trim()
      if (!nameTrim || this.olTypes.some((t) => t.name === nameTrim)) return null
      const palette = ['#c0392b', '#2980b9', '#27ae60', '#8e44ad', '#d35400', '#16a085', '#b8860b']
      const t = { name: nameTrim, color: palette[this.olTypes.length % palette.length] }
      this.olTypes.push(t)
      this.saveOlTypes()
      return t
    },
    olTypeRemove(name) {
      this.olTypes = this.olTypes.filter((t) => t.name !== name)
      this.saveOlTypes()
    },
    olnodeSetMtype(id, mtype) {
      const n = this.olnodes.find((x) => x.id === id)
      if (!n) return
      n.mtype = String(mtype || '')
      autosave.mark('olnodes', n)
    },

    /**
     * 章节锚点懒挂载（8.8.2-G1）：首次在右栏输入本章速记时才创建锚点节点，
     * refId 关联章节（显示状态点与字数、可跳正文），不再预生成。
     */
    ensureChapterAnchor(chapterId) {
      const exist = this.olnodeByRef(chapterId)
      if (exist) return exist
      const ch = this.chapters.find((x) => x.id === chapterId && !x.deletedAt)
      if (!ch || !this.work) return null
      return this.olnodeAdd(null, { kind: 'anchor', refId: chapterId, title: ch.title, text: '' })
    },

    /* ---------- 人物关系图（8.8.3） ---------- */

    /* 人物关系图持久化（appconfig 按作品隔离，单一 key charGraph:<workId>）
       文档形状：{ positions:{ id:{x,y} }, camera:{ 'local:wide'|'local:compact'|'all:wide'|'all:compact':{x,y,z} } }
       旧数据（平铺的 id→{x,y}）读回时一律当成 positions —— 只在这一处归一，其余动作都走文档。 */
    async loadCharGraphDoc() {
      const row = await db.appconfig.get('charGraph:' + this.work?.id)
      const raw = row?.value && typeof row.value === 'object' ? row.value : {}
      const positions = raw.positions && typeof raw.positions === 'object' ? raw.positions : raw
      const camera = raw.camera && typeof raw.camera === 'object' ? raw.camera : {}
      return { positions: { ...positions }, camera: { ...camera } }
    },
    async saveCharGraphDoc({ positions, camera } = {}) {
      if (!this.work) return
      const doc = {
        positions: positions && typeof positions === 'object' ? positions : {},
        camera: camera && typeof camera === 'object' ? camera : {}
      }
      await db.appconfig.put({ key: 'charGraph:' + this.work.id, value: JSON.parse(JSON.stringify(doc)) })
    },
    /** 兼容旧签名：只交节点坐标（旧版关系图/旧数据仍按平铺 id→{x,y} 读） */
    async loadCharGraph() {
      const doc = await this.loadCharGraphDoc()
      return doc.positions
    },
    /** 兼容旧签名：只写节点坐标，已存的相机原样保留 */
    async saveCharGraph(positions) {
      if (!this.work) return
      const doc = await this.loadCharGraphDoc()
      await this.saveCharGraphDoc({ positions: positions || {}, camera: doc.camera })
    },
    /** 读某一档的相机（key = 'scope:layout'，如 'local:wide'）；没记录返回 null */
    async loadCharCamera(key) {
      if (!key) return null
      const doc = await this.loadCharGraphDoc()
      return normalizeCamera(doc.camera[key])
    },
    /** 存某一档的相机；cam 传 null 表示清掉这一档（其余档位与节点坐标不动） */
    async saveCharCamera(key, cam) {
      if (!this.work || !key) return
      const doc = await this.loadCharGraphDoc()
      const camera = { ...doc.camera }
      const next = normalizeCamera(cam)
      if (next) camera[key] = next
      else delete camera[key]
      await this.saveCharGraphDoc({ positions: doc.positions, camera })
    },

    /** 关系链接引用卡点选人物 → 跳人物模块并定位关系图 */
    jumpToCharGraph(charId) {
      const c = this.characters.find((x) => x.id === charId && !x.deletedAt)
      if (!c) return false
      this.tab = 'characters'
      this.selCharacterId = charId
      this.charView = 'graph'
      this.charFocusId = charId
      this.charFocusTick++
      return true
    },

    /** 人物节点「发送为大纲画布引用卡」（跨模块人物动线） */
    sendCharToOutline(charId) {
      const c = this.characters.find((x) => x.id === charId && !x.deletedAt)
      if (!c) return null
      const row = this.olnodeAdd(null, { kind: 'cite', refId: 'character:' + c.id, title: c.name || '未命名', text: '' })
      this.tab = 'outline'
      this.outlineView = 'canvas'
      this.selOlnodeId = row.id
      this.canvasFocusTick++
      return row
    },

    /** 拖拽重挂接（8.8 专业导图交互）：把节点移动到目标父级下（afterId 为 null 时追加到末尾；
     *  beforeId 用于插到指定兄弟之前——容器内迷你卡拖动排序需要插到第一位）。 */
    olnodeMoveTo(id, targetParentId, afterId = null, beforeId = null) {
      const n = this.olnodes.find((x) => x.id === id)
      if (!n || id === targetParentId) return false
      this.olnodePushUndo(true)
      // 不能挂到自己的后代下
      if (this.olnodeDescendants(id).some((d) => d.id === targetParentId)) return false
      const oldParent = n.parentId || null
      n.parentId = targetParentId || null
      const sibs = this.olnodeChildren(targetParentId || null).filter((s) => s.id !== id)
      if (afterId) {
        const i = sibs.findIndex((s) => s.id === afterId)
        n.sortOrder = i >= 0 ? sibs[i].sortOrder + 500 : sibs.length * 1000
      } else if (beforeId) {
        const i = sibs.findIndex((s) => s.id === beforeId)
        if (i > 0) n.sortOrder = ((sibs[i - 1].sortOrder || 0) + (sibs[i].sortOrder || 0)) / 2
        else n.sortOrder = i === 0 ? (sibs[0].sortOrder || 0) - 1000 : sibs.length * 1000
      } else {
        n.sortOrder = sibs.reduce((m, s) => Math.max(m, s.sortOrder || 0), -1000) + 1000
      }
      autosave.mark('olnodes', n)
      if (oldParent !== (targetParentId || null)) this.olnodeNormalize(oldParent)
      this.olnodeNormalize(targetParentId || null)
      return true
    },

    /** 多选封装：同层至少两个节点 → 新建容器并迁移，整段只压一次 undo。 */
    olnodeWrap(ids, fields = {}) {
      const unique = [...new Set((ids || []).filter(Boolean))]
      if (unique.length < 2) return null
      const rows = unique.map((id) => this.olnodes.find((n) => n.id === id && !n.deletedAt)).filter(Boolean)
      if (rows.length !== unique.length) return null
      const parentId = rows[0].parentId || null
      if (rows.some((n) => (n.parentId || null) !== parentId)) return null
      const title = String(fields.title || '').trim()
      if (!title) return null
      this.olnodePushUndo(true)
      const siblings = this.olnodeChildren(parentId)
      const order = new Map(siblings.map((n, i) => [n.id, i]))
      const picked = new Set(unique)
      rows.sort((a, b) => (order.get(a.id) || 0) - (order.get(b.id) || 0))
      const firstIdx = order.get(rows[0].id) || 0
      const beforeCount = siblings.slice(0, firstIdx).filter((n) => !picked.has(n.id)).length
      const minX = Math.min(...rows.map((n) => n.canvasX ?? 0))
      const minY = Math.min(...rows.map((n) => n.canvasY ?? 0))
      const row = {
        id: uid(),
        workId: this.work.id,
        parentId,
        refId: null,
        kind: 'container',
        title,
        text: String(fields.summary || '').trim(),
        html: null,
        fold: false,
        sortOrder: beforeCount * 1000 + 500,
        canvasX: Math.round(fields.x ?? minX),
        canvasY: Math.round(fields.y ?? minY),
        w: fields.w ? Math.max(340, Number(fields.w)) : null,
        h: null,
        shape: 'process',
        pin: false,
        rels: [],
        color: fields.color || '',
        chapter: String(fields.chapter || '').trim(),
        deletedAt: null,
        createdAt: now(),
        updatedAt: now()
      }
      this.olnodes.push(row)
      rows.forEach((n, i) => {
        n.parentId = row.id
        n.sortOrder = i * 1000
        autosave.mark('olnodes', n)
      })
      this.olnodeNormalize(parentId)
      this.olnodeNormalize(row.id)
      autosave.mark('olnodes', row)
      return row
    },

    /* 撤销 / 重做（快照栈）：结构操作前 force 快照，连续文本编辑按 1.2s 合并 */
    olnodePushUndo(force = false) {
      if (this.aiApplying) return
      const t = Date.now()
      if (!force && this.olUndo.length && t - this.olUndoAt < 1200) {
        this.olUndoAt = t
        return
      }
      this.olUndo.push(JSON.stringify(this.olnodes.map((n) => ({ ...n }))))
      if (this.olUndo.length > 60) this.olUndo.shift()
      this.olRedo = []
      this.olUndoAt = t
    },

    olnodeUndo() {
      if (!this.olUndo.length) return false
      this.olRedo.push(JSON.stringify(this.olnodes.map((n) => ({ ...n }))))
      this.olnodes = JSON.parse(this.olUndo.pop())
      for (const n of this.olnodes) autosave.mark('olnodes', n)
      return true
    },

    olnodeRedo() {
      if (!this.olRedo.length) return false
      this.olUndo.push(JSON.stringify(this.olnodes.map((n) => ({ ...n }))))
      this.olnodes = JSON.parse(this.olRedo.pop())
      for (const n of this.olnodes) autosave.mark('olnodes', n)
      return true
    },

    /* ---------- 统一关系层（8.8.2-G3）：边存储于源节点 rels 数组 [{ id, toId, label, kind, arrows, style }] ----------
     * 连接点（v1.0.13 推倒重建）：不再作为画布模块节点，直接挂在宿主连线上——
     * rel.junctions = [{ id, t }]（t 为宿主连线路径参数 0–1）；
     * 连线可以接到连接点上：rel.toJunction = { ownerId, relId, junctionId }，
     * 连接点屏幕位置由宿主连线路径实时派生，节点挪位/整理布局后仍在原线上。 */
    olnodeRelsOf(id) {
      const n = this.olnodes.find((x) => x.id === id)
      const arr = n && Array.isArray(n.rels) ? n.rels : []
      return arr.map((r) => ({ arrows: '->', style: '', label: '', kind: '关联', junctions: [], ...r }))
    },
    /** One validated command = one undo snapshot and one autosave commit. */
    olnodeRelGesture(command) {
      const result = relationTransaction(this.olnodes, command, { uid, now: () => Date.now() })
      if (!result.ok) return result
      const changes = result.nodes.filter(n => JSON.stringify(n.rels || []) !== JSON.stringify(this.olnodes.find(x => x.id === n.id)?.rels || []))
      if (!changes.length) return result
      this.olnodePushUndo(true)
      for (const draft of changes) {
        const n = this.olnodes.find(n => n.id === draft.id)
        n.rels = draft.rels
        autosave.mark('olnodes', n)
      }
      return result
    },
    olnodeRelAdd(fromId, toId, fields = {}) {
      const result = this.olnodeRelGesture({ type: 'connect', source: { nodeId: fromId, side: fields.fromSide }, target: { nodeId: toId, side: fields.toSide }, fields })
      return result.ok ? result.rel : null
    },
    /** 通用 rel 补丁（v1.0.16 塑形用）：目标可以是节点 rels 中的连线，也可以是宿主 rel._out 中的引出连线 */
    olnodeRelPatchAny(ownerId, relId, patch) {
      const e = flattenRelations(this.olnodes).find(e => e.owner.id === ownerId && e.rel.id === relId)
      if (!e) return
      Object.assign(e.rel, patch)
      autosave.mark('olnodes', e.owner)
      return e.rel
    },
    olnodeRelRemove(ownerId, relId) {
      return this.olnodeRelGesture({ type: 'remove', ownerId, relId })
    },

    /* ---------- 连接点（挂在宿主连线上，v1.0.13） ---------- */
    /** 在宿主连线 (ownerId, relId) 的路径参数 t 处创建连接点，返回 { id, t, bornAt }；
     * bornAt 用于创建后短暂高亮（方便确认位置），随后淡出隐藏 */
    olnodeJunctionAdd(ownerId, relId, t) {
      const n = this.olnodes.find((x) => x.id === ownerId)
      if (!n || !Array.isArray(n.rels)) return null
      const rel = flattenRelations([n]).find(e => e.rel.id === relId)?.rel
      if (!rel) return null
      this.olnodePushUndo(true)
      const j = { id: uid(), t: Math.max(0, Math.min(1, t)), bornAt: Date.now() }
      rel.junctions = [...(rel.junctions || []), j]
      autosave.mark('olnodes', n)
      return j
    },
    olnodeJunctionRemove(ownerId, relId, junctionId) {
      return this.olnodeRelGesture({ type: 'junction-remove', ownerId, relId, junctionId })
    },
    olnodeRelAddFromJunction(host, toId, fields = {}) {
      const result = this.olnodeRelGesture({ type: 'connect', source: host, target: { nodeId: toId, side: fields.toSide }, fields })
      return result.ok ? result.rel : null
    },
    olnodeRelAddJunctionToJunction(fromHost, toHost, fields = {}) {
      const result = this.olnodeRelGesture({ type: 'connect', source: fromHost, target: toHost, fields })
      return result.ok ? result.rel : null
    },
    /* ---------- 书签（章节快捷收藏） ---------- */
    isChapterBookmarked(id) {
      return this.bookmarks.some((b) => !b.deletedAt && b.targetId === id)
    },

    toggleChapterBookmark(id) {
      const ch = this.chapters.find((x) => x.id === id)
      if (!ch) return false
      const existing = this.bookmarks.find((b) => !b.deletedAt && b.targetId === id)
      if (existing) {
        this.bookmarks = this.bookmarks.filter((b) => b.id !== existing.id)
        db.bookmarks.delete(existing.id)
        return false
      }
      const row = {
        id: uid(), workId: this.work.id, targetType: 'chapter', targetId: id,
        title: ch.title || '', createdAt: now()
      }
      this.bookmarks.push(row)
      db.bookmarks.put(JSON.parse(JSON.stringify(row)))
      return true
    },

    /* ---------- 正文批注 ----------
     * 正文 HTML 只存锚点（span[data-note-id]）与用途色，批注正文/用途元信息存本表；
     * 文字被整段删除时锚点消失，批注转为「已失效」（由侧栏判定与清理），改字不丢批注。 */

    /** 本章批注（含已失效的，按正文出现顺序排列；失效的排最后）
     *  引用文字以正文实时锚点为准（改字后侧栏跟着变），无锚点时回落到建档时的快照。
     *  无批注的章节直接返回，不做 HTML 解析——本 getter 依赖正文内容，每次输入都会重算。 */
    annotationsForChapter(chapterId) {
      const list = this.liveAnnotations.filter((a) => a.chapterId === chapterId)
      if (!list.length) return []
      const ch = this.chapters.find((x) => x.id === chapterId)
      const { ids, texts, order } = scanNoteMarks(ch?.content || '')
      const rank = new Map(order.map((id, i) => [id, i]))
      return list
        .map((a) => {
          const orphan = !ids.has(a.noteId)
          return { ...a, text: orphan ? a.text : texts.get(a.noteId) || a.text, orphan }
        })
        .sort((a, b) => {
          const ra = rank.has(a.noteId) ? rank.get(a.noteId) : 1e9
          const rb = rank.has(b.noteId) ? rank.get(b.noteId) : 1e9
          return ra !== rb ? ra - rb : a.createdAt - b.createdAt
        })
    },

    addAnnotation({ chapterId, noteId, text = '', note = '', color = DEFAULT_NOTE_COLOR, kind = '' }) {
      const row = {
        id: uid(),
        workId: this.work.id,
        chapterId,
        noteId,
        text: String(text || '').slice(0, 400),
        note: String(note || ''),
        color: normalizeNoteColor(color),
        kind: kind || noteKindOf(color)?.key || '',
        createdAt: now(),
        updatedAt: now(),
        deletedAt: null
      }
      this.annotations.push(row)
      autosave.mark('annotations', row)
      return row
    },

    updateAnnotation(id, patch = {}) {
      const a = this.annotations.find((x) => x.id === id)
      if (!a) return
      if (patch.note != null) a.note = String(patch.note)
      if (patch.text != null) a.text = String(patch.text).slice(0, 400)
      if (patch.color != null) {
        a.color = normalizeNoteColor(patch.color)
        a.kind = noteKindOf(a.color)?.key || ''
      }
      autosave.mark('annotations', a)
      return a
    },

    /** 删除批注：先摘正文标记再落库软删（正文标记失败也照删记录，避免残留条目） */
    deleteAnnotation(id) {
      const a = this.annotations.find((x) => x.id === id)
      if (!a) return
      removeNoteMark(a.noteId)
      a.deletedAt = now()
      autosave.mark('annotations', a)
    },

    /** 清理本章全部已失效批注（正文里锚点已不存在的） */
    pruneOrphanAnnotations(chapterId) {
      const ch = this.chapters.find((x) => x.id === chapterId)
      const { ids } = scanNoteMarks(ch?.content || '')
      let n = 0
      for (const a of this.annotations) {
        if (a.deletedAt || a.chapterId !== chapterId) continue
        if (ids.has(a.noteId)) continue
        a.deletedAt = now()
        autosave.mark('annotations', a)
        n++
      }
      return n
    },

    /** 章节彻底删除时一并清理其批注（软删除保留，随章节可恢复） */
    async purgeAnnotationsForChapter(chapterId) {
      const rows = this.annotations.filter((a) => a.chapterId === chapterId)
      if (!rows.length) return
      for (const r of rows) await repo.purgeRow('annotations', r)
      this.annotations = this.annotations.filter((a) => a.chapterId !== chapterId)
    },

    /* ---------- 搜索 ---------- */
    search(q, scopes) {
      const ql = (q || '').trim().toLowerCase()
      if (!ql) return []
      const results = []
      const push = (r) => results.push(r)
      const grab = (text, n = 3) => {
        const t = (text || '').toLowerCase()
        const out = []
        let from = 0
        while (out.length < n) {
          const i = t.indexOf(ql, from)
          if (i < 0) break
          const start = Math.max(0, i - 20)
          out.push((start > 0 ? '…' : '') + (text || '').slice(start, i + ql.length + 30) + '…')
          from = i + ql.length
        }
        return out
      }
      if (scopes.chapters) {
        for (const c of this.liveChapters) {
          const body = c.fmt === 'html' ? stripTags(c.content) : c.content || ''
          const hay = (c.title || '') + '\n' + body
          if (hay.toLowerCase().includes(ql)) push({ type: 'chapters', id: c.id, title: c.title, hits: grab(body).concat(grab(c.title, 1)) })
        }
      }
      if (scopes.outlines) {
        for (const o of this.outlines) {
          if (!(o.content || '').toLowerCase().includes(ql)) continue
          let title = '总纲'
          if (o.level === 'chapter') title = '章纲 · ' + (this.chapters.find((c) => c.id === o.refId)?.title || '未知章节')
          if (o.level === 'volume') title = '卷纲 · ' + (this.volumes.find((v) => v.id === o.refId)?.title || '未知卷')
          push({ type: 'outlines', id: o.refId, title, hits: grab(o.content) })
        }
      }
      if (scopes.characters) {
        for (const c of this.liveCharacters) {
          if (((c.name || '') + (c.aliases || '') + (c.role || '') + (c.tags || []).join('') + (c.content || '')).toLowerCase().includes(ql)) {
            push({ type: 'characters', id: c.id, title: c.name + (primaryRole(c) ? `（${primaryRole(c)}）` : ''), hits: grab(c.content).concat(grab(c.aliases, 1)) })
          }
        }
      }
      if (scopes.lore) {
        for (const n of this.liveMubu()) {
          const tagHit = (n.tags || []).find((t) => t.toLowerCase().includes(ql))
          if ((n.text || '').toLowerCase().includes(ql) || tagHit) {
            push({
              type: 'lore',
              id: n.id,
              title: (n.text || '（空）').slice(0, 24),
              hits: tagHit ? [`标签：${tagHit}`].concat(grab(n.text)) : grab(n.text)
            })
          }
        }
      }
      if (scopes.snippets) {
        for (const s of this.liveSnippets) {
          if ((s.content || '').toLowerCase().includes(ql)) push({ type: 'snippets', id: s.id, title: '灵感 · ' + (s.content || '').slice(0, 18), hits: grab(s.content) })
        }
      }
      return results.slice(0, 200)
    },

    navTo(type, id) {
      this.tab = type
      if (type === 'chapters') {
        this.selChapterId = id
        const c = this.chapters.find((x) => x.id === id)
        if (c) this.selVolumeId = c.volumeId
      }
      if (type === 'lore') {
        useUiStore().focusLoreNode(id, this.mubuPath(id))
      }
      if (type === 'characters') this.selCharacterId = id
      if (type === 'snippets') this.selSnippetId = id
      useUiStore().searchOpen = false
    },

    /* ---------- 版本快照 ---------- */
    async applyAiProposal(card, options = {}) {
      return applyProposal(this, card, options)
    },
    async undoAiApplication(auditId) {
      await undoApplication(this, auditId)
      for (const message of useAiStore().chat) for (const card of [...(message.cards || []),...(message.candidates || []).flatMap(c=>c.cards || [])]) {
        if (card.auditId === auditId) { card.status='undone';card.appliedActions=[];card.auditId=null }
      }
    },

    async revisionsFor(chapterId) {
      return repo.listRevisions('chapter', chapterId)
    },

    async rollbackChapter(chapterId, revisionId) {
      const rev = await db.revisions.get(revisionId)
      const c = this.chapters.find((x) => x.id === chapterId)
      if (!rev || !c) return
      c.content = rev.content
      // 快照若为旧格式（Markdown/纯文本），回滚后恢复原格式标记
      if (c.fmt === 'html' && /<(p|div|h[1-6]|strong|em)\b/i.test(rev.content)) {
        /* html 快照，格式不变 */
      } else if (c.fmt === 'html') {
        c.fmt = 'md'
      }
      c.wordCount = countWords(c.fmt === 'html' ? stripTags(c.content) : c.content)
      autosave.mark('chapters', c, { forceSnapshot: true })
    }
  }
})
