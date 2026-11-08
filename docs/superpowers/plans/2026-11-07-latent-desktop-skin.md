# 插件版「隐现」完整前端接入桌面皮肤 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将插件当前整套前端作为桌面版可选「隐现」皮肤接入，同时保留四套旧皮肤、桌面数据与原生能力。

**Architecture:** 在桌面同一 Vue 应用里新增皮肤视图层；以 `ui.skin==='dsh'` 选择新视图，宿主仍由 `__NS_PLUGIN__` 决定。复用桌面 Pinia、Dexie、作品库、Tiptap、Electron 和 AI；共享逻辑改动独立验证。

**Tech Stack:** 沿用项目现有 Vue 3、Pinia 2、Naive UI 2、Tiptap 2、Dexie 4、Vite 6、Electron 33；复用本地 WebGL2/CPU 流动背景及现有 Node/CDP/Playwright 验证工具，不新增框架。

**Spec:** [接入设计](../specs/2026-11-07-latent-desktop-skin-design.md) 与 [桌面能力及前端适配补充规格](../specs/2026-11-07-latent-desktop-adaptation.md)。本轮修订重点：把拆窗、恍然梦和五类桌面设置从概括性“保留能力”落实为界面布局、状态、窗口路由和逐项验收。尚未实施。

## Global Constraints

- 来源根：`F:/deepseek workplace/dsh-novel-studio/app/`；实施目标根：`F:/deepseek workplace/novel-studio/`。下文 Files 均相对目标根，明确标“来源”的除外。
- 皮肤 ID `dsh`，显示名「隐现」；桌面构建 `__NS_PLUGIN__=false`；桌面库名 `novel-studio`；不得注入 `window.__NS_AGENT__='dsh'`。
- 保留 original / gravity / glaze / crimson；默认皮肤及用户原选择不变；未知皮肤和不支持的 surface 回落 original。
- 单一作品库、单一正文编辑会话；不得 iframe 嵌入插件 SPA，不得按皮肤 key 重建 App/StudioWorkspace/EditorPane。
- 不覆盖目录、不清理已有未提交改动、不安装无关依赖、不以真实用户 profile 运行写入性验收。
- 默认不升 Dexie schema；不得自动重写旧作品或补造历史日志；不得让皮肤切换决定正文保存算法。
- 本次计划文件位于插件仓库便于当前会话审阅；实际代码、测试与发布改动进入桌面仓库，插件仓库只读作来源。
- 用户已明确要求桌面拆窗、恍然梦入口及更多设置项的前端适配；不得只保留 API、把新增入口都塞进更多菜单，或原样沿用插件三类设置。
- 拆窗模块身份必须与 URL、原生锁一致；禁止复制插件只改本地 spec.type 的跨模块导航。保存失败的窗口保持打开。
- AI/创作台/预设窗须适配实际输入、列表、工具与浮层；“只接令牌”和“入口存在”不能代替专项视觉/操作验收。

## Review Focus

- 皮肤切换发生于 IME 输入或局部 contenteditable 未提交时：必须保留最后输入与现有编辑权；Task 4/5/6/9 验证。
- 多窗口同时选皮肤、切作品或关闭面板：最终偏好收敛，旧请求不覆盖新作品状态；Task 1/5/6/9 验证。
- 旧图谱坐标、未知字段与缺 fmt 的历史：互切不改变原值，读写兼容；Task 2/5/6/8 验证。
- 正文事务失败后重试、AI 应用和撤销：日志不重复、记忆任务语义不退化；Task 2/8 验证。
- CSS 全局规则、Teleport、暗色属性和 GPU 生命周期：退出隐现无样式残留、漏监听或运行背景；Task 3/4/7/8/9 验证。

## 任务依赖与交付边界

顺序：0 → 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9。Task 5/6 都依赖共享状态与布局壳；不要在同一 stores/work.js 上并行合并。每个任务完成后验证并形成一个可审阅提交；未完成全部任务前注册项通过开发开关保持不对正式用户开放。

建议开发开关：`VITE_NS_LATENT_SKIN=1` 时启用桌面隐现候选项，发布验收通过后去掉门禁。默认关闭时即使库内 skin=dsh 也回落 original。开关只作用目标桌面构建，不改变来源插件构建。

## Task 0：冻结当前前端与桌面基线

**Files:** 来源全部 `app/src/**`、`app/plugin/dsh/**`、`app/vite.config.mjs` 及运行时参考 `src/client/iframe-shim.js`、`lib/client.js`、`src/core/**`；目标 `src/**`、`plugin/dsh/**`、`electron/**`、`packages/novel-core/**`、package/vite 配置。新增 `docs/skin-integration/latent/source-manifest.json` 和 `port-map.md`。

**Interfaces:** 产出来源/目标路径、HEAD、工作树 SHA-256、差异类别、模块归属；port-map 为每个候选文件标记复用、局部新视图、手工合并或保留桌面，不将 HEAD 当现状快照。

