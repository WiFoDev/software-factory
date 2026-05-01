---
id: parity-asymmetric
classification: light
type: feat
status: ready
---

## Intent

Add an error-prone helper.

## Scenarios

**S-1** — error UX: empty input
  Given an empty string
  When the helper is called
  Then it throws with a clear message
  Satisfaction:
    - test: `src/helper.test.ts` "empty input throws"
    - judge: "the error message tells the developer what went wrong without referencing internal state"

**S-2** — error UX: malformed input
  Given a malformed string
  When the helper is called
  Then it throws
  Satisfaction:
    - test: `src/helper.test.ts` "malformed input throws"

## Constraints / Decisions

- Throws on bad input.

## Definition of Done

- All scenarios pass.
