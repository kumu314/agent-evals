#!/usr/bin/env node
// drill-a1a2.mjs — 证明 fleet-eval 新增的 A1/A2 两条检查「真的会红」。
//
// 思路：不碰任何活文件，而是把被测对象复制到临时目录、注入一个**真实的缺陷**，
// 再用**真实的套件代码**（--only 指定那一条）跑一遍，断言它翻成 FAIL，最后清理。
//
//   A1 注入：删掉 anysearch.py 的 UTF-8 守卫        → 期望 anysearch.encoding-verdict  FAIL
//   A2 注入：往 scan.sanity 体内塞一行 fetch(...)   → 期望 suite.determinism-contract  FAIL
//
//   A1 另带阳性对照：守卫完好的副本走同通道应绿；不绿则环境不可信、红不算数。
// 退出码：0 = 各 drill 全部如期；1 = 有 drill 未按预期工作（说明检查是假绿或环境不可信）。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SUITE = path.join(HERE, 'fleet-eval.mjs');
// F1：不写死默认路径。显式 FLEET_ANYSEARCH 优先，否则由 FLEET_SHARED 派生；两者都没有 → exit 2。
const ANYSEARCH = process.env.FLEET_ANYSEARCH
  || (process.env.FLEET_SHARED ? path.join(process.env.FLEET_SHARED, 'skills', 'anysearch', 'scripts', 'anysearch.py') : null);
if (!ANYSEARCH) {
  console.error('需给 FLEET_ANYSEARCH 或 FLEET_SHARED —— drill 不猜默认位置。');
  process.exit(2);
}
const NODE = process.execPath;
const TMP = path.join(os.tmpdir(), `fleet-drill-${Date.now()}`);

const md5 = (f) => crypto.createHash('md5').update(fs.readFileSync(f)).digest('hex');
const before = { suite: md5(SUITE), anysearch: md5(ANYSEARCH) };

const drills = [];
const record = (name, ok, detail) => {
  drills.push({ name, ok });
  console.log(`[${ok ? 'DRILL-PASS' : 'DRILL-FAIL'}] ${name}\n              ${detail}`);
};

// 把套件源码复制一份到临时目录，并把 OUT_DIR 重定向进临时区（避免污染真实 out/）。
// extraPatch 可选，用来再改一处（A1 用）。
function makeDrillSuite(destName, extraPatch) {
  const src = fs.readFileSync(SUITE, 'utf8');
  let out = src.replace(
    /const OUT_DIR = path\.resolve\(HERE, '\.\.', 'out'\);/,
    `const OUT_DIR = path.resolve(String.raw\`${TMP}\`, 'out');`,
  );
  if (out === src) throw new Error('OUT_DIR 替换未命中');
  if (extraPatch) {
    const after = extraPatch(out);
    if (after === out) throw new Error('extraPatch 替换未命中');
    out = after;
  }
  // F6：套件现在 import '../lib/parsers.mjs'——副本必须镜像仓库布局（fleet/ + lib/），
  // 否则相对导入断链、drill 还没注入缺陷就先撞 TypeError。
  fs.mkdirSync(path.join(TMP, 'fleet'), { recursive: true });
  fs.mkdirSync(path.join(TMP, 'lib'), { recursive: true });
  fs.copyFileSync(path.join(HERE, '..', 'lib', 'parsers.mjs'), path.join(TMP, 'lib', 'parsers.mjs'));
  const dest = path.join(TMP, 'fleet', destName);
  fs.writeFileSync(dest, out, 'utf8');
  return dest;
}

// --only 只跑一条时，该条若 FAIL 套件会退 1；execFileSync 抛错，故从 e.stdout 取 JSON。
// F1：套件现在必填 FLEET_SHARED。drill 缺省指 demo/fixture-clean——
// 被断言的两条检查（anysearch / determinism）不依赖真实库内容，样例库足够喂饱 buildContext。
const FIXTURE = process.env.FLEET_SHARED || path.join(HERE, '..', 'demo', 'fixture-clean');
function runSuiteJson(suitePath, onlyId) {
  try {
    const out = execFileSync(NODE, [suitePath, '--only', onlyId, '--json'],
      { encoding: 'utf8', timeout: 120000, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, FLEET_SHARED: FIXTURE } });
    return JSON.parse(out);
  } catch (e) {
    const out = String(e.stdout || '');
    if (out.trim().startsWith('{')) return JSON.parse(out);
    throw e;
  }
}

