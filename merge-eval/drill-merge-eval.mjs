#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// drill-merge-eval.mjs — 证明 merge-eval 的判据「真的会红」（F5，2026-10-12）。
//
// 思路与 fleet 侧 drill-a1a2 同源：不碰任何活文件，在临时区 git init 一个
// fixture 仓库，注入**真实缺陷**，用**真实套件代码**跑，断言翻红，最后清理。
//
//   S1 阳性对照：合法合入（基线=HEAD、仅批次报告齐）→ 5 项 local 判据全绿
//      —— 对照组不绿就说明环境不可信，下面的"红"不算判据有判别力。
//   S2 越界改动：动了 POEMS 之外的文本          → only-poems-touched 必须 FAIL
//   S3 基线失真：只给旧快照、不给 MERGE_BASE_REF → 三项 stale 判据必须 FAIL
//   S4 缺报告：  授权批次点名 b9 但无 review    → merge-gate FAIL 且 gate=BLOCK
//
// 远端两项（remote-truth.*）在本 drill 里预期为红（fixture 无 origin、未配 slug），
// 不进断言 —— 这是「没配就说没配」的既有纪律，不是本 drill 要证明的东西。
// 零 API、零网络、零外部依赖（git 之外只用 node 内置）。退出码 0 = 全部如期。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SUITE = path.join(HERE, 'merge-eval.mjs');
const LIB = path.join(HERE, '..', 'lib', 'parsers.mjs');
const TMP = path.join(os.tmpdir(), `merge-drill-${Date.now()}`);
const FIX = path.join(TMP, 'repo');
const FIX_INDEX = path.join(FIX, 'index.html');
const STALE_SNAP = path.join(FIX, 'out', 'merge', 'index.baseline-before-merge.html');

// 本机 spawnSync/execFileSync 对任意可执行文件 EBUSY（套件头注实测）——全走异步。
function run(cmd, args, cwd) {
  return new Promise((resolve) => {
    const c = spawn(cmd, args, { cwd, windowsHide: true });
    const out = []; const err = [];
    c.stdout.on('data', (d) => out.push(d));
    c.stderr.on('data', (d) => err.push(d));
    c.on('error', (e) => resolve({ ok: false, code: e.code, stdout: '', stderr: String(e) }));
    c.on('close', (code) => resolve({
      ok: code === 0, code,
      stdout: Buffer.concat(out).toString('utf8'),
      stderr: Buffer.concat(err).toString('utf8'),
    }));
  });
}
const git = (args, cwd) => run('git', args, cwd);

// env 里显式给 undefined 的键 = 从继承环境里删掉（防调用方残留 MERGE_* 串场景）。
function runSuite(overrides) {
  return new Promise((resolve) => {
    const env = { ...process.env, MERGE_REPO: FIX, ...overrides };
    for (const k of Object.keys(env)) if (env[k] === undefined) delete env[k];
    const c = spawn(process.execPath, [SUITE, '--json', '--trials', '1'], { env, windowsHide: true });
    const out = [];
    c.stdout.on('data', (d) => out.push(d));
    c.on('close', () => {
      try { resolve(JSON.parse(Buffer.concat(out).toString('utf8'))); }
      catch (e) { resolve({ __parseFail: String(e), raw: Buffer.concat(out).toString('utf8').slice(0, 300) }); }
    });
  });
}

const pick = (j, id) => (j.results || []).find((r) => r.id === id) || {};
const drills = [];
const record = (name, ok, detail) => {
  drills.push({ name, ok });
  console.log(`[${ok ? 'DRILL-PASS' : 'DRILL-FAIL'}] ${name}`);
  console.log(`              ${String(detail).slice(0, 180)}`);
};

const POEMS_BASE = [{ id: 'p1', t: '甲' }, { id: 'p2', t: '乙' }, { id: 'p3', t: '丙' }];
const poemsHtml = (poems) =>
  '<!doctype html>\n<html>\n<head><style>body{margin:0}</style></head>\n<body>\n<div id="app"></div>\n'
  + `<script>const POEMS = ${JSON.stringify(poems)};</script>\n`
  + '<script>console.log("logic");</script>\n</body>\n</html>\n';

const md5 = (f) => crypto.createHash('md5').update(fs.readFileSync(f)).digest('hex');

