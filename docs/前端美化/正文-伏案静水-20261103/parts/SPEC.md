# 正文设计稿 · 三分件契约（SPEC）

三份分件由三个执行者并行写，仓库根 `F:\deepseek workplace\dsh-novel-studio`：

| 分件 | 文件 | 内容 | 作者 |
|---|---|---|---|
| 样式 | `docs/前端美化/正文-伏案静水-20261103/parts/style.css` | 全部 CSS（不含 HTML/JS） | 样式分件 |
| 结构 | `docs/前端美化/正文-伏案静水-20261103/parts/markup.html` | `#app` 的完整 DOM + 应用 JS（不含 CSS） | 结构分件 |
| 内容 | `docs/前端美化/正文-伏案静水-20261103/parts/content.js` | `window.NS_CONTENT` 数据（中文正文与批注） | 内容分件 |

装配由调度方执行：`parts/assemble.mjs` 把三者拼成 `index.html`（**你们都不要写 index.html**）。

## 1. 装配后 index.html 的骨架

```html
<!doctype html><html lang="zh-CN" data-bg="ink">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>正文 · 伏案 · 设计稿</title><link rel="icon" href="data:,"><style>/* style.css 原文 */</style></head>
<body>
<div id="app" data-scene="writing" data-mode="" data-bg="ink"></div>  <!-- markup.html 的内容放这里 -->
<script id="ns-inline">/* ==== inline:begin ==== */ /* ==== inline:end ==== */</script>
<script>/* content.js 原文（以 window.NS_CONTENT = {...} 开头） */</script>
<script id="ns-app">/* markup.html 里的应用 JS 原样搬到这里 */</script>
</body></html>
```

**结构分件的写法**：`markup.html` 文件里就写
```
<div id="app" data-scene="writing" ...> …全部 DOM… </div>
<script id="ns-app"> …全部应用 JS… </script>
```
装配脚本原样搬进 `<body>`。除这段之外不要写 `<html>/<head>/<body>/<style>`。

## 2. DOM 契约（id / class / data 属性一律照抄，两个分件共用）

```
#app[data-scene=writing|notes|menu|formats|ctx|search|history][data-mode=''|focus|read][data-bg=ink|lamp|ridge]
  .st-backdrop-wrap
    canvas.st-backdrop#st-bg
    .st-layer.dots / .st-layer.vignette / .st-layer.grain
  header.app-topbar
    button.app-topbar-brand[data-anchor=brand]  > .brand-name「小说工坊」 + .brand-latin「LATENT」
    nav.app-topnav > button.app-topnav-item[data-nav=shelf|chapters|outline|lore|characters|snippets|settings]（chapters 带 .is-active）
    .app-topbar-actions
      span.app-topbar-save[data-save-state=saved|saving|dirty][data-anchor=save] > .save-dot + .save-text
      button.st-pill[data-anchor=topbar-search]（内含 svg 放大镜 + 文字「搜索」）
      button.st-pill.st-icon[data-anchor=topbar-more]（文字 ⋯）
  .wb-body
    aside.side-panel[data-anchor=tree]
      .sp-head > .sp-title「卷与章」 + .sp-meta「3 卷 · 12 章」 + button.sp-collapse[data-anchor=dir-collapse]（⟨）
      .sp-list#tree-list        ← JS 渲染（见 §4）
      .sp-foot > button[data-anchor=tree-new]「＋ 新建章」 + button[data-anchor=tree-new-volume]「新建卷」
    button.rail.dir-rail[data-anchor=dir-rail]（竖排文字「章节」）
    main.center-pane
      .ed-head
        h1.ed-title[data-anchor=ed-title]
        .ed-latin（大写拉丁小字）
        .ed-rule
        .ed-goal[data-anchor=ed-goal] > .goal-track > i + .goal-text
      .editor-toolbar[role=toolbar]
        button.tb[data-act=undo|redo|bold|italic|underline|strike|paragraph|h1|h2|h3|font-size|color|highlight|link|more-formats|bookmark|send]
      .paper#paper > .rich-inner > .tiptap#tiptap[contenteditable=true]
    aside.rp-panel#rp-panel
      .rp-head > .rp-title「批注与资料」 + button[data-anchor=notes-collapse]
      .rp-scroll
        .rp-group > .rp-group-title「本章批注」 + #notes-list（JS 渲染，[data-anchor=notes-list]）
        textarea.rp-input[data-anchor=notes-input][data-anchor 只一处，用 id=notes-input + data-anchor=notes-input]
        .rp-quick[data-anchor=notes-quick]（本章要点速记，contenteditable=false 的静态文本 + 计数）
        .rp-group > .rp-group-title「素材」 + ul#asset-list > li[data-anchor=notes-asset]… + button[data-anchor=notes-upload]「＋ 上传」
    button.rail.rp-rail[data-anchor=notes-rail]（竖排「批注栏」）
    .st-pop#pop-menu（⋯ 菜单） > button[data-menu=split] / [data-menu=bookmark] / [data-menu=dir] / [data-menu=focus] / [data-menu=read] / [data-menu=settings]
    .st-pop#pop-formats > button[data-fmt=left|center|right|justify|ul|ol|quote|clear]
    .st-pop#pop-ctx[data-anchor=ctx-menu]（右键菜单：剪切/复制/粘贴/加粗/斜体/插入双链/查词）
    .st-pop#pop-search[data-anchor=search-panel] > input[data-anchor=search-input] + .sr-list（三条示例结果）
    .st-pop#pop-history[data-anchor=history-panel] > .hi-list > .hi-row[data-anchor=history-row]×3，每行含 button[data-anchor=history-restore]
    .st-pop.st-drawer#drawer-dir（窄栏章节抽屉）
    .st-pop.st-drawer#drawer-notes（窄栏批注抽屉）
    .st-scrim#scrim
    .focus-chip#focus-chip（竖排「Esc 退出沉浸」）
```

