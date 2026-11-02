// SPDX-License-Identifier: MIT
import { createHash } from 'node:crypto';

const ARMS = ['control', 'treated'];

// 同一 cell 可能因续跑出现多条记录：只认最后一条（JSONL 追加序即时间序）。
function lastRows(rows) {
  const byCell = new Map();
  for (const row of rows) {
    const key = row.cell_index ?? `${row.task}|${row.prompt_id ?? 'base'}|${row.arm}|${row.trial}`;
    byCell.set(key, row);
  }
  return [...byCell.values()];
}

function pairKey(row) {
  return row.pair_id || `${row.task}|${row.prompt_id ?? 'base'}|${row.trial}`;
}

function armSummary(cells, arm) {
  const mine = cells.filter((row) => row.arm === arm);
  const valid = mine.filter((row) => !row.err);
  return {
    total: mine.length,
    valid: valid.length,
    passed: valid.filter((row) => row.passed).length,
    errors: mine.filter((row) => row.err === 'ERROR').length,
    toolcalls: mine.filter((row) => row.err === 'TOOLCALL').length,
  };
}

// token 只统计 provider 真实返回 usage 的调用；缺失时 calls=0、均值为 null，不编造 0。
function tokenSummary(cells, arm) {
  const mine = cells.filter((row) => row.arm === arm && row.pt != null && row.ct != null);
  const promptTokens = mine.reduce((sum, row) => sum + row.pt, 0);
  const completionTokens = mine.reduce((sum, row) => sum + row.ct, 0);
  const totalTokens = promptTokens + completionTokens;
  return {
    calls: mine.length,
    promptTokens,
    completionTokens,
    totalTokens,
    avgTokens: mine.length ? round1(totalTokens / mine.length) : null,
  };
}

// 失败计入口径：报错/工具调用一律算作未通过，分母是计划内的全部 cell。
function sensitivitySummary(cells, arm) {
  const mine = cells.filter((row) => row.arm === arm);
  const passed = mine.filter((row) => !row.err && row.passed).length;
  return {
    total: mine.length,
    passed,
    passRate: mine.length ? passed / mine.length : 0,
  };
}

function seedFrom(value) {
  if (typeof value === 'number') return value;
  const digest = createHash('sha256').update(String(value)).digest();
  return digest.readUInt32BE(0);
}

// mulberry32：固定种子、零依赖，保证同一批 rows 每次复算得到同一区间。
function mulberry32(a) {
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function quantile(sorted, q) {
  if (!sorted.length) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

// 配对调度：同一 pair 的两臂先后由运行指纹决定，避免“总是 control 先发”的系统性偏向。
export function orderArmsForPair(pairKeyValue, fingerprint = '') {
  const digest = createHash('sha256').update(`${fingerprint}\u0000${pairKeyValue}`).digest();
  return digest[0] % 2 === 0 ? ['control', 'treated'] : ['treated', 'control'];
}

export function summarizeRows(rawRows, { seed = 0, bootstrapSamples = 2000 } = {}) {
  const cells = lastRows(rawRows);
  const arms = Object.fromEntries(ARMS.map((arm) => [arm, armSummary(cells, arm)]));
  const sensitivity = Object.fromEntries(ARMS.map((arm) => [arm, sensitivitySummary(cells, arm)]));
  const tokens = Object.fromEntries(ARMS.map((arm) => [arm, tokenSummary(cells, arm)]));

  const presentArms = new Set(cells.map((row) => row.arm));
  const groups = new Map();
  for (const row of cells) {
    const key = pairKey(row);
    if (!groups.has(key)) groups.set(key, {});
    groups.get(key)[row.arm] = row;
  }

  const perTaskMap = new Map();
  let completePairs = 0;
  let incompletePairs = 0;
  for (const [key, pair] of groups) {
    const control = pair.control;
    const treated = pair.treated;
    if (!control || !treated || control.err || treated.err) {
      incompletePairs++;
      continue;
    }
    completePairs++;
    const delta = treated.passed === control.passed ? 0 : treated.passed ? 1 : -1;
    const task = control.task;
    if (!perTaskMap.has(task)) perTaskMap.set(task, { task, deltas: [] });
    perTaskMap.get(task).deltas.push(delta);
    void key;
  }

  const perTask = [...perTaskMap.values()].map(({ task, deltas }) => ({
    task,
    pairs: deltas.length,
    delta: deltas.reduce((sum, value) => sum + value, 0) / deltas.length,
  }));
  const taskDeltas = perTask.map((entry) => entry.delta);
  const paired = presentArms.has('control') && presentArms.has('treated') && taskDeltas.length >= 2
    ? pairedSummary(taskDeltas, perTask, completePairs, incompletePairs, { seed, bootstrapSamples })
    : null;

  const controlRate = sensitivity.control.passRate;
  const treatedRate = sensitivity.treated.passRate;
  return {
    arms,
    paired,
    sensitivity: {
      ...sensitivity,
      lift: round1((treatedRate - controlRate) * 100),
    },
    tokens,
  };
}

function pairedSummary(taskDeltas, perTask, completePairs, incompletePairs, { seed, bootstrapSamples }) {
  const lift = taskDeltas.reduce((sum, value) => sum + value, 0) / taskDeltas.length * 100;
  const rng = mulberry32(seedFrom(seed));
  const samples = [];
  const k = taskDeltas.length;
  for (let i = 0; i < bootstrapSamples; i++) {
    let sum = 0;
    for (let j = 0; j < k; j++) sum += taskDeltas[Math.floor(rng() * k)];
    samples.push((sum / k) * 100);
  }
  samples.sort((a, b) => a - b);
  return {
    completePairs,
    incompletePairs,
    perTask,
    tasks: perTask.length,
    lift: round1(lift),
    ci: [round1(quantile(samples, 0.025)), round1(quantile(samples, 0.975))],
    bootstrapSamples,
    seed: String(seed),
  };
}
