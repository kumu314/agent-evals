# 安全策略（SECURITY.md）

## 报告漏洞

发现安全问题时，请开 **private issue**（GitHub 安全告警页：https://github.com/kumu314/agent-evals/security/advisories/new），不要开公开 issue——本仓库被他人 fork/引用后，公开披露会给还没修的用户留窗口期。

非敏感的一般问题请走普通 issue（见 CONTRIBUTING.md）。

## 本仓库的攻击面（如实说明，帮你判断值不值得报）

这是评测脚本，不是对外服务：不监听端口、不存用户数据、不长期持凭据。真正的风险面集中在三处：

1. **凭据外泄**：`t2/smoke-ab.mjs` 需要 API key（走 env）。代码纪律是 **key 不进任何打印/落盘产物**——若你发现哪条路径把它打进了 stdout / JSON 报告 / git，这是高危，请 private 报。
2. **命令注入**：脚本会把 env 值拼进 `execFileSync` 参数，`merge-eval` 还会把 `MERGE_REPO_SLUG` 直接插值进内嵌 Python 源码字符串。正常自用场景这些值由你自己设，注入不可达；但如果你把仓库接进 CI 且用**不可信输入**填这些 env（`MERGE_REPO_SLUG`、`FLEET_SHARED` 等），注入面就真实存在。**这是一个已知、尚未修复的项**（修法见 slug 走 argv 传参），若你要在不可信输入下用 merge-eval，请先 private 联系确认修复状态。
3. **CI 工作流**：`.github/workflows/ci.yml` 只跑语法检查 + 两个零 API 自检，不下载第三方 action、不接 pull_request_target。若增硬 CI（见优化方案 M3），引入外部触发器时的权限最小化算安全相关改动。

## 范围与响应

- 仅覆盖公开仓 `agent-evals` 的当前 main。`-private` 副本含作者本机接线，不在安全响应范围。
- 单维护者项目，不承诺 SLA；但会尽量在数日内确认收到。修复后按能力在 CHANGELOG 记一笔（不写漏洞细节，细节走 advisory）。
