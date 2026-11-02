# Agent Evals Trustworthy Runs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让使用者无需相信作者自述，即可运行、追溯、复现并接入确定性评测，同时保持零运行时依赖、无 LLM judge 与历史锁尺可解释。

**Architecture:** 将 T2 的配置、判分、统计、持久化拆成小模块，执行器只负责调度；每次运行写入本地 `out/t2/` 证据目录，报告只从 JSONL 重算。默认 `locked-v3` 保持原任务和 valid-only 读数，新 `paired-v4` 显式启用提示变体、配对调度和 task-cluster 区间。fleet 新增独立端点残留断言，解析器仅对明确危险语法 fail-closed。

**Tech Stack:** Node.js >= 20.11、ESM、`node:test`、`node:util.parseArgs`、内置 `fs/path/crypto`；零第三方运行时依赖。

**施工约束：** 不 push、tag、release、发布 Pages；未获明确请求不创建 git commit；跟踪文件不保存运行输出或本机绝对路径；用户文档中英镜像同步；每个新判据带负对照。

---

## 文件地图

- 新建 `t2/lib/config.mjs`：统一环境变量、配置文件和 CLI，严格校验。
- 新建 `t2/lib/grader.mjs`：唯一 T2 判分入口。
- 新建 `t2/lib/stats.mjs`：valid-only、完整配对、失败计入和聚类 bootstrap。
- 新建 `t2/lib/store.mjs`：manifest、JSONL、续跑读取、运行指纹。
- 新建 `t2/lib/prompt-variants.mjs`：`paired-v4` 的同语义变体，不改锁尺。
- 新建 `t2/selftest.mjs`、`t2/fixtures/criteria.json`：模块单测、判据对抗与变异测试。
- 新建 `t2/report.mjs`、`t2/t2.example.json`：离线报告和公开复现配置。
- 修改 `t2/smoke-ab.mjs`：只保留调度、请求、打印和退出码。
- 修改 `lib/parsers.mjs`、`selftest.mjs`：限定边界的解析失败显式化。
- 修改 `fleet-eval/fleet-eval.mjs`、`fleet-eval/drill-a1a2.mjs`：新增端点残留断言与双向 drill。
- 修改 `run-checks.mjs`、`.github/workflows/ci.yml`：接入全部零成本新检查。
- 修改根目录、`t2/`、`fleet-eval/`、`demo/` 的中英 README，`docs/maintainer-runbook*` 与 `llms.txt`：使用路径、复现、隐私、退出码和断言计数同步。

### Task 1: T2 参数校验与运行状态

**Files:** Create `t2/lib/config.mjs`, `t2/selftest.mjs`; Modify `t2/smoke-ab.mjs`, `run-checks.mjs`.

- [x] **Step 1: 写失败测试**，覆盖 `0/-1/1.5/abc` trials、未知 task、非法 arm、空选择、真跑缺配置，并约定 `parseConfig()` 返回 `dry` 时不强制密钥。

```js
test('未知任务不能变成空运行', () => {
  assert.throws(() => parseConfig({ argv: [], env: { T2_TASK: 'missing' } }), /未知任务/);
});
test('真跑缺模型直接失败', () => {
  assert.throws(() => parseConfig({ argv: [], env: { T2_BASE_URL: 'https://example.test/v1', T2_API_KEY: 'x' } }), /T2_MODEL/);
});
```

- [x] **Step 2: 运行 `node --test t2/selftest.mjs`，确认因模块不存在而 FAIL。**
- [x] **Step 3: 实现 `parseConfig({argv, env, cwd})`，CLI > config JSON > env > 默认值；配置文件出现密钥字段即拒绝。**

