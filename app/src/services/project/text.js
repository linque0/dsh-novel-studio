// Shared, dependency-free text coordinates. Do not evaluate project material.
export function hashContent(str = '') {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16)
}
export function stableStringify(value) {
  if (Array.isArray(value)) return '[' + value.map((v) => stableStringify(v) ?? 'null').join(',') + ']'
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().filter((k) => value[k] !== undefined).map((k) => JSON.stringify(k) + ':' + stableStringify(value[k])).join(',') + '}'
  return JSON.stringify(value)
}
export const rowHash = (row) => hashContent(stableStringify(row && Object.fromEntries(Object.entries(row).filter(([k]) => !['updatedAt', 'createdAt', 'blob'].includes(k)))))
export const chapterHash = (ch) => hashContent(JSON.stringify([ch?.title, ch?.fmt, ch?.content, !!ch?.deletedAt]))
export function tokens(text = '') {
  let count = 0
  for (const ch of String(text)) count += ch.codePointAt(0) > 0x2e7f ? 1 : 0.25
  return Math.ceil(count)
}
const entities = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
export function normalizeText(value = '', format) {
  let text = String(value ?? '')
  // Explicit plain text can contain angle brackets; never interpret those as HTML.
  if (format === 'html' || (format !== 'text' && /<\/?(?:p|div|span|h[1-6]|li|ul|ol|br|blockquote|table|strong|em|a)(?:\s[^>]*|\s*\/?)>/i.test(text))) {
    text = text.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
      .replace(/<\/?(?:p|div|h[1-6]|li|tr|blockquote|ul|ol|table|br|hr)\b[^>]*>/gi, '\n')
      .replace(/<[^>]*>/g, '')
      .replace(/&(#x[\da-f]+|#\d+|nbsp|amp|lt|gt|quot|apos);/gi, (all, key) => {
        if (key[0] !== '#') return entities[key.toLowerCase()] ?? all
        const n = key[1]?.toLowerCase() === 'x' ? parseInt(key.slice(2), 16) : Number(key.slice(1))
        return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : all
      })
  }
  return text.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}
export const plainChapter = (ch) => normalizeText(ch?.content || '', ch?.fmt)
export const checkAbort = (signal) => { if (signal?.aborted) throw new DOMException('已取消', 'AbortError') }
export const sourceChanged = () => Object.assign(new Error('作品来源已变化，请重新读取'), { code: 'source-changed' })
