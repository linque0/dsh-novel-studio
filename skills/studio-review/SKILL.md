---
name: studio-review
description: 独立审稿；意见必须能在正文唯一定位，证据要能反查，复核要全覆盖。
---

# 审稿

## 怎么提意见

- 每条必须有 **quote**：从正文里逐字复制、且在正文中只出现一次。定位不到的意见等于没提。
- 先判断是否同一人物、同一时点、同一条件，再判"不能同时成立"。
- 检查：时间与移动、进出场、物品与伤势、能力条件与代价、视角人物如何得知信息。
- 区分事实错误（error）、风险（warning）、偏好建议（suggestion）。文风偏好不算事实错误。

## 工具

1. `studio_review {chapterId, findings:[...]}` → 返回 reviewId 与逐条 `locatable`、证据 `verified`。
2. 把可定位的问题给作者挑选；不要自行决定采纳哪些。
3. 改稿后 `studio_recheck {reviewId, revisedText, items}`：必须覆盖全部原问题、不许多不许漏；定位失败的 resolved 会自动降级为 unresolved。

## 原则

- 只审不改：审稿工具产出的意见不直接落库。
- 材料不足时明确标"待核实"，不要声称全书已核。