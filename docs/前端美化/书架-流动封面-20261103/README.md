# 书架 · 流动封面（设计稿副本）

这份稿子从 `novel-studio` 复制过来，内容与主仓一致，直接双击 `index.html` 就能看。

- 源：`novel-studio/docs/前端美化/书架-流动封面-20261103/`
- 背景：移植自 Paper Design 的 `MeshGradient` + `Dithering`（MIT，见 `THIRD-PARTY-NOTICES.md`）
- 顶栏：书架 / 正文 / 大纲 / 设定 / 人物 / 灵感（对齐 `src/components/app-navigation.js` 的 `APP_NAVIGATION`）

## 文件

| 文件 | 说明 |
|---|---|
| `index.html` | 单文件稿（模块已内联，file:// 可直接打开） |
| `latent-gl.js` | WebGL2 渲染器（可原样接进插件前端） |
| `blue-noise.js` | 64×64 蓝噪声（base64） |
| `screenshots/` | 10 张状态图 |
| `tools/` | 生成蓝噪声 / 内联构建 / CDP 取证 |
| `report.json` | 最近一次取证结果 |
| `设计与验收.md` / `动效时序表.md` | 设计与动效说明 |

## 复跑

在本插件仓根目录执行（脚本按 `docs/前端美化/书架-流动封面-20261103/` 定位，路径与主仓一致）：

```bash
node docs/前端美化/书架-流动封面-20261103/tools/gen-blue-noise.mjs
node docs/前端美化/书架-流动封面-20261103/tools/build-folia-page.mjs
node docs/前端美化/书架-流动封面-20261103/tools/folia-design-capture.mjs
```

## 体积提醒

`screenshots/` 约 19MB。插件 `package.json` 的 `files` 里包含 `docs`，如果不想让它随包发布，
把这份目录移出 `docs`（例如放到仓库根的 `design/`）或在 `files` 里排除。
