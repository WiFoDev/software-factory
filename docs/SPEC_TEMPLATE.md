# Spec Template

> **For AI agents:** start at **[`AGENTS.md`](../AGENTS.md)** (top-level) for the canonical workflow. This file is a reference for the spec format itself.

The canonical shape of a single spec file. One spec per file, written to `docs/specs/<id>.md`. Mirrors the format produced by the `/scope-task` slash command.

Filename convention (parallel-tree, since v0.0.3): the spec lives at `docs/specs/<id>.md` and its optional technical plan at `docs/technical-plans/<id>.md`. The rationale: specs and technical plans live in parallel directories so `factory spec lint docs/specs/` recurses without tripping over technical plans.

Lifecycle: active specs live directly in `docs/specs/`; once shipped, the spec moves to `docs/specs/done/<id>.md` and the paired technical plan moves to `docs/technical-plans/done/<id>.md`. The two trees move in lockstep, preserving history without cluttering the active list.

## Skeleton

```markdown
---
id: <ticket-or-slug>
classification: light | deep
type: feat | fix | refactor | chore | perf
status: ready | drafting | blocked
exemplars:
  - path: <relative/path/to/file>
    why: <one line — what to copy or learn from this file>
---

# <id> — <one-line intent>

## Intent
<what we're doing and why, 2-4 sentences>

## Scenarios
**S-1** — <short name>
  Given <state>
  When <action>
  Then <observable outcome>
  Satisfaction:
    - test: <test path, name, or pattern>
    - judge: "<fuzzy criterion an LLM-as-judge can score>"   # optional

**S-2** — ...

## Constraints / Decisions
- <confirmed decision>

## Open Questions
- <only if any decisions are still pending; otherwise omit>

## Subtasks
<ordered list with explicit dependencies>

## Definition of Done
- All scenarios pass (judge criteria met)
- typecheck clean (`pnpm typecheck`)
- tests green (`pnpm test`)
- biome clean (`pnpm check`)
- <project-specific gates if any>
```

Each runtime-gate bullet MUST embed a backtick-wrapped shell command. The runtime extracts the literal command and shells it out via Bash; bullets without a backtick command are skipped (rather than guessed at). The lint code `spec/dod-needs-explicit-command` flags gate-shaped prose missing a literal command. Worked examples:

- `typecheck clean (\`pnpm typecheck\`)`
- `tests green (\`pnpm test\`)`
- `biome clean (\`pnpm check\`)`

## Notes on fields

- **`exemplars`** — pinned files the implementer should mirror. Optional but high-leverage when relevant. Empty list is fine.
- **Scenarios** — Given/When/Then. At least one `test:` per scenario. `judge:` is for fuzzy criteria (log clarity, error message UX, naming) that unit tests can't capture.
- **Holdout Scenarios** *(deep tasks)* — same shape as Scenarios, in their own `## Holdout Scenarios` section. NOT shared with the implementing agent during iteration; checked at the end to catch overfit.
- **Constraints** — confirmed decisions only. Open issues belong under `## Open Questions`.
- **Subtasks** — small enough for one agent session; tag type (`config`, `feature`, `bug-fix`, `refactor`, `test`); declare deps explicitly (`T3 depends on T1`).

## Tiers (informal)

| Tier | Required fields | When |
|---|---|---|
| **Sketch** (light) | intent + 1+ scenarios + DoD | solo work, small features, quick fixes |
| **Spec** (deep, no holdouts) | + constraints + exemplars + subtasks + deps | team work, cross-cutting changes |
| **Autonomy-ready** (deep + holdouts + judges) | + holdout scenarios + judge satisfaction lines | tasks eligible for unattended agent runs |

The factory tooling reads whatever tier is present. Missing fields disable features but never block work.

## Validating the spec

Two checks should run before you spend agent tokens implementing the spec:

- `factory spec lint docs/specs/<id>.md` — the **format** check. Fast, free, deterministic. Verifies frontmatter shape, required sections, satisfaction-line syntax, and id/filename agreement. Run on every save (a Claude Code `PostToolUse` hook recipe lives in `packages/core/README.md`). Lint is the floor: a spec must lint clean before it is worth reviewing.
- `factory spec review docs/specs/<id>.md` — the **quality** check. LLM-judged, billed against your subscription. Runs five judges (`internal-consistency`, `judge-parity`, `dod-precision`, `holdout-distinctness`, `cross-doc-consistency`) against the spec and its paired technical-plan. Catches vague DoD checks, asymmetric satisfactions, and holdouts that paraphrase visible scenarios — issues lint cannot see. Cache-backed, so re-running on an unchanged spec is free.

Run lint first; if lint passes, run review. Both emit findings in the same `${file}:${line}  ${sev}  ${code}  ${message}` format; the review namespace is `review/...`, the lint namespace is `spec/...`.
