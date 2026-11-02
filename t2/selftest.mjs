// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { parseConfig } from './lib/config.mjs';
import { createRunStore, buildManifest, resumePlan, assertResumeFingerprint } from './lib/store.mjs';
import { summarizeRows, orderArmsForPair } from './lib/stats.mjs';
import { score, criteriaSnapshot } from './lib/grader.mjs';
import { TASKS, DRY_ANSWERS } from './lib/tasks.mjs';
import { promptIdsFor, promptFor, PROMPT_VARIANTS } from './lib/prompt-variants.mjs';

function row(overrides = {}) {
  return {
    run_id: 'r', cell_index: 0, pair_id: '', task: 'a', prompt_id: 'base', arm: 'control', trial: 1,
    answer: '', passed: false, hits: [], forbidHits: [], chars: 0, pt: null, ct: null,
    latency_ms: 0, attempts: 1, err: null, msg: null, finished_at: '2026-11-02T00:00:00.000Z',
    ...overrides,
  };
}

const tempDirs = [];
function tempDir() {
  const root = path.resolve(import.meta.dirname, '..', 'out');
  fs.mkdirSync(root, { recursive: true });
  const dir = fs.mkdtempSync(path.join(root, 't2-selftest-'));
  tempDirs.push(dir);
  return dir;
}

