# t2 results - full evidence trail

This is the detailed record behind the summary in [README - What t2 does and does not test](../README.md#what-t2-does-and-does-not-test). Every reading here is copied verbatim from the runs; only the organization differs. Shared methodology is stated once in the README.

## Batch 1 - pipeline proof (4 tasks, 12/arm)

**Measured evidence**: run in two batches. The first batch of 4 tasks proved the pipeline can separate the two arms; the expanded batch doubled the sample (4 → 8 tasks) to re-check the effect size.

First batch (4 tasks × 3 trials × 2 arms = 12 per arm):

| provider | model | control pass | treated pass | lift |
|---|---|---|---|---|
| DeepSeek | deepseek-chat | 25% (3/12) | 100% (12/12) | **+75 pp** |
| zhipu | glm-4-flash | 25% (3/12) | 25% (3/12) | **0 pp** |
| MIMO | mimo-v2.6-flash | 25% (3/12) | 100% (11/11 valid calls, 1 upstream disconnect listed separately) | **+75 pp** |

## Batch 2 - sample doubled (8 tasks, 24/arm)

Expanded batch (8 tasks × 3 trials × 2 arms = 24 per arm, doubling the sample to re-check):

| provider | model | control pass | treated pass | lift |
|---|---|---|---|---|
| DeepSeek | deepseek-chat | 13% (3/24) | 79% (19/24) | **+67 pp** |
| MIMO | mimo-v2.6-flash | 21% (5/24) | 75% (18/24) | **+54 pp** |
| zhipu | glm-4-flash | 13% (3/24) | 13% (3/24) | **0 pp** |
| zhipu | glm-4-plus | 13% (3/24) | 71% (17/24) | **+58 pp** |

Reading both batches together: **the direction holds** — the two arms still separate sharply; but **the precise effect size converges** (+75 → +54~+67 pp). The newer tasks' criteria sit closer to fine-grained points that are "unique to the skill body and unreachable by a bare model"; real-model wording does not necessarily hit every point (e.g. MIMO FAILs all three `merge-verify-ritual` treated trials; DeepSeek's `push-hung-recheck` criterion is tight), and a few control answers hit the ceiling (`push-hung-recheck` passes on two models even with a bare answer). +75 pp is an optimistic reading under a small sample plus curated tasks; +54~+67 pp is the more conservative estimate after expanding the sample — which is exactly the point that must be said: **lift is directional evidence, not a precise effect size.**

## Criterion calibration (v2 / v3)

Criterion calibration (2026-10-17): two false-negative fixes, each a **monotonic relaxation** (can only turn more valid answers green, never a wrong one) verified against a deliberately-wrong guardrail string plus a `--dry` re-check:
- **v2** — `push-hung-recheck`'s "trust the remote read" check credited only `ls-remote`, mis-judging a control arm that correctly verified remote truth via `git fetch` + reading the `origin/<branch>` SHA as FAIL.
- **v3** — `merge-verify-ritual`'s "exit code 0 carries no information" check credited only answers phrased with the `退出码0/成功时` prefix, missing conceptually-correct phrasings like "no output carries no signal" stated without that prefix.

## Locked-ruler 4/4 aggregate

After both fixes the ruler is locked (v2 + v3). A single full 8-task re-run of **all four providers on this one ruler** (temperature=0, 24 calls/arm, 0 tool-calls / 0 errors throughout):

| provider | model | control pass | treated pass | lift |
|---|---|---|---|---|
| DeepSeek | deepseek-chat | 29% (7/24) | 88% (21/24) | **+58 pp** |
| zhipu | glm-4-plus | 8% (2/24) | 67% (16/24) | **+58 pp** |
| MIMO | mimo-v2.6-flash | 17% (4/24) | 79% (19/24) | **+63 pp** |
| zhipu | glm-4-flash | 13% (3/24) | 17% (4/24) | **+4 pp** |

This 4/4 aggregate supersedes the earlier v2 partial readings (DeepSeek 33/83/+50, glm-4-plus 17/58/+42), which used the v2-only ruler and left MIMO / glm-4-flash pending. Three strong models land in **+58~+63 pp**; the small `glm-4-flash` barely moves (+4) — a real capability floor, not a ruler artifact: its treated answers lengthen and most criterion words appear, but it misses one required check per task and scoring demands **all** checks hit. Loosening the ruler to rescue flash's number would be "changing the number to treat the symptom" and is deliberately not done. **lift remains directional evidence, not a precise effect size.**

## Stronger-model probe (DeepSeek R1)

