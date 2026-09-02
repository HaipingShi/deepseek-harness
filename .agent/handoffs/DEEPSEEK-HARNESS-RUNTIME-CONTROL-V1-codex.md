# DEEPSEEK-HARNESS-RUNTIME-CONTROL-V1 handoff

Status: client implementation, association, managed-cookie remediation, real DevBoard canary, and closure verification complete

Recorded: 2026-09-02 13:11:55 CST

Remediation verified: 2026-09-02 13:37:39 CST

Live browser canary verified: 2026-09-02 14:46:50 CST

Closure verified: 2026-09-02 15:30:43 CST

## Changed files

- `.agent/handoffs/DEEPSEEK-HARNESS-RUNTIME-CONTROL-V1-codex.md`
- `.agent/reviews/DEVBOARD-RUNTIME-CONTROL-V1-workspace-management-e2e-review.md`
- `.agents/notes/implemented/architecture/2026-09-02-devboard-runtime-control.i18n.yaml`
- `.agents/notes/implemented/architecture/2026-09-02-devboard-runtime-control.md`
- `.agents/notes/implemented/architecture/2026-09-02-devboard-runtime-control.zh.md`
- `.devboard/runtime.json`
- `apps/cli/tests/web-runtime-control.e2e.ts`
- `apps/web/tests/hmr-live.e2e.ts`
- `apps/web/tests/workspace-management.e2e.ts`
- `docs/config-catalog.i18n.yaml`
- `docs/config-catalog.md`
- `docs/config-catalog.zh.md`
- `packages/bundle/web-app/README.i18n.yaml`
- `packages/bundle/web-app/README.md`
- `packages/bundle/web-app/README.zh.md`
- `packages/bundle/web-app/src/index.ts`
- `packages/bundle/web-app/src/runtime-control.ts`
- `packages/bundle/web-app/tests/runtime-control.spec.ts`
- `packages/bundle/web-app/tests/web-app.spec.ts`
- `packages/client/connection/README.i18n.yaml`
- `packages/client/connection/README.md`
- `packages/client/connection/README.zh.md`
- `packages/client/connection/src/browser-auth.ts`
- `packages/client/connection/src/rpc-host.ts`
- `packages/client/connection/src/rpc.ts`
- `packages/client/connection/tests/browser-auth.host.spec.ts`

No package manifest, lockfile, DevBoard file, UI component, provider configuration, or durable-data format was changed. The generated config catalog changed only its `web-app/src/index.ts` source pointer from line 44 to line 50. The two Web E2E changes close independent test-driver and artifact-isolation defects found by the full replay; they do not alter product behavior.

## Implemented behavior

- All three process-inherited DevBoard control fields activate managed mode; all absent preserves standalone DSH, while partial, malformed, or file-sourced values fail closed.
- The checked-in `.devboard/runtime.json` declares the verified `dsh-web` CLI command and product-neutral structured control mode without a credential, owner origin, or legacy stdout handoff. DevBoard's current discovery implementation reports it as `DISCOVERED`.
- The adapter authenticates the loopback WebSocket with the bearer grant and run id in Upgrade headers, sends `hello`, and sends `ready` only after Loader settlement with Connection authentication and the Web server still present.
- Managed mode suppresses DSH URL printing and browser opening. The process root owns the control connection, so Connection reload does not reconnect the same run.
- Each valid and correctly correlated `open.request` mints a fresh 30-second, 43-character single-use browser handoff. Available and unavailable responses contain only the protocol's exact fields.
- Browser handoffs bind the target authority, exchange through 303 to the clean root and a signed `SameSite=Lax` cookie, reject replay and expiry, preserve a valid capability after a wrong-authority attempt, and support explicit bulk invalidation. Standalone process-token exchange retains `SameSite=Strict`.
- Authentication failure, invalid or oversized control messages, send failure, disconnect, Loader failure, and shutdown invalidate outstanding handoffs and close the control client without reconnecting.
- The control grant remains private to the adapter, is not reused as a browser token, and is absent from URLs, JSON frames, argv, persisted state, public control state, stdout, stderr, and diagnostics.
- The real-CLI fixture routes received-frame dumps, caught errors, stdout, and stderr through one capability redactor. It does not retain the original unsanitized error as `cause`, and its negative test compares only booleans so a failing assertion cannot echo a fixture secret.

