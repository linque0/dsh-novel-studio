// tools/build-page.mjs — 把 blue-noise.js 与 studio-gl.js 内联进 index.html 的标记位，
// 让设计稿保持"双击就能开"的单文件（file:// 下 ESM 会被 CORS 拦）。
// 用法：node tools/build-page.mjs [index.html 路径]
// 可反复运行：每次整块重写 <script id="ns-inline"> 的内容，上一次的内联全部被覆盖。

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pagePath = process.argv[2] ? path.resolve(process.argv[2]) : path.join(DIR, 'index.html')

if (!existsSync(pagePath)) {
  console.error('找不到设计稿：' + pagePath)
  console.error('本脚本只往已有的 index.html 里填内联，不生成页面。先把 index.html 放进 ' + DIR + ' 再运行。')
  process.exit(1)
}

const START = '/* ==== inline:begin ==== */'
const END = '/* ==== inline:end ==== */'

// 行首 export（允许缩进）：内联后是普通脚本，export 会让整段语法报错
const stripExports = source => source.replace(/^[ \t]*export\s+/gm, '').trimEnd()

const noise = stripExports(readFileSync(path.join(DIR, 'blue-noise.js'), 'utf8'))
const studio = stripExports(readFileSync(path.join(DIR, 'studio-gl.js'), 'utf8'))
const payload = [START, noise, studio, END].join('\n')

// 内联后整段落在 <script> 里，源码里出现 </script> 会当场把标签闭合掉
if (payload.includes('</script>')) {
  console.error('内联内容里出现了 </script>，会被 HTML 解析器当成标签闭合：请改掉这个字面量再构建。')
  process.exit(1)
}

const page = readFileSync(pagePath, 'utf8')
const slot = /(<script\b[^>]*\bid=["']ns-inline["'][^>]*>)([\s\S]*?)(<\/script>)/i
if (!slot.test(page)) {
  console.error('index.html 里找不到标记位：<script id="ns-inline">/* ==== inline:begin ==== */ /* ==== inline:end ==== */</script>')
  process.exit(1)
}

const next = page.replace(slot, (_all, open, _body, close) => open + '\n' + payload + '\n' + close)
writeFileSync(pagePath, next)

console.log(JSON.stringify({
  page: pagePath,
  noiseBytes: Buffer.byteLength(noise),
  studioBytes: Buffer.byteLength(studio),
  pageBytes: Buffer.byteLength(next)
}))
