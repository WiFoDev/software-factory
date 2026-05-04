---
id: ci-publish-v0-0-11
classification: light
type: chore
status: ready
exemplars:
  - path: package.json
    why: "Top-level release script (line ~16): `pnpm typecheck && pnpm test && pnpm check && pnpm -r build && pnpm publish -r --access public`. v0.0.11 keeps this exact pipeline as a manual fallback; the GitHub Actions workflow runs the same gates with one extra flag (`--no-git-checks`) for the publish step."
  - path: docs/specs/done/factory-core-v0-0-5-1.md
    why: "Reference shape: a chore spec adding workflow infrastructure without changing any package source. Same pattern: new file + tests + README touch."
depends-on: []
---

# ci-publish-v0-0-11 — tag-driven GitHub Actions publish workflow

## Intent

Promote the manual `pnpm release` flow to a tag-driven GitHub Actions workflow so v0.0.X releases publish without a maintainer-on-laptop bottleneck. Triggered by pushing a tag matching `v[0-9]+.[0-9]+.[0-9]+`. Workflow runs the existing `pnpm release` gates (typecheck → test → check → build) and publishes via `pnpm publish -r --access public --no-git-checks` using `NPM_TOKEN` from GitHub secrets (npm automation token, NOT TOTP-required).

The manual `pnpm release` flow stays as a fallback (top-level package.json's `release` script unchanged). RELEASING.md documents both paths and the secret-setup steps.

## Scenarios

**S-1** — `.github/workflows/publish.yml` exists with the canonical structure
  Given the v0.0.11 build
  When `.github/workflows/publish.yml` is read
  Then it exists; YAML-parses; declares `on.push.tags` matching the regex pattern `'v[0-9]+.[0-9]+.[0-9]+'`; declares one job named `publish`; the job's `runs-on` is `ubuntu-latest`; the job has these steps in order: checkout (`actions/checkout@v4` or later), setup-pnpm, setup-node, install (`pnpm install --frozen-lockfile`), typecheck (`pnpm typecheck`), test (`pnpm test`), check (`pnpm check`), build (`pnpm -r build`), publish (`pnpm publish -r --access public --no-git-checks`); the publish step's `env` includes `NPM_TOKEN: ${{ secrets.NPM_TOKEN }}`; the workflow has `permissions: { contents: read, id-token: write }` (id-token for npm provenance).
  Satisfaction:
    - test: packages/core/src/ci-publish.test.ts ".github/workflows/publish.yml exists with the canonical structure"
    - test: packages/core/src/ci-publish.test.ts "publish workflow declares NPM_TOKEN secret + id-token permission"

**S-2** — Top-level `pnpm release` script preserved as manual fallback; `RELEASING.md` documents both paths
  Given the v0.0.11 top-level `package.json`
  When the `release` script is read
  Then it is byte-identical to v0.0.10's value: `pnpm typecheck && pnpm test && pnpm check && pnpm -r build && pnpm publish -r --access public`. Manual maintainer-driven publishing still works.
  And given a new file `RELEASING.md` at the repo root, it documents: (a) the canonical CI flow (push a `vX.Y.Z` tag → workflow runs); (b) the secret-setup steps (`gh secret set NPM_TOKEN -b "npm_..."`); (c) the manual fallback (`pnpm release` from a maintainer's machine with npm OTP); (d) the post-publish steps (verify packages on npm registry; create the GitHub release entry from the tag).
  Satisfaction:
    - test: packages/core/src/ci-publish.test.ts "top-level package.json release script unchanged from v0.0.10"
    - test: packages/core/src/ci-publish.test.ts "RELEASING.md exists at repo root with canonical sections"

**S-3** — Workflow gates fire in the correct order; failure of any gate prevents publish
  Given the workflow YAML
  When the steps are inspected
  Then the publish step's `if` condition (or `needs` chain) ensures publish runs ONLY when all preceding gates succeed (default GitHub Actions behavior — any failed step short-circuits the rest of the job). The `pnpm publish -r --access public --no-git-checks` invocation matches the exact flag set: `-r` (recursive), `--access public`, `--no-git-checks` (skip git-uncommitted check; the workflow's `actions/checkout@v4` ensures clean state).
  And given the workflow uses `--no-git-checks`, RELEASING.md notes this explicitly so maintainers reading the workflow know why this flag is present (it's safe in CI; not recommended for manual runs where unstaged changes are easier to forget about).
  Satisfaction:
    - test: packages/core/src/ci-publish.test.ts "workflow uses --no-git-checks flag"
    - test: packages/core/src/ci-publish.test.ts "RELEASING.md documents --no-git-checks rationale"

## Constraints / Decisions

- **Workflow file path (locked):** `.github/workflows/publish.yml`. Conventional location; no overrides.
- **Trigger (locked):** `on.push.tags: 'v[0-9]+.[0-9]+.[0-9]+'`. Single-quoted in YAML (escapes the `*` glob meta semantics; the GitHub Actions tag glob uses `*` differently than expected — explicit regex form is more robust).
- **Branch protection note:** the workflow does NOT trigger on push to main; only on tag push. v0.0.11 explicitly does NOT add a "create-tag-on-merge" automation — tag creation stays maintainer-driven (so the maintainer reviews tags before they ship).
- **Steps + their order (locked):** checkout → setup-pnpm (`pnpm/action-setup@v4` or later) → setup-node (`actions/setup-node@v4`, with `node-version: 22`) → install (`pnpm install --frozen-lockfile`) → typecheck → test → check → build → publish. Failures of any step short-circuit the workflow (default GitHub Actions semantics).
- **Permissions (locked):** `permissions: { contents: read, id-token: write }`. `contents: read` is the minimum required for `actions/checkout` on a public repo; `id-token: write` enables npm provenance attestations (npm CLI auto-detects the OIDC token in the GitHub Actions env when present, attaches a provenance signature to the published packages).
- **Secret name (locked):** `NPM_TOKEN`. GitHub repo secret. Must be an **automation** token (granted publish access; not requiring TOTP for each publish). Generated via `npm token create --type=automation` from a maintainer's account.
- **`--no-git-checks` (locked):** present in the CI publish; ABSENT in the manual `pnpm release` script (manual publishing should keep the safety check). RELEASING.md explains the rationale.
- **`RELEASING.md` location (locked):** repo root. Mirrors `CHANGELOG.md` / `ROADMAP.md` / `BACKLOG.md` / `BASELINE.md` siblings.
- **The workflow is opt-in for the maintainer to use.** v0.0.11 ships the file; the maintainer must set the secret + push a tag for the first run. v0.0.11's own publish goes via the existing manual `pnpm release` flow (the workflow can't publish itself the first time).
- **Public API surface from every `@wifo/factory-*` package strictly equal to v0.0.10's surface** (zero new exports — this spec is pure infrastructure).
- **Coordinated package version bump deferred to spec 6** (`worktree-sandbox-v0-0-11`'s chore subtask).
- **Tests use bare paths in `test:` lines (no backticks).**
- **v0.0.11 explicitly does NOT ship in this spec:** matrix CI (Node version, OS) — single Node 22 + ubuntu-latest is enough for now; auto-tag on merge to main; release-notes generation from CHANGELOG.md; signed-commit verification.

## Subtasks

- **T1** [feature] — Author `.github/workflows/publish.yml` with the locked structure (S-1 + S-3). YAML-parseable; matches all assertions. ~80 LOC. **depends on nothing.**
- **T2** [chore] — Author `RELEASING.md` at the repo root. Sections: "## CI flow (canonical)", "## Manual flow (fallback)", "## Setting up `NPM_TOKEN`", "## After publish: verify + GitHub release", "## Why `--no-git-checks` in CI but not manual". ~80 LOC. **depends on nothing.**
- **T3** [test] — `packages/core/src/ci-publish.test.ts` (NEW): tests covering S-1 + S-2 + S-3. Read `.github/workflows/publish.yml` via `readFileSync` + `js-yaml` parse; assert structural properties. Read `RELEASING.md`; assert canonical-section headings present. Read top-level `package.json`; verify the `release` script string is unchanged. ~100 LOC. **depends on T1, T2.**

## Definition of Done

- All scenarios (S-1..S-3) pass.
- `pnpm -C packages/core typecheck` clean.
- `pnpm -C packages/core test` green; `pnpm test` workspace-wide green.
- `pnpm check` (biome) clean.
- `node packages/core/dist/cli.js spec lint docs/specs/` exits 0 against the v0.0.11 cluster.
- `.github/workflows/publish.yml` validates as YAML (parses without error). The action runner can pick it up; the FIRST run of the workflow will happen when the v0.0.11 tag is pushed.
- Top-level `package.json`'s `release` script byte-identical to v0.0.10's.
- `RELEASING.md` exists at the repo root with the canonical sections.
- Public API surface from every `@wifo/factory-*` package strictly equal to v0.0.10 (zero new exports).
- v0.0.11 explicitly does NOT ship in this spec: matrix CI; auto-tag on merge; release-notes generation. Deferred per Constraints.
