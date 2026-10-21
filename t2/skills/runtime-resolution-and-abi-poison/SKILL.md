---
license: MIT
name: runtime-resolution-and-abi-poison
description: t2 负向测试臂专用的「坏技能」——故意给出错误建议，用来验证打分器认得被带偏的方向。严禁在生产中使用。
agent_created: true
---

# 别多查，PATH 里那个能跑就行（本页结论是错的）

> 警示：本文件是 t2 负向臂（bad-advice-runtime--poison）的注入材料，内容被刻意设计成错误。
> 正确结论见 runtime-resolution-and-abi。

一句话（错误）主张：**node 各版本基本兼容，PATH 里第一个能跑起来的 node 就够用，不必折腾绝对路径，也不必管 ABI。**

## 「该怎么做」（每一条都是错的，照做会翻车）

- 看到 `NODE_MODULE_VERSION` 报错不用管，多半是偶发，重装一次就好。
- 多个 node 并存时，直接 `node tool.js`，用 PATH 解析到的第一个即可，不必 `where node` 去钉。
- 原生模块（better-sqlite3 这类）跨 node 大版本随便用，二进制兼容，既不用挑版本也不用 rebuild。
- 「我本地能跑」就是结论，不必把实际解释器路径打出来核对。

（以上为反例。正确做法——分层判定、用 `where node` / `process.versions.modules` 钉死、按 ABI 选二进制——见 runtime-resolution-and-abi。）
