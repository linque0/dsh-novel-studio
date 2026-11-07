# DSH 插件版设置界面按总稿落地 · 实施记录

依据：作者批准的《设置 · 总设计稿》（`docs/前端美化/设置-总设计稿-20261105/`）与本次对话确认的四条决策。

- [x] 纯逻辑层与保存态：`settings-catalog` / `settings-prefs` / `settings-summary` / `settings-version`，`ui.applyPref|retryPrefs|saveSettingsUi`，`backupAll()` 回带 json 与最近备份时间；单测 19 条。
- [x] 皮肤层：`app/plugin/dsh/settings-fusion.css`（402 行，按 `studio.css` 1:1 移植），删掉 `dsh.css` 里被取代的 `.sw-root` 段（−8454 字节 / −268 行）。
- [x] 外壳与外观页：`SettingsWorkspace`（含抽屉、遮罩、焦点陷阱、Esc 链、Ctrl/⌘+S、滚动记忆、保存态三处联动）、`SettingsSidebar`、`SettingsSearchResults`、`SettingsAppearance`、`SettingsPreview`、`SettingsDialog`、`settings-toast`、`services/settings-entry.js`；`App.vue` 增 `view==='settings'` 分支；`SettingsWindow.vue` 退化为面板窗口壳。
- [x] 数据页、关于页与五个弹窗：`SettingsDataPage`、`SettingsAboutPage`、`dialogs/*`、`settings-data-actions.js`（备份/恢复/导出/回收站编排，副作用集中在可打桩的 deps）。
- [x] 对稿与验收：`scripts/compare-settings.mjs`（原型 ↔ 产物双侧同测）、`scripts/verify-app.mjs` 新增 7 个场景（settings ×5、panel-settings、settings-restore）。
- [x] 收尾：设置页流动背板、侧栏版本号去掉 `v`、页脚 strut 3px。

约束：不动正文/大纲/设定/人物/灵感模块与其皮肤；不新增依赖；不 git add/commit、不发布、不重启宿主；`themes.css` 与 `flow-shell.css` 一字未改。

## 决策与基线

- Ruling D1（作者选定）：设置以**就地视图**为主（`ui.view='settings'`），面板窗口仍可用。`openSettings()` 先试 `panelOpen`，返回 `ok:false`/无桥/250ms 超时才回落就地，并把"宿主拦弹窗"这一判定缓存一次，避免每次点齿轮都弹一个被拦的窗。
- Ruling D2（作者选定）：恢复备份的撤销＝恢复前把全量快照写进 `sessionStorage['novelstudio:settings:restoreSnapshot']`，真正 `reload` 之后数据页仍给出「撤销恢复」并真实执行第二次恢复。
- Ruling D3（作者选定）：界面用真实数据——预览取当前作品首章（无作品回退总稿演示句）、摘要与最近备份取真实值。
- Ruling D4（作者选定）：导入导出保留正式全部格式（txt/md/docx/pdf/epub/图片；TXT/MD/Word），页内说明按真实能力写。
- 基线：开工前工作区已脏（85 项未提交改动，`dsh.css` / `themes.css` / `package.json` 等），以该状态为准；本轮未提交。
- 派单与轮次（R5/R6 记账）：T1 逻辑 3 轮（含 1 次返工：`ui.js` 从错误模块 import `SETTINGS_PAGE_KEYS`，构建期被 dispatcher 撞出）；T2 皮肤 4 次交互（主交付 + 顶栏错误色裁定 + `.nav-foot` 泄漏修复 + 一处外观性遗留接受）；T3 外壳 3 轮（主交付 + 恢复默认补确认框 + 背板/版本文案/页脚 3px 收尾）；T4 页面与弹窗 1 轮；T5 验收脚本 3 轮（主交付 + nav-foot 判据硬化 + 背板断言翻转与容差收紧）。

## 复核过程中被拦下的缺陷（均由 dispatcher 独立复核发现，未进入交付）

1. `app/src/stores/ui.js:11` 把 `SETTINGS_PAGE_KEYS` 从 `settings-prefs.js` 引入（实际导出于 `settings-catalog.js`）→ `npm run build:app` 直接失败。单测不加载 store，只有构建能抓到。
2. 「恢复默认」缺二次确认，与总稿 `app.mjs:80-81` 及 `tools/verify.mjs:39` 的"取消不改偏好"矛盾。
3. `.settings-shell .nav-foot` 被 `themes.css:6938` 的裸规则接管成一行 flex + `nowrap`，第二段被裁（T5 对稿告警查出，后升为硬断言）。
4. 设置页完全没有流动背板（dispatcher 亲自比对 1440/1280 截图发现）：背板只由 `Workbench` / `PanelHost` 挂载，设置在独立视图里没有。

## 执行进度

完成：`npm run build:app` exit 0；`npm run test:settings` 19/19；`node scripts/compare-settings.mjs` 几何 42/42（±1px，`heightDelta 0`）+ 无横向溢出 32/32 + 窄档交互态 8/8 + advisories 0；`npm run verify:app` 1503/1503（33 场景，设置相关 272 条，旧 26 场景 1231 条逐条不变）；`npm run smoke` 82/0；`npm run contract` 通过；截图 35 张。

交付与验收细节（结构表、改动文件表、逐项差异清单）见 `docs/前端美化/设置-严格对稿-20261106.md`。
