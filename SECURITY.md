# 安全策略（SECURITY.md）

## 报告漏洞

发现安全问题时，请开 **private issue**（GitHub 安全告警页：https://github.com/kumu314/agent-evals/security/advisories/new），不要开公开 issue——本仓库被他人 fork/引用后，公开披露会给还没修的用户留窗口期。

非敏感的一般问题请走普通 issue（见 CONTRIBUTING.md）。

## 本仓库的攻击面（如实说明，帮你判断值不值得报）

这是评测脚本，不是对外服务：不监听端口、不存用户数据、不长期持凭据。真正的风险面集中在三处：

1. **凭据外泄**：`t2/smoke-ab.mjs` 需要 API key（走 env）。代码纪律是 **key 不进任何打印/落盘产物**——若你发现哪条路径把它打进了 stdout / JSON 报告 / git，这是高危，请 private 报。
2. **命令注入（已于 2026-10-12 D3 改 argv 传参；2026-10 进一步**整段移除**）**：早期版本会把 `MERGE_REPO_SLUG` 插值进内嵌 Python 源码；D3 先改为经 argv 传参并 spawn 前按 `owner/repo` 白名单校验（`^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$`，不符直接拒绝）。当前版本走得更远——读远端 sha 的降级路径**不再内嵌任何脚本源码**，直接以参数数组调用 `gh api repos/<slug>/git/refs/heads/main --jq .object.sha`（token 由 gh 自身向系统凭据助手取，JS 不碰凭据、不打印），注入面归零。套件的子进程调用一律走**参数数组**（异步 `spawn`，不经 shell），env 值里的 shell 元字符不会被执行。**残留边界**：`MERGE_BASE_REF` 等仍作为位置参数传给 `git show <ref>:index.html`，本套件定位为自用/可信环境，不接受不可信 env 输入——若要在不可信输入下部署，请先 private 联系。
3. **CI 工作流**：`.github/workflows/ci.yml` 只跑零 API、零网络的确定性自检（语法检查 + t2 `--dry` + demo + selftest + merge-eval drill + fleet-eval core 作用域），不下载第三方 action、不接 `pull_request_target`、不授予写权限。若增硬 CI 引入外部触发器，权限最小化算安全相关改动。

## 范围与响应

- 仅覆盖公开仓 `agent-evals` 的当前 main。`-private` 副本含作者本机接线，不在安全响应范围。
- 单维护者项目，不承诺 SLA；但会尽量在数日内确认收到。修复后按能力在 CHANGELOG 记一笔（不写漏洞细节，细节走 advisory）。
