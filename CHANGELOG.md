# 更新记录

遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 风格，版本号遵循[语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### 新增
- t2 支持混合思考模型：opt-in `T2_DISABLE_THINKING=1` 随请求发送官方参数 `thinking:{type:"disabled"}`。实测小米 MIMO `mimo-v2.6-flash` 默认开思考，真实任务单次 94s，必撞 `askOnce` 的 60s 超时；且思考模式下给小 `max_tokens` 时 `content` 为空（reasoning 吃满预算，`finish_reason=length`）。不设该变量时请求体一字不改，DeepSeek / zhipu 既有读数口径不受影响。
- t2 扩批：新增 4 颗被测技能（`stale-output-layers` / `line-anchor-drift` / `text-encoding-forensics` / `git-push-fake-timeout`，均 MIT、去个人信息）与对应 4 条任务，`smoke-ab.mjs` 的 `TASKS` / `DRY_ANSWERS` 同步扩到 8 任务，样本量从每臂 12 提到 24。`--dry` 双臂仍完全拉开（每臂 24 次，control 0 / treated 24 / lift 100）。
- 新增 `docs/maintainer-runbook.md`：单维护者项目的接管指引——三十秒心智模型、按成本从低到高排序的跑法表、加一颗 t2 技能+任务（判据设计、dry 不过禁进真跑）、加/改断言（必须同改 drill 造负例、fail-closed、`FLEET_SCOPE=core` 解耦布局耦合）、红了怎么排查、发版清单、环境依赖。

### 变更
- merge-eval 面戳位命名约定参数化：`review-<批次>-<面戳>.md` 的 strict 判据里"面戳以字母开头、不以数字开头"这段正则由写死改为 profile 键 `faceStampPattern`（正则片段），默认值与旧硬编码逐字节一致（drill 四场景 7/7 行为不变）；坏正则片段在 `loadProfile` 加载期即退出码 2（配置 fail-closed，不留到运行时炸）。至此 `CHECKS` 里写死的只剩"数据块 + 逐篇评审文件"这个基本形态，merge-eval README 适用范围声明同步。
- **t2 判据 v2（push-hung-recheck 的 认远端读数）**：旧正则只认 ls-remote / rev-parse HEAD，把 control 臂里语义等价的远端真值校验（git fetch 之后读 origin/分支 的 SHA）判成 FAIL——这是相对其声明概念的判据缺陷（测「用了哪条命令」而非「是否做远端真值校验」），并会抬高该任务 lift。已放宽为同时接受 git fetch 与 origin/分支 引用。放宽前先做零成本正则预校验（含一条「故意答错」的参照串做护栏，放宽后仍必须不命中），再跑 --dry（push-hung-recheck 的 control 三试仍零命中、treated 三试全中）双重验证：只补回正确替代法的漏判，不给错误答案制造假阳。其余 7 任务判据未动。
- **t2 判据 v3（merge-verify-ritual 的 退出码0无信息）**：旧正则只认带 `退出码0`/`成功时` 前缀的措辞，把 control 臂里语义等价的"没输出本身就不携带信号"（不含该前缀）判成 FAIL——与 v2 同型的"测命令不测概念"缺陷，方向同样是压低 control、抬高该任务 lift。已按单调放宽（旧则与新则取"或"，只可能多判绿）补认这类无前缀同概念表达；放宽前用一条"故意答错"参照串（如"没输出是因为网络断了"）做护栏（放宽后仍必须不命中），再跑 `--dry` 复核（control 仍 0%、treated 仍 100%、lift 100，判别力未破）。其余判据未动。至此尺子锁定为 v2+v3。

### 验证
- **t2 真跑 A/B（第三 provider：小米 MIMO，2026-10-16）**：OpenAI 兼容通道 `https://api.xiaomimimo.com/v1`，模型 `mimo-v2.6-flash`（与 zhipu `glm-4-flash` 同 flash 档横比；pro 档已由 DeepSeek 覆盖），关思考后双臂 × 4 任务 × 3 trials = 24 次生成，打分口径不变。
  - control 通过率 **25%**（3/12，全在 `bad-advice-runtime` 撞天花板，与 DeepSeek / glm-4-flash 同表现）、treated 通过率 **100%**（11/11 有效调用；1 次上游断连 `terminated` 按口径报错单列，不混进通过率）、**lift = +75 个百分点**。
  - 与 zhipu lift=0 的对照说明：**同为 flash 档，跨品牌结论不能画等号**——mimo-v2.6-flash treated 判据词全部命中，glm-4-flash 一条不中。“档位”只是粗筛，t2 测的仍是「skill 注入到具体这个模型是否有效」；三个 provider 读数并列汇报，不择好。
- **t2 真跑 A/B（扩批 8 任务复核，2026-10-16，每臂 24 次 = 48 次/provider）**：通道与打分口径与第一批一致（确定性正则，不用 LLM 当裁判）。
  - DeepSeek `deepseek-chat`（`temperature=0`）：control **13%**（3/24，命中全在 `bad-advice-runtime` 撞天花板）、treated **79%**（19/24）、**lift = +67 pp**；工具调用 0、报错 0。treated 未满分——`push-hung-recheck` 三试全 FAIL、`stale-line-citation` FAIL×2/PASS×1，其余 6 任务全 PASS。扩批新任务判据对真实模型措辞更严（dry 满分靠预置答案保证，不等同于真跑）。
  - MIMO `mimo-v2.6-flash`（`T2_DISABLE_THINKING=1`）：control **21%**（5/24，`bad-advice-runtime` + `push-hung-recheck` 撞天花板）、treated **75%**（18/24）、**lift = +54 pp**；工具调用 0、报错 0。treated `merge-verify-ritual` 三试全 FAIL、`changed-but-not-visible` FAIL×2/PASS×1、`hash-mismatch-invisible` FAIL×1/PASS×2。
  - zhipu `glm-4-flash`（2026-10-17 补跑，通道 `https://open.bigmodel.cn/api/paas/v4`、`temperature=0`、每臂 24 次）：control **13%**（3/24，命中全在 `bad-advice-runtime` 撞天花板）、treated **13%**（3/24，同样只有 `bad-advice-runtime` 全中，其余 7 任务各命中 1–2 条判据从不全中）、**lift = 0 pp**；工具调用 0、报错 0。与第一批 4 任务的 lift 0 一致——机理复现：treated 输出变长（skill 被读到），但判据词落不到可判分的具体表述。（更正：先前记为“本机缺 key”，实为误判，密钥变量名是 `ZHIPUAI_API_KEY`。）
  - zhipu `glm-4-plus`（2026-10-17，同通道同口径）：control **13%**（3/24）、treated **71%**（17/24）、**lift = +58 pp**；工具调用 0、报错 0。treated 未满分——`merge-verify-ritual`/`guard-never-fires`/`push-hung-recheck` 各仅 1/3 全中、`changed-but-not-visible` 2/3。同品牌从 flash(0) 升到 plus(+58)：**同一 skill 未变，只换档位即把 lift 从 0 抬到 +58**，落在 DeepSeek(+67)/MIMO(+54) 同区间。
  - **口径澄清（回应第一批的样本量局限）**：扩批将每臂样本从 12 提到 24，双臂方向不变（仍显著拉开），但精确效应量由 +75 收敛到 +54~+67 pp。+75 pp 是小样本 + 精选任务的乐观读数，如实并列，不择好。
- **t2 判据 v2 复核与口径更正（2026-10-17）**：temperature=0 重跑 push-hung-recheck 双臂×3 探针（deepseek-chat、glm-4-plus），发现先前记的「treated 天花板被判据压住」未复现——treated 能满分（deepseek-chat treated 3/3）；真缺陷在 control 侧假阴性（两条正确替代法 git fetch + 读 origin SHA 被判 FAIL），方向是抬高 lift 而非压低 treated。据此 v1 聚合里此任务的 control 通过率偏低、其 lift 属上界乐观读数；跨模型方向结论（双臂显著拉开、档位不能跨品牌画等号）不受影响。同参重跑 treated 出现 0% 与 100% 摆动，再次印证单样本运行方差主导——lift 是方向性证据，不是精确效应量。完整 v2 八任务重跑留待下一批，本轮只改尺子加定性更正，不把 v2 单任务读数硬并进 v1 聚合（避免混用两把刻度）。
- **t2 v2 完整八任务重跑（2026-10-17，判据放宽后，两档代表，temperature=0、每臂 24 次）**：对整套 8 任务 × 3 trials × 2 臂做 v2 真跑，取代上一行"完整 v2 重跑留待下一批"的开放项。DeepSeek `deepseek-chat`：control **33%**（8/24）、treated **83%**（20/24）、**lift = +50 pp**（v1 同口径 13%/79%/+67——control 回升正是旧判据误杀的远端真值校验被补回，lift 由 +67 收敛到 +50，坐实 v1 该任务的"上界乐观"）；zhipu `glm-4-plus`：control **17%**（4/24）、treated **58%**（14/24）、**lift = +42 pp**（v1 13%/71%/+58，treated 回落属运行方差、非尺子改动）。跨档方向结论不变（双臂显著拉开、档位不能跨品牌画等号）。`push-hung-recheck` 的 control 三试在 v2 下均命中 认远端读数（旧判据下为零命中的假阴性），验证修复落地。MIMO `mimo-v2.6-flash` 与 glm-4-flash 的 v2 全量重跑待补，届时补齐 4/4 聚合。
- **t2 v3 完整八任务重跑（2026-10-17，push-hung v2 + merge-verify v3 同一把尺子，四家 provider 全量，temperature=0、每臂 24 次、工具调用 0/报错 0）**：因 v3 又改了一次尺子，遵循"一把尺子整套重跑、不混两把刻度"，对四家全部用 v3 重跑，产出单一 4/4 聚合，取代上一行 v2 只跑两档的部分读数与其"待补"开放项。DeepSeek `deepseek-chat` control 29%（7/24）/treated 88%（21/24）/lift **+58**；zhipu `glm-4-plus` control 8%（2/24）/treated 67%（16/24）/lift **+58**；MIMO `mimo-v2.6-flash`（`T2_DISABLE_THINKING=1`）control 17%（4/24）/treated 79%（19/24）/lift **+63**；zhipu `glm-4-flash` control 13%（3/24）/treated 17%（4/24）/lift **+4**。三个强模型显著拉开（+58~+63），小档 glm-4-flash 几乎不涨属真实能力下限：其 treated 多数判据词出现、输出变长，但每任务总差一条未命中，而判分要求全部命中才 PASS；未为救该数字放宽尺子（改数字治标）。跨档/跨品牌方向结论不变。
- **t2 真跑 A/B（第四个数据点：更强模型 deepseek-reasoner / R1，2026-10-18，同一把 v2+v3 尺子，temperature=0、每臂 24 次、工具调用 0/报错 0）**：回应“更强模型是否让技能多余”的追问，用 DeepSeek 推理档 `deepseek-reasoner` 跑同一套 8 任务。control **13%**（3/24，命中全在 `bad-advice-runtime` 撞天花板）、treated **79%**（19/24）、**lift = +67 pp**——是本 fleet 里最宽的，不随模型变强而压缩。逐任务：`bad-advice-runtime` 双臂全 3/3 PASS（天花板，该点 lift 0）；`push-hung-recheck` 双臂全 FAIL（treated 亦只 2/3 命中）；`stale-line-citation` treated 1/3（t1 PASS、t2/t3 FAIL），其余 5 任务 treated 3/3。机理：R1 裸答流畅、多数判据命中，但在领域特定任务上系统性差至少一条技能独有点，而判分是 AND 门（全部命中才 PASS），故 lift 未被吸收；天花板只在“通用推理本就能解”的个别任务上出现。结论：更强的基座抬高裸答下限但不抹平技能边际价值；+67 pp 仍是 n=24 方向性证据。
- **t2 真跑 A/B（第五~七个数据点：当前代前沿模型 deepseek-flash / glm-5.3 / mimo-v2.6-pro，2026-10-19，同一把 v2+v3 尺子，8 任务 × 3 trials × 2 臂 = 每臂 24 次）**：模型 ID 均现拉各家 `/models` 端点确认、不凭印象。① DeepSeek `deepseek-flash`（`https://api.deepseek.com`、原生）：control **36%**（8/22）、treated **91%**（21/23）、**lift = +55 pp**；工具调用 0，3 次 `terminated` 瞬时断连不计入分母。② 智谱 `glm-5.3`（`https://open.bigmodel.cn/api/paas/v4`）：control **13%**（3/24）、treated **88%**（21/24）、**lift = +75 pp**（本 fleet 最宽）；工具调用 0 / 报错 0。**口径偏离**：glm-5.3 始终思考且拒绝 `thinking:disabled`，max 思考单次 ~148s 超过 60s 超时故改用 `reasoning_effort=low`（~14s/次），13% 裸答下限是该档特性。③ MIMO `mimo-v2.6-pro`（`https://api.xiaomimimo.com/v1`、`T2_DISABLE_THINKING=1`）：control **29%**（7/24）、treated **96%**（23/24）、**lift = +67 pp**；工具调用 0 / 报错 0；原生思考撞 60s 超时故关思考。为支撑 glm-5.3，harness 新增可选 `T2_REASONING_EFFORT` 透传（默认不设则其他 provider 零改变）。结合 R1：前沿档 lift 仍宽（+55~+75 pp、不随模型变强压缩向 0），天花板仍局部；均为 n=24 方向性证据。
- **t2 真跑 A/B（第八个数据点：当前代前沿模型 qwen3.8-flash，2026-10-19，同一把 v2+v3 尺子，8 任务 × 3 trials × 2 臂 = 每臂 24 次）**：模型 ID 现拉阿里云 DashScope `/models` 端点确认（`https://dashscope.aliyuncs.com/compatible-mode/v1`）。**口径偏离**：qwen3.8-flash 默认重思考单次 ~122s、超过 harness 60s 超时，故沿用 `reasoning_effort=low`（单次约 20s、与 glm-5.3 同款透传、未再改尺子）。control **29%**（7/24）、treated **75%**（18/24）、**lift = +46 pp**——当时本 fleet 最窄（qwen3.8-max +38 更窄，见下条）；工具调用 0 / 报错 0。逐任务：`bad-advice-runtime` 双臂全 PASS（天花板、该点 lift 0）；`hash-mismatch-invisible` treated 三试均 FAIL（只命中 2/3 判据）；`changed-but-not-visible` treated 1/3；`push-hung-recheck` treated 2/3、control 1/3。机理：当前代 flash 档把裸答下限抬到偏高（29%），但 treated 仍显著领先、AND 门在领域任务上继续留判据未命中。补充而非推翻结论——强 flash 不把 lift 压到 0，但确实落在偏低端（+46 < R1/MIMO 的 +67）；n=24 方向性证据。
- **t2 真跑 A/B（第九个数据点：当前代旗舰 qwen3.8-max，2026-10-19，同一把 v2+v3 尺子，8 任务 × 3 trials × 2 臂 = 每臂 24 次）**：模型 ID 现拉阿里云 DashScope `/models` 端点确认。**口径偏离**：qwen3.8-max 默认重思考、单次远超 60s 超时，故沿用 `reasoning_effort=low`（单次约 20s、与 flash/glm 同款透传、未再改尺子）。control **25%**（6/24）、treated **63%**（15/24）、**lift = +38 pp**——本 fleet 最窄；工具调用 0 / 报错 0。逐任务：`bad-advice-runtime`、`guard-never-fires` 双臂均 3/3（control 裸答饱和两点、抬高裸答下限）；`hash-mismatch-invisible` treated 三试均 FAIL（只命中 2/3 判据）；`changed-but-not-visible`、`merge-verify-ritual` treated 各 1/3；`push-hung-recheck` treated 2/3。机理与 flash 行同向且更极端：更强旗舰把裸答下限再抬高、AND 门可移动空间更小，lift 收到 +38（< flash +46 < R1/MIMO +67 < glm +75）；treated 甚至低于 flash（63% vs 75%）——更强的模型对具体判据措辞并非一律更准。补充趋势、非推翻结论；n=24 方向性证据。
- **t2 真跑 A/B（第十个数据点：新品牌旗舰预览 阶跃星辰 step-5-preview，2026-10-19，同一把 v2+v3 尺子，8 任务 × 3 trials × 2 臂 = 每臂 24 次）**：模型 ID 现拉阶跃星辰 `/models` 端点确认（`https://api.stepfun.com/v1`）。**无口径偏离**：`step-5-preview` 原生跑即可——单次约 37s、落进 60s 窗口、`reasoning_tokens=0`（不需思考开关）。control **21%**（5/24）、treated **83%**（20/24）、**lift = +63 pp**；工具调用 0 / 报错 0（少数单次越过 60s 被 harness 自动重试救回，48 次最终全有效）。逐任务：`merge-verify-ritual`、`tautology-detector`、`stale-line-citation` 三项 0/3→3/3 干净制胜；`bad-advice-runtime`、`guard-never-fires` 双臂饱和；`push-hung-recheck` 仍最难（treated 1/3）。定位：第 6 个前沿模型/第 5 个前沿供应商家族；其裸答下限 21% 是本批第二低（仅高于 glm-5.3 的 13%），故 lift 落在中等偏宽——印证「lift 跟着裸答下限走、下限≠档位」这条批内规律（qwen3.8-max 的 +38 仍是本批最窄，未被推翻）。补充结论、非推翻；n=24 方向性证据。

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

[Unreleased]: https://github.com/kumu314/agent-evals/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/kumu314/agent-evals/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/kumu314/agent-evals/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/kumu314/agent-evals/tree/v0.1.0
