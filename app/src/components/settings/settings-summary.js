/* 作品库规模摘要（数据页右栏「此设备上的内容」与「写作概览」共用一份口径）。
   字数走 services/wordcount.js 的 countWords，并且与 stores/work.js:351 完全一致：
   fmt==='html' 的正文先 stripTags 再计数——否则标签会被算进字数，
   同一部作品在正文页与设置页会显示两个数字。 */
import { countWords, stripTags } from '../../services/wordcount.js'

const asList = (value) => (Array.isArray(value) ? value : [])
const contentOf = (chapter) => {
  const raw = chapter?.content
  const text = raw == null ? '' : String(raw)
  return chapter?.fmt === 'html' ? stripTags(text) : text
}

export function summarizeLibrary({ works = [], chapters = [], characters = [], lore = [], trash = [] } = {}) {
  const rows = asList(chapters)
  return {
    works: asList(works).length,
    chapters: rows.length,
    words: rows.reduce((sum, chapter) => sum + countWords(contentOf(chapter)), 0),
    characters: asList(characters).length,
    lore: asList(lore).length,
    trash: asList(trash).length
  }
}
