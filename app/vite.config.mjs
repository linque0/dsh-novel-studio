import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import vue from '@vitejs/plugin-vue'

/* 版本号只有一个真源：仓库根 package.json（app/package.json 是前端工程自己的版本，不是插件版本）。
   手工抄一份必然与发布号漂移，所以构建时现读。 */
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

/* 插件仓库自带的前端工程根：源码在 app/，产物直接落进 assets/app（插件运行时挂载点）。
 * __NS_PLUGIN__ 恒为 true —— 这里的构建只有一条用途：产出 DSH 插件版前端。
 * cssCodeSplit false 把 CSS 并成单文件，由 index.html 直接直引，避免动态 chunk 到达时的 FOUC。 */
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: './',
  plugins: [vue()],
  define: { __NS_PLUGIN__: JSON.stringify(true), __NS_VERSION__: JSON.stringify(version) },
  build: {
    outDir: '../assets/app',
    emptyOutDir: true,
    chunkSizeWarningLimit: 4096,
    cssCodeSplit: false
  }
})
