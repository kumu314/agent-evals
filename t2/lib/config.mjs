// SPDX-License-Identifier: MIT
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { TASKS } from './tasks.mjs';
import { RULERS, validateVariantCoverage } from './prompt-variants.mjs';

const positiveInt = (value, name) => {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${name} 必须是正整数，收到 ${value}`);
  return n;
};

function readConfigFile(configPath) {
  if (!configPath) return {};
  let value;
  try {
    value = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (error) {
    throw new Error(`无法读取配置文件 ${configPath}: ${error.message}`);
  }
  if (!value || Array.isArray(value) || typeof value !== 'object') {
    throw new Error('配置文件必须是 JSON 对象');
  }
  for (const key of Object.keys(value)) {
    if (key.replace(/[-_]/g, '').toLowerCase() === 'apikey' || key.toLowerCase() === 't2_api_key') {
      throw new Error(`配置文件不得包含密钥字段: ${key}`);
    }
  }
  return value;
}

export function parseConfig({ argv = [], env = {}, cwd = process.cwd() } = {}) {
  const { values } = parseArgs({
    args: argv,
    strict: true,
    options: {
      dry: { type: 'boolean' },
      config: { type: 'string' },
      resume: { type: 'string' },
      task: { type: 'string' },
      arm: { type: 'string' },
      trials: { type: 'string' },
      ruler: { type: 'string' },
    },
  });

  const configPath = values.config ? path.resolve(cwd, values.config) : null;
  const file = readConfigFile(configPath);
  const resumeDir = values.resume ? path.resolve(cwd, values.resume) : null;
  let resume = null;
  if (resumeDir) {
    const manifestPath = path.join(resumeDir, 'manifest.json');
    if (!fs.existsSync(manifestPath)) throw new Error(`续跑目录缺少 manifest.json: ${resumeDir}`);
    resume = JSON.parse(fs.readFileSync(manifestPath, 'utf8')).public_config;
    if (!resume) throw new Error(`续跑目录 manifest 缺少 public_config: ${resumeDir}`);
  }
  const envFlag = (name) => (env[name] === undefined ? undefined : env[name] === '1');
  const dry = values.dry ?? file.dry ?? resume?.dry ?? false;
  const arm = values.arm ?? file.arm ?? env.T2_ARM ?? resume?.arm ?? 'both';
  if (!['both', 'control', 'treated'].includes(arm)) throw new Error(`T2_ARM 非法: ${arm}`);
  const ruler = values.ruler ?? file.ruler ?? env.T2_RULER ?? resume?.ruler ?? 'locked-v3';
  if (!RULERS.includes(ruler)) throw new Error(`T2_RULER 非法: ${ruler}`);
  // 变体表 fail-closed：缺一条锁尺变体就在开跑前拒绝，而不是运行时静默只用 base。
  validateVariantCoverage();

  const taskOption = values.task ?? file.task ?? env.T2_TASK ?? resume?.task_ids?.join(',');
  let tasks;
  if (taskOption === undefined) {
    tasks = TASKS.filter((task) => !task.poisonOnly && !task.genrePilot);
  } else {
    const ids = String(taskOption).split(',').map((id) => id.trim()).filter(Boolean);
    if (!ids.length) throw new Error('任务集为空，拒绝运行');
    const unknown = ids.filter((id) => !TASKS.some((task) => task.id === id));
    if (unknown.length) throw new Error(`未知任务: ${unknown.join(', ')}`);
    // 保留调用方给出的顺序：指纹与 manifest 的 task_ids 必须逐项一致
    tasks = ids.map((id) => TASKS.find((task) => task.id === id));
  }
  if (!tasks.length) throw new Error('任务集为空，拒绝运行');

  const baseUrl = file.baseUrl ?? env.T2_BASE_URL ?? resume?.baseUrl ?? undefined;
  const apiKey = env.T2_API_KEY;
  const model = file.model ?? env.T2_MODEL ?? resume?.model ?? undefined;
  if (!dry) {
    for (const [name, value] of Object.entries({ T2_BASE_URL: baseUrl, T2_API_KEY: apiKey, T2_MODEL: model })) {
      if (!value) throw new Error(`${name} 为真跑必填配置`);
    }
  }

  return {
    dry,
    baseUrl,
    apiKey,
    model,
    trials: positiveInt(values.trials ?? file.trials ?? env.T2_TRIALS ?? resume?.trials ?? 3, 'T2_TRIALS'),
    ruler,
    skillRoot: path.resolve(cwd, file.skillRoot ?? env.T2_SKILL_ROOT ?? path.join(import.meta.dirname, '..', 'skills')),
    arm,
    arms: arm === 'both' ? ['control', 'treated'] : [arm],
    dump: file.dump !== undefined ? Boolean(file.dump) : envFlag('T2_DUMP') ?? Boolean(resume?.dump),
    temperature: Number(file.temperature ?? env.T2_TEMPERATURE ?? resume?.temperature ?? 0),
    timeout: positiveInt(file.timeout ?? env.T2_TIMEOUT ?? resume?.timeout ?? 60000, 'T2_TIMEOUT'),
    concurrency: positiveInt(file.concurrency ?? env.T2_CONCURRENCY ?? resume?.concurrency ?? 4, 'T2_CONCURRENCY'),
    disableThinking: file.disableThinking !== undefined ? Boolean(file.disableThinking)
      : envFlag('T2_DISABLE_THINKING') ?? Boolean(resume?.disableThinking),
    reasoningEffort: file.reasoningEffort ?? env.T2_REASONING_EFFORT ?? resume?.reasoningEffort,
    tasks,
    configPath,
    resumeDir,
    outDir: path.resolve(cwd, file.outDir ?? env.T2_OUT_DIR ?? 'out/t2'),
  };
}
