---
id: harness-smoke-all-pass
classification: light
type: feat
status: ready
---

# harness-smoke-all-pass — Runnable spec used by the harness DoD smoke test

## Intent

A self-contained spec whose `test:` lines reference sibling fixture files. `factory-harness run` against this file is expected to exit 0 with `--no-judge`. `test:` paths are relative to the directory of this spec.

## Scenarios

**S-1** — passing tests in passing.test.ts
  Given a fixture file with two passing tests
  When the harness runs the test satisfaction
  Then both tests pass
  Satisfaction:
    - test: passing.test.ts

**S-2** — pattern-filtered passing tests
  Given the harness filters by test name
  When `bun test -t "passing-arithmetic"` runs against passing.test.ts
  Then exactly one test passes
  Satisfaction:
    - test: passing.test.ts "passing-arithmetic"

## Definition of Done

- both scenarios pass
