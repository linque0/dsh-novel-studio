import { createApp } from 'vue'
import { createPinia } from 'pinia'
import naive from 'naive-ui'
import App from './App.vue'
import './styles/themes.css'
import './styles/chars-shell.css'
import './styles/chars-roster.css'
import './styles/chars-dossier.css'
import './styles/chars-context.css'
import './styles/chars-graph.css'
import './styles/outline-paper.css'
import './styles/outline-workbench.css'
import './assets/fonts/fonts.css'
import './assets/fonts/fonts-user.css'

import { decodeText, splitTxtChapters, splitMarkdown, htmlToMd, parseMubuMd } from './services/importers'
import { countWords } from './services/wordcount'
import { db, uid, now } from './db/database'
import { useWorkStore } from './stores/work'
import * as library from './services/library'

const app = createApp(App)
const pinia = createPinia()
app.use(pinia)
app.use(naive)

/* DSH 插件构建：加载插件专属层并强制 dsh 皮肤（桌面版构建 __NS_PLUGIN__ 为 false，此段被裁掉） */
if (__NS_PLUGIN__) {
  import('./../plugin/dsh/index.js').then(({ installDshSkin }) => installDshSkin(pinia))
}

// 供自动化测试 / 控制台调试使用的钩子
window.__ns = {
  decodeText,
  splitTxtChapters,
  splitMarkdown,
  htmlToMd,
  parseMubuMd,
  countWords,
  db,
  uid,
  now,
  getWork: () => useWorkStore(pinia),
  /* 作品库（M2）：控制台里可直接 window.__ns.library.status() / .migrate() */
  library
}

app.mount('#app')
