# agent-evals

English | [中文](README.zh-CN.md)

[![ci](https://github.com/kumu314/agent-evals/actions/workflows/ci.yml/badge.svg)](https://github.com/kumu314/agent-evals/actions/workflows/ci.yml)

Turn "how reliable are AI agents at real work" into machine-checkable assertions, run them after every change, and get a red flag the moment something slips.

Three sub-suites, layered by whether they cost money:

| suite | what it tests | cost | what you need |
|---|---|---|---|
| [`fleet-eval/`](fleet-eval/) | Full skill-library regression: frontmatter validity, duplicate names, leftover junk, multi-endpoint fan-out consistency (11 assertions) | 0 API calls | a skill library on disk |
| [`merge-eval/`](merge-eval/) | Bulk content merge: entries you did not touch must stay byte-for-byte identical (7 assertions) | 0 API calls | a repo under test |
| [`t2/`](t2/) | Skill-gain A/B: same set of tasks, with vs. without the skill injected, compare pass rates | needs an API key | any OpenAI-compatible endpoint |

## Why it is split this way

All three suites share one set of judging principles — the reason this repo exists:

1. **If it can be decided deterministically, do not bring in an LLM as judge.** Every grader across the three suites is a deterministic assertion — regex, md5, byte comparison, exit code, remote-ref ground truth. Not one uses a model to score: it is both expensive and non-reproducible.
2. **Evidence must come from externally re-readable artifacts.** The criteria only trust remote API reads, file sha256, and actual on-disk state — never self-reports like "I finished the run" or "the command did not error".
3. **For assets that must be stable, judge `pass^k`, not `pass@k`.** Correctness of a skill library or content library is a red line: it must pass every one of N runs, not get lucky once.
4. **The criteria themselves can be wrong — when you see red, suspect the criterion first.** Every red in merge-eval's first round turned out to be its own bug. This lesson is written into both sub-suites' READMEs, because it was the most expensive thing learned here.

These three are not original; sources are in [fleet-eval/research/](fleet-eval/research/) (Anthropic's "Demystifying evals for AI agents", NVIDIA's agent-evaluation practice).

## What t2 does and does not test

t2 is a **model-tier selection tool**, not a "are skills universally effective" tool. The question it answers is: "injecting this skill into a given model tier — does it flip that tier from FAIL to PASS on this task?" That answer **depends heavily on the model's capability ceiling**.

**Measured evidence**: run in two batches. The first batch of 4 tasks proved the pipeline can separate the two arms; the expanded batch doubled the sample (4 → 8 tasks) to re-check the effect size.

First batch (4 tasks × 3 trials × 2 arms = 12 per arm):

| provider | model | control pass | treated pass | lift |
|---|---|---|---|---|
| DeepSeek | deepseek-chat | 25% (3/12) | 100% (12/12) | **+75 pp** |
| zhipu | glm-4-flash | 25% (3/12) | 25% (3/12) | **0 pp** |
| MIMO | mimo-v2.6-flash | 25% (3/12) | 100% (11/11 valid calls, 1 upstream disconnect listed separately) | **+75 pp** |

Expanded batch (8 tasks × 3 trials × 2 arms = 24 per arm, doubling the sample to re-check):

| provider | model | control pass | treated pass | lift |
|---|---|---|---|---|
| DeepSeek | deepseek-chat | 13% (3/24) | 79% (19/24) | **+67 pp** |
| MIMO | mimo-v2.6-flash | 21% (5/24) | 75% (18/24) | **+54 pp** |
| zhipu | glm-4-flash | 13% (3/24) | 13% (3/24) | **0 pp** |
| zhipu | glm-4-plus | 13% (3/24) | 71% (17/24) | **+58 pp** |

Reading both batches together: **the direction holds** — the two arms still separate sharply; but **the precise effect size converges** (+75 → +54~+67 pp). The newer tasks' criteria sit closer to fine-grained points that are "unique to the skill body and unreachable by a bare model"; real-model wording does not necessarily hit every point (e.g. MIMO FAILs all three `merge-verify-ritual` treated trials; DeepSeek's `push-hung-recheck` criterion is tight), and a few control answers hit the ceiling (`push-hung-recheck` passes on two models even with a bare answer). +75 pp is an optimistic reading under a small sample plus curated tasks; +54~+67 pp is the more conservative estimate after expanding the sample — which is exactly the point that must be said: **lift is directional evidence, not a precise effect size.**

Criterion calibration (2026-10-17): two false-negative fixes, each a **monotonic relaxation** (can only turn more valid answers green, never a wrong one) verified against a deliberately-wrong guardrail string plus a `--dry` re-check:
- **v2** — `push-hung-recheck`'s "trust the remote read" check credited only `ls-remote`, mis-judging a control arm that correctly verified remote truth via `git fetch` + reading the `origin/<branch>` SHA as FAIL.
- **v3** — `merge-verify-ritual`'s "exit code 0 carries no information" check credited only answers phrased with the `退出码0/成功时` prefix, missing conceptually-correct phrasings like "no output carries no signal" stated without that prefix.

After both fixes the ruler is locked (v2 + v3). A single full 8-task re-run of **all four providers on this one ruler** (temperature=0, 24 calls/arm, 0 tool-calls / 0 errors throughout):

| provider | model | control pass | treated pass | lift |
|---|---|---|---|---|
| DeepSeek | deepseek-chat | 29% (7/24) | 88% (21/24) | **+58 pp** |
| zhipu | glm-4-plus | 8% (2/24) | 67% (16/24) | **+58 pp** |
| MIMO | mimo-v2.6-flash | 17% (4/24) | 79% (19/24) | **+63 pp** |
| zhipu | glm-4-flash | 13% (3/24) | 17% (4/24) | **+4 pp** |

This 4/4 aggregate supersedes the earlier v2 partial readings (DeepSeek 33/83/+50, glm-4-plus 17/58/+42), which used the v2-only ruler and left MIMO / glm-4-flash pending. Three strong models land in **+58~+63 pp**; the small `glm-4-flash` barely moves (+4) — a real capability floor, not a ruler artifact: its treated answers lengthen and most criterion words appear, but it misses one required check per task and scoring demands **all** checks hit. Loosening the ruler to rescue flash's number would be "changing the number to treat the symptom" and is deliberately not done. **lift remains directional evidence, not a precise effect size.**

Cross-brand comparison (first batch) still holds: same skill set, same criteria, same tasks — change only the model, and lift ranges from +75 (DeepSeek, MIMO) to 0 (zhipu). Mechanism (glm-4-flash): treated output is visibly longer (the skill is clearly being read and quoted), but the specific criterion words do not hit — an abstract rule cannot land on a scorable concrete phrasing. Yet mimo-v2.6-flash, also a flash tier, hits every one: **"tier" cannot be equated across brands** — selection must be tested down to the specific model, not just the tier name.

Same-brand, cross-tier (expanded batch, re-run 2026-10-17): within zhipu itself, going from `glm-4-flash` (lift 0; treated ties control at 13%, each of 7 tasks hitting only 1–2 criteria and never all) up to `glm-4-plus` (lift **+58 pp**, treated 17/24) — one skill unchanged, criteria unchanged, only the tier swapped — raises the effect size from 0 to +58. **The tier gap within one brand is more violent than the same-tier gap across brands**, the most direct evidence for "test down to the specific model/tier, don't just trust the tier name". glm-4-plus's +58 pp lands in the same band as DeepSeek (+67) / MIMO (+54), showing the plus tier is already at parity with other brands' strong tiers. (Readings via this machine's zhipu OpenAI-compatible channel `https://open.bigmodel.cn/api/paas/v4`, `temperature=0`, 24 calls per arm; the earlier "no key on this machine" was a misjudgment — the variable is `ZHIPUAI_API_KEY`.)

**Usage guidance**:
- Want to verify "does my skill actually help"? → First make sure the test tier is ≥ your target deployment tier, otherwise you are measuring the model's ceiling, not the skill's quality.
- Want to pick "which model tier should my agent use"? → The lift difference of the same skill across tiers is exactly the selection signal.
- Do not read "lift = 0" as "the skill is useless" — it only says "this tier cannot parse it".

Full two-arm readings for the first batch are in the [v0.3.0 Release Notes](https://github.com/kumu314/agent-evals/releases/tag/v0.3.0); per-trial two-arm readings and setup for the expanded 8 tasks are in CHANGELOG `[Unreleased]` → Verification.

## Quick start

Requires Node ≥ 20.11 (uses `import.meta.dirname` and the built-in `fetch`). The runtime floor is declared in `package.json` under `engines`.

```bash
# Run every zero-API / zero-network self-check in one shot (equivalent to CI, cross-platform; env is set in-process, no shell prefix needed)
npm test          # = node run-checks.mjs, prints an rc ledger step by step, non-zero exit on any failure

# 0) See it work in one command: run against the sample skill library shipped in the repo, red first then green (zero config, zero API)
node demo/run.mjs

# 1) t2 scoring-pipeline self-check: zero API calls, proves "the criteria really can tell good answers from bad"
node t2/smoke-ab.mjs --dry

# 2) fleet-eval: point it at your skill-library root first, then run
FLEET_SHARED=/path/to/sharedskills node fleet-eval/fleet-eval.mjs --trials 2

# 3) merge-eval: point it at the repo under test + the pre-merge sha
MERGE_REPO=/path/to/repo MERGE_REPO_SLUG=owner/repo \
MERGE_BASE_REF=<pre-merge sha> MERGE_TOUCHED_IDS='["id1","id2"]' \
node merge-eval/merge-eval.mjs --trials 2
```

Each suite's environment variables, criteria list, and the pitfalls hit along the way are in the README inside each subdirectory.

## What a run looks like

The one zero-config, free command (CI runs it too):

```bash
node t2/smoke-ab.mjs --dry
```

It walks the scoring pipeline with pre-set answers to prove "the criteria really can separate good answers from bad". Full output:

```text
provider = DRY (zero calls)
tasks    = bad-advice-runtime(runtime-resolution-and-abi), merge-verify-ritual(silent-failure-triage), guard-never-fires(silent-failure-triage), tautology-detector(criterion-self-evidence-check), changed-but-not-visible(stale-output-layers), stale-line-citation(line-anchor-drift), hash-mismatch-invisible(text-encoding-forensics), push-hung-recheck(git-push-fake-timeout)   trials/arm = 3   arms = control+treated
------------------------------------------------------------------------
[control] bad-advice-runtime t1  FAIL      (no hit)  61c
[control] bad-advice-runtime t2  FAIL      (no hit)  61c
[control] bad-advice-runtime t3  FAIL      (no hit)  61c
[treated] bad-advice-runtime t1  PASS      rejects-the-note,pins-the-technique  185c
[treated] bad-advice-runtime t2  PASS      rejects-the-note,pins-the-technique  185c
[treated] bad-advice-runtime t3  PASS      rejects-the-note,pins-the-technique  185c
...
control valid 24/24 (passed 0)   tool calls 0   errors 0
treated valid 24/24 (passed 24)  tool calls 0   errors 0
control pass = 0%    treated pass = 100%    lift = 100 percentage points
=> the two arms are distinguishable (the pipeline has discriminative power)
```

(Shown abbreviated; `--dry` uses fixed pre-set answers, so control scores 0 and treated scores 100 — it checks the ruler, not the model.)

## Directory layout

```
agent-evals/
├── demo/              one-command demo: bundled sample skill library, red first then green (zero config)
├── docs/              eval-primitives.md — the five eval primitives distilled from all three suites
├── fleet-eval/        skill-library regression (11 assertions, zero API cost)
│   ├── fleet-eval.mjs
│   ├── drill-a1a2.mjs     negative-verification script: proves new assertions really go red
│   ├── fleet-eval.allow.example.json  junk.absent exemption allowlist template (the real one is not committed)
│   └── research/          methodology sources
├── lib/               parsers.mjs — the three parsers shared by all suites (single implementation)
├── merge-eval/        bulk content-merge regression (7 assertions)
│   ├── merge-eval.mjs
│   ├── drill-merge-eval.mjs  negative-verification drill: TMP git fixture, zero network
│   └── README.md
├── selftest.mjs       unit tests for lib/parsers.mjs (node:test, zero dependencies)
└── t2/                skill-gain A/B (needs an API key)
    ├── smoke-ab.mjs
    └── skills/        seven skills under test (self-authored, MIT)
```

## One note of honesty

`fleet-eval` and `merge-eval` grew out of two of the author's own real projects: a shared skill library (240+ skills, 4 fan-out endpoints) and a bulk-ingestion pipeline for a content site. Their criteria and pitfall logs come from real incidents, so the docs keep many "measured on this machine" concrete readings — those are not design goals, they are field evidence.

## Who made this, who it is for

Built by me ([@kumu314](https://github.com/kumu314)) for my own use, open-sourced along the way.

Suited to anyone holding assets that are "annoying when they break, but you don't want to pay another round of model-call fees on every regression" — skill libraries, content libraries, multi-endpoint distributed configs. Not for people treating evals as a leaderboard to farm.

## License

MIT, see [LICENSE](LICENSE).
