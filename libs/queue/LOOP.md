# Loop 001

**Library:** libs/queue
**Date:** 2026-07-17

## Goal

First `ci.loop` pass over `libs/queue`. Bring it in line with the dynamic-module
convention already established by `libs/database`/`libs/cache` (`forRoot` +
`forRootAsync`), fix a graceful-shutdown ordering gap, remove dead scaffold
code, add a configurable per-consumer handler timeout, and close the test
coverage gap on pure/near-pure logic that had zero tests.

## Files Reviewed

- All of `libs/queue/src/**/*.ts` (connection, publisher, consumer runtime,
  context/header parsing, outbox, inbox, topology bootstrap/builder, retry
  topology, errors, utils, persistence entities/migrations).
- `src/app.module.ts` (how the host app wires `QueueModule.forRoot`).
- `libs/database/src/transaction/transaction.executor.ts` (to verify
  rollback-on-throw semantics before deciding on finding #2 below).

## Problems Found

**High**
- `QueueModule` only exposed `forRoot`, not `forRootAsync` — inconsistent
  with `DatabaseModule`/`CacheModule`/`WorkflowModule`, which all support
  resolving options from `ConfigService`/other providers.
- `DatabaseQueueInboxService.withIdempotency` wraps the inbox-row insert
  *and* the consumer handler body in one DB transaction, holding a
  connection open for the handler's full duration (including any external
  I/O). Investigated whether to split this, but `TransactionExecutor`'s
  `REQUIRED` propagation genuinely rolls back both together on throw —
  splitting it would trade that crash-safety for connection-pool relief.
  User chose to keep it as-is and document the tradeoff (see below) rather
  than risk a correctness regression.
- `RMQConnection` and `RMQConsumerRuntime` both implemented
  `OnApplicationShutdown`, with `RMQConsumerRuntime` depending on
  `RMQConnection`. Confirmed via `@nestjs/core`'s `on-app-shutdown.hook.js`
  that Nest calls every provider's `onApplicationShutdown` in a module
  **concurrently** (`Promise.all`), so there was no ordering guarantee —
  `RMQConnection` could close the shared AMQP connection while
  `RMQConsumerRuntime` was still cancelling/draining consumers.

**Medium**
- `QueueService` (`queue.service.ts`) was empty scaffold code, never
  registered as a provider or exported from the barrel.
- `RMQConsumerRuntime.HANDLER_TIMEOUT_MS` (60s) was a hard-coded constant
  with no per-consumer override, unlike `prefetch`/`retryPolicy` which are
  both configurable via `@RMQConsumer`.
- Zero test coverage on a cluster of pure/near-pure logic: header
  parsing/validation, payload validation, serializer, retry-count parsing,
  message settlement, context factory, topology builder (`defineTopology`),
  retry topology builder, retry queue naming, header/validation-error
  utils, and the `@RMQConsumer` decorator itself.

