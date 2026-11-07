/* 设置页的纯逻辑层：字体表、偏好归一、外观历史栈、默认值与保存失败文案。
   字体表是唯一一份真源：stores/ui.js 从这里 import 后再 re-export 成 FONT_MAP/LATIN_MAP，
   既有 .vue 导入点不变——之所以把表挪出来，是设置页的归一函数要靠它校验字体 key，
   而 store 带着 pinia/dexie，node 单测加载不了，复制第二份又必然漂移。
   本文件不得引入 pinia / db / vue，保持可直接被 node --test 加载。 */

/* 素材：思源宋体/霞鹜文楷/京华老宋体/朝华标题/云游手书/Gothic One 均已本地化（src/assets/fonts） */
export const CJK_FONTS = {
  song: { label: '思源宋体', stack: '"Noto Serif SC", "SimSun", serif' },
  kai: { label: '霞鹜文楷', stack: '"LXGW WenKai", "KaiTi", serif' },
  jinghua: { label: '京华老宋体', stack: '"KingHwa OldSong", "SimSun", serif' },
  zhaohua: { label: '朝华标题', stack: '"Zhaohua Title", "SimSun", serif' },
  yunyou: { label: '云游手书', stack: '"Ziyu Yunyou", "KaiTi", serif' },
  hei: { label: '系统黑体', stack: '"Microsoft YaHei", "PingFang SC", sans-serif' }
}
export const LATIN_FONTS = {
  none: { label: '跟随中文', stack: '' },
  playfair: { label: 'Playfair Display', stack: '"Playfair Display"' },
  gothic: { label: 'Montenegrin Gothic One', stack: '"Montenegrin Gothic One"' }
}
export const FONT_MAP = CJK_FONTS
export const LATIN_MAP = LATIN_FONTS

export const SETTINGS_DEFAULTS = { editorFont: 'song', editorLatin: 'none', fontSize: 17, topbarAutoHide: false }

/* 总稿 model.mjs:7 的 13–24px 区间与 12 步撤销窗口 */
const FONT_SIZE_MIN = 13
const FONT_SIZE_MAX = 24
export const SETTINGS_HISTORY_LIMIT = 12

export const SETTINGS_SAVE_ERROR = '改动尚未保存，当前选择仍保留。请释放存储空间后重试。'

/* 归一即真源：任何来源（appconfig、备份、跨窗口广播）的偏好都先过这里，
   字体 key 只认表里有的，字号取整后夹在 13–24，topbarAutoHide 只认 === true。 */
export function normalizeSettingsPrefs(p = {}) {
  const src = p && typeof p === 'object' ? p : {}
  const size = src.fontSize == null ? NaN : Number(src.fontSize)
  return {
    editorFont: Object.hasOwn(CJK_FONTS, src.editorFont) ? src.editorFont : SETTINGS_DEFAULTS.editorFont,
    editorLatin: Object.hasOwn(LATIN_FONTS, src.editorLatin) ? src.editorLatin : SETTINGS_DEFAULTS.editorLatin,
    fontSize: Number.isFinite(size) ? Math.max(FONT_SIZE_MIN, Math.min(FONT_SIZE_MAX, Math.round(size))) : SETTINGS_DEFAULTS.fontSize,
    topbarAutoHide: src.topbarAutoHide === true
  }
}

/* 外观历史栈（总稿 model.mjs:32/35）：checkpoint 入栈、undo 弹栈。
   入栈与出栈都做纯数据克隆——快照若与 store 共享引用，撤销会把改后的对象还回去。
   超过 limit 丢最旧：撤销窗口固定为最近 limit 步。 */
export function createSettingsHistory({ limit = SETTINGS_HISTORY_LIMIT } = {}) {
  const depth = Number.isFinite(Number(limit)) && Number(limit) > 0 ? Math.floor(Number(limit)) : SETTINGS_HISTORY_LIMIT
  const stack = []
  const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)))
  return {
    checkpoint(snapshot) {
      stack.push(clone(snapshot))
      while (stack.length > depth) stack.shift()
      return stack.length
    },
    undo() {
      const previous = stack.pop()
      return previous === undefined ? false : clone(previous)
    },
    size() {
      return stack.length
    },
    clear() {
      stack.length = 0
    }
  }
}

/* 恢复默认外观只动这四个键，作品数据与正文不受影响 */
export function resetAppearancePrefs() {
  return { ...SETTINGS_DEFAULTS }
}
