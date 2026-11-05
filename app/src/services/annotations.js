/* 正文批注：选中正文 → 右键「添加批注」→ 右侧批注栏逐条管理
 *
 * 标签形态（富文本正文 TipTap）：
 *   <span class="note-mark" data-note-id="…" data-note-color="#rrggbb" style="--note-color:#rrggbb">选中文字</span>
 *
 * 与关系链接（DlLinkMark）严格分离，二者可同时落在一段文字上而互不覆盖：
 *  - 解析规则互斥：批注认 span[data-note-id]，关系链接认 span[data-dl-target]；渲染属性各写各的；
 *  - 视觉错位：关系链接=点状下划线（主题色，贴字 3px）；批注=实线下划线（批注色，离字 5px、2px 粗）+ 同色淡底；
 *  - 批注 span 不带 .dl-link，故不触发关系链接悬浮预览；反之关系链接 span 不带 .note-mark；
 *  - 批注色只承载「批注用途」语义，不参与关系链接的主题色体系。
 *
 * 正文 HTML 只存锚点 id 与颜色；批注正文（评论内容）存 annotations 表——改字不丢批注，
 * 文字被整段删除时批注转为「已失效」，由侧栏提示清理。
 */
import { Mark } from '@tiptap/core'
import { ref } from 'vue'
import { useWorkStore } from '../stores/work'
import { isPopped } from './panelwindows'

/** 批注用途预设：颜色即用途（下划线颜色可编辑，用于区分不同功能的批注） */
export const ANNOTATION_KINDS = [
  { key: 'revise', label: '待改', color: '#c0392b' },
  { key: 'query', label: '疑问', color: '#2980b9' },
  { key: 'foreshadow', label: '伏笔', color: '#8e44ad' },
  { key: 'idea', label: '灵感', color: '#27ae60' },
  { key: 'research', label: '考据', color: '#d35400' },
  { key: 'todo', label: '待定', color: '#7f8c8d' }
]

export const DEFAULT_NOTE_COLOR = ANNOTATION_KINDS[0].color

/** 颜色白名单化：仅接受 #rgb / #rrggbb / rgb()，其余回落到默认色（防注入） */
export function normalizeNoteColor(c) {
  const s = String(c || '').trim()
  if (/^#[0-9a-f]{6}$/i.test(s)) return s.toLowerCase()
  if (/^#[0-9a-f]{3}$/i.test(s)) {
    return ('#' + s.slice(1).split('').map((x) => x + x).join('')).toLowerCase()
  }
  if (/^rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)$/i.test(s)) return s
  return DEFAULT_NOTE_COLOR
}

/** 颜色反查用途（自定义色返回 null） */
export function noteKindOf(color) {
  const c = String(color || '').toLowerCase()
  return ANNOTATION_KINDS.find((k) => k.color.toLowerCase() === c) || null
}

/** 用途标签文案：命中预设用预设名，自定义色标「自定义」 */
export function noteKindLabel(color) {
  return noteKindOf(color)?.label || '自定义'
}

/* ---------- TipTap 批注标记 ---------- */

export const AnnotationMark = Mark.create({
  name: 'annotation',
  // 高于默认 100：TextStyle 声明了「任意带 style 的 span」的通配规则，而 ProseMirror 取
  // 首个匹配规则——批注 span 内联 --note-color 时会被它抢走、批注标记在解析阶段被静默丢弃
  // （表现为刷新后下划线消失）。提高优先级让本标记的精确规则先于通配规则被采纳。
  priority: 1000,
  inclusive: false, // 光标贴边续写不连带成批注（与关系链接一致）
  addAttributes() {
    return {
      noteId: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-note-id'),
        renderHTML: (a) => (a.noteId ? { 'data-note-id': a.noteId } : {})
      },
      color: {
        default: DEFAULT_NOTE_COLOR,
        // 优先读 data-note-color；兼容只有内联 --note-color 的历史内容
        parseHTML: (el) =>
          normalizeNoteColor(el.getAttribute('data-note-color') || el.style?.getPropertyValue('--note-color')),
        renderHTML: (a) => {
          const c = normalizeNoteColor(a.color)
          return { 'data-note-color': c, style: `--note-color:${c}` }
        }
      }
    }
  },
  parseHTML() {
    return [{ tag: 'span[data-note-id]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', { class: 'note-mark', ...HTMLAttributes }, 0]
  }
})

/* ---------- 当前活动编辑器登记（右侧批注栏据此操作正文标记） ---------- */

const activeEditor = ref(null)

export function setActiveEditor(ed) {
  activeEditor.value = ed || null
}