**Low** (deferred, not in this loop's scope)
- `is-duplicate-key-error.ts` hard-codes SQLite driver codes for tests only
  (fine, undocumented).
- `RMQPublisher.returnedMessageIds` could theoretically leak an entry if an
  exception short-circuits before the `.delete()` check — very unlikely
  given current control flow.

## Changes Made

- Added `QueueModule.forRootAsync` (`useFactory`/`useClass`/`useExisting`,
  mirroring `CacheModule`'s pattern) plus `QueueOptionsFactory` and
  `QueueModuleAsyncOptions` types in `queue.types.ts`. Since outbox/inbox
  enablement is only known once the async options resolve at runtime (unlike
  `forRoot`'s static branching), `forRootAsync` always registers the
  outbox/inbox providers and each decides at runtime whether to activate:
  - `OutboxDispatcherService.onModuleInit` no-ops when `QUEUE_OUTBOX_OPTIONS`
    resolves to `undefined` (outbox not configured) instead of always
    scheduling a sweep interval.
  - `OutboxService.enqueue` now throws `QueueConfigurationError` when outbox
    is disabled, instead of silently inserting rows nobody will ever
    dispatch.
  - `QUEUE_INBOX_SERVICE` resolves to `DatabaseQueueInboxService` or
    `NoopQueueInboxService` based on the resolved `inbox` flag.
- Documented (via a doc comment on `DatabaseQueueInboxService.withIdempotency`
  — see "Why" below) that the transaction-wraps-the-handler design is
  intentional; no code change.
- Moved connection teardown out of `RMQConnection.onApplicationShutdown`
  (removed) into a plain `RMQConnection.close()` method, called explicitly
  by `RMQConsumerRuntime.onApplicationShutdown` *after* consumers are
  cancelled, aborted, and drained. This guarantees the shared connection
  outlives in-flight ack/nack calls.
- Deleted `queue.service.ts` and its spec (dead scaffold code).
- Added `RmqConsumerOptions.timeoutMs` / `@RMQConsumer(..., { timeoutMs })`;
  `RMQConsumerRuntime.withTimeout` now uses the per-handler value, falling
  back to the existing 60s default.
- Added 13 new spec files covering the previously-untested pure logic
  (see Tests below), plus new tests for the shutdown-ordering fix, the
  timeout override, the outbox-disabled guard, and `QueueModule.forRootAsync`
  DI wiring (useFactory/useClass, outbox enabled/disabled, inbox
  Database/Noop selection).

## Why

- The `forRootAsync` gap was the highest-value fix: it's the same pattern
  gap the prior `libs/cache` loop closed, and blocks configuring the queue
  from `ConfigService` the way every other lib in this monorepo can.
- The inbox-transaction finding was investigated but **not changed** — user
  explicitly chose "keep as-is, document only" after being shown that
  splitting the transaction trades crash-safety (a crash mid-handler
  currently rolls back the inbox row too, so the message gets correctly
  redelivered) for reduced connection hold time. That tradeoff isn't safe
  to make silently.
- The shutdown-ordering fix is a correctness fix, not a style preference —
  confirmed via Nest's own hook-calling code that concurrent
  `OnApplicationShutdown` execution was a real risk, not a hypothetical one.
- Missing-test scope was chosen deliberately as "High + Medium fixes",
  matching the scope the user picked for the `cache`/`database` loops.

## Tests

`libs/queue` suite is now 26 spec files / 134 tests (up from 12 files / 56
tests). Full monorepo suite: 86 suites / 632 tests, all passing.

## Build

PASS (`npx tsc --noEmit -p tsconfig.json`)

## Lint

PASS (`npm run lint`)

## Remaining TODO

- Low-priority items listed above (SQLite driver-code documentation,
  `RMQPublisher.returnedMessageIds` theoretical leak) — not started.
- No `ARCH.md` exists for this library yet; this loop was pure Improvement
  Loop (Sections 1-19), no Design Mode session preceded it.
- The inbox-transaction-scope tradeoff (documented, not changed) should be
  revisited if/when a real connection-pool-exhaustion incident traces back
  to a slow consumer handler — at that point "configurable per
  `QueueModule.forRoot`" (the option not chosen this loop) becomes the
  likely fix.

## Next Loop

- Consider whether `RMQConnection.MAX_PREFETCH` / other hard-coded tuning
  constants should follow the same "configurable via module options"
  pattern established for `timeoutMs` this loop.
- Revisit `RMQPublisher.returnedMessageIds`'s composite-key-collision risk
  (Section 9-style review) if retry-chain message IDs are ever reused
  concurrently.
- Cross-check the `forRootAsync` "always-register, decide-at-runtime"
  pattern introduced here against `libs/workflow`'s persistence-backend
  selection (`WorkflowModule.forRoot({ persistence })`) for consistency if
  that module ever grows a `forRootAsync`.

# Loop 002

**Library:** libs/queue
**Date:** 2026-07-17

## Goal

Continue the loop, picking up the Low-severity backlog and "Next Loop" notes
left by Loop 001.

## Files Reviewed

- `libs/queue/src/publisher/rmq.publisher.ts` (+ spec)
- `libs/queue/src/inbox/is-duplicate-key-error.ts`
- `libs/queue/src/connection/rmq.connection.ts` (re-reviewed the hard-coded
  retry/backoff/prefetch constants flagged as a "Next Loop" candidate)

## Problems Found

**Medium**
- `RMQPublisher.returnedMessageIds` keyed unroutable-message detection on the
  caller-supplied AMQP `messageId`. Retries (`RMQConsumerRuntime.publishRetry`)
  and outbox redelivery both intentionally reuse the same `messageId` across
  multiple `publish()` calls for the same logical message. If two such calls
  were ever in flight concurrently on the shared publisher channel, a
  `return` event for one could be misattributed to the other (either
  swallowing a real unroutable error or throwing a spurious one for a
  message that actually routed fine).

**Low**
- `is-duplicate-key-error.ts` handled Postgres/SQLite driver codes with no
  comment explaining why, given production only runs MySQL.

**Considered, not changed**
- `RMQConnection`'s hard-coded retry/backoff/prefetch constants
  (`RAW_CONNECT_MAX_RETRIES`, `RAW_CONNECT_BASE_DELAY_MS`,
  `RAW_CONNECT_MAX_DELAY_MS`, `MAX_PREFETCH`). No driving use case for making
  these configurable surfaced during review — adding module-options surface
  for them now would be speculative API growth against Section 17's
  "never trade correctness for elegance" / "every refactor must have
  measurable value" discipline. Left as-is; revisit only if a concrete need
  (e.g. a deployment needing faster/slower reconnect backoff) shows up.

## Changes Made

- Added `RMQ_INTERNAL_PUBLISH_ID_HEADER`, an internal-only header (not part
  of `RMQ_HEADERS`, stripped from caller-supplied headers the same way
  `x-retry-count` already was) carrying a fresh `randomUUID()` per
  `publish()` call.
- `RMQPublisher` now correlates `return` events via that internal id
  (`returnedPublishIds`, renamed from `returnedMessageIds`) instead of the
  caller-supplied `messageId`, eliminating the cross-call misattribution risk.
- Documented why `is-duplicate-key-error.ts` checks non-MySQL driver codes.

## Why

- The publisher fix closes a real correlation bug rather than a
  hypothetical one: `publishRetry` in `rmq-consumer.runtime.ts` explicitly
  passes through the original AMQP `messageId` on every retry attempt, so
  messageId reuse across concurrent `publish()` calls is an intended,
  reachable code path, not an edge case.
- The `RMQConnection` constants were deliberately left alone — Section 17
  ("every refactor must have measurable value") and Section 0.1's
  anti-premature-complexity stance both argue against adding configuration
  surface without a concrete driving requirement.

## Tests

`libs/queue` suite is now 26 spec files / 135 tests (up from 134). Added a
regression test proving two concurrent `publish()` calls sharing the same
caller `messageId` each get correctly/independently attributed on
unroutable-return. Full monorepo suite: 86 suites / 633 tests, all passing.

## Build

PASS (`npx tsc --noEmit -p tsconfig.json`)

## Lint

PASS (`npm run lint`)

## Remaining TODO

- No `ARCH.md` exists for this library yet.
- The inbox-transaction-scope tradeoff from Loop 001 remains documented but
  unchanged — revisit only if a real connection-pool-exhaustion incident
  traces back to a slow consumer handler.

## Next Loop

- No further Critical/High/Medium findings identified this pass. The
  remaining open item is the cross-library `forRootAsync` pattern check
  against `libs/workflow` noted in Loop 001, which depends on that library
  growing an async variant first — nothing actionable in `libs/queue` itself
  right now. Absent new findings, this library is at a natural stopping
  point per Section 16 (no Critical/High open, tests/build/lint green).

# Loop 003

**Library:** libs/queue
**Date:** 2026-07-21

## Goal

Standard Improvement Loop pass, prompted in part by a sibling loop on
`libs/database` that fixed a CRITICAL `TransactionExecutor` bug (commit/
rollback hooks were firing based on when the user callback settled rather
than when the physical COMMIT/ROLLBACK actually executed against the
`QueryRunner`, plus a stray second `commit()` call on `REQUIRES_NEW`). Since
`libs/queue`'s outbox/inbox reliability patterns depend on transactional
correctness, this loop's primary mandate was to determine whether that bug
could have affected `libs/queue`, then run a normal adversarial Phase 1/2
pass over the rest of the library.

## Files Reviewed

- All of `libs/queue/src/**/*.ts` (connection, publisher, consumer runtime,
  context/header parsing, outbox, inbox, topology bootstrap/builder, retry
  topology/naming, errors, utils, persistence entities/migrations,
  `queue.module.ts`, `queue.types.ts`).
- `libs/database/src/transaction/transaction.executor.ts` (post-fix version)
  and a grep across `libs/queue/src` for any use of
  `runOnTransactionCommit`/`runOnTransactionRollback`/`runOnTransactionComplete`
  — see "Cross-check with libs/database" below.

## Cross-check with libs/database

**Finding: `libs/queue` is unaffected by the `TransactionExecutor` hook-timing
bug — it never used commit/rollback hooks in the first place.**

- Grepped `libs/queue/src` for `runOnTransactionCommit`, `runOnTransactionRollback`,
  `runOnTransactionComplete`, and `REQUIRES_NEW`/`Propagation` usage: zero
  matches. The outbox/inbox code doesn't hook into transaction lifecycle
  events at all.
- `OutboxService.enqueue` (`outbox/outbox.service.ts`) just calls
  `this.outbox.insert(...)` through `BaseRepository`, which resolves the
  active `EntityManager` from `transactionContext` — it runs inside whatever
  ambient `@Transactional()` the host app wrapped around the business write,
  with no hook dependency. Its correctness rests on `TransactionExecutor`
  committing/rolling back the ambient transaction correctly, which the
  sibling loop's fix strengthened rather than changed the contract of.
- `DatabaseQueueInboxService.withIdempotency` (`inbox/database-queue-inbox.service.ts`)
  calls `this.transactionExecutor.execute(callback)` directly with no
  `propagation` option — the inbox-row insert and the handler body run
  inside `TransactionExecutor`'s default (REQUIRED) path, committing/rolling
  back synchronously via `runOwnedTransaction`/the "already active" branch.
  There is no `runOnTransactionCommit`/`Rollback` call anywhere in this path
  for the fixed hook-ordering bug to have affected.
- `OutboxDispatcherService.sweep`/`dispatch` don't run inside a
  `@Transactional()` at all — `OutboxRepository.claimBatch` uses a
  claim-then-conditional-UPDATE pattern (SELECT candidate ids, then
  `UPDATE ... WHERE status = :pending OR (...)`), which is safe under plain
  autocommit row-level locking, not `TransactionExecutor`.
- Conclusion: no code change needed on the `libs/queue` side for this cross-check.

## Problems Found

**Critical**
- None.

**High**
- None.

**Medium**
- `RMQConsumerRuntime.consumeMessage`'s retry-publish failure handler
  (`consumer/rmq-consumer.runtime.ts`) only excluded `QueueConfigurationError`
  and "retry queue full" (`classifyPublishError(...).rejected`) from the
  requeue path; every other publish error — including `UnroutableMessageError`
  (the retry queue itself doesn't exist, e.g. a mismatch between the
  `@RMQConsumer` decorator's `retryPolicy` and what `TopologyBootstrap`
  declared at startup) — fell through to `requeue: true`. That nacks the
  original message back onto its own queue for immediate redelivery, which
  hits the same unroutable retry-publish again on the next attempt: a tight,
  unbounded retry loop with no backoff, hammering the broker. Genuine
  DLQ/retry-semantics gap per ci.loop §8, distinct from the (correctly
  requeued) transient-connection-error case, which must keep requeuing.

**Low**
- None newly identified this pass; see "Considered, not changed" below for
  items re-examined but left as-is.

**Considered, not changed**
- The inbox-transaction-scope tradeoff from Loop 001 (handler body runs
  inside the same DB transaction as the inbox-row insert) — re-examined
  given the `libs/database` cross-check context above; still correct and
  unaffected, no change warranted.
- A slow/timed-out handler's original `invokeHandler` promise (wrapping the
  inbox transaction) keeps running in the background after
  `HandlerTimeoutError` triggers a retry-publish, since the DB
  query/transaction can't actually be cancelled via `AbortSignal`. Traced
  the resulting scenarios: if the original handler eventually commits, the
  redelivered retry's inbox insert hits a duplicate-key conflict and is
  correctly skipped as already-processed (idempotency working as intended);
  if it rolls back, the retry's insert succeeds fresh. The only edge case is
  a redelivered retry blocking on the still-open original transaction's row
  lock until it settles (or the DB's lock-wait-timeout) — a pre-existing,
  already-documented tradeoff (Loop 001), not something this loop's scope
  covers introducing a fix for (would need a real incident to justify,
  per §17 "every refactor must have measurable value").
- `RMQConnection`'s hard-coded retry/backoff/prefetch constants — still no
  concrete driving use case; left as-is per Loop 002's reasoning.
- `TopologyBootstrap`'s raw (non-managed) AMQP connection stays open for the
  app's full lifetime after the one-time startup bootstrap completes. Mildly
  wasteful but deliberate (simplifies sequential `assertQueue`/`assertExchange`
  bootstrap flow vs. `ChannelWrapper`'s queued-setup semantics) and not a
  correctness issue; not touched.

## Changes Made

- `libs/queue/src/consumer/rmq-consumer.runtime.ts`: added an
  `isUnroutable = publishError instanceof UnroutableMessageError` check
  alongside the existing `isRetryQueueFull`/`isConfigError` checks in the
  retry-publish failure handler, excluding it from `requeue` the same way,
  and added a `retryQueueUnroutable` field to the existing error log for
  observability.
- `libs/queue/src/consumer/rmq-consumer.runtime.spec.ts`: added a regression
  test ("nacks without requeue when the retry-publish fails because the
  retry queue is unroutable") asserting `channel.nack` is called with
  `requeue: false` when `publisher.publish` rejects with
  `UnroutableMessageError`, distinct from the existing transient-error test
  (generic `Error('connection closed')`) which still asserts `requeue: true`.

## Why

- The fix is narrowly scoped to a genuinely unbounded-retry-loop hazard
  (broker-hammering with zero backoff on a real, if uncommon, topology/config
  mismatch) without touching the legitimate transient-connection-error
  requeue path, which must keep retrying so messages aren't lost during a
  broker blip. Consistent with the same reasoning already applied to
  `isConfigError`/`isRetryQueueFull` in this exact branch.
- No other Critical/High/Medium issues surfaced despite an adversarial pass
  over connection lifecycle, topology bootstrap, consumer registration/
  shutdown ordering, retry/DLQ semantics, header precedence, payload
  validation, outbox/inbox transactional correctness, and duplicate-delivery
  handling (ci.loop §8) — Loops 001/002 already closed the substantive gaps
  in this library, and the `libs/database` cross-check confirmed no
  hook-timing dependency exists to be affected by that sibling fix.

## Tests

`libs/queue` suite: 25 spec files / 132 tests (up from 25/131), all passing.
Full monorepo suite: 133 suites / 1047 tests, all passing
(`npm test`).

## Build

PASS (`npx tsc --noEmit -p tsconfig.json`)

## Lint

PASS (`npm run lint`)

## Remaining TODO

- No `ARCH.md` exists for this library yet; this loop was pure Improvement
  Loop (Sections 1-19), no Design Mode session preceded it.
- The inbox-transaction-scope tradeoff (Loop 001) and the timed-out-handler
  background-transaction edge case (this loop) remain documented, not
  changed — revisit either only if a real incident (connection-pool
  exhaustion, or a redelivered retry blocking on a lock) traces back to them.
- The cross-library `forRootAsync` pattern check against `libs/workflow`
  (Loop 001/002) remains blocked on that library growing an async variant.

## Next Loop

- No further Critical/High findings identified this pass. If a future loop
  wants to harden the retry-publish failure classification further, consider
  whether `classifyPublishError`'s `timeout`/`connectionClosed` categories
  should be made the explicit allowlist for `requeue: true` (rather than
  today's implicit "anything not known-permanent" default) — not done this
  loop since the current default already correctly handles the common
  transient-failure case and no concrete failure besides `UnroutableMessageError`
  surfaced needing the stricter treatment.
- Absent new findings, this library remains at a natural stopping point per
  Section 16 (no Critical/High open, tests/build/lint green).

---

# Loop 004

**Library:** libs/queue
**Date:** 2026-07-22

## Goal

Implement the hardening Loop 003 explicitly named in its Next Loop note, per direct user request:
make `classifyPublishError`'s `timeout`/`connectionClosed` categories the explicit allowlist for
`requeue: true` on a failed retry-publish, rather than the implicit "anything not known-permanent"
denylist default.

## Files Reviewed

- `libs/queue/src/consumer/rmq-consumer.runtime.ts`
- `libs/queue/src/publisher/rmq-publish-error.utils.ts`
- `libs/queue/src/consumer/rmq-consumer.runtime.spec.ts`

## Problems Found

**Critical**
- None

**High**
- None

**Medium**
- Confirmed the gap Loop 003 flagged: `classifyPublishError()` computes `timeout` and
  `connectionClosed` flags, but the retry-publish failure handler only ever read `.rejected`
  (as `isRetryQueueFull`). Any publish error not matching `isRetryQueueFull`/`isConfigError`/
  `isUnroutable` — including the `timeout` category itself, and any future/unrecognized failure
  message — fell through to the implicit `requeue: true` default. That's the same unbounded,
  no-backoff retry-storm shape Loop 003 fixed for `UnroutableMessageError`, just reachable via any
  error the classifier doesn't explicitly name.
- While adding regression coverage, found the "retry queue full" (`rejected`) case had no test at
  all — only the transient (`connectionClosed`) and unroutable cases were covered. Added one.

**Low**
- None

## Changes Made

- `rmq-consumer.runtime.ts`: replaced the denylist (`!isRetryQueueFull && !isConfigError &&
  !isUnroutable`) with an explicit allowlist (`isTransient = !isConfigError && !isUnroutable &&
  (classification?.timeout || classification?.connectionClosed)`). `requeue` is now `isTransient`
  directly. The `retryQueueFull` log field is preserved (now read from `classification?.rejected`)
  for observability parity — it just no longer participates in the requeue decision directly, since
  `rejected` was never part of the new allowlist to begin with (it's implicitly excluded, same
  outcome as before).
- `rmq-consumer.runtime.spec.ts`: added two regression tests — "retry queue is full" (`rejected`,
  previously untested, requeue: false) and "unrecognized error" (matches none of the three known
  patterns, requeue: false — this is the actual behavior change; previously this fell through to
  `true`).

## Why

Direct user request to close the exact gap Loop 003 named and deliberately deferred. The
allowlist-over-denylist framing is strictly safer for a retry-publish failure handler: a new or
unrecognized broker failure mode is far more likely to be another "won't self-heal quickly" case
(config drift, protocol change, a broker version quirk) than a genuinely transient one — defaulting
to no-requeue on the unknown case avoids silently reintroducing an unbounded retry storm the next
time the broker fails in a way nobody anticipated, at the cost of that one message needing an
operator to requeue it manually (or relying on the DLQ, which the consumer already nacks to when
`requeue: false`, so no message is lost).

## Tests

`libs/queue` suite: 25 spec files / 134 tests (up from 25/132 — two new regression tests). Full
monorepo suite: 133 suites / 1051 tests, all passing.

## Build

PASS (`npm run typecheck` — `tsc --noEmit`)

## Lint

PASS (`npm run lint`)

## Remaining TODO

- None new. Loop 003's other Remaining TODO items (inbox-transaction-scope tradeoff, timed-out-handler
  background-transaction edge case, `RMQConnection`'s hard-coded constants, `TopologyBootstrap`'s
  long-lived raw connection) are unchanged — none intersect this loop's scope.

## Next Loop

- No further Critical/High findings. This library remains at a natural stopping point per Section 16
  (no Critical/High open, tests/build/lint green) until a new concrete finding or user request
  surfaces.

---

# Loop 005

**Library:** libs/queue
**Date:** 2026-07-22

## Goal

Direct user request to make `RMQConnection`'s hard-coded raw-connection retry/backoff/prefetch-
ceiling constants configurable — the one carried-over item from Loops 002/003 not tied to an
"only revisit if a real incident happens" condition; the others (inbox-transaction-scope, the
timed-out-handler lock-wait edge case, `TopologyBootstrap`'s long-lived connection) remain
untouched per their own explicit deferral conditions, none of which have changed.

## Files Reviewed

- `libs/queue/src/connection/rmq.connection.ts`
- `libs/queue/src/queue.types.ts` (`QueueModuleOptions`)
- `libs/queue/src/connection/rmq.connection.spec.ts`

## Problems Found

**Low**
- (the same one Loops 002/003 already found and left as-is pending a driving need — no new
  defect; this loop supplies that need directly via user request)

## Changes Made

- `queue.types.ts`: `QueueModuleOptions` gained four optional fields — `maxPrefetch`,
  `rawConnectionMaxRetries`, `rawConnectionBaseDelayMs`, `rawConnectionMaxDelayMs` — each
  documented with its default.
- `rmq.connection.ts`: the four `private static readonly` constants became `DEFAULT_*` fallbacks;
  four new `private readonly` instance fields resolve `options.<field> ?? DEFAULT_*` in the
  constructor, and every use site (`openRawConnection`'s retry loop/backoff calc,
  `validatePrefetch`'s ceiling check) now reads the instance field instead of the static constant.
  No behavior change when the new options are omitted — defaults are identical to the previous
  hard-coded values.
- `rmq.connection.spec.ts`: added two regression tests — a configured `rawConnectionMaxRetries: 2`
  exhausting after 2 attempts (not the library default of 10), and a configured `maxPrefetch: 5`
  accepting 5 but rejecting 6.

## Why

Per Section 17 ("every refactor must have measurable value" / don't add config surface without a
need), Loops 002/003 correctly declined to do this speculatively — "no concrete driving use case"
was the stated reason. A direct user request is itself the driving need (same standard already
applied in Loop 004, done "per direct user request" without further per-item justification).
Kept the change minimal: default values are unchanged, so no existing deployment's behavior shifts
unless it opts in by setting one of the four new options.

## Tests

`libs/queue` suite: 25 spec files / 136 tests (up from 25/134 — two new regression tests). Full
monorepo suite: 135 suites / 1060 tests, all passing.

## Build

PASS (`npm run typecheck`; also explicitly verified `npx nest build server` and
`npx nest build worker` both compile clean)

## Lint

PASS (`npm run lint`)

## Remaining TODO

- Inbox-transaction-scope tradeoff, the timed-out-handler background-transaction edge case, and
  `TopologyBootstrap`'s long-lived raw connection remain unchanged — each still has its own
  explicit "revisit only if X" condition from Loops 001-003, none of which has occurred.
- No `ARCH.md` exists for this library yet.

## Next Loop

- No further Critical/High findings. This library remains at a natural stopping point per
  Section 16 (no Critical/High open, tests/build/lint green) until a new concrete finding or user
  request surfaces.

---

# Loop 006

**Library:** libs/queue
**Date:** 2026-07-23

## Goal

Fresh adversarial Phase 1/2 pass, targeting files that hadn't had individual deep-dive
attention in prior loop write-ups: outbox claim/dispatch (`outbox.repository.ts`,
`outbox-dispatcher.service.ts`), `inbox.repository.ts`/`database-queue-inbox.service.ts`,
`message-settlement.ts`, `rmq-context.factory.ts`, header parser/validator, and
`rmq-payload-validator.ts`, plus a re-read of `rmq-consumer.runtime.ts` in full given its
central role.

## Files Reviewed

- `outbox/outbox.repository.ts` (`claimBatch`'s claim-then-conditional-UPDATE pattern) — traced
  for double-claim races between concurrent dispatchers; confirmed safe (the conditional UPDATE's
  `WHERE status = ...` clause silently no-ops for rows already claimed by a racing dispatcher, and
  the final `find({ claimedBy: owner })` correctly excludes them).
- `outbox/outbox-dispatcher.service.ts` — `sweep`/`dispatch`/`markFailedAttempt`/`computeBackoff`
  traced; the "publish succeeds but the subsequent status-update DB write fails" gap (row stays
  `publishing` until lease expiry, then gets redispatched — a duplicate publish) is inherent,
  accepted at-least-once outbox semantics, not a new defect.
- `message-settlement.ts` — re-verified `settled` flag correctly prevents double ack/nack, and
  that a thrown `channel.ack`/`channel.nack` leaves `settled` false (not falsely marked settled).
- `context/rmq-context.factory.ts`, `context/rmq-header.parser.ts`, `context/rmq-header.validator.ts`,
  `consumer/rmq-payload-validator.ts` — no issues.
- `consumer/rmq-consumer.runtime.ts` (full re-read) — re-verified retry-classification allowlist
  (Loop 004), shutdown ordering (Loop 001), inflight counting via `handlerSettled` (Loop 003's
  documented background-transaction tradeoff) all still correct.
- `inbox/database-queue-inbox.service.ts` + `persistence/entities/queue-inbox.entity.ts` +
  the initial migration — found a new issue (below).

## Problems Found

**Critical** — (none)
**High** — (none)

**Medium**
- `DatabaseQueueInboxService.withIdempotency` built its dedup primary key via naive string
  concatenation: `` `${consumerKey}:${messageId}` ``. `consumerKey` is the queue name;
  `messageId` is the AMQP message's producer-supplied `messageId` property — arbitrary, not
  controlled by this library. Neither component is escaped, so two distinct pairs collide
  whenever either contains a `:` (e.g. `consumerKey="a:b", messageId="c"` and
  `consumerKey="a", messageId="b:c"` both produce `"a:b:c"`). The entity's
  `@Index(['consumerKey', 'messageId'])` is non-unique (lookup-only) — the actual
  dedup/uniqueness guarantee rests entirely on the derived `id` primary key. A collision means
  the second, logically-distinct message hits `isDuplicateKeyError` and is silently treated as
  "already processed" — its handler never runs, no error surfaced. Exact same collision-prone
  concatenation pattern as the Redis-namespace bug fixed in `libs/cache` Loop 3/this session;
  zero test coverage of the collision case existed.

**Low** — (none newly found this loop)

## Changes Made

- `inbox/database-queue-inbox.service.ts`: `id` is now built via
  `JSON.stringify([consumerKey, messageId])` instead of string concatenation — JSON-escapes both
  values, so distinct pairs always produce distinct ids. No schema/migration change: `id` was
  already a plain `varchar` primary column with no length constraint tight enough to matter.
- `inbox/database-queue-inbox.service.spec.ts`: added a regression test with the exact
  `consumerKey="a:b"/messageId="c"` vs. `consumerKey="a"/messageId="b:c"` pair, asserting both
  are treated as distinct (both run, `operation` called twice).

## Why

- Direct instance of the same "composite key collision" risk category ci.loop §9 names, applied
  here to an inbox idempotency key rather than a cache namespace — not invented or cosmetic.
  `messageId` is producer-controlled and outside this library's control, so the collision isn't
  purely theoretical the way an internally-generated key would be. Fix is additive/internal (the
  `id` column's *contents* change format, but it's an opaque dedup key with no external
  consumers reading its structure — no schema change, no public API change), so MEDIUM risk per
  ci.loop §18, consistent with how the analogous cache fix was classified this session.
- Existing rows with the old `consumerKey:messageId` format remain valid as opaque primary keys
  after this change (old rows aren't rewritten, but new inserts use the new format) — no
  migration needed since collisions were already latent corruption, not a format any code reads
  back apart from equality/uniqueness checks.

## Tests

`libs/queue` suite is now 25 spec files / 137 tests (up from 136). Full monorepo suite: 145
suites / 1171 tests, all passing.

## Build

PASS (`npm run typecheck`)

## Lint

PASS (`npm run lint`)

## Remaining TODO

- No `ARCH.md` exists for this library yet.
- Inbox-transaction-scope tradeoff, the timed-out-handler background-transaction edge case, and
  `TopologyBootstrap`'s long-lived raw connection remain unchanged — each still has its own
  explicit "revisit only if X" condition from Loops 001-003, none of which has occurred.

## Next Loop

- No further Critical/High/Medium findings identified this pass beyond the one fixed. This
  library remains at a natural stopping point per Section 16 (no Critical/High/Medium open,
  tests/build/lint green) until a new concrete finding or user request surfaces.

---

# Loop 007

**Library:** libs/queue
**Date:** 2026-07-23

## Goal

Following the same-day live-infra verification pattern applied to `libs/auth` (Loop 019) and
`libs/workflow` (Loop 021), close the analogous gap here: Loop 006's inbox dedup-key collision
fix (`JSON.stringify([consumerKey, messageId])` instead of string concatenation) was only ever
verified against in-memory sqlite. `isDuplicateKeyError` explicitly branches on driver-specific
error codes (`ER_DUP_ENTRY` for MySQL vs. `SQLITE_CONSTRAINT_PRIMARYKEY` for sqlite) — a
sqlite-only test exercises a different branch of that function than production (MySQL) ever hits.

## Files Reviewed

- No source changes — this loop only adds a test.
- `inbox/database-queue-inbox.service.ts`'s `withIdempotency` and `inbox/is-duplicate-key-error.ts`
  (Loop 006's fix), re-read to confirm both are unmodified since Loop 006.

## Problems Found

None — this loop is verification-only, not a review pass.

## Changes Made

- New `inbox/database-queue-inbox.mysql.integration.spec.ts`: reruns Loop 006's collision
  regression test (`consumerKey="a:b"/messageId="c"` vs. `consumerKey="a"/messageId="b:c"`)
  against a real `mysql` `DataSource` pointed at the `app_scratch` scratch schema (provisioned
  for `libs/auth` Loop 019, reused here), plus a second test proving a genuine duplicate delivery
  of the same `(consumerKey, messageId)` pair is correctly treated as already-processed via a
  real `ER_DUP_ENTRY` from MySQL's own unique-constraint enforcement, not a mocked
  `QueryFailedError`. Gated behind `RUN_MYSQL_INTEGRATION_TESTS=1` (`describe.skip` by default,
  matching `libs/auth`/`libs/workflow`'s companion tests) so `npm test` stays hermetic.

## Why

- Same reasoning as `libs/auth`/`libs/workflow`'s live-verification loops this session: the fix
  was already correct by inspection, but its correctness specifically depends on a driver-level
  detail (which error code a real duplicate-key violation actually raises) that an in-memory
  sqlite datasource cannot exercise, matching ci.loop's own precedent (Loop 007 in
  `libs/database`) that driver-specific behavior deserves live verification when it's available.
- Risk: LOW. No production code changed — only a new opt-in test file, reusing infra already
  provisioned this session.

## Tests

`libs/queue` suite gains 1 spec file / 2 tests (skipped by default). With
`RUN_MYSQL_INTEGRATION_TESTS=1`: both pass against real MySQL. Full monorepo default suite: 149
suites / 1194 tests, all passing (4 suites/5 tests skipped by default across this session's
auth/workflow/queue/ratelimit MySQL/Redis-gated additions).

## Build

PASS (`npm run typecheck`)

## Lint

PASS (`npm run lint`)

## Remaining TODO

- Unchanged: inbox-transaction-scope tradeoff and `TopologyBootstrap`'s long-lived raw connection,
  each with their own "revisit only if X" condition, none triggered.

## Next Loop

- No Critical/High/Medium findings remain open, and the one previously-implicit live-verification
  gap for the inbox dedup fix is now closed. `libs/queue` remains at a natural stopping point per
  Section 16 until a new concrete finding or requirement surfaces.
