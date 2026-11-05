export const countWords = (s = '') => s.replace(/\s/g, '').length

/** 千分位数字（字数 / 目标等展示用，如 128,530） */
export const fmtNum = (n) => Number(n || 0).toLocaleString('zh-CN')

/** 去除 HTML 标签并解码常见实体，用于字数统计 / 检索 / 出场人物匹配。
 * 块级标签 → 换行（保持段落分隔），行内标签（含关系链接/批注 span）→ 直接剥除不插空格——
 * 此前一律插空格，会把被行内标记拆开的词打断（如「<span>林</span>远」→「 林 远 」，
 * 出场人物/检索匹配失配；v1.0.22 修复）。字数统计不受影响（countWords 去所有空白）。 */
const BLOCK_OPEN = /<(?:p|div|h[1-6]|li|tr|blockquote|ul|ol|table|br|hr)(?:\s[^>]*)?>/gi
const BLOCK_CLOSE = /<\/(?:p|div|h[1-6]|li|tr|blockquote|ul|ol|table)>/gi
export const stripTags = (html = '') =>
  html
    .replace(/<style[\s\S]*?<\/style>/gi, '\n')
    .replace(BLOCK_OPEN, '\n')
    .replace(BLOCK_CLOSE, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
