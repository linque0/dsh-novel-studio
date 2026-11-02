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
      src/adapters/dsh/     静态托管、RPC
      src/client/iframe-shim.js   注入 iframe 的 window.native 替身
      lib/client.js         客户端 bundle（手写 ModuleLoader 格式，只用 react）
      assets/app/           小说工坊 dist 的拷贝（npm run copy-app 生成）
      scripts/smoke.mjs     不依赖宿主的冒烟

## 常用命令

    npm run copy-app       # 从 ../novel-studio/dist 复制构建产物
    npm run smoke          # 核心库 / 静态托管 / RPC / 工具 冒烟（31 项）
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

## 数据层进度

- **M2（进行中）**：桌面版已具备作品库主进程通道（`electron/library-ipc.js`，7 个通道）与渲染层桥（`src/services/library.js`），核心实现与插件共用 `novel-studio/packages/novel-core/library.js`。
- **迁移是作者显式触发的**：桌面版控制台执行 `await window.__ns.library.migrateToLibrary()`，做"导出备份 → 写入作品库 → 核对"，不覆盖已有库、失败不动本地数据。
- **M3 同步层（已接）**：桌面版 `src/services/library-sync.js` + 插件版 iframe 内的同一份前端代码，都会把 Dexie 变更批量提交到作品库、并轮询拉取库的增量回灌 Dexie。冲突以库为准并重放一次；队列有界（200 条）。
- **仍未做**：桌面版首次全量迁移仍需作者显式触发（`window.__ns.library.migrateToLibrary()`）；插件版不需要（库就是它的权威源）。

## 运行时探针

面板顶部一行同时显示三个探针，任何一环断了都能直接看出来：

- **静态**：`GET /api/novelstudio/app/index.html` → 期望 200 + 「桥✓」（shim 已注入）
- **健康**：`GET /api/novelstudio/health` → 期望 200，带路由数、版本、作品库状态
- **RPC**：`POST /api/novelstudio/rpc {action:'plugin.info'}` → 期望 200

另配「复制诊断」按钮（一键复制三段探测结果，便于排查）。

## 插件版内的 AI 入口

`iframe-shim.js` 在宿主判定为 `dsh` 时会隐藏恍然梦对话面板（`.ai-panel.agent-panel`），
右下角常驻徽标「AI 由 DSH 会话承担」。M5 会换成正式开关；当前做法是可逆的最小措施。

## 宿主契约（读 dsh-client-connection 源码核实，写插件必须遵守）

1. **fetch 路由是"精确路径"匹配**：`ctx.connection.fetch.register({ path })` 的 path 是 Map 的键，**不支持通配符**；`/api/foo/*` 永远匹配不到任何请求，且会直接抛错（段名必须匹配 `/^[A-Za-z0-9_$.-]+$/`）。
2. **每个 GET/HEAD 路由必须显式声明 `requestBody: 'buffered'`**：未声明时宿主取到 `undefined`，会退到 streaming 分支给 GET 挂 body，`new Request()` 直接抛错 → 浏览器收到 **400**（本项目踩过这个坑）。
3. **路径必须在 `/api/` 之下**，否则注册时校验失败。
4. 访问控制由宿主负责：非 owner 主体拿到 403；未认证得到 401（所以 curl 直接打永远是 401，只能在宿主页面里验）。
5. 同一 path 只能注册一次，重复注册抛错。

## 已知限制（M0）

- iframe 里没有 Electron 拆窗、全局快捷键与 window.native 全量能力（shim 只覆盖最小子集）
- 写工具（studio_propose / studio_apply / studio_undo）尚未开放
- 桌面版还没接上同一个库（M2 才做投影化）