```js
const positiveInt = (value, name) => {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${name} 必须是正整数，收到 ${value}`);
  return n;
};
const arms = arm === 'both' ? ['control', 'treated'] : [arm];
if (!['both', 'control', 'treated'].includes(arm)) throw new Error(`T2_ARM 非法: ${arm}`);
if (!activeTasks.length) throw new Error('任务集为空，拒绝运行');
```

- [x] **Step 4: 真跑任一 cell 为 ERROR/TOOLCALL 时写出结果后设退出码 2；0=COMPLETE，1=配置/判据/致命失败，2=INCOMPLETE。超时消息插值实际毫秒数。**
- [x] **Step 5: 运行模块测试和 `node t2/smoke-ab.mjs --dry`，再跑 `npm test`，预期全部 PASS。**

### Task 2: 本地证据目录与隐私边界

**Files:** Create `t2/lib/store.mjs`; Modify `t2/smoke-ab.mjs`, `t2/selftest.mjs`; Use existing `.gitignore` 的 `out/`。

- [x] **Step 1: 写失败测试**，要求 manifest 不含密钥、row 含原始回答和判据细节、相同 rows 重算 summary 完全相等。

```js
assert.equal(manifest.public_config.apiKey, undefined);
assert.equal(row.task, 'bad-advice-runtime');
assert.equal(typeof row.answer, 'string');
assert.deepEqual(summarizeRows(rows), summarizeRows(rows));
```

- [x] **Step 2: 运行测试确认 FAIL。**
- [x] **Step 3: 实现版本化文件：`manifest.json`、`rows.jsonl`、`summary.json`、`report.md`，默认写入 `out/t2/<run-id>/`。**

```js
export const RUN_SCHEMA_VERSION = 1;
// row: run_id, cell_index, pair_id, task, prompt_id, arm, trial,
// answer, passed, hits, forbidHits, chars, pt, ct, latency_ms,
// attempts, err, msg, finished_at
// manifest: schema_version, run_id, fingerprint, created_at,
// public_config, task_definitions；绝不写 T2_API_KEY。
```

- [x] **Step 4: 每个 cell 完成即追加 JSONL；manifest 保存任务提示、技能 SHA256、判据 SHA256 和公开配置。**
- [x] **Step 5: 验证 dry-run 产物存在于忽略目录，且 `git status --short` 不出现运行输出。**

### Task 3: 配对调度与统计口径

**Files:** Create `t2/lib/stats.mjs`; Modify `t2/smoke-ab.mjs`, `t2/selftest.mjs`。

- [x] **Step 1: 用手工 rows 写失败测试**：一组 control PASS/treated FAIL，一组双 PASS，一组 treated 缺失；分别锁定完整配对、valid-only 和失败计入读数。

```js
// 此 fixture 含 a、b 两题；少于两题时 paired 才按下文约定为 null。
const s = summarizeRows(rows);
assert.equal(s.paired.completePairs, 1);
assert.equal(s.paired.perTask.find(x => x.task === 'a').delta, 0);
assert.equal(s.sensitivity.control.total, 2);
```

- [x] **Step 2: 运行测试确认 FAIL。**
- [x] **Step 3: 实现 `summarizeRows(rows, {seed, bootstrapSamples})`。每个 pair 先算 delta，每题取均值，再对 task 做有放回聚类抽样；PRNG 由固定 seed 决定。**

```js
const pairDelta = treated.passed === control.passed ? 0 : treated.passed ? 1 : -1;
// 主 lift = mean(perTask.delta)；区间 = task-cluster bootstrap 的 2.5%/97.5% 分位。
// 少于两个 task 或单臂运行时 paired=null，不输出伪精确区间。
```

- [x] **Step 4: 调度器按 task/prompt/trial 建 pair，用指纹哈希决定两臂先后；展示和持久化汇总按 canonical cell index，消除并发顺序影响。**
- [x] **Step 5: 运行单测与 dry-run，确认旧 valid-only 行仍打印，新 paired/sensitivity 行可复算。**

### Task 4: 断点续跑

**Files:** Modify `t2/lib/store.mjs`, `t2/lib/config.mjs`, `t2/smoke-ab.mjs`, `t2/selftest.mjs`。

- [x] **Step 1: 写失败测试**：已有有效 cell 被跳过，错误 cell 可重试，配置指纹改变时拒绝。

```js
assert.throws(() => loadResume(dir, differentFingerprint), /指纹不一致/);
assert.equal(pending.filter(x => x.key === 'a|base|control|1').length, 0);
```

- [x] **Step 2: 运行测试确认 FAIL。**
- [x] **Step 3: 实现 `--resume <run-dir>`：读取 manifest 公共配置，CLI 覆盖后重新计算指纹；一致才可续跑。JSONL 保留历史记录，汇总只取每个 cell 最后一条；有效 cell 跳过，错误 cell 重跑。**
- [x] **Step 4: 增加中途写入部分 rows 的恢复测试，验证最终每个 cell 只有一个逻辑结果。**
- [x] **Step 5: 运行 `node --test t2/selftest.mjs` 和全套测试。**

### Task 5: 判据对抗 fixture 与变异测试

**Files:** Create `t2/fixtures/criteria.json`, `t2/lib/grader.mjs`; Modify `t2/lib/tasks.mjs`, `t2/selftest.mjs`。

- [x] **Step 1: 写独立 JSON fixture；每条 check 提供不复制 DRY_ANSWERS 的短正例片段，并提供整体错误例、否定例、关键词堆砌例。**

```json
{
  "bad-advice-runtime": {
    "positiveParts": { "否定便条": "原生模块存在 ABI 不兼容", "钉死手法": "用 where node 后以绝对路径固定解释器" },
    "wrong": "PATH 中任意 node 都兼容，无需确认版本",
    "negated": "这不是 ABI 不兼容，也不需要绝对路径",
    "keywordStuffed": "ABI where node 绝对路径，但所有 node 都能直接互换"
  }
}
```

- [x] **Step 2: 先让测试因 fixture 覆盖不全 FAIL；检查 fixture task/check 集合与 TASKS 完全一致。**
- [x] **Step 3: `score(answer, task)` 设为唯一判分入口；所有任务判据增加稳定 `id`，未填 id 时用 `task.id + check.name` 派生并用于 manifest 哈希。**
- [x] **Step 4: 变异测试逐条移除 check：缺少该 check 的回答在原任务必须 FAIL，在变异任务会 PASS，证明测试能抓住判据被删；forbid 同样验证。**
- [x] **Step 5: 运行 `node --test t2/selftest.mjs`，预期所有 fixture 与变异测试 PASS。**

### Task 6: `paired-v4` 提示变体

**Files:** Create `t2/lib/prompt-variants.mjs`; Modify `t2/lib/config.mjs`, `t2/smoke-ab.mjs`, `t2/selftest.mjs`。

- [x] **Step 1: 写失败测试**：默认 ruler 只含 `base`；v4 含 `base` 与 `variant-1`；变体 id 必须覆盖全部锁尺任务。

```js
assert.deepEqual(promptIdsFor(task, 'locked-v3'), ['base']);
assert.deepEqual(promptIdsFor(task, 'paired-v4'), ['base', 'variant-1']);
assert.notEqual(promptFor(task, 'variant-1'), task.prompt);
```

- [x] **Step 2: 运行测试确认 FAIL。**
- [x] **Step 3: 为八条锁尺任务各写一个同语义、不同场景措辞的变体；毒饵和体裁试点保留 base，v4 只对默认锁尺生效。**
- [x] **Step 4: dry 答案按 task 复用，真实调用按变体文本执行；manifest 记录实际 prompt 与 prompt_id。**
- [x] **Step 5: 分别跑两种 ruler 的 dry-run，确认 v3 每臂 24 cells，v4 每臂 48 cells，历史文档数字不改。**

### Task 7: 离线报告、复现包和首次使用闭环

**Files:** Create `t2/report.mjs`, `t2/t2.example.json`; Modify `t2/README.md`, `t2/README.zh-CN.md`, `README.md`, `README.zh-CN.md`。

- [x] **Step 1: 写失败测试/命令**：只对 Task 2 的固定 rows 运行报告，禁止网络，输出与 `summary.json` 相同。

```bash
node t2/report.mjs out/t2/selftest-report --format json
node t2/report.mjs out/t2/selftest-report --format markdown
```

- [x] **Step 2: 实现报告命令，支持 `--format json|markdown` 与 `--out <file>`；读取同一 cell 的最后记录，包含总体、按题、配对、错误和 token。**
- [x] **Step 3: 提供只含公开字段的示例配置，固定 ruler、任务、trials 和输出目录；密钥只从环境读取。**
- [x] **Step 4: 中英文档写清三条路径：无密钥体验、真实复跑、接入 CI；每个汇总数字可追溯到 rows；结果默认本地且可能被 Git 忽略，含敏感回答时不得分享。**
- [x] **Step 5: 从新复制目录只按文档执行 dry、report、fleet demo，不读源码即可完成。**

### Task 8: 解析器限定边界 fail-closed

**Files:** Modify `lib/parsers.mjs`, `selftest.mjs`。

- [x] **Step 1: 写失败测试**：单双引号内 `#` 不截断；真正行注释仍剥离；重复 frontmatter key 抛错；数组扫描遇单引号/模板字符串/注释时不错误截半。

