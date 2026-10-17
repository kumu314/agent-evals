# t2 — Skill-gain A/B (needs an API key)

English | [中文](README.zh-CN.md)

Answers one question: **if I add a given skill, does the model's answer really get better — and by how much?**

The method is the plainest possible controlled experiment. Run the same set of tasks in two arms:

- `control`: give only the task, no skill
- `treated`: inject the skill body before the task

Both arms are scored by the same set of **deterministic regex criteria** (no LLM judge, no second bill), comparing pass rate and lift.

## Run

```bash
# Zero-call self-check: use pre-set answers to prove the scoring pipeline has discriminative power (CI runs this too)
node smoke-ab.mjs --dry

# Real run (any OpenAI-compatible endpoint)
T2_BASE_URL=https://api.example.com/v1 \
T2_API_KEY=sk-... \
T2_MODEL=your-model \
T2_TRIALS=3 \
node smoke-ab.mjs
```

## Environment variables

| var | purpose | default |
|---|---|---|
| `T2_BASE_URL` | OpenAI-compatible endpoint (trailing `/` optional) | required |
| `T2_API_KEY` | API key | required |
| `T2_MODEL` | model name | required |
| `T2_DISABLE_THINKING` | when set to `1`, sends the official param `thinking:{type:"disabled"}` with the request. Hybrid thinking models (measured: Xiaomi `mimo-v2.6-flash`) default thinking on; a real task can take 94s and hit askOnce's 60s timeout. Other providers do not get this param, behavior unchanged | off |
| `T2_TRIALS` | runs per arm per task | `3` |
| `T2_SKILL_ROOT` | skill-library root | `skills/` under this dir |
| `T2_TASK` | run only the listed tasks (comma-separated ids) | all |
| `T2_ARM` | `control` / `treated` / `both` | `both` |
| `T2_DUMP` | when set to `1`, print each answer in full | off |

## Scoring rules (important)

- Each task carries 1–3 regex criteria; **a task passes only if all of them hit**.
- **Tool calls and errors are listed separately and excluded from the pass rate.** A skill body often induces a "go verify first" behavior, so the model may return a tool call instead of a text answer. Counting that as "wrong" would systematically understate the skill, so the pass rate is computed only over calls that returned a text answer.
- Criterion design principle: land on a point that "is in the skill body but a bare model cannot reach". Otherwise both arms hit the ceiling together and no gain is measurable.
- A single A/B pass (1 run per arm per task) only proves **the pipeline has discriminative power**; it is not a statistical conclusion. To conclude "the skill really helps", raise n; first prove the pipeline with `--dry` and a cheap-tier model, then decide whether to spend the money.

## The eight tasks and seven skills under test

The eight tasks below are hard-coded in `smoke-ab.mjs`, each bound to a skill (several tasks share one skill). They are the measurement objects; the seven self-authored skills under `skills/` (MIT) each cure a class of "looks right, is actually wrong" judgment:

| skill | what it cures | task(s) |
|---|---|---|
| `runtime-resolution-and-abi` | "whichever node is on PATH is fine" — locating and pinning down multi-version runtimes | `bad-advice-runtime` |
| `silent-failure-triage` | "exit code 0 = success" — silent failure and false success | `merge-verify-ritual`, `guard-never-fires` |
| `criterion-self-evidence-check` | "the criterion writes the thing under test into its own evidence set" — tautological checks | `tautology-detector` |
| `stale-output-layers` | "I changed it but the page is still old" — the change never reached the served layer (identity, not cache) | `changed-but-not-visible` |
| `line-anchor-drift` | "the line number is a stable anchor" — line drift and content anchors | `stale-line-citation` |
| `text-encoding-forensics` | "content looks identical yet the hashes differ" — invisible-byte forensics | `hash-mismatch-invisible` |
| `git-push-fake-timeout` | "it hung / timed out, so it failed" — fake timeouts and re-checking remote ground truth | `push-hung-recheck` |

`smoke-ab.mjs`'s eight tasks directly check whether the model reaches the key points of these skills.
