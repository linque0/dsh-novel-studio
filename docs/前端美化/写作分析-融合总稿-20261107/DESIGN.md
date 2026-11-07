# 小说工坊 · 写作分析融合总稿

打开 [交互原型](index.html)，默认进入演示正文。点右上角图表圆钮打开速览，再选「查看完整分析」。返回后在顶栏切到「书架」，从同一入口体验全库速览与对照。原型可直接在浏览器打开，不需要启动宿主。

| 场景 | 首屏 | 建议试一遍 |
|---|---|---|
| 正文入口 | 当前作品 · 创作历程 | 速览选 11 月 3 日 → 查看当日明细 → 点「逆风而行」→ 展开版本 → 返回日期明细。 |
| 书架入口 | 全库 · 作品对照 | 换成「雾港纪年／北纬档案」、选近 90 日 → 深入北纬档案 → 返回对照。原作品组合、日期和位置会恢复。 |
| 正文分析 | 稿件案卷 | 选「向北的潮线」和「待修改」→ 切换章节结构和改稿轨迹 → 选中一个日期。收起再展开，图表、卷、状态和位置会保留。 |

## 章节双图与动效演示

直接打开 [章节结构](index.html?view=manuscript) 或 [改稿轨迹](index.html?view=manuscript&chart=revision)，也可以从总稿顶部「正文」进入。实际浏览器录制：[从速览进入章节案卷并切换双图](screenshots/chapter-motion.mp4)。

- **章节结构**按原稿顺序分卷，含未分卷章节。状态筛选只改变显示哪些章节，共用字数刻度和基于所选分组全体章节的中位线。选中章节后可查看区间内的保存与版本。
- **改稿轨迹**按章和日期显示保存净增。选「向北的潮线」里的《逆风而行》，对照 11 月 3 日的两次保存相抵、4 日的 −273 字、5 日无保存日志；菱形仅代表留存的版本。方向键在矩阵移动，Home／End 到行首／尾，Enter 打开明细，Esc 关闭并回到原格。手机上可横滑日期，章节名固定。
- 图表首入与数据更新采用短促缓动；趋势柱从零线展开，累计线描绘，日历与矩阵响应选中，章节和进度条按长度变化，人物关系只强调相关的现有连线。开启「减少动态效果」时直接显示最终状态。数值、筛选和焦点不等待动画。

| 双图截图 | 1440px | 864px | 380px |
|---|---|---|---|
| 章节结构 | [桌面](screenshots/chapter-structure-1440.png) | [窄窗](screenshots/chapter-structure-864.png) | [手机](screenshots/chapter-structure-380.png) |
| 改稿轨迹 | [桌面](screenshots/chapter-revision-1440.png) | [窄窗](screenshots/chapter-revision-864.png) | [手机](screenshots/chapter-revision-380.png) |
| 日期与版本 | [右侧明细](screenshots/chapter-revision-detail-1440.png) | — | [底部明细](screenshots/chapter-revision-detail-380.png) |

## 设计与交互

- 六项分析导航共用作品范围；创作历程和作品对照是总览下的两种视图。桌面先展示两部作品的同刻度趋势，再展示作品索引和分卷规模。
- 历程把当日净增、区间累计与当前正文存量分开；趋势拖选、日期输入和日历共用区间与选中日期。宽屏在右侧查明细，864px 窗口使用覆盖面板，380px 手机使用底部抽屉。
- 案卷的字数和完成度随分卷变化，状态筛选只收窄章节清单，未分卷独立列出。大纲、设定、人物、灵感各用对应的数据结构呈现，人物关系图只连接实际存在的演示关系。
- 桌面速览锚定顶栏图表钮，背景继续可操作；手机用底部浮窗。图上日期支持触控、方向键与 Enter。Esc／关闭按钮归还入口焦点，点浮窗外的编辑器时让焦点留在编辑器。正文试读可临时输入；它不会保存或改变演示统计。
- 正式章节存量不随日期变化。每日净增是已有保存字数差之和，区分负数、抵消后的零与无记录。版本、灵感历程只展示有日期的已有记录。沿用三版演示作品及数值，其中《归港》归入未分卷以展示这一状态。

## 截图与验收

| 场景 | 1440px | 864px | 380px |
|---|---|---|---|
| 创作历程 | [首屏](screenshots/journey-1440.png) | [窄窗](screenshots/journey-864.png) | [手机](screenshots/journey-380.png) |
| 作品对照 | [首屏](screenshots/compare-1440.png) | [窄窗](screenshots/compare-864.png) | [手机](screenshots/compare-380.png) |
| 正文速览 | [桌面浮窗](screenshots/editor-quick-1440.png) | [窄窗](screenshots/editor-quick-864.png) | [手机浮窗](screenshots/editor-quick-380.png) |
| 书架速览 | [桌面浮窗](screenshots/library-quick-1440.png) | — | [手机浮窗](screenshots/library-quick-380.png) |
| 日期明细 | [桌面明细](screenshots/day-detail-1440.png) | — | [手机明细](screenshots/day-detail-380.png) |
| 稿件案卷 | [卷、状态、章节版本](screenshots/manuscript-1440.png) | — | [章节明细](screenshots/chapter-detail-380.png) |

补充：[速览已选日期](screenshots/quick-date-1440.png) · [无写作记录](screenshots/empty-380.png) · [浏览器验收](screenshots/checks.json)。

三档视口覆盖两种入口与六个分析视图，183 项浏览器断言、14 项数据测试通过。动效检查覆盖趋势、案卷、作品对照和四个内容分析模块，以及快速切换和系统减少动态效果偏好。独立静态复核后，合并了手机矩阵的操作提示与日期范围，使四章演示分组在首屏完整可见。录制使用 Chrome 实际画面。

在本目录用 `node --test tools/*.test.mjs` 和 `node tools/verify.mjs` 复跑；安装 FFmpeg 后，可加 `--record` 重新录制演示。仅修改本总稿目录；原三版、正式插件、构建资源及真实作品库均保持原状。
