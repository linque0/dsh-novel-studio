# dsh-novel-studio

小说工坊的 DSH 插件版。目标：在 DSH 里打开小说工坊的完整界面，并让 **DSH 的 Agent 代替恍然梦**对作品做建议、审稿与编辑——桌面软件版与插件版读写**同一份作品库**。

当前进度：**M0 骨架**（作品库核心 + 静态托管 + RPC + 3 个只读工具 + iframe 客户端）。

## 结构

    dsh-novel-studio/
      package.json          cordis 插件声明（dsh.bundle.patch / dsh.client）
      cordis.patch.yml      装载补丁
      src/index.js          服务端入口：工具 / 静态路由 / RPC / 技能 / 稳定提示词
      src/core/library.js   作品库：索引 + 实体文件 + 日志 + CAS + 幂等 + 快照
      src/core/tools.js     只读工具定义（studio_works / studio_outline / studio_read）
      src/core/format.js    净化 / 取纯文本 / 字数 / 相对时间（宿主无关纯函数，当前界面未使用）
      src/core/view.js      视图模型：shelf / createWork / openWork / chapter（当前界面未使用）
      src/adapters/dsh/     静态托管、RPC（shelf.list / work.create / work.open / chapter.get + 旧 8 个 action）
      src/client/iframe-shim.js   注入 iframe 的 window.native 替身
      lib/client.js         客户端 bundle（手写 ModuleLoader 格式，只用 react；面板 = 诊断条 + iframe）
      app/                  前端工程源码（fork 自 novel-studio）+ 独立构建配置
      assets/app/           npm run build:app 的产物（插件运行时挂载点）
      scripts/smoke.mjs     不依赖宿主的冒烟（75 项）

## 常用命令

    npm run contract       # 宿主契约预检（挑剔假宿主跑 apply）+ 客户端契约（guide 卡片/正文座位）
    npm run smoke          # 核心库 / 静态托管 / RPC / 视图模型 / 工具 冒烟（75 项）
    npm run build:app      # 构建插件版前端 → assets/app（app/ 是 fork 出来的独立前端工程）
    npm run copy-app       # 从 ../novel-studio/dist 复制构建产物（桌面版完整界面，旧路径）
    node scripts/install-local.mjs   # 挂进 DSH 桌面 profile（幂等，改前自动备份）

安装脚本做三件事：在 C:\Users\<你>\dsh-plugins\dsh-novel-studio 建一个无空格的目录联接（指向本仓库）、
在 profile 的 dependencies 里加 link: 依赖、在 dsh.profile.bundles 里追加 dsh-novel-studio。
**改完必须完全退出并重启 DSH 才生效。**
回退：恢复 profile 目录下的 package.json.bak-* 即可。

## 作品库

库目录由插件配置 libraryDir 指定；缺省读取共享指针：

    %LOCALAPPDATA%/novel-studio/library.json   ->   { "path": "D:/Novels" }

库结构见 src/core/library.js 顶部注释。写入只走 submit：

- 必须带 requestId（幂等键）与每个 op 的 baseRevision（前置 CAS）
- 冲突返回 conflict.currentRevision + current，由调用方重读合并，永不静默覆盖
- ai.cred* 密钥类配置在入库前被剔除

## 能力清单（v0.2.0）

**只读**：`studio_works`（书目/目录）、`studio_outline`（章节目录+字数）、`studio_read`（正文/人物/设定分页）、`studio_search`（子串检索）、`studio_preset`（作者预设）

**审稿**：`studio_review`（每条意见必须有正文唯一 quote；引用设定/人物作证据会反查 verified）、`studio_recheck`（必须恰好覆盖全部原问题；定位失败的 resolved 自动降级）

**写入**：`studio_propose`（候选，不落库）→ `studio_apply {confirm:true}`（作者同意后落库，`requestId` 幂等 + `expectedRevision` 前置校验）→ `studio_undo`（回退到应用前版本）

**技能**：6 个（project / write / plan / memory / revise / review），渐进披露，project 为共享段。

