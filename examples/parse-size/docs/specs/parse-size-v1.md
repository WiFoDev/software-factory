---
id: parse-size-v1
classification: light
type: feat
status: drafting
exemplars:
  - path: src/parse-size.ts
    why: "the helper to implement"
---

# parse-size-v1 — Add a parseSize(text) helper

## Intent

Add a `parseSize(text)` helper that parses human-readable size strings (`"1.5 KB"`, `"42M"`, `"3.5 GiB"`) into a number of bytes. Used by config loaders that accept human-friendly thresholds.

## Scenarios

**S-1** — basic SI unit parsing
  Given the input `"1.5 KB"`
  When `parseSize` is called
  Then the result matches the expected byte count
  Satisfaction:
    - test: src/parse-size.test.ts "basic SI parsing"

**S-2** — IEC unit parsing
  Given the input `"3.5 GiB"`
  When `parseSize` is called
  Then the output validates against the IEC convention
  Satisfaction:
    - test: src/parse-size.test.ts "iec parsing"

**S-3** — bare numeric input
  Given the input `"1024"`
  When `parseSize` is called
  Then the result is `1024`
  Satisfaction:
    - test: src/parse-size.test.ts "bare numeric"

**S-4** — error: malformed input throws
  Given the input `"not a size"`
  When `parseSize` is called
  Then it throws an error
  Satisfaction:
    - test: src/parse-size.test.ts "malformed throws"
    - judge: "the error message tells a developer specifically which character or token failed to parse, not just 'invalid input'"

**S-5** — error: empty string throws
  Given the input `""`
  When `parseSize` is called
  Then it throws
  Satisfaction:
    - test: src/parse-size.test.ts "empty throws"

## Holdout Scenarios

**H-1** — basic SI unit parsing variant
  Given the input `"2 MB"`
  When `parseSize` is called
  Then the result matches the expected byte count

**H-2** — leap year date arithmetic
  Given a date in February
  When the year is divisible by 4
  Then leap-year math applies

## Constraints / Decisions

- Pure function. No I/O. No external deps.
- Case-insensitive unit suffix matching.
- Uses zod for input validation.

## Subtasks

- T1 [feature] — implement `parseSize(text)` and the test file. ~80 LOC.

## Definition of Done

- All scenarios pass.
- The parser matches the expected format.
- Output validates against the schema.
