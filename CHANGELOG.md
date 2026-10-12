# 更新记录

遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 风格，版本号遵循[语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

治理方案 F1-F6 落地（2026-10-12），另补齐 CONTRIBUTING.md / SECURITY.md / issue 模板 / CHANGELOG 治理文件。

### 新增
- `lib/parsers.mjs`：三套件的三颗解析器（`stripPsComments` / `parseFrontmatter` / `extractPoems`）收拢为唯一实现；`selftest.mjs` 18 用例（node:test，零依赖）。
- `merge-eval/drill-merge-eval.mjs`：反向验证 drill——TMP git fixture 四场景（阳性对照 / 越界改动 / 旧基线 stale / 缺报告 BLOCK），零网络零 API。
- `fleet-eval/fleet-eval.allow.example.json`：`junk.absent` 豁免白名单模板（实际那份不入库）。
- CI 加两步零网络自检：`node --test selftest.mjs` + merge-eval 负例 drill。

### 变更
- fleet-eval 机器绑定解耦：`FLEET_SHARED` 改必填（缺失打印提示并以退出码 `2` 退出，不再有作者本机默认值）；python / anysearch 路径参数化（`FLEET_PYTHON` / `FLEET_ANYSEARCH`）；豁免白名单从代码硬编码移到 `fleet-eval.allow.json`（缺文件 = 无豁免，文件坏 = warn 不放行，fail-closed）。
- merge-eval 加 `--require-baseline`：闸门模式无基线 = FAIL，默认仍为记录性放行（首跑登记不受影响）；生效参数回显新增 `require_baseline`。
- merge-eval 的 gh 路径参数化（`GH_CLI` → 默认安装位 → PATH，全失败逐候选带原因，不静默降级）；远端仓库 slug 改经 argv 传入并先做形态预检，不再拼进内嵌脚本源码。

## [0.1.0] - 2026-10-10

首个公开版本。

### 新增
- **fleet-eval**：技能库全量回归，11 项零 API 断言（frontmatter 合法性、重名、垃圾残留、多端扇出一致性）。
- **merge-eval**：批量内容合入回归，7 项断言，核心是"未触及条目逐字节不变"；三态闸门 `gate_verdict`（测量失败=测量为负=一律 BLOCK）。
- **t2/smoke-ab**：技能增益 A/B，带技能 vs 不带技能比 `pass^k`；负对照臂证明判据有判别力。
- **demo**：自带样例技能库的一键 demo（先红后绿，零配置零 API）。
- CI：语法检查 + 两个零 API 自检（刻意不跑依赖本机磁盘的 fleet-eval）。（Unreleased 轮又补了解析器单测与 merge-eval 负例 drill 两步。）

### 设计口径
- 能确定性判定就不请 LLM 当裁判；证据只认外部可复读物证（sha256/远端读数/退出码）；面向稳定资产判 `pass^k`；看到红先怀疑判据。

[Unreleased]: https://github.com/kumu314/agent-evals/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/kumu314/agent-evals/tree/v0.1.0