**界面 · 灵感**：按 [`docs/前端美化/灵感-融合总稿-20261107/`](docs/前端美化/灵感-融合总稿-20261107/) 重做 —— 页头（手札/拼板切换、检索、记一条）+ 左栏（全部/未标记/有关联/标签/回收站）+ 手札（按日期分组、置顶记录卡）或拼板（按标签分栏、手柄拖动、跨栏确认加标签）+ 片段详情（编辑标题正文并显式保存、标签、关联、转为章节/设定、回收站还原）。数据仍写 `snippets` 行的 `content`（首行 = 标题，四处既有消费者依赖这个约定），新增行内 `links: [{kind,id}]` 与按作品的手动顺序；未提交修改与每作品视图状态分别落 `appconfig['snipdraft:<workId>']` / `['snipstate:<workId>']`。插件版不渲染恍然梦入口（DSH 自身取代）。样式收在 `.snip-shell` 命名空间（`app/src/styles/snippets-fusion.css`），不再占用宿主 `.side-panel`。验收：`npm run test:snippets` + `NS_VERIFY_RUN=snippets-<宽> node scripts/verify-app.mjs`，记录见 [`docs/验收/灵感-插件融合-20261107/`](docs/验收/灵感-插件融合-20261107/)。

**界面**：正文页的章节栏可收起 —— 场景皮肤在目录页右上角、原版/赤月戏在面板底部「收起章节栏」，另有 `更多 → 收起目录栏`；收起后左缘留 22px 竖排细轨（「章节」），点一下即恢复，正文因此多出约 230px 宽。偏好写进 appconfig（`sidePanelOpen`），大纲模块沿用自有的 `outlineSideOpen` 不受影响；面板窗口（`inPanel`）与独立正文窗（`navigation-only`）不显示该控件。桌面版与插件版共用同一份前端代码，两边行为一致。

## 数据层进度

- **M2（进行中）**：桌面版已具备作品库主进程通道（`electron/library-ipc.js`，7 个通道）与渲染层桥（`src/services/library.js`），核心实现与插件共用 `novel-studio/packages/novel-core/library.js`。
- **迁移是作者显式触发的**：桌面版控制台执行 `await window.__ns.library.migrateToLibrary()`，做"导出备份 → 写入作品库 → 核对"，不覆盖已有库、失败不动本地数据。
- **M3 同步层（已接）**：桌面版 `src/services/library-sync.js` + 插件版 iframe 内的同一份前端代码，都会把 Dexie 变更批量提交到作品库、并轮询拉取库的增量回灌 Dexie。冲突以库为准并重放一次；队列有界（200 条）。
- **仍未做**：桌面版首次全量迁移仍需作者显式触发（`window.__ns.library.migrateToLibrary()`）；插件版不需要（库就是它的权威源）。

## 导入软件版作品（两条路，殊途同归）

1. **面板里点「导入软件版备份」**：桌面版 设置 → 数据与备份 → 导出备份，得到 JSON；插件面板选它即可（写入作品库并自动重载界面）。
2. **命令行一次性拉取**（作者机器上跑，桌面版可开可关）：

       cd dsh-novel-studio
       node scripts/import-from-desktop.mjs          # 启动/复用桌面版 → dump → 写入作品库
       node scripts/import-from-desktop.mjs --keep   # 不关闭桌面版

   脚本以 `--remote-debugging-port=9222` 连桌面版渲染进程，用 Dexie 直接 dump 全部表；
   只迁 `SOURCE_TABLES` + `appconfig`/`aipresets`/`aipresetstate`，AI 记忆表（aikb/aidoc/aikbvec…）按设计**不迁**——它们是可重建读模型。
   dump 副本留在 `dsh-novel-studio/.tmp/desktop-dump.json`。

## 本地复现台（不用重启 DSH 就能查 SPA 报错）

    node scripts/preview.mjs            # 起静态+RPC → Electron 隐窗口加载 9s → 打印控制台/页面状态 → 截图
    node scripts/preview.mjs --serve    # 只起服务，浏览器手动看（端口 NS_PORT，默认 18688）

