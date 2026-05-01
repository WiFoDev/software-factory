---
id: cross-doc-mismatched
classification: deep
type: feat
status: ready
---

## Intent

Add a feature with a default-value of `5`.

## Scenarios

**S-1** — default value
  Given no override
  When the feature runs
  Then the value is `5`
  Satisfaction:
    - test: `src/foo.test.ts` "default value is 5"

## Constraints / Decisions

- Default value is `5`. Range `1..10`.

## Definition of Done

- All tests pass with default 5.
