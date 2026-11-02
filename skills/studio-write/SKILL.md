---
name: studio-write
description: 按作者意图写作或续写正文，用提案工具交出候选，作者确认后再落库。
---

# 写作与落库

## 顺序

1. `studio_works` 打开作品，`studio_outline` 定位目标章与前后章。
2. `studio_read` 读当前章与必要的前文（按游标分页，别一次要整本）。
3. `studio_preset` 看作者既定笔法；有就用，别自创风格。
4. 写正文：纯文本自然段，不夹 JSON、分析、本章小结。
5. `studio_propose` 交候选（kind=chapter.append 续写 / chapter.replace 整章替换 / chapter.create 新章）。
6. **作者确认后**才 `studio_apply {confirm:true}`；不要替作者点确认。

## 原则

- 人物动机与已知事实来自正文与设定卡，不靠猜测补全。
- 规划是意图、正文是事实；未在正文出现的情节不能当已发生。
- 情感由有后果的动作与选择带出，不堆形容与总结。
- 冲突或版本过期（CONFLICT）时重读再提案，不要重发旧全文。