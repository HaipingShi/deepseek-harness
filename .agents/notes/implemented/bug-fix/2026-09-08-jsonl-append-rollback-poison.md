# Agent Note: JSONL append rollback failure poisons the handle

Status: implemented

English | [中文](2026-09-08-jsonl-append-rollback-poison.zh.md)

## Problem

A synthetic reproduction of the field-reported `seq gap in committed region` corruption signature found live paths in the JSONL backend: when a persistence write's `writeFile` succeeded but its `fsync` failed, the storage primitive attempted a size rollback; if that rollback ALSO failed, the primitive threw a plain `AggregateError` while the file kept the stranded batch bytes past their pre-write size. The handle treated this like any failed append — the live write path retained the batch and retried it, a direct caller could simply re-append, and the recovered torn-tail rewrite (the first mutation after a crash recovery) sat entirely outside the guarded path — so the same events could land twice in the file. The scanner then reads the duplicated range and throws `corrupt session log: seq gap in committed region (expected N, got …)`, exactly the signature quoted in the task's field evidence. Codex review (R1) reproduced the recovered-tail variant with a handle-level fault-injection repro before the guard covered it.

## Decision

`appendLines` now throws `AppendRollbackError` (an `AggregateError` subclass, so existing reporting expectations hold) when the rollback fails, and `JsonlSessionHandle.persistContiguous` poisons the handle on that type wherever it can arise: the plain batch append AND the recovered torn-tail rewrite. Every further append — direct, live-drain retry, or close-drain — refuses with `the log is in an unknown physical state after a failed append rollback; further appends are refused — close this handle and reopen the session to recover`. A rewrite whose rollback failed also keeps its `recoveredTail` state (never cleared for bytes that did not durably land), and a cleanly rolled-back failure remains safely retryable. Closing still releases write ownership, and a fresh write open re-derives the log from the file's actual bytes: complete stranded records become ordinary committed events, a partial write becomes a torn tail repaired by the existing recovery path, and a fully duplicated region refuses as corruption for an operator to resolve. A clean rollback (the only failure mode before this change) still leaves the retry safe, unchanged.

## Alternatives considered

- **Roll the file forward on rollback failure.** Rejected: trusting stranded bytes without validating them would append new events past an unverified tail, and a partial write would still need the torn-tail machinery — which already runs on reopen, where validation lives.
- **Stat-and-scan before every append.** Rejected: it narrows the window but cannot close it (a concurrent writer or a crash between scan and append reopens the race) and costs a whole-log parse per batch; the handle's cursor plus the poison latch is exact within the single-writer contract.
- **Refuse at the storage layer only.** Rejected: the primitive has no ownership state; the handle owns the mutation chain and the retry paths, so the latch must live where the retries live.

## Consequences

A failed rollback can no longer produce a duplicated committed region: the second write is refused, the log keeps its on-disk truth, and recovery is an ordinary reopen instead of manual surgery. The cost is that a handle that hit a rollback failure is spent — every further append fails until the owner closes and reopens, including automated live writes, which log a background failure and stop until `session/flush`, close, or teardown surfaces the poison loudly. The known in-process single-writer contract is unchanged; a second process writing the same file remains outside every guarantee this backend makes.

## Testing

`packages/session/session-persistence-jsonl/tests/jsonl.spec.ts` pins: the reporting test asserts the `AppendRollbackError` name and error pair; a failed rollback poisons the handle — a further append refuses, the file keeps its unknown bytes unchanged, close releases ownership, a fresh open recovers the stranded complete records as the log truth, and a fresh writer continues contiguously; and a poisoned handle refuses its retained live batch on drain, with close surfacing the failure while still releasing ownership. `packages/session/session-persistence-jsonl/tests/zstd.spec.ts` adds the recovered-tail regression against a real temporary compressed log: a final frame torn at its checksum byte primes the recovery state, injected fsync plus rollback failure during the rewrite poisons the handle, the next append and the routed live drain refuse before any underlying write, close surfaces the refusal while releasing ownership, and a fresh open recovers the stranded complete records as the log truth. Against the pre-fix sources, the poison assertions fail with the blind retry succeeding (the duplicate-region reproduction writes `[0,1,2,3,2,3]`, the recovered-tail variant rewrites the recovered events a second time, and the scanner throws the field signature).