test.after(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

test('dry 默认配置不要求密钥，并使用完整锁尺', () => {
  const config = parseConfig({ argv: ['--dry'], env: {}, cwd: import.meta.dirname });
  assert.equal(config.dry, true);
  assert.equal(config.trials, 3);
  assert.deepEqual(config.arms, ['control', 'treated']);
  assert.equal(config.tasks.length, 8);
  assert.ok(config.tasks.every((task) => !task.poisonOnly && !task.genrePilot));
});

test('trials 只接受正整数', () => {
  for (const trials of ['0', '-1', '1.5', 'abc']) {
    assert.throws(
      () => parseConfig({ argv: ['--dry'], env: { T2_TRIALS: trials }, cwd: import.meta.dirname }),
      /T2_TRIALS 必须是正整数/,
    );
  }
});

test('未知任务和空任务选择都 fail-closed', () => {
  assert.throws(
    () => parseConfig({ argv: ['--dry'], env: { T2_TASK: 'missing' }, cwd: import.meta.dirname }),
    /未知任务: missing/,
  );
  assert.throws(
    () => parseConfig({ argv: ['--dry'], env: { T2_TASK: ' , ' }, cwd: import.meta.dirname }),
    /任务集为空/,
  );
});

test('arm 只接受 control、treated 或 both', () => {
  assert.throws(
    () => parseConfig({ argv: ['--dry'], env: { T2_ARM: 'other' }, cwd: import.meta.dirname }),
    /T2_ARM 非法: other/,
  );
});

test('真跑缺少任一必需配置都直接失败', () => {
  const complete = { T2_BASE_URL: 'https://example.test/v1', T2_API_KEY: 'x', T2_MODEL: 'model' };
  for (const key of Object.keys(complete)) {
    const env = { ...complete };
    delete env[key];
    assert.throws(
      () => parseConfig({ argv: [], env, cwd: import.meta.dirname }),
      new RegExp(key),
    );
  }
});

test('CLI 优先于配置文件，配置文件优先于环境变量', () => {
  const dir = tempDir();
  const configPath = path.join(dir, 't2.json');
  fs.writeFileSync(configPath, JSON.stringify({ trials: 2, arm: 'control', model: 'file-model', task: 'bad-advice-runtime' }));
  const config = parseConfig({
    argv: ['--dry', '--config', configPath, '--trials', '5'],
    env: { T2_TRIALS: '4', T2_MODEL: 'env-model', T2_ARM: 'treated' },
    cwd: import.meta.dirname,
  });
  assert.equal(config.trials, 5);
  assert.equal(config.arm, 'control');
  assert.equal(config.model, 'file-model');
  assert.deepEqual(config.tasks.map((task) => task.id), ['bad-advice-runtime']);
});

test('配置文件不得包含密钥字段', () => {
  const dir = tempDir();
  const configPath = path.join(dir, 't2.json');
  fs.writeFileSync(configPath, JSON.stringify({ apiKey: 'must-not-be-here' }));
  assert.throws(
    () => parseConfig({ argv: ['--dry', '--config', configPath], env: {}, cwd: import.meta.dirname }),
    /配置文件不得包含密钥字段: apiKey/,
  );
});

test('证据目录保留公开指纹、原始回答和可确定重算的派生文件', () => {
  const dir = path.join(tempDir(), 'run');
  const config = parseConfig({
    argv: ['--dry'],
    env: { T2_API_KEY: 'never-write-this', T2_TASK: 'bad-advice-runtime', T2_TRIALS: '1' },
    cwd: import.meta.dirname,
  });
  const store = createRunStore({
    config,
    dir,
    runId: 'selftest-run',
    createdAt: '2026-11-01T00:00:00.000Z',
    skillTexts: { 'bad-advice-runtime': 'skill body' },
  });
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  assert.equal(manifest.schema_version, 1);
  assert.equal(manifest.run_id, 'selftest-run');
  assert.equal(manifest.public_config.apiKey, undefined);
  assert.equal(JSON.stringify(manifest).includes('never-write-this'), false);
  assert.equal(manifest.task_definitions[0].prompt, config.tasks[0].prompt);
  assert.match(manifest.task_definitions[0].skill_sha256, /^[a-f0-9]{64}$/);
  assert.match(manifest.task_definitions[0].criteria_sha256, /^[a-f0-9]{64}$/);
  assert.match(manifest.fingerprint, /^[a-f0-9]{64}$/);

  const row = {
    run_id: 'selftest-run', cell_index: 0, pair_id: 'bad-advice-runtime|base|1',
    task: 'bad-advice-runtime', prompt_id: 'base', arm: 'treated', trial: 1,
    answer: '原生模块 ABI 不兼容，用绝对路径钉死解释器。',
    passed: true, hits: ['否定便条', '钉死手法'], forbidHits: [],
    chars: 25, pt: null, ct: null, latency_ms: 0, attempts: 0,
    err: null, msg: null, finished_at: '2026-11-01T00:00:01.000Z',
  };
  store.appendCell(row);
  const rows = fs.readFileSync(path.join(dir, 'rows.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(rows[0].task, 'bad-advice-runtime');
  assert.equal(rows[0].answer, row.answer);
  assert.deepEqual(rows[0].hits, ['否定便条', '钉死手法']);

  const summarize = (input) => ({ total: input.length, passed: input.filter((x) => x.passed).length });
  const first = store.finalize(rows, summarize);
  const firstText = fs.readFileSync(path.join(dir, 'summary.json'), 'utf8');
  const second = store.finalize(rows, summarize);
  assert.deepEqual(first, second);
  assert.equal(fs.readFileSync(path.join(dir, 'summary.json'), 'utf8'), firstText);
  assert.equal(JSON.parse(firstText).total, 1);
  assert.match(fs.readFileSync(path.join(dir, 'report.md'), 'utf8'), /selftest-run/);
});

test('dry 执行逐 cell 写入本地证据目录', async () => {
  const outDir = tempDir();
  const child = spawn(process.execPath, [path.join(import.meta.dirname, 'smoke-ab.mjs'), '--dry'], {
    env: {
      ...process.env,
      T2_OUT_DIR: outDir,
      T2_API_KEY: 'dry-secret-must-not-persist',
      T2_TASK: 'bad-advice-runtime',
      T2_TRIALS: '1',
      T2_ARM: 'both',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  const code = await new Promise((resolve) => child.on('close', resolve));
  assert.equal(code, 0, output);
  const runs = fs.readdirSync(outDir);
  assert.equal(runs.length, 1);
  const dir = path.join(outDir, runs[0]);
  for (const file of ['manifest.json', 'rows.jsonl', 'summary.json', 'report.md']) {
    assert.equal(fs.existsSync(path.join(dir, file)), true, file);
  }
  const manifestText = fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8');
  assert.equal(manifestText.includes('dry-secret-must-not-persist'), false);
  const rows = fs.readFileSync(path.join(dir, 'rows.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(rows.length, 2);
  assert.ok(rows.every((row) => typeof row.answer === 'string'));
  // JSONL 按调度/完成序追加，不保证 canonical 顺序；证据只需完整覆盖每一格。
  assert.deepEqual(rows.map((row) => row.cell_index).sort((a, b) => a - b), [0, 1]);
});

test('真跑出现 TOOLCALL 时以 INCOMPLETE 退出码 2 收口', async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      choices: [{
        message: { content: null, tool_calls: [{ function: { name: 'inspect' } }] },
        finish_reason: 'tool_calls',
      }],
    }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const child = spawn(process.execPath, [path.join(import.meta.dirname, 'smoke-ab.mjs')], {
    env: {
      ...process.env,
      T2_BASE_URL: `http://127.0.0.1:${port}/v1`,
      T2_API_KEY: 'test-only',
      T2_MODEL: 'test-model',
      T2_TASK: 'bad-advice-runtime',
      T2_TRIALS: '1',
      T2_ARM: 'both',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  const code = await new Promise((resolve) => child.on('close', resolve));
  await new Promise((resolve) => server.close(resolve));
  assert.match(output, /INCOMPLETE/);
  assert.equal(code, 2);
});

test('配对统计：按 task 均值、完整配对与失败计入三口径', () => {
  const rows = [
    row({ cell_index: 0, task: 'a', arm: 'control', trial: 1, passed: false }),
    row({ cell_index: 1, task: 'a', arm: 'treated', trial: 1, passed: true }),
    row({ cell_index: 2, task: 'b', arm: 'control', trial: 1, passed: true }),
    row({ cell_index: 3, task: 'b', arm: 'treated', trial: 1, passed: true }),
    row({ cell_index: 4, task: 'b', arm: 'control', trial: 2, passed: false }),
    row({ cell_index: 5, task: 'b', arm: 'treated', trial: 2, passed: false, err: 'ERROR' }),
    row({ cell_index: 6, task: 'a', arm: 'control', trial: 2, passed: false }),
  ];
  const s = summarizeRows(rows, { seed: 7, bootstrapSamples: 200 });
  assert.equal(s.arms.control.valid, 4);
  assert.equal(s.arms.treated.valid, 2);
  assert.equal(s.arms.treated.errors, 1);
  assert.equal(s.paired.completePairs, 2);
  assert.equal(s.paired.incompletePairs, 2);
  assert.deepEqual(s.paired.perTask.map((x) => [x.task, x.delta]), [['a', 1], ['b', 0]]);
  assert.equal(s.paired.lift, 50);
  assert.equal(s.sensitivity.control.total, 4);
  assert.equal(s.sensitivity.control.passed, 1);
  assert.equal(s.sensitivity.control.passRate, 0.25);
  assert.equal(s.sensitivity.treated.total, 3);
  assert.equal(s.sensitivity.treated.passed, 2);
});

test('配对统计：单臂或少于两个任务时拒绝输出伪精确区间', () => {
  const singleArm = [
    row({ cell_index: 0, task: 'a', arm: 'control' }),
    row({ cell_index: 1, task: 'b', arm: 'control' }),
  ];
  assert.equal(summarizeRows(singleArm).paired, null);

  const oneTask = [
    row({ cell_index: 0, task: 'a', arm: 'control', passed: true }),
    row({ cell_index: 1, task: 'a', arm: 'treated', passed: true }),
  ];
  assert.equal(summarizeRows(oneTask).paired, null);
});

test('配对统计：同一 rows 与 seed 产出相同区间，cell 重复时取最后一条', () => {
  const rows = [
    row({ cell_index: 0, task: 'a', arm: 'control', passed: false }),
    row({ cell_index: 1, task: 'a', arm: 'treated', passed: true }),
    row({ cell_index: 2, task: 'b', arm: 'control', passed: true }),
    row({ cell_index: 3, task: 'b', arm: 'treated', passed: false }),
    // 续跑重试：同一 cell 的旧记录在前、新记录在后，汇总只认最后一条
    row({ cell_index: 1, task: 'a', arm: 'treated', passed: false, err: 'ERROR', finished_at: '2026-11-02T00:00:02.000Z' }),
    row({ cell_index: 1, task: 'a', arm: 'treated', passed: true, finished_at: '2026-11-02T00:00:03.000Z' }),
  ];
  const first = summarizeRows(rows, { seed: 11, bootstrapSamples: 200 });
  const second = summarizeRows(rows, { seed: 11, bootstrapSamples: 200 });
  assert.deepEqual(first.paired, second.paired);
  assert.equal(first.arms.treated.valid, 2);
});

test('续跑：有效 cell 跳过、错误 cell 重排、指纹不一致拒绝', () => {
  const cells = [{ cellIndex: 0 }, { cellIndex: 1 }];
  const rows = [
    row({ cell_index: 0, passed: true }),
    row({ cell_index: 1, passed: false, err: 'ERROR' }),
  ];
  const plan = resumePlan(cells, rows);
  assert.deepEqual(plan.pending.map((cell) => cell.cellIndex), [1]);
  assert.equal(plan.skip.get(0).passed, true);

  const healed = [...rows, row({ cell_index: 1, passed: true })];
  assert.deepEqual(resumePlan(cells, healed).pending.map((cell) => cell.cellIndex), []);
  assert.throws(() => assertResumeFingerprint({ fingerprint: 'aaa' }, 'bbb'), /指纹不一致/);
  assert.doesNotThrow(() => assertResumeFingerprint({ fingerprint: 'aaa' }, 'aaa'));
});

test('续跑：部分 rows 后只补跑缺失/失败 cell，汇总仍每个 cell 一条', async () => {
  const outDir = tempDir();
  const env = {
    ...process.env,
    T2_OUT_DIR: outDir,
    T2_TASK: 'bad-advice-runtime',
    T2_TRIALS: '1',
    T2_ARM: 'both',
  };
  const spawnSmoke = (args) => {
    const child = spawn(process.execPath, [path.join(import.meta.dirname, 'smoke-ab.mjs'), ...args], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });
    return new Promise((resolve) => child.on('close', (code) => resolve({ code, output })));
  };

  const first = await spawnSmoke(['--dry']);
  assert.equal(first.code, 0, first.output);
  const runs = fs.readdirSync(outDir);
  assert.equal(runs.length, 1);
  const runDir = path.join(outDir, runs[0]);
  const rowsPath = path.join(runDir, 'rows.jsonl');
  const initial = fs.readFileSync(rowsPath, 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(initial.length, 2);
  // 模拟中断：一条已有效，另一条是失败记录；续跑前不删历史，只补跑失败的那一格
  const failed = { ...initial[1], passed: false, answer: '', hits: [], forbidHits: [], chars: 0, err: 'ERROR', msg: 'simulated' };
  fs.writeFileSync(rowsPath, `${JSON.stringify(initial[0])}\n${JSON.stringify(failed)}\n`);

  const second = await spawnSmoke(['--dry', '--resume', runDir]);
  assert.equal(second.code, 0, second.output);
  const after = fs.readFileSync(rowsPath, 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(after.length, 3, '只补跑失败的那一格，有效 cell 不重复写');
  const summary = JSON.parse(fs.readFileSync(path.join(runDir, 'summary.json'), 'utf8'));
  assert.equal(summary.arms.control.total, 1);
  assert.equal(summary.arms.control.valid, 1);
  assert.equal(summary.arms.treated.total, 1);
  assert.equal(summary.arms.treated.valid, 1);
  assert.equal(after.filter((r) => r.err).length, 1, '历史失败记录保留在 JSONL，不删证据');
});

test('配对调度：同一 pair 的两臂顺序由指纹决定且可复现', () => {
  const orders = new Set();
  for (let i = 0; i < 20; i++) {
    const key = `bad-advice-runtime|base|${i}`;
    const order = orderArmsForPair(key, 'fingerprint-abc');
    assert.deepEqual(order, orderArmsForPair(key, 'fingerprint-abc'));
    assert.deepEqual([...order].sort(), ['control', 'treated']);
    orders.add(order.join('>'));
  }
  assert.equal(orders.size, 2, '不同 pair 应能出现两种先后，避免系统性偏向某一臂');
});

// ---- Task 5：判据对抗 fixture、唯一判分入口与变异测试 ----
function criteriaFixture() {
  return JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'fixtures', 'criteria.json'), 'utf8'));
}

test('判据 fixture 覆盖全部任务与每条 check/forbid', () => {
  const fixture = criteriaFixture();
  assert.deepEqual(Object.keys(fixture).sort(), TASKS.map((task) => task.id).sort());
  for (const task of TASKS) {
    const entry = fixture[task.id];
    assert.deepEqual(
      Object.keys(entry.positiveParts).sort(),
      task.checks.map((check) => check.name).sort(),
      `${task.id} 的正例片段必须逐条覆盖 check`,
    );
    for (const forbidden of task.forbid ?? []) {
      assert.equal(typeof entry.forbidParts?.[forbidden.name], 'string', `${task.id}/${forbidden.name} 缺少否决例`);
    }
    for (const key of ['wrong', 'negated', 'keywordStuffed']) {
      assert.equal(typeof entry[key], 'string', `${task.id} 缺少 ${key}`);
      assert.ok(entry[key].trim(), `${task.id} 的 ${key} 不能为空`);
    }
    for (const [name, text] of Object.entries(entry.positiveParts)) {
      assert.ok(text.trim(), `${task.id}/${name} 的正例片段不能为空`);
    }
  }
});

test('fixture 正例片段只命中自己的判据，拼接后整体通过', () => {
  const fixture = criteriaFixture();
  for (const task of TASKS) {
    const entry = fixture[task.id];
    for (const check of task.checks) {
      const single = score(entry.positiveParts[check.name], task);
      assert.deepEqual(single.hits, [check.name], `${task.id}/${check.name} 片段应精确命中`);
      assert.deepEqual(single.forbidHits, [], `${task.id}/${check.name} 片段不得触发否决`);
    }
    const combined = task.checks.map((check) => entry.positiveParts[check.name]).join('；');
    const result = score(combined, task);
    assert.equal(result.passed, true, `${task.id} 拼接正例应通过`);
    assert.equal(result.hits.length, task.checks.length);
    assert.deepEqual(result.forbidHits, []);
  }
});

test('fixture 正例片段不复制 DRY_ANSWERS', () => {
  const fixture = criteriaFixture();
  for (const task of TASKS) {
    const dry = DRY_ANSWERS[task.id];
    for (const [name, text] of Object.entries(fixture[task.id].positiveParts)) {
      for (const arm of ['control', 'treated']) {
        assert.equal(dry[arm].includes(text), false, `${task.id}/${name} 不得整段复制 ${arm} 预置答案`);
      }
    }
  }
});

test('fixture 错误例、否定例、关键词堆砌例都过不了 AND 门', () => {
  const fixture = criteriaFixture();
  for (const task of TASKS) {
    for (const key of ['wrong', 'negated', 'keywordStuffed']) {
      assert.equal(score(fixture[task.id][key], task).passed, false, `${task.id}/${key} 不应通过`);
    }
  }
});

test('fixture 否决例命中 forbid，且正例叠加否决例 = FAIL', () => {
  const fixture = criteriaFixture();
  for (const task of TASKS) {
    if (!task.forbid?.length) continue;
    const entry = fixture[task.id];
    const clean = task.checks.map((check) => entry.positiveParts[check.name]).join('；');
    for (const forbidden of task.forbid) {
      const sample = score(entry.forbidParts[forbidden.name], task);
      assert.ok(sample.forbidHits.includes(forbidden.name), `${task.id}/${forbidden.name} 否决例必须命中`);
      const poisoned = `${clean}；${entry.forbidParts[forbidden.name]}`;
      assert.equal(score(poisoned, task).passed, false, `${task.id} 正例叠加否决例必须 FAIL`);
    }
  }
});

test('变异测试：删掉任意一条 check，缺它的答案就从 FAIL 变 PASS', () => {
  const fixture = criteriaFixture();
  for (const task of TASKS) {
    task.checks.forEach((check, index) => {
      const entry = fixture[task.id];
      const answer = task.checks
        .filter((_, other) => other !== index)
        .map((other) => entry.positiveParts[other.name])
        .join('；') || '无';
      assert.equal(score(answer, task).passed, false, `${task.id} 缺「${check.name}」时必须 FAIL`);
      const mutated = { ...task, checks: task.checks.filter((_, other) => other !== index) };
      assert.equal(score(answer, mutated).passed, true, `${task.id} 删除「${check.name}」后必须 PASS，证明是这条判据在拦`);
    });
  }
});

test('变异测试：删掉 forbid，毒饵答案就从 FAIL 变 PASS', () => {
  const fixture = criteriaFixture();
  for (const task of TASKS) {
    if (!task.forbid?.length) continue;
    const entry = fixture[task.id];
    const clean = task.checks.map((check) => entry.positiveParts[check.name]).join('；');
    for (const forbidden of task.forbid) {
      const poisoned = `${clean}；${entry.forbidParts[forbidden.name]}`;
      assert.equal(score(poisoned, task).passed, false, `${task.id} 含「${forbidden.name}」时必须 FAIL`);
      const mutated = { ...task, forbid: task.forbid.filter((item) => item.name !== forbidden.name) };
      assert.equal(score(poisoned, mutated).passed, true, `${task.id} 删除「${forbidden.name}」后必须 PASS`);
    }
  }
});

// ---- Task 6：paired-v4 提示变体 ----
const lockedTasks = () => TASKS.filter((task) => !task.poisonOnly && !task.genrePilot);

test('ruler 提示集合：v3 只有 base，v4 增加 variant-1，毒饵与体裁试点保持 base', () => {
  for (const task of lockedTasks()) {
    assert.deepEqual(promptIdsFor(task, 'locked-v3'), ['base']);
    assert.deepEqual(promptIdsFor(task, 'paired-v4'), ['base', 'variant-1']);
    assert.notEqual(promptFor(task, 'variant-1'), task.prompt);
  }
  for (const task of TASKS.filter((item) => item.poisonOnly || item.genrePilot)) {
    assert.deepEqual(promptIdsFor(task, 'paired-v4'), ['base']);
  }
});

test('变体覆盖全部锁尺任务，且每个变体文本非空、不与 base 相同', () => {
  const ids = lockedTasks().map((task) => task.id).sort();
  assert.deepEqual(Object.keys(PROMPT_VARIANTS).sort(), ids, '变体表必须且只能覆盖锁尺任务');
  for (const task of lockedTasks()) {
    const variant = PROMPT_VARIANTS[task.id]['variant-1'];
    assert.equal(typeof variant, 'string');
    assert.ok(variant.trim(), `${task.id} 的 variant-1 不能为空`);
    assert.notEqual(variant, task.prompt);
  }
});

test('ruler 参与配置校验与运行指纹，manifest 记录实际 prompt 与 prompt_id', () => {
  const base = parseConfig({ argv: ['--dry'], env: {}, cwd: import.meta.dirname });
  assert.equal(base.ruler, 'locked-v3');
  assert.throws(
    () => parseConfig({ argv: ['--dry'], env: { T2_RULER: 'paired-v5' }, cwd: import.meta.dirname }),
    /T2_RULER 非法: paired-v5/,
  );
  const build = (ruler) => buildManifest({
    config: { ...base, ruler },
    runId: 'ruler-run',
    createdAt: '2026-11-01T00:00:00.000Z',
  });
  const v3 = build('locked-v3');
  const v4 = build('paired-v4');
  assert.notEqual(v3.fingerprint, v4.fingerprint, 'ruler 必须进入运行指纹');
  assert.deepEqual(v3.task_definitions[0].prompts.map((item) => item.id), ['base']);
  const entry = v4.task_definitions.find((item) => item.id === 'bad-advice-runtime');
  assert.deepEqual(entry.prompts.map((item) => item.id), ['base', 'variant-1']);
  assert.equal(entry.prompts[0].prompt, entry.prompt);
  assert.notEqual(entry.prompts[1].prompt, entry.prompt);
  assert.equal(v4.public_config.ruler, 'paired-v4');
});

test('dry 运行：v3 每臂 24 cells，v4 每臂 48 cells，dry 答案按 task 复用', async () => {
  const run = async (ruler) => {
    const outDir = tempDir();
    const child = spawn(process.execPath, [path.join(import.meta.dirname, 'smoke-ab.mjs'), '--dry'], {
      env: {
        ...process.env,
        T2_OUT_DIR: outDir,
        T2_TRIALS: '3',
        T2_ARM: 'both',
        T2_RULER: ruler,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });
    const code = await new Promise((resolve) => child.on('close', resolve));
    assert.equal(code, 0, output);
    const dir = path.join(outDir, fs.readdirSync(outDir)[0]);
    return fs.readFileSync(path.join(dir, 'rows.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  };

  const v3 = await run('locked-v3');
  assert.equal(v3.filter((r) => r.arm === 'control').length, 24, 'v3 每臂 8 题 × 3 trials');
  assert.equal(v3.filter((r) => r.arm === 'treated').length, 24);
  assert.ok(v3.every((r) => r.prompt_id === 'base'));

  const v4 = await run('paired-v4');
  assert.equal(v4.filter((r) => r.arm === 'control').length, 48, 'v4 每臂 8 题 × 2 提示 × 3 trials');
  assert.equal(v4.filter((r) => r.arm === 'treated').length, 48);
  for (const task of lockedTasks()) {
    const pick = (promptId) => v4.find((r) => r.task === task.id && r.prompt_id === promptId && r.arm === 'control' && r.trial === 1);
    assert.equal(pick('variant-1').answer, pick('base').answer, `${task.id} dry 答案按 task 复用`);
  }
});

// ---- Task 7：离线报告只读证据目录 ----
test('离线报告只从 rows/manifest 复算，JSON 与 summary.json 相同，Markdown 含配对与 token', async () => {
  const dir = path.join(tempDir(), 'report-run');
  const config = parseConfig({
    argv: ['--dry'],
    env: { T2_TASK: 'bad-advice-runtime,merge-verify-ritual', T2_TRIALS: '1' },
    cwd: import.meta.dirname,
  });
  const store = createRunStore({
    config,
    dir,
    runId: 'report-run',
    createdAt: '2026-11-01T00:00:00.000Z',
    skillTexts: { 'bad-advice-runtime': 'skill-a', 'merge-verify-ritual': 'skill-b' },
  });
  const rows = [
    row({ cell_index: 0, pair_id: 'bad-advice-runtime|base|1', task: 'bad-advice-runtime', arm: 'control', passed: false, pt: 12, ct: 8 }),
    row({ cell_index: 1, pair_id: 'bad-advice-runtime|base|1', task: 'bad-advice-runtime', arm: 'treated', passed: true, pt: 15, ct: 10 }),
    row({ cell_index: 2, pair_id: 'merge-verify-ritual|base|1', task: 'merge-verify-ritual', arm: 'control', passed: true, pt: 11, ct: 9 }),
    row({ cell_index: 3, pair_id: 'merge-verify-ritual|base|1', task: 'merge-verify-ritual', arm: 'treated', passed: false, pt: 7, ct: 5 }),
    row({ cell_index: 4, pair_id: 'bad-advice-runtime|base|2', task: 'bad-advice-runtime', arm: 'treated', trial: 2, passed: false, answer: '', err: 'ERROR', msg: 'simulated' }),
  ];
  for (const item of rows) store.appendCell(item);
  const expected = store.finalize(rows, (input) => summarizeRows(input, { seed: store.fingerprint }));

  const runReport = (args) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(import.meta.dirname, 'report.mjs'), dir, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });
    child.on('close', (code) => (code === 0 ? resolve(output) : reject(new Error(`report exit ${code}: ${output}`))));
  });

  const json = JSON.parse(await runReport(['--format', 'json']));
  assert.deepEqual(json, expected, '报告必须与写盘 summary 逐字段相同');
  assert.equal(json.tokens.control.calls, 2);
  assert.equal(json.tokens.treated.calls, 2, '报错 cell 不计入 token');
  assert.equal(json.arms.treated.errors, 1);

  const markdown = await runReport(['--format', 'markdown']);
  assert.match(markdown, /# T2 report report-run/);
  assert.match(markdown, /## 配对/);
  assert.match(markdown, /## 按题/);
  assert.match(markdown, /Token/);
  assert.match(markdown, /merged|merge-verify-ritual/);

  const outFile = path.join(dir, 'report.from-cli.md');
  assert.equal((await runReport(['--format', 'markdown', '--out', outFile])).trim(), '');
  assert.equal(fs.readFileSync(outFile, 'utf8').trim(), markdown.trim());
});

test('离线报告拒绝未知格式且不访问网络', async () => {
  const dir = path.join(tempDir(), 'empty-run');
  fs.mkdirSync(dir, { recursive: true });
  const child = spawn(process.execPath, [path.join(import.meta.dirname, 'report.mjs'), dir, '--format', 'xml'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  const code = await new Promise((resolve) => child.on('close', resolve));
  assert.equal(code, 1);
  assert.match(output, /--format 只支持 json 或 markdown/);
});

test('判据稳定 id 参与 manifest 指纹', () => {
  const config = parseConfig({ argv: ['--dry'], env: { T2_TASK: 'bad-advice-runtime' }, cwd: import.meta.dirname });
  const task = config.tasks[0];
  const snapshot = criteriaSnapshot(task);
  assert.match(snapshot.checks[0].id, /^bad-advice-runtime/);
  assert.equal(snapshot.checks[0].id, criteriaSnapshot(task).checks[0].id);
  const build = (tasks) => buildManifest({ config: { ...config, tasks }, runId: 'id-run', createdAt: '2026-11-01T00:00:00.000Z' });
  const base = build(config.tasks);
  assert.equal(base.task_definitions[0].checks[0].id, snapshot.checks[0].id);
  const renamed = { ...task, checks: task.checks.map((check, i) => (i === 0 ? { ...check, id: 'custom-check' } : check)) };
  assert.notEqual(build([renamed]).fingerprint, base.fingerprint, '判据 id 改变必须改变运行指纹');
});
