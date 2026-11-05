/* 书封配色只由作品 id 决定：书架允许排序和筛选，颜色若跟着列表下标走，同一本书会换装。 */

export const CLOTH = {
  novel: ['#2f3f8f', '#1d2a63', '#0d1430'],
  note: ['#e7dcc6', '#cdbf9f', '#a99c7d'],
  cedar: ['#356450', '#234437', '#10241d'],
  violet: ['#6d4a8c', '#4a3168', '#241338'],
  claret: ['#8b2c40', '#5f1a2b', '#2c0a12'],
  ink: ['#393b41', '#22242a', '#0d0e11']
}

export const ACCENTS = ['#fd5c47', '#6a48ff', '#3ec6b0', '#e8b04b', '#5ec8ff', '#ff6fa5', '#8fd06a', '#c58bff']

/* FNV-1a 32 位：不依赖数组顺序，跨进程、跨渲染次序都得到同一个数。 */
export function hashString(str) {
  let hash = 0x811c9dc5
  const text = String(str == null ? '' : str)
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

function hexToRgb(hex) {
  const c = String(hex).replace('#', '')
  return [parseInt(c.slice(0, 2), 16), parseInt(c.slice(2, 4), 16), parseInt(c.slice(4, 6), 16)]
}

function mixHex(a, b, t) {
  const A = hexToRgb(a)
  const B = hexToRgb(b)
  const f = (x, y) => Math.round(x + (y - x) * t).toString(16).padStart(2, '0')
  return '#' + f(A[0], B[0]) + f(A[1], B[1]) + f(A[2], B[2])
}

export function clothOf(work) {
  return CLOTH[work && work.kind] || CLOTH.novel
}

/* 设计稿按 BOOKS.indexOf 取档位，真实作品库没有稳定序列表，改用 id 哈希取同一档。 */
export function accentOf(work) {
  return ACCENTS[hashString(work && work.id) % ACCENTS.length]
}

export function paletteOf(work) {
  const cloth = clothOf(work)
  const accent = accentOf(work)
  return {
    a: hexToRgb(mixHex(cloth[0], '#ffffff', 0.30)).map(v => v / 255),
    b: hexToRgb(mixHex(accent, cloth[0], 0.35)).map(v => v / 255),
    c: hexToRgb(mixHex(cloth[1], '#ffffff', 0.06)).map(v => v / 255)
  }
}

/* 无 WebGL 时封面只剩这层布面渐变，色序必须与 paletteOf 的 a/b/c 同源。 */
export function cssGradientOf(work) {
  const cloth = clothOf(work)
  return `linear-gradient(150deg, ${cloth[0]} 0%, ${accentOf(work)} 52%, ${cloth[1]} 100%)`
}
