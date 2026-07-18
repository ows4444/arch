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
