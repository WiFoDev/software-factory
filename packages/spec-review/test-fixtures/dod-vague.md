---
id: dod-vague
classification: light
type: feat
status: ready
---

## Intent

Add a parser.

## Scenarios

**S-1** — happy path
  Given valid input
  When parser runs
  Then output is correct
  Satisfaction:
    - test: `src/parser.test.ts` "happy"

## Constraints / Decisions

- Pure function.

## Definition of Done

- The parser matches the schema.
- Output validates against the spec.
- Behavior is correct.
