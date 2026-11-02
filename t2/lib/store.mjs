// SPDX-License-Identifier: MIT
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { criteriaSnapshot } from './grader.mjs';
import { promptIdsFor, promptFor } from './prompt-variants.mjs';

export const RUN_SCHEMA_VERSION = 1;

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().filter((key) => value[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function publicConfig(config) {
  return {
    dry: config.dry,
    baseUrl: config.baseUrl ?? null,
    model: config.model ?? null,
    trials: config.trials,
    ruler: config.ruler ?? 'locked-v3',
    arm: config.arm,
    arms: config.arms,
    dump: config.dump,
    temperature: config.temperature,
    timeout: config.timeout,
    concurrency: config.concurrency,
    disableThinking: config.disableThinking,
    reasoningEffort: config.reasoningEffort ?? null,
    task_ids: config.tasks.map((task) => task.id),
  };
}

export function buildManifest({ config, runId, createdAt = new Date().toISOString(), skillTexts = {} }) {
  const public_config = publicConfig(config);
  const ruler = config.ruler ?? 'locked-v3';
  const task_definitions = config.tasks.map((task) => {
    const criteria = criteriaSnapshot(task);
    const skillText = skillTexts[task.id];
    // 记录本轮实际会发给模型的每一种提示：prompt 仍是 base，prompts 供 v4 追溯变体。
    const prompts = promptIdsFor(task, ruler).map((id) => ({ id, prompt: promptFor(task, id) }));
    return {
      id: task.id,
      skill: task.skill,
      inject: task.inject ?? 'SKILL.md',
      prompt: task.prompt,
      prompts,
      ...criteria,
      skill_sha256: skillText == null ? null : sha256(skillText),
      criteria_sha256: sha256(canonical(criteria)),
    };
  });
  return {
    schema_version: RUN_SCHEMA_VERSION,
    run_id: runId,
    fingerprint: sha256(canonical({
      schema_version: RUN_SCHEMA_VERSION,
      public_config,
      task_definitions,
    })),
    created_at: createdAt,
    public_config,
    task_definitions,
  };
}

export function loadRun(dir) {
  const manifestPath = path.join(dir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) throw new Error(`续跑目录缺少 manifest.json: ${dir}`);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest.schema_version !== RUN_SCHEMA_VERSION) {
    throw new Error(`manifest schema_version 不兼容: ${manifest.schema_version}`);
  }
  const rowsPath = path.join(dir, 'rows.jsonl');
  const rows = fs.existsSync(rowsPath)
    ? fs.readFileSync(rowsPath, 'utf8').split('\n').filter((line) => line.trim()).map((line) => JSON.parse(line))
    : [];
  return { manifest, rows };
}

// 续跑只补跑“没有记录”或“最后一条仍是错误”的 cell；有效 cell 原样复用，JSONL 历史不删。
export function resumePlan(cells, rows) {
  const last = new Map();
  for (const row of rows) {
    if (row.cell_index != null) last.set(row.cell_index, row);
  }
  const skip = new Map();
  const pending = [];
  for (const cell of cells) {
    const existing = last.get(cell.cellIndex);
    if (existing && !existing.err) skip.set(cell.cellIndex, existing);
    else pending.push(cell);
  }
  return { skip, pending, last };
}

export function assertResumeFingerprint(manifest, fingerprint) {
  if (manifest.fingerprint !== fingerprint) {
    throw new Error(`指纹不一致：续跑目录是 ${manifest.fingerprint.slice(0, 8)}，当前配置是 ${fingerprint.slice(0, 8)}；请保持模型、任务、trials、温度与思考配置不变`);
  }
}

export function createRunStore({
  config,
  dir,
  outDir = config.outDir ?? path.resolve('out/t2'),
  runId,
  createdAt = new Date().toISOString(),
  skillTexts = {},
  manifest: existingManifest,
}) {
  const id = existingManifest?.run_id
    ?? runId
    ?? (dir ? path.basename(dir) : `${createdAt.replace(/[:.]/g, '-')}-${randomBytes(4).toString('hex')}`);
  const runDir = dir ?? path.join(outDir, id);
  const manifest = existingManifest ?? buildManifest({ config, runId: id, createdAt, skillTexts });
  const fingerprint = manifest.fingerprint;

  fs.mkdirSync(runDir, { recursive: true });
  if (!existingManifest) {
    fs.writeFileSync(path.join(runDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  }

  return {
    dir: runDir,
    runId: id,
    fingerprint,
    manifest,
    appendCell(row) {
      fs.appendFileSync(path.join(runDir, 'rows.jsonl'), `${JSON.stringify(row)}\n`);
    },
    finalize(rows, summarizeRows) {
      const summary = {
        schema_version: RUN_SCHEMA_VERSION,
        run_id: id,
        ...summarizeRows(rows),
      };
      fs.writeFileSync(path.join(runDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
      const report = [
        `# T2 run ${id}`,
        '',
        `- schema_version: ${RUN_SCHEMA_VERSION}`,
        `- fingerprint: \`${fingerprint}\``,
        '',
        '```json',
        JSON.stringify(summary, null, 2),
        '```',
        '',
      ].join('\n');
      fs.writeFileSync(path.join(runDir, 'report.md'), report);
      return summary;
    },
  };
}
