# Releasing

Two paths exist for cutting an `@wifo/factory-*` release: the CI flow (canonical, tag-driven) and the manual flow (maintainer-on-laptop fallback).

## CI flow (canonical)

1. Bump every `packages/*/package.json` to the next version (kept in lockstep — see [BACKLOG.md](./BACKLOG.md) for the active version cluster).
2. Update [CHANGELOG.md](./CHANGELOG.md) with a section for the new version.
3. Commit on `main`.
4. Tag the commit: `git tag v0.0.X && git push origin v0.0.X`.

Pushing a tag matching `v[0-9]+.[0-9]+.[0-9]+` triggers `.github/workflows/publish.yml`. The workflow runs the same gates as `pnpm release` — typecheck → test → check → build — and on success publishes each package whose local version differs from npm's via a two-step flow:

1. **`pnpm pack --pack-destination /tmp/factory-tarballs --filter <name>`** — pnpm builds the tarball and rewrites every `workspace:*` reference in the manifest to a real semver (purpose-built for the transformation).
2. **`npx -y npm@latest publish <tarball> --access public --provenance`** — npm uploads the rewritten tarball using OIDC Trusted Publishing (purpose-built for the auth handshake).

Splitting the two responsibilities across the right tools fixes the v0.0.13 regression where `npm publish` (without pnpm's rewrite) shipped `workspace:*` to npm — every fresh `npx @wifo/factory-core init` consumer hit `EUNSUPPORTEDPROTOCOL`.

Authentication is via **npm Trusted Publishing (OIDC)** — the workflow's `id-token: write` permission grants a short-lived OIDC token that npm verifies against each package's Trusted Publishers config. No long-lived `NPM_TOKEN` secret is involved. `--provenance` adds sigstore attestations visible on the package's npm page.

After every successful publish, a verification loop re-fetches each just-published manifest from npm (`npm view <name>@<version> dependencies peerDependencies --json`) and fails the workflow if any value still contains the substring `workspace:`. This is a regression-pin against the v0.0.13 issue: the next release will fail loudly before users hit the broken install.

The workflow does NOT trigger on push to `main`. Tag creation stays maintainer-driven so the maintainer reviews tags before they ship.

## Manual flow (fallback)

When CI is down or the maintainer wants direct control, publish from a clean local checkout of `main`:

```sh
pnpm release
```

This runs `pnpm typecheck && pnpm test && pnpm check && pnpm -r build && pnpm publish -r --access public`. The publish step prompts for the npm OTP from the maintainer's authenticator. The script does NOT pass `--no-git-checks`, so an unstaged change aborts the publish — that safety check matters more for manual runs (where uncommitted edits are easy to forget) than for CI (where `actions/checkout@v4` always produces a clean tree).

## Setting up Trusted Publishing

Each `@wifo/factory-*` package must be configured on npmjs.com to trust this GitHub Actions workflow before the CI publish flow can authenticate. Trusted Publishing replaces the old `NPM_TOKEN`-secret approach (long-lived tokens are a credential-leak surface; OIDC short-lived tokens aren't).

For each of the six packages (`@wifo/factory-context`, `-core`, `-harness`, `-runtime`, `-spec-review`, `-twin`):

1. Visit `https://www.npmjs.com/package/@wifo/factory-<name>/access` (must be signed in as a maintainer with publish rights).
2. Open the **Trusted Publishers** tab.
3. Click **Add trusted publisher** → choose **GitHub Actions**.
4. Fill the form:
   - **Organization or user:** `WiFoDev`
   - **Repository:** `software-factory`
   - **Workflow filename:** `publish.yml`
   - **Environment** (optional, leave blank unless using a deploy environment)
5. Save.

Once all six packages have the trusted publisher set, every tag-push to `v[0-9]+.[0-9]+.[0-9]+` will publish via OIDC — no secrets to manage. Trusted publishers can be revoked anytime from the same Access page if the workflow is compromised.

**Why not `NPM_TOKEN`?** Long-lived automation tokens leak into commit history, screen-shares, lock files, and CI logs more often than anyone admits — and a single token grants publish rights to every package in the scope. OIDC tokens are short-lived (5-min default), bound to a specific workflow run, and cannot be exfiltrated by reading them once. npm's docs flag the token approach as a security risk and steer all CI/CD to Trusted Publishing.

## After publish: verify + GitHub release

1. Verify each package on the npm registry: `npm view @wifo/factory-core versions --json` (and the same for the other five `@wifo/factory-*` packages). Confirm the new version appears.
2. Smoke-test by installing into a scratch directory: `mkdir /tmp/factory-smoke && cd /tmp/factory-smoke && npx @wifo/factory-core init --name smoke`.
3. Create the GitHub release entry from the tag:
   ```sh
   gh release create v0.0.X --title "v0.0.X" --notes-from-tag
   ```
   (Or use the CHANGELOG section as the body: `--notes-file <(sed -n '/## v0.0.X/,/## v/p' CHANGELOG.md | head -n -1)`.)

## Why `--no-git-checks` in CI but not manual

`pnpm publish` refuses to run by default if the working tree has uncommitted changes — the `--no-git-checks` flag opts out of that check.

- **In CI:** `actions/checkout@v4` produces a fresh clone at the tag's exact commit. There is no possibility of unstaged changes. The flag is required because `pnpm publish` also checks the current branch matches the publish branch (which won't match in detached-HEAD tag-checkout). Skipping the check is safe.
- **Manually:** the maintainer's local tree may have uncommitted experiments, half-applied stashes, or a wrong-branch checkout. The check is a useful guardrail. Don't add `--no-git-checks` to the manual `release` script.
