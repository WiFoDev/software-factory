---
id: good-spec
classification: light
type: feat
status: ready
exemplars:
  - path: src/foo.ts
    why: "shape to mirror"
---

# good-spec — a deliberately well-formed spec

## Intent

Add a `slugify(text)` helper that lowercases input, replaces non-alphanumerics with dashes, and collapses runs of dashes into one.

## Scenarios

**S-1** — basic happy path
  Given the input `"Hello World!"`
  When `slugify` is called
  Then the result is strictly equal to `"hello-world"`
  Satisfaction:
    - test: `src/slugify.test.ts` "basic happy path"

**S-2** — collapses dashes
  Given the input `"a---b"`
  When `slugify` is called
  Then the result is strictly equal to `"a-b"`
  Satisfaction:
    - test: `src/slugify.test.ts` "collapses runs"

## Constraints / Decisions

- Pure function. No I/O. No external deps.

## Subtasks

- T1 [feature] — implement `slugify(text)` with the two transforms. ~30 LOC including tests.

## Definition of Done

- All scenarios pass (`bun test src` exit code 0).
- Exported from `src/index.ts` as a named export.
