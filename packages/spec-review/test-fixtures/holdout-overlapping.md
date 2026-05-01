---
id: holdout-overlapping
classification: deep
type: feat
status: ready
---

## Intent

Add a normalizer.

## Scenarios

**S-1** — basic input
  Given the input "Hello"
  When normalize is called
  Then the output is "hello"
  Satisfaction:
    - test: `src/normalize.test.ts` "basic"

## Holdout Scenarios

**H-1** — basic input variant
  Given the input "World"
  When normalize is called
  Then the output is "world"

## Constraints / Decisions

- Lowercases input.

## Definition of Done

- All scenarios pass.
