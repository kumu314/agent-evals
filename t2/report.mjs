// SPDX-License-Identifier: MIT
// 离线报告：只读 evidence 目录里的 manifest.json 与 rows.jsonl，不联网、不调用模型。
// 所有数字都从 rows 复算，可与运行结束时写出的 summary.json 逐字段对账。
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { loadRun } from './lib/store.mjs';
import { summarizeRows } from './lib/stats.mjs';

const FORMATS = ['json', 'markdown'];

const pct = (value) => `${(value * 100).toFixed(0)}%`;

function formatMarkdown(summary, manifest) {
  const config = manifest.public_config ?? {};
  const arms = ['control', 'treated'];
  const lines = [
    `# T2 report ${summary.run_id}`,
    '',
    `- schema_version: ${summary.schema_version}`,
    `- fingerprint: \`${manifest.fingerprint}\``,
    `- ruler: ${config.ruler ?? 'locked-v3'}`,
    `- model: ${config.model ?? '(dry-run 未指定)'}`,
    `- tasks: ${manifest.task_definitions.map((task) => task.id).join(', ')}`,
    '',
    '## 总体（valid-only，错误与工具调用单列）',
    '',
    '| arm | total | valid | passed | errors | toolcalls |',
    '|---|---|---|---|---|---|',
  ];
  for (const arm of arms) {
    const item = summary.arms[arm];
    lines.push(`| ${arm} | ${item.total} | ${item.valid} | ${item.passed} | ${item.errors} | ${item.toolcalls} |`);
  }
  lines.push(
    '',
    `- control 有效通过率：${pct(summary.sensitivity.control.passRate)}（${summary.sensitivity.control.passed}/${summary.sensitivity.control.total}，失败计入）`,
    `- treated 有效通过率：${pct(summary.sensitivity.treated.passRate)}（${summary.sensitivity.treated.passed}/${summary.sensitivity.treated.total}，失败计入）`,
    `- sensitivity lift：${summary.sensitivity.lift} pp`,
    '',
    '## 配对',
    '',
  );
  if (summary.paired) {
    const paired = summary.paired;
    lines.push(
      `- 完整配对：${paired.completePairs} / 不完整：${paired.incompletePairs}（tasks=${paired.tasks}）`,
      `- paired lift：${paired.lift} pp，区间 [${paired.ci[0]}, ${paired.ci[1]}]（task-cluster bootstrap ${paired.bootstrapSamples} 次，seed=${paired.seed.slice(0, 8)}）`,
      '',
      '## 按题',
      '',
      '| task | pairs | delta |',
      '|---|---|---|',
    );
    for (const item of paired.perTask) lines.push(`| ${item.task} | ${item.pairs} | ${item.delta} |`);
  } else {
    lines.push('- n/a（单臂或少于两个任务，拒绝输出伪精确区间）');
  }
  lines.push(
    '',
    '## Token（仅 provider 真实返回 usage 的调用）',
    '',
    '| arm | calls | prompt | completion | total | avg/call |',
    '|---|---|---|---|---|---|',
  );
  for (const arm of arms) {
    const item = summary.tokens[arm];
    lines.push(`| ${arm} | ${item.calls} | ${item.promptTokens} | ${item.completionTokens} | ${item.totalTokens} | ${item.avgTokens ?? 'n/a'} |`);
  }
  lines.push(
    '',
    '> 本报告由 rows.jsonl 复算；原始回答可能含敏感内容，默认只存本地，不要直接分享 evidence 目录。',
    '',
  );
  return lines.join('\n');
}

async function main() {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    strict: true,
    options: {
      format: { type: 'string', default: 'markdown' },
      out: { type: 'string' },
    },
  });
  const format = values.format;
  if (!FORMATS.includes(format)) throw new Error(`--format 只支持 json 或 markdown，收到 ${format}`);
  const dir = positionals[0] ? path.resolve(process.cwd(), positionals[0]) : null;
  if (!dir) throw new Error('用法: node t2/report.mjs <run-dir> [--format json|markdown] [--out <file>]');

  const { manifest, rows } = loadRun(dir);
  const summary = {
    schema_version: manifest.schema_version,
    run_id: manifest.run_id,
    ...summarizeRows(rows, { seed: manifest.fingerprint }),
  };
  const text = format === 'json' ? `${JSON.stringify(summary, null, 2)}\n` : formatMarkdown(summary, manifest);
  if (values.out) {
    const outFile = path.resolve(process.cwd(), values.out);
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, text);
  } else {
    process.stdout.write(text);
  }
}

main().catch((error) => {
  console.error(`ERROR: ${error.message}`);
  process.exit(1);
});
