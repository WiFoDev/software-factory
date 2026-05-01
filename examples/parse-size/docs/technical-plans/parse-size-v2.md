# Technical Plan — parse-size-v2

## 1. Context

The spec at `docs/specs/parse-size-v2.md` is small (~50 LOC implementation, ~50 LOC tests). This plan exists primarily to exercise the v0.0.4 `factory spec review`'s `cross-doc-consistency` judge — it intentionally agrees with the spec on every load-bearing detail (default SI base 1000, IEC base 1024, negative throws, integer return) so the judge has nothing to flag.

The function is a pure parser. No external deps, no I/O, no async. `parseSize(text)` shape:

```ts
export function parseSize(text: string): number;
```

## 2. Architecture

### Algorithm

1. Trim the input. Reject empty (per S-5).
2. Regex-extract `<number>[<whitespace>?<unit>?]`. The number portion accepts digits + optional decimal. Reject if no number matches.
3. Reject negative numbers (per H-1).
4. If unit is absent, return the number rounded to integer (per S-3).
5. Lowercase the unit. Look up in a unit table:
   - SI: `'k'|'kb'` → 1e3, `'m'|'mb'` → 1e6, `'g'|'gb'` → 1e9, `'t'|'tb'` → 1e12.
   - IEC: `'kib'` → 1024, `'mib'` → 1024², `'gib'` → 1024³, `'tib'` → 1024⁴.
6. If unit isn't in the table, throw with a message that names the unit token (per S-4).
7. Multiply, round, return.

### Defaults (must match spec)

- **SI base = 1000** (default for `K`, `M`, `G`, `T`, `KB`, `MB`, `GB`, `TB`).
- **IEC base = 1024** (only when the unit ends in `iB` — `KiB`, `MiB`, `GiB`, `TiB`).
- **Negative input throws** (not silent). Pinned by H-1.
- **Integer return** via `Math.round` on the multiplied result.

### Error surface

Single error type: `Error` (not a custom class). Messages include enough context for a developer to fix without re-reading the spec:

- Empty input: `"parseSize: empty input"`.
- Unrecognized unit: `"parseSize: unrecognized unit '<token>' (expected one of: K, KB, KiB, M, MB, MiB, ...)"`.
- Negative: `"parseSize: negative byte count not allowed"`.
- No leading number: `"parseSize: could not parse a number from '<input>'"`.

### Public API

One named export:

```ts
export function parseSize(text: string): number;
```

No new types, no helper exports. `src/parse-size.ts` is self-contained.

## 3. Risks

- **SI/IEC ambiguity** — common pitfall: `"KB"` users sometimes mean 1024. We pick SI explicitly (matching the spec's S-1 expectation `1.5 KB → 1500`). H-2 pins the discrimination so the judge catches accidental conflation.
- **Locale numbers** — `"1,5 KB"` (comma decimal) is not supported. Consistent with how Node parses numbers; flagged in the README's tips section, not in the spec.
- **Floating-point drift** — `1.5 * 1e9` is exact in IEEE 754; large multiplications (`3.5 GiB`) round cleanly to integers within Number.MAX_SAFE_INTEGER. No BigInt needed at this scale.

## 4. Subtask Outline

Single subtask (the spec's T1):

- **T1** [feature] — `src/parse-size.ts` (~50 LOC) exporting `parseSize(text: string): number` per the algorithm above. `src/parse-size.test.ts` (~50 LOC) with `bun test` covering S-1..S-6 + H-1, H-2.
