---
id: slugify-v0-0-1
classification: light
type: feat
status: ready
exemplars: []
---

# slugify-v0-0-1 — Add a `slugify(text)` helper

## Intent

Provide a single pure helper `slugify(text: string): string` that lowercases the input, replaces every run of non-alphanumeric characters with a single dash, and trims leading/trailing dashes. This is the first real implementation in `examples/slugify` and is the canonical task the software-factory loop is demonstrated against (scope → run (red) → implement → run (green)).

## Scenarios

**S-1** — basic phrase becomes a hyphenated slug
  Given the input `"Hello World"`
  When `slugify(input)` is called
  Then the return value is `"hello-world"`
  Satisfaction:
    - test: src/slugify.test.ts "lowercases and joins words with a single dash"

**S-2** — runs of non-alphanumerics collapse to one dash
  Given the input `"Foo!!!  @@@  Bar"`
  When `slugify(input)` is called
  Then the return value is `"foo-bar"` (one dash, not three; punctuation and whitespace both count as non-alphanumeric)
  Satisfaction:
    - test: src/slugify.test.ts "collapses any run of non-alphanumerics to a single dash"

**S-3** — leading/trailing non-alphanumerics do not leak into the slug
  Given the input `"  --Hello, World!--  "`
  When `slugify(input)` is called
  Then the return value is `"hello-world"` (no leading or trailing dash)
  Satisfaction:
    - test: src/slugify.test.ts "trims leading and trailing dashes"

**S-4** — digits are preserved, alphanumeric definition is `[a-z0-9]`
  Given the input `"Test Case 42!"`
  When `slugify(input)` is called
  Then the return value is `"test-case-42"`
  Satisfaction:
    - test: src/slugify.test.ts "preserves digits"

**S-5** — degenerate inputs return an empty string
  Given the input `""` or `"!!!"` (no alphanumeric content)
  When `slugify(input)` is called
  Then the return value is `""`
  Satisfaction:
    - test: src/slugify.test.ts "returns empty string when input has no alphanumerics"

## Constraints / Decisions

- Public API: `export function slugify(text: string): string` from `src/slugify.ts`. No options object, no second argument.
- "Alphanumeric" is ASCII only: `[a-z0-9]` after lowercasing. Unicode letters (e.g. `é`, `ü`, `ñ`) count as non-alphanumeric and are replaced with a dash. This is the simplest correct behaviour for the example; a Unicode-aware variant is out of scope for v0.0.1.
- Leading and trailing dashes are trimmed. The rule "collapse runs of dashes" plus "trim ends" together guarantee no slug ever starts or ends with `-`.
- Implementation is a pure function: no I/O, no throws, no globals. `null`/`undefined` inputs are out of scope — the type signature forbids them and we trust the type system at the boundary.
- Tests are written FIRST in `src/slugify.test.ts` using `bun:test` (`import { describe, test, expect } from "bun:test"`) so `bun test src` exercises them. T1 must produce a failing run; T2 makes it green.
- No new dependencies. Implementation should be ~5 lines using `String.prototype.toLowerCase` and two regex passes (or one combined regex).

## Subtasks

- **T1** [test] — Create `src/slugify.test.ts` covering S-1..S-5 with `bun:test`. The file imports `slugify` from `./slugify`; running `bun test src` at this point fails with a module-not-found / not-implemented error, which is the expected red state for the factory-runtime first run. ~30 LOC.
- **T2** [feature] — Create `src/slugify.ts` exporting `slugify(text: string): string`. Lowercase, replace `/[^a-z0-9]+/g` with `-`, then strip leading/trailing dashes. **Depends on T1.** ~5 LOC.

## Definition of Done

- All scenarios (S-1..S-5) pass via `bun test src`.
- `pnpm exec factory spec lint docs/specs/` reports `OK`.
- `pnpm exec factory-runtime run docs/specs/slugify-v0-0-1.md --no-judge --context-dir ./.factory` converges (exit 0) after the implementation lands.
- `src/slugify.ts` is a pure function with no new dependencies.
