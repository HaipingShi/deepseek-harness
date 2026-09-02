# DevBoard Runtime Control Web E2E closure review

Status: resolved and verified

Recorded: 2026-09-02

## Findings

The first full `DSH_SNAPSHOT=replay pnpm run test:web` build succeeded, but
`apps/web/tests/workspace-management.e2e.ts` intermittently timed out after its
hover-only action became invisible between a successful visibility poll and the
following click. The helper anticipated row replacement but did not retry the
complete hover-plus-click interaction.

After that race was fixed, the next full run exposed a second test-isolation
defect: `hmr-live.e2e.ts` rewrote both package client bundles and
`apps/web/dist`, while its cleanup restored only the package bundles. The later
built-boot integrity check therefore observed client artifacts that no longer
matched `.dsh-build/client-build-environment.json`.

Neither failure originated in browser authentication, Runtime Control,
Workspace production UI, or the workspace controller.

## Resolution

- `clickHoverAction()` now retries the complete real hover and click sequence.
  Only Playwright actionability timeouts become retries; other errors still
  fail immediately. The helper does not force-click or increase its outer
  timeout.
- The HMR E2E now snapshots every client artifact covered by the build record,
  stops its watcher, removes artifacts created by the watch build, and restores
  the original files byte for byte. This keeps the real HMR assertion while
  returning the shared serial test workspace to its pre-test state.

## Evidence

- The dependent workspace create-and-rename pair passed 10 consecutive runs,
  20/20 selected tests in total.
- The complete `workspace-management.e2e.ts` file passed 12/12 tests.
- After a complete build, `hmr-live.e2e.ts` passed and the restored 220-file
  digest remained `6e24f47edf3941311d51587cf95b6deda94f948b0f003251c51408900b397e14`.
- The following built-boot test passed 2/2 tests.
- The final full keyless Web replay passed 91 files and 308 tests, with one file
  and 15 tests skipped by their existing conditions.
- Focused oxlint and `git diff --check` passed for both E2E files.

## Scope decision

The closure changes are confined to `apps/web/tests/hmr-live.e2e.ts` and
`apps/web/tests/workspace-management.e2e.ts`. No production Workspace UI,
Connection/browser-auth, Runtime Control, snapshot, dependency, lockfile, or
timeout policy changed as part of these test-infrastructure fixes.
