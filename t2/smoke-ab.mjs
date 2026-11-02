// SPDX-License-Identifier: MIT
// T2 技能 lift 冒烟 A/B
// 目的：验证「带技能 vs 不带技能」能否被区分出来 —— 只验管线，不追求统计功效。
// 设计：同一批任务跑两臂（control 无技能 / treated 带技能正文），确定性正则判分，不用 LLM 当裁判（不额外花钱）。
// 用法：
//   node smoke-ab.mjs --dry                     # 零调用：用预置答案证明判分管线有判别力
//   $env:T2_BASE_URL=...; $env:T2_API_KEY=...; $env:T2_MODEL=...
//   $env:T2_DISABLE_THINKING="1"   # 可选：混合思考模型（mimo 等）显式关思考，避开 60s 超时
//   node smoke-ab.mjs                           # 真跑
import fs from 'node:fs';
import path from 'node:path';
import { DRY_ANSWERS } from './lib/tasks.mjs';
import { promptIdsFor, promptFor } from './lib/prompt-variants.mjs';
import { parseConfig } from './lib/config.mjs';
import { score } from './lib/grader.mjs';
import { createRunStore, buildManifest, loadRun, resumePlan, assertResumeFingerprint } from './lib/store.mjs';
import { summarizeRows, orderArmsForPair } from './lib/stats.mjs';


// ---- 两臂的系统提示 ----
function systemFor(arm, skillName, skillText) {
  const base = '你是一个严谨的技术助手，回答用中文。';
  if (arm === 'control') return base;
  return base + '\n\n下面是你可用的技能，请遵循其中的检查项：\n\n<skill name="' + skillName + '">\n' + skillText + '\n</skill>';
}

const _skillCache = new Map();
function loadSkill(name, file = 'SKILL.md', skillRoot) {
  const cacheKey = skillRoot + '::' + name + '::' + file;
  if (_skillCache.has(cacheKey)) return _skillCache.get(cacheKey);
  const p = path.join(skillRoot, name, file);
  if (!fs.existsSync(p)) throw new Error('技能不存在: ' + p);
  const t = fs.readFileSync(p, 'utf8');
  _skillCache.set(cacheKey, t);
  return t;
}

async function askOnce(system, user, config) {
  // 上游会挂住不返回（实测 >150s 无响应），必须自带超时，否则整轮挂死
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), config.timeout);
  let r;
  try {
    r = await fetch(config.baseUrl.replace(/\/$/, '') + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + config.apiKey },
      body: JSON.stringify({
        model: config.model,
        messages: [ { role: 'system', content: system }, { role: 'user', content: user } ],
        temperature: config.temperature,
        // 混合思考模型（如 mimo-v2.6-flash）默认开思考：首 token 延迟高、单次可超 60s 撞上面的超时。
        // T2_DISABLE_THINKING=1 显式关闭（官方 OpenAI 兼容参数 thinking.type）；其他 provider 不带此参数，行为不变。
        ...(config.disableThinking ? { thinking: { type: 'disabled' } } : {}),
        // 部分思考模型（如 glm-5.3）不支持关思考、max 档单次远超 60s；T2_REASONING_EFFORT 透传官方
        // OpenAI 兼容参数 reasoning_effort（如 low）压低思考量以落进超时。未设时不带此参数，其他 provider 行为不变。
        ...(config.reasoningEffort ? { reasoning_effort: config.reasoningEffort } : {}),
      }),
      signal: ctl.signal,
    });
  } catch (e) {
    if (e.name === 'AbortError') throw new Error(`timeout：${config.timeout}ms 无响应（上游挂住）`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
  const raw = await r.text();
  if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + raw.slice(0, 500));
  let j;
  try { j = JSON.parse(raw); } catch { throw new Error('非 JSON 响应: ' + raw.slice(0, 300)); }
  const msg = j.choices?.[0]?.message;
  const content = msg?.content;
  if (typeof content !== 'string' || content.length === 0) {
    // 模型可能返回工具调用而非文本（技能正文诱导"先去执行"）——这是可记录的现象，不是可重试的抖动
    const tc = msg?.tool_calls;
    if (Array.isArray(tc) && tc.length) {
      const e = new Error('TOOLCALL：返回工具调用而非文本（' + tc.map((x) => x.function?.name).join(',') + '）');
      e.toolCall = true;
      throw e;
    }
    // 空答案一律当错误抛出：静默返回 '' 会把「调用失败」伪装成「技能没用」
    throw new Error('空 content；finish_reason=' + j.choices?.[0]?.finish_reason +
      '；raw=' + JSON.stringify(j).slice(0, 600));
  }
  const u = j.usage || {};
  return { content, pt: Number.isFinite(u.prompt_tokens) ? u.prompt_tokens : null, ct: Number.isFinite(u.completion_tokens) ? u.completion_tokens : null };
}

