# t2 — Skill-gain A/B (needs an API key)

English | [中文](README.zh-CN.md)

Answers one question: **if I add a given skill, does the model's answer really get better — and by how much?**

The method is the plainest possible controlled experiment. Run the same set of tasks in two arms:

- `control`: give only the task, no skill
- `treated`: inject the skill body before the task

Both arms are scored by the same set of **deterministic regex criteria** (no LLM judge, no second bill), comparing pass rate and lift.

## Three paths

The commands below run from this directory (`t2/`); evidence lands under `out/t2/` here by default. The path is relative to the **current working directory**: running `node t2/smoke-ab.mjs` from the repo root puts evidence in `<repo>/out/t2`, not in `t2/out/t2`.

### Path 1: no-key trial (zero API calls)

Prove the scoring pipeline has discriminative power and keep the evidence of one run on disk:

```bash
node smoke-ab.mjs --dry
node report.mjs out/t2/<run-id> --format markdown
```

`--dry` uses pre-set answers, reads no skill body and makes no network call: control must be all FAIL and treated all PASS, else the exit code is non-zero. It prints `evidence = out/t2/<run-id>` and leaves `manifest.json`, `rows.jsonl`, `summary.json`, `report.md` in that directory.

### Path 2: real run

```bash
T2_BASE_URL=https://api.example.com/v1 \
T2_API_KEY=sk-... \
T2_MODEL=your-model \
T2_TRIALS=3 \
node smoke-ab.mjs

node report.mjs out/t2/<run-id> --format markdown
```

The key is read only from `T2_API_KEY`; a config file containing a key field is rejected outright. A real run appends one row per cell to `rows.jsonl` as it completes; if it stops midway, resume with `--resume out/t2/<run-id>`: valid cells are skipped, error cells rerun, and a fingerprint mismatch is refused. `--resume` also accepts `--dry`: a complete `locked-v3` dry run holds 48 cells (8 tasks × 3 trials × 2 arms = 24 per arm), while `paired-v4` holds 96 (48 per arm).

### Path 3: CI

Run the zero-cost command in CI:

```bash
node smoke-ab.mjs --dry
```

It is already part of `npm test` (`node run-checks.mjs`), and any failing step makes the whole pipeline exit non-zero. For a nightly job with a key: put the key in a CI secret, pin the task set and runner settings with `--config t2/t2.example.json`, then take the machine-readable result for assertions:

```bash
node t2/report.mjs out/t2/<run-id> --format json
```

The report command reads only `manifest.json` + `rows.jsonl` and never touches the network. Note that `--dry` proves the criteria can separate good from bad; it produces no model reading you can cite. Only a real run does.

## Rulers: locked-v3 and paired-v4

| ruler | prompts sent per task | cells per arm (8 tasks x 3 trials) | purpose |
|---|---|---|---|
| `locked-v3` (default) | base only | 24 | same ruler as the historical readings, comparable |
| `paired-v4` | base + one same-semantics `variant-1` | 48 | checks whether a reading holds for more than one wording |

- Variants change only the wording and scenario, never the graded points; the poison (`poisonOnly`) and genre-pilot (`genrePilot`) tasks stay base-only under v4.
- The ruler enters the run fingerprint and `manifest.json`; switching rulers is switching rulers, and `--resume` refuses on a fingerprint mismatch.
- Every historical result table came from `locked-v3`; do not compare `paired-v4` numbers against it directly.

## Evidence directory: every number is traceable

One run leaves four files under `out/t2/<run-id>/`:

| file | content |
|---|---|
| `manifest.json` | public config (model, tasks, trials, ruler, temperature, timeout), per-task criteria and actual prompt variants, skill/criteria sha256, run fingerprint |
| `rows.jsonl` | one row per cell: answer, hits, tokens, error kind; resume appends only, never deletes |
| `summary.json` | summary recomputed from rows when the run finishes |
| `report.md` | the raw summary dump written when the run finishes |

`report.mjs` reads `manifest.json` + `rows.jsonl` and recomputes; its `--format json` output matches `summary.json` field by field, so every aggregate in the report traces back to specific `rows.jsonl` lines.

**Privacy boundary:** `rows.jsonl` stores the full model answers and may contain sensitive content. Results are local by default and `out/` is gitignored; do not paste an evidence directory into an issue or share it.

## Offline report

```bash
node report.mjs <run-dir>                          # Markdown to stdout (default)
node report.mjs <run-dir> --format json            # JSON to stdout, same shape as summary.json
node report.mjs <run-dir> --out out/t2/report.md   # write to file, stdout stays empty
```