会写 `.tmp/preview.png`（截图）与 `.tmp/preview.log`（控制台）。定位 iframe 空白页时首选这个。
原生面板的离线预览台是 `npm run preview:panel`（八张截图 + 断言，不依赖 DSH 宿主）。

## 界面（唯一外观：隐现）

面板 = 顶部诊断条 + 备份导入 + **整块 iframe**（`/api/novelstudio/app/index.html`）。所有模块都在：
书架 / 正文 / 大纲 / 设定 / 人物 / 灵感 / 设置 / 图谱 / 统计 / 回收站 / 导入导出。

插件版只有**一套外观**：设计稿「书架 · 流动封面（隐现）」（`docs/前端美化/书架-流动封面-20261103/`，
代码落点见同目录 `接入说明.md`）。original / gravity / glaze / crimson 四套桌面皮肤已从插件版项目中移除
（组件、样式、45.7 MB 素材、`three` 依赖），`body[data-skin]` 恒为 `dsh`，设置窗口不再有皮肤与主题入口。

- 书架：满屏流动底（网格渐变 + 有序抖动，WebGL2 双通道 + CPU 兜底）+ 玻璃封面流转图 + 聚焦书名 + 底部 dock；
  换书首尾环绕（末本再往后回到第一本）；卡片封面在挂载/切回书架时按 ref 绑定即补画，不会出现空封面。
  顶栏是浮起的胶囊导航，点其它项＝打开当前聚焦作品的对应模块，无作品时禁用。
- **入口只有一处**：右侧栏「开始」页卡片栏里的「小说工坊」（图标 + 标题 + 一行说明，`guide.order = 15`，点开即加载整块界面）。
  左栏底部那枚「工坊」按钮与它重复，已下线。宿主只渲染定义里带 `guide` 的 tab 类型，
  这条契约（以及"左栏不再注册重复入口"）由 `npm run contract` 里的客户端预检守着。
- 顶栏自适应：560–899 收紧内边距与字号、≥900 恢复常态；仍放不下时导航不折叠，而是**横向可滚动**——
  鼠标滚轮直接翻出其余入口（轮询换算成水平滚动），溢出侧渐隐提示，溢出时容器改 flex-start 保证首项不被推到滚动原点之外。
  ⋯ 的「模块」分区始终列出全部入口，两条路都能到。
- 语言令牌：`app/plugin/dsh/language.css` 的 `--nsx-*`（玻璃三级 / 描边 / 文字三级 / 模糊 / 胶囊圆角 / 宋体题名 / 阴影 / 顶栏高度）。书架固定暗色，其它页跟随宿主亮暗。
- 顶栏高度三档：≥900 为 64、560–899 为 52、<560 为 44（`--nsx-topbar-h` 单一来源；抽屉与遮罩的 `top` = 该值 + 16px）。
- 工作台：编辑区半透明玻璃（`--nsx-glass-1` + `blur(18px)`），正文行宽仍 ≤36em、行高 1.9、工具栏 34、字号跟随宿主。
- 令牌桥：shim 读宿主父窗口 body 上 `--dsw-*` / `--dsh-*` 的**计算后现值**（含第三方主题插件与壁纸的改写），
  映射成 iframe 内的 `--ns-*`，并用 MutationObserver 跟随深浅色与字号；取不到的令牌不写入，交给回退值。
  因此 dsh 界面会跟着你的 DSH 主题走，而不是自带一套配色。
- 窄栏适配：右栏 <560px 时顶栏 44px（作品名 + 当前页签 + 保存点 + ⋯）、章节栏折成 22px 竖排细轨、
  批注栏改右侧抽屉（`top` 跟 `--ns-topbar-h`，不盖顶栏）、书架按 128px 卡宽一环一屏；≥900px 恢复宽档。
- 验收：`npm run verify:app` 真 Chrome 跑 **42 项断言 / 6 场景**（380、760、1280 × 书架、正文），含背板后端、
  顶栏按档高度、顶栏不遮内容、正文 36em、工具栏 34、无横向溢出、可见「恍然梦」= 0。
- 产物：**本仓库自己构建** —— `npm run build:app` 直接写 `assets/app`（源码在 `app/`，见下节），当前 129 文件、约 26.4 MB。

