# 灵感 · 插件版融合验收（2026-11-07）

按设计稿 [`docs/前端美化/灵感-融合总稿-20261107/`](../../前端美化/灵感-融合总稿-20261107/) 重做插件版灵感页。
插件版**不提供恍然梦与模块助手**（由 DSH 自身取代）：设计稿本来就没有模块助手条，这里也没有渲染，
旧实现里那行隐藏的 `TaskLauncher` 随 `SnippetCenter.vue` 一起删除。

## 界面

| 场景 | 1280 | 760 | 380 |
|---|---|---|---|
| 手札 | [图](screenshots/journal-1280.png) | [图](screenshots/journal-760.png) | [图](screenshots/journal-380.png) |
| 拼板 | [图](screenshots/board-1280.png) | [图](screenshots/board-760.png) | [图](screenshots/board-380.png) |
| 片段详情 | 常驻列（同上手札图右侧） | [图](screenshots/detail-760.png) | [图](screenshots/detail-380.png) |

## 与设计稿逐条对齐的范围

| 设计稿条目 | 落地位置 | 机器判据 |
|---|---|---|
| 手札 ↔ 拼板：顶部开关、方向键、Alt+1/2、各自记滚动、保留筛选与选中 | `SnippetsWorkspace.vue`（`setView` / `snipScroll`） | `切到拼板后按标签分栏`、`Alt+1 回到手札` |
| 记录：手札置顶输入、顶部弹窗、拼板分组加号；首行作标题；Ctrl/⌘+Enter | `SnipJournal.vue` / `SnipDialog.vue`（compose） | `记录一条后条数 +1 且首行成为标题` |
| 查找：标题/正文/标签/关联名；全部/未标记/有关联；单标签；清除；最新/最早/手动 | `snippet-model.js:visibleNotes` + `SnipNav.vue` | `检索只命中目标片段`、`清除筛选按钮出现` |
| 修改：编辑标题正文、显式保存、未提交输入留作草稿（关面板/刷新可续） | `SnipInspector.vue` + `ui.saveSnipDrafts` | `编辑片段进入表单并显示未提交状态`、`保存修改后卡片标题更新` |
| 标签：加已有/新标签、去重、移除；左栏计数与拼板同步 | `work.tagSnippet/untagSnippet` | `加标签后左栏出现计数`、`移除标签后左栏计数消失` |
| 拼板整理：手柄拖动、更多菜单上移/下移；跨组先确认加标签且保留原标签 | `SnipBoard.vue` + `onDrop/move` | `拼板卡片带拖动手柄`、`每栏都有加号入口` |
| 关联：查看目标正文、添加、移除；按 ID 区分，改名后仍在 | `work.linkSnippet` + `doublelinks.targetById/previewFor` | `添加关联后已有关联 +1`、`关联目标可打开正文预览`、`移除关联后回到原值` |
| 转换：选位置、建章节或设定节点、生成关联并打开结果预览；原灵感保留 | `work.snippetToChapter/snippetToMubu` | `转为章节弹出位置选择`、`转换后打开结果预览`、`转换后原灵感保留并多出一条关联` |
| 回收站：删除后可撤销；浏览与恢复；条目保留 ID/标签/关联、隐藏编辑入口 | `work.deleteSnippet/restoreSnippet` | `删除后出现带撤销的提示`、`撤销把同一条灵感移回原处` |
| 保存异常：写入失败保留内容并提供重试 | `ui.autosave.error` + `autosave.flushAll()` | 皮肤层与 `settle` 既有判据 |
| 键盘与窗口：Esc 关弹窗并归还焦点、Ctrl/⌘+K 检索、快捷键说明 | `SnippetsWorkspace.onKeydown` + `SnipDialog`（shortcuts） | `Esc 关闭详情抽屉` |
| 手机：目录抽屉、详情底部面板 | 窄档分支 | `窄档目录抽屉可打开`、`窄档详情是覆盖抽屉` |
| 窄档工具栏「片段详情」可点开抽屉（不再被 `@media` 隐藏） | `toggleInspector()` + `detailOpen` | `窄档工具栏片段详情按钮可见`、`窄档片段详情按钮可弹出抽屉` |
| 详情默认停在阅读态：只有带 `editing` 标记的草稿才渲染成表单；编辑态有「取消」丢弃草稿 | `SnipInspector.editing` + `cancelEdit()` | `点取消回到阅读态`、`重新打开详情停在阅读态而非表单` |
| 视觉：暗紫玻璃、宋体层级、薄荷交互、卡片 0.91 + blur18 | `app/src/styles/snippets-fusion.css` | `灵感卡片是暗紫玻璃`、`灵感外壳不铺实底` |

