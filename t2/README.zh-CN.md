# t2 — 技能增益 A/B（需要 API key）

中文 | [English](README.md)

回答一个问题：**加了某颗技能，模型的答案真的变好了吗，好多少？**

做法是最朴素的对照实验。同一批任务跑两臂：

- `control`：只给任务，不给技能
- `treated`：任务前注入技能正文

两臂用同一套**确定性正则判据**打分（不请 LLM 当裁判，不付第二笔钱），比通过率与 lift。

## 三条使用路径

以下命令都在本目录（`t2/`）执行；证据默认落在本目录的 `out/t2/` 下。这个路径相对**当前工作目录**：从仓库根执行 `node t2/smoke-ab.mjs` 时，证据会落在 `<仓库根>/out/t2`，而不是 `t2/out/t2`。

### 路径 1：无密钥体验（零 API 调用）

先证明判分管线有判别力，并把一次运行的证据落到本地：

```bash
node smoke-ab.mjs --dry
node report.mjs out/t2/<run-id> --format markdown
```

`--dry` 用预置答案，不读技能正文、不联网：control 应全 FAIL、treated 应全 PASS，否则退出码非零。运行结束会打印 `evidence = out/t2/<run-id>`，把 `manifest.json`、`rows.jsonl`、`summary.json`、`report.md` 留在该目录。

### 路径 2：真实复跑

```bash
T2_BASE_URL=https://api.example.com/v1 \
T2_API_KEY=sk-... \
T2_MODEL=your-model \
T2_TRIALS=3 \
node smoke-ab.mjs

node report.mjs out/t2/<run-id> --format markdown
```

密钥只从环境变量 `T2_API_KEY` 读；配置文件里出现密钥字段会被直接拒绝。真实运行每个 cell 立即追加一行到 `rows.jsonl`，中途断掉可用 `--resume out/t2/<run-id>` 续跑：有效 cell 跳过、报错 cell 重跑，指纹不一致则拒绝。`--resume` 也接受 `--dry`：一次完整的 `locked-v3` dry run 有 48 个 cell（8 任务 × 3 trials × 2 臂 = 每臂 24），`paired-v4` 有 96 个（每臂 48）。

### 路径 3：接入 CI

CI 里跑零成本的那条即可：

```bash
node smoke-ab.mjs --dry
```

它已包含在 `npm test`（`node run-checks.mjs`）里，任一步失败都会让整条流水线非零退出。要接带密钥的夜间任务：把 key 放进 CI secret，用 `--config t2/t2.example.json` 固定任务集与运行参数，跑完后取机读结果做断言：

```bash
node t2/report.mjs out/t2/<run-id> --format json
```

报告命令只读 `manifest.json` + `rows.jsonl`，不联网。注意 `--dry` 只证明判据能区分好坏答案，不产生可对外引用的模型读数；真实运行才是模型读数。

## 运行尺：locked-v3 与 paired-v4

| ruler | 每任务发出的提示 | 每臂 cells（8 任务 × 3 trials） | 用途 |
|---|---|---|---|
| `locked-v3`（默认） | 只发 base | 24 | 与历史读数同一把尺子，可比 |
| `paired-v4` | base + 一条同语义改写的 `variant-1` | 48 | 检验读数是不是只对某一种问法成立 |

- 变体只改问法与场景措辞，不改判据考察点；毒饵（`poisonOnly`）与体裁试点（`genrePilot`）在 v4 下仍只用 base。
- ruler 会写进运行指纹与 `manifest.json`；换 ruler 等于换尺子，`--resume` 会因指纹不一致拒绝。
- 历史结果表全部来自 `locked-v3`，不要把 `paired-v4` 的数字直接和它比较。

## 证据目录：每个数字都可追溯

一次运行在 `out/t2/<run-id>/` 下留四份文件：

| 文件 | 内容 |
|---|---|
| `manifest.json` | 公开配置（模型、任务、trials、ruler、温度、超时）、每任务判据与实际提示变体、技能/判据 sha256、运行指纹 |
| `rows.jsonl` | 每个 cell 一行，含答案、命中、token、错误类型；续跑只追加不删 |
| `summary.json` | 运行结束时由 rows 复算的汇总 |
| `report.md` | 运行结束时写出的原始汇总转储 |