- [ ] 读取两仓当前 git status、适用 AGENTS.md、附着工作区；记录与本方案编写时的差异。保存现有未提交变更的可恢复副本，不自动 stash 或 commit 用户改动。
- [ ] 生成源码清单，复核本方案的 258/54/82/138 差异计数；源码变化时先重做受影响模块映射。补查 `app/docs/使用手册.md`、字体许可及 public 资源。
- [ ] 冻结构建依赖：记录存在的 package-lock/pnpm-lock/yarn.lock、app/node_modules 联接目标及 Vue/Pinia/Dexie/Tiptap/Naive UI/Vite/Electron 的实际已安装版本；没有锁文件时把本地解析结果写入基线，不先联网更新依赖。
- [ ] 先交付测试脚本兼容表：逐个检查是否纯 Node、是否支持端口/profile 参数、是否固定 dev 数据目录，以及是否存在 killAll、全局进程终止、数据目录迁移/删除。`tools/dataDir-verify.mjs` 当前会固定 dev 并结束其他 Electron/Vite，禁止原样运行；先改为测试专用入口，只操作自己启动的进程和临时目录。`tools/_ai-test-profile.mjs` 的允许列表也需适配测试 profile。复用 settings-startup-verify 的唯一 profile 启动和 getDataLocation 实际路径断言，仅更换 CDP 端口不足以证明隔离。
- [ ] 在独立测试 profile 运行目标既有构建和相关基线测试，记录现有失败。启动/截图前确认 profile 数据目录不重定向到用户目录。
- [ ] 采集来源**DSH 宿主内当前构建实际页面**的模块截图、可见按钮与交互清单；记录宿主亮暗/字号和 shim 产生的实际 --ns-* 计算令牌。裸 app 构建不能独立替代来源基线；离线复现注入采集的令牌快照。记录来源构建是否与源码一致，必要时在临时目录构建来源副本，不能覆盖用户的 assets/app。
- [ ] 将补充规格的桌面差异表转成 `port-map.md` 的覆盖清单：拆窗九类窗口、入梦/浅眠/模块助手/选区发送、五类设置全部项目；每项记录原组件、原 handler、新界面位置、状态、测试和截图。恢复默认范围按桌面外观项固定，不沿用插件仅四项快照。
- [ ] 交付可复现的 port-map 和基线报告后提交本任务文档。

**Verification:** 目标运行 `npm run build`、`node tools/skin-unit-verify.mjs`、`node tools/original-workspace-unit.test.mjs`。构建输出与测试退出码记录在报告；已有失败不得当成本次已修复。

## Task 1：开放第五套皮肤与可靠切换

**Files:** Modify `src/skins/registry.js`、`src/stores/ui.js`、`src/services/appbus.js`、`src/components/SkinPicker.vue`；Create `src/services/appearance-transition.js`、`src/skins/latent/runtime.js`、`tools/latent-registry.test.mjs`、`tools/latent-preference-verify.mjs`。

**Interfaces:** 保留旧 registry 函数签名；新增 `isLatentSkin(value): boolean`；`installLatentRuntime({ui,document,window}): () => void` 安装可释放监听；切肤仍为 `ui.setSkin(value): Promise<void>`，本窗口保存屏障成功、偏好落库成功后显示并广播。`appearance-transition.js` 提供 `registerAppearanceGuard(guard:()=>Promise<void>):()=>void`、`syncSkinPreference():Promise<'applied'|'deferred'>`；远端同步只更新本窗应用状态，不反写 skin。协调器内维护每窗口最新待应用值，ui.skin 仍表示实际显示值。

- [ ] 先写注册/持久化用例：开关启用有且仅有五项，dsh 支持 shelf/work/panel，未知值和 surface 仍回落 original；关闭开关不出现正式候选项。
- [ ] 先写失败用例：appconfig.put 拒绝时 skin/theme/body 不变；连续操作不被早发迟到请求覆盖；广播后其他窗口不重复写库。另窗正在 IME 或局部提交失败时，只延期该窗应用，不反写旧值；恢复保存后重读数据库并应用最新值，普通偏好同步不被阻断。
- [ ] 运行上述新用例，确认因未实现契约而失败，再扩展 registry 与切肤入口。复用已有受众过滤接口，不把 isStudioSkin 扩成隐现判断。
- [ ] runtime 只随皮肤切换启停，不调用 installDshSkin，不创建“强制纠正 data-skin”的 observer。改造 appbus→loadPrefs 的 skin 写入路径：启动直接载入，其余本地/远端变化均经过协调器，待应用状态给出可重试提示。收到乱序事件重读最后成功落库值并丢弃过期异步结果。
- [ ] 新旧注册和偏好测试通过后提交；本任务不宣称 UI 已接入。

