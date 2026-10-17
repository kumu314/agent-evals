# 维护者接管指引（Maintainer Runbook）

中文 | [English](maintainer-runbook.md)

这份文档回答一个问题：**当作者不在场（换人、或作者自己隔了很久回来），你怎么安全地改这个仓库而不把它改坏。**
单维护者项目的最大风险不是代码质量，是"隐性知识只在一个人脑子里"。下面把这些知识显式化。

## 0. 三十秒心智模型

三个套件共享同一套判断口径（见 `docs/eval-primitives.md`）：

- **能确定性判定就别请 LLM 当裁判**——grader 全是正则 / md5 / 字节比对 / 退出码 / 远端 ref 真值。
- **每条判据都要有"故意做错会报红"的负对照**（drill），否则你加的断言可能永远不红 = 同义反复。
- **看到红先怀疑判据本身**，不要照着读数去查业务。

改任何东西前，先确保 `npm test`（= `node run-checks.mjs`）全绿——它是 CI 的本地等价物，零网络零 API。

## 1. 怎么跑（按成本从低到高）

| 命令 | 花钱 | 网络 | 作用 |
|---|---|---|---|
| `npm test` | 否 | 否 | 一键复现 CI 全部确定性自检，任一失败即非零退出 |
| `node demo/run.mjs` | 否 | 否 | 拿仓库自带样例库跑，先红后绿，看效果 |
| `node t2/smoke-ab.mjs --dry` | 否 | 否 | 用预置答案证明判分管线能把好坏答案分开（lift=100） |
| `node fleet-eval/fleet-eval.mjs --trials 2`（设 `FLEET_SHARED`） | 否 | 否 | 技能库全量回归 |
| `node merge-eval/merge-eval.mjs --trials 2`（设 `MERGE_*`） | 否 | 视判据 | 批量合入逐字节不变回归 |
| `node t2/smoke-ab.mjs`（设 `T2_*`） | **是** | 是 | 真跑双臂 A/B，只有这一步消耗 API |

**默认全绿才算改对了。** 任何一步红，按第 4 节排查。

## 2. 加一颗 t2 被测技能 + 任务

t2 的价值全在**判据设计**：判据必须落在"技能正文里有、裸模型答不到"的点上。
否则两臂一起撞天花板（裸模型 control 也过），测不出增益。

1. 在 `t2/skills/<技能名>/SKILL.md` 写技能正文（frontmatter 带 `license: MIT`，去个人信息：不写具体机器路径、身份、私有技能名）。
2. 在 `t2/smoke-ab.mjs` 的 `TASKS` 数组加一条任务：`id / skill / prompt / checks[]`，每个 check 是一条正则 `re`，**全部命中才判 PASS**。
3. 在 `DRY_ANSWERS` 给这条任务补 `control`（一段"自信的错误直觉"答案，一条判据都不命中）和 `treated`（命中全部判据）两段预置答案。
4. 跑 `node t2/smoke-ab.mjs --dry`：control 必须 0%、treated 必须 100%。**dry 不过 = 判据或预置答案错了，禁止进入真跑**（真跑花钱，先用免费的证明管线有判别力）。
5. 只有 dry 绿了才真跑；真跑读数如实写进 `CHANGELOG.md` 的验证段，报错/工具调用按"单列不计入通过率"的口径记。

正则转义提醒：判据是"能命中就行"的宽口径，别追求只命中正确答案——宁可稍宽，漏判由双臂对照兜。

## 3. 加/改一条 fleet-eval 或 merge-eval 断言

- 改 `CHECKS` 后**必须同时改对应的 drill**（`fleet-eval/drill-a1a2.mjs` 或 `merge-eval/drill-merge-eval.mjs`），
  造一个"这条断言该红"的负例，跑出红，才算证明它真的会响。只加绿不加红的断言不收（见 `CONTRIBUTING.md` 约定）。
- 配置一律走 profile / env，**fail-closed**：非法值在加载期 `process.exit(2)`，不留到运行时炸；缺配置要显式报"未配置"，不许静默回退成一个你以为不存在的默认值。
- 布局耦合的判据（如 fleet 依赖 `sync.ps1` 扇出端点）要能被关闭而不报错——用 `FLEET_SCOPE=core` 只跑布局无关项。别人拿去用时配不上是预期的，别让整套件因此跑不起来。

## 4. 红了怎么排查（先怀疑判据）

| 症状 | 最可能原因 | 动作 |
|---|---|---|
| dry 臂没拉开（control≠0 或 treated≠100） | 判据太宽（control 也命中）或预置答案不符 | 收紧 control 让它命不中、或修 treated 让它全命中 |
| drill 该红的没红 | 新断言恒真（同义反复） | 检查判据输入是否含被判定对象自己 |
| fleet-eval 报 ABSENT 一大片 | 端点名单把注释行也读进去了 | 读名单前按行剥 `#` 注释 |
| merge-eval 第一轮全红 | 判据写错方向（历史上真实发生过） | 先拿读数本身做实验，别去查业务 |
| 真跑 treated 为空/报错 | 上游抖动或混合思考模型超时 | 见下：`T2_DISABLE_THINKING=1`；报错单列不混通过率 |

## 5. 发版检查清单

1. `npm test` 全绿（selftest + T2 dry + demo + merge drill + fleet core）。
2. 三平台 CI 绿（ubuntu / windows / macos，`shell: bash`）。
3. `CHANGELOG.md` 的 `[Unreleased]` 固化成本版号，补 tag 链接。
4. 判据语义有变动的，确认文档（各套件 README、`docs/eval-primitives.md`）同步——文档里的读数必须能在仓库脚本里当场复现，转述不算。
5. 打 tag、推 main。

## 6. 环境依赖（踩过一次的坑）

- 需要 **Node ≥ 20.11**（用了 `import.meta.dirname` 与内置 `fetch`）；已写进 `package.json` 的 `engines` 与 `.nvmrc`。
- fleet-eval 部分判据会调 Python（`FLEET_PYTHON` 或 PATH 里的 `python`）；缺 Python 时相关判据应按"无法判定"如实报，不是假装通过。
- t2 真跑对 OpenAI 兼容端点通用；小米 MIMO 这类混合思考模型默认开思考会撞 60s 超时，需 `T2_DISABLE_THINKING=1`。

---
*这份 runbook 本身也应随套件演进更新。改判据/加套件结构时，回头核对这里的命令与文件是否还对得上。*