**Stronger-model probe (2026-10-18)**: the obvious follow-up is “does a more capable model make the skill redundant — i.e. compress lift toward 0?” Ran `deepseek-reasoner` (R1) on the same locked v2+v3 ruler, `temperature=0`, 24 calls/arm, 0 tool-calls / 0 errors. Result: **control 13% (3/24), treated 79% (19/24), lift +67 pp** — the widest gap in this fleet, not the narrowest. The ceiling effect is real but *local*, not global: R1’s bare answer saturates exactly one task (`bad-advice-runtime`, where “different node builds aren’t interchangeable” is reachable by general reasoning, so both arms PASS and lift there is 0), and one task stays out of reach for both arms (`push-hung-recheck`, where even the treated answer hits only 2 of 3 criteria). On the other six, R1 answers fluently and hits *most* criteria but systematically misses at least one skill-specific point — and because scoring is an AND-gate (all criteria must hit), lift stays wide. Reading: **a stronger base model raises the bare-answer floor on the few tasks a general reasoner can solve unaided, but does not absorb the skill’s marginal value on the domain-specific ones**; +67 pp on R1 is directional evidence on n=24, same caveat as every other row.

## Frontier-model batch (six current-gen models)

**Frontier-model batch (2026-10-19)**: pushed one generation further — `deepseek-flash`, `glm-5.3`, `mimo-v2.6-pro` — on the same locked v2+v3 ruler, same 8 tasks × 3 trials × 2 arms (24 calls/arm). Model IDs were read live from each vendor's `/models` endpoint, not guessed. Channel and any thinking-config deviation are stated honestly:

| provider | model | control pass | treated pass | lift |
|---|---|---|---|---|
| DeepSeek | deepseek-flash (native) | 36% (8/22) | 91% (21/23) | **+55 pp** |
| zhipu | glm-5.3 (`reasoning_effort=low`) | 13% (3/24) | 88% (21/24) | **+75 pp** |
| MIMO | mimo-v2.6-pro (`thinking:disabled`) | 29% (7/24) | 96% (23/24) | **+67 pp** |
| Alibaba | qwen3.8-flash (`reasoning_effort=low`) | 29% (7/24) | 75% (18/24) | **+46 pp** |
| Alibaba | qwen3.8-max (`reasoning_effort=low`) | 25% (6/24) | 63% (15/24) | **+38 pp** |
| StepFun | step-5-preview (native) | 21% (5/24) | 83% (20/24) | **+63 pp** |

deepseek-flash: 0 tool-calls, 3 transient `terminated` connection drops (excluded from the rate, as in every row). glm-5.3 and mimo-v2.6-pro: 0 tool-calls / 0 errors. **Two honest deviations:** glm-5.3 *always thinks* and rejects `thinking:disabled`; its default (max) thinking took ~148 s/call — past the harness's 60 s guard — so it ran at `reasoning_effort=low` (~14 s/call), and its 13% bare floor is a property of that setting, not native-max capability. mimo-v2.6-pro native thinking likewise timed out the 60 s guard, so it ran with `T2_DISABLE_THINKING=1` (same handling as `mimo-v2.6-flash`). To support this the harness gained an opt-in `T2_REASONING_EFFORT` passthrough (default unset → no change to any earlier row). Read with R1: lift on current frontier tiers stays wide (**+55 ~ +75 pp**) and does **not** compress toward zero as models get stronger; the ceiling effect remains *local* (glm-5.3 even PASSes the hardest `push-hung-recheck` bare), because AND-gate scoring keeps at least one skill-specific criterion unmet on the domain tasks. **Still directional evidence on n=24, same caveat as every row.**

### Per-model honest note - Qwen3.8-flash

**Qwen3.8-flash addendum (2026-10-19)**: also ran Alibaba `qwen3.8-flash` (same locked ruler, ID live-verified from its `/models`). Native thinking is heavy — ~122 s/call, past the 60 s guard — so it ran at `reasoning_effort=low` (~20 s/call), the same opt-in passthrough glm-5.3 used (ruler unchanged). Result: **control 29% (7/24), treated 75% (18/24), lift +46 pp** — 0 tool-calls / 0 errors. This was the **narrowest** lift in the fleet at the time (qwen3.8-max below is narrower), and it refines rather than overturns the finding: a capable current-gen flash tier lifts the *bare-answer floor* (29%, among the highest here — `bad-advice-runtime` saturates both arms) yet treated still stays clearly ahead, and the AND-gate keeps `hash-mismatch-invisible` unmet even for treated (only 2 of 3 criteria hit). Directional evidence on n=24, same caveat as every row.

### Per-model honest note - Qwen3.8-max

**Qwen3.8-max addendum (2026-10-19)**: also ran the flagship `qwen3.8-max` on the same locked ruler and the same `reasoning_effort=low` passthrough (native thinking is heavier still; low holds each call at ~20 s, inside the 60 s guard). Result: **control 25% (6/24), treated 63% (15/24), lift +38 pp** — 0 tool-calls / 0 errors. This is now the **narrowest lift in the fleet**, below qwen3.8-flash’s +46, and it sharpens the trend rather than overturning it: across the Qwen line the narrowing is monotonic (flash +46, max +38 — under the deepseek/glm/mimo batch’s +55~+75) yet still positive. The strongest same-brand tier lifts the bare-answer floor further (control saturates *two* tasks bare — `bad-advice-runtime` and `guard-never-fires` both 3/3), leaving the skill less AND-gate head-room; and a counter-intuitive tell — max’s treated is *lower* than flash’s (63% vs 75%): a more capable model is not uniformly better at landing the specific criterion phrasings (`merge-verify-ritual` treated falls to 1/3). The AND-gate still bites where a skill-unique criterion is missing (`hash-mismatch-invisible` 0/3 treated, `push-hung-recheck` treated 2/3). Directional evidence on n=24, same caveat as every row.