**已归档的方案**：2026-11 曾试过「原生三视图（书架/目录/正文）替换整套界面」，方向是错的——它把大纲、
人物、设定这些真实模块从界面里拿掉了。源码与截图证据留在 `.tmp/attempt-native-ui/`（不入 git）；
`src/core/format.js`、`src/core/view.js` 与四个 RPC action 保留，但当前没有任何界面调用它们。

## 前端工程（app/）

插件版界面从桌面仓库 **fork** 出来，本仓库自己构建前端，**不再依赖 `F:\deepseek workplace\novel-studio` 的源码**。

    app/
      index.html              Vite 入口（插件版）
      vite.config.mjs         独立构建配置：root=app/，base './'，产物 ../assets/app，__NS_PLUGIN__=true
      package.json            只声明依赖与工具元数据，不参与运行时
      src/                    界面源码（322 文件，fork 自 novel-studio/src）
      plugin/dsh/             插件专属皮肤层 index.js / dsh.css / theme.js（与 src/ 同级，main.js 的 './../plugin/dsh/index.js' 照旧成立）
      docs/使用手册.md         构建输入：HelpManual.vue 里 '../../docs/使用手册.md?raw' 导入，缺了构建直接失败
      tools/verify-seeds.mjs  构建输入：App.vue 的 DEV-only 动态 import —— rollup 静态解析这条路径，缺了也失败
      public/licenses/        仅为产物字节对齐：三份字体许可由 public/ 原样复制，删掉产物少三个文件（不影响界面）
      node_modules/           指向 novel-studio/node_modules 的目录联接（见下）

**两项目边界**

- 本仓库：`app/` 是唯一前端源码与构建入口，`npm run build:app` 直接产出 `assets/app`（覆盖旧拷贝）。
- 桌面仓库：只管桌面版（`vite build` → `dist`）与它自己的 `dist-plugin`；**不再参与**插件版构建。
- 插件侧 Node 代码（`src/**`、`lib/**`、iframe-shim）与前端工程无关，两边互不影响。

**用法（三条命令）**

    npm run link:app-deps  # 只在首次 / 联接丢失时：重建目录联接（不联网、不装包；已就绪则幂等 exit 0）
    npm run build:app      # = node app/node_modules/vite/bin/vite.js build --config app/vite.config.mjs
    npm run verify:app     # 真 Chrome 加载 assets/app 跑 42 项外观断言（6 场景），任一失败即 exit 1

产物：`assets/app/` 129 文件、约 26.4 MB、1 个 CSS（`cssCodeSplit: false`）、index.html 直接 `<link>` 引用该 CSS。
改完界面必须重跑一次构建；DSH 端仍是「完全退出并重启 DSH 才生效」。

**node_modules 是目录联接（本机不允许 npm install）**

    app/node_modules  --(NTFS 目录联接 junction)-->  F:\deepseek workplace\novel-studio\node_modules

由来：vite 从项目根解析依赖，本机离线、不能 `npm i`，于是把桌面包已装齐的依赖联接过来。
联接丢失（换机、桌面仓库 `npm ci` 过、路径变了）时先跑 `npm run link:app-deps`：已就绪且能解析
`vite` 就 exit 0，否则重建 junction；目标不存在时打印两条修复路并 exit 1（不会自动联网）。
将来要独立安装：删掉联接，在 `app/` 里装自己的依赖（`app/package.json` 已按桌面版声明全部 23 个 dependencies）。

    cmd /c rmdir app\node_modules     # 只删联接，不会删到桌面包本体
    cd app && npm install             # 之后 app/node_modules 是真实目录，构建命令不变

**从桌面仓库 resync（人工步骤，没有自动同步）**

`app/src` 与 `novel-studio/src` 从此各自演化。要吸收桌面版的新改动时：

1. `git diff --no-index --stat ../novel-studio/src app/src` 先看哪些文件真的变了。
2. **逐文件挑选**，不要整目录覆盖：界面/逻辑修复（布局、样式、store、通用组件）才搬；桌面专属件
   （Electron、`window.native` 全量、拆窗、多皮肤选择器）一律不搬。