```js
assert.equal(stripPsComments("'D:/a#b' # old"), "'D:/a#b' ");
assert.throws(() => parseFrontmatter('---\nname: a\nname: b\n---\n'), /重复/);
assert.equal(extractPoems('const POEMS = ["a]b"]'), '["a]b"]');
```

- [x] **Step 2: 运行旧测试加新测试，确认新例 FAIL、旧兼容例继续 PASS。**
- [x] **Step 3: 用逐字符状态机处理 PS 单双引号与注释；frontmatter 在写入前检测 own-property；POEMS 扫描支持单引号、模板字符串和注释，未闭合仍返回 null。**
- [x] **Step 4: 不改变既有“缩进行跳过、缺栅栏返回 null”的契约。**
- [x] **Step 5: 运行 `node --test selftest.mjs` 与 merge/fleet drills，预期通过。**

### Task 9: fleet 端点残留垃圾独立断言

**Files:** Modify `fleet-eval/fleet-eval.mjs`, `fleet-eval/drill-a1a2.mjs`, `run-checks.mjs`, fleet/demo/root 中英 README 与 `llms.txt`。

- [x] **Step 1: 在 drill 的 TMP fixture 写非空 endpoint target；先正对照干净，再放入 `cache.bak`，断言新增 `endpoints.junk-absent` 从 PASS 变 FAIL，原 `junk.absent` 保持 PASS。**
- [x] **Step 2: 运行 drill 确认新断言尚不存在而 FAIL。**
- [x] **Step 3: 从 `junk.absent` 抽出共享排除/豁免匹配 helper，保持原扫描结果不变；新 fanout check 对每个 endpoint 只读扫描并报告目标、相对路径和规则。**
- [x] **Step 4: core 仍只跑原 6 项；full 变 12 项，core 跳过 fanout 项变 6 项；注册数、README 计数和 llms 索引同步，历史带日期的实测记录不改。**
- [x] **Step 5: 将 drill 接入 `run-checks.mjs`，运行 `node fleet-eval/drill-a1a2.mjs` 与 `npm test`。**

