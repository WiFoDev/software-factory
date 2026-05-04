# Releasing

Two paths exist for cutting an `@wifo/factory-*` release: the CI flow (canonical, tag-driven) and the manual flow (maintainer-on-laptop fallback).

## CI flow (canonical)

1. Bump every `packages/*/package.json` to the next version (kept in lockstep — see [BACKLOG.md](./BACKLOG.md) for the active version cluster).
2. Update [CHANGELOG.md](./CHANGELOG.md) with a section for the new version.
3. Commit on `main`.
4. Tag the commit: `git tag v0.0.X && git push origin v0.0.X`.

Pushing a tag matching `v[0-9]+.[0-9]+.[0-9]+` triggers `.github/workflows/publish.yml`. The workflow runs the same gates as `pnpm release` — typecheck → test → check → build — and on success runs `pnpm publish -r --access public --no-git-checks` against the npm registry, authenticating via the `NPM_TOKEN` secret.

The workflow does NOT trigger on push to `main`. Tag creation stays maintainer-driven so the maintainer reviews tags before they ship.

## Manual flow (fallback)

When CI is down or the maintainer wants direct control, publish from a clean local checkout of `main`:

```sh
pnpm release
```

This runs `pnpm typecheck && pnpm test && pnpm check && pnpm -r build && pnpm publish -r --access public`. The publish step prompts for the npm OTP from the maintainer's authenticator. The script does NOT pass `--no-git-checks`, so an unstaged change aborts the publish — that safety check matters more for manual runs (where uncommitted edits are easy to forget) than for CI (where `actions/checkout@v4` always produces a clean tree).

## Setting up `NPM_TOKEN`

The workflow needs an **automation** token (not the default publish token, which requires TOTP per publish):

1. From a maintainer account with publish access to the `@wifo` scope, run `npm token create --type=automation`.
2. Copy the resulting `npm_...` token.
3. Set the GitHub repo secret: `gh secret set NPM_TOKEN -b "npm_..."`.

The token is single-purpose (publish only). Rotate it with `npm token revoke <id>` + `npm token create --type=automation` if leaked.

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
