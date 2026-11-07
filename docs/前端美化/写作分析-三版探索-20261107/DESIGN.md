# 小说工坊 · 写作分析三版交互设计稿

打开 [三版对比](index.html)。预览窗可以操作，支持并排、单版以及 1440／864／380px；也可直接打开独立原型。页面使用同一组本地演示数据，可直接在浏览器中打开，无需启动正式插件或登录。

| 方向 | 适用场景 | 建议先试 |
|---|---|---|
| [A · 创作长卷](a-journey.html) | 回顾一段时期的创作与改稿 | 在主图拖选区间，或应用起止日期；在日历选择 11 月 3 日查看净零写入，再选 11 月 5 日对照无保存记录。 |
| [B · 稿件案卷](b-manuscript.html) | 日常整理稿件，定位待修改章节 | 选择「向北的潮线」和「待修改」，打开「逆风而行」，展开版本节选，关闭后回到筛选结果。 |
| [C · 作品图志](c-atlas.html) | 比较同时推进的作品 | 把对照 2 换成「北纬档案」，设为近 90 日。点图看日期，或深入该作品；返回时保留两部作品、日期范围和对照位置。 |

三版都可切换「总览／正文／大纲／设定／人物／灵感」。正文的字数条附精确值，大纲的分段条显示事件状态，设定按根分支统计节点，人物只画已有关系，灵感提供标签与最近新增。右上图表圆钮打开「写作速览」，其中作品选择与完整分析共用。图表日期支持方向键移动、Enter 选择；「查看逐日数值」可展开逐日表格。窄窗和手机用覆盖明细，Esc 或关闭按钮回到原入口。背景轻微流动，响应系统减少动态效果设置。

## 数据口径

- **当前存量**只看演示正式章节与当前实体。「草稿」是正式章节的一种状态，不代表未确认的工作稿。日期范围不改变存量。
- **每日净增**是当日正式章节保存字数差之和，保留负数；有非零写入但当日抵消时标为净零。没有保存日志的日期以「—」或「暂无写作记录」显示。
- **区间累计净增**从所选区间重新累计，不能当作历史总字数。C 的两条走势使用同一天历和同一纵轴。
- **历程记录**只显示已有日期的版本与灵感。版本节选来自演示快照，人物关系来自演示关系表。没有写作时长、推断阶段或灵感转化率。

## 截图

| 版本 | 桌面首屏 | 864 窄窗 | 深入明细 | 380 手机 | 380 明细 | 桌面速览 |
|---|---|---|---|---|---|---|
| A | [桌面](screenshots/a-journey-1440.png) | [窄窗](screenshots/a-journey-864.png) | [当日保存明细](screenshots/a-journey-detail-1440.png) | [手机](screenshots/a-journey-380.png) | [手机明细](screenshots/a-journey-detail-380.png) | [速览](screenshots/a-journey-quick-1440.png) |
| B | [桌面](screenshots/b-manuscript-1440.png) | [窄窗](screenshots/b-manuscript-864.png) | [筛选与版本节选](screenshots/b-manuscript-detail-1440.png) | [手机](screenshots/b-manuscript-380.png) | [手机明细](screenshots/b-manuscript-detail-380.png) | [速览](screenshots/b-manuscript-quick-1440.png) |
| C | [桌面](screenshots/c-atlas-1440.png) | [窄窗](screenshots/c-atlas-864.png) | [对照日期](screenshots/c-atlas-detail-1440.png) · [深入作品](screenshots/c-atlas-work-1440.png) | [手机](screenshots/c-atlas-380.png) | [手机明细](screenshots/c-atlas-detail-380.png) | [速览](screenshots/c-atlas-quick-1440.png) |

另见 [三版并排](screenshots/comparison-1440.png)、[手机对比页](screenshots/comparison-380.png)、[人物关系示例](screenshots/c-atlas-people-1440.png)。

## 验收

Chrome 本地文件模式覆盖 1440、864、380px × 三版 × 六视图。验收包括无页面级横向溢出、主文字与图表色对比检查、速览共享作用域、日期拖选、净零与缺失、章节交叉筛选、版本展开、对照返回、实体明细、真实键盘与触控事件、滚动和焦点归还、减少动态效果。参见 [浏览器结果](screenshots/checks.json)。另有 5 项模型测试，覆盖正负字数差、日期范围、当前存量、跨作品对照和记录来源。

可在本目录运行：`node --test tools/model.test.mjs`、`node tools/verify.mjs`。浏览器验收默认使用 Windows 上安装的 Chrome，也可通过 `STUDIO_CHROME` 指定路径。

交付仅新增本设计稿目录。颗粒底图和宋体沿用此前人物探索稿的素材；正式插件、构建资源和作品库不在本稿的读写范围内。
