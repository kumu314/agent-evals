# Eval Primitives

English | [中文](eval-primitives.zh-CN.md)

Five transferable principles distilled from the real incidents and fixes across this repo's three suites (fleet-eval / merge-eval / t2). Each gives: **claim → why (field evidence) → where it lives in code (a stable anchor, not a line number) → the failure mode it blocks.** Every reading can be reproduced on the spot with a script in the repo; it is not hearsay.

Who it is for: anyone holding assets that are "annoying when they break, but you don't want to pay a model to score every regression" — skill libraries, content libraries, multi-endpoint distributed configs.

---

## Primitive 1: If it can be decided deterministically, do not bring in an LLM as judge

**Claim**: prefer regex, md5, byte comparison, exit code, and remote-ref ground truth for graders; a model score is the last resort and must itself be checkable by a deterministic criterion.

**Why**: an LLM judge is both expensive and non-reproducible — the same answer can score differently twice, and the entire value of a regression eval lies in the binary signal "if it dropped, it's broken". None of the three suites' 22 assertions (fleet 11 + merge 7 + t2 scoring-pipeline self-check) uses a model score; one run costs zero API calls.

**Where it lives**:
- `merge-eval.mjs` `untouched.hash-zero-diff`: sha256 comparison of every untouched entry, listing all out-of-bounds ids.
- `fleet-eval.mjs` `endpoints.skillmd-parity`: md5 of each SKILL.md at each endpoint compared to the source.
- `reconcile.drift-zero`: `skills-reconcile.py` **always returns exit code 0**, even when broken — so the judgment reads the parsed summary numbers (`differing 0 / unreadable 0`), not `$?`. HTTP 200 ≠ the resource exists; exit code 0 ≠ the thing got done — the same trap in two costumes.

**Failure mode it blocks**: betting the eval's cost on call fees so it becomes "too expensive to run often"; and verdict drift caused by a non-reproducible judge.

---

## Primitive 2: Every criterion needs a negative control; a trustworthy environment needs a positive control

**Claim**: all-green on the positive side does not prove a criterion works — there must be a drill that "deliberately gets it wrong and checks it really goes red" (negative control); and there must be a control arm where "a known-correct sample through the same channel should go green" (positive control). If the control arm isn't green, the environment is untrustworthy and this round's red does not count.

**Why**: a criterion that can never go red is testing a tautology, not a fact. `anysearch.encoding-verdict` carries a control arm (see the criterion table in the root README), guarding against "a dead probe faking green"; `t2/smoke-ab.mjs --dry` uses pre-set answers to force the control arm all-FAIL and the treated arm all-PASS, `lift = 100 pp`, proving the pipeline separates good answers from bad — if it can't separate them, every A/B number afterward is meaningless.

**Where it lives**:
- `merge-eval/drill-merge-eval.mjs`: `git init` a mini fixture in TMP — S1 positive control (the five local checks that should be green really are), S2 out-of-bounds edit (`only-poems-touched` should go red and does), S3 stale baseline (three `metrics.stale` really red), S4 missing review report (`missing=1` and `gate_verdict=BLOCK`). Zero network, zero API, and after running it self-proves the live file's md5 is unchanged.
- `fleet-eval/drill-a1a2.mjs`: A1 positive-control arm — an intact sample through the same encoding channel should go green; when `envTrusted` is false, even the guard's red is not trusted.

**Failure mode it blocks**: a criterion written backwards, an always-true guard, and "the suite is all green only because it can't detect anything".

---

## Primitive 3: For "must be stable" assets, judge pass^k and account for invalid rounds honestly

**Claim**: red-line assets (byte-for-byte content stability, fan-out consistency) require passing **every one of N rounds** (pass^k), not "passed at least once" (pass@k). Rounds caused by environment flakiness are annotated honestly and never blended into the pass rate.

