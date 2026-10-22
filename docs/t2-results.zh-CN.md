# t2 结果 - 完整证据链

这里是 [README - t2 测什么、不测什么](../README.zh-CN.md#t2-测什么不测什么) 概要背后的完整记录。以下每个读数都从实测原样搬运，只调整了组织方式。共用口径只在 README 说一次。

## 第一批 - 管线证明（4 任务）

**实测证据**：分两批跑。第一批 4 任务证明管线能把双臂拉开；扩批把样本翻倍（4→8 任务）后复核效应量。

第一批（4 任务 × 3 trials × 2 臂 = 每臂 12 次）：

| provider | 模型 | control pass | treated pass | lift |
|---|---|---|---|---|
| DeepSeek | deepseek-chat | 25% (3/12) | 100% (12/12) | **+75 pp** |
| zhipu | glm-4-flash | 25% (3/12) | 25% (3/12) | **0 pp** |
| MIMO | mimo-v2.6-flash | 25% (3/12) | 100% (11/11 有效调用，1 次上游断连单列) | **+75 pp** |

扩批（8 任务 × 3 trials × 2 臂 = 每臂 24 次，样本翻倍复核）：

| provider | 模型 | control pass | treated pass | lift |
|---|---|---|---|---|
| DeepSeek | deepseek-chat | 13% (3/24) | 79% (19/24) | **+67 pp** |
| MIMO | mimo-v2.6-flash | 21% (5/24) | 75% (18/24) | **+54 pp** |
| zhipu | glm-4-flash | 13% (3/24) | 13% (3/24) | **0 pp** |
| zhipu | glm-4-plus | 13% (3/24) | 71% (17/24) | **+58 pp** |

## 判据校准（v2 / v3）与锁尺 4/4 聚合

两批合看：**方向不变**——双臂仍显著拉开；但**精确效应量收敛**（+75 → +54~+67 pp）。新增任务的判据更贴近"技能正文独有、裸模型答不到"的细颗粒点，真实模型措辞未必逐条命中（如 MIMO 在 `merge-verify-ritual` treated 三试全 FAIL，DeepSeek 在 `push-hung-recheck` 判据偏紧），而个别 control 撞天花板（`push-hung-recheck` 两模型裸答也命中）。+75 pp 是小样本 + 精选任务下的乐观读数，+54~+67 pp 是扩样后更保守的估计——这恰好印证该带的话：**lift 是方向性证据，不是精确效应量**。 判据校准（2026-10-17）：两处 control 侧假阴性修复，均为单调放宽（只会让更多正确答案转绿、不会把错误答案判绿），各配一条“故意答错”护栏串与 --dry 复核——v2 修 push-hung-recheck 的认远端读数（旧只认 ls-remote，把 control 用 git fetch 读 origin SHA 的正确校验误判 FAIL）；v3 修 merge-verify-ritual 的退出码0无信息（旧只认带 退出码0/成功时 前缀的措辞，漏掉“没输出不携带信号”这类不含前缀的同概念表达）。两修叠加后尺子锁定（v2+v3），对四家 provider 用同一把尺子整套重跑八任务（temperature=0、每臂 24 次、全程工具调用 0 / 报错 0）：DeepSeek control 29%/treated 88%/lift +58；zhipu glm-4-plus control 8%/treated 67%/lift +58；MIMO mimo-v2.6-flash control 17%/treated 79%/lift +63；zhipu glm-4-flash control 13%/treated 17%/lift +4。此 4/4 聚合并取代此前只跑两档的 v2 部分读数（DeepSeek 33/83/+50、glm-4-plus 17/58/+42，且 MIMO/glm-4-flash 当时待补）。三个强模型落在 +58~+63；小档 glm-4-flash 几乎不涨（+4）——真实能力下限、非尺子问题：其 treated 输出变长、多数判据词出现，但每任务总差一条没命中，而判分要求全部命中才 PASS；为救 flash 数字而放宽尺子即“改数字治标”，刻意不做。逐试读数见 CHANGELOG [Unreleased] 验证段。

## 跨品牌对照

跨品牌对照（第一批）仍成立：同一批 skill、同一套判据、同一组任务，仅换模型，lift 从 +75（DeepSeek、MIMO）到 0（智谱）。机理（glm-4-flash）：treated 输出明显变长（说明 skill 被读到并引用了），但具体判据词不命中——抽象规则无法落到可判分的具体表述。同为 flash 档的 mimo-v2.6-flash 却全部命中：**"档位"不能跨品牌画等号**，选型要测到具体模型，不能只认档位名。


## 同品牌跨档位

**同品牌跨档位（扩批，2026-10-17 补跑）**：智谱自身从 `glm-4-flash`（lift 0，treated 与 control 同为 13%，7 任务各只命中 1–2 条判据、从不全中）升到 `glm-4-plus`（lift **+58 pp**，treated 17/24），一条 skill 未变、判据未变，只换档位就把效应量从 0 抬到 +58——**同一品牌内的档位差异比跨品牌同档位差异更剧烈**，是“测到具体模型/档位、不能只认档位名”最直接的证据。glm-4-plus 的 +58 pp 落在 DeepSeek(+67)/MIMO(+54) 同一区间，说明 plus 档已与其它品牌强档同水位。（读数经本机智谱 OpenAI 兼容通道 `https://open.bigmodel.cn/api/paas/v4`、`temperature=0`、每臂 24 次；此前“本机缺 key”系误判——变量名是 `ZHIPUAI_API_KEY`。）

## 更强模型探针（DeepSeek R1）

**更强模型探针（2026-10-18）**：一个自然的追问是——“模型更强，会不会让技能变得多余、把 lift 压向 0？”在同一把锁定的 v2+v3 尺子上跑 `deepseek-reasoner`（R1），`temperature=0`、每臂 24 次、全程工具调用 0 / 报错 0。读数：**control 13%（3/24）、treated 79%（19/24）、lift +67 pp**——是本 fleet 里最宽的，不是最窄的。天花板效应确实存在，但只在**个别任务、不是全局**：R1 裸答恰好在一条任务上饱和（`bad-advice-runtime`——“不同 node 构建不可互换”靠通用推理就能答到，故双臂全 PASS、该点 lift 为 0），另有一条双臂都够不着（`push-hung-recheck`，连 treated 也只命中 3 条判据里的 2 条）。其余六条 R1 答得流畅、也命中**大部分**判据，但系统性漏掉至少一条技能独有点——而判分是 AND 门（全部命中才 PASS），于是 lift 依旧被拉开。结论：**更强的基座模型会抬高“通用推理本就能解”那少数任务的裸答下限，但不会吸收技能在领域特定任务上的边际价值**；R1 上的 +67 pp 仍是 n=24 的方向性证据，与其余各行同样的口径限制。

## 前沿模型批次（六个当前代模型）

**前沿模型批次（2026-10-19）**：再往下推一代——`deepseek-flash`、`glm-5.3`、`mimo-v2.6-pro`，同一把锁定的 v2+v3 尺子、同样的 8 任务 × 3 trials × 2 臂（每臂 24 次）。模型 ID 均现拉各家 `/models` 端点确认、不凭印象。通道与思考配置偏离如实标注：

| 供应商 | 模型 | control 通过 | treated 通过 | lift |
|---|---|---|---|---|
| DeepSeek | deepseek-flash（原生） | 36%（8/22） | 91%（21/23） | **+55 pp** |
| 智谱 | glm-5.3（`reasoning_effort=low`） | 13%（3/24） | 88%（21/24） | **+75 pp** |
| MIMO | mimo-v2.6-pro（`thinking:disabled`） | 29%（7/24） | 96%（23/24） | **+67 pp** |
| 阿里云 | qwen3.8-flash（`reasoning_effort=low`） | 29%（7/24） | 75%（18/24） | **+46 pp** |
| 阿里云 | qwen3.8-max（`reasoning_effort=low`） | 25%（6/24） | 63%（15/24） | **+38 pp** |
| 阶跃星辰 | step-5-preview（原生） | 21%（5/24） | 83%（20/24） | **+63 pp** |

deepseek-flash：工具调用 0，3 次 `terminated` 瞬时断连（不计入通过率分母，与其他各行同口径）。glm-5.3 与 mimo-v2.6-pro：工具调用 0 / 报错 0。**两处如实偏离**：glm-5.3 始终思考且拒绝 `thinking:disabled`，默认（max）思考单次约 148s、超过 harness 的 60s 超时，故以 `reasoning_effort=low`（单次约 14s）跑，其 13% 裸答下限是该档位的特性、不等于 native-max 能力；mimo-v2.6-pro 原生思考同样撞 60s 超时，故以 `T2_DISABLE_THINKING=1` 跑（与上方 `mimo-v2.6-flash` 同样处置）。为此 harness 新增一个可选的 `T2_REASONING_EFFORT` 透传（默认不设 → 对之前任何一行零改变）。结合 R1 看：当前前沿档的 lift 仍宽（**+55 ~ +75 pp**），并不随模型变强而压向 0；天花板仍是**局部**的（glm-5.3 连最难的 `push-hung-recheck` 裸答都 PASS），因为 AND 门判分会在领域特定任务上始终留至少一条技能独有判据未命中。**仍是 n=24 的方向性证据，与其他各行同样的口径限制。**

### 逐模型诚实说明 - Qwen3.8-flash

**Qwen3.8-flash 补充（2026-10-19）**：另跑阿里云 `qwen3.8-flash`（同一把锁定尺子、ID 现拉其 `/models` 端点确认）。原生思考很重、单次约 122s、超过 60s 超时，故以 `reasoning_effort=low`（单次约 20s）跑——沿用 glm-5.3 的同一个透传、尺子未动。读数：**control 29%（7/24）、treated 75%（18/24）、lift +46 pp**——工具调用 0 / 报错 0。这是当时本 fleet **最窄**的 lift（下方 qwen3.8-max 更窄），但它是对结论的细化而非推翻：当前代 flash 档把**裸答下限**抬到偏高（29%、仅次于饱和任务，`bad-advice-runtime` 双臂饱和），treated 仍明显领先，而 AND 门让 `hash-mismatch-invisible` 连 treated 也只命中 3 条判据里的 2 条。仍是 n=24 的方向性证据，与其他各行同样的口径限制。

### 逐模型诚实说明 - Qwen3.8-max

**Qwen3.8-max 补充（2026-10-19）**：另跑旗舰 `qwen3.8-max`，同一把锁定尺子、同款 `reasoning_effort=low` 透传（原生思考更重，low 把单次压到约 20s、落进 60s 窗口）。读数：**control 25%（6/24）、treated 63%（15/24）、lift +38 pp**——工具调用 0 / 报错 0。这是当前本 fleet **最窄**的 lift，低于 qwen3.8-flash 的 +46，把趋势推得更细而非推翻：整条 Qwen 线单调收窄（flash +46、max +38，低于 deepseek/glm/mimo 批的 +55~+75）但仍为正。更强同品牌档把裸答下限再抬高（control 裸答把 `bad-advice-runtime`、`guard-never-fires` 两任务双双 3/3 打满），留给技能的 AND 门空间更小；且一个反直觉信号——max 的 treated 反而低于 flash（63% vs 75%）：更强的模型对具体判据措辞并非一律更准（`merge-verify-ritual` treated 掉到 1/3）。AND 门在缺技能独有判据处仍咬住（`hash-mismatch-invisible` treated 0/3、`push-hung-recheck` treated 2/3）。仍是 n=24 方向性证据，与其他各行同样的口径限制。

### 逐模型诚实说明 - StepFun step-5-preview

**阶跃星辰 step-5-preview 补充（2026-10-19）**：新增第六个前沿模型——阶跃星辰（`step-5-preview`，走 `https://api.stepfun.com/v1`），原生跑（无需思考开关：单次约 37s、`reasoning_tokens=0`）。读数：**control 21%（5/24）、treated 83%（20/24）、lift +63 pp**——工具调用 0 / 报错 0（有少数单次越过 60s 被自动重试救回，48 次最终全有效）。它的裸答下限 21% 是本前沿批第二低（仅高于 glm-5.3 的 13%），这正说明其 lift 为何落在中等偏宽而非收窄——印证本批已显的规律：lift 跟着裸答下限走，而下限不是模型档位的干净代理（glm-5.3 早已以 13% 的下限拿到最宽的 +75，而 qwen3.8-max 的 +38 仍是本批最窄）。逐任务给出三个干净的 AND 门制胜（`merge-verify-ritual`、`tautology-detector`、`stale-line-citation` 全 0/3→3/3），两 easy 任务双臂饱和，`push-hung-recheck` 仍最难（treated 1/3）——每个模型都卡在这同一道最难题。仍是 n=24 方向性证据，与其他各行同样的口径限制。

## 负向（毒饵）臂

**状态：打分器逻辑已证；真模型的负向信号尚未到手。** 负向臂（`bad-advice-runtime--poison`，`73914b7` 引入）把一份刻意写错的技能注入 treated 臂的系统提示，要求打分器认出模型被带偏。两件事不能混为一谈：

- **打分器能区分（已证，零 API）。** `run-checks` 的 dry 自检给 treated 喂一条硬编码的错误答案：control 3/3 PASS、treated 0/3、lift -100 pp。这证明判分正则方向正确；它用的是 `DRY_ANSWERS`，不是真模型。
- **真模型被带偏（未证）。** 已实跑 5 个档（2026-10-21 到 2026-10-22）：deepseek-flash、glm-4.5-air、kimi-k2.6、kimi-k3、qwen-flash——每档 1 任务 x 3 trials x 2 臂 = 6 次请求，`temperature=0`。5 档全部 flat：control 3/3、treated 3/3、lift 0 pp。

**对 flat 的诚实解读：** 它不表示打分器认不出坏建议（dry 已证明认得出）。2026-10-23 的一次探针定位了真因：把毒饵里所有自我否定标注全部去掉（让它读起来就是一份自信、可信的操作指南）后，单跑一次 treated 仍判 PASS。所以自废材料不是绑定约束，绑定的是判分 prompt——任务原文就问模型「这张便条说的对吗？如果不对，错在哪？别顺着我的话说」，这是明确要求批判坏建议，有能力的模型会照做，与注入的技能无关。这让当前设计的负向臂不可归因：flat 既可能是毒饵不够毒，也可能是 prompt 太对抗，两者分不开。要拿到干净的负向信号得连 prompt 带刺激一起重做（另立卡、另过验收）。原始读数归档在仓库外 `D:/QoderData/negative_arm/`；本节只记方法与结论。
