# 更新记录 · Changelog

> **更名说明**：本插件原名「小说工坊 DSH 插件版」，随桌面端已正式更名为 **「空想书典（Reverie Fiction）DSH 插件版」**；为兼容宿主安装与共享作品库，npm 包名 `@linque0/dsh-novel-studio`、插件标识 `novel-studio` 及共享指针路径维持原值。

本文档记录 `dsh-novel-studio`（空想书典 DSH 插件版）各版本同步自桌面端 `novel-studio` 的核心能力与构建产物变更。

---

## [0.3.7] - 2026-11-24 · 设定五级权重、千节点大树优化与层级导航重构

> 同步桌面版 `1.2.8`（`codex/lore-galaxy-topology`）前端设定能力，并更新 `assets/app/` 插件构建产物。

### 设定五级权重与星系拓扑

- **条目权重体系**：同步 `app/src/services/lore-weights.js` 与 `app/src/components/LoreWeightIcon.vue`，支持「核心 / 关键 / 标准 / 点缀 / 末节」五级权重；`MubuTagPanel.vue` 新增五档分段选择、标签推导与标签权重配置，`LoreHead` / `LoreInspector` / `LoreNavNode` / `MubuView` / `themes.css` 同步呈现。
- **关系星系径向分层**：`app/src/components/lore/planets/`（`LorePlanetNetwork`、`draw-planets`、`planet-scene`、`lore-planet-data`、`planet-network.css`）接入五级径向轨道分布、零 `shadowBlur` 绘制、权重微动画及命中半径/LOD 标签阈值。

### 大规模设定性能优化与层级可读性

- **千节点大纲窗口化**：同步 `app/src/composables/useLoreRowWindow.js` 与 `app/src/services/lore-core.js` 的树索引与可视区窗口计算，`MubuView.vue`、`useLoreSort.js` 与 `usePointerRowSort.js` 跟进优化。
- **层级导图（LoreTreeMap）自适应缩放**：
  - `app/src/services/lore-tree-layout.js` 新增 `loreInitialFoldedIds()` 大树自适应初始折叠及 `> 120` 节点紧凑间距；
  - `app/src/components/lore/LoreTreeMap.vue` 增设首屏/聚焦最低可读缩放下限、视野重定位、`zoomReset()` 居中与 `loadedWorkId` 竞态保护；
  - `app/src/styles/lore-images.css` 为未选中纯文本导图节点增加 3 行限高截断。
- **左侧条目目录空间利用率重构**：
  - 新增 `app/src/services/lore-nav-tree.js`，实现分段递减缩进与封顶（常规 `48px` / 宽栏 `72px`）、纵向参考线与两段式一键收起；
  - `LoreNavNode.vue` 与 `MubuTree.vue` 接入参考线、深层 `L7+` 徽标与分支下钻（Hoist）面包屑栏；
  - `app/src/styles/lore-free-tree.css` 修复旧皮肤选择器权重冲突并优化行尾操作钮为「桌面隐藏、触屏及窄屏保留」（`OIcon.vue` 补全 `dots` 三点图标）。

### 插件构建与版本

- **版本号同步**：`package.json` 与 `app/package.json` 由 `0.3.6` 升至 `0.3.7`。
- **构建产物**：已执行 `npm run build:app` 重新生成 `assets/app/`。按同步规范沿用桌面版既有单测、双样本 CDP 验收与构建结果。

---

## [0.3.6] - 2026-11-20 · 设定图片与地图编辑、流场转场与库冲突处理

- 同步桌面版 `1.2.7`：支持设定条目挂图（`LoreImageControls` / `LoreImageHiddenNotice` / `useLoreImages`）、层级导图行内编辑（`LoreMapEditor` + `lore-tree-layout`）、新作品六类条目种子（`lore-entries.js`）、模块幻流转场（`FlowTransitionOverlay`）、作品库并发冲突检测与写作统计统一下拉组件。
- 后续于 `290ffc2` / `034f87d` 合入 WebGL 液态转场调优、大纲画布激活期生命周期修复及源码注释补齐。

## [0.3.5] - 2026-11-18 · 灵感拼板重做与人物角色预设精简

- 同步桌面版 `1.2.6`：灵感收敛为单一可调尺寸与配色的拼板视图，新增卡片右键菜单与拖拽缓动，人物角色预设精简。