## Commands and results

- `pnpm exec vitest run packages/client/connection/tests/browser-auth.host.spec.ts packages/bundle/web-app/tests/runtime-control.spec.ts packages/bundle/web-app/tests/web-app.spec.ts packages/bundle/web-app/tests/browser-open.spec.ts packages/bundle/web-app/tests/trusted-hosts.spec.ts` — PASS, 5 files and 80 tests.
- `node --input-type=module -e <compile DSH manifest with DevBoard runtime-spec-compiler>` — PASS. The selected port compiled into `pnpm dsh web --no-open --port 43127`, structured `control` remained exact, and `sessionHandoff` was `null`.
- `node --input-type=module -e <discover DSH manifest with DevBoard runtime-manifest-discovery>` — PASS. State `DISCOVERED`, candidate `runtime-sha256-d0592da5e0d47379`, digest `sha256:d0592da5e0d473793d46b2544c45e67a1777020434fc06891fa20b0e9d166e70`; no association was written.
- `pnpm exec vitest run --config vitest.e2e.config.ts apps/cli/tests/web-runtime-control.e2e.ts` — PASS, 3 tests: project-local declaration, capability-redaction negative control, and one real source-CLI fixture using a test-owned WebSocket server plus OS-assigned control/HTTP ports. The CLI fixture covered authenticated headers, `hello -> ready -> open.request -> open.response`, 303, clean URL and cookie continuation, replay rejection, disconnect invalidation, distinct handoffs, secret-free process output, and manager-only opening.
- `pnpm exec vitest run --coverage --coverage.include=packages/bundle/web-app/src/runtime-control.ts packages/bundle/web-app/tests/runtime-control.spec.ts` — PASS, 100% statements/branches/functions/lines (158/158, 94/94, 27/27, 142/142).
- `pnpm exec vitest run --coverage --coverage.include=packages/client/connection/src/browser-auth.ts packages/client/connection/tests/browser-auth.host.spec.ts` — PASS after the managed-cookie remediation, 100% statements/branches/functions/lines (163/163, 120/120, 26/26, 146/146).
- `pnpm exec vitest run --coverage --coverage.include=packages/bundle/web-app/src/index.ts packages/bundle/web-app/tests/web-app.spec.ts packages/bundle/web-app/tests/browser-open.spec.ts packages/bundle/web-app/tests/trusted-hosts.spec.ts` — PASS, 100% statements/branches/functions/lines (117/117, 62/62, 33/33, 107/107).
- `pnpm exec tsc -b packages/client/connection/tsconfig.host.json packages/bundle/web-app/tsconfig.json apps/cli/tsconfig.json --pretty false` — PASS.
- `pnpm exec tsc -p tsconfig.host.json --noEmit --pretty false` — PASS after the pre-canary remediation.
- `pnpm exec tsx scripts/run-oxlint.ts <the nine changed TypeScript source/test files>` — PASS.
- `pnpm run verify-export-jsdoc` — PASS after adding the required `@returns` contracts.
- `pnpm run test:docs` — PASS, 15/15 gates.
- `pnpm run doc-sync` — final PASS, 32/32 gates. The first remediation run reported the generated config source pointer stale; regeneration changed only line 44 to 50. The second run reported its Chinese pairing stale; the corresponding Chinese pointer and pairing record were updated before the passing final run.
- `pnpm run lint` — PASS after rebuilding the host libraries and running the repository linter.
- `pnpm run hygiene` — PASS, 15/15 gates, including package dependencies, constraints, publint, application entrypoints, runtime closure, NodeNext types, and optional dependency imports.
- `pnpm run build` — PASS on the final run, including Host, Client, and Vite Web builds. The first run found two `exactOptionalPropertyTypes` errors in new tests; both fixtures were corrected before the passing rerun.
- `pnpm run test:gui` — PASS, 292 files and 3,857 tests passed with one existing skip.
- `pnpm exec vitest run --config vitest.web.config.ts apps/web/tests/workspace-management.e2e.ts -t "adds two workspaces|renames a workspace"` — PASS for 10 consecutive dependency-preserving runs, 20/20 selected tests in total.
- `pnpm exec vitest run --config vitest.web.config.ts apps/web/tests/workspace-management.e2e.ts` — PASS, 12/12 tests.
- Complete build followed by `hmr-live.e2e.ts`, build-record verification, and `built-boot.expected.e2e.ts` — PASS. HMR passed 1/1, the restored 220-file SHA-256 remained `6e24f47edf3941311d51587cf95b6deda94f948b0f003251c51408900b397e14`, and built boot passed 2/2.
- Final `DSH_SNAPSHOT=replay pnpm run test:web` — PASS, 91 files and 308 tests passed; one file and 15 tests retained their existing conditional skips.
- `git diff --check` — PASS.