The report covers overall (valid-only, with errors and tool calls listed separately), paired lift with a per-task breakdown, and token totals. When there is one arm or fewer than two tasks, the paired section says `n/a` instead of printing a falsely precise interval; an unknown `--format` or a missing `<run-dir>` exits with code 1.

## Exit codes, schema version and evidence contract

| code | meaning |
|---|---|
| `0` | COMPLETE: dry-run passed, or the real run finished with no ERROR/TOOLCALL cell |
| `1` | Fatal: configuration rejected, invalid arguments/criteria, dry arms did not separate, or an unreadable / incompatible evidence directory |
| `2` | INCOMPLETE: the real run did write its evidence, but at least one cell is ERROR/TOOLCALL; it is not a complete reading, so resume it instead of citing it |

`2` is deliberately distinct from `1`: on `2` the evidence is on disk and worth archiving; on `1` no usable run exists. CI should fail on any non-zero code, but may archive `out/t2/<run-id>/` when the code is `2`. `report.mjs` exits `1` for an unknown `--format`, a missing `<run-dir>`, or a `schema_version` it does not know.

Every evidence file carries `schema_version` (currently `1`, defined as `RUN_SCHEMA_VERSION` in `lib/store.mjs`); `report.md` repeats it in its header. `--resume` and `report.mjs` refuse a directory whose version differs, with exit code `1` — there is no silent migration.

Upgrade rules:

- Adding an optional field is a same-version change: readers ignore unknown fields, and old directories stay readable.
- Bump the version when a required field is removed/renamed, an existing field's meaning changes, or the cell identity / fingerprint inputs change. Leave old evidence on disk untouched and regenerate it rather than converting it.
- `summary.json` is always derived from `rows.jsonl`; never hand-edit it. `report.mjs` recomputes the same summary from the same rows.

Default evidence root is `out/t2/` (override with `T2_OUT_DIR`), one directory per run, and `out/` is gitignored. Do not share an evidence directory: `rows.jsonl` contains full model answers.

Copyable zero-cost CI snippet (the same checks `npm test` runs, no API key needed):

```yaml
- uses: actions/setup-node@v4
  with:
    node-version: '20'
- run: node t2/smoke-ab.mjs --dry
- run: node --test t2/selftest.mjs
- run: node demo/run.mjs --assert
```

## Example config

`t2.example.json` contains only public fields and pins the ruler, task set, trials and output directory:

```bash
node smoke-ab.mjs --config t2.example.json --dry
```

Priority: CLI > config file > environment variables > the `public_config` in a resume directory > defaults. `T2_API_KEY` is always read from the environment; a config file must not contain key fields.

## Environment variables

| var | purpose | default |
|---|---|---|
| `T2_BASE_URL` | OpenAI-compatible endpoint (trailing `/` optional) | required |
| `T2_API_KEY` | API key | required |
| `T2_MODEL` | model name | required |
| `T2_RULER` | `locked-v3` / `paired-v4` | `locked-v3` |
| `T2_OUT_DIR` | evidence root | `out/t2` |
| `T2_TIMEOUT` | per-request timeout (ms) | `60000` |
| `T2_CONCURRENCY` | concurrent requests | `4` |
| `T2_DISABLE_THINKING` | when set to `1`, sends the official param `thinking:{type:"disabled"}` with the request. Hybrid thinking models (measured: Xiaomi `mimo-v2.6-flash`) default thinking on; a real task can take 94s and hit the askOnce timeout. Other providers do not get this param, behavior unchanged | off |
| `T2_REASONING_EFFORT` | forwards the official `reasoning_effort` (e.g. `low`) to cut thinking time under the timeout | not sent |
| `T2_TRIALS` | runs per arm per task | `3` |
| `T2_SKILL_ROOT` | skill-library root | `skills/` under this dir |
| `T2_TASK` | run only the listed tasks (comma-separated ids) | all |
| `T2_ARM` | `control` / `treated` / `both` | `both` |
| `T2_DUMP` | when set to `1`, print each answer in full | off |

## CLI flags

| flag | purpose |
|---|---|
| `--dry` | zero calls: run the scoring pipeline on pre-set answers |
| `--config <file>` | read a JSON config (no key fields allowed) |
| `--resume <run-dir>` | resume: skip valid cells, rerun error cells |
| `--task <ids>` | comma-separated task ids |
| `--arm <arm>` | `control` / `treated` / `both` |
| `--trials <n>` | runs per arm per task |
| `--ruler <name>` | `locked-v3` / `paired-v4` |

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
