---
id: example-greet
classification: light
type: feat
status: ready
exemplars:
  - path: docs/SPEC_TEMPLATE.md
    why: Canonical shape — frontmatter fields and required body sections.
---

# example-greet — Add a `greet(name)` helper that returns a localized hello string

## Intent

A worked example of a minimal valid spec. Used as a canonical fixture for `factory spec lint`. Demonstrates frontmatter, a single Given/When/Then scenario with a `test:` satisfaction line, an optional `judge:` line, constraints, subtasks, and a Definition of Done.

## Scenarios

**S-1** — greet returns a hello string in the requested locale
  Given the user's locale is `es-PE`
  When `greet('Luis')` is called
  Then the return value contains both the name and a Spanish greeting word
  Satisfaction:
    - test: src/greet.test.ts "es-PE returns Spanish greeting"
    - judge: "the greeting reads naturally to a native speaker, not a literal translation"

**S-2** — unknown locale falls back to English
  Given the user's locale is `xx-YY`
  When `greet('Luis')` is called
  Then the return value uses the English greeting
  Satisfaction:
    - test: src/greet.test.ts "unknown locale falls back to en"

## Constraints / Decisions

- Supported locales for v1: `en-US`, `es-PE`. Others fall back to `en-US`.
- No external i18n library; a small literal map is sufficient for two locales.

## Subtasks

- **T1** [feature] — Implement `greet(name, locale?)` with the locale map. ~30 LOC.
- **T2** [test] — Unit tests covering S-1 and S-2. **depends on T1**. ~40 LOC.

## Definition of Done

- All scenarios pass (tests green; judge criterion met by manual review).
- typecheck + lint + tests green.
