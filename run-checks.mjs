#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// run-checks.mjs — 跨平台一键自检：复刻 CI 的零 API/零网络确定性检查序列。
// 目的：把 README 里散文版的运行要求变成 `npm test` 一把跑；env 在进程内设置，
//       不依赖 shell 的 `VAR=val cmd`（那种写法在 Windows cmd/PowerShell 下会崩）。
// 任一子检查非零 => 本脚本非零退出（fail-closed），打印每步 rc 台账。
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const NODE = process.execPath;

// 每项：{ name, argv, env }，argv 相对 ROOT 由子进程 cwd 解析
const STEPS = [
  { name: 'selftest（lib/parsers 单测，node:test）', argv: ['--test', 'selftest.mjs'] },
  { name: 'T2 判分管线自检（零 API）', argv: ['t2/smoke-ab.mjs', '--dry'] },
  { name: 'demo 自检（样例库 → 先红后绿）', argv: ['demo/run.mjs', '--assert'] },
  { name: 'merge-eval 负例 drill（零 API 零网络）', argv: ['merge-eval/drill-merge-eval.mjs'] },
  {
    name: 'fleet-eval core 作用域自检（样例库，摘掉 fanout 5 项）',
    argv: ['fleet-eval/fleet-eval.mjs', '--trials', '1'],
    env: { FLEET_SHARED: path.join(ROOT, 'demo', 'fixture-clean'), FLEET_SCOPE: 'core' },
  },
];

function run(step) {
  return new Promise((resolve) => {
    const c = spawn(NODE, step.argv, {
      cwd: ROOT,
      env: { ...process.env, ...step.env },
      stdio: 'inherit',
      windowsHide: true,
    });
    c.on('error', (e) => resolve({ step, rc: -1, err: e.message }));
    c.on('close', (rc) => resolve({ step, rc }));
  });
}

const ledger = [];
for (const step of STEPS) {
  console.log(`\n=== ${step.name} ===`);
  const r = await run(step);
  ledger.push({ name: step.name, rc: r.rc, err: r.err });
  if (r.rc !== 0) break; // fail-closed：首个失败即停，不掩盖
}

console.log('\n' + '-'.repeat(64));
console.log('run-checks 台账:');
let bad = 0;
for (const e of ledger) {
  const ok = e.rc === 0;
  if (!ok) bad++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] rc=${e.rc} ${e.name}${e.err ? ' (' + e.err + ')' : ''}`);
}
const ran = ledger.length === STEPS.length ? '全部' : `${ledger.length}/${STEPS.length}（提前中断）`;
console.log(bad ? `=> ${bad} 步失败（${ran}）` : `=> 全 ${STEPS.length} 步通过`);
process.exit(bad ? 1 : 0);
