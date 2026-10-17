# merge-eval · a deterministic regression suite for batch content merges

English | [中文](README.zh-CN.md)

A zero-dependency, zero-API-cost **regression eval suite**: it writes the red lines of "batch content merge" as mechanically decidable assertions, runs them once after each merge, and reports when something drops.

The design standard comes from the 2026-01 Anthropic piece "Demystifying evals for AI agents" and NVIDIA's agent-evaluation practice: **be deterministic where you can, report pass^k when you need stability, and evidence must come from externally re-readable artifacts.**

> ⚠️ **Scope (up-front declaration — read this first)**: this suite's criteria are currently **bound to a "content-site" shape of repo-under-test** — namely the `index.html` with an embedded `const POEMS = [...]` data block + `review-*.md` per-piece review files naming convention. Red lines like "untouched entries byte-for-byte unchanged", "out-of-bounds edit BLOCK", "missing report BLOCK" all hold on that basis. The repo-coupling surface (entry filename / data-array name / report directory + naming prefix / baseline file path / remote local ref) has been extracted into `merge-eval.profile.json`, whose defaults are exactly the current content-site shape — switch to another "content-site" repo by editing this profile, no need to touch the `.mjs`; the report name's "face-stamp position" depth convention (default: starts with a letter, not a digit) is also parameterized as `faceStampPattern` (a regex fragment; a bad value exits with code 2 at load time); what still remains hard-coded in `CHECKS` is only the base shape of the data block + per-piece review files — this is not a general plug-and-play eval, it is a **regression gate tailored to this content-production line**; the profile only pulls the outer-edge parameters out. The "★ lives outside the repo-under-test" section below covers ownership; this note covers the **coupling surface**.

## ★ This suite deliberately lives outside the repo-under-test (`<this-repo path>`)

Not placed inside the repo-under-test, for three reasons:
1. **An evaluator that shares a source with the thing it tests is no independent evaluation at all** — living together, it can be casually changed by the same batch of edits.
2. **Evaluation infrastructure's lifecycle should outlast what it evaluates** — repos get cloned/archived/CI-swapped; the eval shouldn't break along with them.
3. **Different ownership**: this is a "how I work" quality tool, not "this repo's product".

So the repo-under-test path is passed via `MERGE_REPO`, not guessed from a relative path.

## Positioning

A **regression eval** (pass rate should be near 100%; a drop means something broke), not a capability eval (those should start low).
Each red line is a "must be stable" asset → judge **`pass^k`** (pass every one of N runs), not `pass@k`.

## Usage

```bash
# forward: specify repo-under-test + the real SHA before this merge + the list of pieces touched this time
MERGE_REPO="<repo-under-test path>" \
MERGE_BASE_REF="<pre-merge SHA>" \
MERGE_TOUCHED_IDS='["id1","id2"]' \
MERGE_RELEASED_BATCHES='["jingdu-batch-01"]' \
node <this-repo path>merge-eval.mjs --trials 2

node merge-eval.mjs --json     # JSON only
node merge-eval.mjs --quiet    # summary line only

# gate mode: no baseline = FAIL (no idle pass allowed)
node merge-eval/merge-eval.mjs --require-baseline --quiet
```

The reading's **first line always echoes the parameters actually in effect** (`trials / remote / local / base / allow / released`) —
silent config degradations of the "I thought I ran 3 rounds but actually ran 2" kind show up on line one; no need to read code afterward.

## Environment variables