**Verification:** `node tools/latent-registry.test.mjs`、`node tools/skin-unit-verify.mjs`；原生隔离环境运行 `node tools/latent-preference-verify.mjs`。期望无重复广播写入、拒绝时保持原外观。

## Task 2：先建立数据兼容与统计事务

**Files:** Modify `src/db/repo.js`、`src/db/database.js`、`src/services/autosave.js`、`src/stores/work.js`、必要时 `src/services/ai/application.js` / `memory-queue-core.js`；Create `src/services/writing-word-delta.js`、`src/services/latent/character-preferences.js`、`tools/latent-data-compat.test.mjs`、`tools/latent-save-verify.mjs`。从来源 writing-stats-core 提取纯字数计算，完整分析在 Task 8 接入。

**Interfaces:** 保留 `putRow(table,row,opts)`，增加 `opts.recordWordDelta?: boolean`；`writing-word-delta.js` 导出 `chapterWords(row):number`、`chapterWordChange(previous,next):number`，只依赖 wordcount；保留 `addRevision(entityType,entityId,content,fmt?)` 的旧调用；保留 `loadCharGraph()/saveCharGraph(positions)` 平铺坐标契约；新增 `loadCharCamera(key): Promise<Camera|null>`、`saveCharCamera(key,cam): Promise<void>`。`Camera={x:number,y:number,z:number}`，相机存 `latent:charCamera:<workId>`。

- [ ] 编写真实事务失败/重试用例：正文增加 10 字，模拟 wordlog 或 airuns 写失败，正文和日志均不提交；重试只记一次 +10；删除/恢复、跨作品不能误记其他作品字数。
- [ ] 写旧图谱和未知字段往返用例：平铺坐标保持不变，相机写入不包装旧 key，包含 positions/camera 的旧导入记录能读取但不在打开页面时自动改写。
- [ ] 写 autosave 错误和 AI 记忆撤销用例：维持现有错误文字；显式 memoryIntent:null 取消合并队列里的旧意图；普通 undefined 不取消。先跑失败再实施。
- [ ] 合并插件原子统计方案到桌面共享保存路径，停用 installWordLogHook / prevCounts 的旧计量，逐一核对 AI 应用、撤销、正式稿确认与库同步写入路径；未经作者正文保存的导入/远端 hydrate 不假装当天创作。
- [ ] 加入可选 fmt 与事务完成后的历史通知；不把历史表加入 SOURCE_TABLES，不增加 schema，不自动重算旧日志。
- [ ] 新事务、兼容和现有记忆/工作流测试全部通过后提交。

**Verification:** `node tools/latent-data-compat.test.mjs`、隔离 Electron 中 `node tools/latent-save-verify.mjs`、`node tools/memory-queue-unit-verify.mjs`、`node tools/workflow-save-unit-verify.mjs`、`node tools/writing-application-race-verify.mjs`。运行前核对旧脚本的前提与 profile；不盲连 9222 正式实例。

## Task 3：迁入样式、资源、桌面主题桥与背景生命周期

**Files:** Create `src/styles/skins/latent/`（基础覆盖、language、flow-shell、模块样式及 index）、`src/services/latent/{blue-noise,cpu-backdrop,flow,latent-gl,palette}.js`、`src/skins/latent/theme.js`、`src/assets/writing-stats-backdrop.webp`；Modify `src/main.js`、`src/App.vue`；Create `tools/latent-theme-verify.mjs`。

**Interfaces:** `useLatentTheme(ui): ComputedRef<{dark:boolean,overrides:object}>`；runtime 负责维护局部 token 与 nsDark；保留 `mountFlowBackdrop(canvas,options)` 的 setPalette/resize/stats/dispose 等现有来源接口。

- [ ] 写主题用例：night 为暗，其余为亮；浅色无 data-ns-dark 属性；NConfigProvider 和 teleport 浮层一致；切回四种旧皮肤后 token 和样式与基线一致。
- [ ] 写背景用例：无 WebGL2、context loss、reduced motion、隐藏/销毁页面、反复换肤后引擎数与监听不增长。先运行失败。
- [ ] 搬入真实来源资源，核对 hash/字体引用/许可；CSS 保持原有效顺序，所有新通用选择器加皮肤或唯一根作用域。
- [ ] 明确移除目标迁入样式中插件专属 `.module-agent{display:none}`（来源 dsh.css 约 760–763 行），并审计其他按 dsh 皮肤隐藏 AI/拆窗/纸面控件的选择器。模块助手验证实际尺寸、可见性与点击，不只检查 DOM 存在。
- [ ] 在 App 根据 active skin 选覆盖，不把桌面 nsPlugin 改 true；不伪造 nsHost，逐条清理宿主专属 CSS 和标记依赖。维护桌面自身主题数据来源和清理权。
- [ ] 字体加载、亮暗/浮层、GPU/CPU 与退出清理用例通过后提交。