**Why**: pass@k means "get it right once and it counts" — exactly what a red-line asset can least tolerate. On deterministic tasks pass^k == pass_rate (fleet's first run had `pass^2 = 77.8%`, identical to pass_rate, as expected); k only earns its value on a pipeline with some randomness — so merge-eval supports `--trials N`, rerunning the local checks each trial.

**Where it lives**:
- `remote-truth.read` (kind: **external**) queries the network once per round and memoizes the reading; `remote-truth.stable` compares only the memoized value each trial. **"Query again" tests the network; "compare the memo" tests whether the remote stayed consistent during the test** — the latter is the invariant we actually want to verify. Feeding network flakiness into pass^k makes a single network hiccup a false red — external noise miscounted as a red-line breach.
- When the network is unavailable, `read` reports red and labels it "this is a network/environment problem, not a problem with the thing under test"; `stable` reports "cannot determine" — neither treating a missing reading as a pass nor pretending it passed.

**Failure mode it blocks**: giving red-line assets a pass@k hall pass; and miscounting the outside world's instability as flakiness of the thing under test.

---

## Primitive 4: Effective parameters must be echoed; a missing config must "say it's unset" rather than silently degrade

**Claim**: the first line of any output always prints the parameters actually in effect this round; when an optional config is missing, either it's a required error-exit or it's explicitly labeled "unconfigured / fell back to X" — never silently using a value you thought didn't exist.

**Why**: silent config degradation of the "I thought I ran 3 rounds but actually ran 2" kind was hit for real during the first debugging pass (`--trials 3` parsed down to 2). Whether a parameter took effect should not require reading the code afterward to confirm.

**Where it lives**:
- merge-eval echoes `trials / remote / local / base / allow / released / require_baseline` on its first line; when `MERGE_BASE_REF` is absent and falls back to an old snapshot it sets `baselineStale` and **proactively reports red** — the criterion's input itself needs a freshness gate; if the baseline is older than the thing under test, no matter how correct the criterion, the conclusion is wrong.
- fleet-eval's `FLEET_SHARED` missing → exit code `2` with a one-line hint (no default since 2026-10-12); `MERGE_REPO_SLUG` unset → explicitly reports "unconfigured" instead of assembling a malformed URL.
- The exemption allowlist `fleet-eval.allow.json`: no such file = exempt nothing (the strictest reading); a broken file or a non-string-array = warn into detail and **do not pass** — fail-closed, so a broken config file cannot silently launder junk.

**Failure mode it blocks**: a default value changing quietly, a flag not being passed through, gate config drift — all revealed on line one, no archaeology required.

---

## Primitive 5: Evidence must come from externally re-readable artifacts; a criterion may not self-prove

**Claim**: each check's evidence must point to something a third party can re-read — remote API readings, file sha256/blob sha, git ref ground truth; forbid citing self-reports like "I finished reading / the command didn't error / the report says PASS", and above all forbid a criterion whose input is something the evaluator itself wrote.

**Why**: a self-proving criterion is circular reasoning. The first version of merge-eval verified "remote state" using the local tracking ref — `git update-ref` can rewrite the local record to whatever you believe, after which every criterion self-proves and passes, testing nothing but its own memory.

**Where it lives**:
- `remote-truth.read` must go through `git ls-remote` or the GitHub API (a real network query), degrading only on failure; in the degraded path the slug is passed via argv with a form precheck (`^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$`), never assembled into an embedded script's source — the evidence path itself must not leave an injection surface.
- `merge-gate.audit-per-batch` splits report status into three kinds and does not merge them: `path@<blob-sha>` (committed, immutable pointer, pass), `untracked` (exists but uncommitted = no immutable pointer obtainable = evidence not re-readable, BLOCK), `missing` (never generated, BLOCK). "Uncommitted" is not an acceptable intermediate state.
- The endpoint list is **read live from `sync.ps1`**, never copied from a second document — copy it and it silently goes stale (measured on this machine: endpoints went from 5 to 4 while the doc still said 5). Before reading, strip PowerShell `#` comments line by line: `sync.ps1` keeps a commented-out old endpoint, and not stripping it invents an extra endpoint and a pure false red where all 240 entries report ABSENT. `endpoints.match-authority` is the cross-check designed for exactly this kind of drift.

**Failure mode it blocks**: contaminated criterion provenance (self-proving loops), evidence staleness (an untracked report modified after the fact goes undetected), and second-hand copying of stale name/path lists.

---

## Appendix: when you see red, suspect the criterion first

Red comes in two kinds: **the thing under test really broke**, and **the criterion itself is wrong**. In this repo's actual experience, every red from merge-eval's first round **landed on the criterion side — none was a real breach**, all of one family:

| symptom | suspect first |
|---|---|
| reading contradicts the run facts (thought 3 rounds, actually 2) | parameter parsing / whether config really took effect |
| fields self-contradict in one line (prefix=same, suffix=same, yet "block differs") | the criterion itself is written wrong |
| the criterion's input is "something I wrote myself" | the criterion is self-proving |
| baseline older than the thing under test | criterion input is stale |
| naming/paths are guessed | you'll hit a real variant like the face-stamp |
| no hit yet recorded green | missing treated as pass |

The most expensive instance of a wrong criterion: `const POEMS = [...]` has the whole array inside `<script>`, and requiring "all pure logic/style blocks outside POEMS to be exactly equal" also required the data block that *contains* POEMS to be equal — this criterion can never pass, and the first thing to go red is itself. **Before you chase the business logic from the reading, run an experiment on the reading itself.**

## Appendix: decision semantics recognize only one state

The reading shows three states separately — INVALID / PARTIAL / ALL PASS; but when feeding the gate, only `ALL PASS` counts — **measurement failure and a negative measurement are, in the decision, both "not allowed to pass"** (the `gate_rule` verbatim). Reading INVALID as "no objection raised" is precisely the relapse path of the "missing treated as pass" failure inside our own suite.

## Appendix: the shared parsers need unit tests

The three suites' `stripPsComments` / `parseFrontmatter` / `extractPoems` are consolidated in `lib/parsers.mjs` (single implementation); `selftest.mjs` pins 18 boundary cases with node:test (CRLF normalization, `>-` folding, `]` inside strings, escaped quotes, unclosed-array → null). Parsers are the foundation under the criteria: get them wrong and every "deterministic" result above them is a mirage.

---

*Sources for every reading in this document: the empirical records in `fleet-eval/README.md`, `merge-eval/README.md`, and `CHANGELOG.md`, plus the scripts themselves (anchors are check ids and function names, which survive reordering).*
