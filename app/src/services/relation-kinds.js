/* 关联关系类型预设（条目级「关系链接」）：类型 → 图标 + 默认反向名。
 * 颜色沿用 tagcolors 的 hash 取色（同名恒同色），与标签卡片同一套观感；
 * 预设只服务输入快捷与图标回退——关系类型允许自填任意短语。 */
import { tagColor } from './tagcolors'

export const REL_PRESETS = [
  { label: '位于', reverse: '包含', icon: 'map-pin' },
  { label: '属于', reverse: '拥有', icon: 'tag' },
  { label: '控制', reverse: '被控制', icon: 'landmark' },
  { label: '影响', reverse: '受影响', icon: 'megaphone' },
  { label: '关联', reverse: '', icon: 'link' }
]

export const REL_KIND_LABEL = { mubu: '设定', character: '人物' }

export function relKindLabel(kind) {
  return REL_KIND_LABEL[kind] || '条目'
}

export function relIconFor(label) {
  return (REL_PRESETS.find((p) => p.label === label) || {}).icon || 'link'
}

export function relColor(label) {
  return tagColor(label || '关联')
}
