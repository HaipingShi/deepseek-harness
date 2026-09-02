# Agent Note: DevBoard-managed Web runtime control

Status: implemented

English | [中文](2026-09-02-devboard-runtime-control.zh.md)

## Problem

The standalone Web profile owned both parts of startup: it printed a root URL carrying a process token and optionally passed that URL to the operating system's browser opener. A product manager that starts DSH without exposing its terminal could observe the HTTP listener, but could neither know when the authenticated application had finished mounting nor obtain the browser capability without scraping secret-bearing output. Treating a listening port or a clean root URL as sufficient produced either premature 404 responses or the authentication-required page.

DevBoard defines a product-neutral Runtime Protocol v1 for authenticated readiness and browser handoff. DSH needs to participate without moving DevBoard state into the browser UI, weakening standalone authentication, persisting a bootstrap URL, or turning the manager's control credential into a browser credential.

## Decision

`@deepseek-ai/dsh-web-app` is a Runtime Protocol v1 client only when `DEVBOARD_CONTROL_URL`, `DEVBOARD_RUN_ID`, and `DEVBOARD_CONTROL_GRANT` are all valid values inherited by the process. An absent triplet preserves the standalone URL line and browser opener. A partial, malformed, or `.env`-sourced triplet fails startup. Managed mode requires the loopback Web server, suppresses both standalone announcements, and authenticates the control WebSocket with the bearer grant and run id in Upgrade request headers.

The project-local `.devboard/runtime.json` declares the `dsh-web` command, loopback endpoint, and product-neutral structured control mode. DevBoard associates an owner-confirmed digest of this file outside DSH before managed activation; the declaration contains no run identity, control grant, owner origin, or browser handoff.

The root-owned `DevBoardRuntimeControl` sends `hello` after the authenticated WebSocket opens. It sends `ready` only after the Loader tree settles while the Web server and Connection authentication service remain present, and announces the Web server's actual bound port. The root ownership survives a Connection plugin reload without reconnecting the same DevBoard run. A rejected handshake, invalid or oversized message, disconnect, Loader failure, or root shutdown closes the controller and revokes every unconsumed browser handoff.

The controller accepts only exact `open.request` objects for its run and the two protocol-owned DevBoard origins. Each valid request asks the current Connection service to mint a new 30-second browser handoff and returns one exact, correlated `open.response`. The controller validates the returned URL before sending it. Capability creation failure produces `OPEN_UNAVAILABLE`; invalid control input closes the connection instead of guessing a response.

## Capability ownership

The control grant remains private to the control adapter and is used only in the WebSocket handshake. It never appears in a URL, protocol message, public state object, argument vector, persisted record, or diagnostic. Runtime-control code emits no raw frames, URLs, errors, or credentials.

`BrowserAuth` owns browser handoffs beside the existing process launch token. A handoff is a fresh 32-byte base64url capability bound to the target authority and an absolute expiry. Only an exact `GET /` with that sole query token can consume it. A wrong authority does not consume another valid attempt; a successful exchange removes it before writing a signed `SameSite=Lax` browser cookie and a 303 clean-root redirect. Lax allows that top-level redirect to carry the new session when DevBoard uses `localhost` and DSH uses `127.0.0.1`. The existing process token remains reusable for the process lifetime and writes `SameSite=Strict`, so unmanaged behavior does not change.

## Alternatives considered

**Let DevBoard scrape the standalone URL line.** This would preserve one DSH code path, but it would make a secret-bearing log line into an integration protocol, retain the premature-listener race, and require the manager to parse product-specific prose.

**Reuse the control grant as the browser token.** One credential would simplify issuance, but compromise in either plane would grant authority in the other, replay would last for the whole managed run, and revoking an unconsumed browser handoff would require destroying the control session.

**Put control state in the Web UI.** The manager must open the first authenticated page before browser code can run, so a UI adapter cannot solve bootstrap. It would also put process lifecycle and secret handling in the wrong program.

**Reconnect after a control disconnect.** Reconnection could hide transient transport failures, but the same run grant has no protocol for resynchronizing pending open requests or replacing an old manager session. The client therefore fails closed and requires a new managed process run.

**Keep `SameSite=Strict` for managed handoffs.** Strict minimizes cross-site cookie attachment, but a browser treats `localhost` and `127.0.0.1` as different sites and withholds the newly issued cookie through the clean-root redirect. The user then reaches an authentication-required page even though the one-time handoff was consumed.

## Consequences

After an owner associates the project runtime manifest, DevBoard can launch DSH, wait for authenticated application readiness, and open it without showing a terminal or copying a token. The cost is one additional process-local control connection and a strict fail-closed startup mode whenever any control field is present. The managed cookie remains durable and permits safe top-level cross-site navigation; the API still rejects cross-site fetches and mismatched origins before cookie authentication. Disconnect revokes unused handoff capabilities, not sessions that already completed the exchange. Standalone cookies retain the stricter policy.

The implementation uses Node's built-in WebSocket and existing cryptography, so it adds no dependency or on-disk format. Protocol fixture coverage owns the real source-CLI path and OS-assigned ports; Connection tests own one-time exchange, authority binding, expiry, replay, and explicit invalidation.
