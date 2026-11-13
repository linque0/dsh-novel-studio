import { Extension } from '@tiptap/core'
import Highlight from '@tiptap/extension-highlight'

/** 字号扩展：在 textStyle 标记上扩展 fontSize 属性（px） */
export const FontSize = Extension.create({
  name: 'fontSize',
  addGlobalAttributes() {
    return [
      {
        types: ['textStyle'],
        attributes: {
          fontSize: {
            default: null,
            parseHTML: (el) => (el.style.fontSize || '').replace(/px$/, '') || null,
            renderHTML: (attrs) => (attrs.fontSize ? { style: `font-size: ${attrs.fontSize}px` } : {})
          }
        }
      }
    ]
  },
  addCommands() {
    return {
      setFontSize:
        (size) =>
        ({ chain }) =>
          chain().setMark('textStyle', { fontSize: size }).run(),
      unsetFontSize:
        () =>
        ({ chain }) =>
          chain().setMark('textStyle', { fontSize: null }).run()
    }
  }
})

/** 多色底色：官方的 multicolor 会把 `color: inherit` 写进内联样式，深色皮肤（隐现）下
 *  浅底配浅字会糊成一片，所以自己接管属性，只写 background-color，文字颜色留给各皮肤 CSS。
 *  已存的纯 <mark>（无 data-color）解析回 null，仍按浏览器默认黄渲染，向后兼容。 */
export const MarkHighlight = Highlight.extend({
  addAttributes() {
    return {
      color: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-color') || el.style.backgroundColor || null,
        renderHTML: (attrs) => (attrs.color ? { 'data-color': attrs.color, style: `background-color: ${attrs.color}` } : {})
      }
    }
  }
})
