# 大纲 · 三版探索

2026-11-04。已确认方案的首屏展示稿，统一以自由画布为主体，等待选定后再接入产品。

## 查看

直接双击 **style-explorer.html**，离线比较三版。点击画面进入单张模式，选择「实际尺寸 100%」查看；该对比页已内嵌三份页面、纸面图、背景与字体，可独立携带。

- **A · 全景脉络**：`a-panorama.html`。画布最大、结构窄轨、选中事件右侧详情，优先推荐。
- **B · 编排工作台**：`b-workbench.html`。220px 结构树 + 814px 主区 + 318px 详情，适合连续查找和修改。
- **C · 分卷长镜**：`c-volumes.html`。三个容器横向展开、内部自由排布、跨卷关系与底部位置总览。

独立 HTML 共用 `assets/`，移动时需一起携带。原尺寸截图位于 `screenshots/`，每版 1440×900；`comparison.png` 是对比页的 1440×560 截图。

## 设计约束

- 书架原有六项导航、胶囊选中态、Noto Serif SC 标题、暗色玻璃与细颗粒外观延续。
- 背景由现有书架渲染器使用《长夜将明》配色冻结于 time=0，三版共用同一张 WebP。GPU 渲染尺寸 1600×1000，浏览器捕获视口 1440×900。这里不新增或修改流动背景引擎。
- 玻璃用于外围面板；事件、便签、引用、章节卡沿用项目已有不透明纸面素材。标题保持宋体，操作和正文使用 Microsoft YaHei / 系统无衬线字体。
- 三版统一展示 6 个事件、3 个辅助节点、3 个容器和 9 条关系；数据源是 `content.json`，小说情节、作者与章节文字均为展示用虚构内容。
- C 的分卷是现有容器语义的视觉编排，未增加卷字段、看板状态或强制小说结构。
- 图中「已保存」与工具控件是设计状态。候选页为静态展示，不连接真实作品，不实现保存、拖拽、连线与文本切换。对比页的查看、选择与缩放由对比工具提供。

## 验证

`report.json` 记录每版的视口、节点与关系数、字体加载、出屏、节点与工具栏遮挡、无关节点被关系线穿过、关系标签压卡片、浏览器错误。

交付前逐版打开截图检查。卡片是摘要展示，短卡允许截取摘要；详情面板展示完整选中事件。只检查固定桌面首屏，未承诺完整响应式，也未做生产功能测试或独立评审。

## 复现

在仓库根目录依次运行：

```powershell
node "docs/前端美化/大纲-三版探索-20261104/tools/build.mjs"
python "docs/前端美化/大纲-三版探索-20261104/tools/fonts.py"
python "C:/Users/linque/.agents/skills/oil-ui/scripts/build_explorer.py" "docs/前端美化/大纲-三版探索-20261104/manifest.json" --force
node "docs/前端美化/大纲-三版探索-20261104/tools/capture.mjs"
```

字体子集工具需要 Python fontTools 与 Brotli。`build.mjs` 会重写三份候选，之后必须运行 `fonts.py`。`assets/` 已随稿保留，通常无需重新提取。重新提取背景运行 `capture.mjs --background`；捕获工具使用独立无头 Chrome 和仓库 `.tmp/outline-design-browser` 配置，不读取用户的 Chrome 资料。

首次重建空目录时，把项目 `app/src/assets/outline-paper/` 中的 event、note、cite、anchor 四张 WebP 复制至本目录 `assets/`。

## 素材说明

- 背景派生自项目已有 Paper Design MeshGradient + Dithering 实现，MIT，详见相邻书架稿的 `THIRD-PARTY-NOTICES.md`。
- Noto Serif SC 字体子集派生自 `app/src/assets/fonts/` 已有文件，其源文件声明为 SIL OFL-1.1；字形无改动，仅缩减字符范围。
- 纸面图沿用项目现有界面素材，仅用于本稿界面；没有新增网络素材、外部依赖或 AI 生成图片。

生产组件、业务逻辑、公共 API、数据模型、构建产物均未修改。
