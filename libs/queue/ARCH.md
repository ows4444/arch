# Design 001

**Library / Bounded Context:** libs/queue (Messaging Infrastructure)
**Date:** 2026-07-23

## Goal

Retroactively document `libs/queue`'s architecture, matching `libs/database/ARCH.md` Design 001's
same-day precedent: this library went through 10 Improvement Loop passes (see `LOOP.md`) with no
preceding Design Mode session. This entry captures what was already built, cross-checked against
the actual source and this session's own findings, rather than proposing anything new.

## Scale/Team Context Assumed

Single maintainer, Nest monorepo, RabbitMQ via `amqp-connection-manager` (auto-reconnecting
channel/connection wrapper — chosen over driving `amqplib` directly so this library doesn't have
to reimplement reconnect logic RabbitMQ client libraries commonly already solve). One broker
instance in dev (`docker/compose/compose.yml`); no stated multi-region or multi-broker target.
Both `apps/server` and `apps/worker` consume this library — `apps/worker` is the intended home for
`@RMQConsumer`-decorated message handlers, `apps/server` is the primary publisher, though nothing
in this library enforces that split structurally (a handler can be declared in either app).

## Bounded Contexts Identified

- **Single bounded context: Messaging Infrastructure.** A Generic Subdomain, same framing as
  `libs/database`: necessary infrastructure for reliable pub/sub over RabbitMQ, owned by no
  business domain. Splits internally into two cooperating concerns that are worth naming
  separately even though they live in one library:
  - **Transport** — connection lifecycle, topology bootstrap, publish/consume, header/context
    propagation, retry/dead-letter classification. This is the part every consumer touches
    directly (`@RMQConsumer`, `RMQPublisher`).
  - **Reliability patterns** — the transactional outbox (`OutboxService`/
    `OutboxDispatcherService`) and inbox (`DatabaseQueueInboxService`/`NoopQueueInboxService`),
    which exist specifically to bridge this library's at-least-once messaging guarantees to
    `libs/database`'s transactional writes, so "the DB write committed" and "the message will
    eventually publish/won't be double-processed" can both be true without a distributed
    transaction.
- Does **not** own message *schema* — payload shape/validation is each consumer's own concern
  (`RMQPayloadValidator` wraps whatever DTO a `@RMQConsumer` declares); this library only owns
  the envelope (headers, retry count, correlation/causation ids).

## Context Map

- **Downstream of `libs/database`.** The outbox/inbox reliability patterns ride directly on
  `BaseRepository`/`TransactionExecutor` — `OutboxService.enqueue` inserts inside whatever ambient
  `@Transactional()` wraps the caller's business write (same transaction, same commit/rollback);
  `DatabaseQueueInboxService.withIdempotency` wraps the consumer handler body in its own
  transaction alongside the inbox-row insert. Entities/migrations
  (`QUEUE_TYPEORM_ENTITIES`/`QUEUE_MIGRATIONS`) are exported for the host app to merge into its own
  `DatabaseModule.forRoot` call — this library never owns a datasource itself.
- **Downstream of RabbitMQ via `amqp-connection-manager`.** No anti-corruption layer beyond typed
  wrappers (`RMQConnection`, `RMQPublisher`) — `amqplib`'s `Channel`/`ConsumeMessage` types are
  used directly inside the consumer runtime, not re-abstracted.
- **Upstream of `libs/workflow`'s scheduled/queue-adjacent features** only in the sense that both
  libraries independently invented the identical "claim-then-conditional-UPDATE" poll-sweep
  pattern (`OutboxRepository.claimBatch` / `TypeOrmWorkflowScheduleStore.claimDue`) — `libs/queue`'s
  outbox was the original, and `libs/workflow`'s scheduler explicitly copied its shape (see
  `libs/workflow/LOOP.md` Loop 007) rather than this library exposing a shared abstraction. Kept as
  independent, duplicated-but-intentional code per that loop's own reasoning — the two claim
  different row shapes for different reasons, and a forced shared helper would have been a thinner
  abstraction than the two call sites justify.

## Architecture Style Recommendation

Not applicable in the monolith/microservices sense (a library, not a deployable service). The one
style-shaped decision: **topology-as-code**, not broker-console-configured infrastructure —
exchanges/queues/bindings/DLQs are declared as `RmqTopologyDefinition[]` in application code and
asserted idempotently at boot (`TopologyBootstrap`), so the broker's actual topology is always
derivable from source control rather than drifting from manual broker-admin changes.

