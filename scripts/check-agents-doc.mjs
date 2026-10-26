#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// check-agents-doc.mjs — AGENTS.md 漂移守卫。
//
// 背景：AGENTS.md 是最容易腐烂的一类文件。脚本改名、目录挪走、旗标删掉，文档不会报错，
//       只会安静地教每一个读它的人做错事。规矩本身没有强制力（外部实测里 agent 主动打开
//       规则文件的比例只有个位数），所以本脚本不检查「规矩对不对」，只检查「规矩指向的东西还在不在」。
//
// 三条不变量，任一违反即退出码 1（fail-closed）：
//   (1) 路径：AGENTS.md 在代码语境里点名的仓内路径（目录带尾斜杠 / 文件带已知扩展名）必须在磁盘上存在。
//   (2) 命令：`node <脚本>` 的脚本必须存在；`npm <脚本>` 必须在 package.json 的 scripts 里登记。
//   (3) 旗标与环境变量：命令行里点名的 `--flag` 必须出现在同一条命令调用的那个脚本源码里，
//       行首的 `ENV=` 名必须被那个脚本读取。
//
// 边界（重要）：本守卫证明「文档点名的东西还在仓里」，不证明「文档说的做法是对的」，
//       更不证明「agent 会照做」。旗标只按字面比对 —— 脚本把 `--trials` 换成别名并保留旧名
//       的注释，本脚本仍判绿；那种语义漂移归评审管。
//
// 判据自证性：被判定对象是 AGENTS.md，比对基准是文件系统与脚本源码（独立证据集），不构成自我满足。
//       `--selftest` 的负对照靠「fake 文件集里不放这个键」造出来，提及型语料洗白不了它。
// 零依赖，仅用 node: 内置。所有计数由扫描得出，不凭记忆手填。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOC_REL = 'AGENTS.md';

// 合法缺席：gitignore 掉的运行时产物。文档点名它们是为了禁止提交，不是声称它们存在。
const SKIP_PATHS = new Set(['out/', '%SystemDrive%/']);
const EXT = /\.(?:mjs|cjs|js|json|md|markdown|ya?ml|ps1|txt|html|css|cff|png|jpg|svg)$/i;