## 数据口径

- **不改表结构**：`content` 首行仍是标题——`doublelink-titles.js`、`writing-analysis-data.js`、
  `project/normalize.js`、`writing-stats-core.js` 四处消费者都按这个约定读，拆列会同时打坏它们。
- `tags: string[]` 是既有字段；本次新增两个**行内 JSON 字段**：`links: [{kind,id}]`（kind ∈ chapter/mubu/character，
  只存 ID，名字渲染时实时解析，故目标改名后关联仍成立）与手动顺序（按作品存 id 数组，不写回行）。
- 每作品 UI 状态 `appconfig['snipstate:<workId>']`、未提交草稿 `appconfig['snipdraft:<workId>']`，
  与 `charstate:` / `lorestate:` 同一套防抖写法；草稿按条存 `{title, body}`，切视图/关面板/刷新都不丢。

## 有意差异

1. **拼板分栏按实际标签成栏**（标签按使用数降序，未标记固定末栏）。原型把「场景/人物/对白」写死成三栏，
   那是演示数据的标签；真实作品标签任意，写死会让别处的标签全部无栏可去。
2. **模块自带左栏**，不再借用 Workbench 的 `.side-panel`（设计稿的左栏是模块内 174px 开放式目录，
   而宿主那栏是默认收起的浮层抽屉）。`showDirectory` 因此对 snippets 关闭，拆窗面板同构。
3. **设计稿顶栏由宿主 AppTopbar 承担**（六项模块导航 / 保存态 / 检索 / 锁定键都在），模块只画设计稿的页头。
4. 设计稿的 `Ctrl/⌘+Z` 全局撤销未实现：插件版每次写入都落库同步，逐条回滚状态会与作品库并发语义打架；
   删除/移除标签/移除关联都给了即时「撤销」入口。
5. **工具栏只保留设计稿的两个控件**（`排序` 与 `片段详情`）。设计稿 `index.html` 的 `.result-tools`
   就只含 `.sort-label` + `.detail-toggle`，没有撤销/重做/`?`；早先版本在这行多塞了三个按钮，
   已在 2026-11-08 移除。撤销/重做能力仍在（`Ctrl/⌘+Z`、`Ctrl/⌘+Shift+Z`），只是不占工具栏位置。

## 判据与复跑

    npm run test:snippets             # 灵感模型纯函数 7/7
    npm run build:app                 # 产物直接落 assets/app
    NS_VERIFY_RUN=snippets-1280 node scripts/verify-app.mjs   # 42 项
    NS_VERIFY_RUN=snippets-760  node scripts/verify-app.mjs   # 44 项
    NS_VERIFY_RUN=snippets-380  node scripts/verify-app.mjs   # 44 项

三档合计 130 项（42 + 44 + 44）全绿；整套 `verify:app` 1826/1826（34 个场景）无回归。

`scripts/snippets-probe.mjs` 是设计稿「已完成的交互」逐条落成的真机探针（点真 DOM、走应用自己的 store），
每个宽度都会跑；`scripts/verify-app.mjs` 的 HARNESS 另加了 12 条与设计稿同源的灵感种子
（raw 建表会被 Dexie v1→v12 升级清空，所以走 `addSnippet` 灌，和 `seedMubu` 同一结论）。