### Per-model honest note - StepFun step-5-preview

**StepFun step-5-preview addendum (2026-10-19)**: added a sixth frontier model — StepFun (`step-5-preview`, via `https://api.stepfun.com/v1`), run natively (no reasoning knob needed: it answers in ~37 s/call and reports `reasoning_tokens=0`). Result: **control 21% (5/24), treated 83% (20/24), lift +63 pp** — 0 tool-calls / 0 errors (a few calls crossed the 60 s window and were auto-retried, all 48 ultimately valid). Its bare-answer floor (21%) is the second-lowest in the frontier batch, behind only glm-5.3's 13% — which is exactly why its lift lands mid-wide rather than narrow, reinforcing the pattern the batch already shows: lift tracks the bare-answer floor, and that floor is not a clean proxy of headline tier (glm-5.3 already floored at 13% with the widest +75 lift, and qwen3.8-max's +38 stays the narrowest here). Per-task it delivers three clean AND-gate skill wins outright (`merge-verify-ritual`, `tautology-detector`, `stale-line-citation` all 0/3 to 3/3), saturates the two easy tasks in both arms, and still struggles with `push-hung-recheck` (treated 1/3) — the same hardest task that caps every model. Directional evidence on n=24, same caveat as every row.

## Cross-brand comparison

Cross-brand comparison (first batch) still holds: same skill set, same criteria, same tasks — change only the model, and lift ranges from +75 (DeepSeek, MIMO) to 0 (zhipu). Mechanism (glm-4-flash): treated output is visibly longer (the skill is clearly being read and quoted), but the specific criterion words do not hit — an abstract rule cannot land on a scorable concrete phrasing. Yet mimo-v2.6-flash, also a flash tier, hits every one: **"tier" cannot be equated across brands** — selection must be tested down to the specific model, not just the tier name.

## Same-brand, cross-tier

Same-brand, cross-tier (expanded batch, re-run 2026-10-17): within zhipu itself, going from `glm-4-flash` (lift 0; treated ties control at 13%, each of 7 tasks hitting only 1–2 criteria and never all) up to `glm-4-plus` (lift **+58 pp**, treated 17/24) — one skill unchanged, criteria unchanged, only the tier swapped — raises the effect size from 0 to +58. **The tier gap within one brand is more violent than the same-tier gap across brands**, the most direct evidence for "test down to the specific model/tier, don't just trust the tier name". glm-4-plus's +58 pp lands in the same band as DeepSeek (+67) / MIMO (+54), showing the plus tier is already at parity with other brands' strong tiers. (Readings via this machine's zhipu OpenAI-compatible channel `https://open.bigmodel.cn/api/paas/v4`, `temperature=0`, 24 calls per arm; the earlier "no key on this machine" was a misjudgment — the variable is `ZHIPUAI_API_KEY`.)

## Negative (poison) arm

**Status: grader logic proven; real-model negative signal not yet obtained.** The negative arm (`bad-advice-runtime--poison`, added in `73914b7`) injects a deliberately-wrong skill into the treated arm's system prompt and asks the grader to catch the model being led astray. Two claims must not be conflated:

- **Grader can distinguish (proven, zero-API).** The `run-checks` dry self-check feeds treated a canned wrong answer: control 3/3 PASS, treated 0/3, lift -100 pp. This proves the scoring regex fires in the right direction; it uses `DRY_ANSWERS`, not a real model.
- **Real models get led astray (not proven).** 5 tiers were run live (2026-10-21 to 2026-10-22): deepseek-flash, glm-4.5-air, kimi-k2.6, kimi-k3, qwen-flash — each 1 task x 3 trials x 2 arms = 6 requests, `temperature=0`. All 5 came back flat: control 3/3, treated 3/3, lift 0 pp.

**Honest reading of the flat result:** it does not mean the grader cannot detect bad advice (the dry check proves it can). A 2026-10-23 probe pinned the real cause: with every self-negation marker stripped from the poison (so the skill reads as a confident, plausible how-to), a one-call treated probe still came back PASS. Self-neutering material is therefore not the binding constraint — the judging prompt is. The task literally asks the model "is this note right? if not, what is wrong? do not just agree with me", an explicit instruction to critique the bad advice that a capable model follows regardless of the injected skill. That makes the negative arm, as designed, unattributable: a flat can mean weak poison or an over-adversarial prompt, and the two cannot be separated. Getting a clean negative signal requires redesigning the prompt alongside the stimulus (own card, own acceptance). Raw readouts are archived off-repo under `D:/QoderData/negative_arm/`; this section records method and conclusion only.