// ---------- 取段：只从代码语境取数，散文里的 `A/B` 不算路径声明 ----------
function segments(doc) {
  const segs = [];
  const fence = /```[^\n]*\n([\s\S]*?)```/g;
  let m;
  let rest = doc;
  while ((m = fence.exec(doc))) {
    segs.push({ kind: 'fence', text: m[1] });
    rest = rest.replace(m[0], ' ');
  }
  const inline = /`([^`\n]+)`/g;
  while ((m = inline.exec(rest))) segs.push({ kind: 'inline', text: m[1] });
  return segs;
}

// 前导点**不能**剥：`.github/workflows/ci.yml` 是仓内真实路径，剥成 `github/...` 就是一条假红
// （首跑实测踩过，已被 --selftest 的「点文件回归」用例钉住）。尾点要剥：句末点号会挡住扩展名匹配。
const PUNCT_SPLIT = /[\s,;()<>[\]{}|，、。：；（）「」【】]+/;
const LEAD_STRIP = /^["'`\-—！?]+/u;
const TAIL_STRIP = /["'`.!,;:?）]$/u;

function tokens(text) {
  const out = [];
  for (const raw of text.split(PUNCT_SPLIT)) {
    let t = raw;
    while (t && LEAD_STRIP.test(t)) t = t.replace(LEAD_STRIP, '');
    while (t && TAIL_STRIP.test(t)) t = t.replace(TAIL_STRIP, '');
    if (t) out.push(t);
  }
  return out;
}

// ---------- 声明抽取 ----------
function extract(doc) {
  const paths = [];
  const commands = [];
  for (const seg of segments(doc)) {
    const lines = seg.kind === 'fence' ? seg.text.split('\n') : [seg.text];
    for (const line of lines) {
      const cmd = parseCommand(line);
      if (cmd) commands.push({ ...cmd, where: seg.kind });
      for (const t of tokens(line)) {
        if (isPathClaim(t)) paths.push({ token: t, where: seg.kind });
      }
    }
  }
  return { paths, commands };
}

function isPathClaim(t) {
  if (SKIP_PATHS.has(t)) return false;
  if (/^https?:\/\//.test(t) || t.startsWith('/')) return false; // URL / 绝对路径 / 占位符
  if (/[=|*<>^]/.test(t)) return false;                          // 赋值、通配、尖括号占位
  if (t.startsWith('-')) return false;                           // 旗标另有检查
  return t.endsWith('/') || EXT.test(t);                         // 文档约定的两种写法
}

function parseCommand(line) {
  const s = line.trim().replace(/\s*\\$/, '').replace(/^\$\s+/, '');
  const m = s.match(/^(?:([A-Z][A-Z0-9_]*)=\S+\s+)*(node|npm|npx)\s+(.+)$/);
  if (!m) return null;
  const envs = [];
  const prefix = s.match(/([A-Z][A-Z0-9_]*)=\S+/g) || [];
  for (const p of prefix) envs.push(p.split('=')[0]);
  const runner = m[2];
  const args = s.slice(s.indexOf(runner) + runner.length).trim().split(/\s+/);
  if (runner === 'npm' || runner === 'npx') {
    return { runner, script: null, npmScript: args[0] || '', flags: [], envs };
  }
  let i = 0;
  while (i < args.length && args[i].startsWith('-')) i++; // `node --test x` 里的旗标属 node 自己
  const script = args[i] || null;
  const flags = args.slice(i + 1).filter((a) => a.startsWith('--')).map((a) => a.split('=')[0]);
  return { runner, script, npmScript: '', flags, envs };
}

// ---------- 判定：纯函数，比对基准由调用方注入（便于 --selftest 造负对照） ----------
function verify(claims, { exists, sourceOf, npmScripts }) {
  const bad = [];
  for (const p of claims.paths) {
    const rel = p.token.replace(/^\.\//, '');
    if (!exists(rel)) bad.push(['PATH', rel, 'AGENTS.md 点名，但盘上没有']);
  }
  for (const c of claims.commands) {
    if (c.runner !== 'node') {
      if (!npmScripts || !Object.prototype.hasOwnProperty.call(npmScripts, c.npmScript)) {
        bad.push(['CMD', `${c.runner} ${c.npmScript}`, 'package.json 的 scripts 里没有这个键']);
      }
      continue;
    }
    if (!c.script || !/\.(?:mjs|cjs|js)$/i.test(c.script)) {
      bad.push(['CMD', c.script || c.runner, '命令行的目标不是可执行的 .mjs 脚本名']);
      continue;
    }
    const rel = c.script.replace(/^\.\//, '');
    if (!exists(rel)) {
      bad.push(['CMD', rel, '命令点名的脚本不存在']);
      continue;
    }
    const src = sourceOf(rel) || '';
    for (const f of c.flags) {
      if (!src.includes(f)) bad.push(['FLAG', `${rel} ${f}`, '该旗标在这个脚本源码里找不到']);
    }
    for (const e of c.envs) {
      if (!src.includes(e)) bad.push(['ENV', `${rel} :: ${e}`, '该环境变量不被这个脚本读取']);
    }
  }
  return bad;
}

// ---------- 自检：正对照 + 负对照，证明门会响也会停 ----------
function selftest() {
  const doc = [
    '目录 `fleet-eval/` 与文件 `demo/run.mjs` 都在。',
    '缺席的 `gone/dir/` 必须被抓住。',
    '点文件 `.github/workflows/ci.yml` 的前导点不能被吃掉。',
    '运行时产物 `out/` 与 `%SystemDrive%/` 是刻意缺席，不该报警。',
    '散文里的 `A/B` 与 `owner/repo` 与 `/path/to/repo` 不是路径声明。',
    '```bash',
    'node demo/run.mjs --assert',
    'node demo/run.mjs --no-such-flag',
    'FLEET_SHARED=/x FLEET_SCOPE=core node fleet-eval/fleet-eval.mjs --trials 2',
    'FLEET_ALLOW_FILE=/x node fleet-eval/fleet-eval.mjs',
    'MERGE_REPO=/x node merge-eval/merge-eval.mjs --require-baseline',
    'npm test',
    '```',
  ].join('\n');
  const tree = {
    'fleet-eval/': true,
    'demo/run.mjs': true,
    'fleet-eval/fleet-eval.mjs': true,
    'merge-eval/merge-eval.mjs': true,
    '.github/workflows/ci.yml': true,
  };
  const sources = {
    'demo/run.mjs': 'if (argv.includes("--assert")) process.exit(0);',
    'fleet-eval/fleet-eval.mjs': 'process.env.FLEET_SHARED; process.env.FLEET_SCOPE; argv "--trials"',
    'merge-eval/merge-eval.mjs': 'process.env.MERGE_REPO; argv "--require-baseline"',
  };
  const env = {
    exists: (p) => !!tree[p],
    sourceOf: (p) => sources[p],
    npmScripts: { test: 'node run-checks.mjs' },
  };
  const claims = extract(doc);
  const bad = verify(claims, env);
  const of = (kind) => bad.filter((b) => b[0] === kind).map((b) => b[1]).sort().join(' ');
  const cases = [
    ['会红：点名缺席的目录被抓住，且只有它', of('PATH') === 'gone/dir/'],
    ['会红：未知旗标被抓住，且只有这一条', of('FLAG') === 'demo/run.mjs --no-such-flag'],
    ['会红：脚本不读的环境变量被抓住，且只有这一条', of('ENV') === 'fleet-eval/fleet-eval.mjs :: FLEET_ALLOW_FILE'],
    ['不假红：刻意缺席的 out/ 与 %SystemDrive%/ 未报警', !bad.some((b) => b[1] === 'out/' || b[1] === '%SystemDrive%/')],
    ['不假红：散文 A/B、owner/repo、绝对路径未被当路径声明', !bad.some((b) => b[0] === 'PATH' && /^(A\/B|owner\/repo|\/path)/.test(b[1]))],
    ['不假红：真实旗标与真实 env 全绿', !bad.some((b) => /--assert|--trials|--require-baseline|FLEET_SHARED|FLEET_SCOPE|MERGE_REPO/.test(b[1]))],
    ['点文件回归：.github/workflows/ci.yml 以带前导点的形态进声明集', claims.paths.some((p) => p.token === '.github/workflows/ci.yml')],
    ['正对照：让每个声明都命中真实文件，PATH 类违规归零（证明门不是恒红）', verify(claims, { ...env, exists: () => true }).filter((b) => b[0] === 'PATH').length === 0],
    ['分母：路径声明与命令行都被扫到', claims.paths.length >= 6 && claims.commands.length >= 6],
    ['负对照反向自证：整棵树都不存在时，每条路径声明都该报警', verify(claims, { ...env, exists: () => false }).filter((b) => b[0] === 'PATH').length === claims.paths.length],
  ];
  let fail = 0;
  for (const [name, ok] of cases) {
    if (!ok) fail++;
    console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}`);
  }
  console.log(`  读数：路径声明 ${claims.paths.length} · 命令行 ${claims.commands.length} · 违规 ${bad.length}（期望 3）`);
  console.log(fail ? `=> selftest ${fail} 项失败` : `=> selftest 全 ${cases.length} 项通过`);
  return fail ? 1 : 0;
}

if (process.argv.includes('--selftest')) process.exit(selftest());

if (!fs.existsSync(path.join(ROOT, DOC_REL))) {
  console.log('CHECK-RESULT rc=2 :: AGENTS.md 不存在 —— 本守卫与被检对象一起失效，不是通过');
  process.exit(2);
}

const doc = fs.readFileSync(path.join(ROOT, DOC_REL), 'utf8');
const claims = extract(doc);
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const srcCache = new Map();
const bad = verify(claims, {
  exists: (rel) => fs.existsSync(path.join(ROOT, rel.replace(/\//g, path.sep))),
  sourceOf: (rel) => {
    const abs = path.join(ROOT, rel.replace(/\//g, path.sep));
    if (!srcCache.has(rel)) srcCache.set(rel, fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : '');
    return srcCache.get(rel);
  },
  npmScripts: pkg.scripts || {},
});

console.log('AGENTS.md 漂移守卫');
console.log(`  路径声明 ${claims.paths.length} 条 · 命令行 ${claims.commands.length} 条 · ` +
  `旗标 ${claims.commands.reduce((n, c) => n + c.flags.length, 0)} 条 · ` +
  `环境变量 ${claims.commands.reduce((n, c) => n + c.envs.length, 0)} 条`);
for (const [kind, tok, why] of bad) console.log(`  MISSING [${kind}] ${tok} —— ${why}`);
console.log(`CHECK-RESULT rc=${bad.length ? 1 : 0} missing=${bad.length} doc_lines=${doc.split('\n').length}`);
process.exit(bad.length ? 1 : 0);
