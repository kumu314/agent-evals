# Contributing

English | [中文](CONTRIBUTING.zh-CN.md)

Single-maintainer project (used daily by the author and their local agents). What helps most, ranked:

## Welcome: issue reports

Please open an issue directly — especially these two kinds (the repo has templates for both):

- **Criterion false-positive / false-negative**: this repo's culture is "when you see red, suspect the criterion first". If an assertion wrongly flagged you, or you know something is broken yet it stayed green, that is worth far more than a feature request. Include: the suite and assertion id, your environment variables (redacted), expected-red vs actual-red (or the reverse), and the reproduction command's output.
- **Portability blocker**: fleet-eval's defaults are the author's own machine facts (paths, exemption allowlist); it is expected that they will not run out-of-the-box on your machine. But please write down where it got stuck and how you worked around it — that is direct evidence for a decoupling need.

## Deferred: PRs

For PRs that change the model (`*.mjs`), open an issue to discuss first and reach agreement before coding. This is not a gate — a one-person project simply has no review bandwidth, and an un-discussed PR will most likely rot unmerged, a loss for both sides. Documentation fixes (typos, dead links) can be submitted directly without an issue.

## Conventions

- Commit messages follow the existing style: `suite/type: one line saying what changed`. (Current history is in Chinese; an English line that is equally clear is fine too.)
- Any change to criterion semantics must also update that suite's negative verification (fleet-eval's drill or an equivalent failing counter-example), proving the new assertion really goes red — we do not accept a check that can only go green.
