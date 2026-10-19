## What & why

<!-- One or two sentences: what does this change, and which red line / criterion does it protect? -->

## Type of change

- [ ] New assertion / suite change
- [ ] Criterion fix (a grader that was judging the wrong thing)
- [ ] Docs only
- [ ] Other

## Evidence (this repo is evidence-first)

- [ ] `npm test` passes locally (paste the `pass_rate` line)
- [ ] For a grader change: a negative drill case proves it can still fail (fail-closed)
- [ ] For a t2 criterion change: `--dry` still separates the two arms, and a deliberately-wrong reference string stays unmatched
- [ ] Every number was produced by a run, not typed from memory

## Notes for the reviewer

<!-- Anything that should be suspected first if this goes red later. -->
