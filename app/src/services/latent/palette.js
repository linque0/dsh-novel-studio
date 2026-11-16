/* 新作品的随机 ID 作为配色种子，已有作品也能稳定获得新配色。 */

import { colorAtTone } from './flow-color-stops.js'

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

// 每组为主色、强调色和带色相的暗部。
const COVER_PALETTES = [
  [[59, 88, 138], [118, 174, 215], [33, 48, 84]],  // 靛蓝、晴蓝、墨蓝
  [[64, 84, 125], [218, 164, 91], [38, 42, 73]],  // 海军蓝、琥珀、蓝墨
  [[58, 97, 82], [110, 184, 130], [34, 60, 51]],  // 松绿、春苔、墨绿
  [[48, 98, 109], [92, 191, 173], [31, 57, 67]],  // 深海蓝、海玻璃绿、深青
  [[119, 69, 82], [219, 143, 132], [75, 37, 55]],  // 莓红、珊瑚、酒红
  [[93, 75, 133], [176, 151, 220], [54, 41, 83]],  // 鸢尾紫、浅藤、墨紫
  [[85, 81, 126], [208, 169, 112], [47, 48, 81]],  // 暮蓝、蜜砂、蓝紫
  [[116, 76, 63], [223, 155, 110], [67, 43, 47]],  // 红陶、杏橙、紫棕
  [[83, 91, 54], [183, 183, 103], [50, 55, 42]],  // 橄榄、金苔、深灰绿
  [[57, 88, 115], [211, 142, 180], [36, 49, 75]],  // 岩蓝、烟玫瑰、深靛
  [[102, 80, 66], [108, 189, 193], [58, 44, 55]],  // 暖棕、水青、深梅
  [[108, 72, 104], [216, 148, 173], [63, 38, 70]]  // 桑葚、胭脂粉、深紫
]

const rgbHex = rgb => '#' + rgb.map(channel => Math.round(channel * 255).toString(16).padStart(2, '0')).join('')

export function paletteOf(work) {
  const seed = hashString(work?.id)
  const [base, accent, shadow] = COVER_PALETTES[seed % COVER_PALETTES.length]
  // 同组作品小幅变化色度，三档明度和色相关系保持一致。
  const baseGain = 1.08 + (seed >>> 8 & 255) / 255 * 0.16
  const accentGain = 1.12 + (seed >>> 16 & 255) / 255 * 0.18
  const a = colorAtTone(base.map(channel => channel / 255), 0.48, 0.12, baseGain)
  const b = colorAtTone(accent.map(channel => channel / 255), 0.74, 0.16, accentGain)
  const c = colorAtTone(shadow.map(channel => channel / 255), 0.31, 0.07, baseGain)
  return { a, b, c }
}

export function accentOf(work) {
  return rgbHex(paletteOf(work).b)
}

export function cssGradientOf(work) {
  const { a, b, c } = paletteOf(work)
  return `linear-gradient(150deg, ${rgbHex(a)} 0%, ${rgbHex(a)} 27%, ${rgbHex(b)} 47%, ${rgbHex(c)} 80%)`
}

export const DEFAULT_FLOW_PALETTE = { a: [0.18, 0.22, 0.5], b: [0.85, 0.4, 0.35], c: [0.06, 0.07, 0.16] }