## Module Breakdown

- **`QueueModule`** (`@Global()`, empty static `@Module({})`) — `forRoot`/`forRootAsync`. Outbox/
  inbox providers are *always* registered in `forRootAsync` (unlike `forRoot`'s static
  `options.outbox`-gated registration) since the async path only knows the resolved config at
  runtime; each provider decides at runtime whether to actually activate (`OutboxDispatcherService.
  onModuleInit` no-ops when `QUEUE_OUTBOX_OPTIONS` resolves to `undefined`; `QUEUE_INBOX_SERVICE`
  resolves to `NoopQueueInboxService` or `DatabaseQueueInboxService` based on the resolved `inbox`
  flag) — the "always register, decide at runtime" pattern this loop's own Loop 001 established
  and later loops (`libs/workflow`'s scheduler) cross-checked against for consistency.
- **`connection/`** — `RMQConnection` (the shared `amqp-connection-manager` connection + per-purpose
  channel creation, raw-connection retry/backoff with configurable
  `rawConnectionMaxRetries`/`rawConnectionBaseDelayMs`/`rawConnectionMaxDelayMs`/`maxPrefetch`
  ceiling, Loop 005). Owns `close()` (not a shutdown-hook itself — see Reliability Architecture for
  why shutdown ordering matters here).
- **`consumer/`** — `RMQConsumerRuntime` (the per-message execution loop: context creation, payload
  validation, inbox-wrapped invocation, timeout racing, retry-vs-dead-letter classification,
  ack/nack), `RMQHandlerRegistry` (`@RMQConsumer`-decorated provider discovery via
  `DiscoveryModule`), `message-settlement.ts` (idempotent ack/nack, tracks whether a message was
  already settled so a timeout racing a late handler resolution can't double-settle).
- **`context/`** — `RMQContextFactory`/header parser/validator: builds the per-message
  `requestId`/`correlationId`/`causationId`/`AbortSignal` context, enforcing that system headers
  (retry count, internal publish id) can't be overridden by caller-supplied ones.
- **`publisher/`** — `RMQPublisher` (publish + unroutable-message detection via a return-listener,
  correlated by an internal-only publish id — not the caller's `messageId`, which retries/outbox
  redelivery intentionally reuse across multiple `publish()` calls for the same logical message;
  Loop 002's fix for the resulting cross-call misattribution risk), `serializer.ts`,
  `rmq-publish-error.utils.ts` (classifies a publish failure as timeout/connection-closed/rejected,
  the allowlist Loop 004 built retry-safety on).
- **`retry/`** — `retry-queue.naming.ts`/`retry-topology.builder.ts`: delayed-retry queues named/
  built per `(exchange, queue, delaySeconds)`, declared in the same topology-as-code pass as the
  primary queues.
- **`topology/`** — `TopologyBootstrap` (idempotent boot-time assert of every declared exchange/
  queue/binding/DLQ against a raw, long-lived AMQP connection — deliberately not the managed
  `ChannelWrapper` used elsewhere, since sequential `assertQueue`/`assertExchange` fits a plain
  connection better than `ChannelWrapper`'s queued-setup semantics), `topology.builder.ts`/
  `topology.contracts.ts` (the declarative `RmqTopologyDefinition` shape).
- **`outbox/`** — `OutboxService.enqueue` (transactional insert, throws `QueueConfigurationError`
  if outbox isn't configured rather than silently no-op-inserting), `OutboxDispatcherService`
  (unref'd poll-sweep interval; `OutboxRepository.claimBatch`'s select-candidates →
  conditional-UPDATE → re-select claim pattern, exponential backoff + jitter on failure, optional
  `onExhausted` hook after `maxAttempts`).
- **`inbox/`** — `DatabaseQueueInboxService.withIdempotency` (wraps the handler body + an
  idempotency-key insert in one transaction; a duplicate-key hit on the insert is the dedup
  signal, not a separate existence check — this is what makes it atomic under concurrent redelivery
  rather than check-then-insert), `NoopQueueInboxService` (the `inbox: false` default — always
  "ran", no dedup), `is-duplicate-key-error.ts` (MySQL/Postgres/SQLite driver-code detection, the
  same shape independently reused in `libs/workflow`/`libs/auth`).
- **`errors/`** — typed by retry semantics, not just message: `RetryableMessageError`,
  `NonRetryableMessageError`, `HandlerTimeoutError` (extends `RetryableMessageError` — a timeout
  is retriable, not a permanent failure), `UnroutableMessageError`, `QueueConfigurationError`.

## Aggregate Design

Not applicable in the DDD business-aggregate sense. The two persisted entities
(`QueueOutboxEntity`, `QueueInboxEntity`) are each their own row-per-message aggregate with no
internal object graph — an outbox row's lifecycle (`pending` → `publishing` → `published`/
`failed`, tracked via `status`/`attempts`/`claimedBy`/`claimedAt`/`nextAttemptAt`) is the one real
state machine in this library's persisted data, driven entirely by `OutboxDispatcherService`.

## Domain Model

- **`QueueOutboxEntity`** — `messageId`, `exchange`, `routingKey`, `payload`, `headers`, `status`,
  `attempts`, `lastError`, `claimedBy`/`claimedAt` (the claim mechanism), `nextAttemptAt` (backoff
  scheduling), `createdAt`/`publishedAt`.
- **`QueueInboxEntity`** — composite awareness via a derived primary key over `consumerKey` +
  `messageId` (Loop 006 this session: fixed from naive `${consumerKey}:${messageId}` string
  concatenation, which could collide if either component contained a colon, to
  `JSON.stringify([consumerKey, messageId])` — see Reliability Architecture).
- **`RMQContext`** — per-message request context (`requestId`/`correlationId`/`causationId`/
  `routingKey`/`exchange`/`queue`/`receivedAt`/`signal`), built fresh per delivery, never
  persisted.
- **Error taxonomy** — see Module Breakdown's `errors/` entry; this is the domain model's most
  load-bearing part, since retry/dead-letter decisions are made almost entirely by error *type*,
  not by inspecting message content.

## Commands / Queries / Events

Not applicable as a formal CQRS-style split — `RMQPublisher.publish()` is the closest thing to a
"command" (fire a message), and there's no query surface at all. `libs/queue` doesn't publish its
own domain events; it *carries* whatever events consumers choose to put in message payloads.

## Engines / Policies / Specifications

- **Retry policy** (`RmqConsumerOptions.retryPolicy`, per-`@RMQConsumer`): a declared strategy
  (delay per attempt index) evaluated by `rmq-retry.utils.ts`'s `getRetryCount` +
  `RMQConsumerRuntime.getRetryDecision`. Not a generic rule engine — one fixed shape (retry count
  vs. a per-attempt delay table), matching what every current consumer actually needs.
- **Retry-publish-failure classification policy** (`classifyPublishError` +
  `RMQConsumerRuntime.consumeMessage`'s catch block): an **explicit allowlist**, not a denylist —
  only a publish failure classified as genuinely transient (`timeout`/`connectionClosed`) requeues
  the original message; everything else (config error, unroutable retry queue, or any
  unrecognized failure) nacks without requeue. Loop 004 deliberately inverted this from an earlier
  denylist shape specifically because a denylist silently requeues on any *new* failure mode nobody
  anticipated — the exact shape that caused Loop 003's original unbounded-retry-storm bug.
- **Specification-shaped check:** `isDuplicateKeyError` (`inbox/`) — same role as
  `libs/database`'s `isDatabaseConnectivityError`: one function deciding a binary outcome
  (duplicate vs. real error) for every inbox insert.

## Workflows / Sagas

Not applicable — no multi-step business process; `libs/workflow` is where saga/compensation logic
lives, consuming this library's outbox as a reliable publish mechanism, not the reverse.

## Data Architecture

Rides entirely on `libs/database`'s MySQL datasource — `queue_outbox`/`queue_inbox` tables, no
separate store. No polyglot persistence; the outbox pattern's whole point is keeping the message
record and the business write in the *same* transactional store, which requires this.

## Messaging Architecture

- **Broker:** RabbitMQ, via `amqp-connection-manager` (auto-reconnecting) for topology
  bootstrap/publish/consume, distinct from the transport concerns already covered under Module
  Breakdown.
- **Delivery guarantee:** at-least-once, both directions — a publish can be retried (outbox
  redelivery, retry-queue redelivery) and a consumer can receive the same message more than once
  (broker redelivery after a crash before ack) — the inbox pattern exists specifically to make
  at-least-once *look like* effectively-once to the business logic, via the idempotency-key insert.
- **Header/trace propagation:** `requestId`/`correlationId`/`causationId`/retry-count are system
  headers; `context/rmq-header.validator.ts` enforces caller-supplied headers can never override
  them (a payload trying to spoof `x-retry-count`, say, is stripped before it reaches the handler).

## Reliability Architecture

The dominant concern of this library, and where most of its 10 Improvement Loop passes' real
findings live:

- **Outbox: transactional insert, best-effort dispatch.** `OutboxService.enqueue` writes inside
  the caller's own transaction (same commit/rollback as the business write it accompanies) —
  `OutboxDispatcherService`'s sweep is a separate, non-transactional poll loop
  (`claimBatch`'s select → conditional-UPDATE → re-select, matching `libs/queue`'s own
  originally-invented shape that `libs/workflow`'s scheduler later copied). A publish succeeding
  but the subsequent status-update write failing leaves the row `publishing` until the claim
  goes stale and gets redispatched — an accepted at-least-once tradeoff (a possible duplicate
  publish), not a bug, given consumers are expected to be idempotent-safe against redelivery
  already.
- **Inbox: dedup key must be collision-proof, not just "usually fine."** `DatabaseQueueInboxService.
  withIdempotency`'s composite key was `` `${consumerKey}:${messageId}` `` — naive string
  concatenation, vulnerable to collision if either component contained a `:` (this session's
  Loop 006 fix, switching to `JSON.stringify([consumerKey, messageId])`). `messageId` is
  producer-controlled, not something this library can constrain — a collision there would have
  silently dropped a genuinely distinct message as a false "duplicate," never running its handler
  at all. This is the same composite-key-collision bug class independently found and fixed this
  session in `libs/cache` (Redis namespace) and `libs/ratelimit` (rate-limit key) — worth checking
  for again in any future composite string key built by concatenation rather than an
  unambiguous encoding.
- **Retry-publish failure must not create an unbounded retry storm.** See the allowlist policy
  under Engines / Policies — Loop 003 found and fixed the original denylist-shaped bug (an
  unrecognized publish failure would requeue with no backoff, hammering the broker); Loop 004
  hardened it further from denylist to allowlist per direct user request.
- **Graceful shutdown ordering matters because Nest doesn't guarantee
  `OnApplicationShutdown` hook order across sibling providers.** `RMQConnection.close()` is a
  plain method, deliberately *not* its own `OnApplicationShutdown` hook — `RMQConsumerRuntime.
  onApplicationShutdown()` calls it explicitly, *after* cancelling/draining every consumer, since
  Nest calls every provider's shutdown hook concurrently and closing the shared connection while
  consumers are still mid-cancel would break in-flight ack/nack calls (Loop 001's fix).
- **`RMQPublisher`'s unroutable-message detection is correlated by an internal id, not the
  caller's `messageId`.** Retries and outbox redelivery both intentionally reuse the same
  `messageId` across multiple `publish()` calls for the same logical message — correlating a
  broker `return` event by caller `messageId` would misattribute it under concurrent in-flight
  publishes sharing that id (Loop 002's fix: a fresh internal-only header per `publish()` call).

## Security Architecture

- **Header spoofing prevention.** System headers (retry count, internal publish-correlation id)
  are stripped from/never trusted in caller-supplied header maps — a payload can't forge its own
  retry count or hijack another in-flight publish's correlation.
- **Payload validation** is delegated entirely to each `@RMQConsumer`'s declared DTO
  (`RMQPayloadValidator`) — this library enforces that validation runs, not what it validates.
- **No authN/authZ surface** — any process that can reach the broker can publish/consume; access
  control is the broker's/network's responsibility, same as `libs/database` trusts every in-process
  caller equally.

## Folder Structure

Matches Module Breakdown: `connection/`, `consumer/`, `context/`, `errors/`, `outbox/`, `inbox/`,
`persistence/` (entities/migrations for outbox+inbox), `publisher/`, `retry/`, `testing/`
(`queue-test-datasource.ts`, the sqlite-backed integration-test helper), `topology/`, `utils/`,
plus `queue.module.ts`/`queue.types.ts`/`queue.constants.ts` and a single barrel `index.ts`. Flat,
concern-named top level — same convention `libs/database` established and every early sibling
library followed before `libs/auth`/`libs/ratelimit` adopted a heavier domain-layered structure
for their own genuinely domain-shaped bounded contexts.

## Deployment Architecture

One RabbitMQ connection shared across every `@RMQConsumer` (each gets its own channel via
`amqp-connection-manager`), topology asserted idempotently at every boot (safe to run repeatedly
against an already-configured broker). Outbox/inbox tables merge into the host app's own
`DatabaseModule.forRoot` migrations, same pattern as `libs/workflow`/`libs/auth`.

## Team Ownership Model

Not applicable — single maintainer.

## Tradeoff Analysis

- **Denylist → allowlist for retry-publish-failure classification.** Directly reversed once the
  denylist shape caused a real incident-shaped bug (Loop 003); the allowlist trades "a genuinely
  new transient failure mode might not requeue until explicitly added to the allowlist" against
  "an unrecognized failure mode can never cause an unbounded retry storm again" — accepted as the
  safer default, with the cost (an operator may need to requeue a message manually for a truly
  novel transient failure) explicitly named in that loop's own reasoning.
- **Never-unify the outbox `claimBatch` pattern with `libs/workflow`'s scheduler `claimDue`,
  despite being structurally identical.** Both libraries independently confirmed (via their own
  loops) that the two claim different row shapes for genuinely different reasons — a forced shared
  abstraction was judged more likely to obscure than help, per the same reasoning
  `ChildWorkflowService` uses against unifying its own structurally-similar-but-not-identical
  spawn helpers.
- **Raw AMQP connection for topology bootstrap, not the managed `ChannelWrapper`.** Mildly wasteful
  (the raw connection stays open for the app's full lifetime after the one-time bootstrap
  completes) but deliberate — sequential `assertQueue`/`assertExchange` fits a plain connection's
  request/response model better than `ChannelWrapper`'s queued-setup semantics. Not revisited since
  the cost (one extra idle connection) is low and no concrete problem has ever traced back to it.

## Future Scalability Plan

Not applicable in detail given no stated scale target. The one named, not-yet-acted-on item: the
inbox-transaction-scope tradeoff (the consumer handler body runs inside the same DB transaction
as the inbox-row insert, holding a connection open for the handler's full duration including any
non-DB I/O) is explicitly flagged as "revisit if a real connection-pool-exhaustion incident traces
back to a slow consumer handler" — not a problem today, but the first thing to look at if one
appears.

## Open Questions

- None outstanding — every open item from `LOOP.md`'s history is either closed or explicitly
  deferred pending a concrete driving need (most recently Loop 006's two consecutive clean
  adversarial passes this session).

## Handoff to Improvement Loop

- **Public API surface:** `libs/queue/src/index.ts`'s barrel — `QueueModule`, `@RMQConsumer`,
  `RMQPublisher`, `RMQContext`, the full `errors/` taxonomy, `OutboxService`, topology contract
  types (`RmqTopologyDefinition` and friends), `QUEUE_TYPEORM_ENTITIES`/`QUEUE_MIGRATIONS`.
- **Module boundaries:** as described under Module Breakdown — unchanged from what's already
  implemented; this entry documents, not proposes, the boundary.

---

## Executive Summary

`libs/queue` wraps RabbitMQ (via `amqp-connection-manager`) with topology-as-code and the two
reliability patterns — transactional outbox and idempotent inbox — that let this library's
inherently at-least-once messaging guarantees compose safely with `libs/database`'s transactional
writes. Its own bounded context splits cleanly into transport (connection/topology/publish/
consume/context propagation) and reliability (outbox/inbox), with retry/dead-letter decisions
driven almost entirely by a typed error taxonomy rather than message inspection. Ten Improvement
Loop passes have found and fixed real defects concentrated in exactly the reliability-critical
paths: reader-adjacent shutdown ordering, publish-id correlation under concurrent retries, an
unbounded retry-storm risk from denylist-shaped failure classification, and — this session — a
composite-key collision in the inbox's dedup key, the same bug class independently found in two
sibling libraries (`libs/cache`, `libs/ratelimit`), all now fixed and covered by regression tests.
The one deliberately-accepted, still-open tradeoff: the inbox wraps a consumer handler's full
execution inside the same DB transaction as its dedup-key insert, a known connection-hold-time
cost with an explicit "revisit if it ever causes a real incident" condition attached, not a
silent gap.
