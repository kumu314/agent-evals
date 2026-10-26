# AGENTS.md

Working rules for AI agents in this repository. Most harnesses load this file automatically;
a harness that does not must be pointed at it on purpose.

This is a restatement, not the source of truth: the suites and `README.md` stay authoritative.
Every path and command named below is checked by `scripts/check-agents-doc.mjs`, so this file
cannot quietly rot when a script is renamed or moved.

## 1. What this repo is

- Three deterministic regression suites for agent assets: `fleet-eval/` (skill-library
  regression), `merge-eval/` (bulk-merge byte identity), `t2/` (skill-gain A/B — the only suite
  that spends API calls).
- Tool-shaped, not library-shaped. `fleet-eval/` expects a skill library on disk; `merge-eval/`
  expects a repo under test. Neither is a drop-in dependency, and neither is a package.
- Zero runtime dependencies, Node >= 20.11 (declared in `package.json`). No build step.
- No LLM-as-judge anywhere, by design. Introducing one is a maintainer decision, not an agent
  task.

## 2. Judging principles — a change does not amend these

1. If it can be decided deterministically, do not score it with a model: regex, md5, byte
   comparison, exit code, remote-ref truth.
2. Evidence must be externally re-readable — a file on disk, a sha256, a remote read. Never
   "I ran it and it looked fine".
3. For assets that must stay stable, judge `pass^k`, not `pass@k`.
4. When you see red, suspect the criterion first. Every red in merge-eval's first round turned
   out to be its own bug.

The portable patterns behind these are written up in `docs/eval-primitives.md`; maintainer-only
steps are in `docs/maintainer-runbook.md`.

## 3. Hard rules

- **Never weaken an assertion to make a run green.** If the criterion is genuinely wrong, fix
  the criterion and say why in the commit message. The red you delete is the bug you keep.
- **Any change to criterion semantics ships with a negative control** proving the new assertion
  really can go red — see `merge-eval/drill-merge-eval.mjs` and `fleet-eval/drill-a1a2.mjs`.
  A check that can only go green is not a check.
- **No machine-specific facts as defaults.** Anything that varies per machine is a required env
  var that fails loudly when unset; the exemption allowlist belongs in a config file, the shape
  is `fleet-eval/fleet-eval.allow.example.json`.
- **Numbers are not copied around.** Assertion counts, model counts and lift figures live in
  `README.md` and `docs/t2-results.md`, guarded by `guard-readme-numbers.mjs`. Restating one here
  creates a second truth nobody guards.
- **No run output, no machine paths in tracked files.** `out/` and the `%SystemDrive%/` artifact
  are gitignored deliberately.
- **User-facing docs keep their `.zh-CN` sibling** (`README.md`, `docs/`, `CONTRIBUTING.md`):
  edit both or neither. This file is agent-facing and has no mirror on purpose.
- **Before adding a rule or a check, grep the tree for an existing carrier** and link it instead
  of restating it. Duplicate rules diverge.

## 4. How to verify a change

```bash
npm test
node run-checks.mjs
node --test selftest.mjs
node t2/smoke-ab.mjs --dry
node demo/run.mjs --assert
node merge-eval/drill-merge-eval.mjs
node fleet-eval/drill-a1a2.mjs
node guard-readme-numbers.mjs
node scripts/check-agents-doc.mjs
```

`npm test` is `node run-checks.mjs`: the whole zero-API, zero-network sequence in one command,
with an rc ledger per step, fail-closed on the first red.

Against real assets — nothing is checked in for this, so these are the shapes, not samples:

```bash
FLEET_SHARED=/path/to/sharedskills FLEET_SCOPE=core node fleet-eval/fleet-eval.mjs --trials 2
MERGE_REPO=/path/to/repo MERGE_REPO_SLUG=owner/repo MERGE_BASE_REF=<sha> node merge-eval/merge-eval.mjs --require-baseline
```

Use `--require-baseline` whenever merge-eval acts as a gate: without it a missing baseline
reports as passing. `t2/` needs `T2_BASE_URL`, `T2_API_KEY`, `T2_MODEL`; `node t2/smoke-ab.mjs --dry`
needs none of them.

## 5. What an agent must not do unasked

Push, tag, release, publish the GitHub Pages leaderboard at `docs/index.html`, edit
`.github/workflows/ci.yml`, or report any of the above as done without pasting the command
output that proves it. Human-facing process is in `CONTRIBUTING.md`; vulnerabilities go to
`SECURITY.md`, not to an issue.

## 6. Convention this file's own checker relies on

Write a repo path as a directory with a trailing slash (`fleet-eval/`) or as a file with its
extension (`fleet-eval/fleet-eval.mjs`). `scripts/check-agents-doc.mjs` only validates tokens in
those two shapes; anything else (`A/B`, `owner/repo`, `/path/to/repo`) is treated as prose and
left unchecked.