3. 一次只搬一个主题；搬完立刻 `npm run build:app`，再跑 `npm run verify:app` —— PASS 才算搬完（`assets/app` 的实际渲染是唯一判据；旧的人工截图对照见「本地复现台」）。
4. `plugin/dsh/dsh.css` 的覆盖规则跟着组件 DOM 走：组件结构变了要同步核对皮肤规则。

整目录覆盖会一次性丢掉本仓库在 `app/src` 里的插件化改动（`__NS_PLUGIN__` 分支、窄栏规则、恍然梦隐藏），
并让 resync 变成无法审计的动作——所以它只能是人工的、逐文件的。

## 更新前端产物与「重新载入」

面板顶栏的「重新载入」只重建 iframe；**能不能看到新界面取决于静态产物怎么被路由**：

| 改动 | 生效方式 |
|---|---|
| `app/src` → `npm run build:app`（`assets/app` 里的哈希 js/css/字体） | **热**：点「重新载入」即可，不需要重启 DSH |
| `src/*.js`（插件服务端：工具、RPC、路由） | 重载插件：重启 DSH（本 profile 未开 HMR 的按目录监听） |
| `lib/client.js`（面板本身） | 至少刷新 DSH 页面；客户端模块清单在启动时合成，稳妥做法是重启一次 |

顶栏那句诊断就是判据：`热路由` = 前缀路由在跑（上表第一行成立）；`需重启` = 宿主没有 webServer、回落
逐文件注册（文件名集合冻结在启动那一刻）；`资源 N ✓` / `资源 缺 N` 来自健康探针逐个落盘核对
`index.html` 引用的产物文件。

**2026-11 的白屏事故**：静态产物原来在 `apply()` 时按文件名逐条注册精确路由，而 `index.html` 每次都是
现读磁盘的 —— 重建后它立刻指向新的哈希资源，那些路径没注册 → 404 → 面板白屏、点「重新载入」也没用。
现在整个 `/api/novelstudio/app/` 由 webServer 前缀路由承接（按请求实时读盘），无 webServer 的组合仍回落精确路由。

## 宿主契约（读 dsh-client-connection / dsh-app-boot / dsh-tools 源码核实，写插件必须遵守）

1. **fetch 路由是"精确路径"匹配**：`ctx.connection.fetch.register({ path })` 的 path 是 Map 的键，**不支持通配符**；`/api/foo/*` 永远匹配不到任何请求，且会直接抛错（段名必须匹配 `/^[A-Za-z0-9_$.-]+$/`）。
2. **每个 GET/HEAD 路由必须显式声明 `requestBody: 'buffered'`**：未声明时宿主取到 `undefined`，会退到 streaming 分支给 GET 挂 body，`new Request()` 直接抛错 → 浏览器收到 **400**（本项目踩过这个坑）。
3. **路径必须在 `/api/` 之下**，否则注册时校验失败。
4. 访问控制由宿主负责：非 owner 主体拿到 403；未认证得到 401（所以 curl 直接打永远是 401，只能在宿主页面里验）。
5. 同一 path 只能注册一次，重复注册抛错。
6. **要热更新静态产物就走 `webServer` 前缀路由**：`ctx.get('webServer').register({ kind: 'prefix', path, handler })`，
   handler 拿原始 `req/res`；宿主按「精确表 → 最长前缀胜」匹配，且**每次请求现查表**，所以启动之后新增的
   文件天然可服务（这正是「重建产物不用重启」的依据）。单席位的 `registerFallback` 已被 DSH 主界面占走，别抢。
7. 前缀路由**不经过** connection 的鉴权闸门，要自己调 `ctx.connection.requestRejection(request)`
   （与精确路由内部的 `admit()` 同一个判定）拿 401/403。