export function getActiveEditor() {
  return activeEditor.value
}

/* ---------- 正文 HTML 扫描：批注锚点集合 / 引用文字 / 出现顺序 ---------- */

/**
 * 单次 DOM 解析同时得到：ids（存在的锚点）、texts（锚点→被批注文字）、order（文档顺序）。
 * 侧栏据此判断「已失效」批注并按正文顺序排列。
 */
export function scanNoteMarks(html) {
  const ids = new Set()
  const texts = new Map()
  const order = []
  if (!html) return { ids, texts, order }
  try {
    const doc = new DOMParser().parseFromString(String(html), 'text/html')
    for (const el of doc.querySelectorAll('span[data-note-id]')) {
      const id = el.getAttribute('data-note-id')
      if (!id) continue
      if (!ids.has(id)) order.push(id)
      ids.add(id)
      const t = (el.textContent || '').replace(/\s+/g, ' ').trim()
      // 同一批注被其他标记（加粗等）切成多个 span 时按序拼接，中文不加空格
      texts.set(id, (texts.get(id) || '') + t)
    }
  } catch {
    /* HTML 解析失败按无批注处理 */
  }
  return { ids, texts, order }
}

/* ---------- 正文标记操作（按 noteId 定位，不依赖位置） ---------- */

/** 可写的活动编辑器：章节已被其他窗口拆出时，本窗口编辑器内容是过期的快照，
 *  在其上改标记会经 onUpdate 把整篇旧内容写回、覆盖面板窗口的较新编辑
 *  （v1.0.22 门禁；editable 只挡键盘输入，挡不住程序化命令）。返回 null 表示禁止写。 */
function writableEditorFor(noteId) {
  const ed = getActiveEditor()
  if (!ed || !noteId) return null
  try {
    const work = useWorkStore()
    const a = work?.liveAnnotations.find((x) => x.noteId === noteId)
    if (a && work.work && isPopped(work, 'chapter', a.chapterId)) return null
  } catch {
    /* store 未就绪时按可写处理（批注表调用方均已挂载） */
  }
  return ed
}

/** 收集某批注在文档中的文本区间 */
function rangesOfNote(doc, noteId) {
  const out = []
  doc.descendants((node, pos) => {
    if (!node.isText) return
    if (node.marks.some((m) => m.type.name === 'annotation' && m.attrs.noteId === noteId)) {
      out.push({ from: pos, to: pos + node.nodeSize, mark: node.marks.find((m) => m.type.name === 'annotation') })
    }
  })
  return out
}

/** 改批注下划线颜色（同步正文标记；返回是否命中） */
export function recolorNoteMark(noteId, color) {
  const ed = writableEditorFor(noteId)
  if (!ed) return false
  const c = normalizeNoteColor(color)
  let hit = false
  ed.chain()
    .command(({ tr, state }) => {
      for (const r of rangesOfNote(state.doc, noteId)) {
        tr.addMark(r.from, r.to, r.mark.type.create({ ...r.mark.attrs, color: c }))
        hit = true
      }
      return hit
    })
    .run()
  return hit
}

/** 移除批注标记（保留文字；返回是否命中） */
export function removeNoteMark(noteId) {
  const ed = writableEditorFor(noteId)
  if (!ed) return false
  const type = ed.schema.marks.annotation
  if (!type) return false
  let hit = false
  ed.chain()
    .command(({ tr, state }) => {
      for (const r of rangesOfNote(state.doc, noteId)) {
        tr.removeMark(r.from, r.to, type)
        hit = true
      }
      return hit
    })
    .run()
  return hit
}

/** 定位批注：滚动到可见处 + 闪烁提示，并把编辑器选区落到该批注范围 */
export function focusNoteMark(noteId) {
  const ed = getActiveEditor()
  if (!ed || !noteId) return false
  const sel = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(noteId) : String(noteId).replace(/"/g, '\\"')
  const el = ed.view?.dom?.querySelector?.(`[data-note-id="${sel}"]`)
  if (!el) return false
  try {
    el.scrollIntoView({ block: 'center', behavior: 'smooth' })
  } catch {
    el.scrollIntoView()
  }
  el.classList.add('note-flash')
  setTimeout(() => el.classList.remove('note-flash'), 2400)
  // 选区落到批注范围，便于紧接着右键「编辑批注」
  const rs = rangesOfNote(ed.state.doc, noteId)
  if (rs.length) {
    try {
      ed.chain().setTextSelection({ from: rs[0].from, to: rs[rs.length - 1].to }).run()
    } catch {
      /* 选区越界忽略 */
    }
  }
  return true
}
