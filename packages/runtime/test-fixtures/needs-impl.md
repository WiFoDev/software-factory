---
id: runtime-smoke-needs-impl
classification: light
type: feat
status: ready
---

# runtime-smoke-needs-impl — Runnable spec for the v0.0.2 implementPhase smoke test

## Intent

A self-contained spec whose `test:` line references a sibling test that imports `src/needs-impl.ts`. The fake `claude` binary in `success` mode writes that file with content that satisfies the test, so `factory-runtime run` against this file (with `--no-judge` and `--claude-bin <fake>`) is expected to exit 0 and converge in 1 iteration through the `[implement → validate]` graph.

## Scenarios

**S-1** — `impl()` returns 42
  Given the needs-impl.test.ts fixture
  When the harness runs the test satisfaction
  Then the test passes (which requires `src/needs-impl.ts` to export `impl(): 42`)
  Satisfaction:
    - test: needs-impl.test.ts "impl returns 42"

## Definition of Done

- the scenario passes