**Verification:** `npm run build`；隔离原生环境 `node tools/latent-theme-verify.mjs`，要求 theme/provider 一致、无 pageerror、切回旧皮肤无新增残留。

## Task 4：桌面动作外壳、拆窗、恍然梦与书架正文

**Files:** Create `src/components/skins/latent/LatentShelf.vue`、`LatentTopbar.vue`、`LatentWorkbench.vue`、`LatentDesktopActions.vue`、`LatentPanelTopbar.vue`、`src/services/latent/desktop-actions.js`；Modify `src/components/Bookshelf.vue`、`Workbench.vue`、`EditorPane.vue`、`EditorToolbar.vue`、`EditorContextMenu.vue`、`RightPanel.vue`、`ChapterTree.vue`、`src/components/StudioWorkspace.vue`（仅必要的激活/焦点边界）、`src/components/PanelHost.vue`、`src/components/ai/AiAssistantPanel.vue`、`src/components/agent/AgentWorkbench.vue`、`src/components/ai/PresetWindow.vue`（后三者仅外观/布局与入口适配）、`electron/panels.js`、`electron/preload.cjs`；Create `tools/latent-writing-verify.mjs`、`tools/latent-window-verify.mjs`、`tools/latent-ai-ui-verify.mjs`。

**Interfaces:** LatentShelf 沿用来源 works/total/loading/busy/query/openStats/firstChapter/menuOptions props 和 open/menu/create/settings/navigate/select-work 事件；LatentWorkbench 提供 topbar/directory/default/notes/ai slots，接收 module/focusMode/readMode 和 drawer 相关状态，不负责保存业务。

`desktop-actions.js` 导出 `buildDesktopActions({surface,module,hasWork,windowType,lockState,busy}):DesktopAction[]`，`DesktopAction={key,label,disabled,reason?,active?}`；只定义动作描述，不调用生成业务。AI handler 复用 `enterDreamMode/enterLightSleepMode`；窗口动作复用 `popOut/focusPopped/isPopped/panelSetEntity`。新增原生 `panelFocusMain():Promise<{ok:boolean}>` 仅用于前往主窗，不改变当前窗锁或关闭状态。AI 停靠沿用 300–640px 偏好，净中心宽度不足 520px 时转覆盖抽屉，临时形态不写目录/批注偏好。

- [ ] 定义并写入书架空态、单书、环绕、多书筛选后焦点、CRUD 和接续章测试；正文记录编辑器对象身份、Teleport 宿主 DOM 对象身份、撤销历史、选区、滚动与 pending 内容，互切后逐项验证，不能只检查同名 ID 存在。
- [ ] 写输入法 composition 与正在打开弹层时的切肤测试；切肤不在 composition 结束前销毁输入宿主，局部提交失败保持旧界面。
- [ ] 先写桌面动作与状态用例：书架只有入梦、工作台双模式、各模块可拆、已拆出转“前往窗口”、重复点击聚焦、保存/移交中禁用、失败保持原界面；窗口身份/实体锁不能因本地模块导航改变。对应 D-01～D-03。
- [ ] 搬入书架和布局壳，接父层已有动作；用皮肤条件选择布局，不整体复制插件 Bookshelf/Workbench 覆盖桌面逻辑。
- [ ] 正文共享 EditorPane/Tiptap，只按皮肤修改展示与 toolbar slot；保持 writing-editor-host 等 Teleport 宿主 DOM 身份稳定，不在换壳时删除再创建同名目标。保留纸面选择、章节状态/目标/书签/历史、AI 选区动作、阅读/专注和双向链接。
- [ ] 新顶栏以 LatentDesktopActions 提供直接可发现的入梦/浅眠/当前模块独立窗。1080px 放不下时切紧凑模块工具行；更多按本模块/窗口/写作工具/应用分组，不能靠滚动藏关键桌面入口。大纲专用顶栏在 Task 5 复用同一动作模型。
- [ ] 内容独立窗用 LatentPanelTopbar：作品/实体标题、保存/错误、保存并关闭、聚焦主窗、模块助手。保留类型固定与 panelSetEntity 锁迁移；跨模块操作走原生打开/聚焦目标窗，不只改 spec.type。保存失败不执行 finally-close，普通/系统关闭仍走现有保存拦截。前往主窗和保存关闭使用不同文案。
- [ ] 恍然梦书架入口接 DreamLaunchDialog，工作台入梦/浅眠分别接既有 entry-modes；已拆出 AI 时浅眠聚焦原窗。模块助手与选区发送保留实际上下文及桌面文案，不能沿用 DSH 聊天桥。
- [ ] 为 AI 停靠/覆盖抽屉建立可用宽度预算与焦点管理；关闭抽屉/切肤不卸载会话、不取消流式生成。AiAssistantPanel、AgentWorkbench、PresetWindow 保留业务，在隐现下适配模型/预设/功能调整、候选、错误、输入区、列表和所有弹层，不仅改 palette。
- [ ] 保留完整模块、设置、搜索入口及所有 Teleport 目标。以 isLatentSkin 控制外观，以 nsPlugin 控制宿主行为。跨主窗/内容窗/AI窗适配可见状态，不用 display:none 误藏桌面能力。
- [ ] 验证单编辑器、无丢字及旧书架/正文回归后提交。