async function main() {
  const before = { suite: md5(SUITE), lib: md5(LIB) };

  // ── fixture 仓库：init + 基线提交 + 批次抽检报告提交 ──────────────────────
  fs.mkdirSync(FIX, { recursive: true });
  fs.writeFileSync(FIX_INDEX, poemsHtml(POEMS_BASE), 'utf8');
  let g = await git(['-c', 'init.defaultBranch=main', 'init'], FIX);
  if (!g.ok) { record('fixture git init', false, g.stderr || g.code); return; }
  const gc = ['-c', 'user.name=drill', '-c', 'user.email=drill@localhost'];
  await git(['add', 'index.html'], FIX);
  g = await git([...gc, 'commit', '-m', 'base'], FIX);
  if (!g.ok) { record('fixture 基线提交', false, g.stderr || g.code); return; }
  fs.mkdirSync(path.join(FIX, 'out'), { recursive: true });
  fs.writeFileSync(path.join(FIX, 'out', 'review-b1-drill.md'), '抽检结论: PASS\n', 'utf8');
  await git(['add', 'out/review-b1-drill.md'], FIX);
  g = await git([...gc, 'commit', '-m', 'review b1'], FIX);
  if (!g.ok) { record('fixture 报告提交', false, g.stderr || g.code); return; }
  const head = (await git(['rev-parse', 'HEAD'], FIX)).stdout.trim();

  const LOCAL_IDS = ['scan.sanity', 'poems.count-and-order', 'untouched.hash-zero-diff',
    'only-poems-touched', 'merge-gate.audit-per-batch'];

  // ── S1 阳性对照：合法场景必须全绿，否则后面红了也不说明判据有判别力 ──────
  const j1 = await runSuite({
    MERGE_BASE_REF: head, MERGE_REPO_SLUG: '',
    MERGE_TOUCHED_IDS: '[]', MERGE_RELEASED_BATCHES: '["b1"]',
  });
  const s1 = LOCAL_IDS.filter((id) => pick(j1, id).ok !== true);
  record('S1 阳性对照：5 项 local 全绿', s1.length === 0 && !j1.__parseFail,
    s1.length ? `未绿: ${s1.join(',')} —— ${s1.map((i) => pick(j1, i).detail).join(' | ')}`
      : `gate=${j1.gate_verdict}（远端两项红是预期，不进断言）`);

  // ── S2 越界改动：POEMS 之外追加一行 HTML 注释 ─────────────────────────────
  fs.appendFileSync(FIX_INDEX, '<!-- drill out-of-scope -->\n', 'utf8');
  const j2 = await runSuite({
    MERGE_BASE_REF: head, MERGE_REPO_SLUG: '',
    MERGE_TOUCHED_IDS: '[]', MERGE_RELEASED_BATCHES: '["b1"]',
  });
  const r2 = pick(j2, 'only-poems-touched');
  record('S2 越界改动应翻红', r2.ok === false, `ok=${r2.ok} detail=${r2.detail}`);
  // 复原（S3/S4 要回到合法工作树）
  fs.writeFileSync(FIX_INDEX, poemsHtml(POEMS_BASE), 'utf8');

  // ── S3 基线失真：不给 MERGE_BASE_REF、只留工作区旧快照 ────────────────────
  fs.mkdirSync(path.dirname(STALE_SNAP), { recursive: true });
  fs.writeFileSync(STALE_SNAP, poemsHtml([{ id: 'p1', t: '甲' }, { id: 'pX', t: '异' }, { id: 'p3', t: '丙' }]), 'utf8');
  const j3 = await runSuite({
    MERGE_BASE_REF: undefined, MERGE_REPO_SLUG: '',
    MERGE_TOUCHED_IDS: '[]', MERGE_RELEASED_BATCHES: '["b1"]',
  });
  const staleIds = ['poems.count-and-order', 'untouched.hash-zero-diff', 'only-poems-touched'];
  for (const id of staleIds) {
    const r = pick(j3, id);
    record(`S3 基线失真应翻红: ${id}`, r.ok === false && r.metrics && r.metrics.stale === true,
      `ok=${r.ok} stale=${r.metrics && r.metrics.stale} detail=${r.detail}`);
  }
  fs.rmSync(STALE_SNAP, { force: true });

  // ── S4 缺报告：授权批次点名 b9，但 out/ 里没有 review-b9 ──────────────────
  const j4 = await runSuite({
    MERGE_BASE_REF: head, MERGE_REPO_SLUG: '',
    MERGE_TOUCHED_IDS: '[]', MERGE_RELEASED_BATCHES: '["b1","b9"]',
  });
  const r4 = pick(j4, 'merge-gate.audit-per-batch');
  record('S4 缺报告应翻红且 BLOCK',
    r4.ok === false && r4.metrics && r4.metrics.missing === 1 && j4.gate_verdict === 'BLOCK',
    `ok=${r4.ok} missing=${r4.metrics && r4.metrics.missing} gate=${j4.gate_verdict} detail=${r4.detail}`);

  // ── 活文件零改动自证 ──────────────────────────────────────────────────────
  const after = { suite: md5(SUITE), lib: md5(LIB) };
  record('活文件零改动', before.suite === after.suite && before.lib === after.lib,
    `suite ${before.suite === after.suite ? 'unchanged' : 'CHANGED'} / parsers ${before.lib === after.lib ? 'unchanged' : 'CHANGED'}`);
}

try {
  await main();
} finally {
  fs.rmSync(TMP, { recursive: true, force: true });
}

const failed = drills.filter((d) => !d.ok);
console.log('-'.repeat(70));
console.log(`drill-merge-eval: ${drills.length - failed.length}/${drills.length} 如期`);
process.exit(failed.length ? 1 : 0);