`report.mjs` 只读 `manifest.json` + `rows.jsonl` 重新复算；`--format json` 的输出与 `summary.json` 逐字段一致，所以报告里的每个汇总数字都能回到某几行 `rows.jsonl`。

**隐私边界：** `rows.jsonl` 保存模型回答全文，可能含敏感内容。结果默认只存本地，且 `out/` 被 Git 忽略；不要直接把证据目录贴进 issue 或分享。

## 离线报告

```bash
node report.mjs <run-dir>                          # Markdown 到 stdout（默认）
node report.mjs <run-dir> --format json            # JSON 到 stdout，形状与 summary.json 相同
node report.mjs <run-dir> --out out/t2/report.md   # 写文件，stdout 为空
```

报告包含总体（valid-only，错误与工具调用单列）、配对 lift 与按题拆解、token 汇总。单臂或少于两个任务时，配对段显式写 `n/a`，不输出伪精确区间；未知 `--format` 或缺少 `<run-dir>` 以退出码 1 拒绝。

## 退出码、schema 版本与证据契约

| 退出码 | 含义 |
|---|---|
| `0` | COMPLETE：dry 通过，或真跑结束且没有任何 ERROR/TOOLCALL cell |
| `1` | 致命：配置被拒、参数/判据非法、dry 两臂没拉开，或证据目录读不了 / `schema_version` 不兼容 |
| `2` | INCOMPLETE：真跑确实写出了证据，但至少有一个 cell 是 ERROR/TOOLCALL；这不是完整读数，应续跑，不得对外引用 |

`2` 与 `1` 刻意分开：`2` 时证据在盘上、值得归档；`1` 时根本没有可用的运行。CI 对任何非零退出码都应判失败，但退出码为 `2` 时可以先把 `out/t2/<run-id>/` 归档。`report.mjs` 遇到未知 `--format`、缺 `<run-dir>` 或不认识的 `schema_version` 一律退出 `1`。

每份证据文件都带 `schema_version`（当前为 `1`，定义在 `lib/store.mjs` 的 `RUN_SCHEMA_VERSION`），`report.md` 头部也会重复写出。`--resume` 与 `report.mjs` 对版本不一致的目录一律拒绝（退出码 `1`），不做静默迁移。

升级规则：

- 新增可选字段算同版本变更：读取方忽略未知字段，旧目录仍可读。
- 删除/改名必填字段、改变既有字段含义、或改变 cell 身份 / 指纹输入时，必须升版本。旧证据留在盘上不动，重新生成，不做格式转换。
- `summary.json` 永远由 `rows.jsonl` 派生，禁止手改；`report.mjs` 用同一批 rows 复算出逐字段一致的汇总。

证据默认根目录 `out/t2/`（可用 `T2_OUT_DIR` 覆盖），一次运行一个目录，`out/` 被 Git 忽略。不要分享证据目录：`rows.jsonl` 含模型回答全文。

可复制的零成本 CI 片段（与 `npm test` 同一批检查，不需要 API key）：

```yaml
- uses: actions/setup-node@v4
  with:
    node-version: '20'
- run: node t2/smoke-ab.mjs --dry
- run: node --test t2/selftest.mjs
- run: node demo/run.mjs --assert
```

## 示例配置

`t2.example.json` 只含公开字段，固定 ruler、任务集、trials 与输出目录：

```bash
node smoke-ab.mjs --config t2.example.json --dry
```

优先级：命令行参数 > 配置文件 > 环境变量 > 续跑目录里的 `public_config` > 默认值。`T2_API_KEY` 永远只从环境读，配置文件不得包含密钥字段。

## 环境变量