**Verification:** 新 `node tools/latent-writing-verify.mjs`、`node tools/latent-window-verify.mjs`、`node tools/latent-ai-ui-verify.mjs`；按隔离前提执行旧写作/AI entry/多窗口/预设脚本。覆盖 D-01～D-05、D-08～D-09。截图主窗 1080/1280/1440、内容窗 800、AI 窗 380、创作台与预设窗实际最小宽；逐项检查文字、控件、状态和弹层，布局补充 380/560/760/900/1180 边界。

## Task 5：大纲与完整设定工作区

**Files:** Create `src/components/skins/latent/outline/`（来源 OutlineWorkspace、OutlineTopbar、OutlineNodeDetail、Glyph/layout 等及新 LatentOutlineCenter）、`src/components/skins/latent/lore/`（来源 lore 目录及局部版 MubuView/MubuTree/LoreDetail/LoreGraph/LoreEntryList）；Create `src/services/latent/lore-core.js`、`lore-editor-dom.js`；Modify `src/components/OutlineCanvas.vue`、`src/components/outline/canvas-model.js`、`src/stores/work.js`、`src/stores/ui.js`、`src/services/doublelinks.js`、`src/services/graphview.js` 及 Workbench/PanelHost 模块选择；Create `tools/latent-lore-compat.test.mjs`，迁入 layout/core 测试到 tools。

**Interfaces:** 新视图继续使用现有 outlines/olnodes/mubu/lorelinks；`graphview.fit(bounds,{minZoom=0.3,maxZoom=1.2}={})` 保留单参行为；新增 mubuPath/mubuCheckpoint/mubuUndo 及 focusLoreNode(id,path) 边界，旧 jumpTo/parseTarget 签名不变。双链以 ID 为主，同名标题歧义不自动选错目标。

- [ ] 迁入纯函数 layout/core 测试，新增老作品缺 heading/kind、自定义字段、深层树、重复标题、断链/循环、跨作品引用隔离用例，运行确认新增契约未实现。
- [ ] 大纲新视图复用共享画布与文本模型；容器展开、选择、缩放、结构栏和详情布局按皮肤启用，不改旧皮肤默认 outlineView。
- [ ] 大纲专用顶栏复用 Task 4 桌面动作；明确分开画布设置与应用设置，保留入梦/浅眠/拆窗。独立大纲窗不复制插件 outlineNavigate 本地改 type 的行为，跨模块操作走窗口服务；验证大纲窗内不能绕过设定/人物的编辑锁。
- [ ] 设定迁入新三种视图与引用/预览，局部改造版组件留在 latent/lore；旧 MubuView 等继续给四套皮肤用。补入 work/ui 必需动作时保留旧公开字段及行为。
- [ ] 默认根节点补齐仅在用户主动操作时执行；读旧树不重排/写回。撤销按作品隔离并保存完整对象；切肤、跨作品、异步加载用 workId/请求序号阻止旧请求写新状态。
- [ ] 设定局部富文本在离开/切肤/拆窗前提交，失败阻止移交；完成引用跳人物/正文/大纲和回退路径测试。
- [ ] 写入 JSON 备份→恢复→桌面 packages/novel-core 同步→重启的往返测试；来源插件 lore-persistence 测试不能直接证明桌面链路，需换目标真实库实现。
- [ ] 新视图与四套旧大纲/设定通过后提交。

**Verification:** `node tools/latent-outline-layout.test.mjs`、`node tools/latent-lore-core.test.mjs`、`node tools/latent-lore-layout.test.mjs`、`node tools/latent-lore-compat.test.mjs`；原生新 `tools/latent-lore-verify.mjs`，旧 `tools/outline-skin-integration-verify.mjs`、`tools/lorelink-verify.mjs`、`tools/mubu-tags-verify.mjs`、`tools/line2line-verify.mjs` 按隔离前提执行。要求字段往返不丢失、坐标/结构不因切肤改变。

## Task 6：人物与灵感

**Files:** Create `src/components/skins/latent/characters/`（来源完整 characters 目录）；必要局部版 SnippetCenter/SnippetList 放 `src/components/skins/latent/snippets/`；Modify Workbench/PanelHost、`src/stores/ui.js`、`src/stores/work.js`、`src/skins/graph-presentation.js`；Create `tools/latent-char-layout.test.mjs`、`tools/latent-character-verify.mjs`。

