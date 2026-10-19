#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// guard-readme-numbers.mjs — 双向 token 指纹守卫（评测数字零改动的可复读机械证明）。
//
// 背景：README 可宣传化重构把 t2 逐行明细搬入 docs/t2-results.md，中英各一份。
//       本脚本机械校验两条不变量，任一违反即退出码 1（fail-closed）：
//   (1) 中英镜像：README.md 与 README.zh-CN.md 的「数据指纹」多重集相等；
//       docs/t2-results.md 与 docs/t2-results.zh-CN.md 亦然。
//   (2) 概要可溯源：README 里出现的每个数据 token，必须能在同语言明细文档里找到出处，
//       防止概要凭空造数。
//
// 「数据指纹」= 百分数（pass rate，如 13%）+ 正向 lift（如 +75）。
//   刻意不含 `x/24` 分数串与 `-N`：前者是百分数的冗余二次表示（明细英文用表格、中文用散文，
//   分数出现次数随版式不同而不同，但百分比读数完全一致）；后者多来自模型名连字符（glm-4-flash）。
//   判分口径的载荷数字是「百分比 + lift」，这两类跨语言逐 token 相等即证明数字未改。
//
// 零依赖，仅用 node: 内置。所有数字一律由扫描得出，不凭记忆手填。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const FILES = {
  readmeEn: 'README.md',
  readmeZh: 'README.zh-CN.md',
  detailEn: path.join('docs', 't2-results.md'),
  detailZh: path.join('docs', 't2-results.zh-CN.md'),
};

// 归一化：剔除图片、链接 URL 目标（保留锚文本）、行内代码、HTML 注释——
// 这些里的数字是徽章/路径噪声（如 shields 端点的 %2B、measured-11），不是评测结论。
function normalize(text) {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`[^`]*`/g, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');
}

// 数据指纹（多重集）：百分数 + 正向 lift。
function fingerprint(text) {
  const counts = new Map();
  const add = (t) => counts.set(t, (counts.get(t) || 0) + 1);
  for (const re of [/\b\d+%/g, /\+\d+/g]) {
    let m;
    while ((m = re.exec(text)) !== null) add(m[0]);
  }
  return counts;
}

function load(rel) {
  return fingerprint(normalize(fs.readFileSync(path.join(ROOT, rel), 'utf8')));
}

function multisetDiff(a, b) {
  const out = [];
  for (const [k, v] of a) { const w = b.get(k) || 0; if (w !== v) out.push(`${k} 左${v}/右${w}`); }
  for (const [k, v] of b) if (!a.has(k)) out.push(`${k} 左0/右${v}`);
  return out;
}

const fp = {
  readmeEn: load(FILES.readmeEn),
  readmeZh: load(FILES.readmeZh),
  detailEn: load(FILES.detailEn),
  detailZh: load(FILES.detailZh),
};
const eq = (a, b) => a.size === b.size && [...a].every(([k, v]) => b.get(k) === v);

const problems = [];
// (1) 中英镜像
if (!eq(fp.readmeEn, fp.readmeZh)) problems.push('README 中英数据指纹不一致：' + multisetDiff(fp.readmeEn, fp.readmeZh).join('; '));
if (!eq(fp.detailEn, fp.detailZh)) problems.push('t2-results 中英数据指纹不一致：' + multisetDiff(fp.detailEn, fp.detailZh).join('; '));
// (2) 概要可溯源（各语言独立，按集合成员判定，容忍版式造成的重复次数差异）
for (const { summary, detail, name } of [
  { summary: fp.readmeEn, detail: fp.detailEn, name: 'EN' },
  { summary: fp.readmeZh, detail: fp.detailZh, name: 'zh' },
]) {
  const missing = [...summary.keys()].filter((t) => !detail.has(t));
  if (missing.length) problems.push(`README(${name}) 有数字在明细中找不到出处：` + missing.join(', '));
}

if (problems.length === 0) {
  console.log(`[guard] 双向 token 指纹守卫通过：README 数据指纹 ${fp.readmeEn.size} 种、明细 ${fp.detailEn.size} 种；中英镜像逐一相等，概要数字全部可溯源到明细。`);
  process.exit(0);
}
console.error('[guard] 双向 token 指纹守卫失败（fail-closed）：');
for (const p of problems) console.error('  - ' + p);
process.exit(1);