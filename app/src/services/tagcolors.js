/**
 * services/tagcolors.js — 标签卡片配色（设定节点标签等）
 *
 * 颜色由标签名稳定 hash 映射固定色板：同名恒同色、无需用户配置；
 * 色板与大纲自定义类型（olTypes）/ 批注用途色同套，保证全站视觉一致。
 */
export const TAG_PALETTE = ['#c0392b', '#2980b9', '#27ae60', '#8e44ad', '#d35400', '#16a085', '#b8860b']

/** 标签名 → 颜色（FNV-1a hash，同名稳定且短中文串分布分散） */
export function tagColor(name) {
  const s = String(name || '')
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619) >>> 0
  }
  return TAG_PALETTE[h % TAG_PALETTE.length]
}