**Interfaces:** 保持 `work.charView='list'|'graph'`，新壳内部转换 profile；`setCharView(next)` 对非法值回落 list；隐现 graph geometry 增加普通 134×84、选中 156×103、scaleX/Y=1 的专用分支；旧三种艺术投影不变。新 charPrefs/charstate 状态映射至 latent 命名空间。

- [ ] 写旧坐标正反投影、新节点端口/选中尺寸、相机分档、不同作品状态隔离、异步切书与卸载延时保存用例，先运行失败。
- [ ] 搬入完整名录/卷宗/上下文/检查器/关系图，接 Task 2 的旧坐标与独立相机接口；保存节流必须捕获 workId，不能在卸载时把旧图写入新作品。
- [ ] 复用桌面人物图片导入与 AI；人物文本离开/切肤前提交。测试关系方向、拖拽/框选、删除、双链定位和编辑锁。
- [ ] 灵感使用原有 store/action，迁入插件现有展示差异与统一外壳，保留标签、导出/引用、AI 与拆窗。
- [ ] 人物/灵感全流程、新旧图谱互切和源码数据不变测试通过后提交。

**Verification:** `node tools/latent-char-layout.test.mjs`、`node tools/skin-unit-verify.mjs`；隔离 `node tools/latent-character-verify.mjs`，旧 `tools/chargraph-verify.mjs`。新人物三列按 1100 边界及 800px 内容面板验证。

## Task 7：完整桌面设置与全局弹层

**Files:** Create `src/components/skins/latent/settings/`（来源完整 settings 目录并扩展为桌面五页）、`src/components/skins/latent/settings/SettingsModelPage.vue`、`SettingsKnowledgePage.vue`、`src/components/settings/DataLocationSettings.vue`、`src/services/latent/settings-entry.js`；Modify `src/components/SettingsWindow.vue`、`src/App.vue`、`src/components/PanelHost.vue`、`src/stores/ui.js`、`src/services/appbus.js`、`src/components/ai/AiAssistantPanel.vue`（定向设置入口）、`src/components/ai/AiSettings.vue`（仅必要响应式适配）、`electron/panels.js`、`vite.config.mjs`；必要时 Modify `src/services/exporter.js`；Create `tools/latent-settings-prefs.test.mjs`、`tools/latent-settings-verify.mjs`、`tools/latent-settings-routing-verify.mjs`、`tools/latent-settings-coverage.test.mjs`。

**Interfaces:** 新旧设置同用 SkinPicker 和 ui.setSkin；新增 applyPref/retryPrefs/saveSettingsUi 等只服务普通设置项，不替换 setSkin 的写成功后显示契约。`SettingsPage='appearance'|'ai'|'knowledge'|'data'|'about'`；`openSettings(ui,{page,settingId}={}):Promise<boolean>` / `leaveSettings(ui):void` 保留来处视图。模型设置用 AiSettings/useAiStore，知识库用 KnowledgeModelSettings；DataLocationSettings 复用原 fileio/native 动作，不把凭据/路径配置变成通用 appconfig。

设置统一使用 `{type:'settings',workId:'app',entityId:''}`，`settingsPage/settingId` 作为单独白名单字段经 panelOpen 传递，不参与窗口锁键。新窗在 URL 启动查询中携带定位；既有窗通过定向 `settings:navigate` 消息更新页面并聚焦；补齐 panels.js 的 spec 归一/URL/复用分支，renderer 经现有 app:event 接收。无显式 page 的普通齿轮保留最近分类。构建版本从目标 package.json 注入 `__NS_VERSION__`。

