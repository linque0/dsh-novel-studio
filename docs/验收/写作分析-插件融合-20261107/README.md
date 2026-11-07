# 插件版写作分析融合验收

本目录截图与录像来自本仓库构建的正式插件页面。验收使用临时 Chrome 配置、随机本地端口和独立 IndexedDB；作品与日志是专用测试数据，与设计稿使用同一组作品便于比较。没有访问正在运行的 DSH 宿主或真实作品库。

- [正式页面实录](writing-analysis-plugin.mp4)：从正文速览展开完整分析、进入案卷、切换改稿轨迹和章节结构、查看当天留存版本。
- [截图与专项结果](release-checks.json)。
- [设计稿验收依据](../../前端美化/写作分析-融合总稿-20261107/DESIGN.md)。

## 界面

| 场景 | 1440 | 1280 | 864 | 760 | 380 |
|---|---|---|---|---|---|
| 正文速览 | [图](screenshots/quick-1440.png) | [图](screenshots/quick-1280.png) | [图](screenshots/quick-864.png) | [图](screenshots/quick-760.png) | [图](screenshots/quick-380.png) |
| 创作历程 | [图](screenshots/journey-1440.png) | [图](screenshots/journey-1280.png) | [图](screenshots/journey-864.png) | [图](screenshots/journey-760.png) | [图](screenshots/journey-380.png) |
| 章节结构 | [图](screenshots/structure-1440.png) | [图](screenshots/structure-1280.png) | [图](screenshots/structure-864.png) | [图](screenshots/structure-760.png) | [图](screenshots/structure-380.png) |
| 改稿轨迹 | [图](screenshots/revision-1440.png) | [图](screenshots/revision-1280.png) | [图](screenshots/revision-864.png) | [图](screenshots/revision-760.png) | [图](screenshots/revision-380.png) |
| 改稿明细 | [图](screenshots/revision-detail-1440.png) | [图](screenshots/revision-detail-1280.png) | [图](screenshots/revision-detail-864.png) | [图](screenshots/revision-detail-760.png) | [图](screenshots/revision-detail-380.png) |

另见：[书架速览](screenshots/library-quick-1440.png)、[作品对照](screenshots/compare-1440.png)、[大纲](screenshots/outline-1440.png)、[设定](screenshots/lore-1440.png)、[人物](screenshots/characters-1440.png)、[灵感](screenshots/snippets-1440.png)。

## 指标与历史

当前正文规模读取已保存正式章节，按正式字数算法计算；排除回收站，不把未确认工作稿计入。日期仅影响历史曲线、活跃日期和新增记录，不改变当前存量。历史日志保留负数与相抵后的净零；存在非零写入的日期计为活跃日。已删除或无法定位章节的日志仍可参与对应作品的历史汇总，明细明确标为来源不可用。

快照摘要按真实章节归属和保存时间读取，正文只在展开时读取。新快照附带自身格式，保留原有采集频率及最多 30 份的规则；旧版没有格式的快照采用兼容预览，并显示「旧版兼容预览」。不会借用当前章节格式解释旧快照，也不把作品库并发版本号当作内容版本。预览只输出文本，保留段落，禁用脚本与外部 HTML 渲染。

内容版本、写作日志仍遵循现有本地保存和备份边界。本次没有扩展历史跨设备同步、迁移历史或新增行为采集。没有依据更新时间推算写作量、写作时长、创作阶段或灵感转化率。

## 验收范围

主窗口、独立面板和大纲顶栏均沿用写作数据入口。已覆盖：作用域切换、双书同期同刻度、深入与返回、日期拖选及输入、章节和状态筛选、未分卷、矩阵方向键／触控、净零／净减／缺失、快照按需展开和格式、分页缩短范围、保存失败及重试、错误读取重试，以及不卸载原编辑器的光标与滚动保留。

图表动效使用稳定 Vue 节点、CSS 与 Web Animations。系统减少动态效果时直接显示终态。独立复核发现并修复了分页越界、历史格式解释、选择动效字段契约三项问题；又补齐了旧 HTML 快照的分段预览。

## 最终验证结果

| 检查 | 结果 |
|---|---|
| 统计及融合数据测试 | 12 / 12 |
| `test:lore-layout` | 9 / 9 |
| `test:char-layout` | 8 / 8 |
| `test:settings` | 19 / 19 |
| `build:app` | 通过，直接生成 `assets/app` |
| `verify:app` | 1744 / 1744，34 个正式构建场景 |
| 手机减少动态效果回归 | 66 / 66 |
| 正式页面截图、原生输入与动效专项 | 22 / 22，31 张截图 |
| `smoke` | 82 / 82 |
| `contract` | 宿主和客户端均通过 |

专项使用 Chrome 原生鼠标、键盘和触控输入验证矩阵、浮窗外点击、顶栏自动隐藏与 Esc 焦点归还；动画实录为实际页面操作，1440 × 900、30fps、约 16 秒。五档截图覆盖 1440、1280、864、760、380px。构建与交付摘要见 [verification.json](verification.json)，完整运行日志和基线对照保存在仓库 `.tmp-writing-fusion-release`。对照初始补丁、已有新增文件的摘要及正式文件压缩包，未发现无关改动被覆盖。

## 数据量适配与原型的有意差异

- 真实书库不强制凑成两部对照：不足两部时显示现有作品和说明。
- 大作品按页显示章节、矩阵、灵感与明细；当前分卷的字数轴与中位数基于完整分组，分页和状态筛选不改变参照。人物关系图分页排布，人物明细可看其全部已有关系。
- 真实快照没有原型中手写的版本名称时，以实际保存时间命名。没有历史就显示无记录，不补入演示曲线。
- 保留刷新和失败重试入口；手机完整分析将刷新入口让位于作品及日期筛选，自动刷新与错误重试继续可用。

构建直接更新仓库 assets/app；没有从桌面仓库复制资源，没有提交、发布或重启宿主。实施前基线保存在仓库 .tmp-writing-fusion-release 下，包含 tracked 补丁、文件状态、未跟踪文件摘要和正式文件压缩包。

