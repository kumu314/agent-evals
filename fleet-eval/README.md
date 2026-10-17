# agent-evals — a local Evals rollout

English | [中文](README.zh-CN.md)

> **Porting note**: `FLEET_SHARED` is **required**, pointing at your own skill-library root — there is no default (since 2026-10-12 the author's local paths were removed from the code; if unset it prints a one-line hint and exits with code `2`, rather than silently reading somewhere else).
> It assumes that directory has `skills/`, `sync.ps1`, and `scripts/skills-reconcile.py` — a "shared skill library + multi-endpoint fan-out" layout.
> If your directory structure differs, the 5 criteria `endpoints.*` / `reconcile.*` (fanout layer) and `anysearch.encoding-verdict` (tooling layer) will go red — they are bound to that layout by design.
> To run only the 6 layout-independent criteria (the frontmatter / junk / suite ones), explicitly set `FLEET_SCOPE=core`: the suite will skip those 5 and **echo which ones it skipped**, running the rest normally. **The default `full` (all 11 criteria) is unchanged word for word** — not setting this switch, or a missing `sync.ps1`, still errors normally and does not auto-degrade (which would hide "you actually misconfigured the path").

Retrieval date 2026-10-06. Methodology references are in `research/`; the project landscape list is in `research/project-landscape-2026-10-06.md`.

## In one sentence

The 2026 consensus is not "which framework to pick" but **raising evals as product-engineering infrastructure**: be deterministic where you can be deterministic, prefer outcome over the agent's self-report, and use `pass^k` rather than `pass@k` for anything that "must be stable".
This machine has no GPU, so the local-weights route is excluded (lm-evaluation-harness / oumi / lighteval local mode all ruled out); only the **deterministic + API-type** two layers are used.

## Layers (ranked by "value × local feasibility")

| layer | what it does | cost | status |
|---|---|---|---|
| **T1 fleet regression suite** | deterministic assertions over 240 shared skills + 4 fan-out endpoints | 0 API calls | ✅ **landed and running** (`fleet-eval/fleet-eval.mjs`) |
| **T2 skill lift A/B** | measure "with a given skill, how much better did the answer get" | API cost | infrastructure installed (`promptfooconfig.yaml`) |
| **T3 optional add-ons** | Inspect AI (UK AISI) / self-hosted Langfuse / Tencent AI-Infra-Guard's Skills·MCP Scan | situational | not installed, on demand |

## How to run T1

```powershell
node fleet-eval.mjs                 # 1 round
node fleet-eval.mjs --trials 3      # 3 rounds, additionally reports pass^3
node fleet-eval.mjs --json          # JSON only
```

### Environment variables

| variable | what it does | what happens if unset |
|---|---|---|
| `FLEET_SHARED` | **required**. shared skill-library root (the level containing `sync.ps1` / `skills/` / `scripts/`) | prints a one-line hint, exits code `2` |
| `FLEET_PYTHON` | python executable path (used by `reconcile.*`) | falls back to `python` on PATH |
| `FLEET_ALLOW_FILE` | `junk.absent` exemption allowlist JSON path | reads `fleet-eval.allow.json` in this dir; no file = exempt nothing |
| `FLEET_SCOPE` | scope: `full` (default, all 11 items) / `core` (only the 6 items independent of the "shared library + fan-out endpoints" layout, explicitly skipping the 5 fanout + tooling items and echoing which were skipped) | defaults to `full`; illegal value exits code `2` (not silently treated as default). When an external skill library lacks `sync.ps1`, **declare it explicitly with this, rather than letting the suite auto-degrade** |
| `FLEET_ANYSEARCH` | path to anysearch.py in `drill-a1a2.mjs` | derived from `FLEET_SHARED`; if both absent, exit code `2` |

- Exit code `0` = all green; `1` = at least one item failed (each failing item carries a `detail` in the JSON).
- The report lands at `out/fleet-eval-YYYY-MM-DD.json`.

### What it checks (11 tasks, all deterministic graders)

| id | layer | assertion |
|---|---|---|
| `scan.sanity` | harness | source dir exists and is non-empty (guards against "scanning 0 entries still counts as all green") |
| `frontmatter.valid` | structure | every SKILL.md parses to a non-empty `name` / `description` |
| `frontmatter.name-matches-dir` | structure | `name` == directory name |
| `frontmatter.name-unique` | routing | `name` is unique within the source tree |
| `junk.absent` | hygiene | no `.git`/`node_modules`/`__pycache__`/`*.bak*`; exemptions go by **exact path** through the config file `fleet-eval.allow.json` (template `fleet-eval.allow.example.json`, path overridable via `FLEET_ALLOW_FILE`): no such file = exempt nothing; broken file or non-string-array = warn into detail and **do not pass** (fail-closed, so a broken config can't silently launder junk) |
| `endpoints.present` | fanout | the declared endpoint directories all exist |
| `endpoints.match-authority` | fanout | this suite's live-read `sync.ps1` endpoint list == the output of `skills-reconcile.py --targets` |
| `endpoints.skillmd-parity` | fanout | each endpoint's each skill's SKILL.md md5 == source (honors `$hideFrom`) |
| `reconcile.drift-zero` | fanout | whole-library reconcile `differing 0` / `unreadable 0` |
| `anysearch.encoding-verdict` | tooling | a tool script's UTF-8 guard really fires (**includes a control arm**, guarding against "the probe itself failed" causing a false green) |
| `suite.determinism-contract` | suite | the suite self-audits: registry well-formed + source ids map one-to-one to the registry + no network access inside any task body |

### Three disciplines you must know

1. **The endpoint list is read live from `sync.ps1`, never copied from a second document.** And before reading it, PowerShell `#` comments must be stripped line by line — `sync.ps1` keeps a commented-out old endpoint. Measured: not stripping comments invents an extra endpoint and all 240 entries report ABSENT (a pure false red). `endpoints.match-authority` is the cross-check built for exactly this.
2. **`skills-reconcile.py` always returns exit code 0.** It prints the reading in a summary line and does not error even when broken. So `reconcile.drift-zero` decides by **parsing the summary line's numbers**, not `$?`.
3. **Only read the readings when the fleet is at rest.** Running this suite mid fan-out goes red, and looks **exactly like** real drift (both exit 1, both report `pass_rate 77.8% (7/9)`). 2026-10-06 drill measured: 13:12–13:18 someone ran `sync.ps1` (`$targets` order endpointA → endpointB → endpointC → endpointD, ~90s per endpoint); I read 7/9 at 13:15, 9/9 at 13:19, and 7/9 again at 13:21 (this time real drift: source changed, endpoint not yet fanned out) — none of the three reds was a suite fault, but only the last one needed human action. Two judgment rules: ① is any `sync.ps1` / `powershell` running; ② are the endpoint skill directories' creation times being refreshed in a staircase pattern within the last few minutes (measured: endpointA 13:12:56 → endpointB 13:14:16 → endpointC 13:16:36 → endpointD 13:18:06). It's fine inside step 2c — it runs right after `sync.ps1`, naturally at rest; **a human running it ad hoc must first confirm it's at rest**.

## Already wired into the existing scheduled task (2026-10-06)

T1 is hung on **step 2c** of `<SHARED>\scripts\skills-update-scheduled.ps1`, after the 2b reconcile and before the blackboard registration. This round's order is:
`npx skills update` → `sync.ps1` fan-out → `skills-reconcile.py` reconcile → **`fleet-eval.mjs` regression suite** → blackboard registration.

> **Frequency = daily 09:00 (changed 2026-10-06, confirmed by this round's live read).**
> Earlier this document asserted "it's actually weekly; the local docs' 'daily' is wrong" — that basis was reading `CalendarTrigger` + `ScheduleByWeek` (`WeeksInterval=1`, `DaysOfWeek=Monday`, Next Run `2026-10-12 09:00`) from `schtasks /query /tn <task-name> /xml` at the time.
> That assertion is **void**: on 2026-10-06, per user confirmation, the trigger was changed to `<ScheduleByDay><DaysInterval>1</DaysInterval>` (pre-change XML backed up at `out/<task-name>.trigger-backup.xml`).
> Live evidence (2026-10-06 12:5x): `Schedule Type: Daily`, `Days: Every 1 day(s)`, `Next Run Time: 2026/10/7 9:00:00`, `StartBoundary 2026-10-06T09:00:00+08:00` + `<ScheduleByDay><DaysInterval>1</DaysInterval>`.
> So line 9 of `sync.ps1`'s header comment "daily 09:00" is now **correct**, and the two occurrences of `（每周一 09:00）` / `— 每周一 09:00，` in another scheduled-task skill's `SKILL.md` were also synced to "daily 09:00".
> Impact: drift is caught **the same day** at worst (was 7 days before).

Why add 2c after 2b: 2b only sees **file-content drift**, not structure/hygiene/routing-class defects — 2c's first run caught 3 cases of `frontmatter name ≠ directory name` and 11 source-tree leftovers, all of which 2b reported as 0 drift.

Logs land at `<SHARED>\logs\<task-name>.LOG.md`:
- all green → `| time | fleet-eval all green: pass_rate = ... | ✅ |`
- some failed → `| time | fleet-eval failed 2/9 items: xxx {...} ; yyy {...} | ⚠️ |`, and this line is carried into the blackboard note.

The original script's `Add-Log` hard-coded the status to ✅, so failures were also logged as all green; it was split into `Add-LogStatus($line,$status)` + a thin `Add-Log` wrapper, and `|` is escaped (otherwise it breaks the markdown table).

### Two anti-false-green designs in 2c (both measured)

1. **Only trust the report freshly written this round.** The criterion is the report file's mtime ≥ this round's start time. If you only looked at "is there a `fleet-eval-*.json` in the directory", when the suite failed to launch you'd read **yesterday's old report** and report all green.
2. **Don't parse console text.** Failure details are taken from the suite's UTF-8 JSON output, avoiding Chinese being swallowed by console encoding.

Measured (the author's three wiring scripts, each extracting the 2c block from the **deployed file** by regex and executing it, not a copied imitation; not published with the repo because they contain local private paths):

| scenario | result |
|---|---|
| normal | ✅ writes `fleet-eval failed 2/9 items: frontmatter.name-matches-dir {"mismatch":3} ; junk.absent {"junk":11} \| ⚠️` |
| node missing | ⚠️ takes the catch branch, did not read an old report |
| node fine but report written elsewhere (old report left on disk) | ⚠️ `no report produced this round (exit=1, report mtime earlier than this round's start)` — refuses to read an old report |

### Rollback

The original file is backed up in the same dir as `skills-update-scheduled.ps1.bak-before-fleet-eval-20261006`; overwrite back with `Copy-Item -Force`.

> Note: editing this `.ps1` must preserve the **UTF-8 BOM** — PowerShell 5.1 decodes a BOM-less `.ps1` as GBK, garbling Chinese immediately. This change was made by reading the original bytes with node, replacing only the content, and writing back with the BOM preserved as-is (my own verification script tripped on this pit).

## T1 first-run readings (2026-10-06, 2 trials)

```
pass_rate = 77.8%  (7/9)   pass^2 = 77.8%     # deterministic task → pass^k == pass_rate, as expected
240 skills | 922 SKILL.md per-endpoint compared | diff 0 | absent 0
reconcile: differing 0 | unreadable 0 | hidden 38 | excluded-source 52
```

Two genuine failures (**findings, not the suite being broken**):

- `frontmatter.name-matches-dir` — 3 cases of directory name ≠ frontmatter `name`:
  one case of directory-name casing mismatching `name` (`Foo` vs `foo`), two cases of `name` not matching the directory (extra suffix / entirely different).
- `junk.absent` — 11 leftovers in the source tree: 9 `*.bak*` + 2 `__pycache__`. `sync.ps1`'s exclusion table keeps them from fanning out, so they only pollute the real source tree.

These two were **not auto-fixed at the time** — the real source is the sole write point for 4 endpoints; changing it must follow the `sharedskills` discipline (edit the real source → run sync → per-endpoint reconcile). **The 2026-10-06 fix round has since been executed per that discipline; readings below.**

## T1 fix-round readings (2026-10-06 12:58) — 9/9 all green

```
pass_rate = 100.0%  (9/9)        # exit code 0
240 skills | 922 SKILL.md per-endpoint compared | diff 0 | absent 0
reconcile: differing 0 | unreadable 0 | aborted false
```

| item | action | post-fix reading |
|---|---|---|
| `frontmatter.name-matches-dir` | edited 3 frontmatter `name` values to equal the directory name (**did not touch the directories**, whose names are referenced by `$hideFrom` and elsewhere): the 3 above | `{"mismatch":0}` |
| downstream (name changed, references can't dangle) | SKILL.md bodies and agent config strings that referenced the old `name` | changed, per-endpoint md5 checked |
| `junk.absent` | 9 real junk items moved into `archive\junk-2026-10-06\` (8 `*.bak*` + 1 `__pycache__`, 195.7 KB, per-item sha256 ledger) | `{"junk":0,"allowed":1}` |
| exemption registration | one deliberately kept upstream clone's `.git` (contains local commits, push / touching origin forbidden), exempted by **exact path**; a `.git` under any other skill still counts as junk | counted in `metrics.allowed` |
| the suite's own defect | `junk.absent`'s detail was originally `slice(0,10)`; when 11 hit, the detail only listed 10, so the reading and the detail disagreed; changed to not truncate | both copies' md5 `1CF006A6` match |

> The 11th item of the first-run detail was hidden by truncation; at the time it was inferred by walk order to be that `.git` exemption item — the check held. On the fix round's rescan, one `scripts/__pycache__` had already disappeared on its own, so 9 items actually landed.

Post-edit verification chain: `sync.ps1` fan-out (4 endpoints, 0 conflicts, excluded 42) → **per-endpoint targeted check** of the 6 changed files' md5 (including `openai.yaml`, which the suite's `skillmd-parity` doesn't cover; the only `ABSENT` was a skill landing on an endpoint hidden by `$hideFrom`, i.e. the pre-set hide) → `fleet-eval.mjs` 9/9.

## T3 candidates (ready but not enabled)

- **Inspect AI** `UKGovernmentBEIS/inspect_ai` (UK AISI official) — Task/Solver/Scorer trio, the most neutral, suited to research-grade agent-trajectory evals. Needs Python + the various API keys.
- **Self-hosted Langfuse** — keeps the trace on your own D drive, suited to adding the "production observability" half to T2's A/B.
- **Tencent AI-Infra-Guard** — includes **Skills Scan / MCP Scan**, directly matching a "many skills + MCP" shape; worth a read-only scan once before deciding whether to make it routine.