- [ ] 写五页枚举与完整覆盖测试：用补充规格第 5 节的固定项目集合核对导航、settings-catalog、data-setting 定位和旧动作映射；缺一项失败，不能沿用插件三页白名单。
- [ ] 写新设置能切出隐现、主题/纸面/字体/字号失败重试、偏好广播不顶走分类的测试。恢复默认/撤销扩展为字体/字号/纸面/theme/顶栏的桌面外观项；不改 skin、AI/知识库、作品或目录。
- [ ] 先写设置首次打开/已有窗/加载中/就地回退的定向路由用例；AI 未就绪、“管理模型”和 go-ai 均落到 ai，普通齿轮不抢页面。补测表单尚未失焦时跳页，提交失败不丢值。
- [ ] 将插件玻璃侧栏和内容语言扩为外观、模型设置、知识库模型、备份与存储、帮助与关于五类；模型页复用 AiSettings、知识库页复用 KnowledgeModelSettings，不能嵌套旧 SettingsWindow 外壳。模型内容区小于 640px 时供应商/详情改上下排列；仅 appearance 占预览列。
- [ ] 用五页元数据统一页标题、面包屑、说明、页脚和返回；替换插件仅三类的 breadcrumb/footRight 条件，扩展 settingsPage 合法值、每页滚动记忆与搜索定位；重载偏好不得把 ai/knowledge 回退成 appearance/about。
- [ ] 按覆盖表接入供应商完整 CRUD/启停、Base URL/API格式/密钥、连接测试、模型列表/逐模型参数、温度/隐私/自动记忆；知识库继承连接、开关/模型/不支持状态/go-ai 不遗漏。供应商预设与写作预设分开，后者进入原 PresetWindow。
- [ ] 数据页完整接入原生存储管理：当前路径/默认标识、打开目录、更改/迁回默认、保留旧副本选项、旧目录大小/打开/两类清理、失效路径警示与清除记录。提取 DataLocationSettings 与旧设置共用动作，隐现外观重做行和确认框，长路径不盖住操作按钮，迁移显示重启进度并防重复。
- [ ] 搜索扩展模型/API/向量/纸面/存储/清理等条目，定位真实控件；索引只存静态说明，不含真实密钥/路径。纸面选择与预览保留；页头、侧栏、分组、状态、危险动作和响应式均按隐现设计统一。
- [ ] 无框设置窗口保留 drag/no-drag 区、关闭键与 panelReady。设置打开失败就地回退时保持 StudioWorkspace 已挂载，返回后选区和位置不变；根组件将 ui.view=settings 映射为 work surface，避免 resolveSkin 意外回落 original。
- [ ] 导入导出/备份恢复继续调用桌面原生 API；取消保存不能记成功备份或更新时间；全局搜索/回收站/历史/帮助/菜单按新皮肤约束 Teleport 和焦点。
- [ ] 确认关于页显示桌面真实版本；新设置和旧设置首帧/功能回归通过后提交。

**Verification:** `node tools/latent-settings-prefs.test.mjs`、`node tools/latent-settings-coverage.test.mjs`；隔离 `node tools/latent-settings-verify.mjs`、`node tools/latent-settings-routing-verify.mjs`、`node tools/settings-startup-verify.mjs`（开发与 `--production` 两种）；D-05～D-09 均有断言。1000×700 与 800px 设置窗逐页截图及操作，模型表单/预览/长路径/确认框不溢出；数据迁移相关旧脚本先按 Task 0 改造隔离后运行。

## Task 8：写作速览、分析与历史明细

**Files:** Create `src/components/skins/latent/stats/`（来源完整 stats 目录）、`src/services/writing-stats-core.js`（导入并复用 Task 2 的 writing-word-delta.js，不保留第二份算法）、`writing-analysis-data.js`、`writing-analysis-model.js`、`writing-stats-motion.js`；Modify `src/db/repo.js`、`src/stores/ui.js`、`src/App.vue`、新顶栏/面板统计入口；Create `tools/latent-writing-stats.test.mjs`、`tools/latent-writing-analysis.test.mjs`、`tools/latent-analysis-verify.mjs`。

**Interfaces:** `readWritingStats(workId,days=30): Promise<{choices,stats}>`；`readWritingStatsRevision(id,workId,chapterId)` 二次校验归属并按需加载 content；`ui.statsWorkId=null` 表示全库。保留旧 statsOpen 的调用，旧皮肤只渲染原 StatsModal，新皮肤只渲染一个 WritingStatsDialog。

- [ ] 迁入来源纯分析测试，加入同名作品/重复局部 ID、未分卷/孤立节点、删除来源、负数与净零日、缺 fmt 版本、跨日/本地日期、无历史日志用例。
- [ ] 复用 Task 2 已建立的字数写入链路，接入事务读取与已提交历史刷新；概览不加载全部历史正文，点版本明细才加载并校验作品/章节归属。
- [ ] 迁入当前速览与完整分析，保持截图中的动效/布局/比较；关闭、ESC、焦点恢复、退出皮肤、html 滚动锁和异步请求清理都测试。
- [ ] 新入口覆盖书架、正文、其他模块、设置和内容面板；对没有当前作品的 AI/应用窗口使用确定范围，不能残留上一个作品上下文。
- [ ] 核对旧 StatsModal 在共享统计算法更新后无双计数；数据测试、原生分析与旧统计回归通过后提交。

**Verification:** `node tools/latent-writing-stats.test.mjs`、`node tools/latent-writing-analysis.test.mjs`；隔离 `node tools/latent-analysis-verify.mjs`；重复 Task 2 的事务重试断言，核对 7/30/90 日日期边界、长章节分页及版本按需加载。

## Task 9：全量互切、多窗口、保真和发布

**Files:** Create `tools/latent-integration-verify.mjs`、`tools/latent-visual-verify.mjs`、`docs/skin-integration/latent/verification/`；Modify `package.json` 只增加必要验证入口；验证通过后移除开发门禁、更新目标 README/CHANGELOG。

**Interfaces:** 测试报告记录 profile、构建标识、来源哈希、屏幕尺寸、用例结果、控制台错误、截图路径、源数据前后摘要；任何未通过项不得只用“构建成功”替代。

