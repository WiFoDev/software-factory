---
id: runtime-smoke-needs-iter2
classification: light
type: feat
status: ready
---

# runtime-smoke-needs-iter2 — Runnable spec for the v0.0.3 multi-iteration integration test

## Intent

A self-contained spec whose iter-1 fake-claude writes a stub that fails the validate test, and iter-2 fake-claude writes the satisfying impl. Used by the v0.0.3 integration test to prove `iterationCount > 1` and the cross-iteration record threading deterministically — without needing real `claude`.

## Scenarios

**S-1** — `iter2()` returns 42
  Given the needs-iter2.test.ts fixture
  When the harness runs the test satisfaction
  Then the test passes (which requires `src/needs-iter2.ts` to export `iter2(): 42`)
  Satisfaction:
    - test: needs-iter2.test.ts "iter2 returns 42"

## Definition of Done

- the scenario passes after at least one re-iteration of implement
