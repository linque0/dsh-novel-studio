// parts/assemble.mjs — 把分件拼成单文件设计稿 index.html。
// 用法：node docs/前端美化/正文-伏案静水-20261103/parts/assemble.mjs [--check]
//   parts/style.1-base.css, style.2-panels.css, style.3-modes.css … 按名排序拼进 <style>
//   parts/markup.html      DOM（只允许 #app 内部结构，不含 html/head/body/script）
//   parts/content.js       window.NS_CONTENT 数据
//   parts/app.1-render.js, app.*.js … 按名排序拼进唯一一个 <script id="ns-app">
// studio-gl.js 与 blue-noise.js 由 tools/build-page.mjs 再填进 ns-inline 标记位。

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const PARTS = path.dirname(fileURLToPath(import.meta.url))
const DIR = path.dirname(PARTS)
const PAGE = path.join(DIR, 'index.html')
const check = process.argv.includes('--check')

const list = (re) => readdirSync(PARTS).filter((f) => re.test(f)).sort()
const read = (f) => readFileSync(path.join(PARTS, f), 'utf8')

const styleFiles = list(/^style(\..+)?\.css$/)
const appFiles = list(/^app(\..+)?\.js$/)
const missing = []
if (!styleFiles.length) missing.push('style*.css')
if (!appFiles.length) missing.push('app*.js')
if (!existsSync(path.join(PARTS, 'markup.html'))) missing.push('markup.html')
if (!existsSync(path.join(PARTS, 'content.js'))) missing.push('content.js')
if (missing.length) {
  console.error('[assemble] 缺少分件：' + missing.join('、'))
  process.exit(1)
}

const css = styleFiles.map(read).join('\n\n')
let markup = read('markup.html')
const content = read('content.js')
const appParts = appFiles.map((f) => '/* ---- ' + f + ' ---- */\n' + read(f))

if (/<\/style/i.test(css)) {
  console.error('[assemble] CSS 分件里出现了 </style>，会截断内联样式表')
  process.exit(1)
}
// markup 里若自带 <script id="ns-app">，抽出来并入 app 段（兼容旧写法）
const inlineApp = markup.match(/<script[^>]*id=["']ns-app["'][^>]*>([\s\S]*?)<\/script>/i)
if (inlineApp) {
  appParts.push('/* ---- markup.html 内联脚本 ---- */\n' + inlineApp[1])
  markup = markup.replace(inlineApp[0], '')
}
if (/<(html|head|body)[\s>]/i.test(markup)) {
  console.error('[assemble] markup.html 里出现了 html/head/body 标签（只允许 #app 与其内部结构）')
  process.exit(1)
}
if (/<script/i.test(markup)) {
  console.error('[assemble] markup.html 里仍有 <script>，脚本请放 parts/app.*.js')
  process.exit(1)
}
if (/<style/i.test(markup)) {
  console.error('[assemble] markup.html 里出现了 <style>，样式请放 parts/style.*.css')
  process.exit(1)
}
if (!/^\s*window\.NS_CONTENT\s*=/.test(content)) {
  console.error('[assemble] content.js 必须以 window.NS_CONTENT = 开头')
  process.exit(1)
}

const app = appParts.join('\n\n')

const page = [
  '<!doctype html>',
  '<html lang="zh-CN" data-bg="ink">',
  '<head>',
  '<meta charset="utf-8">',
  '<meta name="viewport" content="width=device-width, initial-scale=1">',
  '<title>正文 · 伏案 · 设计稿</title>',
  '<link rel="icon" href="data:,">',
  '<style>',
  css.trimEnd(),
  '</style>',
  '</head>',
  '<body>',
  markup.trim(),
  '',
  '<script id="ns-inline">/* ==== inline:begin ==== */ /* ==== inline:end ==== */</script>',
  '<script>',
  content.trimEnd(),
  '</script>',
  '<script id="ns-app">',
  app.trim(),
  '</script>',
  '</body>',
  '</html>',
  ''
].join('\n')

const problems = []
const inlineCount = (page.match(/id="ns-inline"/g) || []).length
if (inlineCount !== 1) problems.push('ns-inline 标记位数量 = ' + inlineCount)
if ((page.match(/inline:begin/g) || []).length !== 1) problems.push('inline:begin 次数异常')
if (page.match(/src="http|href="http|@import/)) problems.push('出现外链')
if (/<link[^>]+stylesheet/i.test(page)) problems.push('出现外部样式表')

// 锚点静态探测：DOM 与 JS 生成两条路径写法不同（"data-anchor=tree-chapter" vs data-anchor="tree-chapter"），
// 所以按「属性名 + 取值」宽松匹配；真正的判定仍以 tools/capture.mjs 在真 Chrome 里 querySelector 为准。
const anchors = JSON.parse(readFileSync(path.join(DIR, 'anchors.json'), 'utf8'))
const probe = (selector) => {
  const spec = selector.split(' ').pop().trim()
  const m = spec.match(/\[([\w-]+)=["']?([^\]"']+)["']?\]/)
  if (m) return page.includes(m[1]) && (page.includes('"' + m[2] + '"') || page.includes("'" + m[2] + "'") || page.includes('=' + m[2]))
  return page.includes(spec)
}
const missingAnchors = anchors.anchors.filter((a) => !probe(a.selector))

const bytes = Buffer.byteLength(page)
const han = (page.match(/[\u4e00-\u9fa5]/g) || []).length
if (!check) writeFileSync(PAGE, page)

console.log(JSON.stringify({
  page: PAGE,
  wrote: !check,
  bytes,
  bytesKB: Math.round((bytes / 1024) * 10) / 10,
  han,
  styleFiles,
  appFiles,
  inlineCount,
  anchorsTotal: anchors.total,
  anchorsMissing: missingAnchors.map((a) => a.id),
  problems
}, null, 2))
if (problems.length || missingAnchors.length) process.exit(check ? 1 : 0)