**必须存在的 69 项锚点**：见同目录 `anchors.json`（`{id,selector,scene}`）。其中 `scene=writing` 的锚点必须在默认 DOM 里就存在（哪怕被 `.is-hidden` 藏起来），`scene=menu/formats/ctx/search/history` 的锚点可以在对应浮层里（浮层默认 `hidden`，切 scene 时显示）。

## 3. 场景与模式（结构分件的应用 JS 负责）

- URL `?scene=notes|menu|formats|ctx|search|history` → 设置 `#app[data-scene]`；`writing` 为默认。浮层对应显示（菜单贴 ⋯ 下方、更多格式贴按钮下方、右键菜单在稿纸中央偏上、搜索与历史为居中面板）。
- URL `?mode=focus|read` → `#app[data-mode]`。
- URL `?bg=ink|lamp|ridge` → `#app[data-bg]` 与 `<html data-bg>`，并调 `api.setMode(bg)`。
- URL `?gpu=0` → 传给渲染器。
- Esc：关闭所有浮层与抽屉（回到 writing）。
- 点 ⋯ → scene=menu；点更多格式 → scene=formats；右键稿纸 → scene=ctx；Ctrl+Shift+F 或点搜索 → scene=search；菜单里「章节历史」→ scene=history；菜单里「收起目录栏」→ `#app` 加 `.is-dir-collapsed`；「沉浸写作」→ data-mode=focus；「阅读模式」→ data-mode=read。

## 4. 内容契约（`parts/content.js`，全局变量）

```js
window.NS_CONTENT = {
  work: { title: '雾港纪年', author: '沈砚青', volumes: 3, chapters: 12 },
  goal: 3000,
  chapters: [   // 恰好 12 条，按卷顺序
    { id:'c1', volume:1, title:'第一章 · 盐场夜话', words: 2830, state:'done', latin:'CHAPTER ONE', text:'…（≥700 汉字，段落用 \n\n 分隔）' },
    { id:'c2', volume:1, title:'第二章 · 灯船', words: 3120, state:'done', latin:'CHAPTER TWO', text:'…（≥700 汉字）' },
    { id:'c3', volume:1, title:'第三章 · 咸水里的钟', words: 1436, state:'writing', latin:'CHAPTER THREE', text:'…（≥1400 汉字）' },
    // c4..c12：没有 text 字段，只有 title/words/state
  ],
  currentId: 'c3',
  notes: [ { id:'n1', chapterId:'c3', quote:'…正文原句…', text:'…批注…', time:'19:02' } /* 恰好 4 条 */ ],
  assets: [ { id:'a1', title:'雾港地图（手绘）', meta:'PNG · 2.4 MB' } /* 恰好 3 条 */ ],
  history: [ { id:'h1', time:'今天 18:41', words: 1388, diff:'把第三章的钟声改成从水底传来' } /* 恰好 3 条，最新在前 */ ],
  copy: { emptyChapter:'本章还没有正文。写下第一句，故事就开始了。', focusHint:'沉浸写作 · Esc 退出', readHint:'阅读模式' }
}
```

**数字自洽**：`chapters[*].words` 之和 = 作品总字数（结构分件在 `.sp-meta` 与眉标处显示）；`currentId` 章的 `words` 必须等于其 `text` 去掉空白后的汉字数 ±2%（结构分件按 `text` 实时统计并以统计值为准，显示时两者一致即可）；`.ed-goal` 进度 = 该章字数 / `goal`。

## 5. 视觉与度量（样式分件按此写，别分件不碰 CSS）

- 尺寸档：顶栏 **≥900 → 64px / 561–899 → 52px / ≤560 → 44px**；≥1180 章节栏 **252px** + 稿纸 + 批注栏 **280px**，列距 16、外壳左右 16；900–1179 章节栏 168、批注改抽屉；560–899 两栏；≤560 稿纸满幅（padding 24px）、章节栏收成 20px 竖排细轨 + 抽屉。
- `.editor-toolbar` 高度 **严格 34px**；`.tiptap` 宽度 **≤36em**（`.paper` 用 `width:min(36em, 100% - 96px)`，`.rich-inner` 内 padding 56px 64px）。
- `.paper` **必须同时给出 `background-color: #0f1115` 与 `background-image`（半透明渐变）**：前者供对比度取证，后者供质感。
- 正文宋体 17.5px / 行高 1.95 / 字距 .01em / 首行缩进 2em / 段间距 0 / 色 `#f4efe6`。
- 浮起玻璃三栏：`linear-gradient(145deg, rgb(255 255 255/.14), rgb(255 255 255/.045) 46%, rgb(255 255 255/.10))` + `1px solid rgb(255 255 255/.18)` + `backdrop-filter: blur(18px) saturate(1.5)` + `0 26px 60px rgb(0 0 0/.5), inset 0 1px 0 rgb(255 255 255/.5)`，圆角 22；三栏都满高但不与视口贴边。
- 朱记 `#c0483a` 只允许出现在：当前章竖条、保存点 saving 态、批注引用线。
- 不得有面积 >8% 视口的浅色（亮度 >0.8）块。
