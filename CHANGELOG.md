# 更新记录

遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 风格，版本号遵循[语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### 新增
- `package.json`：声明运行时门槛 `engines.node >= 20.11` 与一键自检入口 `npm test`（= `node run-checks.mjs`）。
- `run-checks.mjs`：跨平台一键自检器，env 在进程内设（不依赖 shell 的 `VAR=val` 前缀，Windows 可跑），复刻 CI 的零 API/零网络自检序列（selftest + T2 `--dry` + demo + merge-eval drill + fleet-eval core），逐步 rc 台账，任一失败即非零退出。
- CI 增 `fleet-eval core 作用域自检`（`FLEET_SCOPE=core` 跑仓库自带样例库，零网络），补上 CI 此前未覆盖 fleet core 断言的盲区。

### 变更
- README 快速开始补 `npm test` 一行，把散文版运行要求指向一条可复跑命令。

### 修复
- SECURITY.md 与代码/CI 对齐：命令注入条目原写“已知、尚未修复”，但 0.2.0 已将 `MERGE_REPO_SLUG` 改经 argv 传入并做 `owner/repo` 形态预检（CHANGELOG 0.2.0 已记），据此订正为“已修复”并补上残留边界；CI 工作流条目从“两个零 API 自检”更新为当前自检步清单，并去掉指向内部规划的悬空引用。

## [0.2.0] - 2026-10-13

治理方案 F1-F6 落地（2026-10-12），另补齐 CONTRIBUTING.md / SECURITY.md / issue 模板 / CHANGELOG 治理文件。

### 新增
- `lib/parsers.mjs`：三套件的三颗解析器（`stripPsComments` / `parseFrontmatter` / `extractPoems`）收拢为唯一实现；`selftest.mjs` 18 用例（node:test，零依赖）。
- `merge-eval/drill-merge-eval.mjs`：反向验证 drill——TMP git fixture 四场景（阳性对照 / 越界改动 / 旧基线 stale / 缺报告 BLOCK），零网络零 API。
- `fleet-eval/fleet-eval.allow.example.json`：`junk.absent` 豁免白名单模板（实际那份不入库）。
- CI 加两步零网络自检：`node --test selftest.mjs` + merge-eval 负例 drill。

### 变更
- fleet-eval 机器绑定解耦：`FLEET_SHARED` 改必填（缺失打印提示并以退出码 `2` 退出，不再有作者本机默认值）；python / anysearch 路径参数化（`FLEET_PYTHON` / `FLEET_ANYSEARCH`）；豁免白名单从代码硬编码移到 `fleet-eval.allow.json`（缺文件 = 无豁免，文件坏 = warn 不放行，fail-closed）。
- fleet-eval 新增 `FLEET_SCOPE` 作用域开关：默认 `full` 跑全部 11 项（老口径一字不变）；`core` 只跑与"共享库 + `sync.ps1` 多端扇出"布局无关的 6 项，显式跳过 fanout / tooling 那 5 项并回显跳过了哪些（外部技能库缺 `sync.ps1` / 多端扇出 / anysearch 时用）。非法值退出码 `2`；跳过是显式声明，不是"缺就自动跳"，配错路径仍照常报错。
- merge-eval 加 `--require-baseline`：闸门模式无基线 = FAIL，默认仍为记录性放行（首跑登记不受影响）；生效参数回显新增 `require_baseline`。
- merge-eval 的 gh 路径参数化（`GH_CLI` → 默认安装位 → PATH，全失败逐候选带原因，不静默降级）；远端仓库 slug 改经 argv 传入并先做形态预检，不再拼进内嵌脚本源码。

## [0.1.0] - 2026-10-10

首个公开版本。

### 新增
- **fleet-eval**：技能库全量回归，11 项零 API 断言（frontmatter 合法性、重名、垃圾残留、多端扇出一致性）。
- **merge-eval**：批量内容合入回归，7 项断言，核心是"未触及条目逐字节不变"；三态闸门 `gate_verdict`（测量失败=测量为负=一律 BLOCK）。
- **t2/smoke-ab**：技能增益 A/B，带技能 vs 不带技能比 `pass^k`；负对照臂证明判据有判别力。
- **demo**：自带样例技能库的一键 demo（先红后绿，零配置零 API）。
- CI：语法检查 + 两个零 API 自检（刻意不跑依赖本机磁盘的 fleet-eval）。（0.2.0 轮又补了解析器单测与 merge-eval 负例 drill 两步。）

### 设计口径
- 能确定性判定就不请 LLM 当裁判；证据只认外部可复读物证（sha256/远端读数/退出码）；面向稳定资产判 `pass^k`；看到红先怀疑判据。

[Unreleased]: https://github.com/kumu314/agent-evals/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/kumu314/agent-evals/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/kumu314/agent-evals/tree/v0.1.0