## Browser acceptance allocation

- 303, one-time exchange, clean-root cookie continuation, expiry, replay, wrong authority without consuming the valid capability, and explicit invalidation are pinned in `browser-auth.host.spec.ts`.
- Manager-only opening and Loader-gated readiness are pinned in `web-app.spec.ts`.
- Allowed and wrong DevBoard owner origins, exact request correlation, invalid frame handling, authentication failure, disconnect cleanup, and secret-free logs are pinned in `runtime-control.spec.ts`.
- The real source-CLI fixture confirms the combined transport and browser path without a model/provider call.
- After the authorized DevBoard restart, the live manager open route returned 303 with a 43-character handoff; DSH returned 303 with `HttpOnly; SameSite=Lax`, clean-root continuation returned 200, and replay returned 401. No token or cookie value was printed.
- A new Playwright session with an empty cookie jar opened `http://localhost:7100/`, clicked the DSH card's `打开` link, received a second tab at the clean `http://127.0.0.1:3278/`, and rendered the full `DSH 本地构建` UI with zero console errors. The screenshot and CLI evidence are under `output/playwright/devboard-dsh-lax/.playwright-cli/`.
- The retained 55,505-byte DevBoard log and browser artifact scan found no query token, bearer value, control-grant name/value, or browser-cookie value.

## Residual risks

- DevBoard's owner-review projection fix and Runtime Protocol implementation remain uncommitted in its working tree. The live association and canary used that current working-tree implementation.
- The local host ran Node 24.8.0. Node 22.19 compatibility relies on the repository engine floor and that release's bundled WebSocket header support; CI remains the Node 22 execution owner.
- The full Web replay initially exposed two independent E2E isolation defects. Both are now fixed in test code and the final complete replay passes; the closure review records their causes and bounded changes.
- `SameSite=Lax` permits the managed cookie on safe top-level cross-site navigation. API requests still reject `sec-fetch-site: cross-site` and mismatched origins before cookie authentication; standalone exchange remains `Strict`.
- A browser session that already exchanged its handoff keeps the existing signed cookie after control disconnect. Only unconsumed handoffs are revoked; this is intentional and documented.

## Scope and live-process confirmation

- The user authorized exact, atomic commits after verification. No push was performed.
- No real model/provider call or data egress was performed.
- No dependency was added and no lockfile was changed.
- DevBoard files were read only during this remediation; its pre-existing dirty status remained present. The authorized restart used its lifecycle API and did not hand-edit registry state.
- Port 3278 began this remediation under DevBoard runner PID 34595 and listener PID 34625. The authorized restart replaced them with runner PID 48450 and listener PID 48493; DevBoard returned to `RUNNING` on port 3278 and the new process completed live acceptance.
- Pre-existing DSH changes outside this task remain untouched: the 2026-07-23 client-plugin-loading note triplet, root `package.json`, `scripts/dev-web.ts`, and untracked `output/`.