// 免费档上游常 503/限流 —— 瞬时错误退避重试，重试耗尽才当失败
async function ask(system, user, config, attempt = 1) {
  try {
    const answer = await askOnce(system, user, config);
    return { ...answer, attempts: attempt };
  } catch (e) {
    if (e.toolCall) throw e; // 工具调用不是抖动，重试无用
    const transient = /503|overloaded|429|rate|timeout|ECONN|fetch failed|ETIMEDOUT/i.test(e.message);
    if (transient && attempt <= 4) {
      const wait = 2000 * attempt;
      console.error(`  (transient: ${e.message.slice(0, 70)} — ${wait}ms 后重试 ${attempt}/4)`);
      await new Promise((res) => setTimeout(res, wait));
      return ask(system, user, config, attempt + 1);
    }
    e.attempts = attempt;
    throw e;
  }
}


// Wilson score 95% 区间（二值小样本比 bootstrap 稳；宽区间本身就是"方向性证据"的数字形式）。
function wilson(k, n, z = 1.96) {
  if (!n) return [0, 0];
  const p = k / n;
  const d = 1 + (z * z) / n;
  const centre = p + (z * z) / (2 * n);
  const half = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [(centre - half) / d, (centre + half) / d];
}

async function run() {
  const config = parseConfig({ argv: process.argv.slice(2), env: process.env, cwd: process.cwd() });
  const activeTasks = config.tasks;
  const arms = config.arms;
  const BASE = config.baseUrl;
  const MODEL = config.model;
  const TRIALS = config.trials;
  const SKILL_ROOT = config.skillRoot;
  const DUMP = config.dump;
  const DRY = config.dry;
  // 展开成 cell 列表，严格按 task -> prompt -> arm -> trial 顺序；skillText 每个 task 预载一次（无额外 IO）。
  // locked-v3 只有 base，cell 布局与历史运行一致；paired-v4 为锁尺任务追加 variant-1。
  const cells = [];
  const skillTexts = {};
  for (const task of activeTasks) {
    const skillText = DRY ? '(dry-run 不读技能正文)' : loadSkill(task.skill, task.inject, SKILL_ROOT);
    if (!DRY) skillTexts[task.id] = skillText;
    for (const promptId of promptIdsFor(task, config.ruler)) {
      for (const arm of arms) {
        for (let t = 1; t <= TRIALS; t++) cells.push({ task, promptId, arm, t, skillText });
      }
    }
  }
  cells.forEach((cell, cellIndex) => { cell.cellIndex = cellIndex; });

  // 续跑：先按当前配置重算指纹，与目录里的 manifest 一致才允许复用；有效 cell 跳过，错误 cell 重跑。
  let resumeRows = null;
  let existingManifest = null;
  if (config.resumeDir) {
    const loaded = loadRun(config.resumeDir);
    assertResumeFingerprint(loaded.manifest, buildManifest({ config, skillTexts }).fingerprint);
    resumeRows = loaded.rows;
    existingManifest = loaded.manifest;
  }
  const store = createRunStore({
    config,
    skillTexts,
    dir: config.resumeDir ?? undefined,
    manifest: existingManifest ?? undefined,
  });

  // 配对调度：同一 task/prompt/trial 的两臂由运行指纹决定先后，抵消“总是 control 先发”的偏差；
  // cell_index 仍是 canonical（task x arm x trial），展示与汇总顺序不随调度顺序变化。
  const schedule = [];
  const seen = new Set();
  if (arms.length === 2) {
    const pairs = new Map();
    for (const cell of cells) {
      const key = `${cell.task.id}|${cell.promptId}|${cell.t}`;
      if (!pairs.has(key)) pairs.set(key, []);
      pairs.get(key).push(cell);
    }
    for (const [key, pair] of pairs) {
      for (const arm of orderArmsForPair(key, store.fingerprint)) {
        const cell = pair.find((item) => item.arm === arm);
        if (cell && !seen.has(cell.cellIndex)) {
          seen.add(cell.cellIndex);
          schedule.push(cell);
        }
      }
    }
  }
  for (const cell of cells) {
    if (!seen.has(cell.cellIndex)) schedule.push(cell);
  }

  // 每个 cell 独立产出并立即追加证据；results 仍按 canonical index 呈现。
  const runCell = async ({ task, promptId, arm, t, skillText, cellIndex }) => {
    const startedAt = Date.now();
    // dry 只为证明判分管线有判别力：同一 task 的两个提示共用同一段预置答案。
    // 真跑必须发出该 prompt_id 对应的实际文本，否则变体只是记在 manifest 里、没有送进模型。
    const userPrompt = DRY ? task.prompt : promptFor(task, promptId);
    let ans, err = null;
    if (DRY) ans = { content: DRY_ANSWERS[task.id][arm], pt: null, ct: null, attempts: 0 };
    else {
      try { ans = await ask(systemFor(arm, task.skill, skillText), userPrompt, config); }
      catch (e) { err = e; }
    }
    const base = {
      run_id: store.runId,
      cell_index: cellIndex,
      pair_id: `${task.id}|${promptId}|${t}`,
      task: task.id,
      prompt_id: promptId,
      arm,
      trial: t,
      latency_ms: Date.now() - startedAt,
      finished_at: new Date().toISOString(),
    };
    if (err) {
      const kind = err.toolCall ? 'TOOLCALL' : 'ERROR';
      if (DUMP) console.log('\n===== ' + task.id + ' / ' + promptId + ' / ' + arm + ' / t' + t + ' ===== [' + kind + '] ' + err.message.slice(0, 120) + '\n');
      return { ...base, answer: '', passed: false, hits: [], forbidHits: [], chars: 0, pt: null, ct: null, attempts: err.attempts ?? 1, err: kind, msg: err.message.slice(0, 90) };
    }
    const s = score(ans.content, task);
    if (DUMP) console.log('\n===== ' + task.id + ' / ' + promptId + ' / ' + arm + ' / t' + t + ' =====\n' + ans.content + '\n');
    return { ...base, answer: ans.content, passed: s.passed, hits: s.hits, forbidHits: s.forbidHits, chars: ans.content.length, pt: ans.pt, ct: ans.ct, attempts: ans.attempts, err: null, msg: null };
  };

  // 并发跑（上限 K，默认 4，国内 API 有 RPM 限制；瞬时 503/429 已由 ask() 退避重试兜底）。
  // 结果按原始下标写回，rows 顺序 = 串行版 task x arm x trial，并发完成先后不影响呈现顺序与任何读数口径。
  const results = new Array(cells.length);
  let activeSchedule = schedule;
  let resumeState = null;
  if (resumeRows) {
    resumeState = resumePlan(schedule, resumeRows);
    for (const [cellIndex, existingRow] of resumeState.skip) results[cellIndex] = existingRow;
    activeSchedule = resumeState.pending;
    console.log(`resume = ${config.resumeDir}（复用有效 ${resumeState.skip.size}，补跑 ${activeSchedule.length}）`);
  }
  const K = Math.min(config.concurrency, activeSchedule.length || 1);
  let cursor = 0;
  const worker = async () => {
    while (cursor < activeSchedule.length) {
      const cell = activeSchedule[cursor++];
      const row = await runCell(cell);
      results[cell.cellIndex] = row;
      store.appendCell(row);
    }
  };
  await Promise.all(Array.from({ length: K }, () => worker()));
  const rows = results;
  const summary = store.finalize(rows, (input) => summarizeRows(input, { seed: store.fingerprint }));
  console.log('evidence = ' + path.relative(process.cwd(), store.dir));
  // 汇总：有效率只算"拿到了文本答案"的调用；工具调用/报错单列，不混进通过率
  const by = (arm) => rows.filter((r) => r.arm === arm);
  const valid = (arm) => by(arm).filter((r) => !r.err);
  const rate = (arm) => { const a = valid(arm); return a.length ? a.filter((r) => r.passed).length / a.length : 0; };
  console.log('provider = ' + (DRY ? 'DRY (零调用)' : `${MODEL} @ ${BASE}`));
  console.log('tasks    = ' + activeTasks.map((t) => t.id + '(' + t.skill + ')').join(', ') + '   ruler = ' + config.ruler + '   trials/arm = ' + TRIALS + '   arms = ' + arms.join('+'));
  console.log('-'.repeat(72));
  for (const r of rows) {
    const status = r.err ? r.err : (r.passed ? 'PASS' : 'FAIL');
    const label = [...r.hits, ...(r.forbidHits || []).map((x) => '!' + x)].join(',');
    console.log(`[${r.arm.padEnd(7)}] ${r.task.padEnd(18)} ${r.prompt_id.padEnd(9)} t${r.trial}  ${status.padEnd(8)}  ${label || (r.err ? r.msg : '(无命中)')}  ${r.chars}c`);
  }
  console.log('-'.repeat(72));
  for (const arm of arms) {
    const e = by(arm).filter((r) => r.err);
    const tc = e.filter((r) => r.err === 'TOOLCALL').length;
    const er = e.filter((r) => r.err === 'ERROR').length;
    const a = valid(arm);
    console.log(`${arm.padEnd(7)} 有效 ${a.length}/${by(arm).length}（通过 ${a.filter((r) => r.passed).length}）  工具调用 ${tc}  报错 ${er}`);
  }
  const c = rate('control'), t = rate('treated');
  const kOf = (a) => valid(a).filter((r) => r.passed).length;
  const nOf = (a) => valid(a).length;
  const ci = (a) => { const [lo, hi] = wilson(kOf(a), nOf(a)); return `[${Math.round(lo * 100)},${Math.round(hi * 100)}]`; };
  console.log(`control pass = ${(c * 100).toFixed(0)}% ${ci('control')}   treated pass = ${(t * 100).toFixed(0)}% ${ci('treated')}   lift = ${((t - c) * 100).toFixed(0)} 个百分点`);
  // 配对口径：同一 task/prompt/trial 的 delta 先按题取均值，再对 task 做聚类 bootstrap。
  if (summary.paired) {
    const p = summary.paired;
    console.log(`paired lift = ${p.lift} pp（完整配对 ${p.completePairs} / 不完整 ${p.incompletePairs}，tasks=${p.tasks}）  区间 [${p.ci[0]},${p.ci[1]}]（task-cluster bootstrap ${p.bootstrapSamples} 次，seed=${p.seed.slice(0, 8)}）`);
  } else {
    console.log('paired lift = n/a（单臂或少于两个任务，拒绝输出伪精确区间）');
  }
  console.log(`sensitivity lift = ${summary.sensitivity.lift} pp（失败计入：control ${(summary.sensitivity.control.passRate * 100).toFixed(0)}% / treated ${(summary.sensitivity.treated.passRate * 100).toFixed(0)}%）`);
  // ---- token 成本采集（非流式响应里的 usage；DRY 或 provider 未回 usage 则显式标 n/a，绝不编 0）----
  const tokCells = (arm) => valid(arm).filter((r) => r.pt != null && r.ct != null).map((r) => r.pt + r.ct);
  const ctT = tokCells('control'), ttT = tokCells('treated');
  console.log('-'.repeat(72));
  if (ctT.length === 0 || ttT.length === 0) {
    console.log('token 成本 = n/a（' + (DRY ? 'DRY 零调用' : '本轮 provider 未返回 usage 字段') + '，不编造读数）');
  } else {
    const avg = (a) => a.reduce((s, x) => s + x, 0) / a.length;
    const pc = avg(ctT), ptv = avg(ttT);
    console.log('单次调用 token（实测）  control~' + Math.round(pc) + '  treated~' + Math.round(ptv) + '  注入净增~' + Math.round(ptv - pc));
    const toPass = (perCall, pr) => (pr > 0 ? perCall / pr : null); // E[答对一次的总token]=平均每次/通过率，前提：重试到对且各次独立
    const tpC = toPass(pc, c), tpT = toPass(ptv, t);
    if (tpC == null || tpT == null) {
      console.log('答对一次的总 token（推导）  至少一臂本轮 0 通过，无法外推');
    } else {
      console.log('答对一次的总 token（推导·前提:重试到对且各次独立）  control~' + Math.round(tpC) + '  treated~' + Math.round(tpT) + '  ' + (tpT <= tpC ? '省 ' + Math.round((1 - tpT / tpC) * 100) + '%' : '多花 ' + Math.round(tpT - tpC)));
      const extra = tpT - tpC;
      const liftPP = Math.round((t - c) * 100);
      console.log('增量性价比  ' + (extra <= 0
        ? '更省 token 且 +' + liftPP + ' pp（无额外成本，看上一行节省%）'
        : '+' + liftPP + ' pp / 多花 ' + Math.round(extra) + ' token ~ 每 1k token ' + ((liftPP / extra) * 1000).toFixed(1) + ' pp'));
    }
  }
  const anyErr = rows.some((r) => r.err);
  const poisonRun = activeTasks.length > 0 && activeTasks.every((tk) => tk.poisonOnly);
  const pilotRun = activeTasks.length > 0 && activeTasks.every((tk) => tk.genrePilot);
  if (pilotRun) {
    // 领域/知识型体裁试点：这是正向任务（带正确技能应更高），期望 treated > control。
    // fail-closed：dry 下若 treated 未拉开（treated<=control），判据或预置答案有问题，退出码 1 拒绝放行。
    const ok = t - c > 0;
    console.log(ok
      ? '=> 体裁试点可区分（正向知识技能把 treated 抬高：treated > control）'
      : '=> 体裁试点 dry 未拉开：treated 未过 / control 已过，判据或预置答案有问题，先修');
    if (DRY && !ok) process.exitCode = 1;
  } else if (poisonRun) {
    // 负向臂：期望 treated < control。方向拉开即证明打分器认得「被坏技能带偏」，而非只发绿灯。
    const ok = t - c < 0;
    console.log(ok
      ? '=> 负向臂可区分（打分器认得被坏技能带偏：treated < control）'
      : (DRY ? '=> 负向臂 dry 未判负：treated 预置答案竟通过了判据，说明判据认不出坏答案，先修'
             : '=> 本轮坏技能未把 treated 带偏（模型可能忽略注入），读数本身仍是有用信息'));
    if (DRY && !ok) process.exitCode = 1; // fail-closed：常驻自检拒绝放行
  } else {
    const ok = t - c > 0;
    console.log(ok
      ? '=> 两臂可区分（管线有判别力）'
      : (DRY ? '=> dry 两臂不可区分：判据或预置答案有问题，先修'
        : (anyErr ? '=> 两臂未拉开（本轮存在工具调用/报错，读数不完整，先看上方分布）' : '=> 本任务上两臂未拉开：换更贴技能的任务，或加 trial')));
    if (DRY && !ok) process.exitCode = 1;
  }
  if (!DRY && anyErr) {
    console.log('=> INCOMPLETE：存在 ERROR/TOOLCALL，结果已保留，退出码 2');
    process.exitCode = 2;
  }
  return { c, t };
}

run().catch((e) => { console.error('ERROR: ' + e.message); process.exit(1); });