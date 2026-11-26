/* 编译期全局 UI/UX 字体缩放 PostCSS 插件（零外部依赖）：
 * 将全站静态 px 字号转为 `calc(Npx * var(--ui-font-scale, 1))`，
 * 同时豁免正文编辑区（由 --editor-fs 独立控制）与大纲画布世界空间卡片（由卡片排版引擎独立控制）。
 * 当 --ui-font-scale 为默认 1 时与原始像素完全一致，零视觉回归。 */

const SKIP_SELECTOR_RE =
  /(?:^|[\s,>+~(])(?:\.ProseMirror|\.rich-inner|\.rich-host|\.preview-copy|\.writing-paper-sample|\.ed-read-title|\.ed-read-no|\.title-input|\.crimson-chapter-title|\.crimson-page-head|\.crimson-folio|\.oc-fit-|\.oc-event-|\.draft-card-|\.oc-mini(?![a-z-])|\.oc-mini-(?:title|body|top|actions|kind|state|content|fitted|event|container|inline|edit|inplace|ghost)|\.oc-ctitle|\.oc-csummary|\.oc-elabel|\.oc-junc-label|\.oc-container(?![a-z-])|\.oc-node(?![a-z-]))/

const ROOT_ONLY_RE = /^(?:html|:root)(?:\s*,\s*(?:html|:root))*$/i
const DYNAMIC_RE = /\b(?:var|calc|clamp|min|max)\s*\(/i
const STATIC_PX_RE = /^(\d+(?:\.\d+)?)px$/i
const FONT_SHORTHAND_PX_RE = /(^|\s)(\d+(?:\.\d+)?)px(?:\s*\/\s*(\d+(?:\.\d+)?)px)?(?=\s|\/|$)/i

export function shouldSkipSelector(selector = '') {
  const s = String(selector || '').trim()
  if (!s) return true
  if (ROOT_ONLY_RE.test(s)) return true
  return SKIP_SELECTOR_RE.test(s)
}

export function scalePxValue(value) {
  const v = String(value || '').trim()
  if (!v || DYNAMIC_RE.test(v)) return null
  const m = v.match(STATIC_PX_RE)
  if (!m) return null
  const num = parseFloat(m[1])
  if (!Number.isFinite(num) || num <= 0) return null
  return `calc(${m[1]}px * var(--ui-font-scale, 1))`
}

export function scaleFontShorthand(value) {
  const v = String(value || '').trim()
  if (!v || /--ui-font-scale/i.test(v)) return null
  const m = v.match(FONT_SHORTHAND_PX_RE)
  if (!m) return null
  /* 若匹配到的 px 位于 calc()/clamp()/var() 内部则跳过；仅字体族含 var(--serif) 不应阻断字号缩放 */
  const before = v.slice(0, m.index)
  if (/(?:calc|clamp|min|max|var)\s*\([^)]*$/i.test(before)) return null
  const sz = parseFloat(m[2])
  if (!Number.isFinite(sz) || sz <= 0) return null
  const scaledSize = `calc(${m[2]}px * var(--ui-font-scale, 1))`
  const replacement = m[3]
    ? `${m[1]}${scaledSize}/calc(${m[3]}px * var(--ui-font-scale, 1))`
    : `${m[1]}${scaledSize}`
  return before + replacement + v.slice(m.index + m[0].length)
}

export default function postcssUiFontScale() {
  return {
    postcssPlugin: 'postcss-ui-font-scale',
    Rule(rule) {
      if (!rule.selector || shouldSkipSelector(rule.selector)) return
      let scaledFont = false
      const lineHeights = []
      rule.walkDecls((decl) => {
        const prop = decl.prop?.toLowerCase()
        if (prop === 'font-size') {
          const next = scalePxValue(decl.value)
          if (next) {
            decl.value = next
            scaledFont = true
          }
        } else if (prop === 'font') {
          const next = scaleFontShorthand(decl.value)
          if (next) {
            decl.value = next
            scaledFont = true
          }
        } else if (prop === 'line-height') {
          lineHeights.push(decl)
        }
      })
      if (scaledFont && lineHeights.length) {
        for (const decl of lineHeights) {
          const next = scalePxValue(decl.value)
          if (next) decl.value = next
        }
      }
    }
  }
}
postcssUiFontScale.postcss = true