- [ ] 完成新皮肤所有模块及弹层的按钮动作清单，逐条给出通过证据；AI/创作台/预设窗口完成实际工具、表单、输入、列表和浮层适配，不能以令牌统一或入口存在结项。逐条关闭补充规格 D-01～D-09，报告附新桌面区域截图及交互证据。
- [ ] 执行四个旧皮肤↔隐现的双向切换矩阵，在书架/正文/大纲/设定/人物/灵感/设置/分析中验证；包含未保存输入、输入法、弹层、图谱拖拽和异步保存。
- [ ] 主窗与正文/大纲/人物/设定/灵感/设置/AI/创作台/预设窗同时打开，验证偏好收敛、首帧、无框拖拽、锁保持、正文只读占位、关闭保存和锁释放。
- [ ] 以测试数据运行备份恢复、库同步、重启往返；“只切肤”的源表数量和规范化哈希完全一致，appconfig 只发生允许的皮肤偏好写入。
- [ ] 对照来源实际渲染核对视觉：统一测试作品、字体、主题、尺寸、DPR，流动背景定时/减动画后截取；像素差异不能代替人工检查布局、文字、遮挡和入口。
- [ ] 连续 20 轮换肤/模块/面板开关，核对编辑器身份、GPU/CPU 实例、RAF、observer、全局监听无累计。采集旧皮肤与新皮肤同环境空闲和编辑时表现，新增持续资源占用须解决或明确阻止发布。
- [ ] 执行 `npm run build`，验证打包 `app://` 中所有离线资源、动态 chunk 和相对路径；开发模式通过后仍需 production 全流程验证。
- [ ] 全部验收通过后去掉门禁，保留默认原选择。再执行 `npm run dist` 生成 Windows 产物，在隔离 profile 上做安装/启动/设置/编辑/重启/切回旧皮肤冒烟；不覆盖用户正在使用的安装目录。
- [ ] 输出验收报告、截图、已知限制、各模块提交与回退说明后提交发布改动。插件来源仓库不随桌面发布重构或同步代码。

**Verification:** `node tools/latent-integration-verify.mjs`、`node tools/latent-visual-verify.mjs`；原多窗口、四套皮肤、写作与 AI 回归按各脚本前提运行。新脚本必须自行启动/验证独立 profile；旧脚本须先通过 Task 0 兼容审计并改造固定 profile、全局终止进程和目录副作用，再接入隔离端口，不能直接使用默认 9222 写用户环境。

## 工作量与实施节奏

估算为单人净工程日，含实现和局部验证，不是工期承诺：基线及基础设施 2–3 日；书架/正文、桌面动作与 AI/拆窗适配 3–5 日；大纲/设定 2–4 日；人物/灵感 1–2 日；五页设置/分析 2–4 日；综合回归/打包 2–3 日。合计约 **12–21 个工程日**，Task 0 冻结后按实际差异校正。此次较初稿增加的是明确的桌面前端适配与专项验收，不将这些工作视为免费附带。

阶段检查点：

1. 基础设施可切换：完成 0–3，旧四皮肤与数据库基线不退化。
2. 桌面创作界面可走通：完成 4–6，所有创作模块接入真实数据，拆窗/入梦/浅眠/模块助手具备新界面及状态反馈。
3. 产品能力完整：完成 7–8，五页设置逐项映射、定向路由可用，设置能切出、桌面功能与分析齐备。
4. 可发布：完成 9，通过开发/production、真实 Electron 多窗口和五皮肤回归。

## 回退与维护

- 试验阶段关闭门禁即可隐藏候选项；正式阶段撤销新皮肤可见性并让已存 dsh 回落 original。
- 不删除新字段、不逆向修改用户作品、不撤销已成功保存的正文。相机/新布局键保留无害，旧组件继续读取既有坐标。
- Task 2 是共享逻辑变更，不能随视觉回退盲撤：如需撤销，必须整体恢复旧计量钩子与所有调用方，保证不会新旧算法同时计量。
- 以后插件设计更新按 source-manifest + port-map 逐模块同步；本轮不建立双仓自动双向同步或独立共享包，避免把接肤扩为基础架构重构。

## 计划自检

- 已覆盖整套前端、桌面能力、旧皮肤、双向切换、多窗口、持久化、原生文件与生产资源。
- 已明确尚未批准的推荐假设；没有把方案建议表述为用户决定。
- 新接口与旧接口分开列出；数据格式、统计事务、IME、请求竞态、主题存在性和生命周期都有任务和验收归属。
- 当前只做源码调查与文档审阅，未执行上面的产品测试，未宣称接入完成或现有测试通过。
- 初稿已独立审阅，保留其远端切肤失败延期、真实宿主基线、危险脚本隔离和编辑器/Teleport 身份要求。本轮按用户明确要求补充桌面适配规格并自检：三类专项均有界面位置、状态、原 handler、新组件、失败路径和对应任务/测试，无需重复确认已明确的产品范围。
