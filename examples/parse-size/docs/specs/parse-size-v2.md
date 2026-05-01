---
id: parse-size-v2
classification: light
type: feat
status: ready
exemplars:
  - path: src/parse-size.ts
    why: "the helper to implement"
  - path: ../../packages/spec-review/test-fixtures/good-spec.md
    why: "v0.0.4 reference for spec quality — every constraint declared, every DoD check uses an explicit operator"
---

# parse-size-v2 — Add a parseSize(text) helper

## Intent

Add a `parseSize(text)` helper that parses human-readable size strings into a number of bytes. Supports SI suffixes (`K`, `M`, `G`, `T`) interpreted as 1000-base, IEC suffixes (`KiB`, `MiB`, `GiB`, `TiB`) as 1024-base, and bare numeric input as raw bytes. Case-insensitive. Used by config loaders that accept human-friendly thresholds.

## Scenarios

**S-1** — SI unit parsing: `"1.5 KB"` is strictly equal to `1500`
  Given the input `"1.5 KB"`
  When `parseSize` is called
  Then the result is strictly equal to `1500` (number)
  Satisfaction:
    - test: src/parse-size.test.ts "SI parsing: 1.5 KB → 1500"

**S-2** — IEC unit parsing: `"3.5 GiB"` is strictly equal to `3758096384` (3.5 × 1024³)
  Given the input `"3.5 GiB"`
  When `parseSize` is called
  Then the result is strictly equal to `3758096384`
  Satisfaction:
    - test: src/parse-size.test.ts "IEC parsing: 3.5 GiB → 3758096384"

**S-3** — bare numeric input is interpreted as raw bytes
  Given the input `"1024"`
  When `parseSize` is called
  Then the result is strictly equal to `1024`
  Satisfaction:
    - test: src/parse-size.test.ts "bare numeric: 1024 → 1024"

**S-4** — error: malformed input throws with a token-specific message
  Given the input `"42 zorp"`
  When `parseSize` is called
  Then it throws an `Error` whose message contains the unrecognized unit token (`"zorp"`)
  Satisfaction:
    - test: src/parse-size.test.ts "malformed throws with token in message"
    - judge: "the error message names the specific unit token that failed to parse, not just 'invalid input'"

**S-5** — error: empty string throws with a clear message
  Given the input `""`
  When `parseSize` is called
  Then it throws an `Error` whose message contains the substring `"empty"` (case-insensitive)
  Satisfaction:
    - test: src/parse-size.test.ts "empty throws with empty in message"
    - judge: "the error message clearly tells the developer that the input was empty, not a generic parse error"

**S-6** — case-insensitive unit suffix matching
  Given the inputs `"1kb"`, `"1KB"`, `"1 Kb"` (three case variants)
  When `parseSize` is called on each
  Then all three return strictly equal `1000`
  Satisfaction:
    - test: src/parse-size.test.ts "case-insensitive units"

## Holdout Scenarios

**H-1** — negative bare numeric input throws (sign sanity)
  Given the input `"-5"`
  When `parseSize` is called
  Then it throws (we don't accept negative byte counts)

**H-2** — SI vs IEC discrimination: same prefix letter, different base
  Given two inputs `"1 KB"` and `"1 KiB"`
  When `parseSize` is called on each
  Then the SI result is `1000` and the IEC result is `1024` — they MUST NOT collapse to the same number

## Constraints / Decisions

- Pure function. No I/O. No external deps. No dependencies declared in package.json beyond what's already present.
- Case-insensitive unit suffix matching (S-6 pins this).
- SI suffixes (`K`, `M`, `G`, `T`, `KB`, `MB`, `GB`, `TB`) use base 1000.
- IEC suffixes (`KiB`, `MiB`, `GiB`, `TiB`) use base 1024.
- Bare numeric input is interpreted as raw bytes (S-3).
- Negative numeric input throws (pinned by H-1).
- Whitespace between number and unit is optional.
- Returns an integer (`Math.round` applied to fractional results).

## Subtasks

- T1 [feature] — implement `parseSize(text)` in `src/parse-size.ts` (~50 LOC) + the test file (~50 LOC) covering S-1..S-6 + H-1, H-2.

## Definition of Done

- All scenarios (S-1..S-6) pass: `bun test src` exits with code 0.
- All holdouts (H-1, H-2) pass at end-of-task review.
- The function is exported as a named export from `src/parse-size.ts`.
- `parseSize("0")` returns strictly equal `0` (boundary).
- `parseSize("1 KB")` returns strictly equal `1000` (SI default for plain `KB`).
- `parseSize("1 KiB")` returns strictly equal `1024` (IEC).
- `parseSize` throws (not returns NaN) for any input the parser cannot resolve to a non-negative integer.
