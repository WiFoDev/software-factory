# Spec Template

The canonical shape of a single spec file. One spec per file, written to `docs/specs/<id>.md`. Mirrors the format produced by the `/scope-task` slash command.

Filename convention: `<id>.md` for the spec, `<id>.technical-plan.md` for the optional technical plan. Active specs live directly in `docs/specs/`; finished specs are moved to `docs/specs/done/` to preserve history without cluttering the active list.

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
- All scenarios pass (tests green + judge criteria met)
- typecheck + lint + tests green
- <project-specific gates if any>
```

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
