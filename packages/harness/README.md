# @wifo/factory-harness

Scenario runner for software-factory specs.

Reads a parsed `Spec` (via `@wifo/factory-core`), executes its scenarios, and produces a `HarnessReport`. Two satisfaction kinds:

- **`test:`** — delegates to a configured test runner (Bun by default). Pass/fail from exit code.
- **`judge:`** — calls an LLM with the criterion + an artifact, returns a probabilistic score.

The harness is **artifact-agnostic**: the same machinery validates a spec (artifact = the spec itself), code (artifact = the code), or any other text. The judge resolves its own context.

## Status

Pre-alpha. Scope is being shaped — see `docs/specs/factory-harness-v0-0-1.md` (once written) for the v0.0.1 plan.