8. **profile 装载有版本门，不满足会被静默跳过**：宿主 `@deepseek-ai/dsh-app-boot` 的 `loadProfileDirectory()`
   对 `package.json` 里 `dsh.profile.bundles` 的每一项调用 `evaluatePluginCompatibility()`，不满足就 throw，
   该 bundle 落进 `skippedBundles`（**不打印任何提示**）：插件的服务端代码根本不加载，表现为「工具/技能全消失，
   但 profile 里还写着它」。判定规则（`dsh-app-boot/lib/index.js:1097-1117`、`:1129-1143`、`:1800-1821`）：
   manifest 有 `engines.dsh` 时**只看它并忽略 peerDependencies**；没有 `engines.dsh` 时才逐个校验
   `@deepseek-ai/dsh` 与 `@deepseek-ai/dsh-*` 的 peerDependencies（`@deepseek-ai/cordis`、
   `@deepseek-ai/schemastery` 不属于 dsh peer，不参与判定）。所以**不写 `engines.dsh` 却把 peer 钉成精确版本，
   宿主一升级插件就被静默跳过**。
9. **`Config` 必须是 Standard Schema，且 `validate` 必须同步**：cordis 的 `resolveConfig()`
   （`cordis/lib/index.js:244-250`）直接访问 `runtime.Config['~standard'].validate(config)`，并拒绝 async 校验。
   用「可选 import 宿主 schemastery，失败就退回一个假对象」的写法，`Config` 就不是 Standard Schema：
   即使插件被正常装载，也会在配置校验阶段抛 `TypeError`，`apply()` 永不执行。正确做法是**零宿主包依赖**，
   自己提供一个返回 `{ value }` / `{ issues }` 的同步 Standard Schema。
10. **工具的 `parameters` 是原生 JSON Schema，宿主原样下发给模型**：`ToolsService.register()` 只校验
    `output.schema`（`dsh-tools/lib/index.js:433-445`），`projectToolSchema()` 把 `parameters` 原样投影给模型
    （`:366-376`），所以 `parameters` 必须是根 `type: 'object'` 的 JSON Schema——把 JSON Schema 降级成某个
    「作者格式」属性表只会得到一个非法 schema。宿主支持的 schema 关键字子集是 `type / oneOf / properties /
    required / additionalProperties / items / enum / const` 加 annotations（`description`、`title` 等），
    出现其它关键字（`default`、`pattern`、`minLength`、`format`…）会被拒绝（`dsh-tools/lib/shared-*.js:210-221`）。

本轮（v0.2.8）已按第 8-10 条整改：`package.json` 声明 `engines.dsh`、peer 全改区间；`src/index.js` 不再 import 任何 `@deepseek-ai/*`（自带同步 Standard Schema）；工具直接下发 `parameters` 原生 JSON Schema。
已在 DSH 0.2.2-rc.1 实机验证：重启后 10 个 `studio_*` 工具与 6 个 `studio-*` 技能都已注册，`studio_works → studio_outline → studio_read → studio_search → studio_propose → studio_apply → studio_undo` 全链路走通，回退后作品库回到测试前状态。

## 已知限制

- **dsh 皮肤是 CSS 层覆盖**（`app/plugin/dsh/dsh.css`，约 2,960 行、零 `!important`）；组件逻辑只在
  必要处加了显示条件（恍然梦入口、设置页 AI 分区、窄栏侧栏宽度），功能代码零改动。
- 少数颜色写在组件内联样式里（画布连线标签、幕布行标签色、MubuTree 折叠按钮内边距），CSS 层压不过，
  需 `!important` 才能改——按"零 !important"的约定保留原样。
- 新建关系的默认颜色回落为 accent，所以「开箱新建」的关系连线是同一种蓝；多色来自既有数据。
- 已应用过的提案 + 版本历史等次要弹层只做了令牌级跟随，没有逐屏像素核对。
- iframe 里没有 Electron 拆窗、全局快捷键与 `window.native` 全量能力（shim 只覆盖最小子集）。
- 桌面版窗口窄于 1180px 时**不会**被插件窄栏规则影响（该钳制带 `nsPlugin` 守卫，桌面分支不生效）。
- 前端产物是热的（见「更新前端产物」），但 `src/*.js` 这类**插件服务端代码**仍要靠 DSH 的 HMR / Plugin Manager
  重载，或重启一次；本 profile 没有开启按目录监听。
