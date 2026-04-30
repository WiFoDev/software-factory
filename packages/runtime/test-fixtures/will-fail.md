---
id: runtime-smoke-will-fail
classification: light
type: feat
status: ready
---

# runtime-smoke-will-fail — Runnable spec exercising the no-converge path

## Intent

A self-contained spec whose `test:` line references a sibling trivial failing test. `factory-runtime run --no-judge --max-iterations 2` against this file is expected to exit 1 (no-converge) after 2 iterations.

## Scenarios

**S-1** — trivial test fails
  Given the trivial-fail.test.ts fixture
  When the harness runs the test satisfaction
  Then the test fails
  Satisfaction:
    - test: trivial-fail.test.ts "trivial fails"

## Definition of Done

- the scenario fails (used to drive iteration)