| 变量 | 作用 | 默认 |
|---|---|---|
| `T2_BASE_URL` | OpenAI 兼容端点（结尾的 `/` 可有可无） | 必填 |
| `T2_API_KEY` | 密钥 | 必填 |
| `T2_MODEL` | 模型名 | 必填 |
| `T2_RULER` | `locked-v3` / `paired-v4` | `locked-v3` |
| `T2_OUT_DIR` | 证据根目录 | `out/t2` |
| `T2_TIMEOUT` | 单次请求超时（毫秒） | `60000` |
| `T2_CONCURRENCY` | 并发请求数 | `4` |
| `T2_DISABLE_THINKING` | 设 `1` 时随请求发官方参数 `thinking:{type:"disabled"}`。混合思考模型（实测：小米 `mimo-v2.6-flash`）默认开思考，真实任务单次可达 94s，会撞 `askOnce` 的超时；其他 provider 不带该参数，行为不变 | 关 |
| `T2_REASONING_EFFORT` | 透传官方 `reasoning_effort`（如 `low`），压低思考量以落进超时 | 不发送 |
| `T2_TRIALS` | 每臂每任务跑几次 | `3` |
| `T2_SKILL_ROOT` | 技能库根目录 | 本目录下 `skills/` |
| `T2_TASK` | 只跑指定任务（逗号分隔 id） | 全部 |
| `T2_ARM` | `control` / `treated` / `both` | `both` |
| `T2_DUMP` | 设 `1` 时打印每条答案全文 | 关 |

## 命令行参数

| 参数 | 作用 |
|---|---|
| `--dry` | 零调用：用预置答案跑判分管线 |
| `--config <file>` | 读取 JSON 配置（不得含密钥） |
| `--resume <run-dir>` | 续跑：有效 cell 跳过，错误 cell 重跑 |
| `--task <ids>` | 逗号分隔的任务 id |
| `--arm <arm>` | `control` / `treated` / `both` |
| `--trials <n>` | 每臂每任务次数 |
| `--ruler <name>` | `locked-v3` / `paired-v4` |

## 判分口径（重要）

- 每条任务带 1–3 条正则判据，**全部命中才算过**。
- **工具调用与报错单列，不计入通过率。** 技能正文常会促成"先动手核实"的行为，模型可能返回工具调用而不是文字答案。把它算成"答错"会系统性低估技能，所以只对"拿到了文本答案"的调用算通过率。
- 判据设计原则：落在"技能正文里有、裸模型答不到"的点上。否则两臂一起撞天花板，测不出增益。
- 单次 A/B（每臂每任务 1 次）只能证明**管线有判别力**，不能下统计结论。要下"技能确实有用"的结论，n 得上去；先用 `--dry` 和便宜档模型把管线验通，再决定花不花这笔钱。

## 八条任务与七颗被测技能

`smoke-ab.mjs` 里硬编码了八条任务，每条绑定一颗技能（有的任务共用一颗）。`skills/` 下打包了七颗自研技能（MIT），各治一类“看起来对、其实错”的判断：

| 技能 | 治什么 | 对应任务 |
|---|---|---|
| `runtime-resolution-and-abi` | “PATH 里那个 node 能用就行” —— 多版本运行时的定位与钉死 | `bad-advice-runtime` |
| `silent-failure-triage` | “退出码 0 = 成功” —— 静默失败与假成功 | `merge-verify-ritual`、`guard-never-fires` |
| `criterion-self-evidence-check` | “判据把目标自己写进了证据集” —— 同义反复的检查 | `tautology-detector` |
| `stale-output-layers` | “改了却看不到” —— 改动没进到真正被服务那层（身份问题，不是缓存） | `changed-but-not-visible` |
| `line-anchor-drift` | “行号是稳定锚” —— 行号漂移与内容锚 | `stale-line-citation` |
| `text-encoding-forensics` | “内容一样却哈希不同” —— 不可见字节取证 | `hash-mismatch-invisible` |
| `git-push-fake-timeout` | “卡住/超时=失败” —— 假超时与远端真值复核 | `push-hung-recheck` |

它们同时也是被测对象：`smoke-ab.mjs` 的八条任务直接检查模型有没有答到这些技能里的关键点。
