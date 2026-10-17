# demo — see it go red / green in 30 seconds

English | [中文](README.zh-CN.md)

`fleet-eval` normally has to point at your own skill library to run. This directory ships its own minimal sample skill library, so you can **see it work with zero configuration**:

```bash
node demo/run.mjs
```

It runs the same set of assertions twice: `fixture-broken/skills/` deliberately leaves 4 defects, `fixture-clean/skills/` is the same set of skills with the defects fixed. Output (the fenced block below is the tool's literal captured output — the banner is printed by the program):

```text
The same suite: first see it catch a broken skill library, then see the fixed one go all green.

============================================================
 1/2  fixture-broken (deliberately leaves 4 defects) — expected to go red
============================================================

fleet-eval — 本机 agent 资产舰队回归套件 (source: demo/fixture-broken/skills, 5 skills, 0 endpoints)
------------------------------------------------------------------------------
[PASS] scan.sanity                    {"skills":5} (1ms)
[FAIL] frontmatter.valid              {"parsed":5,"bad":1} (6ms)
       ↳ delta: description 空
[FAIL] frontmatter.name-matches-dir   {"mismatch":2} (4ms)
       ↳ epsilon != alpha | gamma != gamma-typo
[FAIL] frontmatter.name-unique        {"dup":1} (4ms)
       ↳ alpha (alpha, epsilon)
[FAIL] junk.absent                    {"junk":1,"allowed":0} (5ms)
       ↳ beta/cache.bak
------------------------------------------------------------------------------
pass_rate = 20.0%  (1/5)

=> exit code 1 (non-zero = some item failed; CI uses this to block the change)

============================================================
 2/2  fixture-clean (the 4 above fixed) — expected all green
============================================================

fleet-eval — 本机 agent 资产舰队回归套件 (source: demo/fixture-clean/skills, 5 skills, 0 endpoints)
------------------------------------------------------------------------------
[PASS] scan.sanity                    {"skills":5} (0ms)
[PASS] frontmatter.valid              {"parsed":5,"bad":0} (18ms)
[PASS] frontmatter.name-matches-dir   {"mismatch":0} (9ms)
[PASS] frontmatter.name-unique        {"dup":0} (6ms)
[PASS] junk.absent                    {"junk":0,"allowed":0} (10ms)
------------------------------------------------------------------------------
pass_rate = 100.0%  (5/5)

=> exit code 0 (0 = all green)
```

`--assert` only verifies without printing the full text; CI uses it to keep the sample from rotting:

```bash
node demo/run.mjs --assert
```

## What the two fixtures differ by

| location | fixture-broken | check it trips |
|---|---|---|
| `skills/gamma/SKILL.md` | `name: gamma-typo` (inconsistent with the directory name) | `frontmatter.name-matches-dir` |
| `skills/delta/SKILL.md` | missing `description` | `frontmatter.valid` |
| `skills/epsilon/SKILL.md` | `name: alpha` (collides with alpha) | `frontmatter.name-unique` (also incidentally hits name-matches-dir) |
| `skills/beta/cache.bak` | a stray backup file | `junk.absent` |

demo runs only these 5 "layout-independent" assertions, so it doesn't depend on the endpoint layout in `sync.ps1`. The full 11 require pointing at a real skill library; see [../fleet-eval/README.md](../fleet-eval/README.md).