| variable | what it does | what happens if unset |
|---|---|---|
| `MERGE_REPO_SLUG` | remote repo `owner/repo` (used by the GitHub API fallback path). **Without it no request is sent**, and it explicitly reports "unconfigured" rather than assembling a malformed URL | empty → normal as long as ls-remote works; when ls-remote fails it explicitly reports unconfigured |
| `MERGE_REPO` | **repo-under-test path** (this suite lives outside the repo, no longer guessing via a relative path) | falls back to the current directory `.`, and the reading's first line shows which one was actually used |
| `MERGE_BASE_REF` | **authoritative baseline**: `git show <SHA>:index.html`, i.e. "the moment before the merge" | falls back to a stale workspace snapshot and **proactively reports red** (`baselineStale`) — a stale snapshot may predate merge-01, counting historical legit changes as out-of-bounds; in a gate call (with `--require-baseline`) a missing baseline is judged FAIL outright |
| `GH_CLI` | gh executable path (for the API fallback path's token retrieval) | tries the Windows default install locations in order → `gh` on PATH; if all fail, brings back each candidate's failure reason verbatim, **no silent degradation** |
| `MERGE_TOUCHED_IDS` | list of pieces **allowed** to change this time (JSON array) | empty → any change counts as out-of-bounds, `untouched` must go red |
| `MERGE_RELEASED_BATCHES` | batches authorized to pass (used by the gate criterion) | empty → the gate criterion PASSes but detail writes "no batch to check" (**does not pretend to have checked**) |

## Seven criteria

| id | layer | kind | what it judges |
|---|---|---|---|
| `scan.sanity` | harness | local | **anti-false-green first line**: POEMS parses, count > 0, ids non-empty and unique |
| `poems.count-and-order` | data | local | 970 poems, id order unchanged **position by position** (judges sequence equality, not set equality) |
| `untouched.hash-zero-diff` | data | local | untouched pieces have per-piece sha256 zero change, lists all out-of-bounds ids |
| `only-poems-touched` | structure | local | text outside the POEMS array byte-for-byte identical; after **excluding the data block that contains POEMS**, all pure logic/style blocks equal |
| `merge-gate.audit-per-batch` | process | local | each batch named by authorization has a spot-check report containing PASS, one missing stops all. **Report name anchored on the face-stamp position** (`review-<batch>.md` or `review-<batch>-<face-stamp>.md`, face-stamp **not starting with a digit**); reading gives `path@<blob-sha>` |
| `remote-truth.read` | fanout | **external** | reads remote ground truth (ls-remote, degrading to GitHub API on failure) and **memoizes** it, queried once per round |
| `remote-truth.stable` | fanout | local | each trial only compares the memoized value to local HEAD, **does not re-query the network** |

### local vs external (the semantic layering of pass^k)

- **local** (judges the object under test): runs each trial, input should be identical each time → thereby proving idempotence.
- **external** (judges the outside world): runs **once per round**, the reading is memoized for all trials to reuse.

Why: what `pass^k` verifies is the stability of the **object under test**. The remote doesn't change because you asked twice; re-querying N times only spends N× the time and adds no information; more dangerous is **bringing network flakiness into pass^k** — one network hiccup becomes a false red, i.e. external noise miscounted as a red-line breach.

> "Query again" tests the **network**; "compare the memo value" tests **whether the remote stayed consistent during the test**. The latter is the real invariant.

**When the network is unavailable**: `remote-truth.read` reports red and labels it "★ this is a network/environment problem, not a problem with the object under test", `stable` reports "cannot determine" — **neither treating a missing reading as a pass nor pretending it passed**.

## ⚠ Hard constraints (all pits already stepped in; don't change them back)

1. **Always go async when spawning subprocesses.** On this machine Node 22.22.2's `spawnSync`/`execFileSync` returns `EBUSY` for **any** executable (unrelated to disk headroom, measured 2026-10-06); async `spawn` is fine. Writing it synchronously **silently fails to get the baseline**.

2. **A criterion's source must not be "something I wrote myself".** `remote-truth` must use `git ls-remote` or the GitHub API (a real network query), not a local tracking ref — `git update-ref` is "rewrite the local record to whatever you believe"; get the memory wrong and you've written false accounts into the ref, after which every criterion self-proves and passes.

3. **A self-contradicting reading is a signal of the suite's own bug, not of bad data.** On the first run `only-poems-touched` reported "prefix=same suffix=same yet the block differs" — because `const POEMS = [...]` has the whole array written inside `<script>`, requiring that block to be equal is itself a wrong criterion. **Suspect the criterion first; don't chase the business logic from the reading.**

4. **The criterion's input itself needs a freshness gate.** If the baseline is older than the object under test, no matter how correct the criterion, the conclusion is wrong: when using a stale snapshot, set `baselineStale` and **proactively report red**, don't silently hand out a possibly-distorted PASS.

## Classifying the suite's own failure modes (worth more than adding an 8th check)

The reds I reported over these rounds **all landed on the criterion side — none was a real breach**. The shapes are of one family, classified below — **when you see a symptom, suspect these first**:

| symptom | suspect first | instance |
|---|---|---|
| **reading contradicts the run facts** | parameter parsing / whether config really took effect | `--trials 3` thought 3 rounds, actually 2 |
| **fields self-contradict in one sentence** | the criterion itself is written wrong | prefix=same suffix=same yet "block differs" |
| **criterion self-proves** | is the criterion's source "something I wrote myself" | verifying the remote with a local tracking ref |
| **criterion input is stale** | is the baseline older than the object under test | using a pre-merge-01 snapshot as baseline |
| **naming/path assumptions** | guessed or anchored | hard-coding `review-<batch>.md` and hitting the face-stamp |
| **missing treated as pass** | a non-hit ≠ PASS | not hitting the word list yet recorded green |

## ★ Decision semantics: measurement failure and a negative measurement are, in the decision, both "not allowed to pass"

The reading keeps INVALID / PARTIAL / ALL PASS as three separate states; **but when feeding the decision gate, only `ALL PASS` counts**:

```
gate_verdict: PASS | BLOCK
gate_rule: measurement failure and a negative measurement are, in the decision, both not-allowed-to-pass; INVALID/PARTIAL are uniformly BLOCK, requiring human takeover and an audit trail.
```

Why INVALID must not be read as "no objection raised / insufficient info, do as you like" — that is precisely the "missing treated as pass" failure class in this README recurring **inside our own suite**. So `gate_verdict` is a machine-readable field, present in all three output modes (human / `--quiet` / `--json`), so callers cannot misread it.

For the same reason, the gate criterion splits "report status" into three kinds and does not merge them into a neutral label:

| status | meaning | gate |
|---|---|---|
| `path@blobsha` | evidence re-readable (committed, has an immutable pointer) | pass |
| `untracked` | report exists but is uncommitted ⇒ **no immutable pointer obtainable = evidence not re-readable** | BLOCK |
| `missing` | report never generated | BLOCK |

"Uncommitted" is not an acceptable intermediate state.

## Meta-discipline

Each check's evidence must come from an **externally re-readable artifact** (remote API, file md5, ref ground truth); self-reports like "I finished reading / the command didn't error" are forbidden.

## Self-check: reverse verification

All-green in the forward direction does not prove a criterion works. **You must run a reverse once** to confirm it goes red — already baked into a script:

```bash
node merge-eval/drill-merge-eval.mjs
```

It `git init`s a mini fixture in TMP (touches no live file) and runs four scenarios: positive control (the criteria that should be green really are), out-of-bounds edit (`only-poems-touched` really goes red), stale baseline (the stale metric really goes red), missing spot-check report (gate `missing=1` and BLOCK). Zero network, zero API, millisecond-scale, already hung in CI.

Measured records:
- **First real use on someone else's delivery** (a 30-piece batch content merge)
  → using `MERGE_BASE_REF=3708805` (pre-merge) as baseline → **7/7 ALL PASS**, `untouched` differences: all 30 pieces within the allow list (exactly that batch of 30),
  gate reading `out/review-jingdu-batch-01-pi.md@002c41621f5d`.
- reverse (empty allow list) → **FAIL: untouched.hash-zero-diff** (proving the criterion really goes red)
