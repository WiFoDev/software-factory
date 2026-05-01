---
id: inconsistent-deps
classification: light
type: feat
status: ready
---

## Intent

Add a thing that uses zod for validation.

## Constraints / Decisions

- Uses zod for input validation.
- Uses ajv for output schema enforcement.

## Scenarios

**S-1** — valid input
  Given valid input
  When the thing runs
  Then exit code 0
  Satisfaction:
    - test: `src/thing.test.ts` "valid input"

## Subtasks

- T1 [feature] — implement the thing. (No mention of zod, ajv, or validation libs in subtasks.)

## Definition of Done

- All tests pass.
