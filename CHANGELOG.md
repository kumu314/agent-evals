# 更新记录

遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 风格，版本号遵循[语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

## [0.3.0] - 2026-10-15

外部评审落地（2026-10-15）：CI 三平台矩阵、ghMainSha 注入面归零、merge-eval 耦合前置声明、SPDX/.nvmrc；并把上一轮的 `package.json` / `run-checks.mjs` / CI fleet-core 自检一并纳入本版。

### 新增
- `package.json`：声明运行时门槛 `engines.node >= 20.11` 与一键自检入口 `npm test`（= `node run-checks.mjs`）。
- `run-checks.mjs`：跨平台一键自检器，env 在进程内设（不依赖 shell 的 `VAR=val` 前缀，Windows 可跑），复刻 CI 的零 API/零网络自检序列（selftest + T2 `--dry` + demo + merge-eval drill + fleet-eval core），逐步 rc 台账，任一失败即非零退出。
- CI 增 `fleet-eval core 作用域自检`（`FLEET_SCOPE=core` 跑仓库自带样例库，零网络），补上 CI 此前未覆盖 fleet core 断言的盲区。
- `.nvmrc`（=20）对齐 CI 的 node 版本；全部 `.mjs` 文件头补 `SPDX-License-Identifier: MIT`。

### 变更
- README 快速开始补 `npm test` 一行，把散文版运行要求指向一条可复跑命令。
- CI 补 ubuntu-latest / windows-latest / macos-latest 三平台矩阵，统一 `shell: bash`（本套件极重 Windows 兼容，此前却只在 ubuntu 跑过 CI）。
- merge-eval `ghMainSha`：读远端 sha 的降级路径由内嵌 Python（取 token + urllib）改为一条 `gh api repos/<slug>/git/refs/heads/main --jq .object.sha`，内嵌脚本源码整段移除、注入面归零。

### 修复
- SECURITY.md 与代码/CI 对齐：命令注入条目随 `ghMainSha` 减面更新为"内嵌脚本源码整段移除"；merge-eval README 顶部前置声明判据绑定 `index.html`+`const POEMS`+`review-*.md` 内容站形态。

### 验证
- **t2 真跑 A/B（评审 #3 落地）**：本机 DeepSeek（`deepseek-chat`，`temperature=0`）双臂 × 4 任务 × 3 trials = 24 次生成；打分仍走确定性正则，不用 LLM 当裁判（零额外成本）。
  - control 通过率 **25%**（3/12）、treated 通过率 **100%**（12/12）、**lift = 75 个百分点**。
  - 4 项任务中 3 项两臂完全拉开（`merge-verify-ritual` / `guard-never-fires` / `tautology-detector`）；1 项两臂撞天花板（`bad-advice-runtime`，DeepSeek 已内化该知识）——如实记录，不粉饰。
  - **跨 provider 复现（2026-10-16 补，zhipu glm-4-flash）**：换 OpenAI 兼容通道 `https://open.bigmodel.cn/api/paas/v4`，同 4 任务 × 3 trials × 2 臂 = 24 次生成，打分口径不变。
    - control 通过率 **25%**（3/12，全在 `bad-advice-runtime`）、treated 通过率 **25%**（3/12，同）、**lift = 0 个百分点**。
    - 机理分析（不是格式问题，是模型能力上限）：`bad-advice-runtime` 双臂都撞 PASS 天花板（glm-4-flash 对该题已内化，与 DeepSeek 同表现）；其余 3 项 control 全 FAIL、treated 也 FAIL——treated 输出**明显变长**（例 `merge-verify-ritual` 从 551 字符 → 1199 字符），但具体判据词（`REST.state=merged` / `硬编码脆弱` / `列序根因`）不命中，小模型没能力把技能里的抽象规则落到可判分的具体表述。
    - 与 DeepSeek lift=75 的对照说明：t2 测的是「skill 注入到该模型档位是否有效」，不是「skill 本身对不对」；不同 provider / 档位读数**必须并列汇报不可择好**（择好即作弊）。原始 24 行读数：见 v0.3.0 Release Notes 补充段。

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