### Task 10: CI 公共契约与完整接线

**Files:** Modify `.github/workflows/ci.yml`, `run-checks.mjs`, `docs/maintainer-runbook.md`, `docs/maintainer-runbook.zh-CN.md`, `t2/README*`。

- [x] **Step 1: 在文档固定 0/1/2 退出码、schema_version、结果目录和升级兼容规则；提供可复制 CI 片段。**
- [x] **Step 2: CI 增加 `node --test t2/selftest.mjs` 和 `node fleet-eval/drill-a1a2.mjs`，保留现有三平台矩阵与全部检查，不调用真实 API。**
- [x] **Step 3: `run-checks.mjs` 增加相同步骤及全 `.mjs` 语法检查，使本地与 CI 覆盖同一集合。**
- [x] **Step 4: 运行 `node run-checks.mjs`，预期全部步骤 PASS。**

### Task 11: 陌生视角验收与交付审查

**Files:** Modify only files shown by verification to be incorrect; update plan checkboxes.

- [x] **Step 1: 让未参与实现的独立 agent 在干净复制目录仅按 README 操作：dry-run、读取证据、生成报告、破坏 fixture、观察失败、执行续跑测试。**
- [x] **Step 2: 记录所有必须读源码或询问作者才能完成的步骤；修文档或代码后重跑，不替试用者补隐含知识。**
- [x] **Step 3: 运行 `git diff --check`、全部 `.mjs --check`、`npm test`、两个 drill、双 ruler dry-run 和离线报告测试。**
- [x] **Step 4: 用 `git diff --stat` 与 `git status --short` 审查范围；确认无 API key、无本机路径、无运行产物进入跟踪文件。**
- [x] **Step 5: 明确验证边界：独立 agent 试用不等于真实外部人类用户验收；真实 API 未提供密钥时不得声称已验证真实模型结果。**

## 完成定义

- 所有上述自动化检查通过，施工文档勾项与实际 diff 一致。
- 陌生使用者可按文档完成“运行→追溯→复跑→接入→提交反例”，无需作者口头补充。
- 同一原始 rows 永远得到同一 summary；无效运行不会以 COMPLETE 放行。
- 未验证项显式保留，不用实现计划代替真实外部用户或真实 API 证据。
