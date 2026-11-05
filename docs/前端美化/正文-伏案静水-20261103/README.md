# 正文 · 伏案 · 静水（设计稿）

小说工坊插件版**正文界面**的重设计稿。美术语言与 `../书架-流动封面-20261103/` 同一支手；背景与动效是为写作环境**新设计**的一套（`ink` 静水 / `lamp` 灯下 / `ridge` 远山）。

双击 `index.html` 即可看（file://、无外链、无网络）。`compare.html` 是它与书架母本的并排一致度页。

## 文件

| 文件 | 说明 |
|---|---|
| `index.html` | 单文件稿（渲染器与蓝噪声已内联，构建产物，别手改） |
| `studio-gl.js` | 背板渲染器：三支流体层 + 蓝噪声量化 + 打字涟漪 + 自适应分辨率 |
| `blue-noise.js` | 64×64 蓝噪声，与书架稿逐字节相同 |
| `anchors.json` | 69 项锚点契约（`{id,selector,scene,note}`），取证脚本按它断言 |
| `compare.html` | 书架母本 / 本稿 并排对比页 |
| `parts/` | 分件源（`style.1/2/3.css`、`markup.html`、`content.js`、`app.1-render.js`、`app.2-ui.js`、`assemble.mjs`、`SPEC.md`） |
| `tools/` | `build-page.mjs`（内联）· `capture.mjs`（CDP 取证） |
| `screenshots/` `frames/` | 14 张状态图 + 7 帧动效带 |
| `report.json` | 最近一次取证 |
| `设计与验收.md` / `动效时序表.md` / `接入说明.md` | 设计、动效、落地 |

## 改稿与复跑

改分件（不要改 `index.html`），三行命令重建并取证：

```bash
node docs/前端美化/正文-伏案静水-20261103/parts/assemble.mjs      # 分件 → index.html
node docs/前端美化/正文-伏案静水-20261103/tools/build-page.mjs    # 内联渲染器（可反复跑）
node docs/前端美化/正文-伏案静水-20261103/tools/capture.mjs       # 14 张图 + 7 帧 + report.json
```

`assemble.mjs --check` 只校验不落盘（锚点覆盖、外链、标记位数量）。

## URL 参数（看状态用）

`?bg=ink|lamp|ridge` 换背景 · `?scene=writing|notes|menu|formats|ctx|search|history` 开对应浮层 · `?mode=focus|read` 沉浸/阅读 · `?gpu=0` 强制 CSS 兜底。

## 体积提醒

`screenshots/` 约 13 MB、`frames/` 约 1.3 MB。插件 `package.json` 的 `files` 含 `docs`，不想随包发布就在 `files` 里排除 `docs/前端美化`。