function main() {
  fs.mkdirSync(TMP, { recursive: true });

  // ── A1：复制 anysearch.py 到临时目录并删掉 UTF-8 守卫 ──────────────────────
  const guardless = path.join(TMP, 'anysearch.py');
  const asrc = fs.readFileSync(ANYSEARCH, 'utf8');
  const guardBlock = /if hasattr\(sys\.stdout, "reconfigure"\):[\s\S]*?sys\.stderr\.reconfigure\(encoding="utf-8"\)\n/;
  if (!guardBlock.test(asrc)) {
    record('A1 前置：能在 anysearch.py 里定位守卫块', false, '未匹配到 reconfigure 守卫，drill 失效');
  } else {
    // 阳性对照（2026-10-12，F5 同族纪律）：守卫完好的副本走同一条 drill 通道必须绿。
    // 它不绿 = 本环境已不复现 GBK 缺陷（探针失去判别力），下面的"红"就不能算证明。
    const ctlDir = path.join(TMP, 'ctl');
    fs.mkdirSync(ctlDir, { recursive: true });
    const intact = path.join(ctlDir, 'anysearch.py'); // 模块名必须叫 anysearch，放独立目录避免与 guardless 撞名
    fs.writeFileSync(intact, asrc, 'utf8');
    fs.writeFileSync(guardless, asrc.replace(guardBlock, '# [drill] UTF-8 守卫已移除\n'), 'utf8');
    const pyAnchor = /const ANYSEARCH_PY = path\.join\(SHARED, 'skills', 'anysearch', 'scripts', 'anysearch\.py'\);/;
    const drillSuite = makeDrillSuite('fleet-eval-a1.mjs', (s) => s.replace(
      pyAnchor,
      `const ANYSEARCH_PY = String.raw\`${guardless}\`;`,
    ));
    const intactSuite = makeDrillSuite('fleet-eval-a1-control.mjs', (s) => s.replace(
      pyAnchor,
      `const ANYSEARCH_PY = String.raw\`${intact}\`;`,
    ));
    const rc = runSuiteJson(intactSuite, 'anysearch.encoding-verdict').results
      .find((x) => x.id === 'anysearch.encoding-verdict');
    const envTrusted = !!(rc && rc.ok === true);
    record('A1 阳性对照：守卫完好副本应绿', envTrusted,
      `ok=${rc && rc.ok} detail=${rc && rc.detail}`);
    const r = runSuiteJson(drillSuite, 'anysearch.encoding-verdict').results
      .find((x) => x.id === 'anysearch.encoding-verdict');
    record('A1 去守卫后应翻红', envTrusted && r && r.ok === false,
      `ok=${r && r.ok} metrics=${JSON.stringify(r && r.metrics)} detail=${r && r.detail}`);
  }

  // ── A2：往 scan.sanity 体内注入一行网络访问 ────────────────────────────────
  const anchor = 'const ok = skillDirs.length > 0;';
  const ssrc = fs.readFileSync(SUITE, 'utf8');
  if (!ssrc.includes(anchor)) {
    record('A2 前置：能在 scan.sanity 体内定位锚点', false, '锚点未命中');
  } else {
    const drillSuite2 = makeDrillSuite('fleet-eval-a2.mjs', (s) => s.replace(anchor,
      `${anchor}\n      void fetch('https://example.com/'); // [drill] 注入的网络访问`));
    const r = runSuiteJson(drillSuite2, 'suite.determinism-contract').results
      .find((x) => x.id === 'suite.determinism-contract');
    record('A2 注入网络访问后应翻红', r && r.ok === false && r.metrics.netViolations > 0,
      `ok=${r && r.ok} netViolations=${r && r.metrics.netViolations} detail=${r && r.detail}`);
  }

  // ── S1：FLEET_SCOPE=core 显式跳过 fanout/tooling，且缺 sync.ps1 不崩 ──────────
  // 用「无 sync.ps1」的样例库（外部技能库的常见形态）喂真实套件代码，证两件事：
  //   正对照 core：那 5 项被摘掉、只跑 6 项、且不再因缺 sync.ps1 崩；
  //   负对照 full：同一份无 sync.ps1 库走默认口径必须如实报错（不自动降级把配错藏起来）。
  const FANOUT_IDS = ['endpoints.present', 'endpoints.match-authority', 'endpoints.skillmd-parity', 'reconcile.drift-zero', 'anysearch.encoding-verdict'];
  const nosync = path.join(TMP, 'lib-nosync');
  fs.cpSync(path.join(HERE, '..', 'demo', 'fixture-clean', 'skills'), path.join(nosync, 'skills'), { recursive: true });
  const scopeSuite = makeDrillSuite('fleet-eval-scope.mjs'); // 逻辑原样复制，只把 OUT_DIR 导进临时区
  function runScope(envExtra) {
    try {
      const out = execFileSync(NODE, [scopeSuite, '--json'],
        { encoding: 'utf8', timeout: 120000, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, FLEET_SHARED: nosync, ...envExtra } });
      return { code: 0, report: JSON.parse(out) };
    } catch (e) {
      const so = String(e.stdout || '');
      if (so.trim().startsWith('{')) return { code: e.status == null ? 1 : e.status, report: JSON.parse(so) };
      return { code: e.status == null ? 1 : e.status, threw: true };
    }
  }
  const coreRun = runScope({ FLEET_SCOPE: 'core' });
  const cr = coreRun.report;
  const skipOk = !!(cr && cr.scope === 'core'
    && FANOUT_IDS.every((id) => (cr.skipped_by_scope || []).includes(id))
    && cr.results.length === 6
    && cr.results.every((r) => !FANOUT_IDS.includes(r.id)));
  record('S1 正对照：scope=core 跳过 5 项 fanout/tooling 且无 sync.ps1 不崩', skipOk && coreRun.code === 0,
    `scope=${cr && cr.scope} skipped=${cr && (cr.skipped_by_scope || []).length} ran=${cr && cr.results.length} exit=${coreRun.code}`);
  const fullRun = runScope({});
  record('S1 负对照：无 sync.ps1 走默认 full 应如实报错（不自动降级）', fullRun.threw === true,
    `threw=${fullRun.threw === true} exit=${fullRun.code}`);

  // ── 活文件零改动自证 ───────────────────────────────────────────────────────
  const after = { suite: md5(SUITE), anysearch: md5(ANYSEARCH) };
  record('活文件零改动', before.suite === after.suite && before.anysearch === after.anysearch,
    `suite ${before.suite === after.suite ? 'unchanged' : 'CHANGED'} / anysearch ${before.anysearch === after.anysearch ? 'unchanged' : 'CHANGED'}`);
}

try {
  main();
} finally {
  fs.rmSync(TMP, { recursive: true, force: true });
}

const failed = drills.filter((d) => !d.ok);
console.log('-'.repeat(70));
console.log(`drill: ${drills.length - failed.length}/${drills.length} 如期`);
process.exit(failed.length ? 1 : 0);
