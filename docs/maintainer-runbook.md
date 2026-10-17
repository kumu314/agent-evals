# Maintainer Runbook

English | [中文](maintainer-runbook.zh-CN.md)

This document answers one question: **when the author is absent (a handover, or the author returning after a long gap), how do you change this repo safely without breaking it.**
The biggest risk of a single-maintainer project is not code quality — it is "tacit knowledge living in one person's head". Below, that knowledge is made explicit.

## 0. A thirty-second mental model

The three suites share one set of judgment standards (see `docs/eval-primitives.md`):

- **If it can be decided deterministically, do not bring in an LLM as judge** — the graders are all regex / md5 / byte comparison / exit code / remote-ref ground truth.
- **Every criterion needs a negative control that "deliberately gets it wrong and goes red"** (a drill), otherwise an assertion you add may never go red = a tautology.
- **When you see red, suspect the criterion first**; do not chase the business logic from the reading.

Before changing anything, make sure `npm test` (= `node run-checks.mjs`) is all green — it is the local equivalent of CI, zero network, zero API.

## 1. How to run (cheapest first)

| command | costs money | network | what it does |
|---|---|---|---|
| `npm test` | no | no | one command reproduces every deterministic CI self-check; any failure exits non-zero |
| `node demo/run.mjs` | no | no | runs against the repo's own sample library: first red, then green, to see it work |
| `node t2/smoke-ab.mjs --dry` | no | no | uses pre-set answers to prove the scoring pipeline separates good from bad answers (lift=100) |
| `node fleet-eval/fleet-eval.mjs --trials 2` (set `FLEET_SHARED`) | no | no | full skill-library regression |
| `node merge-eval/merge-eval.mjs --trials 2` (set `MERGE_*`) | no | depends on criterion | batch-merge byte-for-byte-unchanged regression |
| `node t2/smoke-ab.mjs` (set `T2_*`) | **yes** | yes | real two-arm A/B run; only this step consumes API |

**All-green by default is what "changed correctly" means.** If any step goes red, troubleshoot per section 4.

## 2. Adding a t2 skill-under-test + task

All of t2's value is in **criterion design**: the criterion must land on a point that "is in the skill body but a bare model cannot answer".
Otherwise both arms hit the ceiling together (the bare-model control also passes), and no lift can be measured.

1. Write the skill body at `t2/skills/<skill-name>/SKILL.md` (frontmatter with `license: MIT`, personal info removed: no specific machine paths, identity, or private skill names).
2. Add a task to the `TASKS` array in `t2/smoke-ab.mjs`: `id / skill / prompt / checks[]`, where each check is a regex `re`; **all must hit to count as PASS**.
3. In `DRY_ANSWERS`, add two pre-set answers for that task: `control` (a "confident wrong intuition" answer that hits none of the checks) and `treated` (hits every check).
4. Run `node t2/smoke-ab.mjs --dry`: control must be 0%, treated must be 100%. **If dry fails = the criterion or the pre-set answers are wrong; do not proceed to a real run** (real runs cost money — first prove the pipeline discriminates, for free).
5. Only after dry is green do a real run; write the real-run readings honestly into the verification section of `CHANGELOG.md`, recording errors/tool-calls per the "listed separately, not counted in pass rate" standard.

Regex-escaping reminder: criteria are "as long as it hits" broad standards — don't chase hitting only the correct answer; better slightly broad, with false negatives caught by the two-arm contrast.

## 3. Adding/changing a fleet-eval or merge-eval assertion

- After changing `CHECKS`, you **must also change the corresponding drill** (`fleet-eval/drill-a1a2.mjs` or `merge-eval/drill-merge-eval.mjs`),
  construct a negative case where "this assertion should go red", run it red, and only then have you proven it really fires. Assertions that only add green and never red are not accepted (see the `CONTRIBUTING.md` conventions).
- Configuration always goes through profile / env, **fail-closed**: illegal values `process.exit(2)` at load time rather than exploding at runtime; a missing config must explicitly report "unconfigured" and must not silently fall back to a default value you thought didn't exist.
- Layout-coupled criteria (e.g. fleet depending on `sync.ps1` fan-out endpoints) must be able to be turned off without erroring — use `FLEET_SCOPE=core` to run only the layout-independent items. It is expected that others can't configure it when they take it; don't let the whole suite become unrunnable because of that.

## 4. When it goes red (suspect the criterion first)

| symptom | most likely cause | action |
|---|---|---|
| the dry arms don't separate (control≠0 or treated≠100) | criterion too broad (control also hits) or pre-set answers don't match | tighten control so it can't hit, or fix treated so it hits everything |
| a drill that should go red doesn't | new assertion is tautological | check whether the criterion's input contains the judged object itself |
| fleet-eval reports a swath of ABSENT | the endpoint list read in the comment lines too | strip `#` comments line by line before reading the list |
| merge-eval is all red on the first round | criterion written in the wrong direction (has genuinely happened) | run an experiment on the reading itself first, don't chase the business |
| real-run treated is empty/errors | upstream flakiness or a hybrid-thinking model timing out | see below: `T2_DISABLE_THINKING=1`; errors listed separately, not mixed into pass rate |

## 5. Release checklist

1. `npm test` all green (selftest + T2 dry + demo + merge drill + fleet core).
2. Three-platform CI green (ubuntu / windows / macos, `shell: bash`).
3. Freeze `CHANGELOG.md`'s `[Unreleased]` into this version number, add the tag link.
4. If criterion semantics changed, confirm the docs (each suite's README, `docs/eval-primitives.md`) are in sync — every reading in the docs must be reproducible on the spot with a script in the repo; hearsay does not count.
5. Tag, push main.

## 6. Environment dependencies (a pit hit once)

- Requires **Node ≥ 20.11** (uses `import.meta.dirname` and built-in `fetch`); already written into `package.json`'s `engines` and `.nvmrc`.
- Some fleet-eval criteria call Python (`FLEET_PYTHON` or `python` on PATH); when Python is missing the relevant criteria should honestly report "cannot determine", not pretend to pass.
- t2's real run is generic across OpenAI-compatible endpoints; hybrid-thinking models like Xiaomi MIMO default to thinking on and will hit the 60s timeout, needing `T2_DISABLE_THINKING=1`.

---
*This runbook itself should evolve with the suites. When you change criteria or add suite structure, come back and check that the commands and files here still line up.*
