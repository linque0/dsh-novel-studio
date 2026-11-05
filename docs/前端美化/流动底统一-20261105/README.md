# 流动底统一（2026-11-05）

书架那层流动底（WebGL MeshGradient + Dithering，取不到就退 CPU 逐像素底）原本只属于书架。
这次把它上提成**全仓唯一一份背板引擎**，铺到其余五个功能页与拆窗面板，并把这几页的面板改成半透明玻璃。

## 一、范围

- 引擎：`app/src/services/latent/flow.js` 的 `mountFlowBackdrop`，书架 / 正文 / 大纲 / 设定 / 人物 / 灵感 / 拆窗面板共用。
- 主窗口五页：正文（chapters）、大纲（outline）、设定（lore）、人物（characters）、灵感（snippets）——
  外壳 `.workbench-shell[data-flow="on"]`，背景层 `.st-backdrop-wrap > canvas.st-backdrop` + 三层 `.st-layer`。
- 拆窗面板：`PanelHost` 外壳 `.panel-host[data-flow="on"]`，背景层与主窗口同构。
- 书架不进本次改动：`.latent-shelf .ls-backdrop` / `.ls-backdrop-wrap` 与 `latent-shelf.css` 的命名和样式一字不变，
  只是内部挂载从直连 latent-gl 换成 flow.js。

## 二、七条决策

**D1 · 正文页也换引擎，`ink / lamp / ridge` 三档撤掉。**
原来正文页有一套独立背板（`studio-gl.js`，三档配色靠 `?bg=` 记忆）。两套并行意味着色板、降级路径、统计钩子各写一遍，
且 `?bg=` 是 URL 记忆，用户实际只用得上其中一档。理由是一次实现一处退化，不是省代码行数。

**D2 · 主窗口五页 + 拆窗面板全部铺。**
切页背板消失或换色，会让同一次编辑视线上断掉；拆窗面板是对照阅读的第二屏，缺底就是两块不同的界面。

**D3 · 半透明玻璃：侧栏/批注栏 62%、主区 52%。**
`color-mix(in srgb, var(--ns-layer-1, #232324) <比例>, transparent)` + `border-radius: 20px` + `backdrop-filter: blur(20px) saturate(1.5)`。
alpha 再高流动底看不见，再低字压不住底光；62/52 是「底能透上来」与「字读得清」的交点，验收按 `alpha <= 0.75 且含 blur` 判。

**D4 · 调色跟随作品，不跟随页面。**
`paletteOf(work)`（`palette.js:46`）+ `seed = (hashString(work.id) % 997) / 997` + `duration: 600ms`；
无作品时用引擎默认色（`latent-gl.js:299` 的 `DEFAULT_PALETTE`）。同一本书在书架和正文页必须同装，换作品时色一次化开而不是闪一下。

**D5 · 大纲纸卡不动。**
纸卡（`.oc-node`）本身就是这个模块的主体，纸卡也半透明会把结构图糊成一片。让位的只有「底」这一层
（`.center-pane / .om-wrap / .oc-canvas` 背景转透明），纸卡的浅色与描边保持现状——验收也据此不对 `.oc-node` 判玻璃。

**D6 · 保留打字涟漪。**
正文页输入时 `pulse()` 推一下底，是「底在跟着写」的反馈。换引擎不该丢掉已经认下的动效。

**D7 · 稿纸 46%。**
稿纸仍是排版主体：`color-mix(in srgb, var(--ls-paper) 46%, transparent)` 再叠 26px 磨砂，让背板只作为氛围透上来，
字与底之间始终隔一层（`latent-studio.css` 稿纸一节）。

## 三、退化路径

| 情形 | 行为 |
|---|---|
| 取不到 WebGL / 着色器失败 | 引擎回落 CPU 逐像素底（同色板、同几何），`stats().backend = 'cpu'` |
| `webglcontextlost` | 走 `onFallback('context-lost')`：**先换一张新画布**（碰过 WebGL 的画布取不回 2D 上下文）再接 CPU 底 |
| `prefers-reduced-motion: reduce` | 传 `reducedMotion: true`，底停在静帧，不跑 rAF 动画 |
| 壳层卸载 / 切页 | `dispose()` 释放上下文；重挂时由引擎换新画布，不复用旧的那张 |

## 四、验收

判据都在 `scripts/verify-app.mjs`，新增场景 = 四个模块 × 三档（1280 / 760 / 380）+ 一条拆窗面板（`panel-outline` @760）：

| 判据 | 判什么 |
|---|---|
| `流动底铺满视口` | `.workbench-shell`/`.panel-host` 下的 `canvas.st-backdrop` 与视口同尺寸、贴左上（缺 `.latent-studio` 祖先也成立） |
| `流动底后端与像素` | `__nsFlowBackdrop()`（缺则退 `__nsStudioBackdrop`）的 `backend ∈ {gpu, cpu}`；gpu 要求 `pixels[0] > 0` |
| `玻璃可透底（侧栏 / 主区）` | `.side-panel` 与 `.center-pane` 的计算背景色 `alpha <= 0.75` 且 `backdrop-filter` 含 `blur` |
| `正文对比度>=4.5` | 正文区合成背景（含玻璃与兜底 #151517）对正文色的 WCAG 比值 |
| 既有 `浅色大块背景(>8%视口)=0` / `scrollWidth<=clientWidth` | 新增场景同样生效（`measure()` 对所有非书架场景统一判） |

```bash
node --check scripts/verify-app.mjs          # 先过语法
npm run build:app                            # 产物写 assets/app
npm run verify:app                           # 全场景
NS_VERIFY_RUN=outline-760 npm run verify:app # 只跑一个场景（module-width）
```

> 本次只交脚本与文档，构建与验收由主会话统一跑（避免并发写 `assets/app`）。
